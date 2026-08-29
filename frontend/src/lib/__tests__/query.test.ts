import { describe, expect, it } from 'vitest';
import { queryClient, queryKeys } from '@/lib/query';
import { ApiError } from '@/lib/api';

describe('queryKeys', () => {
  it('固定 key 结构稳定（供 invalidate 匹配）', () => {
    expect(queryKeys.stats).toEqual(['stats']);
    expect(queryKeys.latestSongs).toEqual(['latest-songs']);
    expect(queryKeys.profile).toEqual(['auth', 'profile']);
    expect(queryKeys.reviewers).toEqual(['admin', 'reviewers']);
  });

  it('参数化 key 生成确定性数组', () => {
    expect(queryKeys.search('q', 'title', 1)).toEqual([
      'search',
      { q: 'q', field: 'title', page: 1 },
    ]);
    expect(queryKeys.submission(5)).toEqual(['submission', 5]);
    expect(queryKeys.submissionComments(5)).toEqual(['submission', 5, 'comments']);
    expect(queryKeys.onlineViewLyric('ncm', '123')).toEqual(['online-view-lyric', 'ncm', '123']);
  });

  it('submissions 参数差异生成不同 key（不同筛选互不覆盖缓存）', () => {
    const a = queryKeys.submissions({ mode: 'creator', status: 'pending' });
    const b = queryKeys.submissions({ mode: 'creator', status: 'approved' });
    expect(a).not.toEqual(b);
  });
});

describe('queryClient 默认重试策略', () => {
  // retry 类型为 number | 函数，本项目配置为函数，收窄后调用
  const retry = queryClient.getDefaultOptions().queries?.retry as (
    failureCount: number,
    error: unknown
  ) => boolean;

  it('ApiError（业务错误）不重试', () => {
    expect(retry(0, new ApiError('x', 500))).toBe(false);
  });

  it('网络错误最多重试 2 次', () => {
    expect(retry(0, new Error('network'))).toBe(true);
    expect(retry(1, new Error('network'))).toBe(true);
    expect(retry(2, new Error('network'))).toBe(false);
  });

  it('mutation 默认不重试', () => {
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });
});
