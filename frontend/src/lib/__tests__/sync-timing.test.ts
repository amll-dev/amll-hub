import { describe, expect, it } from 'vitest';

import type { LyricLine, Syllable } from '@/lib/ttml-processor';

/** 造一个字 */
function w(text: string, startTime: number, endTime: number): Syllable {
  return { text, startTime, endTime };
}

/** 造一行：给定每字的 [start, end] */
function line(spans: Array<[string, number, number]>): LyricLine {
  const words = spans.map(([text, s, e]) => w(text, s, e));
  return {
    text: spans.map(([t]) => t).join(''),
    startTime: words[0]?.startTime ?? 0,
    endTime: words[words.length - 1]?.endTime ?? 0,
    words,
  };
}

/** 快照一行的所有时间，用于比对「哪些没被改」 */
function snap(l: LyricLine) {
  return {
    lineStart: l.startTime,
    lineEnd: l.endTime,
    text: l.text,
    words: (l.words ?? []).map((x) => [x.startTime, x.endTime] as const),
  };
}

/**
 * 与 use-lyric-editor 中syncStart/syncNext/syncEnd 同构的纯函数版本。
 * （组件里那几个是 useCallback 闭包，无法直接单测；这里镜像实现并逐步演进。）
 */
function syncStart(l: LyricLine, wordIndex: number, t: number) {
  const word = l.words?.[wordIndex];
  if (!word) return;
  word.startTime = t;
  if (wordIndex === 0) l.startTime = t;
}

function syncNext(l: LyricLine, wordIndex: number, t: number) {
  const word = l.words?.[wordIndex];
  if (!word) return;
  const isLast = wordIndex >= (l.words?.length ?? 0) - 1;
  word.endTime = t;
  if (isLast) {
    l.endTime = t;
    return;
  }
  const next = l.words?.[wordIndex + 1];
  if (next) next.startTime = t;
}

function syncEnd(l: LyricLine, wordIndex: number, t: number) {
  const word = l.words?.[wordIndex];
  if (!word) return;
  const isLast = wordIndex >= (l.words?.length ?? 0) - 1;
  word.endTime = Math.max(word.startTime, t);
  if (isLast) l.endTime = word.endTime;
}

describe('syncStart（F 键）', () => {
  it('只改当前字的 startTime，不动 endTime', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
    ]);
    syncStart(l, 0, 1200);
    expect(l.words?.[0]?.startTime).toBe(1200);
    expect(l.words?.[0]?.endTime).toBe(1500);
  });

  it('首字会带动 line.startTime', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
    ]);
    syncStart(l, 0, 1200);
    expect(l.startTime).toBe(1200);
  });

  it('非首字不会带动 line.startTime', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
    ]);
    syncStart(l, 1, 1600);
    expect(l.startTime).toBe(1000);
  });

  it('不动其他任何字 —— 回归测试：曾经整行被重排', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
      ['c', 2000, 2500],
    ]);
    const before = snap(l);
    syncStart(l, 1, 1600);
    const after = snap(l);
    // 第二个字的 endTime、以及第三字的全部时间都必须原封不动
    expect(after.words[0]).toEqual(before.words[0]);
    expect(after.words[2]).toEqual(before.words[2]);
    expect(after.words[1]).toEqual([1600, 2000]);
  });

  it('不动 line.endTime', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
    ]);
    syncStart(l, 0, 1200);
    expect(l.endTime).toBe(2000);
  });

  it('不动行文本', () => {
    const l = line([
      ['Hello', 1000, 1500],
      ['world', 1500, 2000],
    ]);
    syncStart(l, 0, 1200);
    expect(l.text).toBe('Helloworld');
  });
});

describe('syncNext（G 键）', () => {
  it('结束当前字并启动下一个字', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
      ['c', 2000, 2500],
    ]);
    syncNext(l, 0, 1400);
    expect(l.words?.[0]?.endTime).toBe(1400);
    expect(l.words?.[1]?.startTime).toBe(1400);
    // 下一个字的 endTime 不能动
    expect(l.words?.[1]?.endTime).toBe(2000);
  });

  it('同行时不改行边界', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
    ]);
    const before = snap(l);
    syncNext(l, 0, 1400);
    expect(l.startTime).toBe(before.lineStart);
    expect(l.endTime).toBe(before.lineEnd);
  });

  it('只影响相邻两个字，第三个字不动', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
      ['c', 2000, 2500],
    ]);
    const before = snap(l);
    syncNext(l, 0, 1400);
    const after = snap(l);
    expect(after.words[2]).toEqual(before.words[2]);
  });

  it('行尾字打 G 会收line.endTime', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
    ]);
    syncNext(l, 1, 2100);
    expect(l.words?.[1]?.endTime).toBe(2100);
    expect(l.endTime).toBe(2100);
  });

  it('中间字打 G 不会顺手改 line.endTime —— 回归测试', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
      ['c', 2000, 2500],
    ]);
    syncNext(l, 0, 1400);
    expect(l.endTime).toBe(2500);
  });
});

