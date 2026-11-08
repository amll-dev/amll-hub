import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileArchive,
  Github,
  HardDrive,
  KeyRound,
  Layers,
  Package,
  Share2,
  ShieldCheck,
  Tag,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { formatBytes, formatCount, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PluginDetailResult } from '@/lib/types';
import { PageContainer } from '@/components/PageContainer';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PluginChannelBadge, PluginIcon, channelLabel } from '@/components/plugin/shared';
import { renderMarkdown } from '@/components/submission/shared';
import { PluginRatingPanel, RatingStars } from '@/components/plugin/PluginRating';
import { PluginRowCard } from '@/components/plugin/PluginCard';

/** 其他信息里的一行图标 + 标签 + 值 */
function InfoItem({
  icon: Icon,
  label,
  value,
  mono = false,
  wide = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 items-start gap-2.5', wide && 'sm:col-span-2')}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-ink-3">{label}</p>
        <p
          className={cn(
            'mt-0.5 text-sm text-ink',
            mono ? 'font-mono text-[11px] break-all text-ink-2' : 'truncate'
          )}
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

export function PluginDetail() {
  const { key = '' } = useParams();
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: queryKeys.pluginDetail(key),
    queryFn: () => api.pluginStore.detail(key),
    enabled: key.length > 0,
    staleTime: 30_000,
  });
  const discoverQuery = useQuery({
    queryKey: queryKeys.pluginList({
      page: 1,
      pageSize: 6,
      q: '',
      channel: '',
      sort: 'downloads',
    }),
    queryFn: () => api.pluginStore.list({ page: 1, pageSize: 6, sort: 'downloads' }),
    staleTime: 60_000,
  });

  if (detailQuery.isLoading) {
    return (
      <PageContainer width="md" className="py-8 sm:py-10">
        <div className="h-40 animate-pulse rounded-2xl border border-line bg-card" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-80 animate-pulse rounded-2xl border border-line bg-card" />
          <div className="h-72 animate-pulse rounded-2xl border border-line bg-card" />
        </div>
      </PageContainer>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <PageContainer width="md" className="py-8 sm:py-10">
        <EmptyState
          icon={Package}
          title="插件不存在或未上架"
          description={detailQuery.error instanceof Error ? detailQuery.error.message : undefined}
          action={
            <Button asChild variant="outline">
              <Link to="/plugins">
                <ArrowLeft className="h-4 w-4" />
                返回插件广场
              </Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const { plugin, version, versions, iconUrl, rating, myScore, totalDownloads } = detailQuery.data;
  const readmeHtml = renderMarkdown(version.readmeMd || plugin.descriptionMd);
  const changelogHtml = renderMarkdown(version.changelogMd);
  const categoryText =
    plugin.tags.length > 0 ? plugin.tags.join(' ') : channelLabel(version.channel);

  const discoverItems = (discoverQuery.data?.items ?? [])
    .filter((item) => item.plugin.pluginKey !== plugin.pluginKey)
    .slice(0, 3);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('链接已复制');
    } catch {
      toast.error('复制失败，请手动复制地址');
    }
  };

  // 点击下载后先本地 +1；带时间戳发起请求避免命中旧缓存，稍后再与服务端对齐
  const handleDownload = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const link = document.createElement('a');
    link.href = `/api/v1/store/artifacts/${version.sha256}.zip?t=${Date.now()}`;
    link.download = `${plugin.pluginKey}-${version.version}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    queryClient.setQueryData<PluginDetailResult>(queryKeys.pluginDetail(key), (old) =>
      old
        ? {
            ...old,
            version: { ...old.version, downloadCount: old.version.downloadCount + 1 },
            totalDownloads: old.totalDownloads + 1,
          }
        : old
    );
    window.setTimeout(() => {
      void api.pluginStore
        .detail(key)
        .then((fresh) => {
          queryClient.setQueryData<PluginDetailResult>(queryKeys.pluginDetail(key), (old) => {
            if (!old) return fresh;
            const sameVersion = old.version.version === fresh.version.version;
            return {
              ...fresh,
              totalDownloads: Math.max(fresh.totalDownloads, old.totalDownloads),
              version: {
                ...fresh.version,
                downloadCount: sameVersion
                  ? Math.max(fresh.version.downloadCount, old.version.downloadCount)
                  : fresh.version.downloadCount,
              },
            };
          });
        })
        .catch(() => {});
    }, 2000);
  };

  return (
    <PageContainer width="md" className="py-8 sm:py-10">
      <div className="mb-4">
        <Link
          to="/plugins"
          className="inline-flex items-center gap-1 text-xs text-ink-3 transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回插件广场
        </Link>
      </div>

      {/* 详情头部 */}
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <PluginIcon
          name={plugin.name}
          iconUrl={iconUrl}
          className="h-20 w-20 rounded-[20px] text-3xl sm:h-24 sm:w-24"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {plugin.name}
            </h1>
            <PluginChannelBadge channel={version.channel} />
          </div>

          <p className="mt-1 text-sm text-ink-2">
            {plugin.author || plugin.ownerUsername}
            <span className="mx-1.5 text-ink-3">·</span>
            <span className="text-ink-3">v{version.version}</span>
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <RatingStars score={rating.score} size={13} />
            <span className="font-medium text-ink-2">
              {rating.count > 0 ? rating.score.toFixed(1) : '暂无评分'}
            </span>
            {rating.count > 0 && <span>{rating.count} 个评分</span>}
            <span className="h-3 w-px bg-line" aria-hidden />
            <span className="min-w-0 truncate">{categoryText}</span>
            <span className="h-3 w-px bg-line" aria-hidden />
            <span className="inline-flex items-center gap-1">
              <Download className="h-3 w-3" />
              {formatCount(totalDownloads)}
            </span>
          </div>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-2">
            {plugin.summary || '当前插件未提供简介。'}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button asChild size="sm" className="rounded-full px-4">
              <a
                href={`/api/v1/store/artifacts/${version.sha256}.zip`}
                download={`${plugin.pluginKey}-${version.version}.zip`}
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
                下载 v{version.version}
              </a>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              aria-label="复制分享链接"
              title="复制分享链接"
              onClick={copyLink}
            >
              <Share2 className="h-4 w-4" />
            </Button>
            {plugin.homepage && (
              <Button variant="outline" size="icon" className="rounded-full" asChild>
                <a
                  href={plugin.homepage}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="项目主页"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
            {plugin.repoUrl && (
              <Button variant="outline" size="icon" className="rounded-full" asChild>
                <a href={plugin.repoUrl} target="_blank" rel="noreferrer noopener" title="代码仓库">
                  <Github className="h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-line bg-card p-6 sm:p-7">
            <h2 className="text-sm font-semibold text-foreground">说明</h2>
            {readmeHtml ? (
              <div
                className="prose prose-sm mt-4 max-w-none text-ink-2 dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: readmeHtml }}
              />
            ) : (
              <div className="py-8">
                <h3 className="text-2xl font-bold tracking-tight text-foreground">暂无说明</h3>
                <p className="mt-2 text-sm text-ink-3">当前插件未提供 README 内容。</p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-card p-6 sm:p-7">
            <h2 className="text-sm font-semibold text-foreground">其他信息</h2>
            <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <InfoItem icon={KeyRound} label="插件 ID" value={plugin.pluginKey} mono />
              <InfoItem icon={Tag} label="版本" value={`v${version.version}`} />
              <InfoItem icon={Layers} label="类型" value={channelLabel(version.channel)} />
              <InfoItem
                icon={UserRound}
                label="作者"
                value={plugin.author || plugin.ownerUsername || '暂无数据'}
              />
              <InfoItem
                icon={Clock3}
                label="最近更新"
                value={version.listedAt ? formatDateTime(version.listedAt) : '暂无数据'}
              />
              <InfoItem icon={HardDrive} label="包大小" value={formatBytes(version.sizeBytes)} />
              <InfoItem icon={Download} label="下载" value={`${formatCount(totalDownloads)} 次`} />
              {plugin.license && (
                <InfoItem icon={FileArchive} label="许可证" value={plugin.license} />
              )}
              <InfoItem icon={ShieldCheck} label="SHA-256" value={version.sha256} mono wide />
            </div>
          </section>

          {changelogHtml && (
            <section className="rounded-2xl border border-line bg-card p-6 sm:p-7">
              <h2 className="text-sm font-semibold text-foreground">更新日志</h2>
              <div
                className="prose prose-sm mt-4 max-w-none text-ink-2 dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: changelogHtml }}
              />
            </section>
          )}

          <section className="rounded-2xl border border-line bg-card p-6 sm:p-7">
            <h2 className="text-sm font-semibold text-foreground">版本记录</h2>
            <div className="mt-4 space-y-2">
              {versions.map((item) => (
                <div
                  key={item.version}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2/60 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-ink">v{item.version}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-ink-3">
                    {item.listedAt && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDateTime(item.listedAt)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>

        <aside className="space-y-5">
          <PluginRatingPanel
            pluginKey={plugin.pluginKey}
            pluginName={plugin.name}
            rating={rating}
            myScore={myScore}
          />

          {discoverItems.length > 0 && (
            <section className="rounded-2xl border border-line bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">发现更多</h2>
                <Link
                  to="/plugins"
                  aria-label="浏览全部插件"
                  className="rounded-full p-0.5 text-ink-3 transition-colors hover:text-primary"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-2">
                {discoverItems.map((item) => (
                  <PluginRowCard key={item.plugin.pluginKey} item={item} />
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </PageContainer>
  );
}
