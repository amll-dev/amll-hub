import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Heart, Download, Play, Pause, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import { domToPng } from 'modern-screenshot';
import type { DailyRecommendation } from '@/lib/types';
import { parseMarkupText } from '@/lib/markup';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { usePlayer } from '@/hooks/usePlayer';
import { useAuth } from '@/hooks/useAuth';
import { AspectRatio } from '@/components/ui/aspect-ratio';

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const PLACEHOLDER_IMG =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22600%22 height=%22600%22%3E%3Crect fill=%22%23D3D3D3%22 width=%22600%22 height=%22600%22/%3E%3C/svg%3E';

/** 下载 PNG 的圆角半径 */
const DOWNLOAD_RADIUS = 24;

/** 在 canvas 层给 PNG 四角裁圆角。 */
async function roundImageCorners(dataUrl: string, radiusPx: number): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('PNG 加载失败'));
    img.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  const r = Math.min(radiusPx, canvas.width / 2, canvas.height / 2);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(canvas.width, 0, canvas.width, canvas.height, r);
  ctx.arcTo(canvas.width, canvas.height, 0, canvas.height, r);
  ctx.arcTo(0, canvas.height, 0, 0, r);
  ctx.arcTo(0, 0, canvas.width, 0, r);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** 点状分隔线 */
function SeparatorDots() {
  const dotCount = Math.floor(420 / 13);
  return (
    <>
      {Array.from({ length: dotCount }).map((_, i) => (
        <div key={i} className="h-[3px] w-[3px] shrink-0 rounded-full bg-[#D0D0D0]" />
      ))}
    </>
  );
}

