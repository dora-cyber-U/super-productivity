import { Task } from '../tasks/task.model';
import {
  millisecondsDiffToRemindOption,
  remindOptionToMilliseconds,
} from '../tasks/util/remind-option-to-milliseconds';

/** Новий remindAt зі збереженим зсувом, як у schedule-day-panel / R1. */
export const preservedRemindAt = (
  task: Pick<Task, 'dueWithTime' | 'remindAt' | 'reminderId'>,
  dueWithTime: number,
): number | undefined => {
  const hasReminder = !!(task.remindAt ?? task.reminderId);
  if (!hasReminder) {
    return undefined;
  }
  if (task.dueWithTime && typeof task.remindAt === 'number') {
    return remindOptionToMilliseconds(
      dueWithTime,
      millisecondsDiffToRemindOption(task.dueWithTime, task.remindAt),
    );
  }
  return dueWithTime;
};
