// 样式配置 + 选项映射。镜像桌面版 v2.0 的常量。
// 这些是与 DOM 无关的纯数据，浏览器 / Node 测试均可复用。

export const APP_VERSION = 'web-1.0.0';
export const APP_TITLE = `Markdown 批量转 Word / 合并（网页版）${APP_VERSION}`;

export const SORT_OPTIONS = {
  '手动顺序': 'manual',
  '文件名 A-Z': 'name_asc',
  '文件名 Z-A': 'name_desc',
  '创建时间 早->晚': 'created_asc',
  '创建时间 晚->早': 'created_desc',
  '修改时间 早->晚': 'modified_asc',
  '修改时间 晚->早': 'modified_desc',
};

export const JOIN_OPTIONS = {
  '直接连续拼接': 'direct',
  '空行拼接': 'blank_line',
  '分页拼接': 'page_break',
  '分隔线拼接': 'horizontal_rule',
  '文件名标题拼接': 'filename_heading',
};

export const MD_JOIN_OPTIONS = {
  '直接连续拼接': 'direct',
  '空行拼接': 'blank_line',
  '分隔线拼接': 'horizontal_rule',
  '文件名标题拼接': 'filename_heading',
};

export const FILENAME_TITLE_OPTIONS = {
  '带后缀': 'with_ext',
  '不带后缀': 'stem',
};

export const DEFAULT_STYLE_CONFIG = {
  h1: { label: '一级标题 #', style: 'Heading 1', font: 'Microsoft YaHei', size: 20, bold: true },
  h2: { label: '二级标题 ##', style: 'Heading 2', font: 'Microsoft YaHei', size: 16, bold: true },
  h3: { label: '三级标题 ###', style: 'Heading 3', font: 'Microsoft YaHei', size: 14, bold: true },
  h4: { label: '四级标题 ####', style: 'Heading 4', font: 'Microsoft YaHei', size: 12, bold: true },
  h5: { label: '五级标题 #####', style: 'Heading 5', font: 'Microsoft YaHei', size: 11, bold: true },
  h6: { label: '六级标题 ######', style: 'Heading 6', font: 'Microsoft YaHei', size: 10, bold: true },
  body: { label: '正文', style: 'Normal', font: 'Microsoft YaHei', size: 10.5, bold: false },
  code: { label: '代码', style: 'Normal', font: 'Consolas', size: 9, bold: false },
};

export const DEFAULT_FONTS = [
  'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong', 'Consolas',
  'Arial', 'Times New Roman', 'Calibri', 'Cambria',
];

// 把 UI 里拿到的样式配置规范化，缺字段用默认值兜底。
export function normalizeStyleConfig(raw) {
  const out = {};
  for (const [role, def] of Object.entries(DEFAULT_STYLE_CONFIG)) {
    const r = (raw && raw[role]) || {};
    out[role] = {
      style: String(r.style || def.style),
      font: String(r.font || def.font),
      size: Number(r.size),
      bold: r.bold != null ? Boolean(r.bold) : Boolean(def.bold),
      label: def.label,
    };
  }
  return out;
}
