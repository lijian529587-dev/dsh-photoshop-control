# dsh-photoshop-control

DeepSeek Harness 的宿主侧插件：让 Harness 里的智能体直接接管本机 Windows 上的 Adobe Photoshop。
它把 Photoshop 的 COM 自动化封装成 14 个结构化工具，不依赖 Python、不依赖任何 npm 包。

## 安装

从本仓库根目录执行（插件通过 `link:` 安装，仓库内的 `scripts/photoshop_bridge.ps1` 即被使用）：

```powershell
dsh plugin --profile <你的 profile> add ./dsh-plugin
```

装完刷新页面，工具列表里会出现 `photoshop_status` 等 14 个工具。

## 工具

| 工具 | 用途 |
| --- | --- |
| `photoshop_status` | 确认能否连上 Photoshop，并读取当前文档 |
| `photoshop_find_progids` | 枚举本机注册的 Photoshop COM ProgID（不启动 PS） |
| `photoshop_open_image` | 打开本地图片 |
| `photoshop_create_document` | 新建画布（尺寸、分辨率、背景色/透明） |
| `photoshop_place_image` | 把图片作为图层放入，支持位置、缩放、透明度、混合模式 |
| `photoshop_add_text_layer` | 添加可编辑文字层 |
| `photoshop_layer_ops` | 列出/选择/重命名/显示/隐藏/删除图层，设置透明度与混合模式 |
| `photoshop_draw_paths` | 创建可编辑矢量路径，可选描边成墨迹层 |
| `photoshop_adjust_image` | 裁切、缩放、亮度、对比度、锐化、另存 |
| `photoshop_export_active` | 导出 PNG / JPEG / TIFF / PSD |
| `photoshop_apply_overlay` | 贴入透明叠加层并精确对齐 |
| `photoshop_texture_recolor` | 局部换色，用 COLOR 混合保留原始纹理与光影 |
| `photoshop_run_jsx` | 执行任意 ExtendScript（兜底手段） |
| `photoshop_batch` | 顺序执行多个工具调用 |

## 实现

```
dsh-plugin/
  lib/index.js                  # cordis 插件，注册工具，转发到 PowerShell
  cordis.patch.yml              # bundle patch，插入 photoshop-control 行
  scripts/photoshop_bridge.ps1  # 与仓库根 scripts/ 下的文件保持同步
```

`lib/index.js` 把参数写进临时 JSON 文件，再以 `-File ... -JsonFile` 调用 PowerShell 桥，
参数不经过命令行解析；桥脚本通过 `Marshal::GetActiveObject` / `New-Object -ComObject`
连接 Photoshop，并用 `DoJavaScript` 执行生成的 ExtendScript。

## 配置

- `PHOTOSHOP_PROG_ID`：固定要连接的 ProgID，例如 `Photoshop.Application.2024`。
- `PHOTOSHOP_BRIDGE`：桥脚本的绝对路径（默认自动定位）。
- 每次调用都可传 `progId` 与 `timeoutSeconds`；首次冷启动 Photoshop 建议放宽超时。

## 平台

仅 Windows。需要本机安装 Photoshop 或 Photoshop Beta，并注册了
`Photoshop.Application*` 形式的 COM ProgID；用 `photoshop_find_progids` 可以确认。

## 安全

- `photoshop_run_jsx` 会在 Photoshop 进程内执行任意 ExtendScript，而 ExtendScript 具备本机文件读写能力；把它当作"允许执行任意脚本"来对待。
- 插件本身不联网、不上传文件、不写注册表、不创建持久化项。
- 桥脚本以 `-ExecutionPolicy Bypass` 启动 PowerShell。
