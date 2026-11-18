import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { PlannerActions } from '../planner/store/planner.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TaskService } from '../tasks/task.service';
import { isValidDueWithTime } from './calendar-day.util';
import { moveDueWithTimeToDay } from './calendar-period.util';
import { preservedRemindAt } from './calendar-schedule.util';

/**
 * Перенесення задачі на інший день у тижневому/місячному вигляді.
 * Час і тривалість зберігаються; нагадування — через reScheduleTaskWithTime (R1).
 * Без часу — planTaskForDay (лише дата).
 */
@Injectable({ providedIn: 'root' })
export class CalendarScheduleService {
  private readonly _tasks = inject(TaskService);
  private readonly _store = inject(Store);

  moveItemToDay(
    id: string,
    fromDay: string,
    toDay: string,
    startOfNextDayDiffMs: number,
    isAllDay: boolean,
  ): void {
    if (!toDay || toDay === fromDay) {
      return;
    }
    this._tasks.getByIdOnce$(id).subscribe((task) => {
      if (isAllDay || !isValidDueWithTime(task.dueWithTime)) {
        this._store.dispatch(
          PlannerActions.planTaskForDay({
            task,
            day: toDay,
            isShowSnack: false,
          }),
        );
        return;
      }
      const dueWithTime = moveDueWithTimeToDay(
        task.dueWithTime,
        fromDay,
        toDay,
        startOfNextDayDiffMs,
      );
      if (dueWithTime === task.dueWithTime) {
        return;
      }
      const remindAt = preservedRemindAt(task, dueWithTime);
      if (remindAt === undefined) {
        // Як N1 у денному вигляді: scheduleTaskWithTime — одна op, порядок TODAY не губиться.
        this._store.dispatch(
          TaskSharedActions.scheduleTaskWithTime({
            task,
            dueWithTime,
            isMoveToBacklog: false,
          }),
        );
        return;
      }
      this._store.dispatch(
        TaskSharedActions.reScheduleTaskWithTime({
          task,
          dueWithTime,
          remindAt,
          isMoveToBacklog: false,
        }),
      );
    });
  }
}
