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

  // ---- 7. mixed_merge 仅含 DOCX：修复“点了没反应”的 bug ----
  console.log('[7] mixed_merge + 仅 DOCX 文件');
  {
    const docxA = await mdToDocxBytes('# 文档 A\n正文 A。', { styleConfig: DEFAULT_STYLE_CONFIG });
    const docxB = await mdToDocxBytes('# 文档 B\n正文 B。', { styleConfig: DEFAULT_STYLE_CONFIG });
    const onlyDocx = [
      { name: 'a.docx', kind: 'docx', bytes: docxA, created: 1, modified: 2 },
      { name: 'b.docx', kind: 'docx', bytes: docxB, created: 3, modified: 4 },
    ];
    const r = await runEngine({ files: onlyDocx, settings: baseSettings({ mode: 'mixed_merge', wordJoin: '空行拼接' }), images });
    check('无失败', !r.failed);
    check('有合并 docx', !!r.mergedDocx);
    const { docXml } = await loadDocx(r.mergedDocx);
    check('合并文含“文档 A”', docXml.includes('文档 A'));
    check('合并文含“文档 B”', docXml.includes('文档 B'));
    check('无单个转换结果', r.converted.length === 0);
  }

  // ---- 8. mixed_merge MD/DOCX 交错：合并顺序必须与列表一致 ----
  console.log('[8] mixed_merge + MD/DOCX 交错排序');
  {
    const docxA = await mdToDocxBytes('# DOCX A\nDOCX 正文 A。', { styleConfig: DEFAULT_STYLE_CONFIG });
    const docxB = await mdToDocxBytes('# DOCX B\nDOCX 正文 B。', { styleConfig: DEFAULT_STYLE_CONFIG });
    const mixed = [
      { name: '01_docx.docx', kind: 'docx', bytes: docxA, created: 1, modified: 2 },
      { name: '02_md.md', kind: 'md', text: '# MD 一\nMD 正文一。', created: 3, modified: 4 },
      { name: '03_docx.docx', kind: 'docx', bytes: docxB, created: 5, modified: 6 },
      { name: '04_md.md', kind: 'md', text: '# MD 二\nMD 正文二。', created: 7, modified: 8 },
    ];
    const r = await runEngine({ files: mixed, settings: baseSettings({ mode: 'mixed_merge', wordJoin: '直接连续拼接' }), images });
    check('无失败', !r.failed);
    check('有合并 docx', !!r.mergedDocx);
    const { docXml } = await loadDocx(r.mergedDocx);
    const iA = docXml.indexOf('DOCX A');
    const iM1 = docXml.indexOf('MD 一');
    const iB = docXml.indexOf('DOCX B');
    const iM2 = docXml.indexOf('MD 二');
    check('DOCX A 在 MD 一 之前', iA >= 0 && iA < iM1);
    check('MD 一 在 DOCX B 之前', iM1 >= 0 && iM1 < iB);
    check('DOCX B 在 MD 二 之前', iB >= 0 && iB < iM2);
  }

  // ---- 9. mixed_merge 仅含“精简/导出”DOCX（缺 word/_rels/document.xml.rels 等可选部件）----
  // 回归：docxMerge 必须对这些缺省可选部件的 docx 容错，而不是整次合并崩溃。
  console.log('[9] mixed_merge + 精简 DOCX（缺可选部件）容错');
  {
    // 用 helper 生成真正的精简 docx（只含 document.xml + 必要 [Content_Types].xml，无 rels/media）
    function buildMinimal(text) {
      const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
      const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
      const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;
      const z = new JSZip();
      z.file('[Content_Types].xml', ct);
      z.file('_rels/.rels', rels);
      z.file('word/document.xml', doc);
      // 注意：故意不写入 word/_rels/document.xml.rels，模拟“精简/导出”docx
      return z.generateAsync({ type: 'uint8array' });
    }
    const docxA = await buildMinimal('精简文档 A 内容');
    const docxB = await buildMinimal('精简文档 B 内容');
    const onlyDocx = [
      { name: 'min-a.docx', kind: 'docx', bytes: docxA, created: 1, modified: 2 },
      { name: 'min-b.docx', kind: 'docx', bytes: docxB, created: 3, modified: 4 },
    ];
    const r = await runEngine({ files: onlyDocx, settings: baseSettings({ mode: 'mixed_merge', wordJoin: '空行拼接' }), images });
    check('无失败', !r.failed);
    check('有合并 docx', !!r.mergedDocx);
    if (r.mergedDocx) {
      const { zip, docXml } = await loadDocx(r.mergedDocx);
      check('合并文含“精简文档 A”', docXml.includes('精简文档 A'));
      check('合并文含“精简文档 B”', docXml.includes('精简文档 B'));
      // 输出必须是结构完整的 docx（至少包含 document.xml.rels 与 Content_Types）
      check('输出含 word/_rels/document.xml.rels', !!zip.file('word/_rels/document.xml.rels'));
      check('输出含 [Content_Types].xml', !!zip.file('[Content_Types].xml'));
    }
  }

  // ---- 10. mixed_merge 合并“真实 Word 风格”DOCX 时，[Content_Types].xml 必须保留 <Override> ----
  // 这是防止合并后 Word 报 "unreadable content" 的回归测试。
  console.log('[10] mixed_merge + 真实风格 DOCX（含 Override）');
  {
    function realStyleDocx(text) {
      const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
      const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="word/styles.xml"/></Relationships>';
      const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;
      const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
      const z = new JSZip();
      z.file('[Content_Types].xml', ct);
      z.file('_rels/.rels', rels);
      z.file('word/document.xml', doc);
      z.file('word/styles.xml', styles);
      z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
      return z.generateAsync({ type: 'uint8array' });
    }
    const docxA = await realStyleDocx('真实 Word 文档 A');
    const docxB = await realStyleDocx('真实 Word 文档 B');
    const realDocx = [
      { name: 'real-a.docx', kind: 'docx', bytes: docxA, created: 1, modified: 2 },
      { name: 'real-b.docx', kind: 'docx', bytes: docxB, created: 3, modified: 4 },
    ];
    const r = await runEngine({ files: realDocx, settings: baseSettings({ mode: 'mixed_merge', wordJoin: '空行拼接' }), images });
    check('无失败', !r.failed);
    check('有合并 docx', !!r.mergedDocx);
    if (r.mergedDocx) {
      const { zip, docXml } = await loadDocx(r.mergedDocx);
      check('合并文含“真实 Word 文档 A”', docXml.includes('真实 Word 文档 A'));
      check('合并文含“真实 Word 文档 B”', docXml.includes('真实 Word 文档 B'));
      const ctOut = await zip.file('[Content_Types].xml').async('string');
      check('输出保留 document.xml 的 Override', ctOut.includes('PartName="/word/document.xml"'));
      check('输出保留 styles.xml 的 Override', ctOut.includes('PartName="/word/styles.xml"'));
    }
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('测试崩溃:', e); process.exit(2); });
