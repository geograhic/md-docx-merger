// UI 冒烟测试：用 jsdom 真正挂载应用，验证初始渲染与模式切换的可见性逻辑不报错。
// 运行：node test/ui-smoke.mjs
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.File = dom.window.File;
global.Blob = dom.window.Blob;
global.FileReader = dom.window.FileReader;
global.HTMLElement = dom.window.HTMLElement;

const { initApp } = await import('../src/app.js');
const app = document.getElementById('app');
initApp(app);

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } };

check('渲染了 4 个模式卡片', app.querySelectorAll('.mode').length === 4);
check('初始文件列表为空提示', /还没有文件/.test(app.querySelector('#file-list').textContent));
check('选项区含 Word 拼接', app.querySelector('#options').innerHTML.includes('Word 拼接'));
check('默认模式(convert_merge)显示“保留单个”', !app.querySelector('#row-keep-single').classList.contains('hidden'));
check('默认模式隐藏 Markdown 拼接', app.querySelector('#row-md-join').classList.contains('hidden'));

// 切换到 md_merge：应显示 Markdown 拼接，隐藏 Word 拼接与保留单个
app.querySelector('.mode[data-mode="md_merge"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
check('md_merge 显示 Markdown 拼接', !app.querySelector('#row-md-join').classList.contains('hidden'));
check('md_merge 隐藏 Word 拼接', app.querySelector('#row-word-join').classList.contains('hidden'));
check('md_merge 隐藏保留单个', app.querySelector('#row-keep-single').classList.contains('hidden'));

// 切回 convert_merge，选文件名标题拼接 -> 文件名标题行可见
app.querySelector('.mode[data-mode="convert_merge"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
const wj = app.querySelector('#word-join-sel');
wj.value = '文件名标题拼接';
wj.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
check('文件名标题拼接时显示文件名标题行', !app.querySelector('#row-filename-title').classList.contains('hidden'));

// 样式表渲染了 8 行（h1..h6, body, code）
check('样式表 8 行', app.querySelectorAll('#style-table tbody tr').length === 8);

console.log(`\nUI 冒烟: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
