import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { UserActivityDay } from '@/lib/types';

/** 活动类型 */
const ACTIVITY_LABELS: Record<string, string> = {
  lyric: '投稿歌词',
  daily: '每日推荐',
  search_ip: '歌词IP',
  review: '审核歌词',
};

/** 按当天总次数分档 */
function levelOf(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

/** 档位配色 */
const LEVEL_CLASS: Record<number, string> = {
  0: 'bg-surface-2',
  1: 'bg-green-200 dark:bg-green-900',
  2: 'bg-green-300 dark:bg-green-700',
  3: 'bg-green-500 dark:bg-green-600',
  4: 'bg-green-700 dark:bg-green-400',
};

const WEEKDAY_LABELS = ['一', '', '三', '', '五', '', '日'];
const MONTH_LABELS = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
];

interface Cell {
  date: string; // YYYY-MM-DD
  month: number; // 0-11
  day: number; // 1-31
  weekday: number; // 0=周一 … 6=周日
  week: number; // 列索引
  count: number;
  byType: Record<string, number>;
}

/** 构建「列=周、行=周几」的网格（周一为每行首），始终画满整年 */
function buildGrid(year: number, dayMap: Map<string, UserActivityDay>): Cell[][] {
  const cells: Cell[][] = [];
  const start = new Date(year, 0, 1);
  // 对齐到 1 月 1 日所在周的周一
  const startOffset = (start.getDay() + 6) % 7; // 周日=6 … 周一=0
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() - startOffset);

  let week: Cell[] = [];
  while (cursor.getFullYear() <= year) {
    const weekday = (cursor.getDay() + 6) % 7;
    const key = formatDate(cursor);
    const data = dayMap.get(key);
    const inYear = cursor.getFullYear() === year;
    week.push({
      date: key,
      month: cursor.getMonth(),
      day: cursor.getDate(),
      weekday,
      week: cells.length,
      count: inYear ? (data?.count ?? 0) : 0,
      byType: data?.byType ?? {},
    });
    if (weekday === 6) {
      cells.push(week);
      week = [];
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (week.length > 0) cells.push(week);
  return cells;
}

function formatDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 今天的 YYYY-MM-DD */
const TODAY_KEY = formatDate(new Date());

export interface ContributionWallProps {
  /** 当前登录用户名（用于 queryKey 隔离不同账号的缓存） */
  username: string;
}

/** 个人中心活动绿墙 */
export function ContributionWall({ username }: ContributionWallProps) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);

  const { data, isPending } = useQuery({
    queryKey: [...queryKeys.userActivity(year), username],
    queryFn: () => api.getUserActivity(year),
    staleTime: 60_000,
  });

  const dayMap = useMemo(() => {
    const m = new Map<string, UserActivityDay>();
    for (const d of data?.days ?? []) m.set(d.date, d);
    return m;
  }, [data]);

  const grid = useMemo(() => buildGrid(year, dayMap), [year, dayMap]);

  // 月份标签：每月第一格所在的列
  const monthMarks = useMemo(() => {
    const marks: { week: number; label: string }[] = [];
    let lastMonth = -1;
    for (const w of grid) {
      for (const c of w) {
        if (c.month !== lastMonth && c.day <= 7 && c.weekday === 0) {
          marks.push({ week: c.week, label: MONTH_LABELS[c.month] ?? '' });
          lastMonth = c.month;
        }
      }
    }
    return marks;
  }, [grid]);

  const years = data?.years?.length ? data.years : [thisYear];
  const CELL = 11; // 格子边长 px
  const GAP = 3; // 间距 px

  return (
    <div className="min-w-0">
      {/* 标题行 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-foreground">
            {data ? `${data.total} 次活动` : '活动记录'}
          </span>
          <span className="ml-2 text-xs text-ink-3">{year} 年</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={clsx(
                'rounded-md px-2.5 py-1 text-xs transition-colors',
                y === year
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface-2 text-ink-2 hover:text-foreground'
              )}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <div className="flex h-28 items-center justify-center text-sm text-ink-3">加载中…</div>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="inline-block min-w-full">
            {/* 月份标签行 */}
            <div className="relative ml-8 h-4" style={{ width: grid.length * (CELL + GAP) }}>
              {monthMarks.map((m) => (
                <span
                  key={`${m.label}-${m.week}`}
                  className="absolute top-0 text-[10px] text-ink-3"
                  style={{ left: m.week * (CELL + GAP) }}
                >
                  {m.label}
                </span>
              ))}
            </div>

            <div className="flex">
              {/* 周几标签列 */}
              <div
                className="mr-1 flex shrink-0 flex-col text-[10px] text-ink-3"
                style={{ height: 7 * (CELL + GAP) }}
              >
                {WEEKDAY_LABELS.map((label, i) => (
                  <span
                    key={i}
                    className="flex items-center"
                    style={{ height: CELL + GAP, width: 28 }}
                  >
                    {label}
                  </span>
                ))}
              </div>

              {/* 格子网格：列=周 */}
              <div className="flex" style={{ gap: GAP }}>
                {grid.map((week, wi) => (
                  <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
                    {week.map((cell) => (
                      <CellBox key={cell.date} cell={cell} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 图例 */}
      <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-ink-3">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((lv) => (
          <span
            key={lv}
            className={clsx('inline-block rounded-[3px]', LEVEL_CLASS[lv])}
            style={{ width: CELL, height: CELL }}
          />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

/** 单个格子 */
function CellBox({ cell }: { cell: Cell }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const level = levelOf(cell.count);
  const isFuture = cell.date > TODAY_KEY;

  const typeText = Object.entries(cell.byType)
    .map(([t, n]) => `${ACTIVITY_LABELS[t] ?? t} ×${n}`)
    .join('、');

  // 用fixed + portal 渲染，避免被 overflow-x-auto 的滚动容器裁剪
  const openTip = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 48; // 顶部空间不够就翻到下方
    setTip({
      top: below ? r.bottom + 6 : r.top - 6,
      left: Math.min(Math.max(r.left + r.width / 2, 8), window.innerWidth - 8),
      below,
    });
  };

  // 滚动时关闭，避免悬浮框脱离格子
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [tip]);

  return (
    <div
      ref={ref}
      className="relative"
      style={{ width: 11, height: 11 }}
      onMouseEnter={openTip}
      onMouseLeave={() => setTip(null)}
    >
      <span
        className={clsx('block h-full w-full rounded-[3px] transition-colors', LEVEL_CLASS[level])}
      />
      {tip &&
        !isFuture &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[999] w-max max-w-[240px] rounded-md border border-line bg-card px-2.5 py-1.5 text-xs text-foreground shadow-lg"
            style={{
              left: tip.left,
              top: tip.top,
              transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`,
            }}
            role="tooltip"
          >
            <div className="font-medium text-foreground">
              {cell.month + 1}月{cell.day}日 · {cell.count} 次
            </div>
            {typeText && <div className="mt-0.5 text-ink-3">{typeText}</div>}
          </div>,
          document.body
        )}
    </div>
  );
}
