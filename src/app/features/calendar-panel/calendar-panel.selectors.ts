import { createSelectorFactory, resultMemoize } from '@ngrx/store';
import { selectTodayProgress } from '../work-context/store/work-context.selectors';
import { CalendarTodayStatus } from './calendar-panel.model';

const isSameStatus = (a: CalendarTodayStatus, b: CalendarTodayStatus): boolean =>
  a.done === b.done && a.total === b.total;

/**
 * «Сьогодні виконано X з Y» для статус-бару календаря.
 *
 * Будується на наявному selectTodayProgress (задачі «Сьогодні» верхнього
 * рівня). Той перераховується і на зміни, що лічильників не стосуються
 * (напр. щосекундний timeSpent під час трекінгу), і щоразу дає новий об'єкт.
 * Тут результат мемоізовано за значенням: поки X і Y ті самі, повертається
 * той самий об'єкт — підписник нічого не перемальовує.
 */
export const selectCalendarTodayStatus = createSelectorFactory<
  object,
  CalendarTodayStatus
>((projector) => resultMemoize(projector, isSameStatus))(
  selectTodayProgress,
  ({ done, total }: CalendarTodayStatus): CalendarTodayStatus => ({ done, total }),
);
