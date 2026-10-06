import { describe, expect, it } from 'vitest';
import {
  renderReviewReport,
  hasReviewReportContent,
} from '@/editor/modules/review/services/report-service/render-service';
import {
  buildLineTimingChanges,
  buildSyncChanges,
  buildSyncReport,
} from '@/editor/modules/review/services/report-service/sync-report-builder';
import { buildMetadataChanges } from '@/editor/modules/review/services/report-service/metadata-report-builder';
import { createReviewReport } from '@/editor/modules/review/services/report-service/normalize-service';
import { mergeReports } from '@/editor/modules/review/services/report-service/merge-service';
import type { TTMLLyric } from '@/editor/types/ttml';

/** 造一行歌词（每字带稳定 id，模拟真实解析产物） */
function makeLine(
  id: string,
  text: string,
  startTime: number,
  endTime: number
): TTMLLyric['lyricLines'][number] {
  return {
    id,
    startTime,
    endTime,
    words: [...text].map((ch, i, arr) => ({
      id: `${id}-w${i}`,
      word: ch,
      startTime: startTime + Math.floor(((endTime - startTime) * i) / arr.length),
      endTime: startTime + Math.floor(((endTime - startTime) * (i + 1)) / arr.length),
    })),
    isBG: false,
  } as unknown as TTMLLyric['lyricLines'][number];
}

function makeLyric(lines: TTMLLyric['lyricLines']): TTMLLyric {
  return { metadata: [], lyricLines: lines } as unknown as TTMLLyric;
}

describe('审核报告：时轴改动能否被检测到', () => {
  it('只改行时间轴（不改任何文字）时，buildLineTimingChanges 应产出条目', () => {
    const freeze = makeLyric([makeLine('l1', '你好', 1000, 2000)]);
    // 审核员在打轴模式把整行往后挪了 500ms
    const staged = makeLyric([makeLine('l1', '你好', 1500, 2500)]);

    const changes = buildLineTimingChanges(freeze, staged);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ oldStart: 1000, newStart: 1500 });
  });

  it('时轴改动经 buildSyncReport + renderReviewReport 后应产出非空 Markdown', () => {
    const freeze = makeLyric([makeLine('l1', '你好', 1000, 2000)]);
    const staged = makeLyric([makeLine('l1', '你好', 1500, 2500)]);

    const report = buildSyncReport([], buildLineTimingChanges(freeze, staged));
    const md = renderReviewReport(report);

    expect(md.trim()).not.toBe('');
    // 有内容时 hasReviewReportContent 必须为 true —— 弹窗靠它决定
    // 「显示报告」还是「显示没有差异的提示」
    expect(hasReviewReportContent(report)).toBe(true);
    // 时轴修正的描述里应带上真实数值（毫秒）
    expect(md).toMatch(/500/);
  });

  it('无改动时 hasReviewReportContent 必须为 false（这是弹窗判空的依据）', () => {
    const freeze = makeLyric([makeLine('l1', '你好', 1000, 2000)]);
    const staged = makeLyric([makeLine('l1', '你好', 1000, 2000)]);

    const report = buildSyncReport([], buildLineTimingChanges(freeze, staged));

    // ⚠️ 关键回归点：renderReviewReport 此时返回的是占位文案
    // 「未检测到差异。」而不是空串。曾经因为只判 `!finalReportMd`
    // 而把这句占位文案当成内容直接显示给用户。
    expect(renderReviewReport(report).trim()).not.toBe('');
    expect(hasReviewReportContent(report)).toBe(false);
  });

  it('只改文字（时轴不动）时，时轴 diff 为空，但文本 diff 应由 buildEditReport 负责', () => {
    const freeze = makeLyric([makeLine('l1', '你好', 1000, 2000)]);
    const staged = makeLyric([makeLine('l1', '你号', 1000, 2000)]);

    // 时轴没动 → 这里必须是空的（否则就是误报）
    expect(buildLineTimingChanges(freeze, staged)).toHaveLength(0);
  });

  it('插入新行时不应把后续所有行误报成时轴改动', () => {
    const freeze = makeLyric([makeLine('l1', '甲', 1000, 2000), makeLine('l2', '乙', 2100, 3000)]);
    // 在第一行前面插一行，后面的行内容与时间都不该变
    const staged = makeLyric([
      makeLine('l0', '新', 500, 900),
      makeLine('l1', '甲', 1000, 2000),
      makeLine('l2', '乙', 2100, 3000),
    ]);

    const changes = buildLineTimingChanges(freeze, staged);

    // 正确实现应按 id 对齐，只报新增/删除，不报 l1/l2 的时轴变化
    expect(changes).toHaveLength(0);
  });
});

