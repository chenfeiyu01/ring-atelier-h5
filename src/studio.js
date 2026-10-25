import * as THREE from 'three';

// Wide studio diffusion panels. Linear HDR values; no external texture requests.
// A broad upper diffuser and a lower bounce card create a soft horizontal band
// on the silver beads, rather than the sharp multi-window reflections of chrome.
export function createStudio(preset = 'black', diamond = false) {
  const width = 1024, height = 512;
  const data = new Float32Array(width * height * 4);
  const soft = preset === 'soft', warm = preset === 'warm';
  const d = new THREE.Vector3();
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
      // Tilt the studio's horizon slightly for broad flowing reflections on the gold.
      const elevation = 0.97 * d.y + 0.20 * d.x + 0.12 * d.z;
      const upper = smooth(elevation, soft ? -0.12 : 0.20, 0.42) * 1.1;
      const lower = (1-smooth(elevation, -0.62, soft ? -0.03 : -0.37)) * 0.55;
      const softSide = Math.exp(-((d.x + 0.78)**2 / 0.1 + d.y**2 / 0.9 + (d.z - 0.55)**2 / 0.24)) * 0.35;
      let energy = (soft ? 0.18 : 0.025) + upper + lower + softSide;
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
