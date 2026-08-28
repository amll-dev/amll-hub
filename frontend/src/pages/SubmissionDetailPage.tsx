import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Check, Copy, Download, Loader2, Music, Upload, Users, X } from 'lucide-react';
import { api } from '@/lib/api';
import { LyricViewer } from '@/components/LyricViewer';
import { LyricDetailSkeleton } from '@/components/ui/Skeleton';
import { useViewers, type Viewer } from '@/hooks/useViewers';
import {
  buildActivityEntries,
  extractPlatformIds,
  formatTime,
  langText,
  statusMeta,
} from '@/components/submission/shared';
import { MetaItem } from '@/components/submission/MetaItem';
import { UserDisplayName } from '@/components/submission/UserDisplayName';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { CommentSection } from '@/components/submission/CommentSection';
import { UpdateLyricArea } from '@/components/submission/UpdateLyricArea';
import { UploadAudioArea } from '@/components/submission/UploadAudioArea';
import { NcmSongCard } from '@/components/submission/NcmSongCard';
import { AudioCard } from '@/components/submission/AudioCard';
import { fadeUp, staggerContainer } from '@/lib/motion';
import type { SubmissionDetail, SubmissionAudio } from '@/lib/types';

type DetailTab = 'info' | 'song' | 'file';
type FileView = 'effect' | 'raw';

