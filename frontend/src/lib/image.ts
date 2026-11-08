import imageCompression from 'browser-image-compression';

const PASSTHROUGH_TYPES = new Set(['image/svg+xml', 'image/gif']);

/** 头像目标：正方形边长与体积上限 */
const AVATAR_SIZE = 512;
const AVATAR_MAX_SIZE_MB = 0.4;

/** 主页背景图目标尺寸（3:1）与体积上限 */
const BANNER_WIDTH = 1600;
const BANNER_HEIGHT = 533;
const BANNER_MAX_SIZE_MB = 0.6;

export interface CompressAvatarOptions {
  /** 输出边长（像素），默认 512 */
  size?: number;
  /** 体积上限（MB），默认 0.4 */
  maxSizeMB?: number;
}

export interface CompressBannerOptions {
  /** 输出宽高（像素），默认 1600×533（3:1） */
  width?: number;
  height?: number;
  /** 体积上限（MB），默认 0.6 */
  maxSizeMB?: number;
}

/** 裁切压缩参数 */
interface CropCompressOptions {
  width: number;
  height: number;
  maxSizeMB: number;
  initialQuality: number;
  /** 日志标签 */
  label: string;
  /** SVG / GIF 是否原样返回 */
  passthrough: boolean;
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
  return `${base || 'image'}${ext}`;
}

/**
 * 按目标宽高比居中裁切、按 zoom 放大，再压缩为 WebP。
 * 无法解码时原样返回。SVG 是否放行由调用方决定。
 */
async function compressCropped(file: File, zoom: number, opts: CropCompressOptions): Promise<File> {
  if (opts.passthrough && PASSTHROUGH_TYPES.has(file.type)) return file;
  if (!file.type.startsWith('image/')) return file;

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return file;
  }

  const sw = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
  const sh = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
  if (!sw || !sh) return file;

  // 先按目标比例铺满，超出目标比例时改按高度铺满
  const targetRatio = opts.width / opts.height;
  let cw = sw;
  let ch = sw / targetRatio;
  if (ch > sh) {
    ch = sh;
    cw = sh * targetRatio;
  }

  // zoom 越大，可见区域越小（相当于把画面放大）
  const scale = 1 / Math.max(1, zoom);
  cw *= scale;
  ch *= scale;

  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, opts.width, opts.height);
  if ('close' in bitmap) bitmap.close();

  // 中间产物用 png（无损、带透明），避免二次编码前就丢质量
  const blob = await canvasToBlob(canvas, 'image/png');
  if (!blob) return file;
  const cropped = new File([blob], replaceExt(file.name, '.png'), { type: 'image/png' });

  // 编码压缩（worker 内自动降质到目标体积）
  try {
    const compressed = await imageCompression(cropped, {
      maxSizeMB: opts.maxSizeMB,
      maxWidthOrHeight: Math.max(opts.width, opts.height),
      useWebWorker: true,
      // 源图可能是 png（带透明），统一转 webp；浏览器不支持时库会退回原格式
      fileType: 'image/webp',
      initialQuality: opts.initialQuality,
      preserveExif: false,
    });
    // 库不一定改文件后缀，这里按真实 MIME 补齐，避免出现「webp 内容 + .png 名」
    const ext = compressed.type === 'image/webp' ? '.webp' : '.jpg';
    if (!/\.webp$/i.test(compressed.name)) {
      return new File([compressed], replaceExt(file.name, ext), { type: compressed.type });
    }
    return compressed;
  } catch (err) {
    // 压缩失败不阻断上传：裁切后的图本身已在尺寸上限内
    console.warn(`[${opts.label}] 压缩失败，改用裁切后的原图上传`, err);
    return cropped;
  }
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
  return compressCropped(file, zoom, {
    width: size,
    height: size,
    maxSizeMB,
    initialQuality: 0.92,
    label: 'avatar',
    passthrough: true,
  });
}

/**
 * 把任意图片按 3:1 居中裁切并按 zoom 放大后压缩为 WebP，用于主页背景图。
 *
 * - SVG 直接抛错：同源 SVG 可执行脚本，前后端都不接受
 * - 无法解码时原样返回，交由后端按魔数判定并拒绝
 *
 * @param zoom 放大倍数，1 表示按目标比例铺满（与头像的裁切逻辑一致）
 */
export async function compressBanner(
  file: File,
  zoom = 1,
  options: CompressBannerOptions = {}
): Promise<File> {
  const { width = BANNER_WIDTH, height = BANNER_HEIGHT, maxSizeMB = BANNER_MAX_SIZE_MB } = options;
  if (file.type === 'image/svg+xml') throw new Error('不支持 SVG 格式');
  return compressCropped(file, zoom, {
    width,
    height,
    maxSizeMB,
    initialQuality: 0.86,
    label: 'banner',
    passthrough: false,
  });
}
