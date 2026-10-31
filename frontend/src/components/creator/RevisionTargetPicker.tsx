import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { SearchHit } from '@/lib/types';

/** 自动匹配用的新稿元数据 */
export interface RevisionAutoMeta {
  title?: string;
  artist?: string;
  /** 新稿 TTML 里声明的平台 ID */
  platformIds?: Record<string, string[]>;
}

interface RevisionTargetPickerProps {
  value: SearchHit | null;
  onChange: (hit: SearchHit | null) => void;
  /** 新稿的歌名及歌手 */
  autoQuery: string;
  autoMeta?: RevisionAutoMeta;
  disabled?: boolean;
}

/** 元数据平台字段 */
const PLATFORM_KEYS: Array<[string, string]> = [
  ['ncm_music_id', 'ncm'],
  ['qq_music_id', 'qq'],
  ['apple_music_id', 'am'],
  ['spotify_id', 'spotify'],
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s\-_()[\]【】（）]/g, '');
}

/** 给候选歌词打分：平台 ID 精确命中 > 歌名完全一致 > 歌手一致 > 包含 */
function scoreHit(hit: SearchHit, meta?: RevisionAutoMeta): number {
  let score = 0;
  for (const [metaKey, hitKey] of PLATFORM_KEYS) {
    const wanted = meta?.platformIds?.[metaKey] ?? [];
    const got = hit.platformIds[hitKey] ?? [];
    if (wanted.some((id) => got.includes(id))) score += 100;
  }

  const title = normalize(meta?.title ?? '');
  const names = hit.musicNames.map(normalize);
  if (title && names.includes(title)) score += 50;
  else if (title && names.some((n) => n.includes(title) || title.includes(n))) score += 20;

  const artist = normalize(meta?.artist ?? '');
  const artists = hit.artists.map(normalize);
  if (artist && artists.some((a) => a === artist)) score += 30;
  else if (artist && artists.some((a) => a.includes(artist) || artist.includes(a))) score += 15;

  return score;
}

function pickBestHit(hits: SearchHit[], meta?: RevisionAutoMeta): SearchHit | null {
  let best: SearchHit | null = null;
  let bestScore = 0;
  for (const hit of hits) {
    const score = scoreHit(hit, meta);
    if (score > bestScore) {
      best = hit;
      bestScore = score;
    }
  }
  return best;
}

function hitTitle(hit: SearchHit): string {
  return hit.musicNames.join(' / ') || '未知歌曲';
}

/** 搜索并选择要修正的原歌词 */
export function RevisionTargetPicker({
  value,
  onChange,
  autoQuery,
  autoMeta,
  disabled,
}: RevisionTargetPickerProps) {
  const initialQuery = autoQuery.trim();
  const [q, setQ] = useState(initialQuery);
  const [debouncedQ, setDebouncedQ] = useState(initialQuery);
  const [autoNote, setAutoNote] = useState('');
  const autoDoneRef = useRef(false);
  const lastAutoQueryRef = useRef(initialQuery);

  // 输入防抖，避免逐字请求
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  const { data, isFetching, error } = useQuery({
    queryKey: queryKeys.revisionTarget(debouncedQ),
    queryFn: () => api.search({ q: debouncedQ, limit: 12 }),
    enabled: debouncedQ.length > 0,
    staleTime: 60_000,
  });
  const hits = useMemo(() => data?.hits ?? [], [data]);

  // 清空上一次的选择，用新歌名重新搜索
  useEffect(() => {
    const next = autoQuery.trim();
    if (!next || next === lastAutoQueryRef.current) return;
    lastAutoQueryRef.current = next;
    autoDoneRef.current = false;
    setAutoNote('');
    setQ(next);
    onChange(null);
  }, [autoQuery, onChange]);

  // 自动选中得分最高的候选
  useEffect(() => {
    if (autoDoneRef.current || value || !autoQuery || !data) return;
    if (debouncedQ !== autoQuery.trim()) return;
    autoDoneRef.current = true;
    const best = pickBestHit(hits, autoMeta);
    if (!best) {
      setAutoNote('未匹配到合适的歌词，请手动搜索');
      return;
    }
    setAutoNote(`已自动匹配：${hitTitle(best)}`);
    onChange(best);
  }, [autoQuery, autoMeta, data, debouncedQ, hits, onChange, value]);

  const select = (hit: SearchHit) => {
    autoDoneRef.current = true;
    setAutoNote('');
    onChange(hit);
  };

  const clear = () => {
    autoDoneRef.current = true;
    setAutoNote('');
    onChange(null);
  };

  return (
    <div className="rounded-md border border-line bg-surface-2 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink-2">
          要修正的歌词
          <span className="ml-1.5 text-xs font-normal text-ink-3">必选</span>
        </span>
        {value && (
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            className="text-xs text-primary hover:underline disabled:opacity-50"
          >
            重新选择
          </button>
        )}
      </div>

      {value ? (
        <div className="rounded border border-line bg-background p-3">
          <p className="truncate text-sm font-medium text-foreground">{hitTitle(value)}</p>
          <p className="mt-0.5 truncate text-xs text-ink-2">
            {value.artists.join(' / ') || '未知歌手'}
            {value.albums.length > 0 && ` · ${value.albums.join(' / ')}`}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] text-ink-3">{value.rawLyricFile}</p>
          {autoNote && (
            <p className="mt-2 flex min-w-0 items-start gap-1.5 text-xs text-primary">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{autoNote}</span>
            </p>
          )}
        </div>
      ) : (
        <>
          <input
            type="text"
            value={q}
            disabled={disabled}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索歌曲名 / 歌手 / 专辑 / 平台 ID"
            className="h-10 w-full rounded-md border border-input bg-background px-4 text-sm outline-none focus:border-primary disabled:opacity-60"
          />
          {autoNote && <p className="mt-2 text-xs text-ink-3">{autoNote}</p>}

          {debouncedQ.length > 0 && (
            <div className="mt-3 max-h-72 overflow-auto overscroll-contain rounded border border-line bg-background">
              {isFetching && hits.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-ink-3">搜索中…</p>
              ) : error ? (
                <p className="px-3 py-6 text-center text-xs text-red-600">
                  {error instanceof Error ? error.message : '搜索失败'}
                </p>
              ) : hits.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-ink-3">未找到匹配的歌词</p>
              ) : (
                <ul className="divide-y divide-line">
                  {hits.map((hit) => (
                    <li key={`${hit.id}-${hit.rawLyricFile}`}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => select(hit)}
                        className="w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {hitTitle(hit)}
                          </span>
                          <span className="shrink-0 text-[11px] text-ink-3">
                            {hit.lineCount} 行
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-2">
                          {hit.artists.join(' / ') || '未知歌手'}
                          {hit.albums.length > 0 && ` · ${hit.albums.join(' / ')}`}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
