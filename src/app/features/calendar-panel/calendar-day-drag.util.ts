import { CALENDAR_DAY_HEIGHT_PX } from './calendar-panel.const';
import { CalendarDayItem, CalendarTimeStep } from './calendar-panel.model';
import { snapMinutes } from './calendar-day.util';

const DEFAULT_DAY_MINUTES = 24 * 60;

const dayMinutes = (dayLengthMinutes?: number): number =>
  dayLengthMinutes && dayLengthMinutes > 0 ? dayLengthMinutes : DEFAULT_DAY_MINUTES;

export const yToMinutes = (
  yPx: number,
  scaleHeightPx = CALENDAR_DAY_HEIGHT_PX,
  dayLengthMinutes?: number,
): number => (yPx / scaleHeightPx) * dayMinutes(dayLengthMinutes);

export const minutesToY = (
  minutes: number,
  scaleHeightPx = CALENDAR_DAY_HEIGHT_PX,
  dayLengthMinutes?: number,
): number => (minutes / dayMinutes(dayLengthMinutes)) * scaleHeightPx;

/** Хвилини на шкалі з урахуванням прокрутки; результат прив'язаний до кроку. */
export const minutesFromScaleY = (
  clientY: number,
  scaleTop: number,
  scrollTop: number,
  step: CalendarTimeStep,
  scaleHeightPx = CALENDAR_DAY_HEIGHT_PX,
  dayLengthMinutes?: number,
): number => {
  const visibleY = clientY - scaleTop;
  const y = visibleY + scrollTop;
  const length = dayMinutes(dayLengthMinutes);
  return snapMinutes(yToMinutes(y, scaleHeightPx, length), step, length);
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
  dayLengthMinutes?: number,
): number => {
  const length = dayMinutes(dayLengthMinutes);
  const raw = originalStartMinutes + yToMinutes(deltaYPx, scaleHeightPx, length);
  const snapped = snapMinutes(raw, step, length);
  const lastStart = length - durationMinutes;
  // Блок довший за день: не відкидати старт у 00:00, лише не раніше початку дня.
  if (lastStart <= 0) {
    return Math.max(0, snapped);
  }
  const lastOnStep = Math.floor(lastStart / step) * step;
  return Math.max(0, Math.min(snapped, lastOnStep));
};

/**
 * Нова тривалість після розтягування нижнього краю.
 * Мінімум і крок — поточний крок шкали; cap кінця дня — лише при збільшенні.
 */
export const snapResizeDurationMinutes = (
  originalDurationMinutes: number,
  deltaYPx: number,
  step: CalendarTimeStep,
  startMinutes: number,
  scaleHeightPx = CALENDAR_DAY_HEIGHT_PX,
  dayLengthMinutes?: number,
): number => {
  const length = dayMinutes(dayLengthMinutes);
  const raw = originalDurationMinutes + yToMinutes(deltaYPx, scaleHeightPx, length);
  const snapped = Math.max(step, Math.round(raw / step) * step);
  if (snapped <= originalDurationMinutes) {
    return snapped;
  }
  const maxDur = length - startMinutes;
  const lastOnStep = Math.floor(maxDur / step) * step;
  const cap = lastOnStep >= step ? lastOnStep : step;
  // Не зменшувати наявну тривалість через cap, якщо вона вже виходить за кінець дня.
  return Math.min(snapped, Math.max(originalDurationMinutes, cap));
};

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart < bEnd && bStart < aEnd;

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
      if (overlaps(a.startMs as number, aEnd, b.startMs as number, bEnd)) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return ids;
};

/** Накладки лише для одного блока (під час drag — O(n) замість усіх пар). */
export const markOverlapsForItem = (
  items: readonly CalendarDayItem[],
  preview: CalendarDayItem,
): ReadonlySet<string> => {
  if (preview.startMs == null) {
    return new Set();
  }
  const ids = new Set<string>();
  const pStart = preview.startMs;
  const pEnd = pStart + preview.durationMs;
  for (const item of items) {
    if (item.id === preview.id || item.startMs == null) {
      continue;
    }
    const bEnd = item.startMs + item.durationMs;
    if (overlaps(pStart, pEnd, item.startMs, bEnd)) {
      ids.add(preview.id);
      ids.add(item.id);
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

export const MINUTES_IN_DAY = DEFAULT_DAY_MINUTES;