/** 详情页顶栏：左侧 logo + 标题 + 返回，右侧在线观看者指示器 */
function DetailTopBar({
  pageTitle,
  backPath,
  backLabel,
  count,
  viewers,
  showModal,
  setShowModal,
}: {
  pageTitle: string;
  backPath: string;
  backLabel: string;
  count: number;
  viewers: Viewer[];
  showModal: boolean;
  setShowModal: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-card/80 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between px-6">
        {/* 左：logo + 标题 + 返回 */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex shrink-0 items-center gap-3">
            <Link to="/">
              <img src="/logo.png" alt="AMLLHub" className="h-8 w-8 rounded-md object-contain" />
            </Link>
            <span className="text-lg font-bold tracking-tight text-foreground">
              AMLLHub {pageTitle}
            </span>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
              测试版
            </span>
            <span className="absolute inset-x-0 top-full mt-0.5 whitespace-nowrap text-center text-[9px] leading-none text-ink-3">
              测试版本，不代表最终品质
            </span>
          </div>
          <span className="mx-1 hidden h-5 w-px shrink-0 bg-line sm:block" />
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className="inline-flex shrink-0 items-center gap-1 text-sm text-ink-2 transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{backLabel}</span>
          </button>
        </div>
        {/* 右：观看者指示器 */}
        <ViewersIndicator
          count={count}
          viewers={viewers}
          showModal={showModal}
          setShowModal={setShowModal}
        />
      </div>
    </header>
  );
}

/** 在线观看者指示器 */
function ViewersIndicator({
  count,
  viewers,
  showModal,
  setShowModal,
}: {
  count: number;
  viewers: Viewer[];
  showModal: boolean;
  setShowModal: (v: boolean) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowModal(!showModal)}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-primary/40 hover:text-primary"
      >
        <Users className="h-3.5 w-3.5" />
        {count > 0 ? `${count} 人正在看` : '当前无人观看'}
      </button>
      <AnimatePresence>
        {showModal && (
          <>
            {/* 透明遮罩：点击关闭 */}
            <div className="fixed inset-0 z-40" onClick={() => setShowModal(false)} />
            {/* 下拉面板：定位在按钮右下方 */}
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-line bg-card p-4 shadow-xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">正在查看（{count}）</h3>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="text-ink-3 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {viewers.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-3">暂无其他人在看</p>
              ) : (
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                  {viewers.map((v) => (
                    <li key={v.username} className="flex items-center gap-2">
                      {v.avatar ? (
                        <img
                          src={v.avatar}
                          alt=""
                          className="h-6 w-6 rounded-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs text-ink-3">
                          {(v.displayName || v.username).slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm text-foreground">{v.displayName || v.username}</span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 主详情组件 */
function SubmissionDetailContent({
  id,
  isReviewer,
  backPath,
  backLabel,
}: {
  id: number;
  isReviewer: boolean;
  backPath: string;
  backLabel: string;
}) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  // 用 ref 跟踪最新状态，供组件卸载时判断是否需要释放审核占用
  const statusRef = useRef<string>('');
  useEffect(() => {
    statusRef.current = detail?.status ?? '';
  }, [detail]);
  const [ttml, setTtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<DetailTab>('info');
  const [fileView, setFileView] = useState<FileView>('effect');
  const [copied, setCopied] = useState(false);

  // 操作区
  const [showUpdateLyric, setShowUpdateLyric] = useState(false);
  const [showUploadAudio, setShowUploadAudio] = useState(false);
  const [closing, setClosing] = useState(false);

  // 加载详情（id/审核身份变化时重新拉取）。useCallback 保证下方 effect 依赖完整
  const loadDetail = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .getSubmissionDetail(id)
      .then(async (d) => {
        setDetail(d);
        // 审核员进入 pending 状态投稿时自动标记为审核中，并广播给列表页实时同步
        if (isReviewer && d.status === 'pending') {
          // 乐观更新 statusRef，防止用户在 markReviewing 返回前离开页面
          // 导致 release 因 statusRef 仍为 "pending" 而不执行，状态卡在审核中
          statusRef.current = 'reviewing';
          api
            .markReviewing(id)
            .then(() => {
              setDetail((prev) =>
                prev ? { ...prev, status: 'reviewing' as SubmissionDetail['status'] } : prev
              );
            })
            .catch(() => {
              // 标记失败：回退 statusRef，避免离开时误发 release 请求
              statusRef.current = d.status;
            });
        }
        try {
          const t = await api.getSubmissionTtml(id);
          setTtml(t);
        } catch {
          setTtml('');
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [id, isReviewer]);

  // 初次进入 / 参数变化时加载详情
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // WS 状态更新
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      const obj = typeof detail === 'object' && detail ? (detail as Record<string, unknown>) : null;
      const newStatus = typeof detail === 'string' ? detail : (obj?.status as string | undefined);
      if (!newStatus) return;
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              status: newStatus as SubmissionDetail['status'],
              ...(obj
                ? {
                    title: (obj.title as string) ?? prev.title,
                    reviewer: (obj.reviewer as string) ?? prev.reviewer,
                    updatedAt: (obj.updatedAt as string) ?? prev.updatedAt,
                  }
                : {}),
            }
          : prev
      );
    };
    window.addEventListener('submission:status-update', handler);
    return () => window.removeEventListener('submission:status-update', handler);
  }, []);

  // 审核员离开详情页时，若状态仍为自己标记的“审核中”，释放占用恢复为“待审核”。
  // 通过 beforeunload + useEffect cleanup
  useEffect(() => {
    if (!isReviewer) return;

    const release = () => {
      // 仅当状态为 reviewing 时释放；后端会校验是否为本人标记，非本人则 no-op，
      // 这样页面刷新/重进后也能正确释放（避免审核中状态卡住）
      if (statusRef.current !== 'reviewing') return;
      // keepalive：页面卸载期间也能把请求发出；错误静默（卸载期间无需提示）
      api.releaseReview(id, true).catch(() => {});
    };

    // 页面直接关闭/刷新时触发（React cleanup 在 unload 时不保证执行）
    window.addEventListener('beforeunload', release);
    return () => {
      window.removeEventListener('beforeunload', release);
      release();
    };
  }, [id, isReviewer]);

  const doClose = async () => {
    setClosing(true);
    try {
      await api.closeSubmission(id);
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : '关闭失败');
    } finally {
      setClosing(false);
    }
  };

  const copyTtml = async () => {
    try {
      await navigator.clipboard.writeText(ttml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 忽略
    }
  };

  const downloadTtml = () => {
    const blob = new Blob([ttml], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${detail?.title || 'lyric'}.ttml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 各平台全部 ID（支持多 ID），优先从 metadata.platform_ids 读取
  const platformIds = useMemo(() => extractPlatformIds(detail?.metadata), [detail?.metadata]);

  // 活动时间线条目
  const activityEntries = useMemo(() => (detail ? buildActivityEntries(detail) : []), [detail]);

  if (loading) {
    return <LyricDetailSkeleton />;
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={() => navigate(backPath)}
          className="mt-4 text-sm text-primary hover:underline"
        >
          {backLabel}
        </button>
      </div>
    );
  }

  if (!detail) return null;

  const meta = statusMeta[detail.status] ?? {
    label: detail.status,
    className: 'bg-surface-2 text-ink-2',
  };
  const canReview =
    isReviewer &&
    ['pending', 'reviewing', 'need_revision', 'missing_audio'].includes(detail.status);
  const canUpdateLyric = detail.status !== 'closed';
  const canUploadAudio = detail.status !== 'closed';
  const canClose = !['closed', 'approved', 'rejected'].includes(detail.status);
  const audios: SubmissionAudio[] = detail.audios ?? (detail.audio ? [detail.audio] : []);

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-4 pb-24"
    >
      {/* 标题区卡片 */}
      <motion.div variants={fadeUp} className="rounded-lg border border-line bg-card p-4">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-2xl font-bold text-foreground">
            {detail.title || '未命名'}
            <span className="ml-2 text-base font-normal text-ink-3">#{detail.id}</span>
          </h1>
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium ${meta.className}`}
          >
            {meta.label}
          </span>
        </div>
        {/* meta 信息行 */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-3">
          <UserAvatar
            avatar={detail.submitterInfo?.avatar}
            name={detail.submitterInfo?.displayName || detail.submitter}
            size={20}
          />
          <strong className="text-ink-2">
            <UserDisplayName
              displayName={detail.submitterInfo?.displayName}
              username={detail.submitter}
            />
          </strong>
          <span>于 {formatTime(detail.createdAt)} 提交</span>
          {detail.fileUpdatedAt && <span>· 文件更新于 {formatTime(detail.fileUpdatedAt)}</span>}
        </div>
      </motion.div>

      {/* 主体 + 侧边栏 */}
      <div className="flex gap-5">
        {/* 主体 */}
        <motion.div variants={fadeUp} className="min-w-0 flex-1 space-y-5">
          {/* 标签栏 + 操作按钮 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1">
              {(['info', 'song', 'file'] as DetailTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    tab === t
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface-2 text-ink-2 hover:text-foreground'
                  }`}
                >
                  {t === 'info' ? '信息' : t === 'song' ? '歌曲' : '文件'}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {canUpdateLyric && (
                <button
                  type="button"
                  onClick={() => setShowUpdateLyric(true)}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary-hover"
                >
                  <Upload className="h-3.5 w-3.5" />
                  更新歌词
                </button>
              )}
              {canUploadAudio && (
                <button
                  type="button"
                  onClick={() => setShowUploadAudio(true)}
                  className="inline-flex items-center gap-1 rounded-md bg-purple-600 px-3 py-1.5 text-xs text-white hover:bg-purple-700"
                >
                  <Music className="h-3.5 w-3.5" />
                  上传音频
                </button>
              )}
              {canClose && (
                <button
                  type="button"
                  onClick={doClose}
                  disabled={closing}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-ink-2 hover:text-foreground disabled:opacity-50"
                >
                  {closing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                  关闭投稿
                </button>
              )}
            </div>
          </div>

          {/* 更新歌词区 */}
          {showUpdateLyric && (
            <UpdateLyricArea
              submissionId={id}
              onClose={() => setShowUpdateLyric(false)}
              onSuccess={loadDetail}
            />
          )}

          {/* 上传音频区 */}
          {showUploadAudio && (
            <UploadAudioArea
              submissionId={id}
              onClose={() => setShowUploadAudio(false)}
              onSuccess={loadDetail}
            />
          )}

          {/* 信息标签 */}
          {tab === 'info' && (
            <div className="rounded-lg border border-line bg-card p-5">
              <h3 className="mb-3 text-sm font-semibold text-foreground">稿件信息</h3>
              <dl>
                <MetaItem label="歌手" value={detail.artist} />
                <MetaItem label="专辑" value={detail.album} />
                <MetaItem label="网易云 ID" value={platformIds.ncm.join(', ') || detail.ncmId} />
                <MetaItem label="QQ 音乐 ID" value={platformIds.qq.join(', ') || detail.qqId} />
                <MetaItem label="Apple Music ID" value={platformIds.am.join(', ') || detail.amId} />
                <MetaItem
                  label="Spotify ID"
                  value={platformIds.spotify.join(', ') || detail.spotifyId}
                />
                <MetaItem label="投稿人" value={detail.submitter} />
                <MetaItem label="语言" value={langText(detail.language)} />
                <MetaItem label="创建时间" value={formatTime(detail.createdAt)} />
                {detail.fileUpdatedAt && (
                  <MetaItem label="文件更新" value={formatTime(detail.fileUpdatedAt)} />
                )}
              </dl>
              {detail.notes && (
                <div className="mt-3 border-t border-line pt-3">
                  <div className="mb-1 text-xs text-ink-3">投稿备注</div>
                  <div className="whitespace-pre-wrap text-sm text-foreground">{detail.notes}</div>
                </div>
              )}
            </div>
          )}

          {/* 歌曲标签 */}
          {tab === 'song' && (
            <div className="rounded-lg border border-line bg-card p-5">
              <h3 className="mb-3 text-sm font-semibold text-foreground">歌曲信息</h3>
              <div className="space-y-3">
                {/* 投稿者上传的音频（支持多个） */}
                {audios.map((a) => (
                  <AudioCard
                    key={a.id || a.fileName}
                    audio={a}
                    ttml={ttml}
                    submitterInfo={detail.submitterInfo}
                    submitter={detail.submitter}
                  />
                ))}
                {/* 网易云歌曲信息自动解析 */}
                {(platformIds.ncm[0] || detail.ncmId) && (
                  <NcmSongCard songId={platformIds.ncm[0] || detail.ncmId || ''} ttml={ttml} />
                )}
                {/* 无音频且无 ncm ID */}
                {audios.length === 0 && !(platformIds.ncm[0] || detail.ncmId) && (
                  <p className="text-sm text-ink-3">暂无歌曲信息</p>
                )}
              </div>
            </div>
          )}

          {/* 文件标签 */}
          {tab === 'file' && (
            <div className="rounded-lg border border-line bg-card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setFileView('effect')}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      fileView === 'effect'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-surface-2 text-ink-2 hover:text-foreground'
                    }`}
                  >
                    文件效果
                  </button>
                  <button
                    type="button"
                    onClick={() => setFileView('raw')}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      fileView === 'raw'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-surface-2 text-ink-2 hover:text-foreground'
                    }`}
                  >
                    原文件
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={downloadTtml}
                    className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700"
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载
                  </button>
                  <button
                    type="button"
                    onClick={copyTtml}
                    className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-ink-2 hover:text-foreground"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
              </div>

              {fileView === 'effect' ? (
                ttml ? (
                  <LyricViewer ttml={ttml} showHeader={false} showActions={false} />
                ) : (
                  <pre className="max-h-96 overflow-auto rounded bg-background p-3 text-xs leading-relaxed text-ink-2">
                    (空)
                  </pre>
                )
              ) : (
                <pre className="max-h-96 overflow-auto rounded bg-[#1e1e1e] p-3 text-xs leading-relaxed text-[#d4d4d4]">
                  {ttml || '(空)'}
                </pre>
              )}
            </div>
          )}

          {/* 评论（含审核按钮） */}
          <CommentSection
            submissionId={id}
            initialComments={detail.comments ?? []}
            isReviewer={isReviewer}
            activityEntries={activityEntries}
            canReview={canReview}
            onReviewed={loadDetail}
          />
        </motion.div>

        {/* 侧边栏 */}
        <motion.div variants={fadeUp} className="hidden w-72 shrink-0 space-y-4 lg:block">
          {/* 投稿信息卡片（含审核信息） */}
          <div className="rounded-lg border border-line bg-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">投稿信息</h3>
            <div className="space-y-3 text-sm">
              {/* 投稿人 */}
              <div className="flex items-center gap-2">
                <UserAvatar
                  avatar={detail.submitterInfo?.avatar}
                  name={detail.submitterInfo?.displayName || detail.submitter}
                  size={32}
                />
                <div className="font-medium text-foreground">
                  <UserDisplayName
                    displayName={detail.submitterInfo?.displayName}
                    username={detail.submitter}
                  />
                </div>
              </div>
              <div className="border-t border-line pt-2">
                <div className="text-xs text-ink-3">创建时间</div>
                <div className="text-foreground">{formatTime(detail.createdAt)}</div>
              </div>
              {detail.fileUpdatedAt && (
                <div>
                  <div className="text-xs text-ink-3">文件更新</div>
                  <div className="text-foreground">{formatTime(detail.fileUpdatedAt)}</div>
                </div>
              )}
              {detail.language && (
                <div>
                  <div className="text-xs text-ink-3">语言</div>
                  <div className="text-foreground">{langText(detail.language)}</div>
                </div>
              )}
              {detail.tags && detail.tags.length > 0 && (
                <div>
                  <div className="text-xs text-ink-3">标签</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {detail.tags.map((t) => (
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
              {/* 审核状态 */}
              <div className="border-t border-line pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-ink-3">当前状态</span>
                  <span
                    className={`inline-flex items-center rounded px-2 py-0.5 text-xs ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                </div>
              </div>
            </div>

            {/* 审核历史（过滤掉 file_updated，已迁移到文件更新历史） */}
            {detail.reviewHistory &&
              detail.reviewHistory.filter((h) => h.status !== 'file_updated').length > 0 && (
                <div className="mt-4 border-t border-line pt-4">
                  <h4 className="mb-2 text-xs font-semibold text-ink-2">审核历史</h4>
                  <ul className="space-y-3">
                    {detail.reviewHistory
                      .filter((h) => h.status !== 'file_updated')
                      .map((h) => {
                        const m = statusMeta[h.status] ?? {
                          label: h.status,
                          className: 'bg-surface-2 text-ink-2',
                        };
                        const name = h.reviewerInfo?.displayName || h.reviewer;
                        return (
                          <li key={h.id} className="text-xs">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <UserAvatar avatar={h.reviewerInfo?.avatar} name={name} size={20} />
                              <span className="font-medium text-foreground">
                                {name}
                                {h.reviewerInfo?.displayName &&
                                h.reviewerInfo.displayName !== h.reviewer
                                  ? `@${h.reviewer}`
                                  : ''}
                              </span>
                              <span
                                className={`inline-flex items-center rounded px-1.5 py-0.5 ${m.className}`}
                              >
                                {m.label}
                              </span>
                              <span className="ml-auto shrink-0 text-ink-3">
                                {formatTime(h.reviewedAt)}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

/** 投稿详情页面入口 */
export function SubmissionDetailPage({
  isReviewer,
  backPath,
  backLabel,
}: {
  isReviewer: boolean;
  backPath: string;
  backLabel: string;
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = Number(searchParams.get('id'));
  // 顶栏与详情共享同一个观看者连接
  const { count, viewers, showModal, setShowModal } = useViewers(id);

  if (!id || id <= 0) {
    return (
      <div className="min-h-screen bg-background">
        <DetailTopBar
          pageTitle={isReviewer ? '审核中心' : '创作中心'}
          backPath={backPath}
          backLabel={backLabel}
          count={count}
          viewers={viewers}
          showModal={showModal}
          setShowModal={setShowModal}
        />
        <div className="mx-auto max-w-[1280px] px-6 py-20 text-center">
          <p className="text-sm text-red-600">无效的稿件 ID</p>
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className="mt-4 text-sm text-primary hover:underline"
          >
            {backLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DetailTopBar
        pageTitle={isReviewer ? '审核中心' : '创作中心'}
        backPath={backPath}
        backLabel={backLabel}
        count={count}
        viewers={viewers}
        showModal={showModal}
        setShowModal={setShowModal}
      />
      <div className="mx-auto max-w-[1280px] px-6 py-6">
        <SubmissionDetailContent
          id={id}
          isReviewer={isReviewer}
          backPath={backPath}
          backLabel={backLabel}
        />
      </div>

      {/* 底部提示 */}
      <footer className="flex items-center justify-center gap-2 border-t border-line py-4">
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
          测试版
        </span>
        <span className="text-xs text-ink-3">测试版本，不代表最终品质</span>
      </footer>
    </div>
  );
}
