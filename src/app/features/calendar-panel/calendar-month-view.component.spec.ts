import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { CalendarDayView } from './calendar-panel.model';
import { CalendarScheduleService } from './calendar-schedule.service';
import { CalendarMonthViewComponent } from './calendar-month-view.component';
import { logicalDayStartMs } from './calendar-day.util';
import { monthGridDays } from './calendar-period.util';

const MONTH = '2026-11-18';
const DAYS = monthGridDays(MONTH, 1);
const START = logicalDayStartMs('2026-11-18', 0);
const HOUR = 60 * 60 * 1000;
const tenHoursMs = 10 * HOUR;
const fourteenHoursMs = 14 * HOUR;

const empty = (day: string): CalendarDayView => ({ day, allDay: [], timed: [] });

const period = (): CalendarDayView[] =>
  DAYS.map((day) => {
    if (day === '2026-11-18') {
      return {
        day,
        allDay: [
          { id: 'a1', title: 'Inbox', isDone: false, startMs: null, durationMs: 0 },
        ],
        timed: [
          {
            id: 't1',
            title: 'Standup',
            isDone: false,
            startMs: START + tenHoursMs,
            durationMs: 30 * 60 * 1000,
          },
          {
            id: 't2',
            title: 'Review',
            isDone: false,
            startMs: START + fourteenHoursMs,
            durationMs: 30 * 60 * 1000,
          },
        ],
      };
    }
    return empty(day);
  });

describe('CalendarMonthViewComponent', () => {
  let fixture: ComponentFixture<CalendarMonthViewComponent>;
  let moveItemToDay: jasmine.Spy;

  const render = (): CalendarMonthViewComponent => {
    fixture.componentRef.setInput('days', period());
    fixture.componentRef.setInput('today', '2026-11-18');
    fixture.componentRef.setInput('monthDay', MONTH);
    fixture.componentRef.setInput('startOfNextDayDiffMs', 0);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  beforeEach(async () => {
    moveItemToDay = jasmine.createSpy('moveItemToDay');
    await TestBed.configureTestingModule({
      imports: [CalendarMonthViewComponent, TranslateModule.forRoot()],
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
    fixture = TestBed.createComponent(CalendarMonthViewComponent);
  });

  it('renders a 6-week grid with +N when a day has more than two tasks', () => {
    render();
    expect(fixture.nativeElement.querySelectorAll('.month-cell').length).toBe(42);
    expect(fixture.nativeElement.textContent).toContain('Inbox');
    expect(fixture.nativeElement.textContent).toContain('Standup');
    expect(fixture.nativeElement.querySelector('.month-more')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.month-cell.is-today')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-cal-day="2026-10-26"].is-outside'),
    ).toBeTruthy();
  });

  it('emits openDay when the day number is clicked', () => {
    const cmp = render();
    const spy = jasmine.createSpy('openDay');
    cmp.openDay.subscribe(spy);
    const btn = fixture.nativeElement.querySelector(
      '.month-cell.is-today .month-day-num',
    ) as HTMLButtonElement;
    btn.click();
    expect(spy).toHaveBeenCalledWith('2026-11-18');
  });

  it('moves a timed task dropped on another day', () => {
    render();
    const task = fixture.nativeElement.querySelectorAll('.month-task')[1]; // Standup
    const target = fixture.nativeElement.querySelector(
      '[data-cal-day="2026-11-20"]',
    ) as HTMLElement;
    const from = task.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    task.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 2,
        pointerType: 'mouse',
        button: 0,
        clientX: from.x + 2,
        clientY: from.y + 2,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 2,
        pointerType: 'mouse',
        clientX: to.x + 8,
        clientY: to.y + 8,
        bubbles: true,
      }),
    );
    spyOn(document, 'elementFromPoint').and.returnValue(target);
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 2,
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

  it('plans a no-time task dropped on another day as all-day', () => {
    render();
    const task = fixture.nativeElement.querySelector('.month-task.is-all-day');
    const target = fixture.nativeElement.querySelector(
      '[data-cal-day="2026-11-25"]',
    ) as HTMLElement;
    const from = task.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    task.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 5,
        pointerType: 'mouse',
        button: 0,
        clientX: from.x + 2,
        clientY: from.y + 2,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 5,
        pointerType: 'mouse',
        clientX: to.x + 8,
        clientY: to.y + 8,
        bubbles: true,
      }),
    );
    spyOn(document, 'elementFromPoint').and.returnValue(target);
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 5,
        pointerType: 'mouse',
        clientX: to.x + 8,
        clientY: to.y + 8,
        bubbles: true,
      }),
    );
    expect(moveItemToDay).toHaveBeenCalledWith('a1', '2026-11-18', '2026-11-25', 0, true);
  });

  it('previews Alt+arrow repeats and moves once on keyup', () => {
    const cmp = render();
    const task = fixture.nativeElement.querySelector(
      '.month-task[data-cal-item="t1"]',
    ) as HTMLElement;
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
});
