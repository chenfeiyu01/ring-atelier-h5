import './style.css';
import { RingViewer } from './viewer.js';
const icon = (name) => {
  const paths = { plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', reset: '<path d="M5.4 7.6A8 8 0 1 1 4 14M5 3v5h5"/>', play: '<path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none"/>', pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', drag: '<path d="M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3"/>' };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};
const embedded = new URLSearchParams(location.search).get('embed') === '1';
document.body.classList.toggle('embedded', embedded);
document.querySelector('#app').innerHTML = `
<header class="header">
  <a class="brand" href="./" aria-label="环观首页"><svg class="brand-mark" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><ellipse cx="24" cy="24" rx="18" ry="21" transform="rotate(28 24 24)"/><ellipse cx="24" cy="24" rx="18" ry="21" transform="rotate(-28 24 24)"/></svg><span class="brand-cn">环 · 观</span><span class="brand-en">RING ATELIER</span></a>
  <button class="reference-button" id="reference">查看原片<span class="small-arrow" aria-hidden="true">↗</span></button>
</header>
<main class="workspace">
  <section class="stage" aria-label="戒指交互展示">
    <div class="stage-label"><span></span>自由探索</div>
    <div id="viewport" class="viewport"></div>
    <div class="loading" id="loading" role="status"><span class="spinner"></span><span>正在加载戒指…</span></div>
    <div class="tools" role="group" aria-label="查看工具"><button id="zoom-in" aria-label="放大" title="放大">${icon('plus')}</button><button id="zoom-out" aria-label="缩小" title="缩小">${icon('minus')}</button><button id="reset" aria-label="重置视角" title="重置视角">${icon('reset')}</button></div>
    <div class="stage-bottom"><button id="rotate" class="rotate-button" aria-pressed="false">${icon('play')}<span>自动旋转</span></button><p class="gesture"><span class="desktop-hint">拖拽旋转 · 滚轮缩放</span><span class="mobile-hint">单指旋转 · 双指缩放</span></p></div>
    <div class="render-status" id="render-status" role="status" aria-live="off"></div>
  </section>
  <aside class="inspector" aria-label="展示设置">
    <div class="intro"><h1>一环之间</h1><p>转动，发现每一面。</p></div>
    <div class="setting lighting-setting"><h2>光影</h2><div class="light-options" role="group" aria-label="光影环境"><button data-light="black" class="light-choice selected" aria-pressed="true"><span class="swatch swatch-black"></span><span>经典黑</span></button><button data-light="soft" class="light-choice" aria-pressed="false"><span class="swatch swatch-soft"></span><span>柔光棚</span></button><button data-light="warm" class="light-choice" aria-pressed="false"><span class="swatch swatch-warm"></span><span>暖金光</span></button></div></div>
    <div class="setting quality-setting"><h2>画质</h2><div class="segmented" role="group" aria-label="渲染画质"><button data-quality="smooth" class="selected" aria-pressed="true">流畅</button><button data-quality="fine" aria-pressed="false">精细</button></div><p class="setting-help">拖动时保留精细光影，停下后更加清晰。</p></div>
    <div class="setting view-setting"><h2>视角</h2><div class="view-options" role="group" aria-label="预设视角"><button data-view="hero" class="selected" aria-pressed="true">立体</button><button data-view="front" aria-pressed="false">正面</button><button data-view="side" aria-pressed="false">侧面</button></div></div>
  </aside>
</main>
<footer><span>基于视频外观重建</span><span>360° 自由查看</span></footer>
<dialog id="reference-dialog" aria-labelledby="dialog-title"><div class="dialog-header"><div><h2 id="dialog-title">原片对照</h2><p>用户提供的渲染视频 · 750 × 750</p></div><button id="close-dialog" class="icon-button" aria-label="关闭原片">${icon('close')}</button></div><video id="reference-video" src="${import.meta.env.BASE_URL}reference/ring.mp4" controls loop playsinline preload="none"></video><p class="reference-note">三维模型根据视频外观重建，未包含原始尺寸数据。</p></dialog>
<div class="toast" id="toast" role="status"></div>`;
const $ = s => document.querySelector(s);
const setSelected = (selector, el) => document.querySelectorAll(selector).forEach(b => { b.classList.toggle('selected', b === el); b.setAttribute('aria-pressed', String(b === el)); });
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(()=>$('#toast').classList.remove('visible'),4500); }
let viewer;
try {
  viewer = new RingViewer($('#viewport'), {
    onStatus: (message, type) => {
      if (type === 'loading' && !viewer?.ready || type === 'error') { $('#loading').hidden = false; $('#loading').lastElementChild.textContent = message; if (type === 'error') $('#loading').classList.add('failed'); }
      else { $('#loading').hidden = true; $('#render-status').textContent = message; }
    },
    onAutoChange: active => { $('#rotate').setAttribute('aria-pressed', String(active)); $('#rotate').innerHTML = `${icon(active ? 'pause' : 'play')}<span>${active ? '暂停旋转' : '自动旋转'}</span>`; },
    onInteraction: () => setSelected('[data-view]', null),
  });
  await viewer.load();
  // Read-only diagnostics for integration and repeatable performance checks.
  window.ringDiagnostics = () => viewer.diagnostics();
} catch (e) {
  console.error(e); $('#loading').hidden = false; $('#loading').classList.add('failed');
  $('#loading').lastElementChild.textContent = '三维画面加载失败，请刷新重试；也可查看原片。';
}
$('#zoom-in').onclick = () => viewer?.zoom(1);
$('#zoom-out').onclick = () => viewer?.zoom(-1);
$('#reset').onclick = () => { viewer?.setView('hero'); setSelected('[data-view]', $('[data-view="hero"]')); };
$('#rotate').onclick = () => viewer?.setAuto(!viewer.controls.autoRotate);
document.querySelectorAll('[data-light]').forEach(b => b.onclick = () => { viewer?.setLighting(b.dataset.light); setSelected('[data-light]', b); });
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { viewer?.setView(b.dataset.view); setSelected('[data-view]', b); });
document.querySelectorAll('[data-quality]').forEach(b => b.onclick = async () => {
  if (!viewer?.ready) return;
  setSelected('[data-quality]', b);
  document.querySelectorAll('[data-quality]').forEach(el=>el.disabled=true);
  try { await viewer.setQuality(b.dataset.quality); }
  catch (e) { console.error(e); toast('精细模式暂不可用，已恢复流畅画质'); await viewer.setQuality('smooth'); setSelected('[data-quality]', $('[data-quality="smooth"]')); }
  finally { document.querySelectorAll('[data-quality]').forEach(el=>el.disabled=false); }
});
const dialog = $('#reference-dialog'), video = $('#reference-video');
$('#reference').onclick = () => { viewer?.setAuto(false); if (viewer) viewer.suspended=true; dialog.showModal(); video.play().catch(()=>{}); };
$('#close-dialog').onclick = () => dialog.close();
dialog.addEventListener('click', e => { if (e.target===dialog && (e.clientX<dialog.getBoundingClientRect().left || e.clientX>dialog.getBoundingClientRect().right || e.clientY<dialog.getBoundingClientRect().top || e.clientY>dialog.getBoundingClientRect().bottom)) dialog.close(); });
dialog.addEventListener('close', () => { video.pause(); if (viewer) {viewer.suspended=false;viewer.invalidate();} });
window.addEventListener('pagehide', () => { if (viewer) viewer.suspended=true; });
window.addEventListener('pageshow', () => { if (viewer) {viewer.suspended=false;viewer.invalidate();} });
if (import.meta.hot) import.meta.hot.dispose(() => viewer?.dispose());

// Desktop product viewing starts with inter-reflections. Touch devices retain
// the lightweight default and can opt in using the same quality control.
if (viewer?.ready && !window.matchMedia('(pointer: coarse)').matches && window.innerWidth >= 700) {
  document.querySelector('[data-quality="fine"]').click();
}
