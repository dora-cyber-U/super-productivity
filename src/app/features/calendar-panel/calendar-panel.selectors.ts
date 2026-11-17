import { createSelectorFactory, resultMemoize } from '@ngrx/store';
import { selectOverdueTasksWithSubTasks } from '../tasks/store/task.selectors';
import { TaskWithSubTasks } from '../tasks/task.model';
import { selectTodayProgress } from '../work-context/store/work-context.selectors';
import { CalendarTodayStatus } from './calendar-panel.model';

const isSameStatus = (a: CalendarTodayStatus, b: CalendarTodayStatus): boolean =>
  a.done === b.done && a.total === b.total && a.overdue === b.overdue;

/**
 * «Сьогодні виконано X з Y» для статус-бару календаря.
 *
 * Рахує так само, як показує список «Сьогодні»: задачі дня
 * (selectTodayProgress) плюс невиконані «З попередніх днів»
 * (selectOverdueTasksWithSubTasks — той самий селектор, що й панель
 * прострочених у робочому вигляді, тож обчислення спільне). Інакше після
 * півночі статус показував би 0 з 0, хоча вчорашні задачі на екрані.
 *
 * Обидва вхідні селектори перераховуються і на зміни, що лічильників не
 * стосуються (напр. щосекундний timeSpent під час трекінгу). Результат
 * мемоізовано за значенням: поки числа ті самі, повертається той самий об'єкт —
 * підписник нічого не перемальовує.
 */
export const selectCalendarTodayStatus = createSelectorFactory<
  object,
  CalendarTodayStatus
>((projector) => resultMemoize(projector, isSameStatus))(
  selectTodayProgress,
  selectOverdueTasksWithSubTasks,
  (
    { done, total }: { done: number; total: number },
    overdue: TaskWithSubTasks[],
  ): CalendarTodayStatus => ({
    done,
    total: total + overdue.length,
    overdue: overdue.length,
  }),
);
