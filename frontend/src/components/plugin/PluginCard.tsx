import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PluginStoreListItem } from '@/lib/types';
import { PluginIcon } from './shared';
import { RatingInline } from './PluginRating';

type CoverTone = { hue: number; sat: number };

/** 无图标时的兜底色相 */
const COVER_HUES = [205, 158, 20, 355, 265, 42, 210, 188];

/** 图标主色缓存：同一图标地址只解析一次 */
const iconToneCache = new Map<string, CoverTone>();

function hueFromKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 9973;
  }
  return COVER_HUES[hash % COVER_HUES.length] ?? 205;
}

function rgbToTone(r: number, g: number, b: number): CoverTone {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const light = (max + min) / 2;
  if (max === min) {
    return { hue: 215, sat: 8 };
  }
  const delta = max - min;
  const sat = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === rn) {
    hue = (gn - bn) / delta + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    hue = (bn - rn) / delta + 2;
  } else {
    hue = (rn - gn) / delta + 4;
  }
  return { hue: Math.round(hue * 60), sat: Math.round(sat * 100) };
}

/** 从图标像素里提取主色（忽略透明与近白背景） */
function extractIconTone(img: HTMLImageElement): CoverTone | null {
  try {
    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const pixels = ctx.getImageData(0, 0, size, size).data;

    let r = 0;
    let g = 0;
    let b = 0;
    let colored = 0;
    let gr = 0;
    let gg = 0;
    let gb = 0;
    let grayCount = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      if ((pixels[i + 3] ?? 255) < 200) continue;
      const pr = pixels[i] ?? 0;
      const pg = pixels[i + 1] ?? 0;
      const pb = pixels[i + 2] ?? 0;
      const max = Math.max(pr, pg, pb);
      const min = Math.min(pr, pg, pb);
      if (max >= 245 && min >= 235) continue;
      if (max - min < 10) {
        gr += pr;
        gg += pg;
        gb += pb;
        grayCount += 1;
        continue;
      }
      r += pr;
      g += pg;
      b += pb;
      colored += 1;
    }

    if (colored > 0) {
      return rgbToTone(r / colored, g / colored, b / colored);
    }
    if (grayCount > 0) {
      return rgbToTone(gr / grayCount, gg / grayCount, gb / grayCount);
    }
    return null;
  } catch {
    return null;
  }
}

/** 读取图标主色；未拿到前先用 key 兜底色相 */
function useCoverTone(pluginKey: string, iconUrl?: string): CoverTone {
  const [tone, setTone] = useState<CoverTone>(
    () =>
      (iconUrl ? iconToneCache.get(iconUrl) : undefined) ?? { hue: hueFromKey(pluginKey), sat: 55 }
  );

  useEffect(() => {
    if (!iconUrl) {
      setTone({ hue: hueFromKey(pluginKey), sat: 55 });
      return;
    }
    const cached = iconToneCache.get(iconUrl);
    if (cached) {
      setTone(cached);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const next = extractIconTone(img);
      if (!next) return;
      iconToneCache.set(iconUrl, next);
      if (!cancelled) setTone(next);
    };
    img.src = iconUrl;
    return () => {
      cancelled = true;
    };
  }, [iconUrl, pluginKey]);

  return tone;
}

function coverStyle(tone: CoverTone): CSSProperties {
  const hue = tone.hue;
  const sat = Math.min(82, Math.max(14, tone.sat));
  return {
    backgroundColor: `hsl(${hue} ${Math.round(sat * 0.5)}% 97%)`,
    backgroundImage: [
      `radial-gradient(78% 72% at 50% 46%, hsl(${hue} ${sat}% 68% / 0.9) 0%, hsl(${hue} ${sat}% 82% / 0.58) 52%, hsl(${hue} ${sat}% 96% / 0) 100%)`,
      'radial-gradient(50% 46% at 24% 12%, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0) 100%)',
    ].join(', '),
  };
}

function pluginPath(key: string) {
  return `/plugins/${encodeURIComponent(key)}`;
}

/** 推荐位使用的紧凑行卡片 */
export function PluginRowCard({ item }: { item: PluginStoreListItem }) {
  const { plugin, version, iconUrl, rating } = item;
  return (
    <Link
      to={pluginPath(plugin.pluginKey)}
      className="group -mx-2 flex min-w-0 items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-2/70"
    >
      <PluginIcon name={plugin.name} iconUrl={iconUrl} className="h-11 w-11 rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
            {plugin.name}
          </h3>
          {version.channel === 'theme' && (
            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">
              主题
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-ink-3">
          {plugin.author || plugin.ownerUsername}
        </p>
        <div className="mt-1.5">
          <RatingInline rating={rating} />
        </div>
      </div>
    </Link>
  );
}

/** “全部插件”区域的封面卡片 */
export function PluginCoverCard({ item }: { item: PluginStoreListItem }) {
  const { plugin, rating } = item;
  const tone = useCoverTone(plugin.pluginKey, item.iconUrl);
  return (
    <Link to={pluginPath(plugin.pluginKey)} className="group block min-w-0">
      <div className="overflow-hidden rounded-xl border border-line/70 bg-card shadow-sm transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-md">
        <div
          className="relative flex aspect-[7/6] items-center justify-center overflow-hidden"
          style={coverStyle(tone)}
        >
          <PluginIcon
            name={plugin.name}
            iconUrl={item.iconUrl}
            className="h-20 w-20 rounded-2xl text-3xl shadow-md transition-transform duration-300 group-hover:scale-105 sm:h-24 sm:w-24 sm:text-4xl"
          />
        </div>

        <div className="px-3 pt-2.5 pb-3">
          <p className="line-clamp-2 h-10 text-sm leading-5 font-semibold text-foreground transition-colors group-hover:text-primary">
            {plugin.name}
          </p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-ink-3">
              {plugin.author || plugin.ownerUsername}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink-2">
              {rating?.count ? (
                <>
                  {rating.score.toFixed(1)}
                  <Star className="h-3 w-3 fill-current text-[#f0a63a]" />
                </>
              ) : (
                <span className="font-normal text-ink-3">暂无评分</span>
              )}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
