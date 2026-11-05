import { Loader2, Play } from 'lucide-react';
import type { MusicPlatform } from '@/lib/types';

interface SongPreviewCardProps {
  cover?: string;
  name?: string;
  artists?: string;
  /** 时长（毫秒） */
  durationMs?: number;
  /** 平台歌曲 ID */
  songId: string;
  /** 来源平台 */
  platform?: MusicPlatform;
  /** 有播放链接时才显示播放按钮 */
  canPlay: boolean;
  playing: boolean;
  onPlay: () => void;
}

/** 解析中的占位 / 失败提示 */
export function SongPreviewStatus({
  loading,
  error,
  platformLabel,
}: {
  loading: boolean;
  error: string;
  platformLabel: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在解析{platformLabel}歌曲信息…
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-ink-3">
        {platformLabel}解析失败：{error}
      </p>
    );
  }
  return null;
}

/** 平台歌曲信息卡片 */
export function SongPreviewCard({
  cover,
  name,
  artists,
  durationMs,
  songId,
  platform,
  canPlay,
  playing,
  onPlay,
}: SongPreviewCardProps) {
  const durationStr = durationMs
    ? `${Math.floor(durationMs / 60000)}:${String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0')}`
    : '';

  return (
    <div className="relative flex gap-4 rounded-lg border border-line bg-surface-2 p-4">
      {cover && (
        <img
          src={cover}
          alt={name || '封面'}
          className="h-20 w-20 shrink-0 rounded-lg border border-line object-cover"
        />
      )}
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {name && <span className="truncate text-base font-semibold text-foreground">{name}</span>}
          {platform && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-card px-1.5 py-0.5 text-[10px] text-ink-3">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  platform === 'qq' ? 'bg-[#31c27c]' : 'bg-[#c20c0c]'
                }`}
              />
              {platform === 'qq' ? 'QQ 音乐' : '网易云音乐'}
            </span>
          )}
        </div>
        {artists && (
          <div className="text-ink-2">
            <span className="text-ink-3">艺术家：</span>
            {artists}
          </div>
        )}
        {durationStr && <div className="text-ink-3">时长：{durationStr}</div>}
        <div className="text-ink-3">ID：{songId}</div>
      </div>
      {canPlay && (
        <div className="absolute right-4 top-1/2 flex -translate-y-1/2 shrink-0 gap-2">
          <button
            type="button"
            onClick={onPlay}
            disabled={playing}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {playing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            播放
          </button>
        </div>
      )}
    </div>
  );
}
