// Markdown -> Word (.docx) 转换引擎（纯前端，使用 markdown-it + docx.js）。
// 不依赖 DOM，浏览器与 Node 测试均可直接 import。

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  HeadingLevel, AlignmentType, LevelFormat, BorderStyle,
} from 'docx';
import MarkdownIt from 'markdown-it';
import { normalizeObsidianMarkdown } from './obsidian.js';
import { APP_TITLE, DEFAULT_STYLE_CONFIG } from './styles.js';

const md = new MarkdownIt({ html: false, linkify: false, breaks: true, typographer: false });

// ---------- 字体 / 字号 辅助 ----------
function fontObj(font) {
  const f = font || 'Microsoft YaHei';
  return { ascii: f, eastAsia: f, hAnsi: f, cs: f };
}
// docx.js 的 size 单位是「半磅」(half-points)，这里把「磅」换算过去。
function pt(size) {
  return Math.round((Number(size) || 10.5) * 2);
}

// ---------- 图片 ----------
// 从上传集中的图片（按文件名匹配）内嵌到 Word。找不到则回调警告并回退为占位文本。
function detectImageType(data, name) {
  const n = (name || '').toLowerCase();
  if (n.endsWith('.png')) return 'png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'jpg';
  if (n.endsWith('.gif')) return 'gif';
  if (n.endsWith('.bmp')) return 'bmp';
  if (n.endsWith('.svg')) return 'svg';
  if (data && data.length >= 4) {
    if (data[0] === 0x89 && data[1] === 0x50) return 'png';
    if (data[0] === 0xff && data[1] === 0xd8) return 'jpg';
    if (data[0] === 0x47 && data[1] === 0x49) return 'gif';
    if (data[0] === 0x42 && data[1] === 0x4d) return 'bmp';
  }
  return 'png';
}

// 读取常见图片格式的尺寸（PNG/JPEG/GIF/BMP），用于给 ImageRun 提供 width/height。
export function readImageSize(data) {
  if (!data || data.length < 2) return null;
  try {
    if (data[0] === 0x89 && data[1] === 0x50 && data.length > 24) {
      const w = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
      const h = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
      return { width: w, height: h };
    }
    if (data[0] === 0xff && data[1] === 0xd8) {
      let off = 2;
      while (off < data.length - 8) {
        if (data[off] !== 0xff) { off++; continue; }
        const marker = data[off + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const h = (data[off + 5] << 8) | data[off + 6];
          const w = (data[off + 7] << 8) | data[off + 8];
          return { width: w, height: h };
        }
        const len = (data[off + 2] << 8) | data[off + 3];
        off += 2 + len;
      }
    }
    if (data[0] === 0x47 && data[1] === 0x49 && data.length > 10) {
      const w = data[6] | (data[7] << 8);
      const h = data[8] | (data[9] << 8);
      return { width: w, height: h };
    }
    if (data[0] === 0x42 && data[1] === 0x4d && data.length > 26) {
      const w = data[18] | (data[19] << 8) | (data[20] << 16) | (data[21] << 24);
      const h = data[22] | (data[23] << 8) | (data[24] << 16) | (data[25] << 24);
      return { width: w, height: h };
    }
  } catch (_e) { /* ignore */ }
  return null;
}

function renderImage(token, role, state, styleConfig, images, onWarn) {
  const src = token.attrGet('src') || '';
  const alt = token.attrGet('alt') || '';
  const base = decodeURIComponent(src.split('/').pop().split('?')[0]).toLowerCase();
  if (images && images.has(base)) {
    const { data } = images.get(base);
    const type = detectImageType(data, src);
    if (type === 'svg') {
      if (onWarn) onWarn(`图片格式 SVG 暂不支持内嵌，已跳过: ${src}`);
      return [new TextRun({ text: `[图片(SVG 跳过): ${alt || src}]`, italics: true })];
    }
    let dim = readImageSize(data) || { width: 480, height: 320 };
    let { width, height } = dim;
    const maxW = 600;
    if (width > maxW) {
      const r = maxW / width;
      width = maxW;
      height = Math.round(height * r);
    }
    const { width: w0, height: h0 } = { width, height };
    const run = new ImageRun({
      data,
      type,
      transformation: { width: w0, height: h0 },
      altText: { title: alt || src, description: alt || src },
    });
    return [run];
  }
  if (onWarn) onWarn(`图片未内嵌（未随 Markdown 一起上传本地文件）: ${src}`);
  return [new TextRun({ text: `[图片: ${alt || src}]`, italics: true })];
}

