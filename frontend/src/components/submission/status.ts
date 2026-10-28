/** 投稿状态的展示元数据 */
export const statusMeta: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-surface-2 text-ink-2' },
  pending: { label: '待审核', className: 'bg-amber-100 text-amber-700' },
  reviewing: { label: '审核中', className: 'bg-blue-100 text-blue-700' },
  need_revision: { label: '需修改', className: 'bg-orange-100 text-orange-700' },
  missing_audio: { label: '缺音频', className: 'bg-orange-100 text-orange-700' },
  revised: { label: '待投稿者确认', className: 'bg-purple-100 text-purple-700' },
  approved: { label: '已通过', className: 'bg-green-100 text-green-700' },
  rejected: { label: '未通过', className: 'bg-red-100 text-red-700' },
  closed: { label: '已关闭', className: 'bg-surface-2 text-ink-3' },
};

/** 语言代码 → 中文名 */
const langLabel: Record<string, string> = {
  zh: '汉语',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  others: '其他',
};

export function langText(code?: string): string {
  if (!code) return '—';
  return langLabel[code] ?? code;
}

/**
 * 多选语言展示：优先用 languages 数组，老数据回落到单值 language。
 * 数组为空时同样回落，保证历史投稿显示不变。
 */
export function langListText(languages?: string[], language?: string): string {
  const list = languages?.filter(Boolean) ?? [];
  if (list.length === 0) return langText(language);
  return list.map((l) => langLabel[l] ?? l).join('、');
}
