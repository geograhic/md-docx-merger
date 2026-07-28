// 网页版主控制器：文件管理、模式/选项/样式 UI、预览、执行、结果打包下载。
// 全部在浏览器本地运行，文件不上传。
import JSZip from 'jszip';
import { runEngine } from './core/engine.js';
import {
  SORT_OPTIONS, JOIN_OPTIONS, MD_JOIN_OPTIONS, FILENAME_TITLE_OPTIONS,
  DEFAULT_STYLE_CONFIG, DEFAULT_FONTS, APP_VERSION, APP_TITLE,
} from './core/styles.js';

const MODES = [
  { value: 'convert_only', title: 'Markdown 转 Word', desc: '仅把每个 Markdown 转成独立 Word' },
  { value: 'convert_merge', title: '转 Word 后合并', desc: '转换并合并为一个 Word 文档' },
  { value: 'mixed_merge', title: '混合 Word/MD 合并', desc: 'Word 与原 Markdown 一起合并' },
  { value: 'md_merge', title: '合并 Markdown 原文', desc: '直接拼接多个 Markdown 文本' },
];

let uid = 0;
const newId = () => 'f' + (++uid);

function fileKind(name) {
  const e = name.toLowerCase();
  if (e.endsWith('.md') || e.endsWith('.markdown')) return 'md';
  if (e.endsWith('.docx')) return 'docx';
  if (e.endsWith('.doc')) return 'doc';
  return null;
}
function imageType(name) {
  const e = name.toLowerCase();
  if (e.endsWith('.png')) return 'png';
  if (e.endsWith('.jpg') || e.endsWith('.jpeg')) return 'jpg';
  if (e.endsWith('.gif')) return 'gif';
  if (e.endsWith('.bmp')) return 'bmp';
  if (e.endsWith('.svg')) return 'svg';
  if (e.endsWith('.webp')) return 'webp';
  return 'png';
}

const state = {
  files: [],            // {id,name,kind,text,bytes,created,modified}
  images: new Map(),    // lowerName -> {data,type,name}
  sort: '手动顺序',
  mode: 'convert_merge',
  wordJoin: '直接连续拼接',
  mdJoin: '直接连续拼接',
  filenameTitle: '不带后缀',
  keepSingle: true,
  styleConfig: JSON.parse(JSON.stringify(DEFAULT_STYLE_CONFIG)),
  selectedId: null,
  running: false,
};

let root, fileListEl, previewEl, optionsEl, styleTableEl, resultEl, progWrap, progBar, statusEl, runBtn;

export function initApp(container) {
  root = container;
  root.innerHTML = skeletonHTML();
  cacheEls();
  wireEvents();
  renderFileList();
  renderPreview();
  renderOptions();
  renderStyleTable();
  applyVisibility();
}

