# DSH Photoshop Control | DeepSeek Harness 本地 PS 插件

> 让 DeepSeek Harness (DSH) 真的接管本地 Photoshop：新建画布、放图、加字、改色、画可编辑路径、批量导出，一套面向设计和办公自动化的本地 MCP 插件。

让 DeepSeek Harness (DSH) 通过本地 MCP 插件控制 Windows 上的 Adobe Photoshop / Photoshop Beta，完成图片打开、画布创建、图层编辑、可编辑路径绘制、质感换色、批量导出等真实办公和设计自动化任务。

> 这是本地自动化桥接工具，不是 Adobe 官方插件。它依赖 Photoshop 的 Windows COM 自动化能力和 ExtendScript。

![Architecture](assets/architecture.svg)

## 能做什么

- 检查本机 Photoshop 状态、当前文档尺寸、分辨率和模式。
- 打开本地图片，新建指定尺寸画布。
- 放置图片为新图层，设置位置、尺寸、透明度和混合模式。
- 添加可继续编辑的文字图层。
- 创建可编辑 Photoshop 路径，并可用当前画笔描边成可见线稿层。
- 列出、选择、重命名、隐藏、删除图层，设置透明度和混合模式。
- 进行常见图片处理：裁切、缩放、亮度、对比度、锐化、导出。
- 进行更自然的局部换色：用多边形蒙版保留纹理、褶皱、高光和阴影。
- 执行批处理工作流，一次完成"新建画布 -> 放图 -> 加字 -> 导出"等操作。
- 在结构化工具不够时运行自定义 JSX。
