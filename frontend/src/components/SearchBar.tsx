import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CompositionEvent, FormEvent, KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Search } from 'lucide-react';
import { buttonTap } from '@/lib/motion';
import { useSearchContext } from '@/hooks/useSearchContext';

interface Props {
  query: string;
  loading: boolean;
  onQueryChange: (v: string) => void;
  /** 提交搜索 */
  onSubmit: () => void;
  /** 紧凑模式 */
  compact?: boolean;
}

export function SearchBar({ query, loading, onQueryChange, onSubmit, compact = false }: Props) {
  const { registerInput, hasQuery } = useSearchContext();

  // 显示文本
  const [draft, setDraft] = useState(query);
  // 是否在选择词语
  const composing = useRef(false);

  useEffect(() => {
    if (composing.current) {
      return;
    }
    setDraft(query);
  }, [query]);

  const handleCompositionStart = () => {
    composing.current = true;
  };

  const handleCompositionEnd = (e: CompositionEvent<HTMLInputElement>) => {
    composing.current = false;
    const value = e.currentTarget.value;
    setDraft(value);
    onQueryChange(value);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDraft(value);
    if (composing.current) {
      return;
    }
    onQueryChange(value);
  };

  // 选择候选词的时候拦截回车避免错误提交
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && (composing.current || e.nativeEvent.isComposing)) {
      e.preventDefault();
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (composing.current) {
      return;
    }
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 h-11">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input
          ref={registerInput}
          type="text"
          value={draft}
          onChange={handleChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={handleKeyDown}
          placeholder="搜索歌曲、歌手、专辑、歌词或用户…"
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