function skeletonHTML() {
  const modeCards = MODES.map((m) => `
    <label class="mode ${m.value === state.mode ? 'active' : ''}" data-mode="${m.value}">
      <input type="radio" name="mode" value="${m.value}" ${m.value === state.mode ? 'checked' : ''}>
      <div class="t">${m.title}</div>
      <div class="d">${m.desc}</div>
    </label>`).join('');

  const sortOpts = Object.keys(SORT_OPTIONS).map((k) => `<option ${k === state.sort ? 'selected' : ''}>${k}</option>`).join('');
  const fontOpts = DEFAULT_FONTS.map((f) => `<option value="${f}">${f}</option>`).join('');

  return `
  <div class="appbar">
    <div class="logo">M↓W</div>
    <div>
      <h1>Markdown 批量转 Word / 合并</h1>
      <div class="sub">纯前端 · 本地运行 · 数据不出本机</div>
    </div>
    <div class="ver">${APP_VERSION}</div>
  </div>

  <div class="grid">
    <div class="col-left">
      <div class="card">
        <h2>文件 <span class="tag">本地处理</span></h2>
        <div class="dropzone" id="dropzone">
          <div class="big">把 Markdown / Word / 图片 拖到这里是</div>
          <div class="hint">或点击下方按钮添加。Word 合并时，可一并选入图片以嵌入文档。</div>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn" id="add-md">+ Markdown</button>
          <button class="btn" id="add-folder">+ 文件夹</button>
          <button class="btn" id="add-docx">+ Word</button>
          <button class="btn" id="add-img">+ 图片</button>
          <button class="btn danger sm" id="clear-all">清空</button>
        </div>
        <div class="toolbar">
          <label>排序</label>
          <select id="sort-sel">${sortOpts}</select>
          <span class="badge" id="file-count">文件 0</span>
          <span class="badge" id="img-count">图片 0</span>
        </div>
        <div class="files" id="file-list"></div>
        <datalist id="font-options">${fontOpts}</datalist>
      </div>

      <div class="card">
        <h2>实时预览 <span class="tag">当前列表顺序即处理顺序</span></h2>
        <div class="preview" id="preview"></div>
      </div>
    </div>

    <div class="col-right">
      <div class="card">
        <h2>任务类型</h2>
        <div class="modes" id="modes">${modeCards}</div>
      </div>

      <div class="card">
        <h2>任务设置</h2>
        <div id="options"></div>
      </div>

      <div class="card">
        <h2>Markdown 样式 <span class="tag">可选</span></h2>
        <div id="style-table"></div>
        <div class="btn-row" style="margin-top:10px"><button class="btn sm" id="reset-style">恢复默认样式</button></div>
      </div>

      <div class="card">
        <h2>执行</h2>
        <div class="btn-row"><button class="btn primary" id="run">开始执行</button></div>
        <div class="progress-wrap hidden" id="prog-wrap">
          <div class="progress"><i id="prog-bar"></i></div>
          <div class="status" id="status"></div>
        </div>
        <div class="result" id="result"></div>
      </div>
    </div>
  </div>

  <div class="footer">所有转换与合并均在你的浏览器本地完成，<b>文件不会上传到任何服务器</b>。 · 由 <a href="https://apps.endril.com" target="_blank" rel="noopener">Endril</a> 提供</div>

  <input type="file" id="inp-md" accept=".md,.markdown" multiple class="hidden">
  <input type="file" id="inp-folder" webkitdirectory multiple class="hidden">
  <input type="file" id="inp-docx" accept=".docx" multiple class="hidden">
  <input type="file" id="inp-img" accept="image/*" multiple class="hidden">
  `;
}

function cacheEls() {
  fileListEl = root.querySelector('#file-list');
  previewEl = root.querySelector('#preview');
  optionsEl = root.querySelector('#options');
  styleTableEl = root.querySelector('#style-table');
  resultEl = root.querySelector('#result');
  progWrap = root.querySelector('#prog-wrap');
  progBar = root.querySelector('#prog-bar');
  statusEl = root.querySelector('#status');
  runBtn = root.querySelector('#run');
}

function $(sel) { return root.querySelector(sel); }

function wireEvents() {
  $('#add-md').addEventListener('click', () => $('#inp-md').click());
  $('#add-folder').addEventListener('click', () => $('#inp-folder').click());
  $('#add-docx').addEventListener('click', () => $('#inp-docx').click());
  $('#add-img').addEventListener('click', () => $('#inp-img').click());
  $('#clear-all').addEventListener('click', clearAll);

  $('#inp-md').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#inp-folder').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#inp-docx').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#inp-img').addEventListener('change', (e) => { addImages(e.target.files); e.target.value = ''; });

  // 拖放
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && dz.contains(e.relatedTarget)) return; dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('drag');
    const dt = e.dataTransfer;
    if (dt && dt.files) addDropped(dt.files);
  });
  // 整个窗口也支持拖放（避免拖到别处丢失）
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { if (e.target === dz || dz.contains(e.target)) return; e.preventDefault(); }, false));

  $('#sort-sel').addEventListener('change', (e) => { state.sort = e.target.value; renderPreview(); });

  // 模式卡片（事件委托）
  $('#modes').addEventListener('click', (e) => {
    const card = e.target.closest('.mode');
    if (!card) return;
    state.mode = card.dataset.mode;
    root.querySelectorAll('.mode').forEach((c) => c.classList.toggle('active', c.dataset.mode === state.mode));
    root.querySelector(`input[name="mode"][value="${state.mode}"]`).checked = true;
    applyVisibility();
  });

  $('#reset-style').addEventListener('click', () => {
    state.styleConfig = JSON.parse(JSON.stringify(DEFAULT_STYLE_CONFIG));
    renderStyleTable();
  });

  runBtn.addEventListener('click', run);

  // 文件列表事件委托
  fileListEl.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const id = row.dataset.id;
    const act = e.target.dataset.act;
    if (act === 'up') moveUp(id);
    else if (act === 'down') moveDown(id);
    else if (act === 'del') removeFile(id);
    else selectFile(id);
  });
}

