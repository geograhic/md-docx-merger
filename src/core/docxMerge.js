// Word (.docx) 合并引擎：直接操作 document.xml 把多个 docx 的 body 顺序拼接。
// 图片（r:embed）通过重写 rId + 合并 media/rels 保持有效。纯前端，浏览器/Node 通用。
import JSZip from 'jszip';

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const IMG_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 把一段 XML 拆成顶层元素片段数组（不依赖 DOM，避开命名空间解析坑）。
function splitTopLevel(xml) {
  const frags = [];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    if (xml[i] === '<') {
      const closeBracket = xml.indexOf('>', i);
      if (closeBracket === -1) break;
      const tagStr = xml.slice(i, closeBracket + 1);
      if (tagStr.endsWith('/>')) {
        frags.push(tagStr);
        i = closeBracket + 1;
        continue;
      }
      const nameMatch = /<(\/?)([^\s\/>]+)/.exec(tagStr);
      if (!nameMatch) { i = closeBracket + 1; continue; }
      const isClose = nameMatch[1] === '/';
      const name = nameMatch[2];
      if (isClose) { i = closeBracket + 1; continue; }
      let depth = 1;
      let j = closeBracket + 1;
      while (j < n && depth > 0) {
        const lt = xml.indexOf('<', j);
        if (lt === -1) break;
        const gt = xml.indexOf('>', lt);
        if (gt === -1) break;
        const t = xml.slice(lt, gt + 1);
        const nm = /<(\/?)([^\s\/>]+)/.exec(t);
        if (nm) {
          if (nm[1] === '/') depth--;
          else if (!t.endsWith('/>')) depth++;
        }
        j = gt + 1;
        if (depth === 0) { frags.push(xml.slice(i, j)); break; }
      }
      i = j;
    } else {
      i++;
    }
  }
  return frags;
}

function isSectPr(frag) {
  return /^<w:sectPr[\s>]/i.test(frag.trim());
}

function getBodyInner(docXml) {
  const m = /<w:body[^>]*>([\s\S]*?)<\/w:body>/i.exec(docXml);
  return m ? m[1] : '';
}

// ---------- rels 解析/序列化 ----------
function parseRels(relsStr) {
  const rels = [];
  const re = /<Relationship\s+([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(relsStr))) {
    const attrs = m[1];
    const id = /Id="([^"]+)"/i.exec(attrs);
    const type = /Type="([^"]+)"/i.exec(attrs);
    const target = /Target="([^"]+)"/i.exec(attrs);
    if (id && target) {
      rels.push({ id: id[1], type: type ? type[1] : '', target: target[1] });
    }
  }
  return rels;
}
function serializeRels(rels) {
  const items = rels
    .map((r) => `    <Relationship Id="${escapeXml(r.id)}" Type="${escapeXml(r.type)}" Target="${escapeXml(r.target)}"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">\n${items}\n</Relationships>`;
}
function nextRelId(rels) {
  let max = 100;
  for (const r of rels) {
    const m = /(\d+)/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

// ---------- ContentTypes 解析/序列化 ----------
function parseContentTypes(ctStr) {
  const defaults = {};
  const re = /<Default\s+([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(ctStr))) {
    const ext = /Extension="([^"]+)"/i.exec(m[1]);
    const ct = /ContentType="([^"]+)"/i.exec(m[1]);
    if (ext && ct) defaults[ext[1].toLowerCase()] = ct[1];
  }
  return defaults;
}
function serializeContentTypes(defaults) {
  const items = Object.entries(defaults)
    .map(([ext, ct]) => `    <Default Extension="${escapeXml(ext)}" ContentType="${escapeXml(ct)}"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n${items}\n</Types>`;
}
const IMG_CT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };
function ensureContentType(defaults, ext) {
  const e = (ext || '').toLowerCase();
  if (!defaults[e] && IMG_CT[e]) defaults[e] = IMG_CT[e];
}

