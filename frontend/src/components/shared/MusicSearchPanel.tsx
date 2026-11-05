import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Search } from 'lucide-react';
import { searchPlatformSongs } from '@/lib/song-search';
import { queryKeys } from '@/lib/query';
import { PLATFORM_OPTIONS } from '@/lib/platform';
import { buttonTap } from '@/lib/motion';
import { SegmentedSwitch } from '@/components/shared/SegmentedSwitch';
import { SongSearchRow } from '@/components/shared/SongSearchRow';
import type { MusicPlatform, NcmSong } from '@/lib/types';

/** 搜索选中后回填表单需要的字段 */
export interface PickedSong {
  /** 平台歌曲 ID */
  id: string;
  name: string;
  artists: string;
  album: string;
  /** 封面地址 */
  cover: string;
}

interface MusicSearchPanelProps {
  /** 选中结果回调 */
  onPick: (song: PickedSong, platform: MusicPlatform) => void;
  className?: string;
}

/** 从音乐平台搜索填表 */
export function MusicSearchPanel({ onPick, className }: MusicSearchPanelProps) {
  const [platform, setPlatform] = useState<MusicPlatform>('ncm');
  const [input, setInput] = useState('');
  const [committed, setCommitted] = useState('');

  const isQQ = platform === 'qq';

  const searchQuery = useQuery({
    queryKey: isQQ ? queryKeys.qmSearch(committed) : queryKeys.ncmSearch(committed),
    queryFn: () => searchPlatformSongs(platform, committed),
    enabled: !!committed,
    staleTime: 60_000,
  });

  const results: NcmSong[] = committed ? (searchQuery.data ?? []) : [];
  const searching = searchQuery.isFetching;
  const error = searchQuery.error
    ? searchQuery.error instanceof Error
      ? searchQuery.error.message
      : '搜索失败'
    : committed && !searchQuery.isFetching && results.length === 0
      ? '没有找到相关歌曲'
      : '';

  const doSearch = () => {
    const q = input.trim();
    if (!q) return;
    if (q === committed) {
      void searchQuery.refetch();
      return;
    }
    setCommitted(q);
  };

  // 切换平台
  const changePlatform = (p: MusicPlatform) => {
    if (p === platform) return;
    setPlatform(p);
    setCommitted('');
  };

  const pick = (song: NcmSong) => {
    onPick(
      {
        id: String(song.id),
        name: song.name,
        artists: song.artists.map((a) => a.name).join(' / '),
        album: song.album?.name ?? '',
        cover: song.picUrl || song.album?.picUrl || '',
      },
      platform
    );
    setCommitted('');
    setInput('');
  };

  const thumb = (song: NcmSong) => {
    const src = song.picUrl || song.album?.picUrl;
    if (!src) return '';
    return isQQ ? src : `${src}?param=80y80`;
  };

  return (
    <div className={className ?? 'rounded-md border border-line bg-card p-5'}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium text-ink-2">从音乐平台搜索填表</label>
        <SegmentedSwitch
          options={PLATFORM_OPTIONS}
          value={platform}
          onChange={changePlatform}
          size="sm"
        />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              doSearch();
            }
          }}
          placeholder={`输入歌名 / 歌手，从${isQQ ? 'QQ 音乐' : '网易云'}搜索`}
          className="h-11 flex-1 rounded-md border border-input bg-background px-4 text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <motion.button
          type="button"
          {...buttonTap}
          onClick={doSearch}
          disabled={searching || !input.trim()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          搜索
        </motion.button>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="mt-2 text-xs text-error"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {results.length > 0 && (
          <motion.ul
            key={`${platform}-results`}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] } }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="mt-3 max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line bg-background"
          >
            {results.map((song) => (
              <li key={`${platform}-${song.id}`}>
                <SongSearchRow
                  song={song}
                  thumbSrc={thumb(song)}
                  dense
                  onSelect={() => pick(song)}
                />
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
