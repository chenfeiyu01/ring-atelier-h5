import './style.css';
import { RingViewer } from './viewer.js';
const icon = (name) => {
  const paths = { plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', reset: '<path d="M5.4 7.6A8 8 0 1 1 4 14M5 3v5h5"/>' };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};
const embedded = new URLSearchParams(location.search).get('embed') === '1';
document.body.classList.toggle('embedded', embedded);
document.querySelector('#app').innerHTML = `
<main class="workspace" aria-busy="true">
  <section class="stage is-initializing" aria-label="戒指交互展示">
    <div id="viewport" class="viewport" aria-hidden="true" inert></div>
    <div class="loading" id="loading" role="status"><span class="spinner"></span><span>正在加载戒指…</span></div>
    <div class="tools" role="group" aria-label="查看工具"><button id="zoom-in" aria-label="放大" title="放大">${icon('plus')}</button><button id="zoom-out" aria-label="缩小" title="缩小">${icon('minus')}</button><button id="reset" aria-label="重置视角" title="重置视角">${icon('reset')}</button></div>
    <div class="stage-bottom"><p class="gesture"><span class="desktop-hint">拖拽旋转 · 滚轮缩放</span><span class="mobile-hint">单指旋转 · 双指缩放</span></p></div>
    <div class="render-status" id="render-status" role="status" aria-live="off"></div>
  </section>
  <aside class="inspector" aria-label="展示设置">
    <div class="setting mounting-setting"><h2>戒托</h2><div class="mounting-options" role="group" aria-label="戒托造型"><button data-mounting="solitaire" class="selected" aria-pressed="true">四爪单石</button><button data-mounting="interlace" aria-pressed="false">三线抱珠</button><button data-mounting="ribbon" aria-pressed="false">翻转槽带</button></div></div>
    <div class="setting metal-setting"><h2>金属</h2><div class="metal-options" role="group" aria-label="戒托金属"><button data-metal="yellow" aria-pressed="false"><span class="metal-swatch metal-yellow"></span><span>18K 黄金</span></button><button data-metal="white" aria-pressed="false" title="白色黄金，采用常见镀铑表面"><span class="metal-swatch metal-white"></span><span>白金</span></button><button data-metal="rose" aria-pressed="false"><span class="metal-swatch metal-rose"></span><span>玫瑰金</span></button><button data-metal="platinum" class="selected" aria-pressed="true"><span class="metal-swatch metal-platinum"></span><span>铂金</span></button></div></div>
    <div class="setting inlay-setting"><h2>镶嵌</h2><div class="inlay-options" role="group" aria-label="镶嵌材质"><button data-inlay="silver" aria-pressed="false">银珠</button><button data-inlay="diamond" class="selected" aria-pressed="true">钻石</button><button data-inlay="sapphire" aria-pressed="false">蓝宝石</button></div></div>
    <div class="setting lighting-setting"><h2>光影</h2><div class="light-options" role="group" aria-label="光影环境"><button data-light="black" class="light-choice selected" aria-pressed="true"><span class="swatch swatch-black"></span><span>经典黑</span></button><button data-light="soft" class="light-choice" aria-pressed="false"><span class="swatch swatch-soft"></span><span>柔光棚</span></button><button data-light="warm" class="light-choice" aria-pressed="false"><span class="swatch swatch-warm"></span><span>暖金光</span></button></div></div>
    <div class="setting view-setting"><h2>视角</h2><div class="view-options" role="group" aria-label="预设视角"><button data-view="hero" class="selected" aria-pressed="true">立体</button><button data-view="front" aria-pressed="false">正面</button><button data-view="side" aria-pressed="false">侧面</button></div></div>
  </aside>
</main>
`;
const $ = s => document.querySelector(s);
const setSelected = (selector, el) => document.querySelectorAll(selector).forEach(b => { b.classList.toggle('selected', b === el); b.setAttribute('aria-pressed', String(b === el)); });
let viewer;
const syncInlays = () => {
  if (!viewer) return;
  document.querySelectorAll('[data-inlay]').forEach(button => { button.hidden = !viewer.supportedInlays.includes(button.dataset.inlay); });
  $('.inlay-options').classList.toggle('is-single', viewer.supportedInlays.length === 1);
  setSelected('[data-inlay]', $(`[data-inlay="${viewer.inlay}"]`));
};
let initialFrameShown = false;
document.querySelectorAll('.workspace button').forEach(button => { button.disabled = true; });
try {
  viewer = new RingViewer($('#viewport'), {
    onStatus: (message, type) => {
      if (type === 'error') {
        $('#loading').hidden = false;
        $('#loading').lastElementChild.textContent = message;
        $('#loading').classList.add('failed');
        return;
      }
      if (!initialFrameShown) {
        if (type !== 'complete') {
          $('#loading').hidden = false;
          $('#loading').lastElementChild.textContent = message || '正在计算精细光影…';
          return;
        }
        initialFrameShown = true;
        $('.stage').classList.remove('is-initializing');
        $('.workspace').setAttribute('aria-busy', 'false');
        $('#viewport').removeAttribute('aria-hidden');
        $('#viewport').removeAttribute('inert');
        document.querySelectorAll('.workspace button').forEach(button => { button.disabled = false; });
      }
      $('#loading').hidden = true;
      $('#render-status').textContent = message;
    },
    onInteraction: () => setSelected('[data-view]', null),
  });
  await viewer.load();
  // Read-only diagnostics for integration and repeatable performance checks.
  window.ringDiagnostics = () => viewer.diagnostics();
} catch (e) {
  console.error(e); $('#loading').hidden = false; $('#loading').classList.add('failed');
  $('#loading').lastElementChild.textContent = '三维画面加载失败，请刷新重试。';
}
$('#zoom-in').onclick = () => viewer?.zoom(1);
$('#zoom-out').onclick = () => viewer?.zoom(-1);
$('#reset').onclick = () => { viewer?.setView('hero'); setSelected('[data-view]', $('[data-view="hero"]')); };
document.querySelectorAll('[data-light]').forEach(b => b.onclick = () => { viewer?.setLighting(b.dataset.light); setSelected('[data-light]', b); });
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { viewer?.setView(b.dataset.view); setSelected('[data-view]', b); });
document.querySelectorAll('[data-metal]').forEach(b => b.onclick = () => { viewer?.setMetal(b.dataset.metal); setSelected('[data-metal]', $(`[data-metal="${viewer.metal}"]`)); });
document.querySelectorAll('[data-inlay], [data-mounting]').forEach(b => b.onclick = async () => {
  const buttons = document.querySelectorAll('[data-inlay], [data-mounting], [data-metal]');
  buttons.forEach(x => { x.disabled = true; });
  try {
    if (b.dataset.mounting) {
      await viewer?.setMounting(b.dataset.mounting);
      setSelected('[data-mounting]', $(`[data-mounting="${viewer.mounting}"]`));
      setSelected('[data-view]', $('[data-view="hero"]'));
    } else await viewer?.setInlay(b.dataset.inlay);
    syncInlays();
  } catch (error) {
    console.error(error);
    $('#render-status').textContent = '切换暂时失败，请重试。';
  } finally { buttons.forEach(x => { x.disabled = false; }); }
});
window.addEventListener('pagehide', () => { if (viewer) viewer.suspended=true; });
window.addEventListener('pageshow', () => { if (viewer) {viewer.suspended=false;viewer.invalidate();} });
if (import.meta.hot) import.meta.hot.dispose(() => viewer?.dispose());
