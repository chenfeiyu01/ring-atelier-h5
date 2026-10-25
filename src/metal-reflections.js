import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH, MeshBVHUniformStruct, FloatVertexAttributeTexture, shaderStructs, shaderIntersectFunction, SAH } from 'three-mesh-bvh';

// The visible mesh stays untouched. These smooth, generated assets can use a
// coarser intersection mesh for blurred secondary reflections.
export function reflectionProxy(source) {
  const grain = /pave.grain/i.test(source.name);
  if (grain || /polished silver bead/i.test(source.material.name)) {
    source.geometry.computeBoundingSphere();
    const sphere = source.geometry.boundingSphere;
    return new THREE.SphereGeometry(sphere.radius, grain ? 8 : 24, grain ? 6 : 16).translate(sphere.center.x, sphere.center.y, sphere.center.z);
  }
  const position = source.geometry.getAttribute('position');
  if (/gold.shank/i.test(source.name) && position.count === 640 * 164) {
    // scripts/build_ring.py: 640 closed sweeps of a 164-point closed contour.
    const normal = source.geometry.getAttribute('normal');
    const points = [], normals = [], indices = [];
    const n = 160, m = 82;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const id = i * 4 * 164 + j * 2;
      points.push(position.getX(id), position.getY(id), position.getZ(id));
      normals.push(normal.getX(id), normal.getY(id), normal.getZ(id));
      const a = i * m + j, b = ((i + 1) % n) * m + j;
      const c = ((i + 1) % n) * m + (j + 1) % m, d = i * m + (j + 1) % m;
      // Blender's normals_make_consistent flips the source builder's winding.
      indices.push(a, c, d, a, b, c);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices); return geometry;
  }
  return source.geometry.clone();
}

