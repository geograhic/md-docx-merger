// 把 Obsidian 风味的 Markdown 归一化成标准 Markdown，便于后续转换。
// 镜像桌面版 v2.0 的 normalize_obsidian_markdown / convert_yaml_front_matter / normalize_obsidian_line。

// 把 --- 包裹的 YAML front matter 转成普通文本块（“Obsidian 属性:” 列表）。
export function convertYamlFrontMatter(text) {
  const lines = text.split('\n');
  if (!lines.length || lines[0].trim() !== '---') return text;
  let endIndex = null;
  for (let i = 1; i < Math.min(lines.length, 200); i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }
  if (endIndex == null) return text;

  const converted = ['Obsidian 属性:'];
  const yamlLines = lines.slice(1, endIndex);
  for (const line of yamlLines) {
    if (!line.trim()) continue;
    converted.push(formatYamlPropertyLine(line));
  }
  if (converted.length === 1) converted.push('无');
  return [...converted, '', ...lines.slice(endIndex + 1)].join('\n');
}

function formatYamlPropertyLine(line) {
  const stripped = line.trim();
  if (stripped.startsWith('- ')) return '  ' + stripped.slice(2).trim();
  return stripped;
}

export function normalizeObsidianLine(line) {
  const stripped = line.trim();
  if (['---', '***', '___'].includes(stripped)) return '——';
  const headingMatch = /^\s*#[^\s#].*/.exec(line);
  if (headingMatch) {
    const lead = /^(\s*)/.exec(line)[1];
    return lead + '\\' + line.slice(lead.length);
  }
  line = line.replace(/^\s*>\s*\[![^\]]+\]\s*/, '> ');
  line = line.replace(/^(\s*)[-*]\s+\[( |x|X)\]\s+/, '$1待办: ');
  line = line.replace(/==(.+?)==/g, '**$1**');
  line = line.replace(/~~(.+?)~~/g, '$1');
  line = line.replace(/!\[\[([^\]]+)\]\]/g, '[附件: $1]');
  line = line.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2 ($1)');
  line = line.replace(/\[\[([^\]]+)\]\]/g, '$1');
  line = line.replace(/%%\.?%%/g, '').replace(/%%[\s\S]*?%%/g, '');
  line = line.replace(/\s+\^[A-Za-z0-9_-]+\s*$/, '');
  return line;
}

// 整体归一化：换行统一 + front matter + 逐行处理。
export function normalizeObsidianMarkdown(text) {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = convertYamlFrontMatter(text);
  const lines = [];
  let inCode = false;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s.startsWith('```') || s.startsWith('~~~')) {
      inCode = !inCode;
      lines.push(line);
      continue;
    }
    if (inCode) {
      lines.push(line);
      continue;
    }
    lines.push(normalizeObsidianLine(line));
  }
  return lines.join('\n');
}
