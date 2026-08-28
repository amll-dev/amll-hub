import { AnimatePresence, motion } from 'framer-motion';
import { SearchBar } from './SearchBar';
import { useStats } from '@/hooks/useStats';
import { useSearchContext } from '@/hooks/useSearchContext';
import { listItem, staggerContainer } from '@/lib/motion';

function formatNum(n: number) {
  return n.toLocaleString('zh-CN');
}

function StatBadge({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-2xl font-bold text-foreground">{value}</span>
      <span className="text-xs text-ink-3">{label}</span>
    </div>
  );
}

export function Hero() {
  const { data: stats, loading, error } = useStats();
  const {
    query,
    field,
    loading: searching,
    setQuery,
    setField,
    submit,
    hasQuery,
  } = useSearchContext();

  // 搜索模式下 Hero 不渲染，避免 pt-[120px] pb-16 占据空间
  // 导致搜索结果和顶栏之间有大段距离
  if (hasQuery) return null;

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      className="px-6 pb-16 pt-[120px]"
    >
      <div className="mx-auto max-w-[1200px]">
        {/* 装饰性内容（标题/副标题/统计）搜索时隐藏 */}
        <AnimatePresence mode="popLayout">
          {!hasQuery && (
            <motion.div
              key="hero-deco"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
                className="text-center text-[clamp(40px,7vw,72px)] font-bold leading-tight tracking-[-0.03em]"
              >
                AMLLHub
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
                className="mt-4 text-center text-lg text-ink-2"
              >
                Apple Music Like Lyrics 歌词社区 · 搜索、发现、贡献逐词歌词
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* SearchBar 槽位 */}
        <div className={hasQuery ? 'flex justify-center' : 'mt-10 flex justify-center'}>
          <AnimatePresence mode="popLayout">
            {!hasQuery && (
              <motion.div
                key="searchbar"
                layoutId="searchbar"
                className="relative z-[100]"
                style={{ width: 460, maxWidth: '100%' }}
                transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
              >
                <SearchBar
                  query={query}
                  field={field}
                  loading={searching}
                  onQueryChange={setQuery}
                  onFieldChange={setField}
                  onSubmit={submit}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence mode="popLayout">
          {!hasQuery && (
            <motion.div
              key="hero-stats"
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
              variants={staggerContainer}
              className="mx-auto mt-10 flex max-w-[640px] flex-wrap items-center justify-center gap-x-10 gap-y-6"
            >
              {loading ? (
                <>
                  <div className="amll-skeleton h-12 w-24 rounded-md" />
                  <div className="amll-skeleton h-12 w-24 rounded-md" />
                  <div className="amll-skeleton h-12 w-24 rounded-md" />
                  <div className="amll-skeleton h-12 w-24 rounded-md" />
                </>
              ) : error || !stats ? (
                <span className="text-sm text-ink-3">词库统计暂不可用</span>
              ) : (
                <>
                  <motion.div variants={listItem}>
                    <StatBadge value={formatNum(stats.totalSongs)} label="歌曲" />
                  </motion.div>
                  <motion.div variants={listItem}>
                    <StatBadge value={formatNum(stats.totalArtists)} label="艺术家" />
                  </motion.div>
                  <motion.div variants={listItem}>
                    <StatBadge value={formatNum(stats.totalLines)} label="歌词行" />
                  </motion.div>
                  <motion.div variants={listItem}>
                    <StatBadge value={formatNum(stats.totalWords)} label="歌词字数" />
                  </motion.div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
