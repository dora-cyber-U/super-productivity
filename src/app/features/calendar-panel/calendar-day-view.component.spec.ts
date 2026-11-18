import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { TranslateModule } from '@ngx-translate/core';
import { TaskService } from '../tasks/task.service';
import { CalendarDayViewComponent } from './calendar-day-view.component';
import { CalendarDayItem } from './calendar-panel.model';
import { logicalDayStartMs } from './calendar-day.util';
import { CALENDAR_DAY_HEIGHT_PX } from './calendar-panel.const';

const DAY = '2026-11-17';
const START = logicalDayStartMs(DAY, 0);
const HOUR_MS = 60 * 60 * 1000;
const tenHoursMs = 10 * HOUR_MS;

describe('CalendarDayViewComponent', () => {
  let fixture: ComponentFixture<CalendarDayViewComponent>;
  let add: jasmine.Spy;

  const render = (): CalendarDayViewComponent => {
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  beforeEach(async () => {
    add = jasmine.createSpy('add');
    await TestBed.configureTestingModule({
      imports: [CalendarDayViewComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: TaskService,
          useValue: { add },
        },
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

  it('opens the composer on a double-click that lands on a long background band', () => {
    fixture.componentRef.setInput('timed', [
      {
        id: 'huge',
        title: 'Marathon',
        isDone: false,
        startMs: START + HOUR_MS,
        durationMs: 30 * HOUR_MS,
      },
    ]);
    const cmp = render();
    const scale = fixture.nativeElement.querySelector('.scale') as HTMLElement;
    const band = fixture.nativeElement.querySelector('.day-block.is-band') as HTMLElement;
    expect(band).toBeTruthy();
    // Смуга має отримувати мишу (підказка, зміна тривалості), а дабл-клік
    // все одно відкриває композер.
    expect(getComputedStyle(band).pointerEvents).not.toBe('none');
    spyOn(scale, 'getBoundingClientRect').and.returnValue({ top: 0 } as DOMRect);

    const y = (10 / 24) * CALENDAR_DAY_HEIGHT_PX;
    band.dispatchEvent(
      new MouseEvent('dblclick', { clientY: y, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.day-composer input')).toBeTruthy();
    expect(cmp.composer()?.minutes).toBe(10 * 60);
  });
});
