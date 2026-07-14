// 编排引擎：把 4 种任务模式串起来。
// 输入 file 描述：{ name, kind:'md'|'docx', text, bytes, created?, modified? }
//   - md 文件：需提供 text（字符串）
//   - docx 文件：需提供 bytes（Uint8Array）
// settings：{ mode, sort, wordJoin, mdJoin, filenameTitle, keepSingle, styleConfig }
// images：Map<basenameLower, { data:Uint8Array, type:string }>
// 返回 { converted:[{name,data}], mergedDocx:Uint8Array|null, mergedMd:string|null, log, warnings, errors }
import { mdToDocxBytes } from './markdownToDocx.js';
import { mergeDocxBytes } from './docxMerge.js';
import { mergeMarkdownTexts } from './markdownMerge.js';
import { APP_TITLE, SORT_OPTIONS, JOIN_OPTIONS, MD_JOIN_OPTIONS, FILENAME_TITLE_OPTIONS } from './styles.js';

function naturalNameKey(name) {
  return String(name).toLowerCase().replace(/(\d+)/g, (m) => m.padStart(10, '0'));
}
function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function sortFiles(files, sortKey) {
  const key = sortKey || 'manual';
  const arr = files.slice();
  if (key === 'manual') return arr;
  const reverse = key.endsWith('_desc');
  if (key.startsWith('name')) {
    arr.sort((a, b) => naturalNameKey(a.name).localeCompare(naturalNameKey(b.name)));
  } else if (key.startsWith('created')) {
    arr.sort((a, b) => (a.created || 0) - (b.created || 0));
  } else if (key.startsWith('modified')) {
    arr.sort((a, b) => (a.modified || 0) - (b.modified || 0));
  }
  if (reverse) arr.reverse();
  return arr;
}

function filenameTitle(name, mode) {
  return mode === 'with_ext' ? name : name.replace(/\.[^.]+$/, '');
}

export async function runEngine({ files, settings, images, onProgress, onStatus, onWarn } = {}) {
  const warnings = [];
  const errors = [];
  const warn = (m) => { warnings.push(m); if (onWarn) onWarn(m); };

  const mode = settings.mode || 'convert_merge';
  const wordJoin = JOIN_OPTIONS[settings.wordJoin] || 'direct';
  const mdJoin = MD_JOIN_OPTIONS[settings.mdJoin] || 'direct';
  const filenameTitleMode = FILENAME_TITLE_OPTIONS[settings.filenameTitle] || 'stem';
  const keepSingle = Boolean(settings.keepSingle);
  const styleConfig = settings.styleConfig;

  const sorted = sortFiles(files, SORT_OPTIONS[settings.sort] || 'manual');
  const titleFor = (i) => filenameTitle(sorted[i] ? sorted[i].name : '', filenameTitleMode);

  const converted = []; // [{name, data}]
  let mergedDocx = null;
  let mergedMd = null;

  const mdItems = sorted.filter((f) => f.kind === 'md');
  const docxItems = sorted.filter((f) => f.kind === 'docx');

  const setProgress = (c, t, text) => {
    if (onProgress) onProgress(c, t, text);
    if (onStatus && text) onStatus(text);
  };

  const headingOffset = (wordJoin === 'filename_heading' && (mode === 'convert_merge' || mode === 'mixed_merge')) ? 1 : 0;

  try {
    // ---------- 模式 4：合并 Markdown 原文 ----------
    if (mode === 'md_merge') {
      if (mdItems.length === 0) throw new Error('没有可用于合并的 Markdown 文件');
      const total = mdItems.length + 1;
      for (let i = 0; i < mdItems.length; i++) {
        setProgress(i, total, `读取 Markdown ${i + 1}/${mdItems.length}: ${mdItems[i].name}`);
      }
      mergedMd = mergeMarkdownTexts(mdItems, { joinMode: mdJoin, titleFor });
      setProgress(total, total, 'Markdown 合并完成');
      const log = buildLog({
        mode, sortLabel: settings.sort, mdJoin, filenameTitleMode, mdItems, mergedMd, warnings, errors,
      });
      return { mode, converted, mergedDocx, mergedMd, log, warnings, errors };
    }

    // ---------- 需要转 docx 的文件 ----------
    const convertList = sorted.filter((f) => f.kind === 'md');
    const totalSteps = convertList.length + (mode === 'convert_only' ? 0 : 1) + 1;
    let done = 0;

    const mdBuffers = [];
    for (let i = 0; i < convertList.length; i++) {
      const item = convertList[i];
      setProgress(done, totalSteps, `[${i + 1}/${convertList.length}] 处理 ${item.name}`);
      try {
        const data = await mdToDocxBytes(item.text, { styleConfig, images, headingOffset, onWarn: warn });
        converted.push({ name: item.name.replace(/\.md$/i, '') + '.docx', data });
        mdBuffers.push({ name: item.name, data });
        if (mode === 'convert_merge' || mode === 'mixed_merge') {
          // 纳入合并
        }
      } catch (e) {
        errors.push(`${item.name}: ${e.message || e}`);
      }
      done++;
      setProgress(done, totalSteps, `已处理 ${i + 1}/${convertList.length} 个文件`);
    }

    // ---------- 模式 1：仅转换 ----------
    if (mode === 'convert_only') {
      setProgress(totalSteps, totalSteps, '转换完成');
      const log = buildLog({ mode, sortLabel: settings.sort, converted, warnings, errors });
      return { mode, converted, mergedDocx, mergedMd, log, warnings, errors };
    }

    // ---------- 合并（convert_merge / mixed_merge） ----------
    const mergeInputs = [];
    if (mode === 'convert_merge' || mode === 'mixed_merge') {
      for (const c of mdBuffers) mergeInputs.push({ name: c.name, data: c.data });
      if (mode === 'mixed_merge') {
        for (const d of docxItems) mergeInputs.push({ name: d.name, data: d.bytes });
      }
    }
    if ((mode === 'convert_merge' || mode === 'mixed_merge')) {
      if (mergeInputs.length === 0) throw new Error('没有可用于合并的 Word 文件');
      setProgress(done, totalSteps, `正在合并 ${mergeInputs.length} 个 Word 文档...`);
      const mergeBytes = mergeInputs.map((m) => m.data);
      mergedDocx = await mergeDocxBytes(mergeBytes, {
        joinMode: wordJoin,
        filenameTitleMode,
        getName: (i) => filenameTitle(mergeInputs[i].name, filenameTitleMode),
        onWarn: warn,
      });
      done++;
      setProgress(done, totalSteps, '合并完成');
    }

    // convert_merge / mixed_merge 下 keepSingle 时保留单个转换结果；否则只保留合并结果
    const finalConverted = (mode === 'convert_only' || keepSingle) ? converted : [];

    setProgress(totalSteps, totalSteps, '任务完成');
    const log = buildLog({
      mode, sortLabel: settings.sort, wordJoin, filenameTitleMode,
      converted: finalConverted, mergeInputs, mergedDocx, mdItems, warnings, errors,
    });
    return { mode, converted: finalConverted, mergedDocx, mergedMd, log, warnings, errors };
  } catch (e) {
    errors.push('执行失败: ' + (e.message || e));
    const log = buildLog({ mode, sortLabel: settings.sort, converted, mergedDocx, mdItems, warnings, errors });
    return { mode, converted, mergedDocx, mergedMd, log, warnings, errors, failed: true };
  }
}

