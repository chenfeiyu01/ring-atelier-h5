import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGemBounds, createGemPreviewMaterial } from './gem-preview.js';

// The interactive renderer owns its targets, merged buffers and gem shaders.
// Metal materials and original gem meshes remain shared with the path tracer.
export class JewelryPreview {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.bounds = new Map(); this.materials = new Map(); this.environments = new Map();
    this.metalGeometries = [];
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples),
    });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.composite = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { preview: { value: this.target.texture }, refined: { value: this.target.texture }, blend: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform sampler2D preview, refined; uniform float blend;
        void main() {
          gl_FragColor = vec4(mix(texture2D(preview, vUv).rgb, texture2D(refined, vUv).rgb, blend), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.quad = new FullScreenQuad(this.composite);
  }
  setModel(model) {
    this.scene.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    this.metalGeometries.forEach(geometry => geometry.dispose()); this.metalGeometries = [];
    this.scene.clear();
    this.gemCount = 0;
    const groups = new Map();
    const metals = new Map();
    model.updateMatrixWorld(true);
    model.traverseVisible(source => {
      if (!source.isMesh) return;
      if (source.material.transmission > 0.9) {
        const key = `${source.geometry.id}-${source.material.id}`;
        if (!groups.has(key)) groups.set(key, { source, matrices: [] });
        groups.get(key).matrices.push(source.matrixWorld.clone());
        this.gemCount++;
      } else {
        // Prongs and rails use the same material. Bake their fixed transforms
        // into a preview-only buffer instead of issuing hundreds of draw calls.
        const layout = Object.keys(source.geometry.attributes).sort().join(',');
        const key = `${source.material.id}-${layout}-${!!source.geometry.index}`;
        if (!metals.has(key)) metals.set(key, { material: source.material, geometries: [] });
        const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
        geometry.clearGroups(); metals.get(key).geometries.push(geometry);
      }
    });
    for (const { material, geometries } of metals.values()) {
      const merged = mergeGeometries(geometries);
      if (!merged) throw new Error('Incompatible preview metal geometry');
      geometries.forEach(geometry => geometry.dispose());
      this.metalGeometries.push(merged);
      this.scene.add(new THREE.Mesh(merged, material));
    }
    for (const [key, { source, matrices }] of groups) {
      if (!this.bounds.has(source.geometry)) this.bounds.set(source.geometry, createGemBounds(source.geometry));
      if (!this.materials.has(key)) {
        const material = createGemPreviewMaterial(source.material, this.bounds.get(source.geometry));
        material.uniforms.environment.value = this.environment;
        this.materials.set(key, material);
      }
      // The 126 small diamonds share a draw call, shader and cut BVH.
      const mesh = new THREE.InstancedMesh(source.geometry, this.materials.get(key), matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }
  }
  setEnvironment(environment, background) {
    this.environment = environment;
    // Filtering Float32 textures is optional even on WebGL 2 devices that can
    // render to floating-point targets. Keep those devices' textures complete.
    if (environment.type === THREE.FloatType && !this.renderer.extensions.has('OES_texture_float_linear')) {
      environment.minFilter = environment.magFilter = THREE.NearestFilter;
      environment.needsUpdate = true;
    }
    if (!this.environments.has(environment)) this.environments.set(environment, this.pmrem.fromEquirectangular(environment));
    this.scene.environment = this.environments.get(environment).texture;
    this.scene.background = background;
    this.materials.forEach(material => { material.uniforms.environment.value = environment; });
  }
  resize(width, height) { this.target.setSize(width, height); }
  render(camera) {
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, camera);
    this.drawCalls = this.renderer.info.render.calls;
    this.renderer.setRenderTarget(previous);
  }
  display(refined = this.target.texture, blend = 0) {
    this.composite.uniforms.refined.value = refined;
    this.composite.uniforms.blend.value = blend;
    this.quad.render(this.renderer);
  }
  dispose() {
    this.scene.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    this.scene.clear(); this.target.dispose(); this.composite.dispose(); this.quad.dispose();
    this.metalGeometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.bounds.forEach(bounds => bounds.uniform.dispose());
    this.environments.forEach(target => target.dispose()); this.pmrem.dispose();
  }
}
