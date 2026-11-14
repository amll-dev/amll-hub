import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import { Marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import { markedHighlight } from 'marked-highlight';
import markedAlert from 'marked-alert';
import { api } from '@/lib/api';

hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
// TTML / HTML / SVG 共用 xml 语法
hljs.registerLanguage('html', xml);
hljs.registerLanguage('svg', xml);

/** wiki 页面名 */
const WIKI_SLUGS: Record<string, string> = {
  格式规范: '/docs/format-spec',
  上传歌词: '/docs/upload-guide',
  审核歌词: '/docs/review-guide',
  使用歌词: '/docs/usage-guide',
  'instruction.md': '/docs/format-spec',
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeCode(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** wiki 相对图片路径 → MinIO 站内地址 */
function rewriteAsset(href: string): string {
  if (!href) return href;
  const wikiImg = href.match(/^\.?\/?img\/(.+)$/);
  if (wikiImg?.[1]) return api.uploadFileUrl(`docs/${wikiImg[1]}`);
  const served = href.match(/^\/api\/v1\/uploads\/file\/(.+)$/);
  if (served?.[1]) return api.uploadFileUrl(served[1]);
  return href;
}

/** GitHub wiki 绝对链接 / 相对 .md 链接 → 站内路由 */
function rewriteLink(href: string): string {
  if (!href) return href;
  const raw = safeDecode(href);

  const absolute = raw.match(
    /^https?:\/\/github\.com\/amll-dev\/amll-ttml-db\/wiki\/([^#?]+)(#.*)?$/
  );
  const pageName = absolute?.[1];
  if (pageName) {
    const target = WIKI_SLUGS[pageName.replace(/\.md$/, '')];
    if (target) return target + (absolute?.[2] ?? '');
  }

  const [pathPart = '', hash] = raw.split('#');
  const key = pathPart.replace(/^\.\//, '').replace(/\.md$/, '');
  const target = WIKI_SLUGS[key] ?? WIKI_SLUGS[pathPart];
  if (target) return target + (hash ? `#${hash}` : '');
  return href;
}

const docsMarked = new Marked(
  { gfm: true, breaks: false, async: false },
  // 告示块
  markedAlert(),
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = (lang ?? '').toLowerCase();
      // ```text 之类的纯文本块不做高亮，避免被 xml 规则误标
      if (!language || language === 'text' || language === 'plain' || !hljs.getLanguage(language)) {
        return escapeCode(code);
      }
      try {
        return hljs.highlight(code, { language }).value;
      } catch {
        return escapeCode(code);
      }
    },
  }),
  gfmHeadingId()
);

docsMarked.use({
  walkTokens(token) {
    if (token.type === 'image') token.href = rewriteAsset(token.href);
    if (token.type === 'link') token.href = rewriteLink(token.href);
  },
});

/**
 * 文档正文渲染：与 `components/submission/shared.ts` 的 renderMarkdown 不同，
 * 这里允许原始 HTML（wiki 里有 <table style> / <ruby>），因此必须依赖
 */
export function renderDocsMarkdown(text: string): string {
  if (!text) return '';
  try {
    const html = docsMarked.parse(normalizeAlertMarkers(text)) as string;
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
      ADD_ATTR: [
        'style',
        'align',
        'valign',
        'colspan',
        'rowspan',
        'width',
        'height',
        'id',
        'target',
        'rel',
      ],
      FORBID_TAGS: [
        'script',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'style',
        'link',
        'meta',
      ],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onmouseenter'],
    });
  } catch {
    return escapeCode(text).replace(/\n/g, '<br>');
  }
}

function normalizeAlertMarkers(text: string): string {
  return text.replace(
    /^(\s*(?:>\s*)+)\[!(note|tip|important|warning|caution)\]/gim,
    (_match, prefix: string, kind: string) => `${prefix}[!${kind.toUpperCase()}]`
  );
}

export function scrollToHash(hash: string): void {
  const id = safeDecode(hash.replace(/^#/, ''));
  if (!id) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(id) ?? document.getElementById(id.toLowerCase());
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
