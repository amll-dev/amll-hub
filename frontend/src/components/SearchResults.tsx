import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Music2,
  User,
  Disc3,
  FileText,
  Hash,
  Calendar,
  Github,
  Play,
  Eye,
  Download,
} from 'lucide-react';
import { useSearchContext } from '@/hooks/useSearchContext';
import { usePlayer } from '@/hooks/usePlayer';
import { api } from '@/lib/api';
import { downloadBlobFile } from '@/lib/download';
import { listItem, staggerContainer } from '@/lib/motion';
import { formatDate, formatNumber } from '@/lib/format';
import { sanitizeHighlightHtml } from '@/lib/markup';
import type { SearchHit, SearchIpMatchResult } from '@/lib/types';

// 结果区顶部的锚点 id，分页切换时滚到此位置
const RESULTS_ANCHOR_ID = 'search-results-anchor';

function Pagination() {
  const { page, pageSize, totalHits, loading, setPage } = useSearchContext();
  const totalPages = Math.max(1, Math.ceil(totalHits / pageSize));
  if (totalPages <= 1) return null;

  // 计算显示的页码窗口：当前页附近最多 5 个
  const win = 2;
  let start = Math.max(1, page - win);
  let end = Math.min(totalPages, page + win);
  // 靠近边界时扩展另一侧，保持窗口宽度
  if (end - start < win * 2) {
    if (start === 1) end = Math.min(totalPages, start + win * 2);
    else start = Math.max(1, end - win * 2);
  }
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  const btnBase =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-md px-3 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const btnIdle = 'border border-input bg-card text-ink-2 hover:border-primary hover:text-primary';
  const btnActive = 'bg-primary text-primary-foreground';

  // 切页：触发请求 + 滚到结果区顶部
  const go = (p: number) => {
    setPage(p);
    requestAnimationFrame(() => {
      document
        .getElementById(RESULTS_ANCHOR_ID)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div className="mt-8 flex items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page <= 1 || loading}
        className={`${btnBase} ${btnIdle}`}
        aria-label="上一页"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {start > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={loading}
            className={`${btnBase} ${btnIdle}`}
          >
            1
          </button>
          {start > 2 && <span className="px-1 text-ink-3">…</span>}
        </>
      )}

      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => go(p)}
          disabled={loading}
          className={`${btnBase} ${p === page ? btnActive : btnIdle}`}
        >
          {p}
        </button>
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="px-1 text-ink-3">…</span>}
          <button
            type="button"
            onClick={() => go(totalPages)}
            disabled={loading}
            className={`${btnBase} ${btnIdle}`}
          >
            {totalPages}
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page >= totalPages || loading}
        className={`${btnBase} ${btnIdle}`}
        aria-label="下一页"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// 单条结果的操作按钮：播放 / 查看 / 下载
function ResultActions({ hit }: { hit: SearchHit }) {
  const { playHit, loading: playerLoading, track } = usePlayer();
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);

  // 该命中是否正在播放
  const isCurrent = track?.hit?.id === hit.id;

  const handlePlay = () => {
    if (playerLoading) return;
    void playHit(hit);
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setDlError(null);
    try {
      await downloadBlobFile(api.rawLyricDownloadURL(hit.rawLyricFile), hit.rawLyricFile);
    } catch (e) {
      setDlError(e instanceof Error ? e.message : '下载失败');
    } finally {
      setDownloading(false);
    }
  };

  const btnBase =
    'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const btnIdle = 'text-ink-3 hover:bg-surface-2 hover:text-primary';
  const btnActive = 'bg-primary-tint text-primary';
  const btnDownload = 'text-ink-3 hover:bg-primary-tint hover:text-primary';

  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* 播放 */}
      <button
        type="button"
        onClick={handlePlay}
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
      {/* 查看 — 跳转到歌词查看页 */}
      <button
        type="button"
        onClick={() => navigate(`/lyric/${encodeURIComponent(hit.rawLyricFile)}`)}
        title="查看歌词"
        className={`${btnBase} ${btnIdle}`}
      >
        <Eye className="h-4 w-4" />
      </button>
      {/* 下载 */}
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        title={dlError ? `下载失败：${dlError}` : '下载 TTML 歌词'}
        className={`${btnBase} ${btnDownload}`}
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

