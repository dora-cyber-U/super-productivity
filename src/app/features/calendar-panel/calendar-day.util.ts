import { getDbDateStr } from '../../util/get-db-date-str';
import { isTodayWithOffset } from '../../util/is-today.util';
import { Task } from '../tasks/task.model';
import {
  CALENDAR_DAY_DEFAULT_BLOCK_MS,
  CALENDAR_DAY_MS,
  CALENDAR_TIME_STEPS,
} from './calendar-panel.const';
import {
  CalendarDayItem,
  CalendarDayView,
  CalendarTimeStep,
} from './calendar-panel.model';

export const isCalendarTimeStep = (value: unknown): value is CalendarTimeStep =>
  typeof value === 'number' && (CALENDAR_TIME_STEPS as readonly number[]).includes(value);

/** Зсув YYYY-MM-DD на кілька календарних днів (через полудень, щоб не зловити DST). */
export const shiftDayStr = (day: string, deltaDays: number): string => {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return getDbDateStr(date);
};

/**
 * Початок логічного дня в SP: опівніч дати + startOfNextDay.
 * Якщо день починається о 5:00, шкала йде з 05:00 до 05:00 наступної дати.
 */
export const logicalDayStartMs = (day: string, startOfNextDayDiffMs: number): number =>
  new Date(`${day}T00:00:00`).getTime() + (startOfNextDayDiffMs || 0);

/** Тривалість логічного дня в мс (23/24/25 год під час DST). */
export const logicalDayDurationMs = (
  day: string,
  startOfNextDayDiffMs: number,
): number => {
  const start = logicalDayStartMs(day, startOfNextDayDiffMs);
  const next = logicalDayStartMs(shiftDayStr(day, 1), startOfNextDayDiffMs);
  const duration = next - start;
  return duration > 0 ? duration : CALENDAR_DAY_MS;
};

export const logicalDayDurationMinutes = (
  day: string,
  startOfNextDayDiffMs: number,
): number => logicalDayDurationMs(day, startOfNextDayDiffMs) / 60000;

/** Відсіює пошкоджений dueWithTime (0, від'ємний, NaN), щоб не кидати з селектора. */
export const isValidDueWithTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const snapMinutes = (
  minutesFromStart: number,
  step: CalendarTimeStep,
  dayLengthMinutes?: number,
): number => {
  const minutesInDay =
    dayLengthMinutes && dayLengthMinutes > 0 ? dayLengthMinutes : 24 * 60;
  const last = Math.max(0, minutesInDay - step);
  const snapped = Math.round(minutesFromStart / step) * step;
  return Math.max(0, Math.min(last, snapped));
};

export const minutesToTimestamp = (
  day: string,
  startOfNextDayDiffMs: number,
  minutes: number,
): number => {
  const offsetMs = minutes * 60 * 1000;
  return logicalDayStartMs(day, startOfNextDayDiffMs) + offsetMs;
};

const displayDurationMs = (timeEstimate: number): number =>
  timeEstimate > 0 ? timeEstimate : CALENDAR_DAY_DEFAULT_BLOCK_MS;

/**
 * Розкладає задачі дня: dueWithTime — на шкалу (пріоритет над dueDay),
 * dueDay без часу — у секцію all-day.
 */
export const buildCalendarDayView = (
  tasks: readonly Task[],
  day: string,
  startOfNextDayDiffMs: number,
): CalendarDayView => {
  const allDay: CalendarDayItem[] = [];
  const timed: CalendarDayItem[] = [];
  for (const task of tasks) {
    if (!task) {
      continue;
    }
    if (typeof task.dueWithTime === 'number') {
      // Пошкоджений час пропускаємо: isTodayWithOffset кидає на 0 / NaN / <0
      if (
        isValidDueWithTime(task.dueWithTime) &&
        isTodayWithOffset(task.dueWithTime, day, startOfNextDayDiffMs || 0)
      ) {
        timed.push({
          id: task.id,
          title: task.title,
          isDone: task.isDone,
          startMs: task.dueWithTime,
          durationMs: displayDurationMs(task.timeEstimate),
        });
      }
      continue;
    }
    if (task.dueDay === day) {
      allDay.push({
        id: task.id,
        title: task.title,
        isDone: task.isDone,
        startMs: null,
        // фактична оцінка (0, якщо немає) — для переносу на шкалу без перезапису кроком
        durationMs: task.timeEstimate || 0,
      });
    }
  }
  allDay.sort((a, b) => a.title.localeCompare(b.title));
  timed.sort(
    (a, b) =>
      (a.startMs as number) - (b.startMs as number) || a.durationMs - b.durationMs,
  );
  return { day, allDay, timed };
};

