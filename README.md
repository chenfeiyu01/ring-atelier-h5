# 环 · 观 / Ring Atelier

可拖拽的 H5 三维戒指查看器。本地开发版提供四爪单石、三线抱珠和原视频重建的翻转槽带，四种金属和各款对应的镶嵌选项，所有设备使用渐进精细光影。

## 查看与部署

页面部署到 **GitHub Pages**：https://chenfeiyu01.github.io/ring-atelier-h5/ 。源码仓库：https://github.com/chenfeiyu01/ring-atelier-h5 。

新戒托和小蓝宝石已完成本地预览与浏览器验证，用户于 2026-10-10 同意提交并发布到上述 GitHub Pages。发布结果以 GitHub Actions 及线上验证记录为准。

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
- “戒托”切换三种造型，默认四爪单石；换戒托时回到该款的立体视角。
- “金属”切换 18K 黄金 / 白金 / 玫瑰金 / 铂金，默认铂金，保持当前视角与灯光。
- 四爪单石的“镶嵌”可选银珠 / 钻石 / 蓝宝石；三线抱珠和翻转槽带只提供银珠。进入这两款时自动切为银珠，肩部和排镶小钻保持固定。
- 三套光影：经典黑、柔光棚、暖金光；三种视角：立体、正面、侧面。
- 聚焦画布后，方向键旋转、+ / - 缩放、Home 重置。

首次打开会显示加载和采样进度，达到 192 样本后才展示模型并启用控件。拖动时持续进行路径追踪并复用有效的历史细节；松手约 65ms 后以完整分辨率累计到 192 样本。采用 8 次反弹，钻石另有最多 12 次透射内部遍历。静止阶段合并采样与后处理，减少等待和重复工作；不降低最终样本上限。移动画面和刚显露的表面仍可能有噪点。耗时依赖设备和画面尺寸，实测记录见 `docs/qa/README.md`。

## 模型

- `models/ring.blend` / `public/models/ring.glb`：金色翻转槽带及 20 颗银珠。
- `models/diamond.blend` / `public/models/diamond.glb`：闭合的圆形明亮式切割钻石，57 个光学切面，另有 16 个腰棱面。
- `models/sapphire.blend` / `public/models/sapphire.glb`：独立的椭圆阶梯切型蓝宝石。
- `models/solitaire.blend` / `public/models/solitaire.glb`：四爪、开放花篮托及收腰排镶戒臂。
- `models/interlace.blend` / `public/models/interlace.glb`：三根独立金属圈，一侧以等边三角形截面夹住三颗银珠，对侧只在一个点汇合；两条平面排镶带与一条抛光支持条。
- `scripts/build_ring.py`、`scripts/build_diamond.py`、`scripts/build_sapphire.py`、`scripts/build_mountings.py`：Blender 建模脚本。
- `scripts/validate_model.py`、`docs/model-validation.json`、`docs/diamond-validation.json`：几何校验及结果。

翻转槽带的开放面与封闭背面沿戒圈完整翻转一周，当前本地版固定 20 颗半径 0.195 的银珠。此前公网页面仍可选 10 颗大钻石，历史几何检查保留在 `docs/diamond-validation.json`。

四爪款参考 [Tiffany Harmony 公开产品图](https://www.tiffany.com/engagement/engagement-rings/tiffany-harmony-platinum-diamond-engagement-rings-17166651.html) 的收腰戒臂与四爪比例，采用自行生成的展示几何。两侧 18 颗小钻固定，镶嵌选项切换中心石，蓝宝石使用独立的小椭圆阶梯切型。

三线款依据用户给出的参考图及结构说明：三条金属在每颗银珠处相隔 120°，距珠心 0.335，银珠半径 0.31、条带半厚 0.025；中心线组成等边三角形，内表面贴住珠子。两条外侧带采用平面与小圆角截面，126 颗固定小钻沿两侧延伸，在接近汇合点处渐小；第三条保持抛光。左右两侧保持分开，只在对侧一点汇合，没有共用的半圆戒臂。新戒托检查见 `docs/mounting-validation.json`。

四种金属均采用导体反射、metalness=1、独立粗糙度，不叠加透明清漆。白金按常见镀铑白色黄金处理，与铂金的反射参数分开；参见 [GIA 白色黄金说明](https://4cs.gia.edu/en-us/blog/buying-guide-white-yellow-rose-gold-engagement-rings/)。铂金和银采用公开 RGB 反射率，黄金合金与镀铑外观为 RGB 近似：未提供合金配方，不能视作特定厂商的实测光谱。导体材质约定参考 [Filament](https://github.com/google/filament/blob/main/docs/Filament.md.html)，反射率参考 [Physically Based Shading in Theory and Practice](https://blog.selfshadow.com/publications/s2015-shading-course/hoffman/s2015_pbs_physics_math_slides.pdf)。银珠保持银材质，不随戒托金属变色。

钻石使用 IOR 2.417 附近的三波段折射率、菲涅耳反射与全反射，加上真实切面和 HDR 光源形成火彩。色散为 RGB 三波段近似，不是完整光谱求解；没有使用彩虹贴图或绘制闪光。Safari 的通用折射路径存在发黑问题，钻石已改用独立的抛光介质采样分支，桌面 Safari 已实际复核。

输入没有原始尺寸、CAD 或 KeyShot 材质与灯光，因此这是展示用外观重建，不是原款精确复刻或生产工程模型。真实手机触控、GPU 性能与发热尚未验证。

## 嵌入

在页面地址后添加 `?embed=1` 可隐藏页眉、设置区和页脚，保留画布与查看工具。也可在 Vite / ES Modules 项目中使用查看器：

```js
import { RingViewer } from './src/viewer.js';
const viewer = new RingViewer(container, { onStatus });
await viewer.load();
await viewer.setMounting('solitaire'); // solitaire / interlace / ribbon
await viewer.setInlay('sapphire'); // solitaire: silver / diamond / sapphire; other settings: silver
viewer.setMetal('yellow'); // yellow / white / rose / platinum
viewer.setView('hero'); // front / side
viewer.setLighting('black'); // soft / warm
// 卸载时
viewer.dispose();
```

依赖固定为 Three.js 0.180.0、three-gpu-pathtracer 0.0.24、three-mesh-bvh 0.9.1。详见 `docs/implementation-notes.md`。这些几何均由项目生成。

独立蓝宝石基础模型宽 0.25、长 0.36、高 0.16，四爪款使用一颗并按托位缩放 1.65 倍，采用 IOR 1.766 和蓝色介质吸收。蓝宝石未使用钻石网格，且不采用钻石的 RGB 色散分支。折射率参考 [GIA 蓝宝石资料](https://www.gia.edu/CN/sapphire)；不模拟双折射或包裹体。先前 20 颗槽带蓝宝石的几何检查保留为历史数据，当前不再提供该组合。等待用户本地验收后再提交和发布。