// ---------- 读取文件 ----------
function readText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file, 'utf-8');
  });
}
function readBytes(file) {
  return file.arrayBuffer().then((b) => new Uint8Array(b));
}

async function addFiles(fileList) {
  const arr = Array.from(fileList || []);
  let added = 0, skipped = [];
  for (const f of arr) {
    const kind = fileKind(f.name);
    if (!kind) continue;
    if (kind === 'doc') { skipped.push(`${f.name}（浏览器不支持 .doc，请转 .docx）`); continue; }
    try {
      if (kind === 'md') {
        const text = await readText(f);
        state.files.push({ id: newId(), name: f.name, kind, text, bytes: null, created: f.lastModified || 0, modified: f.lastModified || 0 });
      } else {
        const bytes = await readBytes(f);
        state.files.push({ id: newId(), name: f.name, kind, text: null, bytes, created: f.lastModified || 0, modified: f.lastModified || 0 });
      }
      added++;
    } catch (e) {
      skipped.push(`${f.name}: ${e.message || e}`);
    }
  }
  renderFileList(); renderPreview(); updateCounts();
  if (skipped.length) setStatus('已跳过: ' + skipped.join('；'), 'warn', true);
  else if (added) setStatus(`已添加 ${added} 个文件`, 'ok', true);
}

async function addImages(fileList) {
  const arr = Array.from(fileList || []);
  for (const f of arr) {
    try {
      const data = await readBytes(f);
      const key = f.name.toLowerCase();
      state.images.set(key, { data, type: imageType(f.name), name: f.name });
    } catch (e) { /* ignore */ }
  }
  updateCounts();
}