/**
 * 逐字（word）时轴 diff —— 打轴模式的主操作路径。
 *
 * 背景：之前只调了 `buildLineTimingChanges`（逐行），漏了
 * `buildSyncChanges`（逐字）。审核员拖的是**每个字的左右边界**，
 * 此时 `word.startTime` 变了但 `line.startTime` 通常没变 →
 * 逐行 diff 一条都检测不到 → 报告为空 → 弹窗显示「未检测到差异」。
 */
describe('审核报告：逐字时轴改动能否被检测到', () => {
  /** 造一行 lyrics，并允许逐字覆写时间轴（模拟打轴拖边界） */
  function makeLineWithWordTimings(
    id: string,
    text: string,
    startTime: number,
    endTime: number,
    /** 每个字相对整行起点的偏移比例（0~1），用来制造「字边界移动」 */
    wordFractions: number[] = []
  ) {
    const line = makeLine(id, text, startTime, endTime);
    if (wordFractions.length === 0) return line;
    line.words = [...text].map((_ch, i) => {
      const f0 = wordFractions[i] ?? i / text.length;
      const f1 = wordFractions[i + 1] ?? (i + 1) / text.length;
      return {
        ...line.words[i],
        startTime: startTime + (endTime - startTime) * f0,
        endTime: startTime + (endTime - startTime) * f1,
      };
    });
    return line;
  }

  it('只拖单个字的边界（行时间不变）时，逐字 diff 必须有产出', () => {
    // 行时间完全不动，只把「你」这个字往后拖（改了 fractions[1]，
    // 于是第 1 个字的 endTime 变了）—— 这是打轴最常见的操作。
    // 注意：这里刻意断言「你」而不是「好」，因为 fractions[1] 改的是
    // 第 1 个字的**结束**边界（下一个字从这里开始）。
    const freeze = makeLyric([
      makeLineWithWordTimings('l1', '你好世界', 1000, 2000, [0, 0.25, 0.5, 0.75]),
    ]);
    const staged = makeLyric([
      makeLineWithWordTimings('l1', '你好世界', 1000, 2000, [0, 0.3, 0.5, 0.75]),
    ]);

    const wordChanges = buildSyncChanges(freeze, staged);

    expect(wordChanges.length).toBeGreaterThan(0);
    expect(wordChanges[0]).toMatchObject({ word: '你' });
  });

  it('逐字改动经完整组装后，报告非空且带真实数值', () => {
    const freeze = makeLyric([
      makeLineWithWordTimings('l1', '你好世界', 1000, 2000, [0, 0.25, 0.5, 0.75]),
    ]);
    const staged = makeLyric([
      makeLineWithWordTimings('l1', '你好世界', 1000, 2000, [0, 0.3, 0.5, 0.75]),
    ]);

    // 逐字 + 逐行都要传，缺一个就会出现「检测不到」
    const report = buildSyncReport(
      buildSyncChanges(freeze, staged),
      buildLineTimingChanges(freeze, staged)
    );

    expect(hasReviewReportContent(report)).toBe(true);
    expect(renderReviewReport(report)).toContain('好');
  });

  it('行时间变、字时间不变时，逐字 diff 不应误报（交给逐行 diff 处理）', () => {
    const freeze = makeLyric([makeLineWithWordTimings('l1', '你好', 1000, 2000, [0, 0.5])]);
    const staged = makeLyric([makeLineWithWordTimings('l1', '你好', 1000, 2000, [0, 0.5])]);

    expect(buildSyncChanges(freeze, staged)).toHaveLength(0);
  });

  it('完全没改动时，两个 diff 都应为空', () => {
    const freeze = makeLyric([makeLineWithWordTimings('l1', '你好', 1000, 2000, [0, 0.5])]);
    const staged = makeLyric([makeLineWithWordTimings('l1', '你好', 1000, 2000, [0, 0.5])]);

    expect(buildSyncChanges(freeze, staged)).toHaveLength(0);
    expect(buildLineTimingChanges(freeze, staged)).toHaveLength(0);
    expect(hasReviewReportContent(buildSyncReport([], []))).toBe(false);
  });
});

