import imageCompression from 'browser-image-compression';

const PASSTHROUGH_TYPES = new Set(['image/svg+xml', 'image/gif']);

/** 压缩目标：正方形边长与体积上限 */
const AVATAR_SIZE = 512;
const AVATAR_MAX_SIZE_MB = 0.4;

export interface CompressAvatarOptions {
  /** 输出边长（像素），默认 512 */
  size?: number;
  /** 体积上限（MB），默认 0.4 */
  maxSizeMB?: number;
}

/** 解码为位图，createImageBitmap 能按 EXIF 摆正方向 */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // 部分格式（如某些 svg）会失败，退回 <img> 解码
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type));
}

function replaceExt(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  return `${base || 'avatar'}${ext}`;
}

/**
 * 把头像图裁成居中正方形、按 zoom 放大后压缩为新的 File。
 *
 * @param file 原始图片
 * @param zoom 放大倍数，1 表示按最短边铺满正方形
 * @returns 压缩后的 File；无法处理时原样返回入参
 */
export async function compressAvatar(
  file: File,
  zoom = 1,
  options: CompressAvatarOptions = {}
): Promise<File> {
  const { size = AVATAR_SIZE, maxSizeMB = AVATAR_MAX_SIZE_MB } = options;
  if (PASSTHROUGH_TYPES.has(file.type)) return file;
  if (!file.type.startsWith('image/')) return file;

  // ===== 1. 居中正方形 + 放大 =====
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return file;
  }

  const sw = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
  const sh = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
  if (!sw || !sh) return file;

  // zoom 越大，可见区域越小（相当于把画面放大）
  const side = Math.min(sw, sh) / Math.max(1, zoom);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, size, size);
  if ('close' in bitmap) bitmap.close();

  // 中间产物用 png（无损、带透明），避免二次编码前就丢质量
  const blob = await canvasToBlob(canvas, 'image/png');
  if (!blob) return file;
  const cropped = new File([blob], replaceExt(file.name, '.png'), { type: 'image/png' });

  // ===== 2. 编码压缩（worker 内自动降质到目标体积）=====
  try {
    const compressed = await imageCompression(cropped, {
      maxSizeMB,
      maxWidthOrHeight: size,
      useWebWorker: true,
      // 源图可能是 png（带透明），统一转 webp；浏览器不支持时库会退回原格式
      fileType: 'image/webp',
      initialQuality: 0.92,
      preserveExif: false,
    });
    // 库不一定改文件后缀，这里按真实 MIME 补齐，避免出现「webp 内容 + .png 名」
    const ext = compressed.type === 'image/webp' ? '.webp' : '.jpg';
    if (!/\.webp$/i.test(compressed.name)) {
      return new File([compressed], replaceExt(file.name, ext), { type: compressed.type });
    }
    return compressed;
  } catch (err) {
    // 压缩失败不阻断上传：裁好的图本身已经限到 512px，直接传也够小
    console.warn('[avatar] 压缩失败，改用裁切后的原图上传', err);
    return cropped;
  }
}
