import type { DocGroup, DocStatus } from '@/lib/types';

/** 文档分组：顺序即侧边栏顺序 */
export const DOC_GROUPS: { key: DocGroup; label: string; hint: string }[] = [
  { key: 'lyrics', label: '歌词库', hint: '格式规范、投稿与审核' },
  { key: 'api', label: 'AMLL Hub API', hint: '接口与接入说明' },
];

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  draft: '草稿',
  published: '已发布',
};

export const DOC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 下拉框选项（DocSelect 用） */
export const DOC_GROUP_OPTIONS = DOC_GROUPS.map((g) => ({ value: g.key, label: g.label }));

export const DOC_STATUS_OPTIONS = [
  { value: 'draft', label: DOC_STATUS_LABEL.draft },
  { value: 'published', label: DOC_STATUS_LABEL.published },
];

/** 未知分组（历史数据）统一按第一个分组展示，避免文档在列表里凭空消失 */
export function groupLabel(group: string): string {
  return DOC_GROUPS.find((g) => g.key === group)?.label ?? DOC_GROUPS[0]?.label ?? '歌词库';
}

/** 按分组桶化，保持 DOC_GROUPS 的顺序；未知分组落到第一个桶 */
export function groupDocs<T extends { group: string }>(
  items: T[]
): { group: DocGroup; label: string; items: T[] }[] {
  const buckets = DOC_GROUPS.map((g) => ({ group: g.key, label: g.label, items: [] as T[] }));
  const fallback = buckets[0];
  if (!fallback) return [];
  for (const item of items) {
    const bucket = buckets.find((b) => b.group === item.group) ?? fallback;
    bucket.items.push(item);
  }
  return buckets.filter((bucket) => bucket.items.length > 0);
}
