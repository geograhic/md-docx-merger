// 纯 Node 测试：真实跑引擎，校验产出的 docx/md 是否真的有效。
// 运行：node test/run-tests.mjs
import JSZip from 'jszip';
import { runEngine } from '../src/core/engine.js';
import { mdToDocxBytes } from '../src/core/markdownToDocx.js';
import { DEFAULT_STYLE_CONFIG } from '../src/core/styles.js';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function pngBytes() { return Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0)); }

const sample1 = `---
title: 测试文档
tags: [a, b]
---
# 一级标题
这是 **加粗** 与 *斜体* 以及 \`行内代码\`。

## 二级标题
- 列表项一
- 列表项二
  - 嵌套项

> 引用第一行
> 引用第二行

| 列1 | 列2 |
| --- | --- |
| A | B |

\`\`\`js
console.log('hello');
\`\`\`

![示意图](sample.png)

==高亮文本== 与 ~~删除线~~
`;

const sample2 = `# 第二篇文档
普通段落内容。

1. 有序一
2. 有序二

---

换行后继续书写。
`;

function makeFiles() {
  const images = new Map();
  images.set('sample.png', { data: pngBytes(), type: 'png' });
  return {
    images,
    files: [
      { name: '笔记一.md', kind: 'md', text: sample1, created: 1000, modified: 2000 },
      { name: '笔记二.md', kind: 'md', text: sample2, created: 3000, modified: 4000 },
    ],
  };
}

function baseSettings(over) {
  return {
    mode: 'convert_merge', sort: '手动顺序', wordJoin: '直接连续拼接', mdJoin: '直接连续拼接',
    filenameTitle: '不带后缀', keepSingle: true, styleConfig: DEFAULT_STYLE_CONFIG, ...over,
  };
}

async function loadDocx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const docXml = await zip.file('word/document.xml').async('string');
  const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/'));
  return { zip, docXml, media };
}
function countParas(docXml) { return (docXml.match(/<w:p[\s>]/g) || []).length; }
function countTables(docXml) { return (docXml.match(/<w:tbl[\s>]/g) || []).length; }

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}

async function main() {
  const { images, files } = makeFiles();

  // ---- 1. convert_only ----
  console.log('[1] convert_only');
  {
    const r = await runEngine({ files, settings: baseSettings({ mode: 'convert_only', keepSingle: true }), images });
    check('返回 2 个转换结果', r.converted.length === 2);
    check('无失败', !r.failed);
    const { docXml, media } = await loadDocx(r.converted[0].data);
    check('段落数 > 5', countParas(docXml) > 5);
    check('含“一级标题”', docXml.includes('一级标题'));
    check('含“加粗”', docXml.includes('加粗'));
    check('含表格', countTables(docXml) >= 1);
    check('图片已内嵌(media)', media.length >= 1);
    check('图片被引用(r:embed)', /r:embed="[^"]+"/.test(docXml));
  }

  // ---- 2. convert_merge (blank_line) ----
  console.log('[2] convert_merge + 空行拼接');
  {
    const r = await runEngine({ files, settings: baseSettings({ mode: 'convert_merge', keepSingle: true, wordJoin: '空行拼接' }), images });
    check('无失败', !r.failed);
    check('有合并 docx', !!r.mergedDocx);
    check('保留单个转换', r.converted.length === 2);
    const { docXml } = await loadDocx(r.mergedDocx);
    check('合并文含“一级标题”', docXml.includes('一级标题'));
    check('合并文含“第二篇文档”', docXml.includes('第二篇文档'));
    check('含 sectPr', /<w:sectPr[\s>]/.test(docXml));
  }

  // ---- 3. md_merge (horizontal_rule) ----
  console.log('[3] md_merge + 分隔线拼接');
  {
    const r = await runEngine({ files, settings: baseSettings({ mode: 'md_merge', mdJoin: '分隔线拼接' }), images });
    check('无失败', !r.failed);
    check('有合并 md', typeof r.mergedMd === 'string' && r.mergedMd.length > 0);
    check('md 含“一级标题”', r.mergedMd.includes('一级标题'));
    check('md 含“第二篇文档”', r.mergedMd.includes('第二篇文档'));
    check('md 含分隔线', r.mergedMd.includes('---'));
  }

  // ---- 4. mixed_merge：图片放在非首个来源，验证跨文件 media 重写 ----
  console.log('[4] mixed_merge + 分页拼接（含图片，图片在第二个来源）');
  {
    const docxPlain = await mdToDocxBytes(sample2, { styleConfig: DEFAULT_STYLE_CONFIG }); // 无图片
    const mixedFiles = [
      { name: 'plain.md', kind: 'md', text: sample2, created: 1000, modified: 2000 },
      { name: 'withimg.md', kind: 'md', text: sample1, created: 3000, modified: 4000 },
      { name: '已存在.docx', kind: 'docx', bytes: docxPlain, created: 5000, modified: 6000 },
    ];
    const r = await runEngine({ files: mixedFiles, settings: baseSettings({ mode: 'mixed_merge', keepSingle: true, wordJoin: '分页拼接' }), images });
    check('无失败', !r.failed);
    check('有合并 docx', !!r.mergedDocx);
    const { zip, docXml, media } = await loadDocx(r.mergedDocx);
    check('合并文含“第二篇文档”(plain)', docXml.includes('第二篇文档'));
    check('合并文含“一级标题”(withimg)', docXml.includes('一级标题'));
    check('图片媒体被并入合并文(media/merged_)', media.some((m) => /media\/merged_/.test(m)));
    check('合并文 r:embed 指向新 rId', /r:embed="rIdM\d+"/.test(docXml));
    // 所有 r:embed 都必须能在 rels 中找到，否则图片引用会断
    const relsXml = await zip.file('word/_rels/document.xml.rels').async('string');
    const relIds = new Set([...relsXml.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
    const embeds = [...docXml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]);
    const allResolve = embeds.every((id) => relIds.has(id));
    check('所有 r:embed 均在 rels 中存在(无断图)', allResolve);
  }

  // ---- 5. filename_heading ----
  console.log('[5] convert_merge + 文件名标题拼接');
  {
    const r = await runEngine({ files, settings: baseSettings({ mode: 'convert_merge', keepSingle: false, wordJoin: '文件名标题拼接', filenameTitle: '不带后缀' }), images });
    check('无失败', !r.failed);
    const { docXml } = await loadDocx(r.mergedDocx);
    check('含 Heading1 样式段落', docXml.includes('Heading1'));
    check('含文件名“笔记一”作为标题', docXml.includes('笔记一'));
    check('含文件名“笔记二”作为标题', docXml.includes('笔记二'));
  }

  // ---- 6. 排序验证 ----
  console.log('[6] 排序（文件名 Z-A）');
  {
    const r = await runEngine({ files, settings: baseSettings({ mode: 'convert_only', sort: '文件名 Z-A' }), images });
    check('无失败', !r.failed);
    // 排序后第一个应是“笔记二”
    const { docXml } = await loadDocx(r.converted[0].data);
    check('排序后首个为 笔记二', docXml.includes('第二篇文档'));
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('测试崩溃:', e); process.exit(2); });
