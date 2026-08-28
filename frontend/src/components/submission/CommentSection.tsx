import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bold,
  Check,
  Code,
  Eye,
  Heading,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  MessageSquare,
  Music,
  Pencil,
  Quote,
  Send,
} from 'lucide-react';
import { api } from '@/lib/api';
import { buttonTap } from '@/lib/motion';
import { renderMarkdown, type ActivityEntry } from '@/components/submission/shared';
import { ActivityTimelineItem } from '@/components/submission/ActivityTimelineItem';
import { CommentItem } from '@/components/submission/CommentItem';
import type { ReviewAction, SubmissionComment } from '@/lib/types';

const reviewActions: { key: ReviewAction; label: string; color: string; icon: typeof Check }[] = [
  {
    key: 'approve',
    label: '通过',
    color: 'bg-green-600 hover:bg-green-700 text-white',
    icon: Check,
  },
  {
    key: 'revision',
    label: '需修改',
    color: 'bg-orange-500 hover:bg-orange-600 text-white',
    icon: Pencil,
  },
  {
    key: 'missing_audio',
    label: '缺音源',
    color: 'bg-orange-500 hover:bg-orange-600 text-white',
    icon: Music,
  },
];

/** Markdown 工具栏按钮配置 */
const MD_TOOLS: {
  icon: typeof Bold;
  title: string;
  action: (sel: string) => { text: string; cursorOffset: number };
}[] = [
  {
    icon: Heading,
    title: '标题',
    action: (s) => ({ text: `### ${s || '标题'}`, cursorOffset: 0 }),
  },
  { icon: Bold, title: '粗体', action: (s) => ({ text: `**${s || '粗体'}**`, cursorOffset: 0 }) },
  { icon: Italic, title: '斜体', action: (s) => ({ text: `*${s || '斜体'}*`, cursorOffset: 0 }) },
  { icon: Quote, title: '引用', action: (s) => ({ text: `> ${s || '引用'}`, cursorOffset: 0 }) },
  { icon: Code, title: '代码', action: (s) => ({ text: `\`${s || '代码'}\``, cursorOffset: 0 }) },
  {
    icon: Link2,
    title: '链接',
    action: (s) => ({ text: `[${s || '链接文字'}](url)`, cursorOffset: 0 }),
  },
  {
    icon: List,
    title: '无序列表',
    action: (s) => ({ text: `- ${s || '列表项'}`, cursorOffset: 0 }),
  },
  {
    icon: ListOrdered,
    title: '有序列表',
    action: (s) => ({ text: `1. ${s || '列表项'}`, cursorOffset: 0 }),
  },
  {
    icon: ImageIcon,
    title: '图片',
    action: (s) => ({ text: `![${s || '图片描述'}](url)`, cursorOffset: 0 }),
  },
];

/** 合并后的时间线条目 */
type TimelineEntry =
  { kind: 'comment'; comment: SubmissionComment } | { kind: 'activity'; activity: ActivityEntry };

export interface CommentSectionProps {
  submissionId: number;
  initialComments: SubmissionComment[];
  isReviewer: boolean;
  activityEntries: ActivityEntry[];
  canReview: boolean;
  onReviewed: () => void;
}

