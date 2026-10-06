/** 全站统一的日期 / 时间 / 数字格式化 */

/** 解析时间戳：支持 Date / 数字毫秒 / ISO 字符串，非法返回 null */
function toDate(input: Date | number | string | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

const INVALID_TEXT = '-';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const numberFormatter = new Intl.NumberFormat('zh-CN');

/** `2026/08/30 13:45`（非法值返回 '-'） */
export function formatDateTime(input: Date | number | string | null | undefined): string {
  const d = toDate(input);
  if (!d) return INVALID_TEXT;
  return dateTimeFormatter.format(d).replace(/\//g, '-');
}

/** `2026-08-30`（非法值返回 '-'） */
export function formatDate(input: Date | number | string | null | undefined): string {
  const d = toDate(input);
  if (!d) return INVALID_TEXT;
  return dateFormatter.format(d).replace(/\//g, '-');
}

/** 相对时间：一分钟内"刚刚"，一小时内"N 分钟前"，一天内"N 小时前"，七天内"N 天前"，更早回退到日期 */
export function formatRelativeTime(input: Date | number | string | null | undefined): string {
  const d = toDate(input);
  if (!d) return INVALID_TEXT;
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return '刚刚';
  if (abs < hour) return `${Math.floor(abs / minute)} 分钟前`;
  if (abs < day) return `${Math.floor(abs / hour)} 小时前`;
  if (abs < 7 * day) return `${Math.floor(abs / day)} 天前`;
  return formatDate(d);
}

/** 千分位：`12,345` */
export function formatNumber(input: number | null | undefined): string {
  if (!Number.isFinite(input)) return INVALID_TEXT;
  return numberFormatter.format(input as number);
}

/**
 * 计数友好格式：超过一万折算"万"，超过一亿折算"亿"。
 * `9999 -> 9,999`、`12345 -> 1.2万`、`123456789 -> 1.23亿`
 */
export function formatCount(input: number | null | undefined): string {
  if (!Number.isFinite(input)) return INVALID_TEXT;
  const n = input as number;
  const abs = Math.abs(n);
  if (abs >= 100_000_000) return `${trimZero(n / 100_000_000)}亿`;
  if (abs >= 10_000) return `${trimZero(n / 10_000)}万`;
  return formatNumber(n);
}

/** 保留 1~2 位小数并去掉尾随 0 */
function trimZero(v: number): string {
  const s = v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** 毫秒 -> `mm:ss`（音频时长，非法值返回 `--:--`） */
export function formatDuration(ms: number | null | undefined): string {
  if (!Number.isFinite(ms) || (ms as number) <= 0) return '--:--';
  const total = Math.floor((ms as number) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 毫秒 -> `mm:ss.mmm`（歌词时间轴，非法值返回 `00:00.000`） */
export function formatLyricTime(ms: number | null | undefined): string {
  if (!Number.isFinite(ms) || (ms as number) < 0) return '00:00.000';
  const total = Math.floor(ms as number);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

export function msToTimestamp(ms: number, options: { ms?: boolean } = {}): string {
  if (ms === Number.POSITIVE_INFINITY) return '99:99.999';
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
  const secsTotal = total / 1000;
  const secs = secsTotal % 60;
  const mins = Math.floor(secsTotal / 60) % 60;
  const hrs = Math.floor(secsTotal / 3600);

  const h = String(hrs).padStart(2, '0');
  const m = String(mins).padStart(2, '0');
  const s = secs.toFixed(3).padStart(6, '0');
  const sNoMs = String(Math.floor(secs)).padStart(2, '0');

  if (options.ms === false) {
    return hrs > 0 ? `${h}:${m}:${sNoMs}` : `${m}:${sNoMs}`;
  }
  return hrs > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/*
 * 以下两个函数搬自 `src/editor/utils/timestamp.ts`
 * （Copyright 2023-2025 Steve Xiao and contributors, AMLL TTML Tool, GPLv3）。
 *
 * 搬过来是因为 `msToTimestamp` 在本文件与 tool 文件里各有一份重复实现
 * （已用 66 组边界用例验证行为完全一致），而 `parseTimespan` /
 * `formatDurationMs` 是 tool 独有的。统一到本文件后，editor 侧不再
 * 需要依赖那份GPL 文件。
 */

/** 解析时间戳字符串 → 毫秒。支持 `ss(.fff)` / `mm:ss(.fff)` / `hh:mm:ss(.fff)` */
const timeRegexp =
  /^(((?<hour>[0-9]+):)?(?<min>[0-9]+):)?((?<sec>[0-9]+)([.:](?<frac>[0-9]{1,3}))?)$/;

export function parseTimespan(timeSpan: string): number {
  const matches = timeRegexp.exec(timeSpan);
  if (matches) {
    const hour = Number(matches.groups?.hour || '0');
    const min = Number(matches.groups?.min || '0');
    const sec = Number(matches.groups?.sec || '0');
    const frac = Number((matches.groups?.frac || '0').padEnd(3, '0'));
    return (hour * 3600 + min * 60 + sec) * 1000 + frac;
  }
  throw new TypeError(`时间戳字符串解析失败：${timeSpan}`);
}

/** 时长（毫秒）→ `123` 或 `123ms`。主要给输入框做实时回显用。 */
export function formatDurationMs(durationMS: number, options: { suffix?: boolean } = {}): string {
  const { suffix = false } = options;
  const rounded = Math.round(durationMS);
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return `${normalized}${suffix ? 'ms' : ''}`;
}

/** 字节数 -> `1.2 MB` / `320 KB`，非法值返回 '--' */
export function formatBytes(bytes: number | null | undefined): string {
  if (!Number.isFinite(bytes) || (bytes as number) <= 0) return '--';
  const b = bytes as number;
  const mb = b / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}
