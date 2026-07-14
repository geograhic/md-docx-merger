# Markdown 批量转 Word / 合并 · 网页版

纯前端、本地运行的 Markdown ↔ Word 批处理工具。所有转换与合并都在你的**浏览器本地**完成，文件**不会上传到任何服务器**。

> 本仓库由桌面版（Python/Tkinter）`md_docx_merger` v2.0 改造而来，功能与界面在浏览器中重建。

## 功能

- **4 种模式**
  - Markdown 转 Word（每个 `.md` 生成独立 `.docx`）
  - 转 Word 后合并（转换并合并为一个 Word 文档）
  - 混合 Word / Markdown 合并（Word 与原 Markdown 一起合并）
  - 合并 Markdown 原文（直接拼接多个 Markdown 文本）
- 丰富的 Markdown 支持：标题、加粗/斜体、行内代码、代码块、有序/无序列表（含嵌套）、引用、表格、分隔线、Obsidian 语法归一化（front matter、callout、`==高亮==`、`~~删除~~`、wikilink 等）
- **图片本地内嵌**：上传 Markdown 时一并选入图片文件，按文件名匹配内嵌进 Word（数据不出本机）
- 样式配置（字体 / 字号 / 加粗，覆盖 h1–h6 / 正文 / 代码）
- 文件排序（文件名 / 创建 / 修改时间）、上移下移、拖放添加
- 实时预览、任务进度、结果打包为 `.zip` 下载
- 响应式设计，电脑 / 手机均可使用

## 本地开发

```bash
npm install
npm run dev        # 本地开发服务器
npm run build      # 生产构建到 dist/
npm test           # 运行引擎/UI 自动化测试（共 47 项断言）
```

## 部署（上线到 apps.endril.com/md-docx-merger）

详见 [README_部署说明.md](./README_部署说明.md)。

## 改造说明

详见 [MIGRATION_ANALYSIS.md](./MIGRATION_ANALYSIS.md)。
