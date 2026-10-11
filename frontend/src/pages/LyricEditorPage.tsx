import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtomValue, useSetAtom } from 'jotai';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { audioEngine } from '@/editor/modules/audio/audio-engine';
import {
  isDirtyAtom,
  lyricLinesAtom,
  markLyricLinesSavedAtom,
  ToolMode,
  toolModeAtom,
} from '@/editor/states/main.ts';
import { useFileOpener } from '@/editor/hooks/useFileOpener.ts';
import type { ReviewReport } from '@/editor/modules/review/services/report-service/types';
import {
  autoReviewReportAtom,
  editedReviewReportAtom,
  effectiveReviewReportAtom,
  reviewActionAtom,
  reviewManualNoteAtom,
  reviewReportDialogAtom,
  reviewUploadTtmlAtom,
} from '@/editor/modules/review/states';

import { ReviewReportDialog } from '@/editor/modules/review/modals/ReviewReportDialog';
import { AudioSourcePicker } from '@/components/review/AudioSourcePicker';
import { EditorTheme, EditorWorkbench } from '@/components/review/EditorWorkbench';
import { LyricEditorHeader } from '@/components/review/LyricEditorHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { buildEditorAudioSources } from '@/lib/review/audio-sources';
import { buildEditorSaveBundle } from '@/lib/review/editor-save-bundle';
import type { ReviewAction } from '@/lib/types';

