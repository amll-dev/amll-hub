/** 触发浏览器下载的 <a> 点击（统一入口） */
export function triggerDownloadUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Blob 下载：用完即 revoke，避免 object URL 泄漏 */
export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    triggerDownloadUrl(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}
