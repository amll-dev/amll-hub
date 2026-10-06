import { describe, expect, it } from 'vitest';
import { computeRevisionDiff } from '@/lib/review/revision-diff';
import type { LyricLine, TTMLMetadata, TTMLResult } from '@/lib/ttml-processor';

/** 构造一行；默认按文本均分出逐字时间轴，避免误触「缺逐字时间轴」问题 */
function line(text: string, start: number, end: number, extra: Partial<LyricLine> = {}): LyricLine {
  const words =
    extra.words ??
    [...text].map((ch, i, arr) => ({
      text: ch,
      startTime: start + Math.floor(((end - start) * i) / arr.length),
      endTime: start + Math.floor(((end - start) * (i + 1)) / arr.length),
    }));
  return { text, startTime: start, endTime: end, words, ...extra };
}

function doc(lines: LyricLine[], metadata: TTMLMetadata = {}): TTMLResult {
  return { metadata, lines };
}

describe('computeRevisionDiff —— 完全相同', () => {
  it('无改动时所有行标记为 unchanged 且统计全零', () => {
    const data = doc([line('你好', 1000, 2000), line('世界', 2000, 3000)]);
    const diff = computeRevisionDiff(data, structuredClone(data));

    expect(diff.stats.modifiedLines).toBe(0);
    expect(diff.stats.unchangedLines).toBe(2);
    expect(diff.stats.addedLines).toBe(0);
    expect(diff.stats.removedLines).toBe(0);
    expect(diff.stats.problemLineCount).toBe(0);
    expect(diff.metadata).toHaveLength(0);
    expect(diff.lines.every((l) => l.kind === 'unchanged')).toBe(true);
  });
});

describe('computeRevisionDiff —— 文本与时间改动', () => {
  it('改一个字的文本后标记该行 textChanged', () => {
    const before = doc([
      line('你好', 1000, 2000, { words: [{ text: '你', startTime: 1000, endTime: 1500 }] }),
    ]);
    const after = doc([
      line('你号', 1000, 2000, { words: [{ text: '你', startTime: 1000, endTime: 1500 }] }),
    ]);

    const diff = computeRevisionDiff(before, after);
    expect(diff.stats.textChangedLines).toBe(1);
    expect(diff.stats.timingChangedLines).toBe(0);
    expect(diff.lines[0]?.textChanged).toBe(true);
    expect(diff.lines[0]?.revisedText).toBe('你号');
  });

  it('改行起点后统计 startShift 与 timingChanged', () => {
    const before = doc([line('你好', 1000, 2000)]);
    const after = doc([line('你好', 1250, 2250)]);

    const diff = computeRevisionDiff(before, after);
    expect(diff.stats.timingChangedLines).toBe(1);
    expect(diff.lines[0]?.startShift).toBe(250);
    expect(diff.lines[0]?.shifts[0]).toMatchObject({ kind: 'line', from: 1000, to: 1250 });
  });

  it('字数一致时逐字偏移单独统计，阈值 120ms 计入 shiftedWordCount', () => {
    const before = doc([
      line('你好', 1000, 2000, {
        words: [
          { text: '你', startTime: 1000, endTime: 1500 },
          { text: '好', startTime: 1500, endTime: 2000 },
        ],
      }),
    ]);
    // 第一个字延后 200ms（超阈值），第二个字不动
    const after = doc([
      line('你好', 1200, 2200, {
        words: [
          { text: '你', startTime: 1200, endTime: 1700 },
          { text: '好', startTime: 1700, endTime: 2200 },
        ],
      }),
    ]);

    const diff = computeRevisionDiff(before, after);
    expect(diff.stats.totalWordCount).toBe(2);
    expect(diff.stats.shiftedWordCount).toBe(2); // 行起点 + 首字，两处都超阈值
    expect(diff.stats.maxAbsWordShift).toBe(200);
    expect(diff.stats.meanAbsWordShift).toBe(200);
  });

  it('字数不一致时不做逐字偏移对比（视为整体重排）', () => {
    const before = doc([
      line('你好啊', 1000, 2000, {
        words: [
          { text: '你', startTime: 1000, endTime: 1300 },
          { text: '好', startTime: 1300, endTime: 1600 },
          { text: '啊', startTime: 1600, endTime: 2000 },
        ],
      }),
    ]);
    // 修订稿逐字时间轴丢失，只剩行级
    const after = doc([line('你好啊', 1300, 2300, { words: [] })]);

    const diff = computeRevisionDiff(before, after);
    // 只有行级偏移，逐字偏移为空
    expect(diff.lines[0]?.shifts.filter((s) => s.kind === 'word')).toHaveLength(0);
    expect(diff.lines[0]?.shifts.filter((s) => s.kind === 'line')).toHaveLength(1);
    // 平均/最大偏移只统计逐字，因此这里为 0
    expect(diff.stats.meanAbsWordShift).toBe(0);
    expect(diff.stats.maxAbsWordShift).toBe(0);
    // 丢逐字会被问题检测抓到
    expect(diff.stats.problems.some((p) => p.kind === 'missing-words')).toBe(true);
  });
});

