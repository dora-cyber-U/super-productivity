/** Режим перегляду календаря у правій панелі. */
export type CalendarViewMode = 'day' | 'week' | 'month';

/**
 * Прогрес на сьогодні, як його бачить список «Сьогодні»:
 * done — виконані задачі дня; total — задачі дня плюс невиконані
 * з попередніх днів (overdue), бо вони теж стоять у «Сьогодні» і чекають.
 */
export interface CalendarTodayStatus {
  done: number;
  total: number;
  /** Скільки з total — невиконані з попередніх днів. */
  overdue: number;
}

/**
 * Як показано панель:
 * docked — колонка поруч зі списком; strip — лише смуга-мітка;
 * overlay — центр завузький для колонки, тож календар відкрито поверх списку.
 */
export type CalendarPanelMode = 'docked' | 'strip' | 'overlay';

/** Крок вертикальної шкали дня, хвилини. */
export type CalendarTimeStep = 5 | 10 | 15 | 30 | 60;

/**
 * Задача на видимий день календаря.
 * startMs === null — all-day (dueDay, без dueWithTime).
 * durationMs — timeEstimate задачі, або запасний мінімум для відображення.
 */
export interface CalendarDayItem {
  id: string;
  title: string;
  isDone: boolean;
  startMs: number | null;
  durationMs: number;
}

export interface CalendarDayView {
  day: string;
  allDay: CalendarDayItem[];
  timed: CalendarDayItem[];
}

export const EMPTY_CALENDAR_DAY_VIEW: CalendarDayView = {
  day: '',
  allDay: [],
  timed: [],
};