export function LyricEditorPage() {
  const { id } = useParams<{ id: string }>();
  const submissionId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [audioIndex, setAudioIndex] = useState(0);

  // 编辑器内部状态
  const lyricLines = useAtomValue(lyricLinesAtom);
  const isDirty = useAtomValue(isDirtyAtom);
  const setToolMode = useSetAtom(toolModeAtom);
  const markLyricLinesSaved = useSetAtom(markLyricLinesSavedAtom);
  const { loadTtmlContent } = useFileOpener();

  /** 原稿 TTML，保存时用来生成 diff 报告 */
  const [originalTtml, setOriginalTtml] = useState('');

  const ctxQuery = useQuery({
    queryKey: queryKeys.editorContext(submissionId),
    queryFn: () => api.getEditorContext(submissionId),
    enabled: Number.isFinite(submissionId),
    retry: false,
  });

  const ctx = ctxQuery.data;
  const audios = useMemo(() => ctx?.audios ?? [], [ctx?.audios]);
  const ncmId = ctx?.ncmId ?? '';

  const needNcm = !!ncmId;
  const ncmQuery = useQuery({
    queryKey: queryKeys.ncmMusic(ncmId),
    queryFn: () => api.parseNcmMusic(ncmId),
    enabled: needNcm,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // 音源列表
  const sources = useMemo(
    () => buildEditorAudioSources(audios, ncmId, ncmQuery.data ?? null),
    [audios, ncmId, ncmQuery.data]
  );

  const safeAudioIndex = Math.min(audioIndex, Math.max(0, sources.length - 1));
  const audioSrc = sources[safeAudioIndex]?.src ?? '';

  // 音源变化诊断
  useEffect(() => {
    console.info('[editor-audio] sources 变化', {
      audioIndex: safeAudioIndex,
      audioSrc,
      sources: sources.map((s) => ({ key: s.key, src: s.src, label: s.label })),
    });
  }, [sources, safeAudioIndex, audioSrc]);

  // 打开时标记审核中，离开时释放占用
  useEffect(() => {
    if (!ctx) return;
    if (ctx.status === 'pending') {
      void api.markReviewing(submissionId).catch(() => {});
    }
    return () => {
      void api.releaseReview(submissionId, true).catch(() => {});
    };
  }, [ctx, submissionId]);

  // 把后端 TTML 灌进编辑器，并默认停在打轴模式
  useEffect(() => {
    if (!ctx?.ttml) return;
    setOriginalTtml(ctx.ttml);
    void loadTtmlContent(ctx.ttml, {
      projectId: String(submissionId),
      fileName: ctx.fileName,
    });
    // 审核的主要工作是校时间轴而不是改文本，所以默认打轴模式
    setToolMode(ToolMode.Sync);
  }, [ctx?.ttml, ctx?.fileName, loadTtmlContent, setToolMode, submissionId]);

  // 加载参考音频：频谱、波形、打轴都依赖 audioEngine
  useEffect(() => {
    if (!audioSrc) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      console.info('[editor-audio] 开始加载', { audioSrc, audioIndex: safeAudioIndex });
      void audioEngine.loadMusicFromUrl(audioSrc).catch((err) => {
        if (cancelled) return;
        // 切换音频时被更新的请求取代属于正常流程，不打扰用户
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('已被更新的请求取代')) {
          console.info('[editor-audio] 本次加载被更新的请求取代，忽略', { audioSrc });
          return;
        }
        console.error('[editor-audio] 加载失败', { audioSrc, audioIndex: safeAudioIndex, error: err });
        /**
         * 不要直接 `String(err)` —— FFmpeg 链路抛出的可能是
         * `{ code, message }` 这种普通对象，`String()` 会得到
         * 字面量 "[object Object]"，把真正的原因吞掉。
         */
        const detail =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : typeof err === 'object' && err !== null && 'message' in err
                ? String((err as { message: unknown }).message)
                : JSON.stringify(err);

        const hint = detail.includes('Failed to fetch')
          ? '（后端服务可能未启动或网络中断，请确认后端在运行后重试）'
          : '';
        toast.error(`参考音频加载失败：${detail}${hint}`);
      });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // 依赖收敛后的索引：越界被夹回时也要重新判定，而不是只盯 URL 字符串
  }, [audioSrc, safeAudioIndex]);

  // 离开前提示未保存（编辑期间有 IndexedDB 草稿，但提交才算最终保存）
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const report = useMemo<ReviewReport | null>(() => {
    if (!originalTtml) return null;
    const bundle = buildEditorSaveBundle(originalTtml, lyricLines);
    if (!bundle.ok) return null;
    return (bundle.bundle.structured.reviewReport as ReviewReport) ?? null;
  }, [originalTtml, lyricLines]);

  const setAutoReport = useSetAtom(autoReviewReportAtom);
  const setEditedReport = useSetAtom(editedReviewReportAtom);
  const effectiveReport = useAtomValue(effectiveReviewReportAtom);
  useEffect(() => {
    setAutoReport(report);
    // 报告随内容重算时，之前基于旧基线做的启停就失效了，回到「跟随基线」
    setEditedReport(null);
  }, [report, setAutoReport, setEditedReport]);

  // 顶栏「提交审核结果」按钮直接打开审阅结果对话框
  const setReviewDialog = useSetAtom(reviewReportDialogAtom);
  const manualNote = useAtomValue(reviewManualNoteAtom);
  const setAction = useSetAtom(reviewActionAtom);
  const setUploadTtml = useSetAtom(reviewUploadTtmlAtom);
  const openReviewDialog = () => setReviewDialog({ open: true, title: title || '未命名' });

  const saveMutation = useMutation({
    mutationFn: async (input: {
      uploadTtml: boolean;
      reportMd: string;
      structured: Record<string, unknown>;
      comment: string;
      action: ReviewAction;
    }) => {
      // 保存前重新生成 TTML：用户可能在打开弹窗后又有改动
      const bundle = buildEditorSaveBundle(originalTtml, lyricLines, input.comment);
      if (!bundle.ok) {
        throw new Error(bundle.error);
      }
      await api.saveRevision(submissionId, {
        uploadTtml: input.uploadTtml,
        ttmlContent: input.uploadTtml ? bundle.bundle.ttml : undefined,
        metadata: Object.fromEntries(lyricLines.metadata.map((m) => [m.key, m.value])),
        reportMd: input.reportMd,
        structured: input.structured,
        comment: input.comment,
        action: input.action,
      });
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.submission(submissionId) });
      void queryClient.invalidateQueries({ queryKey: ['submissions'] });
      // 提交成功后把当前内容记为已保存基线，顶栏不再显示「有未保存改动」
      markLyricLinesSaved();
      setReviewDialog({ open: false, title: '' });
      toast.success(input.uploadTtml ? '修订版已提交，等待投稿者确认' : '审核结果已提交');
      void api.releaseReview(submissionId, true).catch(() => {});
      navigate('/review/detail?id=' + submissionId);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '保存失败');
    },
  });

  const goBack = useCallback(() => {
    if (isDirty && !confirm('有未保存的改动，确定离开吗？')) return;
    navigate('/review/detail?id=' + submissionId);
  }, [isDirty, navigate, submissionId]);

  // 解析 ncm 音频期间不能判成「无音频」，否则会闪一下空状态
  const resolvingAudio = needNcm && ncmQuery.isLoading;
  const noAudio = !ctxQuery.isLoading && !resolvingAudio && sources.length === 0 && !ctxQuery.error;

  if (noAudio) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="该投稿没有可用的参考音频"
          description={
            needNcm && ncmQuery.isError
              ? '网易云音频解析失败，打轴需要音频作为时间基准。请在详情页上传音频，或把该投稿标记为「缺音频」。'
              : '打轴需要音频作为时间基准。请先在详情页上传音频，或把该投稿标记为「缺音频」。'
          }
          action={
            <Button variant="outline" onClick={() => navigate('/review/detail?id=' + submissionId)}>
              <ArrowLeft className="size-4" />
              返回审核详情
            </Button>
          }
        />
      </div>
    );
  }

  if (ctxQuery.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (ctxQuery.error || !ctx) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="无法打开编辑器"
          description={
            ctxQuery.error instanceof Error ? ctxQuery.error.message : '加载投稿内容失败'
          }
          action={
            <Button variant="outline" onClick={() => navigate('/review/detail?id=' + submissionId)}>
              <ArrowLeft className="size-4" />
              返回审核详情
            </Button>
          }
        />
      </div>
    );
  }

  const title =
    `${lyricLines.metadata.find((m) => m.key === 'artists')?.value.join('、') || '未知歌手'} · ` +
    ctx.fileName.replace(/\.ttml$/i, '');

  return (
    <EditorTheme>
      <div className="flex h-screen flex-col overflow-hidden">
        <LyricEditorHeader
          title={title}
          subtitle={`${lyricLines.lyricLines.length} 行 · ${isDirty ? '有未保存改动' : '未改动'}${
            ctx.hasRevision ? ' · 已存在待确认的修订版' : ''
          }`}
          sources={sources}
          audioIndex={audioIndex}
          onAudioIndexChange={setAudioIndex}
          onBack={goBack}
          onSave={openReviewDialog}
          saving={saveMutation.isPending}
        />

        <div className="relative min-h-0 flex-1">
          <EditorWorkbench />

          {/* 音频源就绪后先让审核员确认/选择参考音频（多个时可选，单个时确认） */}
          <AudioSourcePicker sources={sources} value={audioIndex} onConfirm={setAudioIndex} />

          {effectiveReport && (
            <ReviewReportDialog
              submitting={saveMutation.isPending}
              onSubmit={(input) => {
                setAction(input.action as ReviewAction);
                setUploadTtml(input.uploadTtml);
                saveMutation.mutate({
                  uploadTtml: input.uploadTtml,
                  reportMd: input.reportMd,
                  structured: { version: 1, reviewReport: effectiveReport } as Record<
                    string,
                    unknown
                  >,
                  comment: manualNote,
                  action: input.action as ReviewAction,
                });
              }}
            />
          )}

          {saveMutation.isPending && (
            <div className="pointer-events-none fixed bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-xs text-background shadow-lg">
              <Loader2 className="size-4 animate-spin" />
              正在提交审核结果…
            </div>
          )}
        </div>
      </div>
    </EditorTheme>
  );
}
