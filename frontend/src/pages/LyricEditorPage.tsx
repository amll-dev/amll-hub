import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { openTabAtom } from '@/editor/states/sidebar.ts';
import { useFileOpener } from '@/editor/hooks/useFileOpener.ts';
import type { ReviewReport } from '@/editor/modules/review/services/report-service/types';
import {
  autoReviewReportAtom,
  editedReviewReportAtom,
  effectiveReviewReportAtom,
  reviewActionAtom,
  reviewManualNoteAtom,
  reviewReportDialogAtom,
  reviewRequirementAtom,
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
import { useViewers } from '@/hooks/useViewers';
import { buildEditorAudioSources } from '@/lib/review/audio-sources';
import { buildEditorSaveBundle } from '@/lib/review/editor-save-bundle';
import type { EditorContext, ReviewAction } from '@/lib/types';

export type LyricEditorMode = 'review' | 'creator';

/** 审核占用心跳间隔：需小于后端租约时长（默认 3 分钟）才能持续续约 */
const REVIEW_HEARTBEAT_MS = 60_000;

export function LyricEditorPage({ mode = 'review' }: { mode?: LyricEditorMode }) {
  const { id } = useParams<{ id: string }>();
  const submissionId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isCreator = mode === 'creator';

  const [audioIndex, setAudioIndex] = useState(0);

  // 编辑器内部状态
  const lyricLines = useAtomValue(lyricLinesAtom);
  const isDirty = useAtomValue(isDirtyAtom);
  const setToolMode = useSetAtom(toolModeAtom);
  const markLyricLinesSaved = useSetAtom(markLyricLinesSavedAtom);
  const setReviewRequirement = useSetAtom(reviewRequirementAtom);
  const openSidebarTab = useSetAtom(openTabAtom);
  const autoOpenedRequirementRef = useRef(false);
  const { loadTtmlContent } = useFileOpener();

  /** 原稿 TTML，保存时用来生成 diff 报告 */
  const [originalTtml, setOriginalTtml] = useState('');

  const ctxQueryKey = useMemo(
    () =>
      isCreator
        ? queryKeys.submitterEditorContext(submissionId)
        : queryKeys.editorContext(submissionId),
    [isCreator, submissionId]
  );

  const ctxQuery = useQuery({
    queryKey: ctxQueryKey,
    queryFn: () =>
      isCreator ? api.getSubmitterEditorContext(submissionId) : api.getEditorContext(submissionId),
    enabled: Number.isFinite(submissionId),
    retry: false,
  });

  const ctx = ctxQuery.data;
  const audios = useMemo(() => ctx?.audios ?? [], [ctx?.audios]);
  const ncmIds = useMemo(() => ctx?.ncmIds ?? [], [ctx?.ncmIds]);
  const qqIds = useMemo(() => ctx?.qqIds ?? [], [ctx?.qqIds]);

  // 左侧「审核要求」面板数据
  useEffect(() => {
    setReviewRequirement(ctx?.review ?? null);
    return () => setReviewRequirement(null);
  }, [ctx?.review, setReviewRequirement]);

  // 切换稿件时允许重新自动展开
  useEffect(() => {
    autoOpenedRequirementRef.current = false;
  }, [submissionId]);

  // 投稿者进入编辑器时，有审核要求就自动打开面板（只自动展开一次）
  useEffect(() => {
    if (!isCreator || !ctx?.review || autoOpenedRequirementRef.current) return;
    autoOpenedRequirementRef.current = true;
    openSidebarTab('requirements');
  }, [ctx?.review, isCreator, openSidebarTab]);

  // 同一投稿可能带多个网易云 / QQ 音乐 ID：全部并行解析，成功的都作为参考音频候选
  const ncmQuery = useQuery({
    queryKey: queryKeys.ncmMusics(ncmIds),
    queryFn: async () => {
      const settled = await Promise.allSettled(ncmIds.map((id) => api.parseNcmMusic(id)));
      return ncmIds.map((id, i) => {
        const result = settled[i];
        return { id, info: result?.status === 'fulfilled' ? result.value : null };
      });
    },
    enabled: ncmIds.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const qmQuery = useQuery({
    queryKey: queryKeys.qmMusics(qqIds),
    queryFn: async () => {
      const settled = await Promise.allSettled(qqIds.map((id) => api.parseQmMusic(id)));
      return qqIds.map((id, i) => {
        const result = settled[i];
        return { id, info: result?.status === 'fulfilled' ? result.value : null };
      });
    },
    enabled: qqIds.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // 音源列表
  const sources = useMemo(
    () => buildEditorAudioSources(audios, ncmQuery.data ?? [], qmQuery.data ?? []),
    [audios, ncmQuery.data, qmQuery.data]
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

  // WS：观看者列表 + 投稿状态变更广播
  const viewerState = useViewers(submissionId);

  // 审核占用租约：进入编辑器即占用，心跳续约，离开/页面卸载时释放
  const claimedRef = useRef(false);
  const claimGenRef = useRef(0);
  // 等上下文加载完成再占用：此时缓存已有数据，占用结果可直接补丁状态
  const hasCtx = ctxQuery.isSuccess;
  useEffect(() => {
    if (isCreator || !hasCtx || !Number.isFinite(submissionId)) return;
    const gen = ++claimGenRef.current;
    const isCurrent = () => gen === claimGenRef.current;

    const patchStatus = (status?: string) => {
      if (!status) return;
      queryClient.setQueryData<EditorContext>(ctxQueryKey, (prev) =>
        prev && prev.status !== status ? { ...prev, status } : prev
      );
    };

    const release = (keepalive = false) => {
      if (!claimedRef.current) return;
      claimedRef.current = false;
      // keepalive：页面卸载期间也能把请求发出
      api.releaseReview(submissionId, keepalive).catch(() => {});
    };

    const claim = async () => {
      try {
        const { held } = await api.markReviewing(submissionId);
        // 过期实例（StrictMode 的第一轮 / 已切换稿件）：结果直接丢弃
        if (!isCurrent()) return;
        claimedRef.current = held;
        // 他人已占用或已是终态：不抢占，状态以 WS 广播 / 心跳为准
        if (held) patchStatus('reviewing');
      } catch {
        // 占用失败不影响编辑，交给后端租约兜底
      }
    };

    const heartbeat = async () => {
      // 页面不可见时不再续约：超时后自动释放，回来时重新占用
      if (!isCurrent() || document.visibilityState !== 'visible') return;
      try {
        const { held, status } = await api.reviewHeartbeat(submissionId);
        if (!isCurrent()) return;
        claimedRef.current = held;
        patchStatus(status);
        if (!held) await claim();
      } catch {
        // 心跳失败静默，交给后端租约超时释放
      }
    };

    const claimTimer = setTimeout(() => void claim(), 0);
    const timer = setInterval(() => void heartbeat(), REVIEW_HEARTBEAT_MS);
    // pagehide 比 beforeunload 更可靠：覆盖关标签页、刷新、前进后退、bfcache
    const onPageHide = () => release(true);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      clearTimeout(claimTimer);
      clearInterval(timer);
      window.removeEventListener('pagehide', onPageHide);
      // 只有最新一代实例才负责释放；被 StrictMode 替换掉的旧实例不在这里释放
      if (isCurrent()) {
        release();
        claimGenRef.current += 1;
      }
    };
  }, [ctxQueryKey, hasCtx, isCreator, queryClient, submissionId]);

  // WS 状态更新：直接补丁编辑器上下文里的 status，不重拉 TTML（避免覆盖未保存内容）
  useEffect(() => {
    if (!Number.isFinite(submissionId)) return;
    const handler = (e: Event) => {
      const payload = (e as CustomEvent<unknown>).detail;
      const obj =
        typeof payload === 'object' && payload ? (payload as Record<string, unknown>) : null;
      const newStatus = typeof payload === 'string' ? payload : (obj?.status as string | undefined);
      if (!newStatus) return;
      queryClient.setQueryData<EditorContext>(ctxQueryKey, (prev) =>
        prev && prev.status !== newStatus ? { ...prev, status: newStatus } : prev
      );
    };
    window.addEventListener('submission:status-update', handler);
    return () => window.removeEventListener('submission:status-update', handler);
  }, [ctxQueryKey, queryClient, submissionId]);

  // 把后端 TTML 灌进编辑器：审核员默认打轴，投稿者默认编辑
  useEffect(() => {
    if (!ctx?.ttml) return;
    setOriginalTtml(ctx.ttml);
    void loadTtmlContent(ctx.ttml, {
      // 投稿者与审核员各用独立草稿空间，避免同一稿件互相覆盖本地草稿
      projectId: isCreator ? `creator-${submissionId}` : String(submissionId),
      fileName: ctx.fileName,
    });
    setToolMode(isCreator ? ToolMode.Edit : ToolMode.Sync);
  }, [ctx?.ttml, ctx?.fileName, isCreator, loadTtmlContent, setToolMode, submissionId]);

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
        console.error('[editor-audio] 加载失败', {
          audioSrc,
          audioIndex: safeAudioIndex,
          error: err,
        });
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

  // 投稿者提交编辑器修改：使用报告弹窗里确认后的摘要，校验通过后保存
  const submitMutation = useMutation({
    mutationFn: async (input: { reportMd: string }) => {
      if (lyricLines.lyricLines.length === 0) {
        throw new Error('歌词尚未加载完成，请稍后再试');
      }
      const bundle = buildEditorSaveBundle(originalTtml, lyricLines);
      if (!bundle.ok) {
        throw new Error(bundle.error);
      }
      const validation = await api.validateTtml(bundle.bundle.ttml);
      if (!validation.valid) {
        const reason = validation.errors?.[0] || validation.parseError || 'TTML 校验未通过';
        throw new Error(`校验未通过：${reason}`);
      }
      await api.saveSubmitterContent(submissionId, {
        ttml: bundle.bundle.ttml,
        metadata: Object.fromEntries(lyricLines.metadata.map((m) => [m.key, m.value])),
        reportMd: input.reportMd,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.submission(submissionId) });
      void queryClient.invalidateQueries({ queryKey: ['submissions'] });
      markLyricLinesSaved();
      setReviewDialog({ open: false, title: '' });
      toast.success('歌词已提交修改');
      navigate(`/creator/lyrics/detail?id=${submissionId}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '提交失败');
    },
  });

  const backPath = isCreator
    ? `/creator/lyrics/detail?id=${submissionId}`
    : `/review/detail?id=${submissionId}`;

  const goBack = useCallback(() => {
    if (isDirty && !confirm('有未保存的改动，确定离开吗？')) return;
    navigate(backPath);
  }, [backPath, isDirty, navigate]);

  // 解析在线音频期间不能判成「无音频」，否则会闪一下空状态/文本模式
  const resolvingAudio = ncmQuery.isLoading || qmQuery.isLoading;
  // 有 ID 但没解析出可用直链（会员专享、无版权等）
  const onlineAudioFailed =
    (ncmQuery.data?.some((c) => !c.info?.url?.trim()) ?? false) ||
    (qmQuery.data?.some((c) => !c.info?.url?.trim()) ?? false);
  const noAudio =
    !isCreator && !ctxQuery.isLoading && !resolvingAudio && sources.length === 0 && !ctxQuery.error;
  const textOnly = !ctxQuery.isLoading && !resolvingAudio && sources.length === 0;

  if (noAudio) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="该投稿没有可用的参考音频"
          description={
            onlineAudioFailed
              ? '在线音频解析失败（网易云 / QQ 音乐），打轴需要音频作为时间基准。请在详情页上传音频，或把该投稿标记为「缺音频」。'
              : '打轴需要音频作为时间基准。请先在详情页上传音频，或把该投稿标记为「缺音频」。'
          }
          action={
            <Button variant="outline" onClick={goBack}>
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
            <Button variant="outline" onClick={goBack}>
              <ArrowLeft className="size-4" />
              {isCreator ? '返回投稿详情' : '返回审核详情'}
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
            textOnly ? ' · 无音频文本模式' : ''
          }${!isCreator && ctx.hasRevision ? ' · 已存在待确认的修订版' : ''}`}
          sources={sources}
          audioIndex={audioIndex}
          onAudioIndexChange={setAudioIndex}
          onBack={goBack}
          onSave={openReviewDialog}
          saving={isCreator ? submitMutation.isPending : saveMutation.isPending}
          mode={mode}
          textOnly={textOnly}
          status={ctx.status}
          viewers={viewerState}
        />

        <div className="relative min-h-0 flex-1">
          <EditorWorkbench textOnly={textOnly} />

          {/* 音频源就绪后先让审核员确认/选择参考音频（多个时可选，单个时确认） */}
          <AudioSourcePicker sources={sources} value={audioIndex} onConfirm={setAudioIndex} />

          {effectiveReport && (
            <ReviewReportDialog
              mode={mode}
              submitting={isCreator ? submitMutation.isPending : saveMutation.isPending}
              onSubmit={(input) => {
                if (isCreator) {
                  submitMutation.mutate({ reportMd: input.reportMd });
                  return;
                }
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
          {submitMutation.isPending && (
            <div className="pointer-events-none fixed bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-xs text-background shadow-lg">
              <Loader2 className="size-4 animate-spin" />
              正在校验并提交…
            </div>
          )}
        </div>
      </div>
    </EditorTheme>
  );
}