describe('computeRevisionDiff —— 增删与配对', () => {
  it('按文本匹配把新增行识别为 added', () => {
    const before = doc([line('第一句', 1000, 2000)]);
    const after = doc([line('第一句', 1000, 2000), line('第二句', 2000, 3000)]);

    const diff = computeRevisionDiff(before, after);
    expect(diff.stats.addedLines).toBe(1);
    expect(diff.stats.removedLines).toBe(0);
    expect(diff.stats.unchangedLines).toBe(1);
  });

  it('中间插入一行时，原有行仍按内容正确配对', () => {
    const before = doc([line('A', 1000, 2000), line('C', 3000, 4000)]);
    const after = doc([line('A', 1000, 2000), line('B', 2000, 3000), line('C', 3000, 4000)]);

    const diff = computeRevisionDiff(before, after);
    expect(diff.stats.addedLines).toBe(1);
    const modified = diff.lines.filter((l) => l.kind !== 'unchanged');
    expect(modified).toHaveLength(1);
    expect(modified[0]?.revisedText).toBe('B');
  });

  it('删除一行识别为 removed', () => {
    const before = doc([line('A', 1000, 2000), line('B', 2000, 3000)]);
    const after = doc([line('A', 1000, 2000)]);

    const diff = computeRevisionDiff(before, after);
    expect(diff.stats.removedLines).toBe(1);
    expect(diff.stats.unchangedLines).toBe(1);
  });

  it('整行时间轴改动会重新配对（时间不匹配但顺序一致）', () => {
    const before = doc([line('A', 1000, 2000), line('B', 2000, 3000)]);
    // 两行时间整体平移 500ms
    const after = doc([line('A', 1500, 2500), line('B', 2500, 3500)]);

    const diff = computeRevisionDiff(before, after);
    expect(diff.stats.removedLines).toBe(0);
    expect(diff.stats.addedLines).toBe(0);
    expect(diff.stats.modifiedLines).toBe(2);
    expect(diff.lines.every((l) => l.originalText === l.revisedText)).toBe(true);
  });
});

