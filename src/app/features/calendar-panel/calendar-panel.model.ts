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
