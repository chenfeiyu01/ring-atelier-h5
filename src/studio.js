import * as THREE from 'three';

// Finite softboxes and dark gaps give polished surfaces a readable reflection
// gradient instead of lighting an entire hemisphere at the same brightness.
// Generate once per preset; changing the camera adds no lighting work.
export function createStudio(preset = 'black', diamond = false) {
  const width = 1024, height = 512;
  const data = new Float32Array(width * height * 4);
  const soft = preset === 'soft', warm = preset === 'warm';
  const d = new THREE.Vector3();
  const panels = [
    [[-0.55, 0.82, 0.24], 0.85, 0.65, 2.8],
    [[-0.90, 0.14, 0.42], 0.18, 0.90, 0.8],
    [[0.84, 0.30, 0.44], 0.24, 0.85, 1.1],
    [[0.15, 0.58, -0.80], 0.70, 0.35, 1.7],
    [[0.10, -0.95, 0.28], 0.85, 0.65, 0.65],
    [[0.0, 0.15, 1.0], 0.65, 0.65, soft ? 0.60 : 0.24],
  ].map(([direction, w, h, power]) => {
    const n = new THREE.Vector3(...direction).normalize();
    const up = new THREE.Vector3(0, Math.abs(n.y) > 0.9 ? 0 : 1, Math.abs(n.y) > 0.9 ? 1 : 0);
    const u = new THREE.Vector3().crossVectors(up, n).normalize();
    return { n, u, v: new THREE.Vector3().crossVectors(n, u), w, h, power };
  });
  const sparkle = [
    [new THREE.Vector3(-0.55, 0.72, 0.42).normalize(), 12],
    [new THREE.Vector3(0.83, 0.22, 0.51).normalize(), 8],
    [new THREE.Vector3(-0.23, -0.35, 0.91).normalize(), 6],
  ];
  const smooth = THREE.MathUtils.smoothstep;
  for (let y = 0; y < height; y++) {
    const phi = (y + 0.5) / height * Math.PI;
    for (let x = 0; x < width; x++) {
      const theta = (x + 0.5) / width * Math.PI * 2 - Math.PI;
      d.set(Math.sin(phi) * Math.cos(theta), -Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      const elevation = 0.97 * d.y + 0.20 * d.x + 0.12 * d.z;
      let energy = (soft ? 0.12 : 0.025) + smooth(elevation, -0.2, 0.6) * (soft ? 0.22 : 0.10);
      for (const panel of panels) {
        const facing = d.dot(panel.n);
        if (facing <= 0) continue;
        const x = Math.abs(d.dot(panel.u) / facing);
        const y = Math.abs(d.dot(panel.v) / facing);
        const feather = soft ? 0.50 : 0.35;
        energy += panel.power * (1 - smooth(x, panel.w * (1 - feather), panel.w))
          * (1 - smooth(y, panel.h * (1 - feather), panel.h));
      }
      // Small neutral studio panels reveal the cut and wavelength-dependent fire.
      // They are part of the HDR environment, not painted highlights on the gem.
      if (diamond) for (const [direction, power] of sparkle) energy += power * Math.exp((d.dot(direction) - 1) / 0.004);
      const i = (y * width + x) * 4;
      data[i] = energy * (warm ? 1.10 : 1);
      data[i+1] = energy * (warm ? 0.89 : 1);
      data[i+2] = energy * (warm ? 0.67 : 1);
      data[i+3] = 1;
    }
  }
  const texture = new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