// ---------- 行内渲染 ----------
function makeRun(text, role, state, styleConfig) {
  const cfg = styleConfig[role] || styleConfig.body;
  const opts = {
    text,
    bold: Boolean(state.bold || cfg.bold),
    font: fontObj(cfg.font),
    size: pt(cfg.size),
  };
  if (state.italic) opts.italic = true;
  if (state.strike) opts.strike = true;
  return new TextRun(opts);
}

function collectUntil(children, start, closeType) {
  const inner = [];
  let i = start;
  while (i < children.length && children[i].type !== closeType) {
    inner.push(children[i]);
    i++;
  }
  return { inner, next: i < children.length ? i + 1 : children.length };
}

function renderInlineChildren(children, role, state, styleConfig, images, onWarn) {
  const runs = [];
  let i = 0;
  while (i < children.length) {
    const c = children[i];
    if (c.type === 'strong_open') {
      const { inner, next } = collectUntil(children, i + 1, 'strong_close');
      runs.push(...renderInlineChildren(inner, role, { ...state, bold: true }, styleConfig, images, onWarn));
      i = next; continue;
    }
    if (c.type === 'em_open') {
      const { inner, next } = collectUntil(children, i + 1, 'em_close');
      runs.push(...renderInlineChildren(inner, role, { ...state, italic: true }, styleConfig, images, onWarn));
      i = next; continue;
    }
    if (c.type === 's_open') {
      const { inner, next } = collectUntil(children, i + 1, 's_close');
      runs.push(...renderInlineChildren(inner, role, { ...state, strike: true }, styleConfig, images, onWarn));
      i = next; continue;
    }
    if (c.type === 'link_open') {
      const href = c.attrGet('href') || '';
      const { inner, next } = collectUntil(children, i + 1, 'link_close');
      runs.push(...renderInlineChildren(inner, role, state, styleConfig, images, onWarn));
      if (href) runs.push(makeRun(` (${href})`, role, state, styleConfig));
      i = next; continue;
    }
    if (c.type === 'text') runs.push(makeRun(c.content, role, state, styleConfig));
    else if (c.type === 'code') runs.push(makeRun(c.content, 'code', state, styleConfig));
    else if (c.type === 'softbreak' || c.type === 'hardbreak') runs.push(makeRun('\n', role, state, styleConfig));
    else if (c.type === 'image') runs.push(...renderImage(c, role, state, styleConfig, images, onWarn));
    else if (c.type === 'escape' || c.type === 'entity' || c.type === 'text_special') runs.push(makeRun(c.content || '', role, state, styleConfig));
    i++;
  }
  return runs;
}

function inlineToText(token) {
  if (!token || !token.children) return '';
  let out = '';
  for (const c of token.children) {
    if (c.type === 'text') out += c.content;
    else if (c.type === 'code') out += c.content;
    else if (c.type === 'softbreak' || c.type === 'hardbreak') out += ' ';
    else if (c.type === 'image') out += `[图片: ${c.attrGet('alt') || c.attrGet('src') || ''}]`;
    else if (c.type === 'link_open') {
      const href = c.attrGet('href') || '';
      out += inlineToText({ children: [] }) + '';
    }
    else if (c.type === 'strong_open' || c.type === 'em_open' || c.type === 's_open' || c.type === 'link_open') {
      // 递归取内部文本
      out += inlineToText(c);
    }
  }
  return out;
}

