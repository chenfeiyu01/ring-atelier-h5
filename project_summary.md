# Ring Atelier H5

## 目标与入口

在 Documents/ring-atelier-h5 提供可拖拽的真实三维戒指，依据用户的视频与截图重建内外翻转槽带。当前加入银珠 / 钻石选择，并继续优化光影与松手后的精细化速度。用户明确要求最终部署到 GitHub Pages，本轮不更新 GPT Sites。

入口 src/main.js，开发 npm run dev（5186），生产构建 npm run build。独立嵌入 ?embed=1。已发布到 https://chenfeiyu01.github.io/ring-atelier-h5/ ，源码仓库 chenfeiyu01/ring-atelier-h5；工作流 .github/workflows/pages.yml，Pages 发布 dist。

## 关键文件

- src/viewer.js：载入模型、选择镶嵌、相机与灯光、路径追踪及调度。
- src/diamond-optics.js：固定版追踪器的钻石介质与三波段色散分支。
- src/motion-denoise.js：几何重投影、历史积累与边界保护。
- src/studio.js：自生成 HDR 摄影棚；钻石增加小型中性灯板。
- src/main.js / src/style.css：桌面和 H5 布局、控件与原片。
- scripts/build_ring.py / build_diamond.py：Blender 模型生成。
- models/*.blend、public/models/*.glb：编辑源及网页模型。
- docs/model-validation.json、diamond-validation.json、qa/：几何、画面与性能证据。

## 不可误改的结构与画质决定

戒托是一条带封闭背面的槽带，截面完整翻转一周，开放面和背面一起交换内外方向。不能增加固定内筒。当前 20 颗银珠，戒圈中轴半径 1.30，珠子半径 0.195。钻石为 57 光学切面 + 16 腰棱面，半径 0.185，台面随槽口转动。

所有设备仅精细模式，无自动旋转。运动仍路径追踪并使用有效历史细节，不回退普通材质，也不用大范围模糊掩盖噪点。最终完整分辨率 192 样本；一般反弹 8 次，钻石可额外内部遍历 12 次。关闭该 HDR 镜面场景的环境 MIS，16 样本后每帧两次采样，减少重复合成与历史写入，最终去噪更轻。实测耗时由 docs/qa 给出，不能把旧 48 样本版本的一秒完成当作当前指标。

Apple 浏览器的金属 clearcoat 绕过继续保留；钻石联合着色器在本机 Chromium 也复现相同清漆问题，因此钻石模式统一关闭这层，切回银珠恢复原参数。新增钻石在原通用透射路径中会发黑，专用抛光介质分支已在桌面 Safari 恢复；色散是三波段近似，不是完整光谱渲染。切换镶嵌重建 BVH 与引导缓冲，避免旧材质历史污染。

## 验证与边界

现有银珠与戒托校验继续有效。钻石为封闭、正体积、平面切面且凸的网格；20 颗均不与戒托相交，邻石包围球最小间距约 0.01437。构建、桌面 Chromium、Safari、窄屏与发布验证的最终状态见 docs/qa/README.md。

尚无真实手机 GPU、触控和发热验收。视频未给出原始 CAD、尺寸、材料或灯光，当前是展示用视觉重建，不是生产模型或 KeyShot 精确复制。原 Sites 站点保留历史版本；后续发布入口改为 GitHub Pages。

## GitHub 发布验证

2026-10-10，运行 37973088616 发布成功，部署代码提交 c4601fa4e2386df909568029626fda2341af45a9。线上 9 个资源 HTTP 200 且 SHA-256 与本地构建一致；实际打开公网页面，银珠与钻石显示、拖拽、缩放和重置通过，未见应用错误或警告。证据见 docs/qa/github-release.json 与 github-interaction.png。后续文档提交不改变已验证的运行时代码。
