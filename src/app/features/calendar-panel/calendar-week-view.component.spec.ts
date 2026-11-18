import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { CalendarDayView } from './calendar-panel.model';
import { CalendarScheduleService } from './calendar-schedule.service';
import { CalendarWeekViewComponent } from './calendar-week-view.component';
import { logicalDayStartMs } from './calendar-day.util';
import { CALENDAR_DAY_TOUCH_LONG_PRESS_MS } from './calendar-panel.const';
import { weekDays } from './calendar-period.util';

const WEEK = '2026-11-18';
const DAYS = weekDays(WEEK, 1);
const START = logicalDayStartMs('2026-11-18', 0);
const HOUR = 60 * 60 * 1000;
const tenHoursMs = 10 * HOUR;

const dayView = (
  day: string,
  timed: CalendarDayView['timed'] = [],
  allDay: CalendarDayView['allDay'] = [],
): CalendarDayView => ({ day, timed, allDay });

const period = (): CalendarDayView[] =>
  DAYS.map((day) => {
    if (day === '2026-11-18') {
      return dayView(day, [
        {
          id: 't1',
          title: 'Standup',
          isDone: false,
          startMs: START + tenHoursMs,
          durationMs: 30 * 60 * 1000,
        },
        {
          id: 't2',
          title: 'Overlap',
          isDone: false,
          startMs: START + tenHoursMs,
          durationMs: 30 * 60 * 1000,
        },
      ]);
    }
    if (day === '2026-11-16') {
      return dayView(
        day,
        [],
        [{ id: 'a1', title: 'Inbox', isDone: false, startMs: null, durationMs: 0 }],
      );
    }
    return dayView(day);
  });

