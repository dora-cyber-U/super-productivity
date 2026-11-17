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

export const snapMinutes = (minutesFromStart: number, step: CalendarTimeStep): number => {
  const minutesInDay = 24 * 60;
  const last = minutesInDay - step;
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
      if (isTodayWithOffset(task.dueWithTime, day, startOfNextDayDiffMs || 0)) {
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
        durationMs: 0,
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
}

/** Розміщує блоки на шкалі; перетини розкладає в сусідні колонки. */
export const layoutTimedBlocks = (
  items: readonly CalendarDayItem[],
  dayStartMs: number,
  totalHeightPx: number,
): CalendarBlockLayout[] => {
  const raw = items.map((item) => {
    const start = (item.startMs as number) - dayStartMs;
    return {
      item,
      start,
      end: start + item.durationMs,
      top: (start / CALENDAR_DAY_MS) * totalHeightPx,
      height: Math.max(18, (item.durationMs / CALENDAR_DAY_MS) * totalHeightPx),
      col: 0,
      cols: 1,
    };
  });

  const colEnds: number[] = [];
  for (const ev of raw) {
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
      raw[i].cols = cols;
    }
  };
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].start >= clusterEnd) {
      flush(i);
      clusterFrom = i;
      clusterMax = raw[i].col;
      clusterEnd = raw[i].end;
    } else {
      clusterMax = Math.max(clusterMax, raw[i].col);
      clusterEnd = Math.max(clusterEnd, raw[i].end);
    }
  }
  flush(raw.length);
  return raw;
};
