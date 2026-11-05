import { Loader2, Music } from 'lucide-react';
import type { NcmSong } from '@/lib/types';

interface SongSearchRowProps {
  song: NcmSong;
  /** 缩略图地址；为空时显示占位图标 */
  thumbSrc?: string;
  /** 当前是否已选中解析 */
  active?: boolean;
  /** 是否正在解析 */
  loading?: boolean;
  disabled?: boolean;
  /** 表单面板使用更紧凑的尺寸 */
  dense?: boolean;
  onSelect: () => void;
}

/** 平台歌曲搜索结果行 */
export function SongSearchRow({
  song,
  thumbSrc,
  active,
  loading,
  disabled,
  dense,
  onSelect,
}: SongSearchRowProps) {
  const dim = dense ? 'h-10 w-10' : 'h-12 w-12';

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`flex w-full items-center text-left transition-colors ${
        dense ? 'gap-3 px-3 py-2' : 'gap-4 px-4 py-3'
      } ${active ? 'bg-primary-tint' : 'hover:bg-surface-2'}`}
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt=""
          loading="lazy"
          decoding="async"
          className={`${dim} shrink-0 rounded-md object-cover shadow-sm`}
        />
      ) : (
        <div
          className={`${dim} flex shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-3`}
        >
          <Music className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm ${
            dense ? 'text-foreground' : 'font-medium text-foreground'
          }`}
        >
          {song.name}
        </p>
        <p
          className={`truncate text-xs ${dense ? 'text-ink-3' : 'text-ink-2'}`}
        >
          {song.artists.map((a) => a.name).join(' / ')}
          {song.album?.name ? ` · ${song.album.name}` : ''}
        </p>
      </div>
      <span className="shrink-0 text-xs text-ink-3">{song.duration || '--:--'}</span>
      {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
    </button>
  );
}
