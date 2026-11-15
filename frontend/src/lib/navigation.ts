/**
 * 统一的新窗口打开入口。
 *
 * 必须显式带 `noopener`：老浏览器给 `_blank` 加的目标页可以通过
 * `window.opener` 改写原页面 location（反向 tabnabbing）。`noreferrer`
 * 顺带避免把站内路径泄露给外链。
 */
export function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}