// One deterministic reflection intersection fills the gap between distant IBL
// and the full path tracer: silver beads can actually reflect their setting.
export class MetalReflections {
  constructor(meshes, width, height) {
    this.sources = [];
    this.materials = [];
    const geometries = meshes.map(mesh => {
      let id = this.sources.indexOf(mesh.material);
      if (id < 0) { id = this.sources.length; this.sources.push(mesh.material); }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', mesh.geometry.getAttribute('position'));
      geometry.setIndex(mesh.geometry.index);
      const normals = mesh.geometry.getAttribute('normal');
      const data = new Float32Array(normals.count * 4);
      for (let i = 0; i < normals.count; i++) {
        data.set([normals.getX(i), normals.getY(i), normals.getZ(i), id], i * 4);
      }
      geometry.setAttribute('surfaceNormal', new THREE.BufferAttribute(data, 4));
      return geometry;
    });
    const geometry = mergeGeometries(geometries);
    this.triangles = geometry.index.count / 3;
    geometries.forEach(g => g.dispose());
    const tree = new MeshBVH(geometry, { strategy: SAH, maxLeafTris: 4, maxDepth: 32 });
    this.bvh = new MeshBVHUniformStruct(); this.bvh.updateFrom(tree);
    this.normals = new FloatVertexAttributeTexture();
    this.normals.updateFrom(geometry.getAttribute('surfaceNormal'));
    geometry.dispose();
    this.properties = this.sources.map(() => new THREE.Vector4());
    this.uniforms = {
      localScene: { value: this.bvh }, localNormals: { value: this.normals },
      localProperties: { value: this.properties },
      reflectionMap: { value: null }, reflectionResolution: { value: new THREE.Vector2() },
      fullResolution: { value: new THREE.Vector2(width, height) },
    };
    this.scene = new THREE.Scene();
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.uniforms.reflectionMap.value = this.target.texture;
    this.resize(width, height);
    meshes.forEach(mesh => this.scene.add(new THREE.Mesh(mesh.geometry, this.material(mesh.material, true))));
  }
  resize(width, height) {
    // Only secondary reflections use this budget. Silhouettes, primary shading
    // and gemstone optics retain the full output resolution.
    const budget = this.triangles > 100000 ? 24000 : 48000;
    const scale = Math.min(0.5, Math.sqrt(budget / (width * height)));
    const w = Math.max(1, Math.ceil(width * scale)), h = Math.max(1, Math.ceil(height * scale));
    this.target.setSize(w, h);
    this.uniforms.reflectionResolution.value.set(w, h);
    this.uniforms.fullResolution.value.set(width, height);
  }
  material(source, trace = false) {
    const material = source.clone();
    material.defines = { ...material.defines, BVH_STACK_DEPTH: 48 };
    material.customProgramCacheKey = () => `jewelry-local-reflection-${trace}-${this.sources.length}`;
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 localReflectionPosition;')
        .replace('#include <project_vertex>', 'localReflectionPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 localReflectionPosition;
        ${trace ? `
        precision highp usampler2D;
        precision highp isampler2D;
        ${shaderStructs}
        ${shaderIntersectFunction}
        uniform BVH localScene;
        uniform sampler2D localNormals;
        uniform vec4 localProperties[${this.sources.length}];
        vec3 localHitRadiance = vec3(0.0);
        bool localHit = false;
        ` : `
        uniform sampler2D reflectionMap;
        uniform vec2 reflectionResolution, fullResolution;
        vec3 resolveLocalReflection(vec3 environment) {
          vec2 p = gl_FragCoord.xy / fullResolution * reflectionResolution - 0.5;
          vec2 cell = floor(p + 0.5), f = p - cell;
          float depth = -(viewMatrix * vec4(localReflectionPosition, 1.0)).z;
          vec3 sum = vec3(0.0); float total = 0.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y));
            vec4 sampleValue = texture2D(reflectionMap, (cell + offset + 0.5) / reflectionResolution);
            float tolerance = max(0.008, depth * 0.002);
            float weight = exp(-dot(offset - f, offset - f) * 1.5)
              * (1.0 - smoothstep(tolerance, tolerance * 3.0, abs(abs(sampleValue.a) - depth)));
            sum += (sampleValue.a > 0.0 ? sampleValue.rgb : environment) * weight;
            total += weight;
          }
          return total > 0.001 ? sum / total : environment;
        }
        `}
      `);
      const anchor = 'return envMapColor.rgb * envMapIntensity;';
      const environment = THREE.ShaderChunk.envmap_physical_pars_fragment;
      const start = environment.indexOf('vec3 getIBLRadiance(');
      const replacement = trace ? `
        uvec4 indices = uvec4(0u);
        vec3 faceNormal = vec3(0.0), barycoord = vec3(0.0);
        float side = 1.0, distanceHit = 0.0;
        vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
        vec3 origin = localReflectionPosition + worldNormal * 0.001;
        if (bvhIntersectFirstHit(localScene, origin, reflectVec, indices, faceNormal, barycoord, side, distanceHit)) {
          vec4 surface = textureSampleBarycoord(localNormals, barycoord, indices.xyz);
          vec3 hitNormal = normalize(surface.xyz);
          if (dot(hitNormal, reflectVec) > 0.0) hitNormal = -hitNormal;
          vec4 properties = localProperties[int(floor(surface.w + 0.5))];
          vec3 f0 = properties.rgb;
          float cosine = clamp(-dot(reflectVec, hitNormal), 0.0, 1.0);
          vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - cosine, 5.0);
          vec3 exitDirection = reflect(reflectVec, hitNormal);
          // Combine the two rough specular lobes instead of adding random rays.
          float exitRoughness = min(1.0, sqrt(roughness * roughness + properties.a * properties.a));
          vec3 reflected = textureCubeUV(envMap, envMapRotation * exitDirection, exitRoughness).rgb;
          localHit = true;
          localHitRadiance = reflected * fresnel * envMapIntensity;
          return localHitRadiance;
        }
        ${anchor}
      ` : 'return resolveLocalReflection(envMapColor.rgb * envMapIntensity);';
      const modified = environment.slice(0, start) + environment.slice(start).replace(anchor, replacement);
      shader.fragmentShader = shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>', modified);
      if (trace) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
          float depth = -(viewMatrix * vec4(localReflectionPosition, 1.0)).z;
          gl_FragColor = vec4(localHitRadiance, (localHit ? 1.0 : -1.0) * depth);
        `);
      }
    };
    this.materials.push({ source, material });
    return material;
  }
  update() {
    this.sources.forEach((source, i) => this.properties[i].set(source.color.r, source.color.g, source.color.b, source.roughness));
    this.materials.forEach(({ source, material }) => {
      material.color.copy(source.color); material.roughness = source.roughness;
      material.envMapIntensity = source.envMapIntensity;
    });
  }
  render(renderer, camera, environment) {
    this.scene.environment = environment;
    const previous = renderer.getRenderTarget();
    const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    renderer.setClearColor(0, 0); renderer.setRenderTarget(this.target);
    renderer.render(this.scene, camera);
    renderer.setClearColor(color, alpha); renderer.setRenderTarget(previous);
  }
  dispose() {
    this.bvh.dispose(); this.normals.dispose(); this.materials.forEach(({ material }) => material.dispose());
    this.target.dispose(); this.scene.clear();
  }
}
