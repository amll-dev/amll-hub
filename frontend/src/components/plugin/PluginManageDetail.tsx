import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, ExternalLink, Package } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CommentSection } from '@/components/submission/CommentSection';
import { buildPluginActivityEntries } from '@/components/plugin/shared';
import { PluginManageActions } from './manage/PluginManageActions';
import { PluginManageHeader } from './manage/PluginManageHeader';
import { PluginManageIconUploader } from './manage/PluginManageIconUploader';
import { PluginManageInfoSection } from './manage/PluginManageInfoSection';
import { PluginManageSidebar } from './manage/PluginManageSidebar';
import { PluginManageUpdatePanel } from './manage/PluginManageUpdatePanel';
import { PluginManageVersionSection } from './manage/PluginManageVersionSection';

/** 插件投稿详情内容 */
export function PluginManageDetail({
  pluginKey,
  revision,
  reviewMode = false,
}: {
  pluginKey: string;
  revision: number;
  /** 审核中心入口 */
  reviewMode?: boolean;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canReview = Boolean(user?.isReviewer || user?.isAdmin);

  const detailQuery = useQuery({
    queryKey: queryKeys.myPluginDetail(pluginKey),
    queryFn: () => api.pluginStore.myPluginDetail(pluginKey),
    enabled: Boolean(pluginKey) && !reviewMode,
    staleTime: 15_000,
  });

  // 审核员不是插件发布者
  const reviewDetailQuery = useQuery({
    queryKey: ['plugins', 'review-plugin', pluginKey],
    queryFn: () => api.pluginStore.reviewPluginDetail(pluginKey),
    enabled: Boolean(pluginKey) && (reviewMode || (canReview && detailQuery.isError)),
    staleTime: 15_000,
  });

  const [showCover, setShowCover] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [tab, setTab] = useState<'info' | 'versions'>('info');

  const item = reviewMode
    ? reviewDetailQuery.data
    : (detailQuery.data ?? (canReview ? reviewDetailQuery.data : undefined));
  const plugin = item?.plugin;

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.myPluginDetail(pluginKey) });
    void queryClient.invalidateQueries({ queryKey: ['plugins', 'review-plugin', pluginKey] });
    void queryClient.invalidateQueries({ queryKey: ['plugins', 'review-queue'] });
    void queryClient.invalidateQueries({ queryKey: ['plugins', 'mine-plugins'] });
    void queryClient.invalidateQueries({ queryKey: ['plugins', 'mine'] });
    void queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.pluginDetail(pluginKey) });
  };

  // 切换插件时收起上一次的编辑/更新面板
  useEffect(() => {
    setShowCover(false);
    setShowSubmit(false);
    setTab('info');
  }, [pluginKey]);

  // WebSocket 收到 plugin_changed 后同步详情、审核状态与评论
  useEffect(() => {
    if (revision > 0) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myPluginDetail(pluginKey) });
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'review-plugin', pluginKey] });
      void queryClient.invalidateQueries({ queryKey: ['plugin', pluginKey, 'comments'] });
    }
  }, [revision, pluginKey, queryClient]);

  const activityEntries = useMemo(() => {
    if (!item) return [];
    const p = item.plugin;
    const isSelf = !p.ownerUsername || p.ownerUsername === user?.name;
    const ownerName = p.ownerUsername || p.author || user?.name || '';
    const submitterInfo = item.latestVersion?.submitterInfo;
    return buildPluginActivityEntries(item, {
      username: ownerName,
      displayName:
        submitterInfo?.displayName || (isSelf ? user?.displayName || ownerName : ownerName),
      avatar: submitterInfo?.avatar || (isSelf ? user?.avatar || '' : ''),
    });
  }, [item, user]);

  const ownsPlugin = Boolean(plugin && plugin.ownerUsername === user?.name);
  const isOwner = !reviewMode && (Boolean(detailQuery.data) || ownsPlugin);
  const reviewerVersion = (item?.versions ?? [])
    .filter((v) => v.reviewStatus === 'pending')
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0];

  if (!pluginKey) {
    return <EmptyState icon={Package} title="未选择插件" />;
  }

  const detailLoading = reviewMode
    ? reviewDetailQuery.isLoading
    : detailQuery.isLoading || (detailQuery.isError && canReview && reviewDetailQuery.isLoading);

  if (detailLoading) {
    return <div className="h-64 animate-pulse rounded-lg border border-line bg-card" />;
  }

  const detailFailed = reviewMode
    ? reviewDetailQuery.isError
    : !item || !plugin || (detailQuery.isError && (!canReview || reviewDetailQuery.isError));

  if (detailFailed) {
    return (
      <EmptyState
        icon={Package}
        title="插件不存在或无权查看"
        description={
          (reviewMode ? reviewDetailQuery.error : detailQuery.error) instanceof Error
            ? ((reviewMode ? reviewDetailQuery.error : detailQuery.error) as Error).message
            : undefined
        }
        action={
          <Button asChild variant="outline">
            <Link to={reviewMode ? '/review' : '/creator/plugins'}>
              <ArrowLeft className="h-4 w-4" />
              {reviewMode ? '返回审核中心' : '返回插件管理'}
            </Link>
          </Button>
        }
      />
    );
  }

  if (!item || !plugin) {
    return <EmptyState icon={Package} title="插件不存在或无权查看" />;
  }

  const latest = item.latestVersion;
  const isOffline = item.listedCount === 0;
  // 更新后新版本待审核时，之前的已通过版本仍保持上架
  const listedVersion = item.versions.find((v) => v.listingStatus === 'listed');
  const reviewedVersions = item.versions.filter((v) => v.reviewedAt);
  const submitterInfo = latest?.submitterInfo;
  const owner = plugin.ownerUsername || plugin.author || user?.displayName || '未知发布者';
  const isSelf = !plugin.ownerUsername || plugin.ownerUsername === user?.name;
  const ownerDisplay = submitterInfo?.displayName || (isSelf ? user?.displayName || owner : owner);
  const ownerAvatar = submitterInfo?.avatar || (isSelf ? user?.avatar : undefined);

  const actions = isOwner ? (
    <PluginManageActions
      pluginKey={pluginKey}
      isOffline={isOffline}
      onToggleIcon={() => setShowCover((v) => !v)}
      onToggleSubmit={() => setShowSubmit((v) => !v)}
      onChanged={invalidateAll}
    />
  ) : undefined;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-4 pb-24"
    >
      <PluginManageHeader
        plugin={plugin}
        latest={latest}
        iconUrl={item.iconUrl}
        ownerDisplay={ownerDisplay}
        ownerAvatar={ownerAvatar}
        isOwner={isOwner}
        actions={actions}
      />

      {/* 主体 + 侧边栏 */}
      <div className="flex gap-5">
        {/* 主体 */}
        <motion.div variants={fadeUp} className="min-w-0 flex-1 space-y-5">
          <PluginManageIconUploader
            open={showCover}
            pluginKey={pluginKey}
            pluginName={plugin.name}
            iconUrl={item.iconUrl}
            onClose={() => setShowCover(false)}
            onChanged={invalidateAll}
          />

          <PluginManageUpdatePanel
            open={showSubmit}
            plugin={plugin}
            onClose={() => setShowSubmit(false)}
            onChanged={invalidateAll}
          />

          {/* 标签页 */}
          <motion.div
            variants={fadeUp}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'info' | 'versions')}>
              <TabsList className="w-auto gap-1 border-none">
                <TabsTrigger
                  value="info"
                  className="rounded-md bg-surface-2 px-3 py-1.5 after:hidden data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  信息
                </TabsTrigger>
                <TabsTrigger
                  value="versions"
                  className="rounded-md bg-surface-2 px-3 py-1.5 after:hidden data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  版本
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {item.listedCount > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/plugins/${encodeURIComponent(plugin.pluginKey)}`}>
                  <ExternalLink className="h-4 w-4" />
                  公开页
                </Link>
              </Button>
            )}
          </motion.div>

          {tab === 'info' && (
            <PluginManageInfoSection plugin={plugin} isOwner={isOwner} onSaved={invalidateAll} />
          )}

          {tab === 'versions' && (
            <PluginManageVersionSection
              pluginKey={pluginKey}
              versions={item.versions}
              latestVersionId={item.latestVersion?.id}
              isOwner={isOwner}
              onChanged={invalidateAll}
            />
          )}

          {/* 审核员不能审核自己的插件 */}
          {reviewMode && ownsPlugin && (
            <div className="rounded-md border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
              不能审核自己发布的插件。
            </div>
          )}

          {/* 活动与评论 */}
          <CommentSection
            target={{ kind: 'plugin', key: pluginKey }}
            activityEntries={activityEntries}
            pluginReview={
              canReview && !ownsPlugin && reviewerVersion
                ? { versionId: reviewerVersion.id }
                : undefined
            }
            onReviewed={() => {
              invalidateAll();
            }}
          />
        </motion.div>

        <PluginManageSidebar
          plugin={plugin}
          latest={latest}
          listedVersion={listedVersion}
          ownerDisplay={ownerDisplay}
          ownerAvatar={ownerAvatar}
          reviewedVersions={reviewedVersions}
          isOwner={isOwner}
          actions={actions}
        />
      </div>
    </motion.div>
  );
}
