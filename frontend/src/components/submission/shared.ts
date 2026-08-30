import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Check, Eye, FileText, Music, Pencil, Upload, X } from 'lucide-react';
import { escapeHtml } from '@/lib/markup';
import type { SubmissionDetail } from '@/lib/types';

// 状态
export const statusMeta: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-surface-2 text-ink-2' },
  pending: { label: '待审核', className: 'bg-amber-100 text-amber-700' },
  reviewing: { label: '审核中', className: 'bg-blue-100 text-blue-700' },
  need_revision: { label: '需修改', className: 'bg-orange-100 text-orange-700' },
  missing_audio: { label: '缺音频', className: 'bg-orange-100 text-orange-700' },
  approved: { label: '已通过', className: 'bg-green-100 text-green-700' },
  rejected: { label: '未通过', className: 'bg-red-100 text-red-700' },
  closed: { label: '已关闭', className: 'bg-surface-2 text-ink-3' },
};

// 语言代码
const langLabel: Record<string, string> = {
  zh: '汉语',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  others: '其他',
};

export function langText(code?: string): string {
  if (!code) return '—';
  return langLabel[code] ?? code;
}

/** 从投稿 metadata.platform_ids 提取各平台的全部 ID */
export function extractPlatformIds(metadata?: Record<string, unknown>): {
  ncm: string[];
  qq: string[];
  am: string[];
  spotify: string[];
} {
  const empty = { ncm: [], qq: [], am: [], spotify: [] };
  if (!metadata) return empty;
  const raw = metadata['platform_ids'];
  if (!raw || typeof raw !== 'object') return empty;
  const pids = raw as Record<string, unknown>;
  const pick = (key: string): string[] => {
    const v = pids[key];
    if (Array.isArray(v)) {
      return v.map((x) => String(x)).filter((s) => s.length > 0);
    }
    if (typeof v === 'string' && v) return [v];
    return [];
  };
  return {
    ncm: pick('ncm_music_id'),
    qq: pick('qq_music_id'),
    am: pick('apple_music_id'),
    spotify: pick('spotify_id'),
  };
}

/** 活动时间线条目类型 */
export interface ActivityEntry {
  id: string;
  timestamp: string;
  label: string;
  icon: typeof FileText;
  actor?: { displayName: string; username: string; avatar: string };
}

/** 从投稿详情构建活动时间线条目 */
export function buildActivityEntries(detail: SubmissionDetail): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  if (detail.createdAt) {
    entries.push({
      id: 'submit_lyric',
      timestamp: detail.createdAt,
      label: '提交了歌词',
      icon: FileText,
      actor: detail.submitterInfo
        ? {
            displayName: detail.submitterInfo.displayName,
            username: detail.submitter,
            avatar: detail.submitterInfo.avatar,
          }
        : undefined,
    });
  }
  // 从文件更新历史中提取每次“更新歌词”记录，支持多次更新时间线
  for (const h of detail.fileHistory ?? []) {
    entries.push({
      id: `update_lyric_${h.id}`,
      timestamp: h.uploadedAt,
      label: '更新了歌词',
      icon: Upload,
      actor: {
        displayName: h.uploaderInfo?.displayName || h.uploader,
        username: h.uploader,
        avatar: h.uploaderInfo?.avatar || '',
      },
    });
  }
  // 兼容：若无文件历史记录但 fileUpdatedAt 存在，仍显示一条
  if (
    (detail.fileHistory ?? []).length === 0 &&
    detail.fileUpdatedAt &&
    detail.fileUpdatedAt !== detail.createdAt
  ) {
    entries.push({
      id: 'update_lyric',
      timestamp: detail.fileUpdatedAt,
      label: '更新了歌词',
      icon: Upload,
      actor: detail.submitterInfo
        ? {
            displayName: detail.submitterInfo.displayName,
            username: detail.submitter,
            avatar: detail.submitterInfo.avatar,
          }
        : undefined,
    });
  }
  // 从音频列表提取每次“提交音频”记录
  const audioList = detail.audios ?? (detail.audio ? [detail.audio] : []);
  const audioActor = detail.submitterInfo
    ? {
        displayName: detail.submitterInfo.displayName,
        username: detail.submitter,
        avatar: detail.submitterInfo.avatar,
      }
    : undefined;
  for (const a of audioList) {
    if (a.uploadedAt) {
      entries.push({
        id: `submit_audio_${a.id || a.fileName}`,
        timestamp: a.uploadedAt,
        label: '提交了音频',
        icon: Music,
        actor: audioActor,
      });
    }
  }
  // 从审核历史中提取审核操作
  const reviews = (detail.reviewHistory ?? []).filter((h) => !['file_updated'].includes(h.status));
  for (const h of reviews) {
    const m = statusMeta[h.status];
    const actor = {
      displayName: h.reviewerInfo?.displayName || h.reviewer,
      username: h.reviewer,
      avatar: h.reviewerInfo?.avatar || '',
    };
    if (h.status === 'approved') {
      entries.push({
        id: `review_${h.id}`,
        timestamp: h.reviewedAt,
        label: '审核通过',
        icon: Check,
        actor,
      });
    } else if (h.status === 'rejected') {
      entries.push({
        id: `review_${h.id}`,
        timestamp: h.reviewedAt,
        label: '审核未通过',
        icon: X,
        actor,
      });
    } else if (h.status === 'need_revision') {
      entries.push({
        id: `review_${h.id}`,
        timestamp: h.reviewedAt,
        label: '要求修改',
        icon: Pencil,
        actor,
      });
    } else if (h.status === 'missing_audio') {
      entries.push({
        id: `review_${h.id}`,
        timestamp: h.reviewedAt,
        label: '要求补充音频',
        icon: Music,
        actor,
      });
    } else if (m) {
      entries.push({
        id: `review_${h.id}`,
        timestamp: h.reviewedAt,
        label: m.label,
        icon: Eye,
        actor,
      });
    }
  }
  return entries;
}

// 配置 marked
marked.setOptions({ breaks: true, gfm: true });

/**
 * 将 Markdown 文本渲染为 HTML。
 * escapeHtml 挡住原始 HTML 标签，但 [text](javascript:alert(1)) 这类链接协议
 * 不含可转义字符仍会穿透 marked，故末尾用 DOMPurify 兜底（默认拦截 javascript: 等危险协议）
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  try {
    return DOMPurify.sanitize(marked.parse(escapeHtml(text)) as string, {
      USE_PROFILES: { html: true },
    });
  } catch {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}
