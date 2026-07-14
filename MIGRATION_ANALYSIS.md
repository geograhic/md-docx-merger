# 改造分析（桌面版 → 网页版）

## 1. 原项目概况

源项目 `md_docx_merger` v2.0 是一个 **Python + Tkinter 桌面应用**，核心依赖：

| 依赖 | 用途 |
| --- | --- |
| `python-docx` | 生成 / 读取 / 合并 `.docx`（OOXML） |
| `markdown` + `markdown.extensions` | Markdown → HTML |
| `beautifulsoup4` | 把 HTML 解析为 DOM 树再转 docx 段落 |
| `pywin32` (win32com) | `.doc` → `.docx`（依赖本机 Word COM） |
| `tkinter` | 桌面 GUI、文件选择框、进度条 |

## 2. 为什么不能直接套用 skill 的「Electron → Vite」流程

`local-app-to-web` skill 的默认假设是「Electron/Node 外壳 + 浏览器代码」，做法通常是：
扫描 `require('electron')`、把 `<script src=vendor>` 换成 `import`、把 `onclick` 挂到 `window`。
**但本工程没有任何浏览器代码**——全部逻辑在 Python 里，且重度依赖 `python-docx` 这种只有 Python 的库。
因此本仓库是**逻辑重建**，而非代码搬运：

- 原来的「转换/合并引擎」在浏览器中**完整重写**为 JavaScript（纯函数、DOM 无关，便于测试）；
- 原来的「Tkinter 界面」重写为 **Vite + 原生 JS** 的现代化 Web UI；
- 原来的「文件系统读写」替换为浏览器 **File API / Blob / JSZip 下载**。

## 3. 依赖映射

| 桌面版 | 网页版 | 说明 |
| --- | --- | --- |
| `markdown` + `beautifulsoup4` | `markdown-it` | 用 token 化渲染（非 HTML→DOM），产出 docx.js 元素，更可控 |
| `python-docx`（生成） | `docx` (docx.js) | 浏览器内生成真实 `.docx`，`Packer.toBlob` 下载 |
| `python-docx`（读/合并） | `jszip` + 直接操作 `document.xml` | 拼接多个 docx 的 body，重写图片 `r:embed` 与 `media/rels` |
| `tkinter.filedialog` | `<input type=file>` / 拖放 / `FileReader` | 文件选择、读取文本/二进制 |
| `tkinter` 进度条 | `<progress>` + 状态文本 | 实时进度 |
| `pywin32` (.doc→.docx) | **已舍弃** | 浏览器无法调用 Word COM，仅支持 `.md` 与 `.docx` |
| 配置文件 / 任务日志（写磁盘） | 浏览器内生成日志，随结果 `.zip` 下载 | 无后端、无持久化 |

## 4. 丢弃 / 不可移植的部分

- **`.doc` → `.docx` 转换**：依赖 Microsoft Word COM，浏览器环境不可能实现；Web 版仅接受 `.md` 与 `.docx`。
- **Tkinter 桌面壳**、**Windows 专用 API**（`os.startfile` 等）。
- **磁盘配置/日志持久化**：改为每次任务在浏览器内生成日志，并入结果压缩包。

## 5. 功能保真度

- **4 种模式全部实现**：MD→Word / 转 Word 后合并 / 混合 Word+MD 合并 / 合并 MD 原文。
- **样式配置**：字体（含中文 eastAsia）、字号、加粗，覆盖 h1–h6 / 正文 / 代码。
- **排序**：文件名（自然序）/ 创建 / 修改时间，正反向。
- **拼接方式**：直接 / 空行 / 分页 / 分隔线 / 文件名标题（Word 与 Markdown 各自一套）。
- **文件名标题格式**：带后缀 / 不带后缀。
- **图片本地内嵌**：上传时一并选入图片，按文件名匹配内嵌（用户要求「不跳过、本地处理、不占云端」）。
- **Word 合并忠实性**：直接拼接各 docx 的 `<w:body>` 子节点，保留 `sectPr`；遇到图片时复制 `media/` 并重写 `r:embed` 的 `rId` + `Relationships`，避免断图。
- **Obsidian 语法**：front matter、callout、高亮、删除线、wikilink、注释等已归一化。

## 6. 测试与验证

不依赖「推理」，全部用真实构建 + 真实运行验证：

- **引擎测试**（`test/run-tests.mjs`，Node 直接跑引擎，共 32 项断言）：
  Markdown→docx 段落/表格/图片；Word 合并保真；跨文件图片 media 重写且 `r:embed` 全部可解析（无断图）；MD 合并分隔符；混合合并；文件名标题；排序。
- **UI 冒烟**（`test/ui-smoke.mjs`，jsdom 挂载，10 项）：渲染、模式切换可见性、样式表行数。
- **UI 端到端**（`test/ui-e2e.mjs`，jsdom「浏览器路径」）：真实添加文件并 `run()`，
  验证 `Packer.toBlob` + JSZip 打包下载整条链路可用（产出合法 `.zip`）。
- **生产构建**：`npm run build` 成功，且 `dist/index.html` 使用相对路径 `./assets/...`
  （非绝对 `/md-docx-merger/...`），确保 Vercel 根域名与子路径都能正确加载。

合计 **47 项断言全部通过**。