// ---------- 块级渲染 ----------
function renderHeading(openToken, inlineToken, styleConfig, headingOffset, images, onWarn) {
  const srcLevel = parseInt(openToken.tag.slice(1), 10);
  const level = Math.min(6, srcLevel + (headingOffset || 0));
  const role = 'h' + level;
  const runs = renderInlineChildren(inlineToken.children, role, {}, styleConfig, images, onWarn);
  return new Paragraph({ heading: HeadingLevel['HEADING_' + level], children: runs });
}

function renderParagraph(inlineToken, styleConfig, indent, images, onWarn) {
  const runs = renderInlineChildren(inlineToken.children, 'body', {}, styleConfig, images, onWarn);
  const opts = { children: runs };
  if (indent) opts.indent = { left: indent };
  return new Paragraph(opts);
}

function renderFence(token, styleConfig) {
  const run = new TextRun({
    text: token.content,
    font: fontObj(styleConfig.code.font),
    size: pt(styleConfig.code.size),
    bold: false,
  });
  return new Paragraph({
    children: [run],
    shading: { type: 'solid', color: 'auto', fill: 'F2F2F2' },
    spacing: { before: 4, after: 4 },
    indent: { left: 120 },
  });
}

function renderList(tokens, start, styleConfig, depth, images, onWarn) {
  const open = tokens[start];
  const ordered = open.type === 'ordered_list_open';
  const ref = ordered ? 'ordered' : 'bullet';
  let i = start + 1;
  const docxParas = [];
  while (i < tokens.length && tokens[i].type !== 'bullet_list_close' && tokens[i].type !== 'ordered_list_close') {
    if (tokens[i].type === 'list_item_open') {
      const { runs, nested, next } = renderListItem(tokens, i, styleConfig, depth, images, onWarn);
      docxParas.push(new Paragraph({ numbering: { reference: ref, level: depth }, children: runs }));
      docxParas.push(...nested);
      i = next;
    } else {
      i++;
    }
  }
  return { nodes: docxParas, next: i + 1 };
}

function renderListItem(tokens, start, styleConfig, depth, images, onWarn) {
  let i = start + 1;
  let runs = [];
  const nested = [];
  while (i < tokens.length && tokens[i].type !== 'list_item_close') {
    const t = tokens[i];
    if (t.type === 'paragraph_open') {
      runs = renderInlineChildren(tokens[i + 1].children, 'body', {}, styleConfig, images, onWarn);
      i += 2;
    } else if (t.type === 'inline') {
      runs = renderInlineChildren(t.children, 'body', {}, styleConfig, images, onWarn);
      i += 1;
    } else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const { nodes, next } = renderList(tokens, i, styleConfig, depth + 1, images, onWarn);
      nested.push(...nodes);
      i = next;
    } else {
      i += 1;
    }
  }
  return { runs, nested, next: i + 1 };
}

function renderBlockquote(tokens, start, styleConfig, images, onWarn) {
  const inner = [];
  let i = start + 1;
  while (i < tokens.length && tokens[i].type !== 'blockquote_close') {
    inner.push(tokens[i]);
    i++;
  }
  const children = walkBlocks(inner, styleConfig, 360, images, onWarn);
  return { nodes: children, next: i + 1 };
}

function renderTable(tokens, start, styleConfig) {
  const rows = [];
  let i = start + 1;
  let row = null;
  let cellText = '';
  let cellBold = false;
  let inCell = false;
  const pushCell = () => { if (row) row.cells.push({ text: cellText.replace(/\s+/g, ' ').trim(), bold: cellBold }); cellText = ''; inCell = false; };
  while (i < tokens.length && tokens[i].type !== 'table_close') {
    const t = tokens[i];
    if (t.type === 'tr_open') row = { cells: [] };
    else if (t.type === 'tr_close') { if (row) rows.push(row); row = null; }
    else if (t.type === 'th_open') { cellBold = true; inCell = true; cellText = ''; }
    else if (t.type === 'td_open') { cellBold = false; inCell = true; cellText = ''; }
    else if (t.type === 'th_close' || t.type === 'td_close') pushCell();
    else if (t.type === 'inline' && inCell) cellText += inlineToText(t);
    i++;
  }
  const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const tableRows = rows.map((r) => new TableRow({
    children: r.cells.map((c) => new TableCell({
      children: [
        new Paragraph({
          children: [new TextRun({ text: c.text, bold: c.bold, font: fontObj(styleConfig.body.font), size: pt(styleConfig.body.size) })],
        }),
      ],
    })),
  }));
  const table = new Table({
    rows: tableRows,
    width: { size: 100, type: 'pct' },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
  });
  return { node: table, next: i + 1 };
}

