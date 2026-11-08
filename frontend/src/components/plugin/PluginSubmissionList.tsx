import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ChevronRight, Package } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { formatCount } from '@/lib/format';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListPagination } from '@/components/ui/list-pagination';
import { PluginChannelBadge, PluginIcon, PluginReviewBadge } from '@/components/plugin/shared';

const PLUGIN_PAGE_SIZE = 10;

/** 创作中心内的插件管理 */
export function PluginSubmissionList({ onManage }: { onManage: (pluginKey: string) => void }) {
  const [pluginPage, setPluginPage] = useState(1);
  const pluginsQuery = useQuery({
    queryKey: queryKeys.myPlugins({ page: pluginPage, pageSize: PLUGIN_PAGE_SIZE }),
    queryFn: () => api.pluginStore.myPlugins({ page: pluginPage, pageSize: PLUGIN_PAGE_SIZE }),
    staleTime: 15_000,
  });

  const plugins = pluginsQuery.data?.items ?? [];
  const pluginTotal = pluginsQuery.data?.total ?? 0;
  const pluginPages = Math.max(1, Math.ceil(pluginTotal / PLUGIN_PAGE_SIZE));
  const errorMsg =
    pluginsQuery.error instanceof Error
      ? pluginsQuery.error.message
      : pluginsQuery.error
        ? '加载失败'
        : '';

  // 插件减少后当前页可能越界，自动收回
  useEffect(() => {
    if (pluginPage > pluginPages) setPluginPage(pluginPages);
  }, [pluginPage, pluginPages]);

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={fadeUp}>
        <h2 className="text-xl font-bold tracking-tight text-foreground">我的插件</h2>
      </motion.div>

      {errorMsg ? (
        <div className="rounded-md border border-line bg-surface-2 px-4 py-3 text-sm text-error">
          {errorMsg}
        </div>
      ) : pluginsQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg border border-line bg-card" />
          ))}
        </div>
      ) : plugins.length === 0 ? (
        <EmptyState
          icon={Package}
          title="还没有发布插件"
          description="投稿通过审核后，这里会出现你的插件，可继续维护资料和版本"
        />
      ) : (
        <>
          <p className="text-xs text-ink-3">共 {pluginTotal} 个插件</p>
          <div className="space-y-3">
            {plugins.map((item) => {
              const p = item.plugin;
              const latest = item.latestVersion;
              return (
                <motion.div key={p.pluginKey} variants={fadeUp}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onManage(p.pluginKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onManage(p.pluginKey);
                      }
                    }}
                    className="cursor-pointer rounded-lg border border-line bg-card p-5 transition-colors hover:border-primary/50"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <PluginIcon name={p.name} iconUrl={item.iconUrl} className="h-12 w-12" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-foreground">{p.name}</span>
                            {latest && <PluginReviewBadge status={latest.reviewStatus} />}
                            {latest && <PluginChannelBadge channel={latest.channel} />}
                          </div>
                          <p className="mt-1 text-xs text-ink-3">{p.pluginKey}</p>
                          <p className="mt-1 text-sm text-ink-2">{p.summary || '暂无简介'}</p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
                            <span>{item.versions.length} 个版本</span>
                            <span>{item.listedCount} 个已上架</span>
                            <span>{item.pendingCount} 个待审核</span>
                            <span>{formatCount(item.totalDownloads)} 次下载</span>
                            {latest && <span>最新 v{latest.version}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <ChevronRight className="h-4 w-4 text-ink-3" />
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <ListPagination page={pluginPage} totalPages={pluginPages} onPageChange={setPluginPage} />
        </>
      )}
    </motion.div>
  );
}
