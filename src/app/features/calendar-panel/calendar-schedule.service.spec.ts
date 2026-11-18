import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { PlannerActions } from '../planner/store/planner.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TaskService } from '../tasks/task.service';
import { logicalDayStartMs } from './calendar-day.util';
import { CalendarScheduleService } from './calendar-schedule.service';

const FROM = '2026-11-18';
const TO = '2026-11-20';
const START = logicalDayStartMs(FROM, 0);
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const tenHoursMs = 10 * HOUR;
const fifteenMinMs = 15 * MIN;

describe('CalendarScheduleService', () => {
  let update: jasmine.Spy;
  let getByIdOnce$: jasmine.Spy;
  let dispatch: jasmine.Spy;
  let svc: CalendarScheduleService;

  beforeEach(() => {
    update = jasmine.createSpy('update');
    getByIdOnce$ = jasmine.createSpy('getByIdOnce$');
    dispatch = jasmine.createSpy('dispatch');
    TestBed.configureTestingModule({
      providers: [
        CalendarScheduleService,
        { provide: TaskService, useValue: { update, getByIdOnce$ } },
        { provide: Store, useValue: { dispatch } },
      ],
    });
    svc = TestBed.inject(CalendarScheduleService);
  });

  it('does nothing when the drop day is the same', () => {
    svc.moveItemToDay('t1', FROM, FROM, 0, false);
    expect(getByIdOnce$).not.toHaveBeenCalled();
  });

  it('moves a timed task with scheduleTaskWithTime when there is no reminder', () => {
    const due = START + tenHoursMs;
    const task = { id: 't1', dueWithTime: due };
    getByIdOnce$.and.returnValue(of(task));
    svc.moveItemToDay('t1', FROM, TO, 0, false);
    expect(dispatch).toHaveBeenCalledWith(
      TaskSharedActions.scheduleTaskWithTime({
        task: task as never,
        dueWithTime: logicalDayStartMs(TO, 0) + tenHoursMs,
        isMoveToBacklog: false,
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('reschedules a timed task and keeps the reminder offset', () => {
    const due = START + tenHoursMs;
    const task = {
      id: 't1',
      dueWithTime: due,
      remindAt: due - fifteenMinMs,
      reminderId: 'r1',
    };
    getByIdOnce$.and.returnValue(of(task));
    svc.moveItemToDay('t1', FROM, TO, 0, false);
    const next = logicalDayStartMs(TO, 0) + tenHoursMs;
    expect(dispatch).toHaveBeenCalledWith(
      TaskSharedActions.reScheduleTaskWithTime({
        task: task as never,
        dueWithTime: next,
        remindAt: next - fifteenMinMs,
        isMoveToBacklog: false,
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('plans an all-day task for the drop day', () => {
    const task = { id: 'a1', dueDay: FROM, title: 'Inbox' };
    getByIdOnce$.and.returnValue(of(task));
    svc.moveItemToDay('a1', FROM, TO, 0, true);
    expect(dispatch).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({
        task: task as never,
        day: TO,
        isShowSnack: false,
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });
});
