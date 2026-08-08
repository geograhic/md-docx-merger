// UI 端到端测试：在 jsdom(browser 路径) 中真正添加文件并 run()，
// 验证 Packer.toBlob + JSZip 打包下载整条链路在「浏览器模式」下可用。
// 运行：node test/ui-e2e.mjs
import { JSDOM, VirtualConsole } from 'jsdom';
import { mdToDocxBytes } from '../src/core/markdownToDocx.js';
import { DEFAULT_STYLE_CONFIG } from '../src/core/styles.js';

const vc = new VirtualConsole(); // 屏蔽 jsdom 的导航类噪声
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/', virtualConsole: vc });
global.window = dom.window;
global.document = dom.window.document;
global.File = dom.window.File;
global.FileReader = dom.window.FileReader;

// 捕获下载的 blob（jsdom 无真实 URL.createObjectURL）
let captured = null;
global.URL = { createObjectURL: (b) => { captured = b; return 'blob:mock'; }, revokeObjectURL: () => {} };

const { initApp, state, run } = await import('../src/app.js');
const app = document.getElementById('app');
initApp(app);

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } };

// 准备文件：一个 md（含图片引用），一个已存在的 docx
const docxBytes = await mdToDocxBytes('# 已存在文档\n正文内容。', { styleConfig: DEFAULT_STYLE_CONFIG });
state.files.push({ id: 'a', name: '笔记一.md', kind: 'md', text: '# 一级标题\n这是 **加粗**。', bytes: null, created: 1, modified: 2 });
state.files.push({ id: 'b', name: '已存在.docx', kind: 'docx', bytes: docxBytes, created: 3, modified: 4 });
state.mode = 'convert_merge';
state.keepSingle = true;
state.wordJoin = '空行拼接';

await run();

check('结果区出现下载按钮', !!app.querySelector('#download-btn'));
check('未标记失败', state.running === false);

// 触发下载
const dl = app.querySelector('#download-btn');
dl.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 300));
check('捕获到下载 blob', !!captured);
if (captured) {
  const buf = new Uint8Array(await captured.arrayBuffer());
  const sig = String.fromCharCode(buf[0], buf[1]);
  check('下载内容是 zip (PK)', sig === 'PK');
  check('zip 体积 > 0', buf.length > 100);
}

// ---- 第二组：mixed_merge 仅含 DOCX，验证 UI 校验已放行 ----
state.files.length = 0;
state.mode = 'mixed_merge';
state.keepSingle = true;
state.wordJoin = '空行拼接';
const onlyDocxBytes = await mdToDocxBytes('# 纯 Word\n只有 DOCX。', { styleConfig: DEFAULT_STYLE_CONFIG });
state.files.push({ id: 'c', name: 'only.docx', kind: 'docx', bytes: onlyDocxBytes, created: 5, modified: 6 });
await run();
check('mixed_merge 仅 DOCX 不失败', !app.querySelector('.msg.err'));
check('mixed_merge 仅 DOCX 出现下载按钮', !!app.querySelector('#download-btn'));

console.log(`\nUI 端到端: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
