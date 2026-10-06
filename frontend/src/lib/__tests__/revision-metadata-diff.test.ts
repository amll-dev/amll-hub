import { describe, expect, it } from 'vitest';

import { computeRevisionDiff } from '../review/revision-diff';
import type { LyricLine, TTMLMetadata } from '../ttml-processor';

function line(i: number, text: string): LyricLine {
  return {
    id: `l${i}`,
    startTime: i * 1000,
    endTime: i * 1000 + 900,
    text,
    words: [],
  } as unknown as LyricLine;
}

const baseLines = [line(0, '第一行'), line(1, '第二行')];

function meta(patch: Partial<TTMLMetadata> = {}): TTMLMetadata {
  return {
    title: ['测试歌曲'],
    artist: ['测试歌手'],
    ...patch,
  } as TTMLMetadata;
}

function diffMeta(before: TTMLMetadata, after: TTMLMetadata) {
  return computeRevisionDiff(
    { metadata: before, lines: baseLines } as never,
    { metadata: after, lines: baseLines } as never
  ).metadata;
}

describe('元数据 diff：扁平字段', () => {
  it('无变化时没有 diff', () => {
    expect(diffMeta(meta(), meta())).toEqual([]);
  });

  it('改标题会被检出，label 是中文', () => {
    const d = diffMeta(meta(), meta({ title: ['新标题'] }));
    expect(d).toHaveLength(1);
    expect(d[0]!.field).toBe('title');
    expect(d[0]!.label).toBe('标题');
    expect(d[0]!.before).toBe('测试歌曲');
    expect(d[0]!.after).toBe('新标题');
  });

  it('数组字段用「、」连接', () => {
    const d = diffMeta(meta({ artist: ['A', 'B'] }), meta({ artist: ['A', 'C'] }));
    expect(d[0]!.before).toBe('A、B');
    expect(d[0]!.after).toBe('A、C');
  });

  it('单值字段（语言）正常工作', () => {
    const d = diffMeta(meta({ language: 'zh' }), meta({ language: 'en' }));
    expect(d[0]!.field).toBe('language');
    expect(d[0]!.before).toBe('zh');
  });
});

describe('元数据 diff：平台 ID 必须摊平（核心回归）', () => {
  it('改一个平台 ID 只产生一条 diff，不是整个 platformIds 一条', () => {
    const before = meta({ platformIds: { ncmMusicId: ['123'], qqMusicId: ['456'] } });
    const after = meta({ platformIds: { ncmMusicId: ['999'], qqMusicId: ['456'] } });
    const d = diffMeta(before, after);
    expect(d).toHaveLength(1);
    expect(d[0]!.field).toBe('platformIds.ncmMusicId');
    expect(d[0]!.before).toBe('123');
    expect(d[0]!.after).toBe('999');
  });

  it('label 是具体平台名，不是笼统的「平台 ID」', () => {
    const before = meta({ platformIds: { ncmMusicId: ['1'] } });
    const after = meta({ platformIds: { ncmMusicId: ['2'] } });
    expect(diffMeta(before, after)[0]!.label).toBe('网易云音乐 ID');
  });

  it('各平台 label 齐全', () => {
    const before = meta({ platformIds: { qqMusicId: ['1'] } });
    const after = meta({ platformIds: { qqMusicId: ['2'] } });
    expect(diffMeta(before, after)[0]!.label).toBe('QQ 音乐 ID');
  });

  it('新增一个平台也算 diff（之前整体比较会漏）', () => {
    const before = meta({ platformIds: { ncmMusicId: ['1'] } });
    const after = meta({
      platformIds: { ncmMusicId: ['1'], spotifyId: ['abc'] },
    });
    const d = diffMeta(before, after);
    expect(d).toHaveLength(1);
    expect(d[0]!.field).toBe('platformIds.spotifyId');
    expect(d[0]!.before).toBe('（空）');
  });

  it('删除一个平台也算 diff', () => {
    const before = meta({ platformIds: { ncmMusicId: ['1'], qqMusicId: ['2'] } });
    const after = meta({ platformIds: { ncmMusicId: ['1'] } });
    const d = diffMeta(before, after);
    expect(d).toHaveLength(1);
    expect(d[0]!.after).toBe('（空）');
  });

  it('不会再出现field 为 platformIds 的整体条目', () => {
    const before = meta({ platformIds: { ncmMusicId: ['1'] } });
    const after = meta({ platformIds: { ncmMusicId: ['2'] } });
    expect(diffMeta(before, after).some((d: { field: string }) => d.field === 'platformIds')).toBe(
      false
    );
  });
});

describe('元数据 diff：自定义键摊平', () => {
  it('rawProperties 里的键各自成条，label 用键名', () => {
    const before = meta({ rawProperties: { 'X-Custom': ['old'] } });
    const after = meta({ rawProperties: { 'X-Custom': ['new'] } });
    const d = diffMeta(before, after);
    expect(d).toHaveLength(1);
    expect(d[0]!.field).toBe('rawProperties.X-Custom');
    expect(d[0]!.label).toBe('X-Custom');
  });

  it('多个自定义键各自独立', () => {
    const before = meta({ rawProperties: { A: ['1'], B: ['2'] } });
    const after = meta({ rawProperties: { A: ['1'], B: ['3'] } });
    const d = diffMeta(before, after);
    expect(d).toHaveLength(1);
    expect(d[0]!.field).toBe('rawProperties.B');
  });
});
