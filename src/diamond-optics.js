// The pinned WebGL tracer predates MeshPhysicalMaterial.dispersion support.
// Choose one RGB band at the first diamond hit and retain that wavelength for
// the complete path. Each band has probability 1/3, compensated in throughput.
// This is a three-band approximation, not full spectral colorimetry.
export function installDiamondDispersion(tracer) {
  const material = tracer._pathTracer.material;
  const sampleAnchor = 'ScatterRecord bsdfSample( vec3 worldWo, SurfaceRecord surf ) {';
  if (!material.fragmentShader.includes(sampleAnchor)) throw new Error('Unsupported BSDF shader layout');
  // Optically polished diamond and sapphire facets use an ideal dielectric BSDF. Fresnel chooses
  // reflection or refraction; total internal reflection is handled explicitly.
  // This also avoids the generic rough-transmission path that renders dark in WebKit.
  material.fragmentShader = material.fragmentShader.replace(sampleAnchor, `${sampleAnchor}
    #if DIAMOND_OPTICS
    if (surf.transmission > 0.9 && surf.ior > 1.5) {
      vec3 incident = -normalize(worldWo);
      vec3 n = normalize(surf.normal);
      float cosI = clamp(-dot(incident, n), 0.0, 1.0);
      float eta = surf.eta;
      float sinT2 = eta * eta * max(0.0, 1.0 - cosI * cosI);
      float cosT = sqrt(max(0.0, 1.0 - sinT2));
      float rs = (eta * cosI - cosT) / max(eta * cosI + cosT, 0.000001);
      float rp = (cosI - eta * cosT) / max(cosI + eta * cosT, 0.000001);
      float fresnel = sinT2 >= 1.0 ? 1.0 : clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
      bool reflected = rand(15) < fresnel;
      ScatterRecord gem;
      gem.direction = reflected ? reflect(incident, n)
        : normalize(eta * incident + (eta * cosI - cosT) * n);
      gem.pdf = reflected ? fresnel : 1.0 - fresnel;
      gem.specularPdf = reflected ? gem.pdf : 0.0;
      gem.color = vec3(gem.pdf);
      return gem;
    }
    #endif
  `);
  const stateAnchor = 'RenderState state = initRenderState();';
  const hitAnchor = 'Material material = readMaterialInfo( materials, materialIndex );';
  const mainStart = material.fragmentShader.lastIndexOf('void main()');
  const declarations = material.fragmentShader.slice(0, mainStart);
  const main = material.fragmentShader.slice(mainStart);
  if (mainStart < 0 || !main.includes(stateAnchor) || !main.includes(hitAnchor)) {
    throw new Error('Diamond optics require the pinned path-tracer shader layout');
  }
  material.fragmentShader = declarations + main
    .replace(stateAnchor, `${stateAnchor}\n#if DIAMOND_OPTICS\nint diamondChannel = -1;\n#endif`)
    .replace(hitAnchor, `${hitAnchor}
      #if DIAMOND_OPTICS
      if (material.transmission > 0.9 && material.ior > 2.3) {
        if (diamondChannel < 0) {
          diamondChannel = int((uint(seed) + uint(gl_FragCoord.x) + uint(gl_FragCoord.y)) % 3u);
          vec3 band = diamondChannel == 0 ? vec3(3.0, 0.0, 0.0)
            : diamondChannel == 1 ? vec3(0.0, 3.0, 0.0) : vec3(0.0, 0.0, 3.0);
          state.throughputColor *= band;
        }
        // Approximate red, green and blue diamond indices around nD = 2.417.
        material.ior = diamondChannel == 0 ? 2.410 : diamondChannel == 1 ? 2.417 : 2.435;
      }
      #endif`);
  material.setDefine('DIAMOND_OPTICS', 0);
  material.needsUpdate = true;
}

export function setDiamondOpticsEnabled(tracer, enabled) {
  // Keep the silver-only shader as small as it was before adding refraction.
  tracer._pathTracer.material.setDefine('DIAMOND_OPTICS', enabled ? 1 : 0);
}