function resolveMediaPath(target) {
  let t = (target || '').replace(/^\.\//, '');
  if (/^word\//i.test(t)) return t;
  return 'word/' + t;
}

function headingFrag(name) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(name)}</w:t></w:r></w:p>`;
}
const HR_FRAG = '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>';

// 处理一个来源 docx（index>=1），返回重写后的 body 片段，并把图片 media/rels 合并进 merged zip。
async function processSource(zip, buf, index, joinMode, getName, merged, rels, contentTypes, counter) {
  const docXml = await zip.file('word/document.xml').async('string');
  const frags = splitTopLevel(getBodyInner(docXml)).filter((f) => !isSectPr(f));

  // 收集用到的 r:embed
  const usedRids = new Set();
  for (const f of frags) {
    const re = /r:embed="([^"]+)"/g;
    let m;
    while ((m = re.exec(f))) usedRids.add(m[1]);
  }

  // 来源自身的 rels
  const srcRelsStr = await zip.file('word/_rels/document.xml.rels')?.async('string') || '';
  const srcRels = parseRels(srcRelsStr);
  const ridMap = {};
  for (const oldRid of usedRids) {
    const rel = srcRels.find((r) => r.id === oldRid);
    if (!rel || !/media/i.test(rel.target)) continue;
    const newRid = 'rIdM' + (counter.n++);
    ridMap[oldRid] = newRid;
    const mediaPath = resolveMediaPath(rel.target);
    const data = await zip.file(mediaPath)?.async('uint8array');
    if (data) {
      const ext = (rel.target.split('.').pop() || 'png').toLowerCase();
      const newName = `media/merged_${index}_${oldRid}.${ext}`;
      merged.file('word/' + newName, data);
      ensureContentType(contentTypes, ext);
      rels.push({ id: newRid, type: IMG_REL_TYPE, target: newName });
    }
  }

  let result = frags;
  if (Object.keys(ridMap).length) {
    result = frags.map((f) => {
      let s = f;
      for (const [oldR, newR] of Object.entries(ridMap)) {
        s = s.split(`r:embed="${oldR}"`).join(`r:embed="${newR}"`);
      }
      return s;
    });
  }
  return result;
}

// 对外：合并多个 docx 字节为单个 docx 字节。
export async function mergeDocxBytes(buffers, opts = {}) {
  const { joinMode = 'direct', filenameTitleMode = 'stem', getName, onWarn } = opts;
  if (!buffers || buffers.length === 0) throw new Error('没有可合并的 Word 文件');

  if (buffers.length === 1) {
    if (joinMode === 'filename_heading' && getName) {
      return prependHeadingToDocxBytes(buffers[0], getName(0));
    }
    return buffers[0];
  }

  const base = await JSZip.loadAsync(buffers[0]);
  const baseDocFile = base.file('word/document.xml');
  if (!baseDocFile) throw new Error('Word 文档缺少 word/document.xml，无法合并');
  const baseDocXml = await baseDocFile.async('string');
  const baseFrags = splitTopLevel(getBodyInner(baseDocXml));
  const baseSectPr = baseFrags.find(isSectPr) || '';
  const baseContent = baseFrags.filter((f) => !isSectPr(f));

  const merged = await JSZip.loadAsync(buffers[0]); // 以 base 为基底（自带 styles/rels/media）
  // 部分（导出/精简）docx 可能没有 document.xml.rels 或 [Content_Types].xml，缺失时按空处理，避免整次合并崩溃
  const relsStr = (await base.file('word/_rels/document.xml.rels')?.async('string')) || '';
  const rels = parseRels(relsStr);
  const counter = { n: nextRelId(rels) };
  const ctStr = (await base.file('[Content_Types].xml')?.async('string')) || '';
  const contentTypes = ctStr ? parseContentTypes(ctStr) : {};

  const bodyFrags = [...baseContent];

  // 第一个文件在 filename_heading 模式下也要加文件名标题
  if (joinMode === 'filename_heading' && getName) {
    bodyFrags.unshift(headingFrag(getName(0)));
  }

  for (let i = 1; i < buffers.length; i++) {
    if (joinMode === 'page_break') bodyFrags.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    else if (joinMode === 'blank_line') bodyFrags.push('<w:p/>');
    else if (joinMode === 'horizontal_rule') bodyFrags.push(HR_FRAG);
    if (joinMode === 'filename_heading' && getName) bodyFrags.push(headingFrag(getName(i)));

    const zip = await JSZip.loadAsync(buffers[i]);
    const srcFrags = await processSource(zip, buffers[i], i, joinMode, getName, merged, rels, contentTypes, counter);
    bodyFrags.push(...srcFrags);
  }

  if (baseSectPr) bodyFrags.push(baseSectPr);

  const newDocXml = baseDocXml.replace(
    /<w:body[^>]*>[\s\S]*<\/w:body>/i,
    `<w:body>${bodyFrags.join('')}</w:body>`,
  );
  merged.file('word/document.xml', newDocXml);
  merged.file('word/_rels/document.xml.rels', serializeRels(rels));
  merged.file('[Content_Types].xml', serializeContentTypes(contentTypes));

  return new Uint8Array(await merged.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

// 单个 docx 在开头插入文件名标题（filename_heading 模式，且只有一个文件时）。
export async function prependHeadingToDocxBytes(buffer, name) {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml').async('string');
  const inner = getBodyInner(docXml);
  const newInner = headingFrag(name) + inner;
  const newDocXml = docXml.replace(/<w:body[^>]*>[\s\S]*<\/w:body>/i, `<w:body>${newInner}</w:body>`);
  zip.file('word/document.xml', newDocXml);
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}