describe('computeRevisionDiff —— 结构变化与元数据', () => {
  it('翻译/音译/背景歌词/对唱变化被记为 featureChanges', () => {
    const before = doc([
      line('你好', 1000, 2000, {
        translations: [{ text: 'hello' }],
        romanizations: [{ text: 'ni hao' }],
      }),
    ]);
    const after = doc([
      line('你好', 1000, 2000, {
        translations: [{ text: 'hi' }],
        romanizations: [],
        backgroundVocal: { text: 'oh', startTime: 1000, endTime: 2000 },
        agentId: 'v2',
      }),
    ]);

    const diff = computeRevisionDiff(before, after);
    const features = diff.lines[0]?.featureChanges ?? [];
    expect(features).toContain('翻译已修改');
    expect(features).toContain('音译已删除');
    expect(features).toContain('背景歌词已修改');
    expect(features).toContain('对唱归属已调整');
    // 结构变化也算 modified，但不计入文本/时间改动
    expect(diff.stats.textChangedLines).toBe(0);
    expect(diff.stats.timingChangedLines).toBe(0);
    expect(diff.stats.modifiedLines).toBe(1);
  });

  it('元数据差异按字段列出，空值统一显示为（空）', () => {
    const before = doc([line('A', 1000, 2000)], { title: ['旧标题'], artist: ['歌手'] });
    const after = doc([line('A', 1000, 2000)], { title: ['新标题'] });

    const diff = computeRevisionDiff(before, after);
    const titleDiff = diff.metadata.find((m) => m.field === 'title');
    expect(titleDiff).toMatchObject({ label: '标题', before: '旧标题', after: '新标题' });

    const artistDiff = diff.metadata.find((m) => m.field === 'artist');
    expect(artistDiff?.after).toBe('（空）');

    // 未变化的字段不进 diff
    expect(diff.metadata.find((m) => m.field === 'songwriters')).toBeUndefined();
  });

  it('数组字段顺序变化会被记为差异（歌手顺序有语义）', () => {
    const before = doc([line('A', 1000, 2000)], { artist: ['甲', '乙'] });
    const after = doc([line('A', 1000, 2000)], { artist: ['乙', '甲'] });

    const artistDiff = computeRevisionDiff(before, after).metadata.find(
      (m) => m.field === 'artist'
    );
    expect(artistDiff).toBeDefined();
    expect(artistDiff?.before).toBe('甲、乙');
    expect(artistDiff?.after).toBe('乙、甲');
  });

  it('对象字段按 key 排序序列化，键序不同不算差异', () => {
    const before = doc([line('A', 1000, 2000)], { rawProperties: { z: ['1'], a: ['2'] } });
    const after = doc([line('A', 1000, 2000)], { rawProperties: { a: ['2'], z: ['1'] } });

    expect(computeRevisionDiff(before, after).metadata).toHaveLength(0);
  });
});

describe('computeRevisionDiff —— 问题检测', () => {
  it('检出时间倒挂 / 缺逐字 / 行间重叠 / 负时间', () => {
    const after = doc([
      // 倒挂：end(1000) < start(2000)，且与下一行 (start 2000) 不重叠
      line('倒挂', 2000, 1000, { words: [{ text: '倒', startTime: 2000, endTime: 1000 }] }),
      // 缺逐字（显式传空 words）+ 与下一行重叠：end(3000) > next.start(2500)
      line('重叠', 2000, 3000, { words: [] }),
      line('后续', 2500, 3500, { words: [{ text: '后', startTime: 2500, endTime: 3500 }] }),
    ]);
    const diff = computeRevisionDiff(
      doc([line('x', 0, 1, { words: [{ text: 'x', startTime: 0, endTime: 1 }] })]),
      after
    );
    const kinds = diff.stats.problems.map((p) => p.kind);

    expect(kinds).toContain('reversed');
    expect(kinds).toContain('missing-words');
    expect(kinds).toContain('overlap');
    expect(diff.stats.problemLineCount).toBe(diff.stats.problems.length);
  });

  it('正常歌词不报问题', () => {
    const clean = doc([
      line('A', 1000, 2000, { words: [{ text: 'A', startTime: 1000, endTime: 2000 }] }),
      line('B', 2000, 3000, { words: [{ text: 'B', startTime: 2000, endTime: 3000 }] }),
    ]);
    const diff = computeRevisionDiff(clean, structuredClone(clean));
    expect(diff.stats.problemLineCount).toBe(0);
  });
});
