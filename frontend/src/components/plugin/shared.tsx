import { Check, FileText, Upload, X } from 'lucide-react';
import type { ActivityEntry } from '@/components/submission/shared';
import type {
  PluginChannel,
  PluginListingStatus,
  PluginManagementItem,
  PluginManagementVersion,
  PluginReviewStatus,
  PluginStatus,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const channelLabels: Record<PluginChannel, string> = {
  'trusted-js': '功能插件',
  theme: '主题包',
};

export function channelLabel(channel: PluginChannel): string {
  return channelLabels[channel] ?? channel;
}

export function PluginChannelBadge({ channel }: { channel: PluginChannel }) {
  return (
    <Badge variant={channel === 'theme' ? 'secondary' : 'outline'}>{channelLabel(channel)}</Badge>
  );
}

const reviewLabels: Record<PluginReviewStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '未通过',
};

export function reviewLabel(status: PluginReviewStatus): string {
  return reviewLabels[status] ?? status;
}

const reviewClasses: Record<PluginReviewStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export function PluginReviewBadge({ status }: { status: PluginReviewStatus }) {
  // 状态胶囊配色对齐歌词投稿的状态展示
  return (
    <Badge variant="secondary" className={reviewClasses[status]}>
      {reviewLabel(status)}
    </Badge>
  );
}

const listingLabels: Record<PluginListingStatus, string> = {
  unlisted: '未上架',
  listed: '已上架',
  yanked: '已 yank',
};

export function listingLabel(status: PluginListingStatus): string {
  return listingLabels[status] ?? status;
}

export function PluginListingBadge({ status }: { status: PluginListingStatus }) {
  const variant =
    status === 'listed' ? 'success' : status === 'yanked' ? 'destructive' : 'secondary';
  return <Badge variant={variant}>{listingLabel(status)}</Badge>;
}

const statusLabels: Record<PluginStatus, string> = {
  active: '正常',
  hidden: '隐藏',
  blocked: '封禁',
};

export function pluginStatusLabel(status: PluginStatus): string {
  return statusLabels[status] ?? status;
}

export function PluginStatusBadge({ status }: { status: PluginStatus }) {
  const variant =
    status === 'active' ? 'success' : status === 'blocked' ? 'destructive' : 'warning';
  return <Badge variant={variant}>{pluginStatusLabel(status)}</Badge>;
}

/** 插件图标：没有图标时用首字母占位 */
export function PluginIcon({
  name,
  iconUrl,
  className,
}: {
  name: string;
  iconUrl?: string;
  className?: string;
}) {
  const initial = (name || '?').charAt(0).toUpperCase();
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={name}
        className={cn('shrink-0 rounded-lg border border-line bg-card object-cover', className)}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-lg font-bold text-primary',
        className
      )}
    >
      {initial}
    </div>
  );
}

/** 从插件管理项构建活动时间线 */
export function buildPluginActivityEntries(
  item: PluginManagementItem,
  fallbackActor?: { username: string; displayName: string; avatar: string }
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const owner = item.plugin.ownerUsername || item.plugin.author;
  const baseActor =
    fallbackActor ?? (owner ? { displayName: owner, username: owner, avatar: '' } : undefined);

  const submitterActor = (v: PluginManagementVersion) => {
    const info = v.submitterInfo;
    if (info && (info.username || info.displayName)) {
      return {
        username: info.username,
        displayName: info.displayName || info.username,
        avatar: info.avatar || '',
      };
    }
    return baseActor;
  };

  const reviewerActor = (v: PluginManagementVersion) => {
    const info = v.reviewerInfo;
    if (info && (info.username || info.displayName)) {
      return {
        username: info.username,
        displayName: info.displayName || info.username,
        avatar: info.avatar || '',
      };
    }
    if (v.reviewer) {
      return { username: v.reviewer, displayName: v.reviewer, avatar: '' };
    }
    return undefined;
  };

  if (item.plugin.createdAt) {
    entries.push({
      id: 'plugin_created',
      timestamp: item.plugin.createdAt,
      label: '创建了插件',
      icon: FileText,
      actor: baseActor,
    });
  }
  for (const v of item.versions) {
    if (!v.submittedAt) continue;
    entries.push({
      id: `plugin_version_${v.id}`,
      timestamp: v.submittedAt,
      label: `提交了 v${v.version}`,
      icon: Upload,
      actor: submitterActor(v),
    });
    if (v.reviewedAt) {
      const approved = v.reviewStatus === 'approved';
      entries.push({
        id: `plugin_review_${v.id}`,
        timestamp: v.reviewedAt,
        label: approved ? `通过了 v${v.version}` : `拒绝了 v${v.version}`,
        icon: approved ? Check : X,
        actor: reviewerActor(v),
      });
    }
  }
  return entries;
}
