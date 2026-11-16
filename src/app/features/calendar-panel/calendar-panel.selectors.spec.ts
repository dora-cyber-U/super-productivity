import { selectTodayProgress } from '../work-context/store/work-context.selectors';
import { selectCalendarTodayStatus } from './calendar-panel.selectors';

describe('selectCalendarTodayStatus', () => {
  const progress = selectTodayProgress as unknown as {
    setResult: (r: { done: number; total: number }) => void;
    clearResult: () => void;
  };

  afterEach(() => {
    progress.clearResult();
    selectCalendarTodayStatus.release();
  });

  const select = (): { done: number; total: number } =>
    selectCalendarTodayStatus({} as object);

  it('returns done / total of today', () => {
    progress.setResult({ done: 3, total: 8 });

    expect(select()).toEqual({ done: 3, total: 8 });
  });

  it('keeps the same object while the counts do not change (no re-render)', () => {
    progress.setResult({ done: 3, total: 8 });
    const first = select();

    // напр. щосекундний timeSpent: новий об'єкт від selectTodayProgress, ті самі числа
    progress.setResult({ done: 3, total: 8 });
    expect(select()).toBe(first);

    progress.setResult({ done: 4, total: 8 });
    const next = select();
    expect(next).not.toBe(first);
    expect(next).toEqual({ done: 4, total: 8 });
  });
});