function addDropped(fileList) {
  const imgs = [], others = [];
  for (const f of Array.from(fileList || [])) {
    const k = fileKind(f.name);
    if (k === 'doc') { others.push(f); }
    else if (k) others.push(f);
    else if (/^image\//.test(f.type) || /\.(png|jpe?g|gif|bmp|svg|webp)$/i.test(f.name)) imgs.push(f);
  }
  if (others.length) addFiles(others);
  if (imgs.length) addImages(imgs);
}

// ---------- 文件列表渲染 ----------
function renderFileList() {
  if (!state.files.length) {
    fileListEl.innerHTML = `<div class="empty">还没有文件。点击上方按钮或拖入文件开始。</div>`;
    return;
  }
  const rows = state.files.map((f, i) => `
    <div class="row ${f.id === state.selectedId ? 'sel' : ''}" data-id="${f.id}">
      <div class="idx">${i + 1}</div>
      <div class="kind ${f.kind}">${f.kind === 'md' ? 'MD' : 'DOCX'}</div>
      <div class="name" title="${escapeAttr(f.name)}">${escapeHtml(f.name)}</div>
      <button class="op" data-act="up" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="op" data-act="down" title="下移" ${i === state.files.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="op" data-act="del" title="移除">✕</button>
    </div>`).join('');
  fileListEl.innerHTML = rows;
}

function renderPreview() {
  const sel = state.files.find((f) => f.id === state.selectedId);
  const orderLines = state.files.map((f, i) => `${String(i + 1).padStart(2, '0')}. [${f.kind === 'md' ? 'MD' : 'DOCX'}] ${f.name}`).join('\n');
  let out = `排序方式: ${state.sort}\n文件数量: ${state.files.length}\n\n拼接顺序:\n${orderLines}\n`;
  if (sel) {
    out += `\n— 当前预览: ${sel.name} —\n`;
    if (sel.kind === 'md' && sel.text) {
      const lines = sel.text.split('\n').filter((l) => l.trim()).map((l) => l.slice(0, 200));
      out += lines.slice(0, 40).join('\n');
      if (lines.length > 40) out += '\n…';
    } else {
      out += 'Word 文件不做内容预览，会按列表顺序参与合并。';
    }
  }
  previewEl.textContent = out;
}

function updateCounts() {
  $('#file-count').textContent = `文件 ${state.files.length}`;
  $('#img-count').textContent = `图片 ${state.images.size}`;
}

function selectFile(id) { state.selectedId = id; renderFileList(); renderPreview(); }
function moveUp(id) {
  const i = state.files.findIndex((f) => f.id === id);
  if (i > 0) { [state.files[i - 1], state.files[i]] = [state.files[i], state.files[i - 1]]; state.sort = '手动顺序'; $('#sort-sel').value = '手动顺序'; renderFileList(); renderPreview(); }
}
function moveDown(id) {
  const i = state.files.findIndex((f) => f.id === id);
  if (i >= 0 && i < state.files.length - 1) { [state.files[i + 1], state.files[i]] = [state.files[i], state.files[i + 1]]; state.sort = '手动顺序'; $('#sort-sel').value = '手动顺序'; renderFileList(); renderPreview(); }
}
function removeFile(id) {
  state.files = state.files.filter((f) => f.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  renderFileList(); renderPreview(); updateCounts();
}
function clearAll() { state.files = []; state.selectedId = null; renderFileList(); renderPreview(); updateCounts(); }

// ---------- 选项 ----------
function renderOptions() {
  const opt = (obj, cur) => Object.keys(obj).map((k) => `<option ${k === cur ? 'selected' : ''}>${k}</option>`).join('');
  optionsEl.innerHTML = `
    <div id="join-group">
      <div class="field" id="row-word-join"><label>Word 拼接</label><div class="ctl"><select id="word-join-sel">${opt(JOIN_OPTIONS, state.wordJoin)}</select></div></div>
      <div class="field" id="row-md-join"><label>Markdown 拼接</label><div class="ctl"><select id="md-join-sel">${opt(MD_JOIN_OPTIONS, state.mdJoin)}</select></div></div>
      <div class="field" id="row-filename-title"><label>文件名标题</label><div class="ctl"><select id="filename-title-sel">${opt(FILENAME_TITLE_OPTIONS, state.filenameTitle)}</select></div></div>
    </div>
    <div class="field" id="row-keep-single"><label>其他选项</label><div class="ctl">
      <label class="check"><input type="checkbox" id="keep-single-chk" ${state.keepSingle ? 'checked' : ''}> 保留单个转换后的 Word</label>
    </div></div>
  `;
  $('#word-join-sel').addEventListener('change', (e) => { state.wordJoin = e.target.value; applyVisibility(); });
  $('#md-join-sel').addEventListener('change', (e) => { state.mdJoin = e.target.value; applyVisibility(); });
  $('#filename-title-sel').addEventListener('change', (e) => { state.filenameTitle = e.target.value; });
  $('#keep-single-chk').addEventListener('change', (e) => { state.keepSingle = e.target.checked; });
}

function applyVisibility() {
  const wordVisible = ['convert_merge', 'mixed_merge'].includes(state.mode);
  const mdVisible = state.mode === 'md_merge';
  const ftVisible = (wordVisible && state.wordJoin === '文件名标题拼接') || (mdVisible && state.mdJoin === '文件名标题拼接');
  const keepVisible = wordVisible;
  $('#join-group').classList.toggle('hidden', !(wordVisible || mdVisible || ftVisible));
  $('#row-word-join').classList.toggle('hidden', !wordVisible);
  $('#row-md-join').classList.toggle('hidden', !mdVisible);
  $('#row-filename-title').classList.toggle('hidden', !ftVisible);
  $('#row-keep-single').classList.toggle('hidden', !keepVisible);
}

// ---------- 样式表 ----------
function renderStyleTable() {
  const rows = Object.entries(state.styleConfig).map(([role, cfg]) => `
    <tr data-role="${role}">
      <td class="lbl">${escapeHtml(cfg.label)}</td>
      <td><input type="text" list="font-options" data-f="style" value="${escapeAttr(cfg.style)}"></td>
      <td><input list="font-options" data-f="font" value="${escapeAttr(cfg.font)}"></td>
      <td><input type="number" step="0.5" min="1" data-f="size" value="${cfg.size}" style="width:64px"></td>
      <td style="text-align:center"><input type="checkbox" data-f="bold" ${cfg.bold ? 'checked' : ''}></td>
    </tr>`).join('');
  styleTableEl.innerHTML = `
    <table class="style-table">
      <thead><tr><th>Markdown 元素</th><th>Word 样式名</th><th>字体</th><th>字号</th><th>加粗</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  styleTableEl.querySelectorAll('tbody tr').forEach((tr) => {
    const role = tr.dataset.role;
    tr.querySelectorAll('[data-f]').forEach((inp) => {
      const f = inp.dataset.f;
      inp.addEventListener('change', () => {
        if (f === 'size') state.styleConfig[role].size = parseFloat(inp.value) || 10.5;
        else if (f === 'bold') state.styleConfig[role].bold = inp.checked;
        else state.styleConfig[role][f] = inp.value;
      });
    });
  });
}

// ---------- 执行 ----------
function setStatus(text, kind, autohide) {
  if (!statusEl) return;
  statusEl.textContent = text || '';
  statusEl.className = 'status' + (kind === 'err' ? ' err' : kind === 'warn' ? ' warn' : '');
  if (autohide) {
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(() => { if (statusEl.textContent === text) { statusEl.textContent = ''; statusEl.className = 'status'; } }, 4000);
  }
}
function setProgress(pct, text) {
  if (progBar) progBar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  if (text) setStatus(text);
}

async function run() {
  if (state.running) return;
  const files = state.files.filter((f) => f.kind === 'md' || f.kind === 'docx');
  if (!files.length) { setStatus('请先添加 Markdown 或 Word 文件', 'err'); return; }
  if (state.mode !== 'md_merge' && !files.some((f) => f.kind === 'md')) {
    setStatus('当前模式需要至少一个 Markdown 文件', 'err'); return;
  }

  state.running = true;
  runBtn.disabled = true;
  resultEl.innerHTML = '';
  progWrap.classList.remove('hidden');
  setProgress(0, '准备执行...');

  try {
    const engineFiles = files.map((f) => ({
      name: f.name, kind: f.kind, text: f.text, bytes: f.bytes, created: f.created, modified: f.modified,
    }));
    const res = await runEngine({
      files: engineFiles,
      settings: {
        mode: state.mode, sort: state.sort, wordJoin: state.wordJoin, mdJoin: state.mdJoin,
        filenameTitle: state.filenameTitle, keepSingle: state.keepSingle, styleConfig: state.styleConfig,
      },
      images: state.images,
      onProgress: (c, t, txt) => setProgress(t ? (c / t) * 100 : 0, txt),
      onStatus: (txt) => setStatus(txt),
      onWarn: () => {},
    });
    showResult(res);
  } catch (e) {
    setStatus('执行出错: ' + (e.message || e), 'err');
  } finally {
    state.running = false;
    runBtn.disabled = false;
  }
}

function showResult(res) {
  const ok = !res.failed;
  let html = '';
  if (ok) {
    const bits = [];
    if (res.mergedDocx) bits.push('已生成合并 Word 文档');
    if (res.mergedMd) bits.push('已生成合并 Markdown 文档');
    if (res.converted && res.converted.length) bits.push(`已生成 ${res.converted.length} 个独立 Word`);
    html += `<div class="msg ok">${bits.join('；') || '完成'}。</div>`;
  } else {
    html += `<div class="msg err">执行失败，请检查输入后重试。</div>`;
  }
  if (res.warnings && res.warnings.length) {
    html += `<div class="msg warn">警告 ${res.warnings.length} 条：<ul>${res.warnings.slice(0, 12).map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`;
  }
  if (res.errors && res.errors.length) {
    html += `<div class="msg err">跳过/失败 ${res.errors.length} 条：<ul>${res.errors.slice(0, 12).map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`;
  }
  const hasDownload = res.mergedDocx || (res.converted && res.converted.length) || res.mergedMd;
  if (hasDownload) {
    html += `<div class="btn-row" style="margin-top:10px"><button class="btn primary" id="download-btn">下载全部结果 (.zip)</button></div>`;
  }
  resultEl.innerHTML = html;
  const dl = root.querySelector('#download-btn');
  if (dl) dl.addEventListener('click', () => packageAndDownload(res));
  setStatus(ok ? '任务完成' : '任务失败', ok ? 'ok' : 'err');
}

async function packageAndDownload(res) {
  const zip = new JSZip();
  const stamp = timestamp();
  const names = new Set();
  const add = (name, data) => {
    let n = name; let k = 1;
    while (names.has(n)) { n = name.replace(/(\.[^.]+)?$/, `_${k}$1`); k++; }
    names.add(n); zip.file(n, data);
  };
  if (res.mergedDocx) add(`合并结果_${stamp}.docx`, res.mergedDocx);
  for (const c of (res.converted || [])) add(c.name, c.data);
  if (res.mergedMd) add(`合并Markdown_${stamp}.md`, new TextEncoder().encode(res.mergedMd));
  if (res.log) add('任务日志.txt', new TextEncoder().encode(res.log));
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `md_docx_结果_${stamp}.zip`);
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- 工具 ----------
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// 导出用于自动化测试（不影响正常功能）
export { state, run };

