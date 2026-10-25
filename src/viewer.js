import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStudio } from './studio.js';
import { JewelryPreview } from './jewelry-preview.js';
import { installDiamondDispersion, setDiamondOpticsEnabled } from './diamond-optics.js';
const FINAL_SAMPLES = 192;
const SETTLE_DELAY = 180;
const MOUNTINGS = {
  solitaire: { asset: 'solitaire.glb', label: '四爪单石', hero: [-3.6, 4.1, 5.1], inlays: ['silver', 'diamond', 'sapphire'] },
  interlace: { asset: 'interlace.glb', label: '三线抱珠', hero: [-4.7, 1.9, 6.0], inlays: ['silver'] },
  ribbon: { asset: 'ring.glb', label: '翻转槽带', hero: [-4.7, 1.9, 6.0], inlays: ['silver'] },
};
// For a conductor, linear base color is its normal-incidence reflectance (F0),
// not a painted sRGB tint. Pt/Ag use published measured RGB values; gold-alloy
// colors approximate polished jewelry because no specific alloy recipe was supplied.
// White gold uses the common rhodium-plated finish, distinct from bare platinum.
const METALS = {
  yellow: { label: '18K 黄金', reflectance: [0.991, 0.786, 0.440], roughness: 0.12 },
  white: { label: '白金（白色黄金，镀铑）', reflectance: [0.80, 0.80, 0.79], roughness: 0.11 },
  rose: { label: '玫瑰金', reflectance: [0.96, 0.65, 0.56], roughness: 0.12 },
  platinum: { label: '铂金', reflectance: [0.673, 0.637, 0.585], roughness: 0.11 },
};

// All iOS browsers and desktop Safari use Apple's WebKit shader compiler.
// three-gpu-pathtracer 0.0.24 clearcoat produces black radiance there (#711).
// All metal presets use an uncoated conductor surface, avoiding that optional layer.
const APPLE_WEBKIT = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR|Android/.test(navigator.userAgent));

