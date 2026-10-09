# 环 · 观 / Ring Atelier

基于用户提供的 3 秒戒指视频与补充截图制作的 H5 三维查看器。真正的三维几何，可用鼠标或触屏旋转；不是切换视频帧。

## 公网访问

[环 · 观 / Ring Atelier](https://ring-atelier-h5.chenpowpow.chatgpt.site)

2026-10-10 更新内容：20 颗更大的珠子，只保留精细模式，移除自动旋转；增加 Apple 浏览器精细光影兼容处理。通过 Sites 托管静态构建，模型、视频和代码随站点一起发布，访问不依赖本地电脑。独立嵌入入口是在地址后加 `?embed=1`。站点标识和静态输出目录保存在 `.openai/hosting.json`，后续更新继续使用同一站点。

## 运行

```bash
npm ci
npm run dev
```

访问终端显示的地址，默认 http://localhost:5186 。同一局域网的手机可以通过电脑局域网 IP 与此端口访问。也可双击 `启动查看器.command`。

```bash
npm run build
npm run preview
```

`dist/` 可直接部署到静态托管。不要双击 index.html 用 file:// 打开，模型和模块需要 HTTP 服务。运行时模型、视频和代码均来自本地项目，不依赖第三方 CDN。

## 操作

- 单指 / 鼠标拖拽：旋转；双指 / 滚轮：缩放。
- 放大、缩小、重置，立体 / 正面 / 侧面视角。
- 三套摄影棚环境：经典黑、柔光棚、暖金光。
- 精细：所有设备统一使用。拖拽、缩放时持续进行六次反弹的路径追踪，保留金属互相反射；运动时复用前一帧对应表面的清晰细节，以深度、法线和材质边界排除遮挡变化，再用少量空间过滤处理新出现的区域。移动追踪像素预算约 48 万，最高保留完整分辨率。松手后约 65ms 开始完整分辨率积累，每帧一个样本，最终恢复到原来的 192 次采样和静止降噪处理。运动时仍可能出现少量噪点，帧率取决于 GPU。
- “查看原片”播放用户视频，便于核对。
- 键盘：聚焦三维画布后，方向键旋转、+ / - 缩放、Home 重置。

## 模型与当前精度

- `models/ring.blend`：可编辑 Blender 模型、材质和摄影棚灯光。
- `public/models/ring.glb`：供 H5 使用的模型。
- `scripts/build_ring.py`：可复现建模脚本，使用 Blender 运行。
- `scripts/validate_model.py`：检查封闭网格、随截面翻转的封闭背面、开放面以及珠子穿模。
- 金色戒托是一条带封闭底托的连续槽带，截面沿戒圈完整翻转一周；开放面与封闭背面一起交换内外方向。没有额外叠放固定的圆筒内衬。
- 按用户反馈加厚戒圈、增大珠子，当前使用 20 颗银白圆珠（半径 0.195，相比之前 0.155 增大约 26%）。数量、尺寸和材料参数是视觉重建选择，不是原始 CAD 数据。

输入仅为 750×750 压缩视频和截图，未包含真实尺寸、原始材质或灯光文件。因此，这是用于展示的外观重建，不是原款精确复刻或可直接生产的工程模型。当前精细模式用于改善反射与光影，不代表与原片逐像素一致。

## 嵌入现有 H5

最简单的独立嵌入：

```html
<iframe src="/ring-atelier/?embed=1"
  title="戒指三维查看器"
  style="width:100%;height:520px;border:0"
  loading="lazy"></iframe>
```

`?embed=1` 隐藏独立页面的页眉与参数面板，保留三维画布、旋转与缩放工具。要集成自有按钮，可直接使用 `src/viewer.js` 的 `RingViewer` 类（Vite / ES Modules）：

```js
const viewer = new RingViewer(container, { onStatus });
await viewer.load();
viewer.setView('hero'); // front / side
viewer.setLighting('black'); // soft / warm
// 页面卸载时
viewer.dispose();
```

资源目录须随应用一起部署；已有路由前缀时通过 Vite `base` 配置调整。查看器自动跟随容器大小，触控手势只在画布范围内生效。

## 依赖与选择

采用 Three.js + Vite，精细模式按需载入 three-gpu-pathtracer。依赖版本锁定在 package-lock.json；详情见 `docs/implementation-notes.md`。所有模型几何为本项目生成，未使用来源或授权不明的现成珠宝资产。


Apple 浏览器兼容：已修复 Safari 精细渲染全黑的清漆层问题，iPhone/iPad 使用同一兼容处理；真实 iPhone Edge 仍待复验。本版同步上述兼容修复。
