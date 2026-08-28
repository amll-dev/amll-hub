import { AnimatePresence, motion } from 'framer-motion';
import { ListMusic, Music, Play, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { usePlayer } from '@/hooks/usePlayer';

/** 播放列表浮窗*/
export function PlaylistPanel() {
  const {
    playlist,
    currentIndex,
    showPlaylistPanel,
    closePlaylistPanel,
    playAtIndex,
    removeFromPlaylist,
    clearPlaylist,
    loading,
  } = usePlayer();

  const listContainerRef = useRef<HTMLDivElement>(null);
  const currentItemRef = useRef<HTMLLIElement>(null);

  // 面板打开时自动定位到当前歌曲
  useEffect(() => {
    if (!showPlaylistPanel) return;
    const raf = requestAnimationFrame(() => {
      const container = listContainerRef.current;
      const item = currentItemRef.current;
      if (!container || !item) return;
      const cRect = container.getBoundingClientRect();
      const iRect = item.getBoundingClientRect();
      container.scrollTop += iRect.top - cRect.top - (cRect.height - iRect.height) / 2;
    });
    return () => cancelAnimationFrame(raf);
  }, [showPlaylistPanel, currentIndex]);

  return (
    <AnimatePresence>
      {showPlaylistPanel && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          className="fixed bottom-[84px] right-4 z-[190] flex max-h-[60vh] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-white/40 bg-card/55 shadow-2xl backdrop-blur-2xl backdrop-saturate-[1.8]"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <ListMusic className="h-4 w-4 text-ink-2" />
              <h3 className="text-sm font-semibold text-foreground">播放列表</h3>
              <span className="rounded-full bg-surface-2/60 px-1.5 py-0.5 text-[10px] text-ink-3">
                {playlist.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {playlist.length > 0 && (
                <button
                  type="button"
                  onClick={clearPlaylist}
                  className="rounded p-1.5 text-ink-3 transition-colors hover:bg-surface-2/60 hover:text-error"
                  title="清空"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={closePlaylistPanel}
                className="rounded p-1.5 text-ink-3 transition-colors hover:bg-surface-2/60 hover:text-foreground"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 列表 */}
          <div ref={listContainerRef} className="flex-1 overflow-y-auto">
            {playlist.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 px-6 text-center">
                <ListMusic className="h-6 w-6 text-ink-3" />
                <p className="text-xs text-ink-2">播放列表为空</p>
                <p className="text-[11px] text-ink-3">从歌单解析页点击「播放全部」添加歌曲</p>
              </div>
            ) : (
              <ul>
                {playlist.map((item, idx) => {
                  const isCurrent = idx === currentIndex;
                  return (
                    <li key={`${item.songId}-${idx}`} ref={isCurrent ? currentItemRef : undefined}>
                      <div
                        className={`group flex items-center gap-2 px-3 py-2 transition-colors ${
                          isCurrent ? 'bg-primary-tint' : 'hover:bg-surface-2/60'
                        }`}
                      >
                        {/* 封面 */}
                        <button
                          type="button"
                          onClick={() => playAtIndex(idx)}
                          className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-surface-2/60 transition-transform hover:scale-105"
                          title={isCurrent ? '正在播放' : '播放此曲'}
                        >
                          {item.cover ? (
                            <img
                              src={item.cover}
                              alt={item.name}
                              loading="lazy"
                              className={`h-full w-full object-cover transition-opacity ${
                                isCurrent ? 'opacity-70' : 'opacity-100'
                              }`}
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center">
                              <Music className="h-3.5 w-3.5 text-ink-3" />
                            </span>
                          )}
                          {/* 当前播放：柔和的半透明遮罩 + 播放图标 */}
                          {isCurrent && (
                            <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                              {loading ? (
                                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/80 border-t-transparent" />
                              ) : (
                                <Play className="h-3.5 w-3.5 text-white" fill="currentColor" />
                              )}
                            </span>
                          )}
                        </button>
                        {/* 信息 */}
                        <button
                          type="button"
                          onClick={() => playAtIndex(idx)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div
                            className={`truncate text-xs font-medium ${
                              isCurrent ? 'text-primary' : 'text-foreground'
                            }`}
                          >
                            {item.name}
                          </div>
                          <div className="truncate text-[11px] text-ink-3">{item.artists}</div>
                        </button>
                        {/* 删除 */}
                        <button
                          type="button"
                          onClick={() => removeFromPlaylist(idx)}
                          className="rounded p-1 text-ink-3 opacity-0 transition-all hover:text-error group-hover:opacity-100"
                          title="从列表移除"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