export function RecommendCard({
  recommendation,
  compact = false,
}: {
  recommendation: DailyRecommendation;
  compact?: boolean;
}) {
  const { playNcmSong, toggle, playing, loading: playerLoading, track } = usePlayer();
  const { user, openLogin } = useAuth();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(recommendation.likeCount ?? 0);
  const [downloading, setDownloading] = useState(false);
  const [coverLoaded, setCoverLoaded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 登录用户进入卡片时拉取服务端点赞状态（Query 去重：同卡片重复挂载只发一次）
  const likeStatusQuery = useQuery({
    queryKey: queryKeys.dailyLikeStatus(recommendation.id),
    queryFn: () => api.getDailyLikeStatus(recommendation.id),
    enabled: !!user && !!recommendation.id,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  // 切换推荐时重置本地点赞状态
  useEffect(() => {
    setLiked(false);
    setLikeCount(recommendation.likeCount ?? 0);
  }, [recommendation.id, recommendation.likeCount]);

  // 服务端状态到达后覆盖本地默认值
  useEffect(() => {
    if (likeStatusQuery.data) {
      setLiked(likeStatusQuery.data.liked);
      setLikeCount(likeStatusQuery.data.likeCount);
    }
  }, [likeStatusQuery.data]);

  const likeMutation = useMutation({
    mutationFn: () => api.toggleDailyLike(recommendation.id),
    // 乐观更新，失败回滚
    onMutate: () => {
      const prev = { liked, count: likeCount };
      setLiked(!prev.liked);
      setLikeCount(prev.liked ? Math.max(0, prev.count - 1) : prev.count + 1);
      return prev;
    },
    onSuccess: (s) => {
      setLiked(s.liked);
      setLikeCount(s.likeCount);
    },
    onError: (_e, _v, ctx) => {
      if (ctx) {
        setLiked(ctx.liked);
        setLikeCount(ctx.count);
      }
    },
  });

  const handleLike = () => {
    if (likeMutation.isPending) return;
    // 未登录：弹登录窗，登录成功后回到当前页面
    if (!user) {
      openLogin();
      return;
    }
    if (!recommendation.id) return;
    likeMutation.mutate();
  };

  // 封面预加载
  const [coverSrc, setCoverSrc] = useState('');
  useEffect(() => {
    const coverUrl = recommendation.coverKey ? api.dailyCoverUrl(recommendation.coverKey) : '';
    if (!coverUrl) {
      setCoverLoaded(true);
      return;
    }
    setCoverLoaded(false);
    setCoverSrc('');
    let cancelled = false;
    const show = () => {
      if (!cancelled) setCoverLoaded(true);
    };
    (async () => {
      try {
        const resp = await fetch(coverUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        if (cancelled) return;
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          setCoverSrc(dataUrl);
          // 等待解码完成
          if (typeof img.decode === 'function') {
            img.decode().then(show, show);
          } else {
            show();
          }
        };
        img.onerror = show;
        img.src = dataUrl;
      } catch {
        // 拉取失败也要结束骨架屏，渲染端回退占位图
        show();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recommendation.coverKey]);

  // 点赞计数由服务端同步的 likeCount state 承接

  // 生成指向当前日期的二维码
  const [qrSvg, setQrSvg] = useState('');
  useEffect(() => {
    const url = `${window.location.origin}/daily?date=${recommendation.date}`;
    QRCode.toString(url, {
      type: 'svg',
      margin: 0,
      color: { dark: '#000000', light: '#00000000' },
    })
      .then(setQrSvg)
      .catch(() => setQrSvg(''));
  }, [recommendation.date]);

  const date = useMemo(() => new Date(recommendation.date), [recommendation.date]);
  const monthAbbr = MONTH_ABBR[date.getMonth()] ?? '';
  const day = date.getDate();

  const commentHtml = useMemo(
    () => parseMarkupText(recommendation.comment || ''),
    [recommendation.comment]
  );

  const username =
    (recommendation.submitterInfo?.displayName as string) ||
    (recommendation.submitterInfo?.name as string) ||
    recommendation.submitter ||
    '匿名用户';

  const ncmId = recommendation.ncmId;
  const canPlay = ncmId && !Number.isNaN(parseInt(ncmId, 10));

  // 当前卡片曲目是否正在播放器中播放
  const isCurrentTrack = track?.ncmSongId === ncmId;
  const isCurrentPlaying = isCurrentTrack && playing;
  const isCurrentLoading = isCurrentTrack && playerLoading;

  const handlePlay = () => {
    if (!canPlay || !ncmId) return;
    // 若当前播放的就是这首，切换暂停/播放；否则播放这首
    if (isCurrentTrack) {
      toggle();
    } else {
      playNcmSong(ncmId, {
        name: recommendation.songName,
        artists: recommendation.artist,
        cover: coverSrc,
      });
    }
  };

  const handleDownload = async () => {
    if (!cardRef.current || downloading) return;
    setDownloading(true);
    try {
      const png = await domToPng(cardRef.current, { scale: 2 });
      // canvas 层裁剪圆角：CSS border-radius 在 foreignObject 光栅化时
      // 对 blur 滤镜背景的裁剪不可靠，直接用裁剪路径切，角外必为透明
      const rounded = await roundImageCorners(png, DOWNLOAD_RADIUS * 2);
      const link = document.createElement('a');
      link.download = `amll-daily-${recommendation.date}.png`;
      link.href = rounded;
      link.click();
    } catch (e) {
      console.error('下载失败:', e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="relative flex w-full max-w-[520px] items-start gap-3">
      {/* 卡片本体 */}
      <div
        ref={cardRef}
        className={`relative flex-1 overflow-hidden rounded-lg bg-background ${
          compact ? 'min-h-auto' : 'min-h-[520px]'
        }`}
      >
        {coverSrc && (
          <img
            src={coverSrc}
            alt="背景"
            className={`absolute inset-0 h-full w-full scale-110 rounded-lg object-cover brightness-75 blur-[100px] transition-opacity duration-500 ${coverLoaded ? 'opacity-90' : 'opacity-0'}`}
            style={{ zIndex: 0 }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        <div
          className={`relative z-[1] rounded-[20px] bg-card/80 backdrop-blur-xl ${
            compact ? 'm-3 p-4 rounded-2xl' : 'm-4 p-4'
          }`}
          style={{ minHeight: compact ? 'auto' : 'calc(100% - 32px)' }}
        >
          <AspectRatio
            ratio={1}
            className="relative mb-3 block w-full overflow-hidden rounded-[12px]"
          >
            {!coverLoaded && (
              <div
                className="amll-skeleton inset-0 rounded-[12px]"
                style={{ position: 'absolute', background: '#e6e6eb' }}
              />
            )}
            <img
              src={coverSrc || PLACEHOLDER_IMG}
              alt={recommendation.songName}
              className={`block h-full w-full object-cover transition-opacity duration-500 ${
                coverLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </AspectRatio>

          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2
                className={`m-0 mb-1.5 font-semibold leading-[1.3] break-words text-foreground ${
                  compact ? 'text-base' : 'text-lg'
                }`}
              >
                {recommendation.songName}
              </h2>
              <p
                className={`m-0 font-semibold leading-[1.5] break-words text-ink-2 ${
                  compact ? 'text-xs' : 'text-xs'
                }`}
              >
                {recommendation.artist}
              </p>
            </div>
            {/* 二维码 */}
            {qrSvg && (
              <div
                className={`shrink-0 opacity-60 [&_svg]:h-full [&_svg]:w-full ${
                  compact ? 'h-12 w-12' : 'h-14 w-14'
                }`}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            )}
          </div>

          <div className="my-[15px] mb-5 flex items-center gap-2.5">
            <SeparatorDots />
          </div>

          <div
            className={`mb-5 flex items-start gap-5 ${compact ? 'min-h-auto' : 'min-h-[100px]'}`}
          >
            <div
              className={`flex shrink-0 flex-col items-start pl-2.5 ${compact ? 'w-auto' : 'w-20'}`}
            >
              <div
                className={`mb-[5px] font-medium leading-none text-ink-2 ${
                  compact ? 'text-base' : 'text-[20px]'
                }`}
              >
                {monthAbbr}
              </div>
              <div
                className={`font-medium leading-none text-foreground ${
                  compact ? 'text-4xl' : 'text-[45px]'
                }`}
              >
                {day}
              </div>
            </div>

            <div className="relative min-w-0 flex-1 pr-[50px]">
              <div
                className="pointer-events-none absolute bottom-0 right-0 translate-y-2.5 font-serif leading-none text-[#D0D0D0] opacity-60"
                style={{ fontSize: compact ? '40px' : '50px' }}
              >
                ❞
              </div>
              <p
                className={`m-0 break-words leading-[1.6] text-ink-2 ${
                  compact ? 'text-sm' : 'text-[17px]'
                }`}
                dangerouslySetInnerHTML={{ __html: commentHtml }}
              />
              <div className="mt-2.5 text-right text-[13px] font-light text-ink-2">
                --来自 @{username} 的评论
              </div>
            </div>
          </div>

          <div className="mt-[5px]">
            <div className="mb-3 flex items-center gap-2.5">
              <SeparatorDots />
            </div>
            <p
              className={`m-0 text-center font-extralight text-ink-2 ${
                compact ? 'text-base' : 'text-base'
              }`}
            >
              AMLL Hub | 今日推荐
            </p>
          </div>
        </div>
      </div>

      {/* 操作栏*/}
      {!compact && (
        <div className="flex shrink-0 flex-col items-center justify-center gap-1.5 pt-8">
          {/* 播放 */}
          {canPlay && (
            <motion.button
              type="button"
              onClick={handlePlay}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.88 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              className="flex h-8 w-8 cursor-pointer items-center justify-center text-foreground transition-colors hover:text-primary"
              title={isCurrentPlaying ? '暂停' : '播放'}
            >
              {isCurrentLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isCurrentPlaying ? (
                <Pause className="h-5 w-5 fill-current" />
              ) : (
                <Play className="h-5 w-5 fill-current ml-0.5" />
              )}
            </motion.button>
          )}

          {/* 点赞 */}
          <div className="flex flex-col items-center leading-none">
            <motion.button
              type="button"
              onClick={handleLike}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.88 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              className={`flex h-8 w-8 cursor-pointer items-center justify-center transition-colors ${
                liked ? 'text-primary' : 'text-ink-2 hover:text-foreground'
              }`}
              title={liked ? '取消点赞' : '点赞'}
            >
              <Heart className={`h-5 w-5 ${liked ? 'fill-current' : ''}`} />
            </motion.button>
            <motion.span
              key={likeCount}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              className="text-[10px] text-ink-2"
            >
              {likeCount}
            </motion.span>
          </div>

          {/* 下载 */}
          <motion.button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            whileHover={{ scale: 1.12 }}
            whileTap={{ scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            className="flex h-8 w-8 cursor-pointer items-center justify-center text-ink-2 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title="下载卡片图片"
          >
            {downloading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Download className="h-5 w-5" />
            )}
          </motion.button>
        </div>
      )}
    </div>
  );
}

/** 骨架屏 */
export function SkeletonCard({ compact = false }: { compact?: boolean } = {}) {
  return (
    <div className="relative flex w-full max-w-[520px] items-start gap-3">
      {/* 卡片本体 */}
      <div
        className={`relative flex-1 overflow-hidden rounded-lg bg-background ${
          compact ? 'min-h-auto' : 'min-h-[520px]'
        }`}
      >
        <div
          className={`relative z-[1] rounded-[20px] bg-card/80 backdrop-blur-xl ${
            compact ? 'm-3 p-4 rounded-2xl' : 'm-4 p-4'
          }`}
          style={{ minHeight: compact ? 'auto' : 'calc(100% - 32px)' }}
        >
          {/* 封面 */}
          <div className="amll-skeleton mb-3 block aspect-square w-full rounded-[12px]" />

          {/* 标题行 */}
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="amll-skeleton mb-1.5 h-5 w-[70%] rounded" />
              <div className="amll-skeleton h-3.5 w-[45%] rounded" />
            </div>
            <div
              className={`amll-skeleton shrink-0 rounded ${compact ? 'h-12 w-12' : 'h-14 w-14'}`}
            />
          </div>

          {/* 分隔点行 */}
          <div className="my-[15px] mb-5 flex items-center gap-2.5">
            {Array.from({ length: 32 }).map((_, i) => (
              <div
                key={i}
                className="h-[3px] w-[3px] shrink-0 rounded-full bg-[#D0D0D0] opacity-50"
              />
            ))}
          </div>

          {/* 日期块 + 评论区 */}
          <div
            className={`mb-5 flex items-start gap-5 ${compact ? 'min-h-auto' : 'min-h-[100px]'}`}
          >
            {/* 左侧日期 */}
            <div
              className={`flex shrink-0 flex-col items-start pl-2.5 ${compact ? 'w-auto' : 'w-20'}`}
            >
              <div
                className={`amll-skeleton mb-[5px] rounded ${compact ? 'h-4 w-10' : 'h-5 w-12'}`}
              />
              <div className={`amll-skeleton rounded ${compact ? 'h-8 w-10' : 'h-11 w-12'}`} />
            </div>

            {/* 右侧评论 */}
            <div className="min-w-0 flex-1 pr-[50px]">
              <div className="amll-skeleton mb-2 h-4 w-full rounded" />
              <div className="amll-skeleton mb-2 h-4 w-[90%] rounded" />
              <div className="amll-skeleton mb-2 h-4 w-[75%] rounded" />
              <div className="amll-skeleton ml-auto mt-2.5 h-3 w-28 rounded" />
            </div>
          </div>

          {/* 底部分隔点 + 文字 */}
          <div className="mt-[5px]">
            <div className="mb-3 flex items-center gap-2.5">
              {Array.from({ length: 32 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[3px] w-[3px] shrink-0 rounded-full bg-[#D0D0D0] opacity-50"
                />
              ))}
            </div>
            <div className="amll-skeleton mx-auto h-4 w-40 rounded" />
          </div>
        </div>
      </div>

      {/* 右侧操作栏 */}
      {!compact && (
        <div className="flex shrink-0 flex-col items-center justify-center gap-1.5 pt-8">
          <div className="amll-skeleton h-8 w-8 rounded" />
          <div className="amll-skeleton h-8 w-8 rounded" />
          <div className="amll-skeleton h-8 w-8 rounded" />
        </div>
      )}
    </div>
  );
}

/** 空状态 */
export function EmptyState({ date }: { date: Date }) {
  const text = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 暂无推荐`;
  return (
    <div className="px-5 py-15 text-center text-ink-2" style={{ padding: '60px 20px' }}>
      <div className="mx-auto mb-4 h-16 w-16 opacity-50">
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
      <div className="text-base">{text}</div>
    </div>
  );
}
