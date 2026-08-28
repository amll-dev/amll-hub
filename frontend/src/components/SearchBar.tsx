import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Loader2, Search } from 'lucide-react';
import type { SearchField } from '@/lib/types';
import { buttonTap } from '@/lib/motion';
import { useSearchContext } from '@/hooks/useSearchContext';

const fieldOptions: { value: SearchField; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'song', label: '歌曲' },
  { value: 'artist', label: '歌手' },
  { value: 'album', label: '专辑' },
  { value: 'lyric', label: '歌词' },
  { value: 'id', label: '音乐ID' },
];

interface Props {
  query: string;
  field: SearchField;
  loading: boolean;
  onQueryChange: (v: string) => void;
  onFieldChange: (v: SearchField) => void;
  /** 提交搜索 */
  onSubmit: () => void;
  /** 紧凑模式 */
  compact?: boolean;
}

function FieldSelect({
  value,
  onChange,
}: {
  value: SearchField;
  onChange: (v: SearchField) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = fieldOptions.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-11 items-center gap-1 rounded-md border border-input bg-card pl-3 pr-7 text-sm font-medium text-foreground transition-colors hover:border-primary focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-[var(--amll-primary-soft)]`}
      >
        {current?.label}
        <ChevronDown
          className={`pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[120px] overflow-hidden rounded-md border border-line bg-popover p-1 shadow-lg"
          >
            {fieldOptions.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`block w-full rounded px-3 py-2 text-left text-sm transition-colors hover:bg-primary-tint hover:text-primary ${
                    o.value === value
                      ? 'bg-primary-tint font-medium text-primary'
                      : 'text-foreground'
                  }`}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SearchBar({
  query,
  field,
  loading,
  onQueryChange,
  onFieldChange,
  onSubmit,
  compact = false,
}: Props) {
  const { registerInput, hasQuery } = useSearchContext();
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 h-11">
      <FieldSelect value={field} onChange={onFieldChange} />

      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input
          ref={registerInput}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索歌曲、歌手、专辑或歌词…"
          autoFocus={compact}
          className="w-full h-11 rounded-md border border-input bg-card pl-10 pr-4 text-sm text-foreground transition-colors placeholder:text-ink-3 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-[var(--amll-primary-soft)]"
        />
      </div>

      <motion.button
        type="submit"
        disabled={loading}
        {...buttonTap}
        initial={false}
        animate={{
          paddingLeft: hasQuery ? 12 : 20,
          paddingRight: hasQuery ? 12 : 20,
          gap: hasQuery ? 0 : 6,
        }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className="inline-flex h-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Search className="h-4 w-4 shrink-0" />
        )}
        <motion.span
          initial={false}
          animate={{ opacity: hasQuery ? 0 : 1, maxWidth: hasQuery ? 0 : 40 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="overflow-hidden whitespace-nowrap"
        >
          搜索
        </motion.span>
      </motion.button>
    </form>
  );
}
