import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Reproject the last converged surface shading for the first small movement.
// A depth check rejects newly exposed surfaces; larger view changes fade it out.
export const surfaceHistoryShader = /* glsl */`
  uniform sampler2D surfaceHistoryColor, surfaceHistoryDepth;
  uniform mat4 surfaceHistoryProjection;
  uniform float surfaceHistoryWeight;
  vec3 restoreSurfaceDetail(vec3 current, vec3 worldPosition) {
    if (surfaceHistoryWeight <= 0.0) return current;
    vec4 projected = surfaceHistoryProjection * vec4(worldPosition, 1.0);
    vec3 ndc = projected.xyz / projected.w;
    vec2 uv = ndc.xy * 0.5 + 0.5;
    if (projected.w <= 0.0 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return current;
    float expected = ndc.z * 0.5 + 0.5;
    float depth = texture2D(surfaceHistoryDepth, uv).r;
    float tolerance = max(0.000015, fwidth(expected) * 1.25);
    float visible = 1.0 - smoothstep(tolerance, tolerance * 2.0, abs(depth - expected));
    return mix(current, texture2D(surfaceHistoryColor, uv).rgb, surfaceHistoryWeight * visible);
  }
`;

export class SurfaceHistory {
  constructor(width, height) {
    this.color = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false });
    this.color.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.depth = new THREE.WebGLRenderTarget(width, height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.depth.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    this.depthMaterial = new THREE.MeshDepthMaterial();
    this.projection = new THREE.Matrix4(); this.position = new THREE.Vector3();
    this.uniforms = {
      surfaceHistoryColor: { value: this.color.texture }, surfaceHistoryDepth: { value: this.depth.depthTexture },
      surfaceHistoryProjection: { value: this.projection }, surfaceHistoryWeight: { value: 0 },
    };
    this.copy = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { map: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'varying vec2 vUv; uniform sampler2D map; void main() { gl_FragColor = texture2D(map, vUv); }',
    });
    this.quad = new FullScreenQuad(this.copy); this.valid = false;
  }
  reset() { this.valid = false; this.uniforms.surfaceHistoryWeight.value = 0; }
  resize(width, height) { this.color.setSize(width, height); this.depth.setSize(width, height); this.reset(); }
  update(camera) {
    let weight = 0;
    if (this.valid) {
      const radius = camera.position.length();
      const cosine = this.position.dot(camera.position) / (this.radius * radius);
      const angle = Math.acos(THREE.MathUtils.clamp(cosine, -1, 1));
      weight = (1 - THREE.MathUtils.smoothstep(angle, 0.35 * Math.PI / 180, 2.5 * Math.PI / 180))
        * (1 - THREE.MathUtils.smoothstep(Math.abs(radius / this.radius - 1), 0.001, 0.025));
    }
    this.uniforms.surfaceHistoryWeight.value = weight;
  }
  capture(renderer, scene, camera, radiance) {
    const previous = renderer.getRenderTarget(), background = scene.background, override = scene.overrideMaterial;
    renderer.setRenderTarget(this.color); this.copy.uniforms.map.value = radiance; this.quad.render(renderer);
    scene.background = null; scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.depth); renderer.render(scene, camera);
    scene.background = background; scene.overrideMaterial = override; renderer.setRenderTarget(previous);
    camera.updateMatrixWorld();
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.position.copy(camera.position); this.radius = this.position.length(); this.valid = true;
  }
  dispose() {
    this.color.dispose(); this.depth.depthTexture.dispose(); this.depth.dispose();
    this.depthMaterial.dispose(); this.copy.dispose(); this.quad.dispose();
  }
}
