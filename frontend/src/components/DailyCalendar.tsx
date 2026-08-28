import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { buttonTap } from '@/lib/motion';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 格式化日期为 YYYY-MM-DD */
function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface DayCell {
  date: Date;
  dateKey: string;
  isOtherMonth: boolean;
  isToday: boolean;
  hasRecommend: boolean;
  isSelected: boolean;
}

export function DailyCalendar({
  recommendDates,
  selectedDate,
  onSelectDate,
}: {
  recommendDates: Set<string>;
  selectedDate: string; // YYYY-MM-DD
  onSelectDate: (dateKey: string) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const todayKey = formatDateKey(today);
  const [currentMonth, setCurrentMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [direction, setDirection] = useState(0);

  const isNotToday = selectedDate !== todayKey;

  const cells = useMemo<DayCell[]>(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const firstDayWeek = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    // 构造单个日格。定义在 useMemo 内部，保证下方依赖数组完整
    const buildCell = (date: Date, isOtherMonth: boolean): DayCell => {
      const dateKey = formatDateKey(date);
      return {
        date,
        dateKey,
        isOtherMonth,
        isToday: dateKey === todayKey,
        hasRecommend: recommendDates.has(dateKey),
        isSelected: dateKey === selectedDate,
      };
    };

    const result: DayCell[] = [];

    for (let i = firstDayWeek - 1; i >= 0; i--) {
      const day = prevMonthLastDay - i;
      const date = new Date(year, month - 1, day);
      result.push(buildCell(date, true));
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      result.push(buildCell(date, false));
    }

    const remaining = 42 - result.length;
    for (let day = 1; day <= remaining; day++) {
      const date = new Date(year, month + 1, day);
      result.push(buildCell(date, true));
    }

    return result;
  }, [currentMonth, recommendDates, selectedDate, todayKey]);

  const goPrevMonth = () => {
    setDirection(-1);
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };

  const goNextMonth = () => {
    setDirection(1);
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  const goToday = () => {
    setDirection(0);
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    onSelectDate(todayKey);
  };

  const handleDayClick = (cell: DayCell) => {
    if (cell.isOtherMonth) {
      setDirection(cell.date > currentMonth ? 1 : -1);
      setCurrentMonth(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
    }
    onSelectDate(cell.dateKey);
  };

  // 月份切换动画变体
  const monthVariants = {
    enter: (dir: number) => ({
      opacity: 0,
      x: dir > 0 ? 20 : dir < 0 ? -20 : 0,
    }),
    center: {
      opacity: 1,
      x: 0,
    },
    exit: (dir: number) => ({
      opacity: 0,
      x: dir > 0 ? -20 : dir < 0 ? 20 : 0,
    }),
  };

  return (
    <div className="w-full max-w-[640px] min-w-[340px] rounded-lg border border-line bg-card p-6 shadow-sm max-md:max-w-full">
      {/* 头部：导航 + 月份 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <motion.button
          type="button"
          {...buttonTap}
          onClick={goPrevMonth}
          className="cursor-pointer rounded-md border border-line bg-transparent px-2.5 py-1 text-xs text-foreground transition-all hover:border-primary hover:bg-surface-2"
        >
          ←
        </motion.button>

        <div className="flex items-center gap-2">
          <AnimatePresence mode="wait">
            <motion.span
              key={`${currentMonth.getFullYear()}-${currentMonth.getMonth()}`}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2 }}
              className="text-base font-semibold text-foreground"
            >
              {currentMonth.getFullYear()}年{currentMonth.getMonth() + 1}月
            </motion.span>
          </AnimatePresence>

          {isNotToday && (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={goToday}
              className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground transition-all hover:opacity-90"
            >
              今天
            </motion.button>
          )}
        </div>

        <motion.button
          type="button"
          {...buttonTap}
          onClick={goNextMonth}
          className="cursor-pointer rounded-md border border-line bg-transparent px-2.5 py-1 text-xs text-foreground transition-all hover:border-primary hover:bg-surface-2"
        >
          →
        </motion.button>
      </div>

      {/* 星期表头 */}
      <div className="mb-1 grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-1 py-1.5 text-center text-xs font-semibold text-ink-2">
            {day}
          </div>
        ))}
      </div>

      {/* 日期网格 */}
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={`${currentMonth.getFullYear()}-${currentMonth.getMonth()}`}
          custom={direction}
          variants={monthVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
          className="grid grid-cols-7 gap-1.5"
        >
          {cells.map((cell, i) => {
            const base =
              'aspect-square flex items-center justify-center rounded-md border text-sm cursor-pointer transition-colors relative';
            let cls = base;
            if (cell.isOtherMonth) cls += ' text-ink-3 bg-muted/40 border-line/50 opacity-60';
            else cls += ' text-foreground bg-surface-2 border-line hover:border-primary';

            if (cell.isToday)
              cls += ' !bg-primary !text-primary-foreground !border-primary font-semibold';
            if (cell.hasRecommend && !cell.isToday) cls += ' !border-[#10b981] !text-[#065f46]';
            if (cell.isSelected && !cell.isToday)
              cls += ' !border-primary !bg-primary/10 font-semibold';

            return (
              <motion.div
                key={i}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.12 }}
                className={cls}
                onClick={() => handleDayClick(cell)}
              >
                {cell.date.getDate()}
                {cell.hasRecommend && !cell.isToday && (
                  <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[#10b981]" />
                )}
              </motion.div>
            );
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
