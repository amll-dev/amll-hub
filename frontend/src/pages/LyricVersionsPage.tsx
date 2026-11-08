import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Calendar,
  Download,
  Eye,
  FileText,
  Github,
  Hash,
  Loader2,
  Play,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageContainer } from '@/components/PageContainer';
import { usePlayer } from '@/hooks/usePlayer';
import { api } from '@/lib/api';
import { downloadBlobFile } from '@/lib/download';
import { formatDateTime, formatNumber } from '@/lib/format';
import { fadeUp, listItem, staggerContainer } from '@/lib/motion';
import { queryKeys } from '@/lib/query';
import type { LyricVersionItem, SearchHit } from '@/lib/types';

const btnBase =
  'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const btnIdle = 'text-ink-3 hover:bg-surface-2 hover:text-primary';
const btnActive = 'bg-primary-tint text-primary';

function toSearchHit(version: LyricVersionItem): SearchHit {
  return {
    id: `song_${version.id}`,
    musicNames: version.musicNames,
    artists: version.artists,
    albums: version.albums,
    platformIds: version.platformIds,
    rawLyricFile: version.rawLyricFile,
    wordCount: version.wordCount,
    lineCount: version.lineCount,
    commitTimestamp: version.commitTimestamp ?? undefined,
    ttmlAuthorGithub: version.ttmlAuthorGithub,
    ttmlAuthorGithubLogin: version.ttmlAuthorGithubLogin,
  };
}

export function LyricVersionsPage() {
  const { filename } = useParams<{ filename: string }>();
  const navigate = useNavigate();
  const { playHit, loading: playerLoading, track } = usePlayer();
  const versionsQuery = useQuery({
    queryKey: queryKeys.lyricVersions(filename ?? ''),
    queryFn: () => api.lyricVersions(filename!),
    enabled: !!filename,
  });
  const [downloading, setDownloading] = useState<string | null>(null);

  const data = versionsQuery.data;

  const handlePlay = (version: LyricVersionItem) => {
    if (playerLoading) return;
    void playHit(toSearchHit(version));
  };

  const handleDownload = async (version: LyricVersionItem) => {
    if (downloading) return;
    setDownloading(version.rawLyricFile);
    try {
      await downloadBlobFile(api.rawLyricDownloadURL(version.rawLyricFile), version.rawLyricFile);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '下载失败');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <PageContainer>
      <motion.div initial="hidden" animate="show" variants={fadeUp}>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          返回搜索
        </button>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">歌词历史版本</h1>
        {data ? (
          <p className="mt-2 text-sm text-ink-2">
            {data.musicNames.length > 0 ? data.musicNames.join(' / ') : '未知歌曲'}
            {data.artists.length > 0 ? ` · ${data.artists.join(' / ')}` : ''}
            {` · 共 ${data.versions.length} 个版本`}
          </p>
        ) : null}
      </motion.div>

      {!filename ? (
        <p className="py-16 text-center text-sm text-ink-3">缺少歌词文件参数</p>
      ) : versionsQuery.isLoading ? (
        <div className="mt-8 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="amll-skeleton h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : versionsQuery.error ? (
        <p className="py-16 text-center text-sm text-error">
          {versionsQuery.error instanceof Error ? versionsQuery.error.message : '获取历史版本失败'}
        </p>
      ) : data && data.versions.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink-3">暂无历史版本</p>
      ) : data ? (
        <motion.ul
          initial="hidden"
          animate="show"
          variants={staggerContainer}
          className="mt-8 space-y-2"
        >
          {data.versions.map((version) => {
            const platforms = Object.entries(version.platformIds).flatMap(([platform, ids]) =>
              (ids ?? []).map((id) => ({ platform, id }))
            );
            const isCurrent = track?.hit?.id === `song_${version.id}`;
            return (
              <motion.li
                key={version.id}
                variants={listItem}
                className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words font-semibold text-foreground">
                      {version.musicNames.length > 0 ? version.musicNames.join(' / ') : '未知歌曲'}
                    </span>
                    {version.isLatest && (
                      <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">
                        最新
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-ink-2">
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    <span>{formatDateTime(version.commitTime ?? version.commitTimestamp)}</span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-ink-2">
                    <Github className="h-3.5 w-3.5 shrink-0" />
                    {version.ttmlAuthorGithubLogin ? (
                      <a
                        href={`https://github.com/${version.ttmlAuthorGithubLogin}`}
                        target="_blank"
                        rel="noreferrer"
                        className="transition-colors hover:text-primary"
                      >
                        @{version.ttmlAuthorGithubLogin}
                      </a>
                    ) : version.ttmlAuthorGithub ? (
                      <span>ID: {version.ttmlAuthorGithub}</span>
                    ) : (
                      <span className="text-ink-3">未知提交者</span>
                    )}
                  </div>

                  {version.artists.length > 0 && (
                    <div className="mt-1 flex items-start gap-1 text-sm text-ink-2">
                      <User className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="break-words">{version.artists.join(' / ')}</span>
                    </div>
                  )}

                  <div className="mt-1 flex items-start gap-1 text-xs text-ink-3">
                    <FileText className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="break-all font-mono">{version.rawLyricFile}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                    <span>
                      {formatNumber(version.wordCount)} 字 · {formatNumber(version.lineCount)} 行
                    </span>
                    {platforms.map((p, idx) => (
                      <span
                        key={`${p.platform}-${p.id}-${idx}`}
                        className="inline-flex items-center gap-0.5 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px]"
                      >
                        <Hash className="h-2.5 w-2.5" />
                        {p.platform}:{p.id}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handlePlay(version)}
                    disabled={playerLoading}
                    title={isCurrent ? '正在播放' : '播放'}
                    className={`${btnBase} ${isCurrent ? btnActive : btnIdle}`}
                  >
                    {playerLoading && isCurrent ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/lyric/${encodeURIComponent(version.rawLyricFile)}`)}
                    title="查看歌词"
                    className={`${btnBase} ${btnIdle}`}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownload(version)}
                    disabled={downloading === version.rawLyricFile}
                    title="下载 TTML 歌词"
                    className={`${btnBase} ${btnIdle}`}
                  >
                    {downloading === version.rawLyricFile ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      ) : null}
    </PageContainer>
  );
}
