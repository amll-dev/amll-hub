/** 校验错误中的 Markdown 链接：[查看文档](/docs/metadata-guide#...) */
const LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g;

export interface ValidationDocLink {
  label: string;
  href: string;
}

/** 只放行站内路径与 http(s) 链接，避免渲染出 javascript: 等危险协议 */
export function isSafeLinkHref(href: string): boolean {
  return href.startsWith('/') || href.startsWith('https://') || href.startsWith('http://');
}

/** 从校验错误里取第一个可安全打开的文档链接 */
export function findValidationDocLink(text: string): ValidationDocLink | null {
  for (const match of text.matchAll(LINK_PATTERN)) {
    const [, label, href] = match;
    if (label && href && isSafeLinkHref(href)) return { label, href };
  }
  return null;
}

/** 去掉 Markdown 链接语法，保留链接文字（toast 等纯文本场景） */
export function stripValidationLinks(text: string): string {
  return text.replace(LINK_PATTERN, '$1');
}

/** 把校验错误拆成文本片段与可点击链接 */
export type ValidationTextPart = string | ValidationDocLink;

export function splitValidationText(text: string): ValidationTextPart[] {
  const parts: ValidationTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const [, label, href] = match;
    if (label && href && isSafeLinkHref(href)) {
      parts.push({ label, href });
    } else {
      parts.push(match[0]);
    }
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
