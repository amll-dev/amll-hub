import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Home } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { PageContainer } from '@/components/PageContainer';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/Skeleton';
import { ProfileInfoCard } from '@/components/user/ProfileInfoCard';
import { SubmissionDistributionCard } from '@/components/user/SubmissionDistributionCard';
import { UserHeader } from './UserHeader';
import { UserOverviewTab } from './UserOverviewTab';
import { UserSubmissionsTab } from './UserSubmissionsTab';
import { UserActivityTab } from './UserActivityTab';

type UserTab = 'overview' | 'submissions' | 'activity';

const TABS: { value: UserTab; label: string }[] = [
  { value: 'overview', label: '主页' },
  { value: 'submissions', label: '投稿' },
  { value: 'activity', label: '贡献墙' },
];

/** 公开用户主页 /user/:name */
export function UserProfilePage() {
  const { name = '' } = useParams<{ name: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [bannerFailed, setBannerFailed] = useState(false);

  const rawTab = searchParams.get('tab');
  const tab: UserTab = TABS.some((t) => t.value === rawTab) ? (rawTab as UserTab) : 'overview';

  const profileQuery = useQuery({
    queryKey: queryKeys.userProfile(name),
    queryFn: () => api.getUserProfile(name),
    enabled: name !== '',
    staleTime: 60_000,
    retry: false,
  });

  if (profileQuery.isPending) {
    return <UserProfileSkeleton />;
  }

  if (profileQuery.error) {
    return (
      <UserProfileError error={profileQuery.error} onRetry={() => void profileQuery.refetch()} />
    );
  }

  const profile = profileQuery.data;
  const showBanner = profile.bannerKey !== '' && !bannerFailed;

  return (
    <div className="pb-16">
      {/* Banner：从 sticky 顶栏下方开始（Header 在文档流里，无需额外上边距） */}
      <div className="relative aspect-[3/1] max-h-[320px] min-h-[140px] w-full overflow-hidden bg-surface-2">
        {showBanner ? (
          <img
            src={api.uploadFileUrl(profile.bannerKey)}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setBannerFailed(true)}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-primary-tint via-surface-2 to-primary-soft dark:from-primary/15 dark:via-surface-2 dark:to-background" />
        )}
        {/* 底部渐变过渡，保证头像叠层与文字在亮/暗主题下都有对比 */}
        <div className="absolute inset-0 bg-gradient-to-t from-background/85 via-background/15 to-transparent dark:from-background dark:via-background/50" />
      </div>

      <PageContainer width="lg" className="pb-16 pt-0">
        <UserHeader profile={profile} />

        <div className="mt-6 border-b border-line">
          <Tabs
            value={tab}
            onValueChange={(v) =>
              setSearchParams(v === 'overview' ? {} : { tab: v }, { replace: true })
            }
          >
            <TabsList className="h-auto w-full gap-6 border-b-0 bg-transparent p-0">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="px-0 pb-3 pt-2">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            {tab === 'overview' && <UserOverviewTab name={name} isSelf={profile.isSelf} />}
            {tab === 'submissions' && <UserSubmissionsTab name={name} isSelf={profile.isSelf} />}
            {tab === 'activity' && <UserActivityTab name={name} isSelf={profile.isSelf} />}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <ProfileInfoCard profile={profile} />
            <SubmissionDistributionCard profile={profile} />
          </aside>
        </div>
      </PageContainer>
    </div>
  );
}

/** 整页骨架：banner + 圆头像 + 两行标题 + 双栏 */
function UserProfileSkeleton() {
  return (
    <div className="pb-16">
      <Skeleton className="h-[180px] w-full rounded-none sm:h-[240px]" />
      <PageContainer width="lg" className="pb-16 pt-0">
        <div className="-mt-14 flex items-end gap-4 sm:-mt-16">
          <Skeleton className="h-24 w-24 shrink-0 rounded-full ring-4 ring-background sm:h-28 sm:w-28" />
          <div className="pb-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="mt-2 h-4 w-24" />
          </div>
        </div>
        <Skeleton className="mt-4 h-4 w-full max-w-xl" />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-48 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        </div>
      </PageContainer>
    </div>
  );
}

/** 用户不存在 / 加载失败 */
function UserProfileError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const notFound = error instanceof ApiError && error.code === 404;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-6xl font-bold tracking-tight text-primary">{notFound ? '404' : '!'}</p>
      <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
        {notFound ? '用户不存在' : '主页加载失败'}
      </h1>
      <p className="mt-3 text-sm text-ink-2">
        {notFound
          ? '该用户可能已注销，或用户名有误。'
          : error instanceof Error
            ? error.message
            : '请稍后重试。'}
      </p>
      <div className="mt-8 flex items-center gap-3">
        {!notFound && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-card px-6 text-sm font-semibold text-ink-2 transition-colors hover:border-primary hover:text-primary"
          >
            重试
          </button>
        )}
        <Link
          to="/"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Home className="h-4 w-4" />
          返回首页
        </Link>
      </div>
    </div>
  );
}
