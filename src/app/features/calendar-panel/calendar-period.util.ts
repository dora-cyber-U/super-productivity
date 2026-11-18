import { DEFAULT_FIRST_DAY_OF_WEEK } from '../../core/locale.constants';
import { getDbDateStr } from '../../util/get-db-date-str';
import { CalendarDayView, CalendarViewMode } from './calendar-panel.model';
import { isSameCalendarDayView } from './calendar-day.util';
import {
  logicalDayDurationMs,
  logicalDayStartMs,
  shiftDayStr,
} from './calendar-day.util';

/** Нормалізує firstDayOfWeek (0 = неділя); порожнє чи відʼємне — понеділок. */
export const resolveFirstDayOfWeek = (value: number | null | undefined): number =>
  typeof value === 'number' && value >= 0 ? value % 7 : DEFAULT_FIRST_DAY_OF_WEEK;

/** Понеділок (або інший firstDay) тижня, що містить day. Через полудень, DST-безпечно. */
export const weekStartDay = (
  day: string,
  firstDayOfWeek: number = DEFAULT_FIRST_DAY_OF_WEEK,
): string => {
  const date = new Date(`${day}T12:00:00`);
  const first = resolveFirstDayOfWeek(firstDayOfWeek);
  const shift = (date.getDay() - first + 7) % 7;
  return shiftDayStr(day, -shift);
};

/** Сім дат YYYY-MM-DD тижня, що містить day. */
export const weekDays = (
  day: string,
  firstDayOfWeek: number = DEFAULT_FIRST_DAY_OF_WEEK,
): string[] => {
  const start = weekStartDay(day, firstDayOfWeek);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(shiftDayStr(start, i));
  }
  return days;
};

/** Зсув на цілі тижні, зберігаючи день тижня. */
export const shiftWeekStr = (day: string, deltaWeeks: number): string =>
  shiftDayStr(day, deltaWeeks * 7);

/**
 * Зсув на місяці: той самий день місяця, або останній день цільового місяця.
 * Локальний полудень, без зсуву на ±1 день під час DST.
 */
export const shiftMonthStr = (day: string, deltaMonths: number): string => {
  const parts = day.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const date = parts[2];
  const cursor = new Date(year, month - 1 + deltaMonths, 1, 12, 0, 0);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  cursor.setDate(date < last ? date : last);
  return getDbDateStr(cursor);
};

/**
 * Сітка місяця: повні тижні від weekStart першого числа до тижня з останнім.
 * Завжди кратна 7 (4–6 рядків).
 */
export const monthGridDays = (
  day: string,
  firstDayOfWeek: number = DEFAULT_FIRST_DAY_OF_WEEK,
): string[] => {
  const parts = day.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const first = `${monthPrefix}-01`;
  const lastDate = new Date(year, month, 0).getDate();
  const last = `${monthPrefix}-${String(lastDate).padStart(2, '0')}`;
  const days: string[] = [];
  let cursor = weekStartDay(first, firstDayOfWeek);
  while (cursor <= last || days.length % 7 !== 0) {
    days.push(cursor);
    cursor = shiftDayStr(cursor, 1);
    if (days.length >= 42) {
      break;
    }
  }
  return days;
};

export const isSameMonth = (a: string, b: string): boolean =>
  a.slice(0, 7) === b.slice(0, 7);

/** Чи видимий період (день/тиждень/місяць від якоря) містить target. */
export const periodContainsDay = (
  anchor: string,
  target: string,
  mode: CalendarViewMode,
  firstDayOfWeek: number = DEFAULT_FIRST_DAY_OF_WEEK,
): boolean => {
  if (mode === 'day') {
    return anchor === target;
  }
  if (mode === 'month') {
    return isSameMonth(anchor, target);
  }
  const days = weekDays(anchor, firstDayOfWeek);
  return days.includes(target);
};

/** Різниця календарних днів YYYY-MM-DD (UTC-дата, без DST-зсуву). */
const calendarDayDelta = (fromDay: string, toDay: string): number => {
  const [fy, fm, fd] = fromDay.split('-').map(Number);
  const [ty, tm, td] = toDay.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
};

/**
 * Переносить dueWithTime на інший логічний день, зберігаючи годину і хвилину.
 * Зсуваємо календарну дату задачі на (toDay − fromDay), а не ставимо toDay
 * напряму: час після півночі при startOfNextDay≠0 належить попередньому
 * логічному дню (01:30 при старті о 04:00 → наступна календарна дата).
 * Clamp лише якщо результат випав за межі логічної доби (неіснуючий час).
 */
export const moveDueWithTimeToDay = (
  dueWithTime: number,
  fromDay: string,
  toDay: string,
  startOfNextDayDiffMs: number,
): number => {
  const toStart = logicalDayStartMs(toDay, startOfNextDayDiffMs);
  const toDuration = logicalDayDurationMs(toDay, startOfNextDayDiffMs);
  const maxMs = toStart + Math.max(0, toDuration - 1);
  const moved = new Date(dueWithTime);
  const deltaDays = calendarDayDelta(fromDay, toDay);
  if (deltaDays !== 0) {
    moved.setDate(moved.getDate() + deltaDays);
  }
  const ms = moved.getTime();
  if (!Number.isFinite(ms)) {
    return toStart;
  }
  if (ms < toStart) {
    return toStart;
  }
  if (ms > maxMs) {
    return maxMs;
  }
  return ms;
};

export const isSameCalendarPeriodView = (
  a: CalendarDayView[],
  b: CalendarDayView[],
): boolean =>
  a.length === b.length && a.every((day, i) => isSameCalendarDayView(day, b[i]));
