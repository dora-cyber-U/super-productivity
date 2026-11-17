import { selectOverdueTasksWithSubTasks } from '../tasks/store/task.selectors';
import { TaskWithSubTasks } from '../tasks/task.model';
import { selectTodayProgress } from '../work-context/store/work-context.selectors';
import { CalendarTodayStatus } from './calendar-panel.model';
import { selectCalendarTodayStatus } from './calendar-panel.selectors';

interface Overridable<R> {
  setResult: (r: R) => void;
  clearResult: () => void;
}

describe('selectCalendarTodayStatus', () => {
  const progress = selectTodayProgress as unknown as Overridable<{
    done: number;
    total: number;
  }>;
  const overdue = selectOverdueTasksWithSubTasks as unknown as Overridable<
    TaskWithSubTasks[]
  >;
  const tasks = (n: number): TaskWithSubTasks[] =>
    Array.from({ length: n }, (_, i) => ({ id: `o${i}` }) as TaskWithSubTasks);

  beforeEach(() => overdue.setResult([]));

  afterEach(() => {
    progress.clearResult();
    overdue.clearResult();
    selectCalendarTodayStatus.release();
  });

  const select = (): CalendarTodayStatus => selectCalendarTodayStatus({} as object);

  it('returns done / total of today', () => {
    progress.setResult({ done: 3, total: 8 });

    expect(select()).toEqual({ done: 3, total: 8, overdue: 0 });
  });

  it('F7: counts undone tasks from previous days like the Today list shows them', () => {
    // після півночі: на сьогодні нічого, одна вчорашня невиконана
    progress.setResult({ done: 0, total: 0 });
    overdue.setResult(tasks(1));

    expect(select()).toEqual({ done: 0, total: 1, overdue: 1 });
  });

  it('keeps the same object while the counts do not change (no re-render)', () => {
    progress.setResult({ done: 3, total: 8 });
    const first = select();

    // напр. щосекундний timeSpent: нові об'єкти на вході, ті самі числа
    progress.setResult({ done: 3, total: 8 });
    overdue.setResult([]);
    expect(select()).toBe(first);

    progress.setResult({ done: 4, total: 8 });
    const next = select();
    expect(next).not.toBe(first);
    expect(next).toEqual({ done: 4, total: 8, overdue: 0 });
  });
});
