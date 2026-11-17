import { CALENDAR_DAY_HEIGHT_PX } from './calendar-panel.const';
import { CalendarDayItem, CalendarTimeStep } from './calendar-panel.model';
import { snapMinutes } from './calendar-day.util';

const minutesInDay = 24 * 60;

export const yToMinutes = (yPx: number, scaleHeightPx = CALENDAR_DAY_HEIGHT_PX): number =>
  (yPx / scaleHeightPx) * minutesInDay;

export const minutesToY = (
  minutes: number,
  scaleHeightPx = CALENDAR_DAY_HEIGHT_PX,
): number => (minutes / minutesInDay) * scaleHeightPx;

/** Хвилини на шкалі з урахуванням прокрутки; результат прив'язаний до кроку. */
export const minutesFromScaleY = (
  clientY: number,
  scaleTop: number,
  scrollTop: number,
  step: CalendarTimeStep,
  scaleHeightPx = CALENDAR_DAY_HEIGHT_PX,
): number => {
  const visibleY = clientY - scaleTop;
  const y = visibleY + scrollTop;
  return snapMinutes(yToMinutes(y, scaleHeightPx), step);
};

/**
 * Новий початок блока після вертикального перетягування.
 * Прив'язка до кроку; блок не виходить за межі логічного дня.
 */
export const snapDragStartMinutes = (
  originalStartMinutes: number,
  deltaYPx: number,
  step: CalendarTimeStep,
  durationMinutes: number,
  scaleHeightPx = CALENDAR_DAY_HEIGHT_PX,
): number => {
  const raw = originalStartMinutes + yToMinutes(deltaYPx, scaleHeightPx);
  const snapped = snapMinutes(raw, step);
  const lastStart = minutesInDay - durationMinutes;
  const lastOnStep = Math.floor(lastStart / step) * step;
  return Math.max(0, Math.min(snapped, lastOnStep));
};

/**
 * Нова тривалість після розтягування нижнього краю.
 * Мінімум і крок — поточний крок шкали; кінець не пізніше кінця дня.
 */
export const snapResizeDurationMinutes = (
  originalDurationMinutes: number,
  deltaYPx: number,
  step: CalendarTimeStep,
  startMinutes: number,
  scaleHeightPx = CALENDAR_DAY_HEIGHT_PX,
): number => {
  const raw = originalDurationMinutes + yToMinutes(deltaYPx, scaleHeightPx);
  const snapped = Math.max(step, Math.round(raw / step) * step);
  const maxDur = minutesInDay - startMinutes;
  const lastOnStep = Math.floor(maxDur / step) * step;
  const cap = lastOnStep >= step ? lastOnStep : step;
  return Math.max(step, Math.min(snapped, cap));
};

/** Ідентифікатори блоків, що перетинаються за часом (дотик краями — не перетин). */
export const markOverlappingIds = (
  items: readonly CalendarDayItem[],
): ReadonlySet<string> => {
  const ids = new Set<string>();
  const timed = items.filter((item) => item.startMs != null);
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i];
    const aEnd = (a.startMs as number) + a.durationMs;
    for (let j = i + 1; j < timed.length; j++) {
      const b = timed[j];
      const bEnd = (b.startMs as number) + b.durationMs;
      if ((a.startMs as number) < bEnd && (b.startMs as number) < aEnd) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return ids;
};

export const durationMsFromMinutes = (minutes: number): number => minutes * 60 * 1000;

export const minutesFromMs = (ms: number): number => ms / 60000;

/** Чи змінилось збережене значення (без зайвої операції при drop на те саме місце). */
export const isSameTimedDrop = (
  startMs: number,
  durationMs: number,
  nextStartMs: number,
  nextDurationMs: number,
): boolean => startMs === nextStartMs && durationMs === nextDurationMs;

export const MINUTES_IN_DAY = minutesInDay;
