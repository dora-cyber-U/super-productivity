import { Task } from '../tasks/task.model';

/** Новий remindAt зі збереженим точним зсувом: newDue - (oldDue - oldRemind). */
export const preservedRemindAt = (
  task: Pick<Task, 'dueWithTime' | 'remindAt' | 'reminderId'>,
  dueWithTime: number,
): number | undefined => {
  const hasReminder = !!(task.remindAt ?? task.reminderId);
  if (!hasReminder) {
    return undefined;
  }
  if (task.dueWithTime && typeof task.remindAt === 'number') {
    return dueWithTime - (task.dueWithTime - task.remindAt);
  }
  return dueWithTime;
};