// ---------- 日志 ----------
function buildLog({ mode, sortLabel, wordJoin, mdJoin, filenameTitleMode, converted, mergeInputs, mergedDocx, mdItems, mergedMd, warnings, errors }) {
  const lines = [];
  lines.push('='.repeat(72));
  lines.push(APP_TITLE);
  lines.push('生成时间: ' + formatTime(Date.now()));
  lines.push('');
  lines.push(`任务模式: ${mode}`);
  lines.push(`排序方式: ${sortLabel || '手动顺序'}`);
  if (wordJoin) lines.push(`Word 拼接方式: ${wordJoin}`);
  if (mdJoin) lines.push(`Markdown 拼接方式: ${mdJoin}`);
  if (filenameTitleMode) lines.push(`文件名标题格式: ${filenameTitleMode}`);
  lines.push('');
  if (converted && converted.length) {
    lines.push('转换出的单个 Word:');
    for (const c of converted) lines.push(`  - ${c.name}`);
    lines.push('');
  }
  if (mergeInputs && mergeInputs.length) {
    lines.push('合并顺序:');
    mergeInputs.forEach((m, i) => lines.push(`  ${String(i + 1).padStart(2, '0')}. ${m.name}`));
    lines.push('');
  }
  if (mdItems && mdItems.length && !mergeInputs) {
    lines.push('拼接顺序:');
    mdItems.forEach((m, i) => lines.push(`  ${String(i + 1).padStart(2, '0')}. ${m.name}`));
    lines.push('');
  }
  if (mergedDocx) lines.push('已生成合并 Word 文档。');
  if (mergedMd) lines.push('已生成合并 Markdown 文档。');
  if (warnings.length) {
    lines.push('');
    lines.push('警告:');
    warnings.forEach((w) => lines.push('  - ' + w));
  }
  if (errors.length) {
    lines.push('');
    lines.push('错误/跳过:');
    errors.forEach((e) => lines.push('  - ' + e));
  }
  return lines.join('\n');
}
