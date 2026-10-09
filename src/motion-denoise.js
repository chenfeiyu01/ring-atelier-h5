import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const screenVertex = `varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const targetOptions = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };

// Reproject previous radiance using the actual surface position, normal and material.
// History survives camera movement, but never changes the converged static render.
export class MotionDenoiser {
  constructor(model, width, height) {
    this.guideMaterials = [1 / 3, 2 / 3, 1].map(surfaceId => new THREE.ShaderMaterial({
      vertexShader: `varying vec3 worldNormal;
        void main() {
          worldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `varying vec3 worldNormal; uniform float surfaceId;
        void main() { gl_FragColor = vec4(normalize(worldNormal) * 0.5 + 0.5, surfaceId); }`,
      uniforms: { surfaceId: { value: surfaceId } }, toneMapped: false,
    }));
    this.scene = new THREE.Scene();
    const guideModel = model.clone(true);
    guideModel.traverse(o => {
      if (o.isMesh) o.material = this.guideMaterials[o.material.transmission > 0.9 ? 2 : o.material.metalness < 1 ? 1 : 0];
    });
    this.scene.add(guideModel);
    this.guides = [0, 1].map(() => {
      const target = new THREE.WebGLRenderTarget(width, height, {
        ...targetOptions, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      });
      target.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
      return target;
    });
    this.history = [0, 1].map(() => new THREE.WebGLRenderTarget(width, height, targetOptions));
    this.filtered = new THREE.WebGLRenderTarget(width, height, targetOptions);
    this.viewProjection = new THREE.Matrix4(); this.previousViewProjection = new THREE.Matrix4();
    this.inverseViewProjection = new THREE.Matrix4(); this.previousInverseViewProjection = new THREE.Matrix4();
    this.previousCameraPosition = new THREE.Vector3();
    this.guidePoses = [null, null]; this.read = 0; this.valid = false; this.needsInitialization = true;
    this.clearColor = new THREE.Color(); this.temporalFrames = 0; this.seedFrames = 0;

    this.filterMaterial = new THREE.ShaderMaterial({
      vertexShader: screenVertex, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { radiance: { value: null }, guide: { value: null }, depth: { value: null },
        pixelSize: { value: new THREE.Vector2(1 / width, 1 / height) }, stride: { value: 1 }, colorSharpness: { value: 0 } },
      fragmentShader: `varying vec2 vUv;
        uniform sampler2D radiance, guide, depth; uniform vec2 pixelSize; uniform float stride, colorSharpness;
        void main() {
          vec4 center = texture2D(guide, vUv);
          vec3 normal = normalize(center.rgb * 2.0 - 1.0);
          float z = texture2D(depth, vUv).r;
          vec3 centerColor = texture2D(radiance, vUv).rgb;
          vec3 sum = vec3(0.0); float total = 0.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y)); vec2 uv = vUv + offset * pixelSize * stride;
            vec4 other = texture2D(guide, uv);
            if (abs(other.a - center.a) > 0.1) continue;
            float weight = exp(-dot(offset, offset) * 0.85);
            weight *= pow(max(dot(normal, normalize(other.rgb * 2.0 - 1.0)), 0.0), 48.0);
            weight *= exp(-abs(texture2D(depth, uv).r - z) * 1800.0);
            vec3 color = min(texture2D(radiance, uv).rgb, vec3(12.0));
            weight *= exp(-dot(color - centerColor, color - centerColor) * colorSharpness);
            sum += color * weight;
            total += weight;
          }
          gl_FragColor = vec4(sum / max(total, 0.0001), 1.0);
        }`,
    });
    this.temporalMaterial = new THREE.ShaderMaterial({
      vertexShader: screenVertex, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        current: { value: this.filtered.texture }, rawRadiance: { value: null }, history: { value: null },
        guide: { value: null }, previousGuide: { value: null }, depth: { value: null }, previousDepth: { value: null },
        inverseViewProjection: { value: this.inverseViewProjection }, previousViewProjection: { value: this.previousViewProjection },
        previousInverseViewProjection: { value: this.previousInverseViewProjection },
        cameraPositionNow: { value: new THREE.Vector3() }, cameraPositionBefore: { value: this.previousCameraPosition },
        pixelSize: { value: new THREE.Vector2(1 / width, 1 / height) }, validHistory: { value: false },
        background: { value: new THREE.Color() },
      },
      fragmentShader: `varying vec2 vUv;
        uniform sampler2D current, rawRadiance, history, guide, previousGuide, depth, previousDepth;
        uniform mat4 inverseViewProjection, previousViewProjection, previousInverseViewProjection;
        uniform vec3 cameraPositionNow, cameraPositionBefore, background;
        uniform vec2 pixelSize; uniform bool validHistory;
        vec3 positionAt(vec2 uv, float z, mat4 inverseVP) {
          vec4 p = inverseVP * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); return p.xyz / p.w;
        }
        vec4 sampleHistory(vec2 uv) {
          // Cubic reconstruction avoids repeatedly softening a moving highlight with bilinear resampling.
          vec2 size = vec2(textureSize(history, 0));
          vec2 p = uv * size, p1 = floor(p - 0.5) + 0.5, f = p - p1;
          vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
          vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
          vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
          vec2 w3 = f * f * (-0.5 + 0.5 * f);
          vec2 w12 = w1 + w2;
          vec2 p0 = (p1 - 1.0) / size, p3 = (p1 + 2.0) / size;
          vec2 p12 = (p1 + w2 / w12) / size;
          vec4 c = texture2D(history, vec2(p0.x, p0.y)) * w0.x * w0.y;
          c += texture2D(history, vec2(p12.x, p0.y)) * w12.x * w0.y;
          c += texture2D(history, vec2(p3.x, p0.y)) * w3.x * w0.y;
          c += texture2D(history, vec2(p0.x, p12.y)) * w0.x * w12.y;
          c += texture2D(history, vec2(p12.x, p12.y)) * w12.x * w12.y;
          c += texture2D(history, vec2(p3.x, p12.y)) * w3.x * w12.y;
          c += texture2D(history, vec2(p0.x, p3.y)) * w0.x * w3.y;
          c += texture2D(history, vec2(p12.x, p3.y)) * w12.x * w3.y;
          c += texture2D(history, vec2(p3.x, p3.y)) * w3.x * w3.y;
          return max(c, vec4(0.0));
        }
        void main() {
          vec4 surface = texture2D(guide, vUv);
          if (surface.a < 0.1) { gl_FragColor = vec4(background, 0.0); return; }
          vec3 color = texture2D(current, vUv).rgb;
          vec3 world = positionAt(vUv, texture2D(depth, vUv).r, inverseViewProjection);
          vec4 oldClip = previousViewProjection * vec4(world, 1.0);
          vec2 oldUV = oldClip.xy / oldClip.w * 0.5 + 0.5;
          float count = 1.0;
          bool inside = all(greaterThan(oldUV, vec2(0.0))) && all(lessThan(oldUV, vec2(1.0))) && oldClip.w > 0.0;
          if (validHistory && inside) {
            vec4 oldSurface = texture2D(previousGuide, oldUV);
            vec3 oldWorld = positionAt(oldUV, texture2D(previousDepth, oldUV).r, previousInverseViewProjection);
            float normalMatch = dot(normalize(surface.rgb * 2.0 - 1.0), normalize(oldSurface.rgb * 2.0 - 1.0));
            if (abs(oldSurface.a - surface.a) < 0.1 && normalMatch > 0.96 && distance(world, oldWorld) < 0.035) {
              vec4 old = sampleHistory(oldUV);
              // Once history is reliable, accumulate unblurred samples. Spatial filtering is only a fallback.
              color = mix(color, texture2D(rawRadiance, vUv).rgb, smoothstep(2.0, 8.0, old.a));
              // Limit stale reflections using local color variation, not an all-image blur.
              vec3 mean = vec3(0.0), second = vec3(0.0); float total = 0.0;
              for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
                vec2 uv = vUv + vec2(float(x), float(y)) * pixelSize * 1.5;
                if (abs(texture2D(guide, uv).a - surface.a) > 0.1) continue;
                vec3 c = texture2D(rawRadiance, uv).rgb; mean += c; second += c * c; total += 1.0;
              }
              mean /= max(total, 1.0);
              vec3 deviation = sqrt(max(second / max(total, 1.0) - mean * mean, vec3(0.0)));
              vec3 historyColor = clamp(old.rgb, max(vec3(0.0), mean - 2.5 * deviation - 0.12), mean + 2.5 * deviation + 0.12);
              float angle = acos(clamp(dot(normalize(cameraPositionNow - world), normalize(cameraPositionBefore - world)), -1.0, 1.0));
              float maxWeight = surface.a > 0.9 ? 0.80 : surface.a < 0.5 ? 0.94 : 0.96;
              float weight = min(old.a / (old.a + 1.0), maxWeight) * exp(-angle * (surface.a > 0.9 ? 12.0 : 5.0));
              color = mix(color, historyColor, weight); count = min(old.a + 1.0, 32.0);
            }
          }
          gl_FragColor = vec4(color, count);
        }`,
    });
    this.copyMaterial = new THREE.ShaderMaterial({
      vertexShader: screenVertex, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { map: { value: null }, count: { value: 32 } },
      fragmentShader: `varying vec2 vUv; uniform sampler2D map; uniform float count;
        void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, count); }`,
    });
    this.displayMaterial = new THREE.ShaderMaterial({
      vertexShader: screenVertex, depthTest: false, depthWrite: false,
      uniforms: { map: { value: null } },
      fragmentShader: `varying vec2 vUv; uniform sampler2D map;
        void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.quad = new FullScreenQuad(this.filterMaterial);
  }

  reset() { this.valid = false; this.guidePoses = [null, null]; this.needsInitialization = true; }
  resize(width, height) {
    [...this.guides, ...this.history, this.filtered].forEach(t => t.setSize(width, height));
    this.filterMaterial.uniforms.pixelSize.value.set(1 / width, 1 / height);
    this.temporalMaterial.uniforms.pixelSize.value.set(1 / width, 1 / height);
    this.reset();
  }
  prepare(renderer, camera) {
    // Allocate both sides before binding their depth textures as shader inputs.
    // Sampling a resized, not-yet-created depth attachment can invalidate a guide buffer.
    if (this.needsInitialization) {
      const previousTarget = renderer.getRenderTarget();
      renderer.getClearColor(this.clearColor); const alpha = renderer.getClearAlpha();
      renderer.setClearColor(0, 0);
      for (const target of [...this.guides, ...this.history, this.filtered]) {
        renderer.setRenderTarget(target); renderer.clear(true, true, false);
      }
      renderer.setClearColor(this.clearColor, alpha); renderer.setRenderTarget(previousTarget);
      this.needsInitialization = false;
    }
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.inverseViewProjection.copy(this.viewProjection).invert();
    const write = 1 - this.read;
    if (!this.guidePoses[write]?.equals(this.viewProjection)) {
      renderer.getClearColor(this.clearColor); const alpha = renderer.getClearAlpha();
      renderer.setClearColor(0, 0); renderer.setRenderTarget(this.guides[write]);
      renderer.render(this.scene, camera); renderer.setClearColor(this.clearColor, alpha);
      this.guidePoses[write] = this.viewProjection.clone();
    }
    return write;
  }
  commit(camera, write) {
    this.previousViewProjection.copy(this.viewProjection);
    this.previousInverseViewProjection.copy(this.inverseViewProjection);
    this.previousCameraPosition.copy(camera.position); this.read = write; this.valid = true;
  }
  seed(renderer, camera, texture, samples) {
    const previousTarget = renderer.getRenderTarget(); const write = this.prepare(renderer, camera);
    this.copyMaterial.uniforms.map.value = texture;
    this.copyMaterial.uniforms.count.value = Math.min(samples, 32);
    renderer.setRenderTarget(this.history[write]); this.quad.material = this.copyMaterial; this.quad.render(renderer);
    this.commit(camera, write); renderer.setRenderTarget(previousTarget); this.seedFrames++;
  }
  render(renderer, camera, texture, background, motionScale) {
    const previousTarget = renderer.getRenderTarget(); const write = this.prepare(renderer, camera);
    const f = this.filterMaterial.uniforms;
    f.radiance.value = texture; f.guide.value = this.guides[write].texture;
    f.depth.value = this.guides[write].depthTexture; f.stride.value = 0.8 / motionScale;
    f.colorSharpness.value = 0;
    renderer.setRenderTarget(this.filtered); this.quad.material = this.filterMaterial; this.quad.render(renderer);
    const u = this.temporalMaterial.uniforms;
    u.rawRadiance.value = texture;
    u.history.value = this.history[this.read].texture; u.guide.value = this.guides[write].texture;
    u.previousGuide.value = this.guides[this.read].texture; u.depth.value = this.guides[write].depthTexture;
    u.previousDepth.value = this.guides[this.read].depthTexture; u.validHistory.value = this.valid;
    u.background.value.copy(background); u.cameraPositionNow.value.copy(camera.position);
    renderer.setRenderTarget(this.history[write]); this.quad.material = this.temporalMaterial; this.quad.render(renderer);
    // A one-pixel edge-preserving resolve removes residual grain without feeding blur back into history.
    f.radiance.value = this.history[write].texture; f.stride.value = 0.8; f.colorSharpness.value = 12;
    renderer.setRenderTarget(this.filtered); this.quad.material = this.filterMaterial; this.quad.render(renderer);
    this.displayMaterial.uniforms.map.value = this.filtered.texture;
    renderer.setRenderTarget(previousTarget); this.quad.material = this.displayMaterial; this.quad.render(renderer);
    this.commit(camera, write); this.temporalFrames++;
  }
  dispose() {
    [...this.guides, ...this.history, this.filtered].forEach(t => { t.depthTexture?.dispose(); t.dispose(); });
    [...this.guideMaterials, this.filterMaterial, this.temporalMaterial, this.copyMaterial, this.displayMaterial].forEach(m => m.dispose());
    this.quad.dispose();
  }
}
