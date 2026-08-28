/** 信息列表键值行 */
export function MetaItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex border-b border-line py-2 last:border-0">
      <dt className="w-32 shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="flex-1 break-words text-sm text-foreground">{value || '—'}</dd>
    </div>
  );
}
