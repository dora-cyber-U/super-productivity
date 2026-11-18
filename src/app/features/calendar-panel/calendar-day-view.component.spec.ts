import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { TranslateModule } from '@ngx-translate/core';
import { PlannerActions } from '../planner/store/planner.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TaskService } from '../tasks/task.service';
import { CalendarDayViewComponent } from './calendar-day-view.component';
import { CalendarDayItem } from './calendar-panel.model';
import { logicalDayStartMs } from './calendar-day.util';
import {
  CALENDAR_DAY_HEIGHT_PX,
  CALENDAR_DAY_PX_PER_HOUR,
  CALENDAR_DAY_TOUCH_LONG_PRESS_MS,
} from './calendar-panel.const';

const DAY = '2026-11-17';
const START = logicalDayStartMs(DAY, 0);
const HOUR_MS = 60 * 60 * 1000;
const tenHoursMs = 10 * HOUR_MS;

describe('CalendarDayViewComponent', () => {
  let fixture: ComponentFixture<CalendarDayViewComponent>;
  let add: jasmine.Spy;
  let update: jasmine.Spy;
  let getByIdOnce$: jasmine.Spy;
  let dispatch: jasmine.Spy;

  const render = (): CalendarDayViewComponent => {
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  beforeEach(async () => {
    add = jasmine.createSpy('add');
    update = jasmine.createSpy('update');
    getByIdOnce$ = jasmine
      .createSpy('getByIdOnce$')
      .and.callFake((id: string) => of({ id }));
    dispatch = jasmine.createSpy('dispatch');
    await TestBed.configureTestingModule({
      imports: [CalendarDayViewComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: TaskService,
          useValue: { add, update, getByIdOnce$ },
        },
        { provide: Store, useValue: { dispatch } },
        {
          provide: DateTimeFormatService,
          useValue: {
            formatTime: (ts: number) => {
              const d = new Date(ts);
              return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CalendarDayViewComponent);
    fixture.componentRef.setInput('day', DAY);
    fixture.componentRef.setInput('step', 30);
    fixture.componentRef.setInput('startOfNextDayDiffMs', 0);
    fixture.componentRef.setInput('allDay', []);
    fixture.componentRef.setInput('timed', []);
    fixture.componentRef.setInput('isToday', false);
  });

  it('renders all-day tasks and timed blocks', () => {
    const allDay: CalendarDayItem[] = [
      { id: 'a', title: 'Inbox review', isDone: false, startMs: null, durationMs: 0 },
    ];
    const timed: CalendarDayItem[] = [
      {
        id: 't',
        title: 'Standup',
        isDone: false,
        startMs: START + tenHoursMs,
        durationMs: 30 * 60 * 1000,
      },
    ];
    fixture.componentRef.setInput('allDay', allDay);
    fixture.componentRef.setInput('timed', timed);
    render();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.all-day-list')?.textContent).toContain('Inbox review');
    expect(el.querySelector('.day-block')?.textContent).toContain('Standup');
    const top = (el.querySelector('.day-block') as HTMLElement).style.top;
    expect(parseFloat(top)).toBeCloseTo((10 / 24) * CALENDAR_DAY_HEIGHT_PX, 0);
  });

  it('creates a task with dueWithTime on double-click + Enter', () => {
    const cmp = render();
    const scale = fixture.nativeElement.querySelector('.scale') as HTMLElement;
    const y = (10 / 24) * CALENDAR_DAY_HEIGHT_PX;
    const rect = { top: 0 } as DOMRect;
    spyOn(scale, 'getBoundingClientRect').and.returnValue(rect);

    scale.dispatchEvent(
      new MouseEvent('dblclick', { clientY: y, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '.day-composer input',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    cmp.onComposerTitle('Walk the plant');
    cmp.commitComposer();

    expect(add).toHaveBeenCalledTimes(1);
    const [title, backlog, additional] = add.calls.mostRecent().args;
    expect(title).toBe('Walk the plant');
    expect(backlog).toBe(false);
    expect(additional.dueWithTime).toBe(START + tenHoursMs);
    expect(additional.timeEstimate).toBe(30 * 60 * 1000);
  });

  it('accounts for scale scrollTop when mapping a double-click to time', () => {
    const cmp = render();
    const scale = fixture.nativeElement.querySelector('.scale') as HTMLElement;
    const scrollTop = 200;
    Object.defineProperty(scale, 'scrollTop', { configurable: true, value: scrollTop });
    spyOn(scale, 'getBoundingClientRect').and.returnValue({ top: 0 } as DOMRect);

    const tenHoursY = (10 / 24) * CALENDAR_DAY_HEIGHT_PX;
    const visibleY = tenHoursY - scrollTop;
    scale.dispatchEvent(
      new MouseEvent('dblclick', { clientY: visibleY, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();

    cmp.onComposerTitle('After scroll');
    cmp.commitComposer();

    const additional = add.calls.mostRecent().args[2];
    expect(additional.dueWithTime).toBe(START + tenHoursMs);
  });

  it('commits a typed draft when a second double-click opens another composer', () => {
    const cmp = render();
    const scale = fixture.nativeElement.querySelector('.scale') as HTMLElement;
    spyOn(scale, 'getBoundingClientRect').and.returnValue({ top: 0 } as DOMRect);

    const y10 = (10 / 24) * CALENDAR_DAY_HEIGHT_PX;
    scale.dispatchEvent(
      new MouseEvent('dblclick', { clientY: y10, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    cmp.onComposerTitle('First draft');

    const y14 = (14 / 24) * CALENDAR_DAY_HEIGHT_PX;
    scale.dispatchEvent(
      new MouseEvent('dblclick', { clientY: y14, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();

    expect(add).toHaveBeenCalledTimes(1);
    const [title, , additional] = add.calls.mostRecent().args;
    expect(title).toBe('First draft');
    expect(additional.dueWithTime).toBe(START + tenHoursMs);
    expect(cmp.composer()?.title).toBe('');
    expect(cmp.composer()?.minutes).toBe(14 * 60);
    expect(
      (fixture.nativeElement.querySelector('.composer-time') as HTMLElement).textContent,
    ).toContain('14:00');
  });

  it('exposes role, keyboard focus and an aria-label with title and time on blocks', () => {
    const timed: CalendarDayItem[] = [
      {
        id: 't',
        title: 'Standup',
        isDone: false,
        startMs: START + tenHoursMs,
        durationMs: 30 * 60 * 1000,
      },
    ];
    fixture.componentRef.setInput('timed', timed);
    render();
    const block = fixture.nativeElement.querySelector('.day-block') as HTMLElement;
    expect(block.getAttribute('role')).toBe('button');
    expect(block.getAttribute('tabindex')).toBe('0');
    expect(block.getAttribute('aria-label')).toContain('Standup');
    expect(block.getAttribute('aria-label')).toContain('10:00');
    expect(block.getAttribute('aria-label')).toContain('10:30');
  });

  it('shows the current-time line only on today', () => {
    fixture.componentRef.setInput('isToday', false);
    render();
    expect(fixture.nativeElement.querySelector('.now-line')).toBeNull();

    fixture.componentRef.setInput('isToday', true);
    // day is 2026-11-17 — unless the clock is that day, now line may still be null
    // force minutes via a today that includes Date.now()
    const nowDayStart = new Date();
    nowDayStart.setHours(0, 0, 0, 0);
    const today = `${nowDayStart.getFullYear()}-${String(nowDayStart.getMonth() + 1).padStart(2, '0')}-${String(nowDayStart.getDate()).padStart(2, '0')}`;
    fixture.componentRef.setInput('day', today);
    fixture.componentRef.setInput('isToday', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.now-line')).not.toBeNull();
  });

  const timedAt = (id: string, hour: number, durationMin = 30): CalendarDayItem => {
    const hourMs = 60 * 60 * 1000;
    const minuteMs = 60 * 1000;
    const offsetMs = hour * hourMs;
    return {
      id,
      title: id,
      isDone: false,
      startMs: START + offsetMs,
      durationMs: durationMin * minuteMs,
    };
  };

  const pointer = (type: string, clientY: number, pointerId = 1): PointerEvent =>
    new PointerEvent(type, {
      pointerId,
      clientY,
      clientX: 80,
      button: 0,
      bubbles: true,
      cancelable: true,
    });

  it('shows an overlap mark on crossing blocks, not on blocks that only touch', () => {
    fixture.componentRef.setInput('timed', [
      timedAt('a', 10, 60),
      timedAt('b', 10.5, 60),
      timedAt('c', 12, 30),
    ]);
    render();
    const marks = fixture.nativeElement.querySelectorAll('.day-block-overlap');
    expect(marks.length).toBe(2);

    fixture.componentRef.setInput('timed', [timedAt('a', 10, 60), timedAt('c', 11, 30)]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.day-block-overlap').length).toBe(0);

    fixture.componentRef.setInput('timed', [
      timedAt('a', 10, 60),
      timedAt('b', 10.5, 60),
    ]);
    fixture.detectChanges();
    const mark = fixture.nativeElement.querySelector('.day-block-overlap') as HTMLElement;
    expect(mark.getAttribute('role')).toBe('img');
    expect(mark.getAttribute('aria-label')).toBeTruthy();
  });

  it('updates dueWithTime on drop, not while the pointer is moving', () => {
    fixture.componentRef.setInput('timed', [timedAt('t', 10)]);
    const cmp = render();
    const block = fixture.nativeElement.querySelector('.day-block') as HTMLElement;
    block.dispatchEvent(pointer('pointerdown', 0));
    fixture.detectChanges();
    expect(update).not.toHaveBeenCalled();

    window.dispatchEvent(pointer('pointermove', CALENDAR_DAY_PX_PER_HOUR));
    fixture.detectChanges();
    expect(update).not.toHaveBeenCalled();
    expect(cmp.drag()?.active).toBeTrue();
    expect(cmp.ghostStart()).toBe('11:00');

    window.dispatchEvent(pointer('pointerup', CALENDAR_DAY_PX_PER_HOUR));
    fixture.detectChanges();
    expect(update).toHaveBeenCalledTimes(1);
    const [id, changes] = update.calls.mostRecent().args;
    expect(id).toBe('t');
    const elevenHoursMs = 11 * 60 * 60 * 1000;
    expect(changes.dueWithTime).toBe(START + elevenHoursMs);
    expect(cmp.drag()).toBeNull();
  });

  it('updates timeEstimate when the bottom edge is resized', () => {
    fixture.componentRef.setInput('timed', [timedAt('t', 10, 30)]);
    render();
    const handle = fixture.nativeElement.querySelector(
      '.day-block-resize',
    ) as HTMLElement;
    handle.dispatchEvent(pointer('pointerdown', 0));
    window.dispatchEvent(pointer('pointermove', CALENDAR_DAY_PX_PER_HOUR));
    window.dispatchEvent(pointer('pointerup', CALENDAR_DAY_PX_PER_HOUR));
    fixture.detectChanges();

    expect(update).toHaveBeenCalledTimes(1);
    const [id, changes] = update.calls.mostRecent().args;
    expect(id).toBe('t');
    const ninetyMinMs = 90 * 60 * 1000;
    expect(changes.timeEstimate).toBe(ninetyMinMs);
  });

  it('cancels an in-progress drag on Escape without writing', () => {
    fixture.componentRef.setInput('timed', [timedAt('t', 10)]);
    const cmp = render();
    const block = fixture.nativeElement.querySelector('.day-block') as HTMLElement;
    block.dispatchEvent(pointer('pointerdown', 0));
    window.dispatchEvent(pointer('pointermove', CALENDAR_DAY_PX_PER_HOUR));
    fixture.detectChanges();
    expect(cmp.drag()?.active).toBeTrue();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(update).not.toHaveBeenCalled();
    expect(cmp.drag()).toBeNull();
  });

  it('assigns a time when an all-day task is dropped on the scale', () => {
    fixture.componentRef.setInput('allDay', [
      { id: 'a', title: 'Inbox', isDone: false, startMs: null, durationMs: 0 },
    ]);
    const cmp = render();
    const row = fixture.nativeElement.querySelector('.all-day-list li') as HTMLElement;
    const scale = fixture.nativeElement.querySelector('.scale') as HTMLElement;
    spyOn(scale, 'getBoundingClientRect').and.returnValue({
      top: 200,
      bottom: 900,
      left: 0,
      right: 300,
      height: 700,
      width: 300,
    } as DOMRect);

    row.dispatchEvent(pointer('pointerdown', 50));
    window.dispatchEvent(pointer('pointermove', 200));
    window.dispatchEvent(pointer('pointerup', 200));
    fixture.detectChanges();

    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.calls.mostRecent().args[0];
    expect(action.type).toBe(TaskSharedActions.scheduleTaskWithTime.type);
    expect(action.task.id).toBe('a');
    expect(typeof action.dueWithTime).toBe('number');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.calls.mostRecent().args[0]).toBe('a');
    expect(update.calls.mostRecent().args[1]).toEqual({
      timeEstimate: 30 * 60 * 1000,
    });
    expect(cmp.drag()).toBeNull();
  });

  it('keeps an existing estimate when an all-day task is dropped on the scale', () => {
    const twoHoursMs = 120 * 60 * 1000;
    fixture.componentRef.setInput('allDay', [
      {
        id: 'a',
        title: 'Inbox',
        isDone: false,
        startMs: null,
        durationMs: twoHoursMs,
      },
    ]);
    render();
    const row = fixture.nativeElement.querySelector('.all-day-list li') as HTMLElement;
    const scale = fixture.nativeElement.querySelector('.scale') as HTMLElement;
    spyOn(scale, 'getBoundingClientRect').and.returnValue({
      top: 200,
      bottom: 900,
      left: 0,
      right: 300,
      height: 700,
      width: 300,
    } as DOMRect);
    row.dispatchEvent(pointer('pointerdown', 50));
    window.dispatchEvent(pointer('pointermove', 200));
    window.dispatchEvent(pointer('pointerup', 200));
    fixture.detectChanges();
    expect(update).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.calls.mostRecent().args[0];
    expect(action.type).toBe(TaskSharedActions.scheduleTaskWithTime.type);
    expect(action.task.id).toBe('a');
  });

  it('reschedules a reminder to keep its offset when a block is moved', () => {
    const fifteenMinMs = 15 * 60 * 1000;
    getByIdOnce$.and.returnValue(
      of({
        id: 't',
        dueWithTime: START + tenHoursMs,
        remindAt: START + tenHoursMs - fifteenMinMs,
        reminderId: 'r1',
      }),
    );
    fixture.componentRef.setInput('timed', [timedAt('t', 10)]);
    render();
    const block = fixture.nativeElement.querySelector('.day-block') as HTMLElement;
    block.dispatchEvent(pointer('pointerdown', 0));
    window.dispatchEvent(pointer('pointermove', CALENDAR_DAY_PX_PER_HOUR));
    window.dispatchEvent(pointer('pointerup', CALENDAR_DAY_PX_PER_HOUR));
    fixture.detectChanges();
    expect(update).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalled();
    const action = dispatch.calls.mostRecent().args[0];
    expect(action.type).toBe(TaskSharedActions.reScheduleTaskWithTime.type);
    const elevenHoursMs = 11 * HOUR_MS;
    expect(action.dueWithTime).toBe(START + elevenHoursMs);
    expect(action.remindAt).toBe(START + elevenHoursMs - fifteenMinMs);
  });

  it('does not start a touch drag before the long-press', fakeAsync(() => {
    fixture.componentRef.setInput('timed', [timedAt('t', 10)]);
    const cmp = render();
    const block = fixture.nativeElement.querySelector('.day-block') as HTMLElement;
    const evInit = {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 80,
      button: 0,
      bubbles: true,
      cancelable: true,
    };
    block.dispatchEvent(new PointerEvent('pointerdown', { ...evInit, clientY: 200 }));
    window.dispatchEvent(new PointerEvent('pointermove', { ...evInit, clientY: 280 }));
    expect(cmp.drag()).toBeNull();
    expect(update).not.toHaveBeenCalled();
    tick(CALENDAR_DAY_TOUCH_LONG_PRESS_MS);
  }));

  it('starts a touch drag after a long-press and clears it on lostpointercapture', fakeAsync(() => {
    fixture.componentRef.setInput('timed', [timedAt('t', 10)]);
    const cmp = render();
    const block = fixture.nativeElement.querySelector('.day-block') as HTMLElement;
    const evInit = {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 80,
      button: 0,
      bubbles: true,
      cancelable: true,
    };
    block.dispatchEvent(new PointerEvent('pointerdown', { ...evInit, clientY: 0 }));
    tick(CALENDAR_DAY_TOUCH_LONG_PRESS_MS);
    fixture.detectChanges();
    expect(cmp.isDragReady('t')).toBeTrue();
    window.dispatchEvent(
      new PointerEvent('pointermove', { ...evInit, clientY: CALENDAR_DAY_PX_PER_HOUR }),
    );
    fixture.detectChanges();
    expect(cmp.drag()?.active).toBeTrue();
    window.dispatchEvent(new PointerEvent('lostpointercapture', evInit));
    fixture.detectChanges();
    expect(cmp.drag()).toBeNull();
    expect(update).not.toHaveBeenCalled();
  }));

  it('plans a timed block for the day when dropped on the all-day strip', () => {
    const task = { id: 't', title: 't' };
    getByIdOnce$.and.returnValue(of(task));
    fixture.componentRef.setInput('timed', [timedAt('t', 10)]);
    fixture.componentRef.setInput('allDay', []);
    render();
    const allDay = fixture.nativeElement.querySelector('.all-day') as HTMLElement;
    spyOn(allDay, 'getBoundingClientRect').and.returnValue({
      top: 0,
      bottom: 80,
      left: 0,
      right: 300,
      height: 80,
      width: 300,
    } as DOMRect);
    const block = fixture.nativeElement.querySelector('.day-block') as HTMLElement;
    block.dispatchEvent(pointer('pointerdown', 200, 1));
    const move = new PointerEvent('pointermove', {
      pointerId: 1,
      clientY: 20,
      clientX: 80,
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(move);
    window.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        clientY: 20,
        clientX: 80,
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();

    expect(update).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalled();
    const action = dispatch.calls.mostRecent().args[0];
    expect(action.type).toBe(PlannerActions.planTaskForDay.type);
    expect(action.task).toBe(task);
    expect(action.day).toBe(DAY);
  });

  it('previews Alt+arrow repeats and writes once on keyup', () => {
    fixture.componentRef.setInput('timed', [timedAt('t', 10)]);
    const cmp = render();
    const block = fixture.nativeElement.querySelector('.day-block') as HTMLElement;
    const down = (repeat = false): void => {
      block.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          altKey: true,
          repeat,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    down(false);
    down(true);
    fixture.detectChanges();
    expect(update).not.toHaveBeenCalled();
    expect(cmp.drag()?.fromKeyboard).toBeTrue();
    expect(cmp.ghostStart()).toBe('11:00');

    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(update).toHaveBeenCalledTimes(1);
    const elevenHoursMs = 11 * 60 * 60 * 1000;
    expect(update.calls.mostRecent().args[1].dueWithTime).toBe(START + elevenHoursMs);
    expect(cmp.drag()).toBeNull();
  });

  it('restores keyboard focus to the moved block after a relayout', () => {
    const first = timedAt('t', 10, 60);
    const other = timedAt('u', 10, 60);
    fixture.componentRef.setInput('timed', [first, other]);
    render();
    const block = fixture.nativeElement.querySelector(
      '.day-block[data-block-id="t"]',
    ) as HTMLElement;
    block.focus();
    const focusSpy = spyOn(HTMLElement.prototype, 'focus').and.callThrough();
    block.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    fixture.componentRef.setInput('timed', [timedAt('t', 10.5, 60), other]);
    fixture.detectChanges();
    expect(
      focusSpy.calls
        .all()
        .some((c) => (c.object as HTMLElement).getAttribute?.('data-block-id') === 't'),
    ).toBeTrue();
  });
});