/** Reusable viewer. All asset paths are resolved relative to the current app. */
export class RingViewer {
  constructor(container, { onStatus = () => {}, onInteraction = () => {} } = {}) {
    this.container = container; this.onStatus = onStatus; this.onInteraction = onInteraction;
    this.quality = 'fine'; this.lighting = 'black'; this.inlay = 'diamond'; this.mounting = 'solitaire'; this.metal = 'platinum'; this.ready = false; this.disposed = false; this.suspended = false;
    this.mountings = new Map(); this.gemGeometries = new Map(); this.inlayMaterials = new Map();
    this.lastChange = 0; this.dirty = true; this.frameCount = 0; this.frameTimes = [];
    this.rasterFrames = 0; this.pathTracedFrames = 0; this.motionTraceFrames = 0;
    this.previewDirty = true; this.displayMode = 'preview'; this.refinementBlend = 0;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance',
      // Optional development capture keeps idle WebGL pixels available to screenshots.
      preserveDrawingBuffer: import.meta.env.DEV && new URLSearchParams(location.search).has('capture'),
    });
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
    this.preview = new JewelryPreview(this.renderer, this.canvas.width, this.canvas.height);
    this.controls = new OrbitControls(this.camera, this.canvas);
    // Accumulate immediately at the released pose instead of resetting through a long inertial tail.
    this.controls.enableDamping = false;
    this.controls.enablePan = false; this.controls.rotateSpeed = 0.6; this.controls.zoomSpeed = 0.7;
    this.controls.minDistance = 3.9; this.controls.maxDistance = 14;
    this.controls.autoRotate = false;
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => {
      this.interacting = true;
      this.onInteraction();
      if (import.meta.env.DEV) { this.frameTimes = []; this.lastTick = performance.now(); }
    });
    this.controls.addEventListener('end', () => {
      this.interacting = false;
      if (import.meta.env.DEV) { this.releasedAt = performance.now(); this.recoveryTimes = {}; }
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
    const setting = await this.loadMounting(this.mounting);
    await this.ensureInlay(setting, this.inlay);
    if (this.disposed) return;
    this.model = setting.root;
    this.applyInlay(setting);
    this.scene.add(this.model); this.setLighting(this.lighting); this.scene.updateMatrixWorld(true);
    this.preview.setModel(this.model);
    await this.prepareFine();
    if (this.disposed) return;
    this.ready = true; this.invalidate(); this.onStatus('', 'ready');
  }
  async loadMounting(name) {
    if (this.mountings.has(name)) return this.mountings.get(name);
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/${MOUNTINGS[name].asset}`);
    const setting = { root: gltf.scene, beads: [], slots: [], groups: new Map(), metals: new Set() };
    const importedBeadMaterials = new Set();
    setting.root.rotation.z = name === 'ribbon' ? -0.23 : -0.10;
    setting.root.traverse(o => {
      if (o.userData.inlay_slot) setting.slots.push(o);
      if (o.userData.setting_head) { setting.head = o; setting.headScale = o.scale.clone(); }
      if (!o.isMesh) return;
      if (name === 'ribbon' && /silver/i.test(o.material.name)) {
        setting.beads.push(o); importedBeadMaterials.add(o.material);
        o.material = this.inlayMaterial('silver');
      } else if (o.material.metalness > 0.5) setting.metals.add(o.material);
      o.material.envMapIntensity = 1;
      o.material.side = THREE.FrontSide;
    });
    importedBeadMaterials.forEach(material => material.dispose());
    this.applyMetal(setting);
    setting.root.updateMatrixWorld(true);
    this.mountings.set(name, setting);
    return setting;
  }
  async gemGeometry(kind) {
    if (!this.gemGeometries.has(kind)) {
      const asset = kind === 'sapphire' ? 'sapphire.glb' : 'diamond.glb?v=10-large';
      const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/${asset}`);
      gltf.scene.updateMatrixWorld(true);
      let source;
      gltf.scene.traverse(o => { if (o.isMesh) source = o; });
      const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
      source.geometry.dispose(); source.material.dispose();
      this.gemGeometries.set(kind, geometry);
    }
    return this.gemGeometries.get(kind);
  }
  inlayMaterial(kind, scale = 1) {
    const key = kind === 'sapphire' ? `${kind}-${scale}` : kind;
    if (!this.inlayMaterials.has(key)) {
      const material = kind === 'silver'
        ? new THREE.MeshPhysicalMaterial({ name: 'Polished silver bead', color: new THREE.Color().setRGB(0.972, 0.960, 0.915), metalness: 1, roughness: 0.10, clearcoat: 0 })
        : new THREE.MeshPhysicalMaterial({
            name: kind === 'sapphire' ? 'Independent oval blue sapphire' : 'Round brilliant diamond',
            color: 0xffffff, metalness: 0, roughness: kind === 'sapphire' ? 0.015 : 0.012,
            transmission: 1, ior: kind === 'sapphire' ? 1.766 : 2.417,
            thickness: kind === 'sapphire' ? 0.16 * scale : 0.31,
            attenuationColor: new THREE.Color(kind === 'sapphire' ? '#326ec0' : '#ffffff'),
            attenuationDistance: kind === 'sapphire' ? 0.25 * scale : 1000,
            clearcoat: 0, side: THREE.DoubleSide,
          });
      this.inlayMaterials.set(key, material);
    }
    return this.inlayMaterials.get(key);
  }
  async ensureInlay(setting, inlay) {
    if (setting.groups.has(inlay)) return;
    const group = new THREE.Group(); group.name = `${inlay} inlays`;
    if (setting.slots.length) {
      if (inlay !== 'silver') await this.gemGeometry(inlay);
      if (setting.slots.some(slot => slot.userData.inlay_slot === 'accent')) await this.gemGeometry('diamond');
      this.beadGeometry ||= new THREE.SphereGeometry(1, 40, 24);
      const inverse = setting.root.matrixWorld.clone().invert();
      for (const slot of setting.slots) {
        const kind = slot.userData.inlay_slot === 'accent' ? 'diamond' : inlay;
        const scale = slot.userData[kind === 'silver' ? 'silver_radius' : `${kind}_scale`];
        const mesh = new THREE.Mesh(kind === 'silver' ? this.beadGeometry : this.gemGeometries.get(kind), this.inlayMaterial(kind, scale));
        mesh.name = slot.name; mesh.userData.inlayRole = slot.userData.inlay_slot;
        new THREE.Matrix4().multiplyMatrices(inverse, slot.matrixWorld).decompose(mesh.position, mesh.quaternion, mesh.scale);
        mesh.scale.multiplyScalar(scale); group.add(mesh);
      }
    } else if (inlay !== 'silver') {
      const sapphire = inlay === 'sapphire', count = sapphire ? 20 : 10;
      const geometry = await this.gemGeometry(inlay), material = this.inlayMaterial(inlay);
      for (let i = 0; i < count; i++) {
        const t = 2 * Math.PI * i / count, alpha = t - Math.PI / 2 + 0.25;
        const radial = new THREE.Vector3(Math.cos(t), Math.sin(t), 0), depth = new THREE.Vector3(0, 0, 1);
        const v = radial.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(depth, Math.sin(alpha));
        const u = depth.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(radial, -Math.sin(alpha));
        const gem = new THREE.Mesh(geometry, material); gem.name = `${inlay} ${i + 1}`; gem.userData.inlayRole = 'main';
        gem.position.copy(radial).multiplyScalar(1.30).addScaledVector(v, sapphire ? 0.10 : 0.22);
        gem.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, new THREE.Vector3().crossVectors(v, u), v));
        group.add(gem);
      }
    }
    group.visible = false; setting.root.add(group); setting.groups.set(inlay, group);
  }
  hasOpticalGems() {
    return this.inlay !== 'silver' || this.mountings.get(this.mounting)?.slots.some(slot => slot.userData.inlay_slot === 'accent');
  }
  get supportedInlays() { return MOUNTINGS[this.mounting].inlays; }
  applyMetal(setting) {
    const preset = METALS[this.metal];
    setting.metals.forEach(material => {
      material.name = preset.label;
      material.color.setRGB(...preset.reflectance);
      material.metalness = 1; material.roughness = preset.roughness;
      material.clearcoat = 0; material.transmission = 0;
    });
  }
  setMetal(metal) {
    if (!this.ready || this.changingModel || metal === this.metal || !METALS[metal]) return;
    this.metal = metal;
    this.mountings.forEach(setting => this.applyMetal(setting));
    this.tracer?.updateMaterials();
    this.lastStatus = null; this.invalidate();
  }
  applyInlay(setting) {
    setting.beads.forEach(o => { o.visible = this.inlay === 'silver'; });
    setting.groups.forEach((group, kind) => { group.visible = kind === this.inlay; });
    if (setting.head) {
      const size = this.inlay === 'sapphire' ? [0.68, 1, 0.98] : this.inlay === 'silver' ? [0.85, 1, 0.85] : [1, 1, 1];
      setting.head.scale.copy(setting.headScale).multiply(new THREE.Vector3(...size));
    }
  }
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8, Math.sqrt(2200000 / (width * height))));
    this.renderer.setSize(width, height);
    if (this.fineTarget) this.fineTarget.setSize(this.canvas.width, this.canvas.height);
    this.preview?.resize(this.canvas.width, this.canvas.height);
    this.camera.aspect = width / height;
    // Preserve comfortable margins in tall and narrow H5 containers.
    this.camera.fov = width / height < 0.85 ? 36 : 32;
    this.camera.updateProjectionMatrix(); this.invalidate();
  }
  invalidate() {
    this.lastChange = performance.now(); this.dirty = true;
    this.previewDirty = true; this.refinementBlend = 0;
    if (this.tracer) this.tracer.updateCamera();
  }
  setView(view) {
    const positions = { hero: MOUNTINGS[this.mounting].hero, front: [0, 0, 8.2], side: [8.1, 0.6, 0.7] };
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
    const key = `${preset}-${this.hasOpticalGems() ? 'gems' : 'silver'}`;
    if (!this.environments.has(key)) this.environments.set(key, createStudio(preset, this.hasOpticalGems()));
    this.scene.environment = this.environments.get(key);
    this.scene.background.set(preset === 'soft' ? 0x171717 : 0x000000);
    this.preview.setEnvironment(this.scene.environment, this.scene.background);
    if (this.tracer) { this.tracer.updateEnvironment(); this.configureBackgroundFiltering(); }
    this.invalidate();
  }
  configureBackgroundFiltering() {
    // The pinned tracer generates a Float32 background gradient with linear
    // filtering, even when that optional WebGL extension is unavailable.
    const background = this.tracer._pathTracer.material.backgroundMap;
    if (background?.type === THREE.FloatType && !this.renderer.extensions.has('OES_texture_float_linear')) {
      background.minFilter = background.magFilter = THREE.NearestFilter;
      background.needsUpdate = true;
    }
  }
  async setInlay(inlay) {
    if (!this.ready || this.changingModel || inlay === this.inlay || !this.supportedInlays.includes(inlay)) return;
    this.changingModel = true; this.ready = false;
    const label = { silver: '银珠', diamond: '钻石', sapphire: '蓝宝石' }[inlay];
    this.onStatus(`正在准备${label}光影…`, 'fine');
    try {
      const setting = this.mountings.get(this.mounting);
      await this.ensureInlay(setting, inlay);
      if (this.disposed) return;
      this.inlay = inlay; this.applyInlay(setting); this.rebuildFineScene();
    } finally {
      this.changingModel = false; this.ready = !this.disposed;
    }
  }
  async setMounting(name) {
    if (!this.ready || this.changingModel || name === this.mounting || !MOUNTINGS[name]) return;
    this.changingModel = true; this.ready = false;
    this.onStatus(`正在加载${MOUNTINGS[name].label}戒托…`, 'fine');
    try {
      const setting = await this.loadMounting(name);
      const inlay = MOUNTINGS[name].inlays.includes(this.inlay) ? this.inlay : 'silver';
      await this.ensureInlay(setting, inlay);
      if (this.disposed) return;
      this.scene.remove(this.model);
      this.mounting = name; this.inlay = inlay; this.model = setting.root; this.applyInlay(setting);
      this.scene.add(this.model); this.setView('hero'); this.rebuildFineScene();
    } finally {
      this.changingModel = false; this.ready = !this.disposed;
    }
  }
  rebuildFineScene() {
    this.scene.updateMatrixWorld(true); this.setLighting(this.lighting);
    setDiamondOpticsEnabled(this.tracer, this.hasOpticalGems());
    this.tracer.setScene(this.scene, this.camera);
    this.preview.setModel(this.model);
    this.lastStatus = null; this.invalidate();
  }
  async prepareFine() {
    this.lastStatus = null;
    if (!this.tracer) {
      if (!this.renderer.extensions.has('EXT_color_buffer_float')) throw new Error('当前设备不支持精细光影，请使用支持 WebGL 2 浮点渲染的浏览器');
      this.onStatus('正在准备精细光影…', 'loading');
      const { WebGLPathTracer, DenoiseMaterial } = await import('three-gpu-pathtracer');
      if (this.disposed) return;
      this.tracer = new WebGLPathTracer(this.renderer);
      this.tracer.bounces = 8; this.tracer.filterGlossyFactor = 0.2;
      this.tracer.transmissiveBounces = 12;
      installDiamondDispersion(this.tracer);
      setDiamondOpticsEnabled(this.tracer, this.hasOpticalGems());
      // This specular scene is lit only by the HDR studio. Sample reflected and
      // refracted directions without an extra environment shadow ray per hit.
      // The diamond's small panels are also reached by these specular paths.
      this.tracer.multipleImportanceSampling = false;
      // One full sample per frame: nine tiles previously consumed nine RAF ticks.
      this.tracer.tiles.set(1, 1); this.tracer.renderDelay = 0; this.tracer.fadeDuration = 0;
      this.tracer.minSamples = 1; this.tracer.renderScale = 1;
      this.tracer.dynamicLowRes = false;
      this.tracer.renderToCanvas = false;
      this.tracer.stableNoise = false;
      this.tracer.rasterizeScene = false;
      // The stable preview remains visible while the path-tracer shader compiles.
      this.tracer.rasterizeSceneCallback = () => {};
      this.tracer.textureSize.set(512, 512);
      this.fineTarget = new THREE.WebGLRenderTarget(this.canvas.width, this.canvas.height, {
        type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: false, stencilBuffer: false,
      });
      this.fineTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
      this.denoiseMaterial = new DenoiseMaterial({ sigma: 2, kSigma: 1, threshold: 0.14 });
      this.denoiseQuad = new FullScreenQuad(this.denoiseMaterial);
      this.tracer.setScene(this.scene, this.camera);
      this.configureBackgroundFiltering();
    }
    this.invalidate();
  }
  renderPreviewFrame() {
    if (this.previewDirty) {
      this.preview.render(this.camera);
      this.previewDirty = false; this.rasterFrames++;
    }
    this.preview.display();
    this.displayMode = 'preview'; this.refinementBlend = 0;
  }
  renderFineFrame() {
    // Accumulate offscreen; never expose the tracer's noisy first samples.
    // Blend linear HDR radiance and apply the same exposure/tone mapping once.
    const previousTarget = this.renderer.getRenderTarget();
    const batch = this.tracer.samples >= 16 ? Math.min(2, FINAL_SAMPLES - this.tracer.samples) : 1;
    for (let sample = 0; sample < batch; sample++) this.tracer.renderSample();
    const samples = this.tracer.samples;
    if (samples < 32 || this.tracer.isCompiling) {
      this.renderPreviewFrame();
    } else {
      const refinement = THREE.MathUtils.smoothstep(this.tracer.samples, 32, 128);
      this.denoiseMaterial.sigma = THREE.MathUtils.lerp(2, 1.25, refinement);
      this.denoiseMaterial.threshold = THREE.MathUtils.lerp(0.14, 0.10, refinement);
      this.denoiseMaterial.map = this.tracer.target.texture;
      this.renderer.setRenderTarget(this.fineTarget);
      this.denoiseQuad.render(this.renderer);
      this.renderer.setRenderTarget(previousTarget);
      this.refinementBlend = refinement;
      this.preview.display(this.fineTarget.texture, refinement);
      this.displayMode = refinement < 1 ? 'refining' : 'path-traced';
    }
    this.pathTracedFrames++;
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
    const idle = !this.interacting && now - this.lastChange > SETTLE_DELAY;
    if (this.tracer) {
      const firstFrame = !this.hasShownFrame;
      if (this.dirty || (idle && this.tracer.samples < FINAL_SAMPLES)) {
        if (!idle) this.renderPreviewFrame();
        else this.renderFineFrame();
        if (this.suspended) return;
        this.dirty = false; this.frameCount++; this.hasShownFrame = true;
      }
      const samples = Math.floor(this.tracer.samples);
      if (import.meta.env.DEV && this.releasedAt) {
        for (const milestone of [1, 4, 8, 16, 24, 32, FINAL_SAMPLES]) {
          if (samples >= milestone && !this.recoveryTimes[milestone]) this.recoveryTimes[milestone] = Math.round(now - this.releasedAt);
        }
      }
      const status = firstFrame || !idle ? '实时光影' : samples >= FINAL_SAMPLES ? '精细光影已完成' : `光影细化中 ${Math.min(100, Math.floor(samples / FINAL_SAMPLES * 100))}%`;
      const type = firstFrame || !idle ? 'preview' : samples >= FINAL_SAMPLES ? 'complete' : 'fine';
      if (status !== this.lastStatus) { this.onStatus(status, type); this.lastStatus = status; }
    }
    if (dt > 0 && !idle) {
      this.frameTimes.push(rawFrameMs); if (this.frameTimes.length > 120) this.frameTimes.shift();
    }
  }
  diagnostics() {
    const setting = this.mountings.get(this.mounting), inlays = setting?.groups.get(this.inlay)?.children || [];
    return { ready: this.ready, appleWebKit: APPLE_WEBKIT, quality: this.quality, lighting: this.lighting, mounting: this.mounting, inlay: this.inlay, supportedInlays: this.supportedInlays, metal: this.metal, samples: this.tracer?.samples || 0,
      metalMaterials: [...(setting?.metals || [])].map(material => ({ name: material.name, reflectance: material.color.toArray(), metalness: material.metalness, roughness: material.roughness, clearcoat: material.clearcoat })),
      mainInlayCount: inlays.filter(mesh => mesh.userData.inlayRole === 'main').length + (setting?.beads.filter(mesh => mesh.visible).length || 0),
      accentInlayCount: inlays.filter(mesh => mesh.userData.inlayRole === 'accent').length,
      triangles: this.renderer.info.render.triangles, calls: this.renderer.info.render.calls, frames: this.frameCount,
      camera: this.camera.position.toArray(), autoRotate: this.controls.autoRotate,
      buffer: [this.canvas.width, this.canvas.height], displayMode: this.displayMode, refinementBlend: this.refinementBlend,
      previewGems: this.preview.gemCount || 0,
      previewDrawCalls: this.preview.drawCalls || 0,
      gpuMemory: { ...this.renderer.info.memory },
      rasterFrames: this.rasterFrames, pathTracedFrames: this.pathTracedFrames, motionTraceFrames: this.motionTraceFrames,
      recoveryTimes: this.recoveryTimes || {},
      averageFrameMs: this.frameTimes.reduce((a,b)=>a+b,0) / (this.frameTimes.length || 1) };
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.observer.disconnect(); this.controls.dispose();
    this.canvas.removeEventListener('keydown', this.keyHandler); this.canvas.removeEventListener('webglcontextlost', this.lostHandler);
    this.tracer?.dispose(); this.tracer?._lowResPathTracer.dispose();
    this.fineTarget?.dispose(); this.preview.dispose(); this.denoiseMaterial?.dispose(); this.denoiseQuad?.dispose(); this.environments?.forEach(x=>x.dispose());
    const geometries = new Set(), materials = new Set();
    this.mountings.forEach(setting => setting.root.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } }));
    this.gemGeometries.forEach(geometry => geometries.add(geometry));
    this.inlayMaterials.forEach(material => materials.add(material));
    if (this.beadGeometry) geometries.add(this.beadGeometry);
    geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose()); this.renderer.dispose(); this.canvas.remove();
  }
}
