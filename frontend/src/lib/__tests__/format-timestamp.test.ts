import { describe, expect, it } from 'vitest';
import { formatDurationMs, msToTimestamp, parseTimespan } from '@/lib/format';

describe('msToTimestamp', () => {
  it('不足 1 分钟：m:ss.mmm，秒与毫秒各补齐两位/三位', () => {
    expect(msToTimestamp(0)).toBe('00:00.000');
    expect(msToTimestamp(1000)).toBe('00:01.000');
    expect(msToTimestamp(61_500)).toBe('01:01.500');
    expect(msToTimestamp(9_040)).toBe('00:09.040');
  });

  it('超过 1 分钟：分钟不封顶（歌词页最长也就几小时）', () => {
    expect(msToTimestamp(61_000)).toBe('01:01.000');
    expect(msToTimestamp(600_000)).toBe('10:00.000');
    expect(msToTimestamp(3_599_000)).toBe('59:59.000');
  });

  it('超过 1 小时补出小时段（formatLyricTime 不做，这里必须做）', () => {
    expect(msToTimestamp(3_600_000)).toBe('01:00:00.000');
    expect(msToTimestamp(3_661_500)).toBe('01:01:01.500');
    expect(msToTimestamp(36_000_000)).toBe('10:00:00.000');
  });

  it('ms:false 丢掉毫秒段，只保留到秒', () => {
    expect(msToTimestamp(61_500, { ms: false })).toBe('01:01');
    expect(msToTimestamp(3_661_500, { ms: false })).toBe('01:01:01');
  });

  it('非法值统一归零，不显示 NaN', () => {
    expect(msToTimestamp(Number.NaN)).toBe('00:00.000');
    expect(msToTimestamp(-1)).toBe('00:00.000');
    expect(msToTimestamp(Number.NEGATIVE_INFINITY)).toBe('00:00.000');
  });

  it('时长未知（<audio> 还没 loadedmetadata）显示 Infinity 占位', () => {
    expect(msToTimestamp(Number.POSITIVE_INFINITY)).toBe('99:99.999');
  });

  it('毫秒位来自四舍五入后的总毫秒，不做截断', () => {
    expect(msToTimestamp(1_999_999)).toBe('33:19.999');
    expect(msToTimestamp(1_999_400)).toBe('33:19.400');
    expect(msToTimestamp(999.6)).toBe('00:01.000');
  });
});

describe('parseTimespan', () => {
  it('解析秒 / 分秒 / 时分秒', () => {
    expect(parseTimespan('5')).toBe(5_000);
    expect(parseTimespan('5.5')).toBe(5_500);
    expect(parseTimespan('1:30')).toBe(90_000);
    expect(parseTimespan('1:30.250')).toBe(90_250);
    expect(parseTimespan('1:02:03')).toBe(3_723_000);
  });

  it('毫秒位数不足时右补零', () => {
    expect(parseTimespan('0.1')).toBe(100);
    expect(parseTimespan('0.12')).toBe(120);
    expect(parseTimespan('0.123')).toBe(123);
  });

  it('冒号也可作小数点（兼容 .S 写法）', () => {
    expect(parseTimespan('1:2:3')).toBe(3_723_000);
  });

  it('非法输入抛 TypeError', () => {
    expect(() => parseTimespan('abc')).toThrow(TypeError);
    expect(() => parseTimespan('')).toThrow(TypeError);
  });

  it('与 msToTimestamp 互逆', () => {
    for (const ms of [0, 1_000, 61_500, 3_661_500]) {
      expect(parseTimespan(msToTimestamp(ms))).toBe(ms);
    }
  });
});

describe('formatDurationMs', () => {
  it('默认不带后缀', () => {
    expect(formatDurationMs(123)).toBe('123');
    expect(formatDurationMs(0)).toBe('0');
  });

  it('suffix:true 时补ms', () => {
    expect(formatDurationMs(123, { suffix: true })).toBe('123ms');
    expect(formatDurationMs(0, { suffix: true })).toBe('0ms');
  });

  it('四舍五入，且避免 -0', () => {
    expect(formatDurationMs(123.4)).toBe('123');
    expect(formatDurationMs(123.5)).toBe('124');
    expect(formatDurationMs(-0.4)).toBe('0');
  });
});
