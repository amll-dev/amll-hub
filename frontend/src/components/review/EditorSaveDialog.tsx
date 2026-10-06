import { useMemo } from 'react';
import { useAtom } from 'jotai';
import { marked } from 'marked';
import { Download, Loader2, MessageSquare } from 'lucide-react';
import {
  renderReviewReport,
  hasReviewReportContent,
} from '@/editor/modules/review/services/report-service/render-service';
import type { ReviewReport } from '@/editor/modules/review/services/report-service/types';
import type { ReviewAction } from '@/lib/types';
import {
  reviewActionAtom,
  reviewManualNoteAtom,
  reviewUploadTtmlAtom,
} from '@/editor/modules/review/states';
import { downloadText } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface EditorSaveDialogProps {
  open: boolean;
  /** tool 的 buildEditReport 产出的结构化报告（可能是空报告） */
  report: ReviewReport;
  /** 审核动作选项 */
  submitting: boolean;
  /** 已存在的待确认修订版 */
  hasRevision: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    uploadTtml: boolean;
    reportMd: string;
    structured: Record<string, unknown>;
    comment: string;
    action: ReviewAction;
  }) => void;
}

export function EditorSaveDialog({
  open,
  report,
  submitting,
  hasRevision,
  onOpenChange,
  onSubmit,
}: EditorSaveDialogProps) {
  const [manualNote, setManualNote] = useAtom(reviewManualNoteAtom);
  const [uploadTtml, setUploadTtml] = useAtom(reviewUploadTtmlAtom);
  const [action, setAction] = useAtom(reviewActionAtom);

  /** 自动报告 */
  const autoReportMd = useMemo(() => renderReviewReport(report), [report]);

  const hasAutoContent = useMemo(() => hasReviewReportContent(report), [report]);

  /** 提交给后端的最终报告 */
  const finalReportMd = useMemo(() => {
    const note = manualNote.trim();
    if (!note) return autoReportMd;
    return `${autoReportMd}\n\n---\n\n${note}`;
  }, [autoReportMd, manualNote]);

  const previewHtml = useMemo(() => {
    if (!hasAutoContent && !manualNote.trim()) return '';
    if (!finalReportMd) return '';
    return marked.parse(finalReportMd, { async: false }) as string;
  }, [finalReportMd, hasAutoContent, manualNote]);

  const structured = useMemo(
    () => ({ version: 1, reviewReport: report }) as Record<string, unknown>,
    [report]
  );

  const handleSubmit = () => {
    onSubmit({
      uploadTtml,
      reportMd: finalReportMd,
      structured,
      comment: manualNote.trim(),
      action,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(880px,calc(100vw-48px))] max-w-none flex-col">
        <DialogHeader>
          <DialogTitle>提交审核结果</DialogTitle>
          <DialogDescription>报告由本次编辑的改动自动生成，可补充说明后提交。</DialogDescription>
        </DialogHeader>

        {hasRevision && (
          <div className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            该投稿已有一份待投稿者确认的修订版，你本次保存会覆盖它。
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
          {previewHtml ? (
            <div
              className="comment-markdown px-4 py-3 text-sm"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <p className="px-4 py-6 text-center text-sm text-ink-3">
              没有检测到改动。如果确实无需修改，可以只提交审核意见。
            </p>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="manual-note" className="mb-1.5 block text-xs">
              <MessageSquare className="mr-1 inline size-3.5" />
              补充说明（可选，会附在报告末尾）
            </Label>
            <Textarea
              id="manual-note"
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
              rows={3}
              placeholder="例如：第 3 行的第二个字打轴时听不清，已按伴奏对齐。"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="upload-ttml" checked={uploadTtml} onCheckedChange={setUploadTtml} />
              <Label htmlFor="upload-ttml" className="text-xs">
                上传修订版 TTML
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-3">审核结果</span>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as ReviewAction)}
                className="rounded border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="approve">通过</option>
                <option value="revision">需要修改</option>
                <option value="reject">拒绝</option>
                <option value="missing_audio">缺少音频</option>
              </select>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadText(
                finalReportMd,
                `review-report-${new Date().toISOString().slice(0, 10)}.md`
              )
            }
            disabled={!finalReportMd || (!hasAutoContent && !manualNote.trim())}
          >
            <Download className="size-4" />
            导出报告
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            提交
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