const isSameItem = (a: CalendarDayItem, b: CalendarDayItem): boolean =>
  a.id === b.id &&
  a.title === b.title &&
  a.isDone === b.isDone &&
  a.startMs === b.startMs &&
  a.durationMs === b.durationMs;

export const isSameCalendarDayView = (a: CalendarDayView, b: CalendarDayView): boolean =>
  a.day === b.day &&
  a.allDay.length === b.allDay.length &&
  a.timed.length === b.timed.length &&
  a.allDay.every((item, i) => isSameItem(item, b.allDay[i])) &&
  a.timed.every((item, i) => isSameItem(item, b.timed[i]));

export interface CalendarBlockLayout {
  item: CalendarDayItem;
  top: number;
  height: number;
  col: number;
  cols: number;
  /** Відрізок у мс від початку дня, уже обрізаний до меж дня. */
  start: number;
  end: number;
  /**
   * Смуга на тлі: блок довший за добу або обрізаний на всю шкалу.
   * Не бере участі в розкладці колонок, щоб не звужувати інші блоки.
   */
  isBand: boolean;
}

/** Блок на всю видиму добу або з оцінкою, не коротшою за цю добу. */
const isFullSpanBlock = (
  durationMs: number,
  start: number,
  end: number,
  dayDurationMs: number,
): boolean => durationMs >= dayDurationMs || (start === 0 && end === dayDurationMs);

/** Розміщує блоки на шкалі; перетини розкладає в сусідні колонки. */
export const layoutTimedBlocks = (
  items: readonly CalendarDayItem[],
  dayStartMs: number,
  totalHeightPx: number,
  dayDurationMs: number = CALENDAR_DAY_MS,
): CalendarBlockLayout[] => {
  const durationMs = dayDurationMs > 0 ? dayDurationMs : CALENDAR_DAY_MS;
  const bands: CalendarBlockLayout[] = [];
  const packed: CalendarBlockLayout[] = [];
  for (const item of items) {
    const rawStart = (item.startMs as number) - dayStartMs;
    const rawEnd = rawStart + item.durationMs;
    const start = Math.max(0, rawStart);
    const end = Math.min(durationMs, rawEnd);
    if (end <= start) {
      continue;
    }
    const span = end - start;
    const block: CalendarBlockLayout = {
      item,
      start,
      end,
      top: (start / durationMs) * totalHeightPx,
      height: Math.max(18, (span / durationMs) * totalHeightPx),
      col: 0,
      cols: 1,
      isBand: isFullSpanBlock(item.durationMs, start, end, durationMs),
    };
    if (block.isBand) {
      bands.push(block);
    } else {
      packed.push(block);
    }
  }

  const colEnds: number[] = [];
  for (const ev of packed) {
    let col = colEnds.findIndex((end) => ev.start >= end);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(ev.end);
    } else {
      colEnds[col] = ev.end;
    }
    ev.col = col;
  }

  let clusterFrom = 0;
  let clusterMax = 0;
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const flush = (to: number): void => {
    const cols = clusterMax + 1;
    for (let i = clusterFrom; i < to; i++) {
      packed[i].cols = cols;
    }
  };
  for (let i = 0; i < packed.length; i++) {
    if (packed[i].start >= clusterEnd) {
      flush(i);
      clusterFrom = i;
      clusterMax = packed[i].col;
      clusterEnd = packed[i].end;
    } else {
      clusterMax = Math.max(clusterMax, packed[i].col);
      clusterEnd = Math.max(clusterEnd, packed[i].end);
    }
  }
  flush(packed.length);
  return [...bands, ...packed];
};
