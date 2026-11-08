import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { buttonTap } from '@/lib/motion';
import {
  WEEKDAYS,
  MONTHS,
  buildMonthCells,
  formatDateKey,
  type MonthDayCell as DayCell,
} from '@/lib/date';
import { cn } from '@/lib/utils';

function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 把手动输入的日期文本规范化为 YYYY-MM-DD；无法识别或日期不存在时返回 null */
function normalizeDateInput(raw: string): string | null {
  const text = raw.trim();
  if (!text) return '';
  const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  // 排除 2 月 30 日这类不存在的日期
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return formatDateKey(date);
}

/** 输入框里只保留数字并按 YYYY-MM-DD 自动补「-」，避免分隔符被删掉 */
function formatDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder = '选择日期',
  max,
  id,
  className,
  allowInput = false,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: {
  value: string;
  onChange: (dateKey: string) => void;
  placeholder?: string;
  /** 可选上限（含当天），YYYY-MM-DD；超出范围的日子不可点 */
  max?: string;
  id?: string;
  /** 触发器附加样式 */
  className?: string;
  /** 允许直接键入日期（YYYY-MM-DD、YYYY/M/D 等），默认只能通过日历选择 */
  allowInput?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
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
  /** 输入框里的原始文本（仅 allowInput 时使用） */
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  /** 日历面板视图：日期网格 / 年份快速选择 */
  const [view, setView] = useState<'day' | 'year'>('day');
  /** 年份网格的起始年份（一页 12 年） */
  const [yearPageStart, setYearPageStart] = useState(
    () => Math.floor(currentMonth.getFullYear() / 12) * 12
  );
  /** 年份翻页方向：1 下一页，-1 上一页 */
  const [yearDirection, setYearDirection] = useState(0);

  const goPrevYearPage = () => {
    setYearDirection(-1);
    setYearPageStart((s) => s - 12);
  };
  const goNextYearPage = () => {
    setYearDirection(1);
    setYearPageStart((s) => s + 12);
  };

  // 关闭日历后回到日期视图
  useEffect(() => {
    if (!open) setView('day');
  }, [open]);

  // 外部（日历点选、表单重置）改动 value 时同步输入框；编辑中不打断用户输入
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

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

  const cells = useMemo<DayCell[]>(
    () => buildMonthCells(currentMonth.getFullYear(), currentMonth.getMonth(), todayKey, value),
    [currentMonth, value, todayKey]
  );

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

  /** 提交手动输入：合法则回写，非法（含超出 max）则回退到当前已选日期 */
  const commitDraft = () => {
    const key = normalizeDateInput(draft);
    if (key === null || (key !== '' && max && key > max)) {
      setDraft(value);
      return;
    }
    setDraft(key);
    if (key !== value) onChange(key);
    if (key) {
      const date = parseDateKey(key);
      if (date) setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
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
      {/* 触发区：可手动输入时用输入框，右侧图标打开日历 */}
      {allowInput ? (
        <div
          className={cn(
            'flex h-11 w-full items-center gap-2 rounded-md border bg-background px-4 text-sm outline-none transition-all duration-200',
            open
              ? 'border-primary ring-2 ring-primary/20'
              : 'border-input hover:border-primary/50 focus-within:border-primary',
            ariaInvalid && 'border-error',
            className
          )}
        >
          <input
            id={id}
            type="text"
            autoComplete="off"
            value={draft}
            placeholder={placeholder}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            onChange={(e) => {
              // 粘贴完整日期时直接规范化；其余情况按数字重新拼「-」，分隔符不可被单独删除
              const key = normalizeDateInput(e.target.value);
              setDraft(key ?? formatDateInput(e.target.value));
            }}
            onFocus={() => setEditing(true)}
            onBlur={() => {
              setEditing(false);
              commitDraft();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // 提交日期而不是触发表单提交
                e.preventDefault();
                commitDraft();
                setOpen(false);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            aria-label="打开日历"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0"
          >
            <CalendarDays
              className={`h-4 w-4 text-ink-3 transition-transform duration-200 ${
                open ? 'scale-110 text-primary' : ''
              }`}
            />
          </button>
        </div>
      ) : (
        <button
          type="button"
          id={id}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex h-11 w-full items-center justify-between rounded-md border bg-background px-4 text-sm outline-none transition-all duration-200',
            open
              ? 'border-primary ring-2 ring-primary/20'
              : 'border-input hover:border-primary/50 focus:border-primary',
            ariaInvalid && 'border-error',
            className
          )}
        >
          <span className={selectedDate ? 'text-foreground' : 'text-ink-3'}>{displayText}</span>
          <CalendarDays
            className={`h-4 w-4 text-ink-3 transition-transform duration-200 ${
              open ? 'scale-110 text-primary' : ''
            }`}
          />
        </button>
      )}

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
                onClick={view === 'day' ? goPrev : goPrevYearPage}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:border-primary hover:bg-surface-2"
              >
                <ChevronLeft className="h-4 w-4" />
              </motion.button>

              <div className="relative flex items-center justify-center">
                <AnimatePresence mode="wait" initial={false}>
                  {view === 'day' ? (
                    <motion.div
                      key="month"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
                      className="flex items-center gap-2"
                    >
                      <motion.button
                        type="button"
                        title="快速切换年份"
                        onClick={() => {
                          const year = currentMonth.getFullYear();
                          setYearPageStart(Math.floor(year / 12) * 12);
                          setView('year');
                        }}
                        className="flex items-center gap-1 rounded px-1 py-0.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 hover:text-primary"
                      >
                        <AnimatePresence mode="wait">
                          <motion.span
                            key={`${currentMonth.getFullYear()}-${currentMonth.getMonth()}`}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 4 }}
                            transition={{ duration: 0.2 }}
                          >
                            {currentMonth.getFullYear()}年{MONTHS[currentMonth.getMonth()]}
                          </motion.span>
                        </AnimatePresence>
                        <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
                      </motion.button>
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
                    </motion.div>
                  ) : (
                    <motion.div
                      key="year"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={yearPageStart}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="block text-sm font-semibold text-foreground"
                        >
                          {yearPageStart}–{yearPageStart + 11}年
                        </motion.span>
                      </AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <motion.button
                type="button"
                {...buttonTap}
                onClick={view === 'day' ? goNext : goNextYearPage}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:border-primary hover:bg-surface-2"
              >
                <ChevronRight className="h-4 w-4" />
              </motion.button>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {view === 'year' ? (
                <motion.div
                  key="year"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <AnimatePresence mode="wait" initial={false} custom={yearDirection}>
                    <motion.div
                      key={yearPageStart}
                      custom={yearDirection}
                      variants={monthVariants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                      className="grid grid-cols-4 gap-1"
                    >
                      {Array.from({ length: 12 }, (_, i) => yearPageStart + i).map((year) => {
                        const isCurrent = year === currentMonth.getFullYear();
                        // 整年都在上限之后才禁用，当年仍可选（月内日期会按 max 单独禁用）
                        const disabled = !!max && `${year}-12-31` > max;
                        return (
                          <motion.button
                            key={year}
                            type="button"
                            disabled={disabled}
                            whileHover={disabled ? undefined : { scale: 1.05 }}
                            whileTap={disabled ? undefined : { scale: 0.95 }}
                            transition={{ duration: 0.12 }}
                            onClick={() => {
                              setCurrentMonth(new Date(year, currentMonth.getMonth(), 1));
                              setView('day');
                            }}
                            className={cn(
                              'flex h-10 items-center justify-center rounded-md text-xs transition-colors',
                              isCurrent
                                ? '!bg-[#fef3c7] !text-[#92400e] font-semibold ring-1 ring-[#f59e0b]'
                                : 'text-foreground hover:bg-surface-2',
                              disabled && 'cursor-not-allowed opacity-25'
                            )}
                          >
                            {year}
                          </motion.button>
                        );
                      })}
                    </motion.div>
                  </AnimatePresence>
                </motion.div>
              ) : (
                <motion.div
                  key="day"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  {/* 星期表头 */}
                  <div className="mb-1 grid grid-cols-7 gap-1">
                    {WEEKDAYS.map((d) => (
                      <div
                        key={d}
                        className="py-1 text-center text-[11px] font-semibold text-ink-3"
                      >
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* 日期网格 */}
                  <AnimatePresence mode="wait" initial={false} custom={direction}>
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
                        const disabled = !!max && cell.dateKey > max;
                        let cls =
                          'aspect-square flex items-center justify-center rounded-md text-xs cursor-pointer transition-colors';
                        if (cell.isOtherMonth) cls += ' text-ink-3 opacity-40';
                        else cls += ' text-foreground hover:bg-surface-2';
                        if (cell.isToday)
                          cls += ' !bg-primary !text-primary-foreground font-semibold';
                        if (cell.isSelected && !cell.isToday)
                          cls +=
                            ' !bg-[#fef3c7] !text-[#92400e] font-semibold ring-1 ring-[#f59e0b]';
                        if (disabled) cls += ' pointer-events-none opacity-25';

                        return (
                          <motion.div
                            key={i}
                            whileHover={disabled ? undefined : { scale: 1.1 }}
                            whileTap={disabled ? undefined : { scale: 0.9 }}
                            transition={{ duration: 0.12 }}
                            className={cls}
                            onClick={disabled ? undefined : () => handleSelect(cell)}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