describe('syncEnd（H 键）', () => {
  it('只改当前字 endTime，不动下一个字 startTime', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
    ]);
    syncEnd(l, 0, 1400);
    expect(l.words?.[0]?.endTime).toBe(1400);
    // G 才会启动下一个字，H 不做这件事
    expect(l.words?.[1]?.startTime).toBe(1500);
  });

  it('尾字带动 line.endTime', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
    ]);
    syncEnd(l, 1, 2100);
    expect(l.endTime).toBe(2100);
  });

  it('非尾字不动 line.endTime', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
      ['c', 2000, 2500],
    ]);
    syncEnd(l, 0, 1400);
    expect(l.endTime).toBe(2500);
  });

  it('结束早于开始时夹住，不产生倒挂', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
    ]);
    syncEnd(l, 0, 500);
    expect(l.words?.[0]?.endTime).toBe(1000);
  });
});

describe('setLineRange 的短路保护（回归：误blur 会重排整行）', () => {
  /** 与 use-lyric-editor 中 setLineRange 同构的纯函数版本 */
  function setLineRange(l: LyricLine, start: number, end: number) {
    // 短路：值没变直接返回
    if (Math.abs(start - l.startTime) < 0.5 && Math.abs(end - l.endTime) < 0.5) return;
    const newStart = Math.max(0, start);
    const newSpan = Math.max(1, end - newStart);
    const oldStart = l.startTime;
    const oldSpan = l.endTime - oldStart || 1;
    const ratios = (l.words ?? []).map((w) => ({
      start: (w.startTime - oldStart) / oldSpan,
      end: (w.endTime - oldStart) / oldSpan,
    }));
    l.startTime = newStart;
    l.endTime = newStart + newSpan;
    (l.words ?? []).forEach((w, i) => {
      const r = ratios[i];
      if (!r) return;
      w.startTime = newStart + r.start * newSpan;
      w.endTime = newStart + r.end * newSpan;
    });
  }

  it('值没变时完全不碰整行（点进输入框再点走的场景）', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
      ['c', 2000, 2500],
    ]);
    const before = snap(l);
    // 模拟 onBlur：rangeStart/rangeEnd 一直跟着 line 同步，用户没改
    setLineRange(l, l.startTime, l.endTime);
    expect(snap(l)).toEqual(before);
  });

  it('值真的变了才重排', () => {
    const l = line([
      ['a', 1000, 1500],
      ['b', 1500, 2000],
    ]);
    setLineRange(l, 2000, 4000);
    expect(l.startTime).toBe(2000);
    expect(l.endTime).toBe(4000);
    // 相对间隔按比例缩放
    expect(l.words?.[0]?.startTime).toBe(2000);
  });
});

describe('连续打轴（连按 G 走完整行）', () => {
  it('逐字推进，最终整行时间自洽', () => {
    const l = line([
      ['a', 0, 100],
      ['b', 100, 200],
      ['c', 200, 300],
    ]);
    // 模拟用户以 100ms 为间隔连按三次 G
    syncNext(l, 0, 100);
    syncNext(l, 1, 200);
    syncNext(l, 2, 300);
    expect(snap(l).words).toEqual([
      [0, 100],
      [100, 200],
      [200, 300],
    ]);
    expect(l.startTime).toBe(0);
    expect(l.endTime).toBe(300);
  });

  it('打过的字的时间不会被后续按键冲掉', () => {
    const l = line([
      ['a', 0, 100],
      ['b', 100, 200],
      ['c', 200, 300],
    ]);
    syncNext(l, 0, 100);
    const firstWordTime = [l.words?.[0]?.startTime, l.words?.[0]?.endTime];
    // 之后随便打别的字，第一个字不能变
    syncNext(l, 1, 200);
    syncNext(l, 2, 300);
    expect([l.words?.[0]?.startTime, l.words?.[0]?.endTime]).toEqual(firstWordTime);
  });
});
