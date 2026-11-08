import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { formatDateTime } from '@/lib/format';
import { fadeUp } from '@/lib/motion';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { PluginChannelBadge, PluginReviewBadge } from '@/components/plugin/shared';
import type { Plugin, PluginManagementVersion } from '@/lib/types';

/** 插件详情侧边栏 */
export function PluginManageSidebar({
  plugin,
  latest,
  listedVersion,
  ownerDisplay,
  ownerAvatar,
  reviewedVersions,
  isOwner,
  actions,
}: {
  plugin: Plugin;
  latest?: PluginManagementVersion;
  listedVersion?: PluginManagementVersion;
  ownerDisplay: string;
  ownerAvatar?: string;
  reviewedVersions: PluginManagementVersion[];
  isOwner: boolean;
  actions?: ReactNode;
}) {
  return (
    <motion.div variants={fadeUp} className="hidden w-72 shrink-0 space-y-4 lg:block">
      {/* 操作按钮 */}
      {isOwner && actions && <div className="flex flex-wrap gap-2">{actions}</div>}

      <div className="rounded-lg border border-line bg-card p-5">
        <h3 className="mb-3 text-sm font-semibold text-foreground">投稿信息</h3>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <UserAvatar avatar={ownerAvatar} name={ownerDisplay} size={32} />
            <div className="min-w-0">
              <div className="font-medium text-foreground">{ownerDisplay}</div>
              <div className="text-xs text-ink-3">发布者</div>
            </div>
          </div>
          <div className="border-t border-line pt-2">
            <div className="text-xs text-ink-3">创建时间</div>
            <div className="text-foreground">{formatDateTime(plugin.createdAt)}</div>
          </div>
          <div>
            <div className="text-xs text-ink-3">最近更新</div>
            <div className="text-foreground">{formatDateTime(plugin.updatedAt)}</div>
          </div>
          {listedVersion && latest && listedVersion.id !== latest.id && (
            <div>
              <div className="text-xs text-ink-3">当前上架版本</div>
              <div className="text-foreground">v{listedVersion.version}</div>
            </div>
          )}
          {latest && (
            <>
              <div>
                <div className="text-xs text-ink-3">最新版本</div>
                <div className="flex flex-wrap items-center gap-1.5 text-foreground">
                  <span className="font-mono">v{latest.version}</span>
                  <PluginChannelBadge channel={latest.channel} />
                </div>
              </div>
              <div>
                <div className="text-xs text-ink-3">当前状态</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <PluginReviewBadge status={latest.reviewStatus} />
                </div>
              </div>
            </>
          )}
          {plugin.tags.length > 0 && (
            <div>
              <div className="text-xs text-ink-3">标签</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {plugin.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-xs text-primary"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {reviewedVersions.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <h4 className="mb-2 text-xs font-semibold text-ink-2">审核记录</h4>
            <ul className="space-y-3">
              {reviewedVersions
                .slice()
                .reverse()
                .map((v) => (
                  <li key={v.id} className="text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <UserAvatar
                        avatar={v.reviewerInfo?.avatar}
                        name={v.reviewerInfo?.displayName || v.reviewer || '审核员'}
                        size={16}
                      />
                      <span className="font-medium text-ink-2">
                        {v.reviewerInfo?.displayName || v.reviewer || '审核员'}
                      </span>
                      <PluginReviewBadge status={v.reviewStatus} />
                      <span className="ml-auto shrink-0 text-ink-3">
                        {formatDateTime(v.reviewedAt as string)}
                      </span>
                    </div>
                    <div className="mt-1 pl-[22px] font-mono text-ink-3">v{v.version}</div>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </motion.div>
  );
}
