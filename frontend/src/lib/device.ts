/**
 * 浏览器设备标识：用于识别「新设备登录」。
 *
 * 只存一个随机 UUID，不含任何指纹信息；用户清除站点数据后会重新生成，
 * 属于预期行为（届时会被当作一次新设备登录）。
 */
const DEVICE_ID_KEY = 'amllhub_device_id';

let cachedDeviceId = '';

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      cachedDeviceId = existing;
      return existing;
    }
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    cachedDeviceId = id;
    return id;
  } catch {
    // 隐私模式/存储被禁用时退化为空，后端会跳过设备维度判定
    return '';
  }
}

/** 当前浏览器的可读设备名，用于展示「本次登录设备」 */
export function getDeviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  if (browser && os) return `${browser} / ${os}`;
  return os || browser || '未知设备';
}
