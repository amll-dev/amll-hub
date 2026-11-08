import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { formatDateTime } from '@/lib/format';
import { fadeUp } from '@/lib/motion';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { PluginChannelBadge, PluginIcon, PluginReviewBadge } from '@/components/plugin/shared';
import type { Plugin, PluginManagementVersion } from '@/lib/types';

/** 插件管理/审核详情标题区 */
export function PluginManageHeader({
  plugin,
  latest,
  iconUrl,
  ownerDisplay,
  ownerAvatar,
  isOwner,
  actions,
}: {
  plugin: Plugin;
  latest?: PluginManagementVersion;
  iconUrl?: string;
  ownerDisplay: string;
  ownerAvatar?: string;
  isOwner: boolean;
  actions?: ReactNode;
}) {
  return (
    <motion.div variants={fadeUp} className="rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <PluginIcon name={plugin.name} iconUrl={iconUrl} className="h-16 w-16" />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-foreground">
              <span className="min-w-0">{plugin.name}</span>
              {latest ? (
                <PluginReviewBadge status={latest.reviewStatus} />
              ) : (
                <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-3">
                  暂无版本
                </span>
              )}
              {latest && <PluginChannelBadge channel={latest.channel} />}
              <span className="text-base font-normal text-ink-3">#{plugin.pluginKey}</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-3">
              <UserAvatar avatar={ownerAvatar} name={ownerDisplay} size={20} />
              <strong className="text-ink-2">{ownerDisplay}</strong>
              <span>于 {formatDateTime(plugin.createdAt)} 创建</span>
              <span>· 更新于 {formatDateTime(plugin.updatedAt)}</span>
            </div>
            <p className="mt-2 text-sm text-ink-2">{plugin.summary || '暂无简介'}</p>
          </div>
        </div>
        {isOwner && actions && (
          <div className="flex shrink-0 flex-wrap gap-2 lg:hidden">{actions}</div>
        )}
      </div>
    </motion.div>
  );
}
