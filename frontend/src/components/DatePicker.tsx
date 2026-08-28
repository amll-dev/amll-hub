import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { buttonTap } from '@/lib/motion';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = [
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

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

interface DayCell {
  date: Date;
  dateKey: string;
  isOtherMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

export function DatePicker({
  value,
  onChange,
  placeholder = '选择日期',
}: {
  value: string;
  onChange: (dateKey: string) => void;
  placeholder?: string;
}) {
  const today = useMemo(() => new Date(), []);
  const todayKey = formatDateKey(today);
  const selectedDate = parseDateKey(value);
  const [open, setOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(
    selectedDate
      ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
      : new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [direction, setDirection] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const cells = useMemo<DayCell[]>(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDayWeek = new Date(year, month, 1).getDay();
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
        isSelected: dateKey === value,
      };
    };

    const result: DayCell[] = [];

    for (let i = firstDayWeek - 1; i >= 0; i--) {
      const date = new Date(year, month - 1, prevMonthLastDay - i);
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
  }, [currentMonth, value, todayKey]);

  const goPrev = () => {
    setDirection(-1);
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };
  const goNext = () => {
    setDirection(1);
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };
  const goToday = () => {
    setDirection(0);
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    onChange(todayKey);
  };

  const handleSelect = (cell: DayCell) => {
    if (cell.isOtherMonth) {
      setDirection(cell.date > currentMonth ? 1 : -1);
      setCurrentMonth(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
    }
    onChange(cell.dateKey);
    setOpen(false);
  };

  const monthVariants = {
    enter: (dir: number) => ({
      opacity: 0,
      x: dir > 0 ? 16 : dir < 0 ? -16 : 0,
    }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({
      opacity: 0,
      x: dir > 0 ? -16 : dir < 0 ? 16 : 0,
    }),
  };

  // 按钮显示文字
  const displayText = selectedDate
    ? `${selectedDate.getFullYear()}年${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`
    : placeholder;

  return (
    <div ref={containerRef} className="relative">
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-11 w-full items-center justify-between rounded-md border bg-background px-4 text-sm outline-none transition-all duration-200 ${
          open
            ? 'border-primary ring-2 ring-primary/20'
            : 'border-input hover:border-primary/50 focus:border-primary'
        }`}
      >
        <span className={selectedDate ? 'text-foreground' : 'text-ink-3'}>{displayText}</span>
        <CalendarDays
          className={`h-4 w-4 text-ink-3 transition-transform duration-200 ${
            open ? 'scale-110 text-primary' : ''
          }`}
        />
      </button>

      {/* 下拉日历 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute z-50 mt-2 w-[320px] rounded-lg border border-line bg-card p-3 shadow-lg"
          >
            {/* 头部 */}
            <div className="mb-3 flex items-center justify-between">
              <motion.button
                type="button"
                {...buttonTap}
                onClick={goPrev}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:border-primary hover:bg-surface-2"
              >
                <ChevronLeft className="h-4 w-4" />
              </motion.button>

              <div className="flex items-center gap-2">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={`${currentMonth.getFullYear()}-${currentMonth.getMonth()}`}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.2 }}
                    className="text-sm font-semibold text-foreground"
                  >
                    {currentMonth.getFullYear()}年{MONTHS[currentMonth.getMonth()]}
                  </motion.span>
                </AnimatePresence>
                {value !== todayKey && (
                  <motion.button
                    type="button"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={goToday}
                    className="rounded bg-primary px-2 py-0.5 text-[11px] text-primary-foreground hover:opacity-90"
                  >
                    今天
                  </motion.button>
                )}
              </div>

              <motion.button
                type="button"
                {...buttonTap}
                onClick={goNext}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:border-primary hover:bg-surface-2"
              >
                <ChevronRight className="h-4 w-4" />
              </motion.button>
            </div>

            {/* 星期表头 */}
            <div className="mb-1 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1 text-center text-[11px] font-semibold text-ink-3">
                  {d}
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
                transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                className="grid grid-cols-7 gap-1"
              >
                {cells.map((cell, i) => {
                  let cls =
                    'aspect-square flex items-center justify-center rounded-md text-xs cursor-pointer transition-colors';
                  if (cell.isOtherMonth) cls += ' text-ink-3 opacity-40';
                  else cls += ' text-foreground hover:bg-surface-2';
                  if (cell.isToday) cls += ' !bg-primary !text-primary-foreground font-semibold';
                  if (cell.isSelected && !cell.isToday)
                    cls += ' !bg-[#fef3c7] !text-[#92400e] font-semibold ring-1 ring-[#f59e0b]';

                  return (
                    <motion.div
                      key={i}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ duration: 0.12 }}
                      className={cls}
                      onClick={() => handleSelect(cell)}
                    >
                      {cell.date.getDate()}
                    </motion.div>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
