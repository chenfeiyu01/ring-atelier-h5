# 环 · 观 / Ring Atelier

从一段 3 秒戒指视频重建的 H5 三维查看器。拖拽旋转、双指或滚轮缩放，支持银珠与钻石镶嵌，所有设备使用渐进精细光影。

## 查看与部署

页面部署到 **GitHub Pages**：https://chenfeiyu01.github.io/ring-atelier-h5/ 。源码仓库：https://github.com/chenfeiyu01/ring-atelier-h5 。

`.github/workflows/pages.yml` 在 main 更新后构建并发布 dist；也可在 Actions 中手动运行。Vite 使用相对资源路径，适用于 GitHub Pages 的项目子目录。模型、视频和代码随站点发布，运行时不依赖第三方 CDN。

## 本地运行

```bash
npm ci
npm run dev
```

默认地址 http://localhost:5186，也可双击 `启动查看器.command`。

```bash
npm run build
npm run preview
```

需要支持 WebGL 2 浮点渲染的浏览器；通过 HTTP 服务访问，不能直接双击 HTML 文件。

## 操作

- 鼠标或单指拖拽旋转；滚轮或双指缩放。支持放大、缩小和重置。
- “镶嵌”切换银珠 / 钻石，保持当前视角与灯光。
- 三套光影：经典黑、柔光棚、暖金光；三种视角：立体、正面、侧面。
- 聚焦画布后，方向键旋转、+ / - 缩放、Home 重置。

拖动时持续进行路径追踪并复用有效的历史细节；松手约 65ms 后以完整分辨率累计到 192 样本。采用 8 次反弹，钻石另有最多 12 次透射内部遍历。静止阶段合并采样与后处理，减少等待和重复工作；不降低最终样本上限。移动画面和刚显露的表面仍可能有噪点。耗时依赖设备和画面尺寸，实测记录见 `docs/qa/README.md`。

## 模型

- `models/ring.blend` / `public/models/ring.glb`：金色翻转槽带及 20 颗银珠。
- `models/diamond.blend` / `public/models/diamond.glb`：闭合的圆形明亮式切割钻石，57 个光学切面，另有 16 个腰棱面。
- `scripts/build_ring.py`、`scripts/build_diamond.py`：Blender 建模脚本。
- `scripts/validate_model.py`、`docs/model-validation.json`、`docs/diamond-validation.json`：几何校验及结果。

金色槽带的开放面与封闭背面沿戒圈完整翻转一周。银珠半径 0.195；10 颗钻石腰围半径 0.29（直径较原版增加约 57%），台面随槽口方向转动。10 颗钻石均无戒托表面相交，邻石包围球保留正间距。

钻石使用 IOR 2.417 附近的三波段折射率、菲涅耳反射与全反射，加上真实切面和 HDR 光源形成火彩。色散为 RGB 三波段近似，不是完整光谱求解；没有使用彩虹贴图或绘制闪光。Safari 的通用折射路径存在发黑问题，钻石已改用独立的抛光介质采样分支，桌面 Safari 已实际复核。

输入没有原始尺寸、CAD 或 KeyShot 材质与灯光，因此这是展示用外观重建，不是原款精确复刻或生产工程模型。真实手机触控、GPU 性能与发热尚未验证。

## 嵌入

在页面地址后添加 `?embed=1` 可隐藏页眉、设置区和页脚，保留画布与查看工具。也可在 Vite / ES Modules 项目中使用查看器：

```js
import { RingViewer } from './src/viewer.js';
const viewer = new RingViewer(container, { onStatus });
await viewer.load();
await viewer.setInlay('diamond'); // silver / diamond
viewer.setView('hero'); // front / side
viewer.setLighting('black'); // soft / warm
// 卸载时
viewer.dispose();
```

依赖固定为 Three.js 0.180.0、three-gpu-pathtracer 0.0.24、three-mesh-bvh 0.9.1。详见 `docs/implementation-notes.md`。这些几何均由项目生成。
