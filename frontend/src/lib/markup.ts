/**
 * 标记语言解析
 *
 * 支持的标记：
 * [:-:]文本  — 居中
 * [:-]文本   — 左对齐
 * [-:]文本   — 右对齐
 * [:_:]文本  — 小字体居中
 * [:_]文本   — 小字体左对齐
 * [_:]文本   — 小字体右对齐
 * [-]        — 分割线（可带文本）
 */

/** HTML 转义，防止 XSS */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 净化搜索高亮 HTML：先转义全部 HTML，再仅恢复白名单高亮标签 <mark>。
 * 即使后端返回的 snippet 被注入脚本也无法执行（纵深防御）
 */
export function sanitizeHighlightHtml(html: string): string {
  return escapeHtml(html)
    .replace(/&lt;mark&gt;/g, '<mark>')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

// 内联样式常量（Tailwind 无法处理 dangerouslySetInnerHTML 中的 class 字符串）
const STYLE_LINE = 'display:block;margin-bottom:0.54em;';
const STYLE_SMALL = 'font-size:0.8em;opacity:0.9;';
const DASHED_LINE =
  'flex:1;height:1px;background:repeating-linear-gradient(to right,#4a4a4a 0px,#4a4a4a 2px,transparent 2px,transparent 4px);max-width:37.5%;min-width:0;';

/**
 * 解析标记文本，返回 HTML 字符串（用于 dangerouslySetInnerHTML）
 * 使用内联样式，不依赖外部 CSS
 */
export function parseMarkupText(text: string): string {
  if (!text) return '';

  try {
    const lines = text.split('\n');
    const processedLines: string[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      const match = trimmedLine.match(/^\[([:_-]+)\](.*)$/);

      if (match) {
        const spec = match[1] ?? '';
        const content = match[2] ?? '';

        if (!/^[:_-]+$/.test(spec)) {
          processedLines.push(
            `<span style="${STYLE_LINE}text-align:left;">${escapeHtml(trimmedLine)}</span>`
          );
          continue;
        }

        // 分割线标记 [-]
        if (spec === '-') {
          const textContent = content.trim();
          if (textContent) {
            processedLines.push(
              `<span style="display:flex;align-items:center;justify-content:center;margin:0.25em 0;gap:8px;position:relative;width:50%;margin-left:auto;margin-right:auto;min-height:1.5em;">` +
                `<span style="${DASHED_LINE}"></span>` +
                `<span style="font-size:0.67em;color:#4a4a4a;padding:0 8px;white-space:nowrap;flex-shrink:0;line-height:1;">${escapeHtml(textContent)}</span>` +
                `<span style="${DASHED_LINE}"></span>` +
                `</span>`
            );
          } else {
            processedLines.push(
              `<span style="height:0.25em;margin:0.25em 0;display:block;visibility:hidden;"></span>`
            );
          }
          continue;
        }

        // 确定对齐方式
        const normalizedSpec = spec.replace(/_/g, '-');
        let align = 'left';
        if (normalizedSpec.includes(':-:')) {
          align = 'center';
        } else if (normalizedSpec.includes('-:') && !normalizedSpec.includes(':-:')) {
          align = 'right';
        }

        const isSmall = spec.includes('_');
        const escapedContent = escapeHtml(content.trim());
        const style = STYLE_LINE + `text-align:${align};` + (isSmall ? STYLE_SMALL : '');
        processedLines.push(`<span style="${style}">${escapedContent}</span>`);
      } else {
        if (trimmedLine === '') {
          processedLines.push(`<span style="${STYLE_LINE}"></span>`);
        } else {
          processedLines.push(
            `<span style="${STYLE_LINE}text-align:left;">${escapeHtml(trimmedLine)}</span>`
          );
        }
      }
    }

    return processedLines.join('');
  } catch {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

/** 标记快捷按钮配置 */
export interface MarkupButton {
  label: string;
  markup: string;
  title: string;
}

/** 6 个标记快捷按钮 */
export const MARKUP_BUTTONS: MarkupButton[] = [
  { label: '居中', markup: '[:-:]', title: '居中对齐' },
  { label: '左对齐', markup: '[:-]', title: '左对齐' },
  { label: '右对齐', markup: '[-:]', title: '右对齐' },
  { label: '小字居中', markup: '[:_:]', title: '小字体居中' },
  { label: '小字左', markup: '[:_]', title: '小字体左对齐' },
  { label: '小字右', markup: '[_:]', title: '小字体右对齐' },
];

/**
 * 在 textarea 光标处插入标记
 * 若有选中文本，则用标记包裹选中文本
 */
export function insertMarkup(textarea: HTMLTextAreaElement, markup: string): string {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.substring(start, end);

  let newValue: string;
  if (selected) {
    newValue = value.substring(0, start) + markup + selected + value.substring(end);
  } else {
    newValue = value.substring(0, start) + markup + value.substring(end);
  }

  const cursorPos = start + markup.length + (selected ? selected.length : 0);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(cursorPos, cursorPos);
  });

  return newValue;
}
