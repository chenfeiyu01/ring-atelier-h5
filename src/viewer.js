import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStudio } from './studio.js';
import { MotionDenoiser } from './motion-denoise.js';
import { installDiamondDispersion, setDiamondOpticsEnabled } from './diamond-optics.js';
const FINAL_SAMPLES = 192;

// All iOS browsers and desktop Safari use Apple's WebKit shader compiler.
// three-gpu-pathtracer 0.0.24 clearcoat produces black radiance there (#711).
// Diamond mode also disables this optional layer: the combined dielectric
// shader reproduces the same clearcoat failure in Chromium on this Apple GPU.
const APPLE_WEBKIT = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR|Android/.test(navigator.userAgent));

/** Reusable viewer. All asset paths are resolved relative to the current app. */
export class RingViewer {
  constructor(container, { onStatus = () => {}, onInteraction = () => {} } = {}) {
    this.container = container; this.onStatus = onStatus; this.onInteraction = onInteraction;
    this.quality = 'fine'; this.lighting = 'black'; this.inlay = 'silver'; this.ready = false; this.disposed = false; this.suspended = false;
    this.lastChange = 0; this.dirty = true; this.frameCount = 0; this.frameTimes = [];
    this.rasterFrames = 0; this.pathTracedFrames = 0; this.motionTraceFrames = 0;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000);
    this.renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
      console.error('Ring shader failed', gl.getProgramInfoLog(program),
        gl.getShaderInfoLog(vertexShader), gl.getShaderInfoLog(fragmentShader));
      this.failed = true; this.suspended = true;
      this.onStatus('精细光影加载失败，请刷新重试。', 'error');
    };
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', '戒指三维模型：拖拽旋转，双指或滚轮缩放，也可用方向键旋转');
    this.canvas.tabIndex = 0;
    container.append(this.canvas);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
    this.controls = new OrbitControls(this.camera, this.canvas);
    // Accumulate immediately at the released pose instead of resetting through a long inertial tail.
    this.controls.enableDamping = false;
    this.controls.enablePan = false; this.controls.rotateSpeed = 0.6; this.controls.zoomSpeed = 0.7;
    this.controls.minDistance = 3.9; this.controls.maxDistance = 14;
    this.controls.autoRotate = false;
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => { this.onInteraction(); });
    if (import.meta.env.DEV) this.controls.addEventListener('end', () => {
      this.releasedAt = performance.now(); this.recoveryTimes = {};
    });
    this.keyHandler = e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '=', 'Home'].includes(e.key)) return;
      e.preventDefault();
      if (e.key.startsWith('Arrow')) this.onInteraction();
      const s = new THREE.Spherical().setFromVector3(this.camera.position);
      if (e.key === 'ArrowLeft') s.theta -= 0.12;
      if (e.key === 'ArrowRight') s.theta += 0.12;
      if (e.key === 'ArrowUp') s.phi -= 0.12;
      if (e.key === 'ArrowDown') s.phi += 0.12;
      if (e.key === '+' || e.key === '=') s.radius *= 0.9;
      if (e.key === '-') s.radius *= 1.1;
      s.makeSafe(); s.radius = THREE.MathUtils.clamp(s.radius, this.controls.minDistance, this.controls.maxDistance);
      this.camera.position.setFromSpherical(s); this.controls.update();
      if (e.key === 'Home') this.setView('hero');
    };
    this.canvas.addEventListener('keydown', this.keyHandler);
    this.lostHandler = e => { e.preventDefault(); this.suspended = true; this.onStatus('画面暂时中断，请刷新后重试', 'error'); };
    this.canvas.addEventListener('webglcontextlost', this.lostHandler);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container);
    this.setView('hero'); this.resize(); this.setLighting('black');
    this.tick = this.tick.bind(this); this.raf = requestAnimationFrame(this.tick);
  }
  async load() {
    this.onStatus('正在加载戒指…', 'loading');
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/ring.glb`);
    if (this.disposed) return;
    this.model = gltf.scene;
    this.model.rotation.z = -0.23;
    this.beads = [];
    this.metalClearcoat = new Map();
    this.model.traverse(o => {
      if (!o.isMesh) return;
      if (/silver/i.test(o.material.name)) this.beads.push(o);
      o.material.envMapIntensity = 1;
      if (!this.metalClearcoat.has(o.material)) this.metalClearcoat.set(o.material, o.material.clearcoat || 0);
      o.material.clearcoat = APPLE_WEBKIT ? 0 : this.metalClearcoat.get(o.material);
      // Imported colors are scene-linear and remain physically based.
      o.material.side = THREE.FrontSide;
    });
    this.scene.add(this.model); this.scene.updateMatrixWorld(true);
    await this.prepareFine();
    if (this.disposed) return;
    this.ready = true; this.invalidate(); this.onStatus('', 'ready');
  }
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8, Math.sqrt(2200000 / (width * height))));
    this.renderer.setSize(width, height);
    if (this.fineTarget) this.fineTarget.setSize(this.canvas.width, this.canvas.height);
    this.motionDenoiser?.resize(this.canvas.width, this.canvas.height);
    if (this.tracer) this.tracer.lowResScale = this.motionResolutionScale();
    this.camera.aspect = width / height;
    // Preserve comfortable margins in tall and narrow H5 containers.
    this.camera.fov = width / height < 0.85 ? 36 : 32;
    this.camera.updateProjectionMatrix(); this.invalidate();
  }
  invalidate() {
    this.lastChange = performance.now(); this.dirty = true;
    if (this.tracer) this.tracer.updateCamera();
  }
  motionResolutionScale() {
    // Keep the same eight-bounce light transport while reducing the number of
    // traced pixels during interaction. Full resolution still converges at rest.
    return THREE.MathUtils.clamp(Math.sqrt(480000 / (this.canvas.width * this.canvas.height)), 0.4, 1);
  }
  setView(view) {
    const positions = { hero: [-4.7, 1.9, 6.0], front: [0, 0, 8.2], side: [8.1, 0.6, 0.7] };
    this.camera.position.set(...(positions[view] || positions.hero));
    this.controls.target.set(0, 0, 0); this.controls.update(); this.invalidate();
  }
  zoom(direction) {
    const distance = THREE.MathUtils.clamp(this.camera.position.length() * (direction > 0 ? 0.85 : 1.18), 3.9, 14);
    this.camera.position.setLength(distance); this.controls.update(); this.invalidate();
  }
  setLighting(preset) {
    this.lighting = preset;
    this.environments ||= new Map();
    const key = `${preset}-${this.inlay}`;
    if (!this.environments.has(key)) this.environments.set(key, createStudio(preset, this.inlay === 'diamond'));
    this.scene.environment = this.environments.get(key);
    this.scene.background.set(preset === 'soft' ? 0x171717 : 0x000000);
    if (this.tracer) this.tracer.updateEnvironment();
    this.motionDenoiser?.reset();
    this.invalidate();
  }
  async setInlay(inlay) {
    if (!this.ready || this.changingInlay || inlay === this.inlay || !['silver', 'diamond'].includes(inlay)) return;
    this.changingInlay = true;
    this.onStatus(inlay === 'diamond' ? '正在准备钻石光影…' : '正在切换银珠…', 'fine');
    try {
      if (inlay === 'diamond' && !this.diamonds) {
        const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/diamond.glb`);
        if (this.disposed) return;
        gltf.scene.updateMatrixWorld(true);
        let source;
        gltf.scene.traverse(o => { if (o.isMesh) source = o; });
        const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
        source.geometry.dispose(); source.material.dispose();
        const material = new THREE.MeshPhysicalMaterial({
          name: 'Round brilliant diamond', color: 0xffffff, metalness: 0, roughness: 0.012,
          transmission: 1, ior: 2.417, thickness: 0.31, attenuationDistance: 1000, clearcoat: 0, side: THREE.DoubleSide,
        });
        this.diamonds = new THREE.Group();
        for (let i = 0; i < this.beads.length; i++) {
          const t = 2 * Math.PI * i / this.beads.length, alpha = t - Math.PI / 2 + 0.25;
          const radial = new THREE.Vector3(Math.cos(t), Math.sin(t), 0), depth = new THREE.Vector3(0, 0, 1);
          const v = radial.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(depth, Math.sin(alpha));
          const u = depth.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(radial, -Math.sin(alpha));
          const gem = new THREE.Mesh(geometry, material);
          gem.name = `Diamond ${i + 1}`;
          gem.position.copy(radial).multiplyScalar(1.30).addScaledVector(v, 0.075);
          gem.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, new THREE.Vector3().crossVectors(v, u), v));
          this.diamonds.add(gem);
        }
        this.model.add(this.diamonds);
      }
      this.inlay = inlay;
      this.metalClearcoat.forEach((original, material) => {
        material.clearcoat = APPLE_WEBKIT || inlay === 'diamond' ? 0 : original;
      });
      this.beads.forEach(o => { o.visible = inlay === 'silver'; });
      if (this.diamonds) this.diamonds.visible = inlay === 'diamond';
      this.scene.updateMatrixWorld(true);
      this.setLighting(this.lighting);
      setDiamondOpticsEnabled(this.tracer, inlay === 'diamond');
      this.tracer.setScene(this.scene, this.camera);
      this.motionDenoiser.dispose();
      this.motionDenoiser = new MotionDenoiser(this.model, this.canvas.width, this.canvas.height);
      this.lastStatus = null;
      this.invalidate();
    } finally {
      this.changingInlay = false;
    }
  }
  async prepareFine() {
    this.lastStatus = null;
    this.motionDenoiser?.reset();
    if (!this.tracer) {
      if (!this.renderer.extensions.has('EXT_color_buffer_float')) throw new Error('当前设备不支持精细光影，请使用支持 WebGL 2 浮点渲染的浏览器');
      this.onStatus('正在准备精细光影…', 'loading');
      const { WebGLPathTracer, DenoiseMaterial } = await import('three-gpu-pathtracer');
      if (this.disposed) return;
      this.tracer = new WebGLPathTracer(this.renderer);
      this.tracer.bounces = 8; this.tracer.filterGlossyFactor = 0.2;
      this.tracer.transmissiveBounces = 12;
      installDiamondDispersion(this.tracer);
      // This specular scene is lit only by the HDR studio. Sample reflected and
      // refracted directions without an extra environment shadow ray per hit.
      // The diamond's small panels are also reached by these specular paths.
      this.tracer.multipleImportanceSampling = false;
      // One full sample per frame: nine tiles previously consumed nine RAF ticks.
      this.tracer.tiles.set(1, 1); this.tracer.renderDelay = 0; this.tracer.fadeDuration = 80;
      this.tracer.minSamples = 1; this.tracer.renderScale = 1;
      this.tracer.dynamicLowRes = true;
      this.tracer.lowResScale = this.motionResolutionScale();
      // Independent samples allow temporal history to remove noise while moving.
      this.tracer.stableNoise = false;
      this.tracer.rasterizeScene = false;
      // The library also invokes this callback during shader compilation.
      // Retain the last frame then; never switch the fine mode to raster lighting.
      this.tracer.rasterizeSceneCallback = () => {};
      this.tracer.textureSize.set(512, 512);
      this.fineTarget = new THREE.WebGLRenderTarget(this.canvas.width, this.canvas.height, {
        type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: false, stencilBuffer: false,
      });
      this.fineTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
      this.motionDenoiser = new MotionDenoiser(this.model, this.canvas.width, this.canvas.height);
      this.denoiseMaterial = new DenoiseMaterial({ sigma: 2, kSigma: 1, threshold: 0.14 });
      this.denoiseQuad = new FullScreenQuad(this.denoiseMaterial);
      this.tracer.setScene(this.scene, this.camera);
    }
    this.invalidate();
  }
  renderFineFrame(moving) {
    // Composite both the interactive and accumulating path-traced buffers in
    // linear HDR, then denoise and tone-map once. The library's low-res preview
    // bypasses renderToCanvasCallback, so a final pass must cover both buffers.
    const previousTarget = this.renderer.getRenderTarget();
    // The dynamic low-resolution tracer still runs; avoid tracing both buffers during movement.
    this.tracer.pausePathTracing = moving;
    this.tracer.renderToCanvas = moving || this.tracer.samples < 16;
    this.renderer.setRenderTarget(this.fineTarget);
    const batch = !moving && this.tracer.samples >= 16
      ? Math.min(2, FINAL_SAMPLES - this.tracer.samples) : 1;
    for (let sample = 0; sample < batch; sample++) this.tracer.renderSample();
    this.renderer.setRenderTarget(previousTarget);
    if (this.tracer.isCompiling) return;
    if (this.tracer.samples < 16) {
      this.motionDenoiser.render(this.renderer, this.camera, this.fineTarget.texture,
        this.scene.background, this.tracer.lowResScale);
    } else {
      // Use the original full-resolution radiance directly for the settled image.
      const refinement = THREE.MathUtils.smoothstep(this.tracer.samples, 32, 128);
      this.denoiseMaterial.sigma = THREE.MathUtils.lerp(2, 1.25, refinement);
      this.denoiseMaterial.threshold = THREE.MathUtils.lerp(0.14, 0.10, refinement);
      this.denoiseMaterial.map = this.tracer.target.texture;
      this.denoiseQuad.render(this.renderer);
      if (this.tracer.samples % 16 === 0 || this.tracer.samples >= FINAL_SAMPLES) {
        this.motionDenoiser.seed(this.renderer, this.camera, this.tracer.target.texture, this.tracer.samples);
      }
    }
    this.pathTracedFrames++;
    if (moving) this.motionTraceFrames++;
  }
  tick(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const rawFrameMs = now - (this.lastTick || now);
    const dt = Math.min(0.05, rawFrameMs / 1000); this.lastTick = now;
    if (this.failed || this.suspended || document.hidden) return;
    if (import.meta.env.DEV && now - (this.lastDiagnostic || 0) > 1000) {
      this.lastDiagnostic = now; this.canvas.dataset.diagnostics = JSON.stringify(this.diagnostics());
    }
    this.controls.update(dt);
    if (!this.ready) return;
    const idle = now - this.lastChange > 65;
    if (this.tracer) {
      if (!idle || this.tracer.samples < FINAL_SAMPLES || this.dirty) {
        this.renderFineFrame(!idle);
        if (this.suspended) return;
        this.dirty = false; this.frameCount++;
      }
      const samples = Math.floor(this.tracer.samples);
      if (import.meta.env.DEV && this.releasedAt) {
        for (const milestone of [1, 4, 8, 16, 24, 32, FINAL_SAMPLES]) {
          if (samples >= milestone && !this.recoveryTimes[milestone]) this.recoveryTimes[milestone] = Math.round(now - this.releasedAt);
        }
      }
      const status = this.tracer.isCompiling ? '正在准备精细光影…' : !idle ? '实时精细光影' : samples >= FINAL_SAMPLES ? '精细光影已完成' : `光影细化中 ${Math.min(100, Math.floor(samples / FINAL_SAMPLES * 100))}%`;
      if (status !== this.lastStatus) { this.onStatus(status, 'fine'); this.lastStatus = status; }
    }
    if (dt > 0 && !idle) {
      this.frameTimes.push(rawFrameMs); if (this.frameTimes.length > 120) this.frameTimes.shift();
    }
  }
  diagnostics() {
    return { ready: this.ready, appleWebKit: APPLE_WEBKIT, quality: this.quality, lighting: this.lighting, inlay: this.inlay, samples: this.tracer?.samples || 0,
      triangles: this.renderer.info.render.triangles, calls: this.renderer.info.render.calls, frames: this.frameCount,
      camera: this.camera.position.toArray(), autoRotate: this.controls.autoRotate,
      buffer: [this.canvas.width, this.canvas.height], motionScale: this.tracer?.lowResScale || 0,
      rasterFrames: this.rasterFrames, pathTracedFrames: this.pathTracedFrames, motionTraceFrames: this.motionTraceFrames,
      recoveryTimes: this.recoveryTimes || {},
      temporalFrames: this.motionDenoiser?.temporalFrames || 0,
      historySeeds: this.motionDenoiser?.seedFrames || 0,
      averageFrameMs: this.frameTimes.reduce((a,b)=>a+b,0) / (this.frameTimes.length || 1) };
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.observer.disconnect(); this.controls.dispose();
    this.canvas.removeEventListener('keydown', this.keyHandler); this.canvas.removeEventListener('webglcontextlost', this.lostHandler);
    this.tracer?.dispose(); this.fineTarget?.dispose(); this.motionDenoiser?.dispose(); this.denoiseMaterial?.dispose(); this.denoiseQuad?.dispose(); this.environments?.forEach(x=>x.dispose());
    const geometries = new Set(), materials = new Set();
    this.scene.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } });
    geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose()); this.renderer.dispose(); this.canvas.remove();
  }
}
