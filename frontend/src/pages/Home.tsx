import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Hero } from '@/components/Hero';
import { TodayRecommend } from '@/components/TodayRecommend';
import { LatestEntries } from '@/components/LatestEntries';
import { SubmitCta } from '@/components/SubmitCta';
import { PetitionList } from '@/components/PetitionList';
import { NotFoundRanking } from '@/components/NotFoundRanking';
import { SearchResults } from '@/components/SearchResults';
import { PageContainer } from '@/components/PageContainer';
import { useSearchContext } from '@/hooks/useSearchContext';
import { useActiveRecruitment } from '@/hooks/useRecruitment';

/**
 * Hero 始终挂载（不再条件卸载），保证其内部 AnimatePresence 能正确处理
 * SearchBar 的 exit 动画，让 layoutId morph 稳定触发
 */
export function Home() {
  const { hasQuery } = useSearchContext();
  const recruitment = useActiveRecruitment({ refetchInterval: 30_000 });

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
            <PageContainer className="py-0">
              {recruitment.data?.active && (
                <Link
                  to="/creator?tab=lyrics"
                  className="block rounded-lg border border-primary/30 bg-primary-soft p-5 text-primary transition-colors hover:bg-primary/10"
                >
                  <span className="block font-semibold">审核招募进行中</span>
                  <span className="mt-1 block text-sm">参与歌词投稿，加入审核招募计划 →</span>
                </Link>
              )}
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
            </PageContainer>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
