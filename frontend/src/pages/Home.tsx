import { AnimatePresence, motion } from 'framer-motion';
import { Hero } from '@/components/Hero';
import { TodayRecommend } from '@/components/TodayRecommend';
import { LatestEntries } from '@/components/LatestEntries';
import { SubmitCta } from '@/components/SubmitCta';
import { PetitionList } from '@/components/PetitionList';
import { NotFoundRanking } from '@/components/NotFoundRanking';
import { SearchResults } from '@/components/SearchResults';
import { useSearchContext } from '@/hooks/useSearchContext';

/**
 * Hero 始终挂载（不再条件卸载），保证其内部 AnimatePresence 能正确处理
 * SearchBar 的 exit 动画，让 layoutId morph 稳定触发
 */
export function Home() {
  const { hasQuery } = useSearchContext();

  return (
    <>
      <Hero />

      <AnimatePresence mode="wait">
        {hasQuery ? (
          <motion.div
            key="search"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <SearchResults />
          </motion.div>
        ) : (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="mx-auto max-w-[1200px] px-6">
              <div className="grid gap-8 py-16 md:grid-cols-[380px_1fr]">
                <TodayRecommend />
                <LatestEntries />
              </div>

              <div className="py-16">
                <SubmitCta />
              </div>

              <div className="py-16">
                <PetitionList />
              </div>

              <div className="py-16">
                <NotFoundRanking />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