function walkBlocks(tokens, styleConfig, indent, images, onWarn) {
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    switch (t.type) {
      case 'heading_open':
        out.push(renderHeading(t, tokens[i + 1], styleConfig, 0, images, onWarn));
        i += 2;
        break;
      case 'paragraph_open':
        out.push(renderParagraph(tokens[i + 1], styleConfig, indent, images, onWarn));
        i += 2;
        break;
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const { nodes, next } = renderList(tokens, i, styleConfig, 0, images, onWarn);
        out.push(...nodes);
        i = next;
        break;
      }
      case 'blockquote_open': {
        const { nodes, next } = renderBlockquote(tokens, i, styleConfig, images, onWarn);
        out.push(...nodes);
        i = next;
        break;
      }
      case 'table_open': {
        const { node, next } = renderTable(tokens, i, styleConfig);
        out.push(node);
        i = next;
        break;
      }
      case 'fence':
        out.push(renderFence(t, styleConfig));
        i += 1;
        break;
      case 'hr':
        out.push(new Paragraph({ children: [new TextRun({ text: '——', font: fontObj(styleConfig.body.font), size: pt(styleConfig.body.size) })] }));
        i += 1;
        break;
      case 'html_block':
        i += 1;
        break;
      default:
        i += 1;
    }
  }
  return out;
}

// ---------- 编号（列表）配置 ----------
function numberingConfig() {
  const bulletLevels = [0, 1, 2, 3].map((lv) => ({
    level: lv,
    format: LevelFormat.BULLET,
    text: lv === 0 ? '•' : lv === 1 ? '◦' : '▪',
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: (lv + 1) * 720, hanging: 360 } } },
  }));
  const orderedLevels = [0, 1, 2, 3].map((lv) => ({
    level: lv,
    format: LevelFormat.DECIMAL,
    text: '%' + Array.from({ length: lv + 1 }, (_, k) => k + 1).join('.%') + '.',
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: (lv + 1) * 720, hanging: 360 } } },
  }));
  return { config: [{ reference: 'bullet', levels: bulletLevels }, { reference: 'ordered', levels: orderedLevels }] };
}

function defaultDocStyles(styleConfig) {
  return {
    default: {
      document: {
        run: { font: fontObj(styleConfig.body.font), size: pt(styleConfig.body.size) },
      },
    },
  };
}

// ---------- 对外：Markdown 文本 -> docx.js Document ----------
export function mdToDocxDocument(mdText, { styleConfig, images, headingOffset = 0, onWarn } = {}) {
  const sc = styleConfig || DEFAULT_STYLE_CONFIG;
  const normalized = normalizeObsidianMarkdown(mdText || '');
  const tokens = md.parse(normalized, {});
  const children = walkBlocks(tokens, sc, 0, images, onWarn);
  const doc = new Document({
    creator: APP_TITLE,
    styles: defaultDocStyles(sc),
    numbering: numberingConfig(),
    sections: [{ children }],
  });
  return doc;
}

// 把 Document 打包成 Uint8Array（浏览器/Node 通用）。
export async function packDocToUint8Array(doc) {
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    const blob = await Packer.toBlob(doc);
    return new Uint8Array(await blob.arrayBuffer());
  }
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}

// Markdown 文本 -> .docx 字节（Uint8Array）
export async function mdToDocxBytes(mdText, opts = {}) {
  const doc = mdToDocxDocument(mdText, opts);
  return packDocToUint8Array(doc);
}
