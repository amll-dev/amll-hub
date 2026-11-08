export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export const MONTHS = [
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

/** 格式化日期为 YYYY-MM-DD */
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface MonthDayCell {
  date: Date;
  dateKey: string;
  isOtherMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

/** 构造月份日期网格（固定 42 格，含上/下月补位） */
export function buildMonthCells(
  year: number,
  month: number,
  todayKey: string,
  selectedKey: string
): MonthDayCell[] {
  const firstDayWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthLastDay = new Date(year, month, 0).getDate();

  const buildCell = (date: Date, isOtherMonth: boolean): MonthDayCell => {
    const dateKey = formatDateKey(date);
    return {
      date,
      dateKey,
      isOtherMonth,
      isToday: dateKey === todayKey,
      isSelected: dateKey === selectedKey,
    };
  };

  const result: MonthDayCell[] = [];
  for (let i = firstDayWeek - 1; i >= 0; i--) {
    result.push(buildCell(new Date(year, month - 1, prevMonthLastDay - i), true));
  }
  for (let day = 1; day <= daysInMonth; day++) {
    result.push(buildCell(new Date(year, month, day), false));
  }
  const remaining = 42 - result.length;
  for (let day = 1; day <= remaining; day++) {
    result.push(buildCell(new Date(year, month + 1, day), true));
  }
  return result;
}