describe('CalendarWeekViewComponent', () => {
  let fixture: ComponentFixture<CalendarWeekViewComponent>;
  let moveItemToDay: jasmine.Spy;

  const render = (): CalendarWeekViewComponent => {
    fixture.componentRef.setInput('days', period());
    fixture.componentRef.setInput('today', '2026-11-18');
    fixture.componentRef.setInput('startOfNextDayDiffMs', 0);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  beforeEach(async () => {
    moveItemToDay = jasmine.createSpy('moveItemToDay');
    await TestBed.configureTestingModule({
      imports: [CalendarWeekViewComponent, TranslateModule.forRoot()],
      providers: [
        { provide: CalendarScheduleService, useValue: { moveItemToDay } },
        {
          provide: DateTimeFormatService,
          useValue: {
            formatTime: () => '10:00',
            textLocale: () => 'en-GB',
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CalendarWeekViewComponent);
  });

  it('renders seven day rows, all-day tasks and overlap marks', () => {
    render();
    const rows = fixture.nativeElement.querySelectorAll('.week-day');
    expect(rows.length).toBe(7);
    expect(fixture.nativeElement.textContent).toContain('Standup');
    expect(fixture.nativeElement.textContent).toContain('Inbox');
    const bang = fixture.nativeElement.querySelector('.overlap');
    expect(bang).toBeTruthy();
    expect(bang.getAttribute('role')).toBe('img');
    expect(fixture.nativeElement.querySelector('.week-day.is-today')).toBeTruthy();
  });

  it('emits openDay when the day header is clicked', () => {
    const cmp = render();
    const spy = jasmine.createSpy('openDay');
    cmp.openDay.subscribe(spy);
    const todayHead = fixture.nativeElement.querySelector(
      '.week-day.is-today .week-day-head',
    ) as HTMLButtonElement;
    todayHead.click();
    expect(spy).toHaveBeenCalledWith('2026-11-18');
  });

  it('moves a timed task on drop onto another day', () => {
    render();
    const task = fixture.nativeElement.querySelectorAll('.week-task:not(.is-all-day)')[0];
    const target = fixture.nativeElement.querySelector(
      '[data-cal-day="2026-11-20"]',
    ) as HTMLElement;
    const from = task.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    task.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: from.x + 4,
        clientY: from.y + 4,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: to.x + 8,
        clientY: to.y + 8,
        bubbles: true,
      }),
    );
    spyOn(document, 'elementFromPoint').and.returnValue(target);
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: to.x + 8,
        clientY: to.y + 8,
        bubbles: true,
      }),
    );
    expect(moveItemToDay).toHaveBeenCalledWith(
      't1',
      '2026-11-18',
      '2026-11-20',
      0,
      false,
    );
  });

  it('plans an all-day task for the drop day', () => {
    render();
    const task = fixture.nativeElement.querySelector('.week-task.is-all-day');
    const target = fixture.nativeElement.querySelector(
      '[data-cal-day="2026-11-18"]',
    ) as HTMLElement;
    const from = task.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    task.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 7,
        pointerType: 'mouse',
        button: 0,
        clientX: from.x + 4,
        clientY: from.y + 4,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 7,
        pointerType: 'mouse',
        clientX: to.x + 8,
        clientY: to.y + 8,
        bubbles: true,
      }),
    );
    spyOn(document, 'elementFromPoint').and.returnValue(target);
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 7,
        pointerType: 'mouse',
        clientX: to.x + 8,
        clientY: to.y + 8,
        bubbles: true,
      }),
    );
    expect(moveItemToDay).toHaveBeenCalledWith('a1', '2026-11-16', '2026-11-18', 0, true);
  });

  it('does not start a touch drag before the long-press', fakeAsync(() => {
    render();
    const task = fixture.nativeElement.querySelectorAll('.week-task:not(.is-all-day)')[0];
    const from = task.getBoundingClientRect();
    task.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 3,
        pointerType: 'touch',
        button: 0,
        clientX: from.x + 4,
        clientY: from.y + 4,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 3,
        pointerType: 'touch',
        clientX: from.x + 4,
        clientY: from.y + 20,
        bubbles: true,
      }),
    );
    expect(fixture.componentInstance.drag()?.active).not.toBeTrue();
    tick(CALENDAR_DAY_TOUCH_LONG_PRESS_MS);
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 3,
        pointerType: 'touch',
        clientX: from.x + 4,
        clientY: from.y + 20,
        bubbles: true,
      }),
    );
    expect(moveItemToDay).not.toHaveBeenCalled();
  }));

  it('cancels the drag on lostpointercapture', () => {
    render();
    const task = fixture.nativeElement.querySelectorAll('.week-task:not(.is-all-day)')[0];
    const from = task.getBoundingClientRect();
    task.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 4,
        pointerType: 'mouse',
        button: 0,
        clientX: from.x + 4,
        clientY: from.y + 4,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent('lostpointercapture', {
        pointerId: 4,
        bubbles: true,
      }),
    );
    expect(fixture.componentInstance.drag()).toBeNull();
  });

  it('previews Alt+arrow repeats and moves once on keyup', () => {
    const cmp = render();
    const task = fixture.nativeElement.querySelectorAll('.week-task:not(.is-all-day)')[0];
    const down = (repeat = false): void => {
      task.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
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
    expect(moveItemToDay).not.toHaveBeenCalled();
    expect(cmp.drag()?.fromKeyboard).toBeTrue();
    expect(cmp.drag()?.dropDay).toBe('2026-11-20');
    expect(cmp.isDropTarget('2026-11-20')).toBeTrue();

    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(moveItemToDay).toHaveBeenCalledTimes(1);
    expect(moveItemToDay).toHaveBeenCalledWith(
      't1',
      '2026-11-18',
      '2026-11-20',
      0,
      false,
    );
    expect(cmp.drag()).toBeNull();
  });

  it('cancels a keyboard preview if the task blurs, so a later keyup does not move', () => {
    const cmp = render();
    const task = fixture.nativeElement.querySelectorAll('.week-task:not(.is-all-day)')[0];
    task.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();
    expect(cmp.drag()?.fromKeyboard).toBeTrue();

    task.dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();
    expect(cmp.drag()).toBeNull();

    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(moveItemToDay).not.toHaveBeenCalled();
  });

  it('cancels a keyboard preview when the tab becomes hidden', () => {
    const cmp = render();
    const task = fixture.nativeElement.querySelectorAll('.week-task:not(.is-all-day)')[0];
    task.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();
    expect(cmp.drag()?.fromKeyboard).toBeTrue();

    const previous = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
      expect(cmp.drag()).toBeNull();
      window.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }),
      );
      fixture.detectChanges();
      expect(moveItemToDay).not.toHaveBeenCalled();
    } finally {
      if (previous) {
        Object.defineProperty(document, 'visibilityState', previous);
      } else {
        const proto = Object.getOwnPropertyDescriptor(
          Document.prototype,
          'visibilityState',
        );
        if (proto) {
          Object.defineProperty(document, 'visibilityState', proto);
        }
      }
    }
  });

  it('restores keyboard focus to the moved task after a relayout', () => {
    render();
    const task = fixture.nativeElement.querySelector(
      '.week-task[data-cal-item="t1"]',
    ) as HTMLElement;
    task.focus();
    const focusSpy = spyOn(HTMLElement.prototype, 'focus').and.callThrough();
    task.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    const days = period().map((day) => {
      if (day.day === '2026-11-18') {
        return { ...day, timed: day.timed.filter((item) => item.id !== 't1') };
      }
      if (day.day === '2026-11-19') {
        return {
          ...day,
          timed: [
            {
              id: 't1',
              title: 'Standup',
              isDone: false,
              startMs: START + tenHoursMs,
              durationMs: 30 * 60 * 1000,
            },
          ],
        };
      }
      return day;
    });
    fixture.componentRef.setInput('days', days);
    fixture.detectChanges();
    expect(
      focusSpy.calls
        .all()
        .some((c) => (c.object as HTMLElement).getAttribute?.('data-cal-item') === 't1'),
    ).toBeTrue();
  });
});
