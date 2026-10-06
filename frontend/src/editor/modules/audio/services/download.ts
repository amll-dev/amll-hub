export type DownloadProgress = {
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
};

export type DownloadProgressHandler = (progress: DownloadProgress) => void;

const parseContentLength = (response: Response) => {
  const value = response.headers.get('Content-Length');
  if (!value) return null;
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? size : null;
};

export const readResponseBlobWithProgress = async (
  response: Response,
  onProgress?: DownloadProgressHandler
) => {
  const totalBytes = parseContentLength(response);
  const contentType = response.headers.get('content-type') ?? '';

  if (!onProgress || !response.body) {
    const blob = await response.blob();
    if (onProgress) {
      const loadedBytes = totalBytes ?? blob.size;
      onProgress({
        loadedBytes,
        totalBytes,
        percent: totalBytes ? 100 : null,
      });
    }
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let loadedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = new ArrayBuffer(value.byteLength);
      new Uint8Array(chunk).set(value);
      chunks.push(chunk);
      loadedBytes += value.byteLength;
      onProgress({
        loadedBytes,
        totalBytes,
        percent: totalBytes ? Math.min(100, (loadedBytes / totalBytes) * 100) : null,
      });
    }
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks, { type: contentType });
};
