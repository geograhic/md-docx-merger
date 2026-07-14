// Markdown 原文合并（md -> md）：按拼接方式把多个 Markdown 文本顺序拼接成一个。
function joinSeparator(joinMode) {
  if (joinMode === 'blank_line') return '\n\n';
  if (joinMode === 'horizontal_rule') return '\n\n---\n\n';
  if (joinMode === 'filename_heading') return '\n\n';
  return '\n';
}

export function mergeMarkdownTexts(items, { joinMode = 'direct', titleFor } = {}) {
  const parts = [];
  for (let i = 0; i < items.length; i++) {
    const text = (items[i].text || '').trim();
    if (joinMode === 'filename_heading') {
      if (parts.length) parts.push('\n\n');
      parts.push(`# ${titleFor ? titleFor(i) : items[i].name}\n\n`);
    } else if (parts.length) {
      parts.push(joinSeparator(joinMode));
    }
    parts.push(text);
  }
  return parts.join('').replace(/\s+$/, '') + '\n';
}
