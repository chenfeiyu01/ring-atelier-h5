import * as THREE from 'three';
import { MeshBVH, MeshBVHUniformStruct, shaderStructs, shaderIntersectFunction, SAH } from 'three-mesh-bvh';

// Reuse one local-space acceleration structure across every copy of a cut.
// Clone the geometry because BVH construction may reorder its index buffer.
export function createGemBounds(geometry) {
  const copy = geometry.clone();
  copy.clearGroups();
  const bvh = new MeshBVH(copy, { strategy: SAH, maxLeafTris: 4, maxDepth: 16 });
  const uniform = new MeshBVHUniformStruct();
  uniform.updateFrom(bvh);
  copy.dispose();
  geometry.computeBoundingSphere();
  return { uniform, epsilon: Math.max(geometry.boundingSphere.radius * 0.0001, 0.000001) };
}

export function createGemPreviewMaterial(source, bounds) {
  const diamond = source.ior > 2.3;
  const absorption = source.attenuationColor.clone();
  // Beer-Lambert absorption, in the same world units as the original material.
  absorption.setRGB(...absorption.toArray().map(c => -Math.log(Math.max(c, 0.0001)) / source.attenuationDistance));
  return new THREE.ShaderMaterial({
    name: `Realtime ${source.name}`,
    side: THREE.FrontSide,
    defines: { BVH_STACK_DEPTH: 32, GEM_BOUNCES: 8, GEM_DISPERSION: diamond ? 1 : 0 },
    uniforms: {
      bvh: { value: bounds.uniform }, environment: { value: null },
      indices: { value: new THREE.Vector3(...(diamond ? [2.410, 2.417, 2.435] : [source.ior, source.ior, source.ior])) },
      absorption: { value: absorption }, rayEpsilon: { value: bounds.epsilon },
    },
    vertexShader: /* glsl */`
      varying vec3 localPosition, localNormal, localEye;
      varying mat3 localToWorld;
      void main() {
        mat4 worldMatrix = modelMatrix;
        #ifdef USE_INSTANCING
          worldMatrix = modelMatrix * instanceMatrix;
        #endif
        localPosition = position;
        localNormal = normal;
        localEye = (inverse(worldMatrix) * vec4(cameraPosition, 1.0)).xyz;
        localToWorld = mat3(worldMatrix);
        gl_Position = projectionMatrix * viewMatrix * worldMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp isampler2D;
      precision highp usampler2D;
      ${shaderStructs}
      ${shaderIntersectFunction}
      uniform BVH bvh;
      uniform sampler2D environment;
      uniform vec3 indices, absorption;
      uniform float rayEpsilon;
      varying vec3 localPosition, localNormal, localEye;
      varying mat3 localToWorld;

      vec3 environmentAt(vec3 direction) {
        vec3 d = normalize(localToWorld * direction);
        vec2 uv = vec2(atan(d.z, d.x) / 6.28318530718 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
        return texture2D(environment, uv).rgb;
      }
      float fresnelDielectric(float cosine, float eta) {
        float sinT2 = eta * eta * max(0.0, 1.0 - cosine * cosine);
        if (sinT2 >= 1.0) return 1.0;
        float cosT = sqrt(max(0.0, 1.0 - sinT2));
        float rs = (eta * cosine - cosT) / max(eta * cosine + cosT, 0.000001);
        float rp = (cosine - eta * cosT) / max(cosine + eta * cosT, 0.000001);
        return clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
      }
      vec3 traceGem(vec3 incident, vec3 normal, float ior) {
        float entryF = fresnelDielectric(clamp(-dot(incident, normal), 0.0, 1.0), 1.0 / ior);
        vec3 radiance = entryF * environmentAt(reflect(incident, normal));
        vec3 direction = refract(incident, normal, 1.0 / ior);
        vec3 origin = localPosition + direction * rayEpsilon;
        vec3 throughput = vec3(1.0 - entryF);
        for (int bounce = 0; bounce < GEM_BOUNCES; bounce++) {
          uvec4 faceIndices = uvec4(0u);
          vec3 normalHit = vec3(0.0), barycoord = vec3(0.0);
          float side = 1.0, distanceHit = 0.0;
          if (!bvhIntersectFirstHit(bvh, origin, direction, faceIndices, normalHit, barycoord, side, distanceHit)) break;
          vec3 hit = origin + direction * distanceHit;
          float worldDistance = length(localToWorld * (direction * distanceHit));
          throughput *= exp(-absorption * worldDistance);
          float reflection = fresnelDielectric(clamp(-dot(direction, normalHit), 0.0, 1.0), ior);
          if (reflection < 1.0) {
            radiance += throughput * (1.0 - reflection) * environmentAt(refract(direction, normalHit, ior));
          }
          throughput *= reflection;
          if (max(throughput.r, max(throughput.g, throughput.b)) < 0.002) break;
          direction = reflect(direction, normalHit);
          origin = hit + direction * rayEpsilon;
        }
        // Residual energy at the bounce limit is omitted, never turned into a fake exit ray.
        return radiance;
      }
      void main() {
        vec3 incident = normalize(localPosition - localEye);
        vec3 normal = normalize(localNormal);
        #if GEM_DISPERSION
          // Evaluate all three bands every frame: no randomly missing RGB channels.
          vec3 color = vec3(traceGem(incident, normal, indices.r).r,
                            traceGem(incident, normal, indices.g).g,
                            traceGem(incident, normal, indices.b).b);
        #else
          vec3 color = traceGem(incident, normal, indices.g);
        #endif
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
