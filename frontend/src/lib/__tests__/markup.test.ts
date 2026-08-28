import { describe, expect, it } from 'vitest';
import { escapeHtml, MARKUP_BUTTONS, parseMarkupText, sanitizeHighlightHtml } from '@/lib/markup';

describe('escapeHtml', () => {
  it('转义 HTML 保留字符，防止注入', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });

  it('转义单引号与 & 符号', () => {
    expect(escapeHtml("a&'b")).toBe('a&amp;&#39;b');
  });
});

describe('sanitizeHighlightHtml', () => {
  it('转义 script 标签，脚本无法存活', () => {
    const out = sanitizeHighlightHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('保留白名单的 mark 高亮标签', () => {
    expect(sanitizeHighlightHtml('前<mark>高亮</mark>后')).toBe('前<mark>高亮</mark>后');
  });

  it('mark 内的属性注入被转义，不产生合法标签', () => {
    const out = sanitizeHighlightHtml('<mark onclick=alert(1)>x</mark>');
    expect(out).not.toMatch(/<mark /);
    expect(out).toContain('&lt;mark');
  });

  it('普通文本原样保留', () => {
    expect(sanitizeHighlightHtml('平凡歌词文本')).toBe('平凡歌词文本');
  });
});

describe('parseMarkupText', () => {
  it('[:-:] 居中标记生成 text-align:center 的 span', () => {
    const out = parseMarkupText('[:-:]居中一行');
    expect(out).toContain('text-align:center;');
    expect(out).toContain('居中一行');
  });

  it('[-:] 右对齐标记生成 text-align:right 的 span', () => {
    expect(parseMarkupText('[-:]右')).toContain('text-align:right;');
  });

  it('带下划线 _ 的小字体标记附加小号样式', () => {
    const out = parseMarkupText('[:_:]小字居中');
    expect(out).toContain('text-align:center;');
    expect(out).toContain('font-size:0.8em');
  });

  it('内容做 HTML 转义，标记文本不允许注入', () => {
    const out = parseMarkupText('[:-:]<b>加粗</b>');
    expect(out).toContain('&lt;b&gt;');
    expect(out).not.toContain('<b>');
  });

  it('空输入返回空字符串', () => {
    expect(parseMarkupText('')).toBe('');
  });

  it('标记按钮配置覆盖 6 种对齐组合', () => {
    expect(MARKUP_BUTTONS).toHaveLength(6);
  });
});
