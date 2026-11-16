/** Режим перегляду календаря у правій панелі. */
export type CalendarViewMode = 'day' | 'week' | 'month';

/** Прогрес на сьогодні: скільки задач виконано з усіх запланованих. */
export interface CalendarTodayStatus {
  done: number;
  total: number;
}
