import { Task } from '../tasks/task.model';
import { preservedRemindAt } from './calendar-schedule.util';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const fifteenMinMs = 15 * MIN;

describe('preservedRemindAt', () => {
  const due = Date.UTC(2026, 10, 18, 10, 0, 0);
  const next = due + HOUR;

  it('returns undefined when the task has no reminder', () => {
    expect(preservedRemindAt({ dueWithTime: due }, next)).toBeUndefined();
  });

  it('keeps a 15-minute offset when moving the start', () => {
    const task = { dueWithTime: due, remindAt: due - fifteenMinMs } as Pick<
      Task,
      'dueWithTime' | 'remindAt' | 'reminderId'
    >;
    expect(preservedRemindAt(task, next)).toBe(next - fifteenMinMs);
  });

  it('falls back to the new due when remindAt is missing but reminderId is set', () => {
    expect(preservedRemindAt({ dueWithTime: due, reminderId: 'r1' }, next)).toBe(next);
  });
});