/** 评论系统 */
export function CommentSection({
  submissionId,
  initialComments,
  isReviewer,
  activityEntries,
  canReview,
  onReviewed,
}: CommentSectionProps) {
  const [comments, setComments] = useState(initialComments);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewMsg, setReviewMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const previewHtml = useMemo(() => renderMarkdown(text), [text]);

  // 合并活动事件与评论，按时间升序排列
  const timeline: TimelineEntry[] = useMemo(() => {
    const entries: TimelineEntry[] = [
      ...activityEntries.map((a) => ({ kind: 'activity' as const, activity: a })),
      ...comments.map((c) => ({ kind: 'comment' as const, comment: c })),
    ];
    return entries.sort((a, b) => {
      const ta = a.kind === 'comment' ? a.comment.createdAt : a.activity.timestamp;
      const tb = b.kind === 'comment' ? b.comment.createdAt : b.activity.timestamp;
      return new Date(ta).getTime() - new Date(tb).getTime();
    });
  }, [activityEntries, comments]);

  // 审核快捷模板
  const templates: { label: string; value: string }[] | null = isReviewer
    ? [
        {
          label: '通过模板',
          value:
            '恭喜你，人工审核通过，你的贡献将会被更多人看到。感谢你对本项目的支持。欢迎下次投稿！',
        },
        {
          label: '需修改模板',
          value:
            '感谢你的慷慨贡献，但是很遗憾，本次人工审核你没有成功通过。建议参考以下修改意见进行修改，然后进行更新，我们期待并欢迎你的更新！以下是修改意见： ',
        },
      ]
    : null;

  const refreshComments = async () => {
    const list = await api.listSubmissionComments(submissionId);
    setComments(list ?? []);
  };

  const post = async () => {
    const content = text.trim();
    if (!content) return;
    setPosting(true);
    try {
      await api.addSubmissionComment(submissionId, content);
      setText('');
      setMode('write');
      await refreshComments();
    } catch {
      // 静默
    } finally {
      setPosting(false);
    }
  };

  /** 审核 */
  const doReview = async (actionKey: ReviewAction) => {
    const content = text.trim();
    // 需修改必须输入理由
    if (actionKey === 'revision' && !content) {
      setReviewMsg({ type: 'error', text: '选择「需修改」时必须输入理由' });
      return;
    }
    setReviewing(true);
    setReviewMsg(null);
    try {
      // 如果有评论内容，先发评论
      if (content) {
        await api.addSubmissionComment(submissionId, content);
        setText('');
        setMode('write');
        await refreshComments();
      }
      // 执行审核
      await api.reviewSubmission(submissionId, actionKey, content);
      setReviewMsg({ type: 'success', text: '审核完成' });
      onReviewed();
    } catch (err) {
      setReviewMsg({ type: 'error', text: err instanceof Error ? err.message : '审核失败' });
    } finally {
      setReviewing(false);
    }
  };

  /** 在光标处插入 Markdown 标记 */
  const insertMd = (action: (sel: string) => { text: string; cursorOffset: number }) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = text.substring(start, end);
    const { text: insertText } = action(selected);
    const newText = text.substring(0, start) + insertText + text.substring(end);
    setText(newText);
    requestAnimationFrame(() => {
      ta.focus();
      const cursorPos = start + insertText.length;
      ta.setSelectionRange(cursorPos, cursorPos);
    });
  };

  return (
    <div className="rounded-lg border border-line bg-card p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
        <MessageSquare className="h-4 w-4 text-primary" />
        活动与评论 ({timeline.length})
      </h3>

      {/* 活动与评论合并时间线 */}
      <ul className="mb-4">
        {timeline.length === 0 ? (
          <li className="py-4 text-center text-sm text-ink-3">暂无活动记录</li>
        ) : (
          timeline.map((entry, i) =>
            entry.kind === 'comment' ? (
              <CommentItem
                key={`c-${entry.comment.id}`}
                c={entry.comment}
                isLast={i === timeline.length - 1}
              />
            ) : (
              <ActivityTimelineItem
                key={`a-${entry.activity.id}`}
                entry={entry.activity}
                isLast={i === timeline.length - 1}
              />
            )
          )
        )}
      </ul>

      {/* 快捷模板 */}
      {templates && (
        <div className="mb-2 flex flex-wrap gap-2">
          {templates.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => {
                setText(t.value);
                setMode('write');
              }}
              className="rounded bg-surface-2 px-2 py-1 text-xs text-ink-2 hover:text-foreground"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* 编写/预览切换 + Markdown 工具栏 */}
      <div className="rounded-md border border-input bg-surface-2">
        {/* 标签栏 */}
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('write')}
              className={`flex items-center gap-1 px-2 py-0.5 text-sm transition-colors ${
                mode === 'write'
                  ? 'border-b-2 border-primary font-medium text-foreground'
                  : 'text-ink-3 hover:text-foreground'
              }`}
            >
              <Pencil className="h-3.5 w-3.5" />
              编写
            </button>
            <button
              type="button"
              onClick={() => setMode('preview')}
              className={`flex items-center gap-1 px-2 py-0.5 text-sm transition-colors ${
                mode === 'preview'
                  ? 'border-b-2 border-primary font-medium text-foreground'
                  : 'text-ink-3 hover:text-foreground'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              预览
            </button>
          </div>
          {/* Markdown 工具栏 */}
          {mode === 'write' && (
            <div className="flex items-center gap-1">
              {MD_TOOLS.map((tool) => (
                <button
                  key={tool.title}
                  type="button"
                  title={tool.title}
                  onClick={() => insertMd(tool.action)}
                  className="rounded p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <tool.icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 编写区 */}
        {mode === 'write' ? (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="在此添加您的评论...（支持 Markdown 格式）"
            className="w-full resize-y border-none bg-transparent px-4 py-3 text-sm outline-none"
          />
        ) : (
          <div
            className="comment-markdown min-h-[100px] px-4 py-3 text-sm leading-relaxed text-foreground"
            dangerouslySetInnerHTML={{
              __html: previewHtml || "<p class='text-ink-3'>没有内容可预览</p>",
            }}
          />
        )}
      </div>

      {/* 操作按钮 */}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {canReview &&
          reviewActions.map((a) => {
            const Icon = a.icon;
            return (
              <motion.button
                key={a.key}
                type="button"
                onClick={() => doReview(a.key)}
                disabled={reviewing || posting}
                {...buttonTap}
                className={`inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-50 ${a.color}`}
              >
                {reviewing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                {a.label}
              </motion.button>
            );
          })}
        <motion.button
          type="button"
          onClick={post}
          disabled={posting || reviewing || !text.trim()}
          {...buttonTap}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          评论
        </motion.button>
      </div>

      {/* 审核消息提示 */}
      {reviewMsg && (
        <div
          className={`mt-2 rounded-md px-4 py-2 text-sm ${
            reviewMsg.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
          }`}
        >
          {reviewMsg.text}
        </div>
      )}
    </div>
  );
}