export function SearchResults() {
  const { hits, loading, error, query, totalHits } = useSearchContext();
  const [ipMatch, setIpMatch] = useState<SearchIpMatchResult | null>(null);

  // 当 hits 变化时，收集所有 artists 去重并请求 IP 匹配
  useEffect(() => {
    if (hits.length === 0) {
      setIpMatch(null);
      return;
    }
    const artistSet = new Set<string>();
    for (const hit of hits) {
      for (const artist of hit.artists) {
        artistSet.add(artist);
      }
    }
    if (artistSet.size === 0) {
      setIpMatch(null);
      return;
    }
    let cancelled = false;
    api
      .matchSearchIp(Array.from(artistSet))
      .then((result) => {
        if (!cancelled) setIpMatch(result);
      })
      .catch(() => {
        // 匹配失败不影响搜索结果展示
      });
    return () => {
      cancelled = true;
    };
  }, [hits]);

  const showSkeleton = loading || (hits.length === 0 && totalHits > 0);

  return (
    <motion.section
      initial="hidden"
      animate="show"
      variants={staggerContainer}
      className="mx-auto max-w-[1200px] px-6 py-12"
    >
      {/* 分页切换的滚动锚点：scroll-mt 预留顶栏高度，避免贴顶 */}
      <div id={RESULTS_ANCHOR_ID} className="scroll-mt-20" />
      <div className="mb-6 flex items-center gap-2">
        <h2 className="text-2xl font-bold tracking-tight">搜索结果</h2>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-ink-3" />}
        <p className="mt-1 text-sm text-ink-2">
          “{query}” {loading ? '搜索中…' : `共 ${totalHits} 条`}
        </p>
      </div>

      {error ? (
        <p className="py-12 text-center text-sm text-error">{error}</p>
      ) : showSkeleton ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="amll-skeleton h-20 w-full rounded-md" />
          ))}
        </div>
      ) : hits.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-ink-2">未找到匹配结果</p>
          <p className="mt-2 text-sm text-ink-3">
            尝试更换关键词，或在「请愿」区为这首歌发起歌词请求。
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {hits.map((hit) => {
            const platforms = Object.entries(hit.platformIds).flatMap(([k, ids]) =>
              (ids ?? []).map((id) => ({ platform: k, id }))
            );
            return (
              <motion.li
                key={hit.id}
                variants={listItem}
                className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  {/* 标题 + 团队 logo */}
                  <div className="flex items-center gap-2">
                    <span className="break-words font-semibold text-foreground">
                      {hit.musicNames.length > 0 ? hit.musicNames.join(' / ') : '未知歌曲'}
                    </span>
                    {/* 团队 logo */}
                    {ipMatch &&
                      (() => {
                        // 构建小写 key → team 的映射
                        const lowerTeamMap = new Map<string, (typeof ipMatch.teams)[string]>();
                        for (const [k, v] of Object.entries(ipMatch.teams)) {
                          lowerTeamMap.set(k.toLowerCase(), v);
                        }
                        const seen = new Set<string>();
                        return hit.artists
                          .filter((a) => {
                            const team = lowerTeamMap.get(a.toLowerCase());
                            if (!team) return false;
                            if (seen.has(team.name)) return false;
                            seen.add(team.name);
                            return true;
                          })
                          .map((artistName) => {
                            const team = lowerTeamMap.get(artistName.toLowerCase());
                            if (!team) return null;
                            return (
                              <span
                                key={`team-${artistName}`}
                                className="inline-flex h-10 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-2"
                                title={team.name}
                              >
                                {team.logoKey && (
                                  <img
                                    src={api.searchIpImageUrl(team.logoKey)}
                                    alt={team.name}
                                    className="h-full w-auto object-contain"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                )}
                              </span>
                            );
                          });
                      })()}
                  </div>
                  {/* 艺术家 + 头像（头像显示在名字下方） */}
                  {hit.artists.length > 0 && (
                    <div className="mt-1 flex items-start gap-1 text-sm text-ink-2">
                      <User className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div className="break-words">
                        <span>{hit.artists.join(' / ')}</span>
                        {/* 匹配到的成员头像显示在名字下方（按 member 去重） */}
                        {ipMatch && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            {(() => {
                              // 构建小写 key → member 的映射
                              const lowerMemberMap = new Map<
                                string,
                                (typeof ipMatch.members)[string]
                              >();
                              for (const [k, v] of Object.entries(ipMatch.members)) {
                                lowerMemberMap.set(k.toLowerCase(), v);
                              }
                              const seen = new Set<string>();
                              return hit.artists
                                .filter((a) => {
                                  const member = lowerMemberMap.get(a.toLowerCase());
                                  if (!member) return false;
                                  // 用 avatarKey 去重，同一个人的多个别名只显示一次
                                  if (seen.has(member.avatarKey)) return false;
                                  seen.add(member.avatarKey);
                                  return true;
                                })
                                .map((artistName) => {
                                  const member = lowerMemberMap.get(artistName.toLowerCase());
                                  if (!member) return null;
                                  return (
                                    <img
                                      key={`member-${artistName}`}
                                      src={api.searchIpImageUrl(member.avatarKey)}
                                      alt={artistName}
                                      className="h-10 w-10 rounded-full object-contain"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  );
                                });
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {hit.albums.length > 0 && (
                    <div className="mt-1 flex items-start gap-1 text-sm text-ink-2">
                      <Disc3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="break-words">{hit.albums.join(' / ')}</span>
                    </div>
                  )}
                  {hit.lyricSnippet && (
                    <div
                      className="mt-2 line-clamp-2 break-words text-xs text-ink-3 [&_mark]:rounded [&_mark]:bg-primary-tint [&_mark]:px-0.5 [&_mark]:text-primary"
                      dangerouslySetInnerHTML={{ __html: sanitizeHighlightHtml(hit.lyricSnippet) }}
                    />
                  )}
                  {platforms.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {platforms.map((p, idx) => (
                        <span
                          key={`${p.platform}-${p.id}-${idx}`}
                          className="inline-flex items-center gap-0.5 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3"
                        >
                          <Hash className="h-2.5 w-2.5" />
                          {p.platform}:{p.id}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2 sm:items-end">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3 sm:flex-col sm:items-end sm:gap-1">
                    <div className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      {formatNumber(hit.wordCount)} 字
                    </div>
                    <div className="flex items-center gap-1">
                      <Music2 className="h-3.5 w-3.5" />
                      {formatNumber(hit.lineCount)} 行
                    </div>
                    {hit.commitTimestamp && (
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDate(hit.commitTimestamp)}
                      </div>
                    )}
                    {(hit.ttmlAuthorGithubLogin || hit.ttmlAuthorGithub) && (
                      <div className="flex items-center gap-1 truncate">
                        <Github className="h-3.5 w-3.5" />
                        {hit.ttmlAuthorGithubLogin && <span>{hit.ttmlAuthorGithubLogin}</span>}
                        {hit.ttmlAuthorGithubLogin && hit.ttmlAuthorGithub && (
                          <span className="text-ink-3">·</span>
                        )}
                        {hit.ttmlAuthorGithub && (
                          <span className="text-ink-3">{hit.ttmlAuthorGithub}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <ResultActions hit={hit} />
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}

      <Pagination />
    </motion.section>
  );
}