/**
 * 元数据 diff（曲名 / 歌手 / 专辑…）。
 *
 * 背景：审核员在元数据弹窗里改字段是常见操作，而 `buildEditReport` 与
 * `buildReviewReportFromDiffs` 都只看 `lyricLines`，元数据改动在报告里
 * 完全看不见 —— 用户明确要求「元数据等其他数据也要 diff」。
 */
describe('审核报告：元数据改动能否被检测到', () => {
  function withMetadata(metadata: Array<{ key: string; value: string[] }>): TTMLLyric {
    return { ...makeLyric([makeLine('l1', '你好', 1000, 2000)]), metadata } as TTMLLyric;
  }

  it('改了标题应产出条目，且带新旧值', () => {
    const freeze = withMetadata([{ key: 'title', value: ['旧标题'] }]);
    const staged = withMetadata([{ key: 'title', value: ['新标题'] }]);

    const blocks = buildMetadataChanges(freeze, staged);

    expect(blocks).toHaveLength(1);
    const rendered = renderReviewReport(createReviewReport(blocks));
    expect(rendered).toContain('标题');
    expect(rendered).toContain('旧标题');
    expect(rendered).toContain('新标题');
  });

  it('新增 / 删除 key 都要能识别', () => {
    const freeze = withMetadata([{ key: 'title', value: ['歌'] }]);
    const staged = withMetadata([
      { key: 'title', value: ['歌'] },
      { key: 'album', value: ['新专辑'] },
    ]);

    const blocks = buildMetadataChanges(freeze, staged);
    expect(blocks).toHaveLength(1);
    expect(renderReviewReport(createReviewReport(blocks))).toContain('新增');

    // 反向：删掉 album
    const removed = buildMetadataChanges(staged, freeze);
    expect(renderReviewReport(createReviewReport(removed))).toContain('删除');
  });

  it('值顺序变化 / 首尾空白 / 空字符串 都不应算改动', () => {
    const freeze = withMetadata([{ key: 'artist', value: ['A', 'B'] }]);
    // 顺序颠倒 + 带空格 + 多一个空串
    const staged = withMetadata([{ key: 'artist', value: [' B ', 'A', '  '] }]);

    expect(buildMetadataChanges(freeze, staged)).toHaveLength(0);
  });

  it('元数据无变化时不应产出任何条目', () => {
    const freeze = withMetadata([{ key: 'title', value: ['歌'] }]);
    const staged = withMetadata([{ key: 'title', value: ['歌'] }]);

    expect(buildMetadataChanges(freeze, staged)).toHaveLength(0);
  });

  it('元数据 diff 与歌词 diff 应能合并成一份报告', () => {
    const freeze = withMetadata([{ key: 'title', value: ['旧标题'] }]);
    const staged = withMetadata([{ key: 'title', value: ['新标题'] }]);
    // 同时改一个字，纯歌词 diff 路径
    const stagedWithLyric = {
      ...staged,
      lyricLines: [makeLine('l1', '你号', 1000, 2000)],
    } as TTMLLyric;

    const lyricsOnly = buildSyncReport([], []);
    const merged = mergeReports([
      lyricsOnly,
      createReviewReport(buildMetadataChanges(freeze, stagedWithLyric)),
    ]);

    expect(hasReviewReportContent(merged)).toBe(true);
    const rendered = renderReviewReport(merged);
    expect(rendered).toContain('标题');
    expect(rendered).toContain('新标题');
  });
});
