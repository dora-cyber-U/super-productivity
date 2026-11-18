import { CUSTOM_ELEMENTS_SCHEMA, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { LS } from '../../core/persistence/storage-keys.const';
import { CalendarPanelStateService } from './calendar-panel-state.service';
import { CalendarPanelComponent } from './calendar-panel.component';
import { TaskService } from '../tasks/task.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { GlobalConfigService } from '../config/global-config.service';
import { EMPTY_CALENDAR_DAY_VIEW } from './calendar-panel.model';
import {
  selectCalendarDayView,
  selectCalendarPeriodView,
  selectCalendarTodayStatus,
} from './calendar-panel.selectors';
import { selectStartOfNextDayDiffMs } from '../../root-store/app-state/app-state.selectors';
import { selectAllTasksInActiveProjects } from '../tasks/store/task.selectors';

/**
 * Макет як у app.component: центр (flex: 1) і календар у flex-рядку; у центрі —
 * right-panel зі списком (.content) і, за потреби, панеллю деталей (.side).
 */
@Component({
  imports: [CalendarPanelComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div
      style="display: flex; height: 400px"
      [style.width.px]="width()"
    >
      <main
        class="main-content"
        style="flex: 1; min-width: 0; display: flex"
      >
        <right-panel style="display: flex; flex: 1; min-width: 0">
          <div
            class="content"
            style="flex: 1; min-width: 0"
          ></div>
          @if (isDetailsOpen()) {
            <div
              class="side"
              style="width: 400px; flex-shrink: 0"
            ></div>
          }
        </right-panel>
      </main>
      <calendar-panel></calendar-panel>
    </div>
    <button class="outside">outside</button>
  `,
})
class LayoutHostComponent {
  readonly width = signal(1400);
  readonly isDetailsOpen = signal(false);
}

const nextFrames = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
};

describe('CalendarPanelComponent', () => {
  let fixture: ComponentFixture<LayoutHostComponent>;
  let store: MockStore;

  const panel = (): HTMLElement =>
    fixture.nativeElement.querySelector('calendar-panel') as HTMLElement;
  const toggleBtn = (): HTMLButtonElement =>
    panel().querySelector('.panel-toggle') as HTMLButtonElement;
  const render = async (): Promise<void> => {
    fixture.detectChanges();
    await nextFrames();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    localStorage.removeItem(LS.IS_CALENDAR_PANEL_EXPANDED);
    await TestBed.configureTestingModule({
      imports: [LayoutHostComponent, TranslateModule.forRoot(), NoopAnimationsModule],
      providers: [
        {
          provide: TaskService,
          useValue: {
            add: () => 'id',
            update: () => undefined,
            getByIdOnce$: () => ({ subscribe: () => undefined }),
          },
        },
        {
          provide: DateTimeFormatService,
          useValue: {
            formatTime: () => '10:00',
            textLocale: () => 'en-GB',
            currentLocale: () => 'en-GB',
          },
        },
        {
          provide: GlobalConfigService,
          useValue: { localization: () => ({ firstDayOfWeek: 1 }) },
        },
        provideMockStore({
          selectors: [
            {
              selector: selectCalendarTodayStatus,
              value: { done: 3, total: 8, overdue: 0 },
            },
            { selector: selectStartOfNextDayDiffMs, value: 0 },
            { selector: selectAllTasksInActiveProjects, value: [] },
            { selector: selectCalendarDayView, value: EMPTY_CALENDAR_DAY_VIEW },
            { selector: selectCalendarPeriodView, value: [] },
          ],
        }),
      ],
    }).compileComponents();
    store = TestBed.inject(MockStore);
    // Типовий стан не залежить від ширини вікна, у якому біжить Karma
    TestBed.inject(CalendarPanelStateService).setExpanded(true);
    fixture = TestBed.createComponent(LayoutHostComponent);
    await render();
  });

  afterEach(() => localStorage.removeItem(LS.IS_CALENDAR_PANEL_EXPANDED));

  it('docked: header with three labelled view modes and today progress', () => {
    expect(panel().dataset['mode']).toBe('docked');
    expect(panel().getBoundingClientRect().width).toBe(340);
    const modes = panel().querySelectorAll('mat-button-toggle button');
    expect(modes.length).toBe(3);
    // F4: aria-label через input mat-button-toggle — на самій кнопці
    modes.forEach((b) => expect(b.getAttribute('aria-label')).toBeTruthy());
    expect(panel().querySelector('.today-progress-bar')?.getAttribute('style')).toContain(
      'width: 38%',
    );
  });

  it('F3: one persistent toggle keeps focus and reflects aria-expanded', async () => {
    const btn = toggleBtn();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-controls')).toBe('calendar-panel-content');
    expect(panel().querySelector('#calendar-panel-content')).not.toBeNull();

    btn.focus();
    btn.click();
    await render();

    expect(toggleBtn()).toBe(btn);
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(panel().dataset['mode']).toBe('strip');
    expect(panel().getBoundingClientRect().width).toBe(36);
    expect(panel().querySelector('.panel')).toBeNull();
    expect(panel().querySelector('.mini-status')?.textContent).toBe('3/8');
    expect(localStorage.getItem(LS.IS_CALENDAR_PANEL_EXPANDED)).toBe('false');

    btn.click();
    await render();
    expect(document.activeElement).toBe(btn);
    expect(panel().dataset['mode']).toBe('docked');
    expect(localStorage.getItem(LS.IS_CALENDAR_PANEL_EXPANDED)).toBe('true');
  });

  describe('F1: narrow centre', () => {
    beforeEach(async () => {
      // 800 − 340 = 460 < 480: колонці поруч зі списком місця немає
      fixture.componentInstance.width.set(800);
      await render();
    });

    it('shows the strip instead of squeezing the list, keeping the stored choice', () => {
      expect(panel().dataset['mode']).toBe('strip');
      expect(panel().getBoundingClientRect().width).toBe(36);
      expect(localStorage.getItem(LS.IS_CALENDAR_PANEL_EXPANDED)).toBe('true');
    });

    it('opens the calendar as an overlay; Esc closes it; the choice is untouched', async () => {
      toggleBtn().click();
      await render();

      expect(panel().dataset['mode']).toBe('overlay');
      expect(toggleBtn().getAttribute('aria-expanded')).toBe('true');
      // колонка не росте — список не стискається
      expect(panel().getBoundingClientRect().width).toBe(36);
      expect(panel().querySelector('.panel')).not.toBeNull();

      panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await render();
      expect(panel().dataset['mode']).toBe('strip');
      expect(localStorage.getItem(LS.IS_CALENDAR_PANEL_EXPANDED)).toBe('true');
    });

    it('L3: a click outside closes the overlay, a click inside does not', async () => {
      toggleBtn().click();
      await render();

      const inside = panel().querySelector('.panel-body') as HTMLElement;
      inside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await render();
      expect(panel().dataset['mode']).toBe('overlay');

      const outside = fixture.nativeElement.querySelector('.outside') as HTMLElement;
      outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await render();
      expect(panel().dataset['mode']).toBe('strip');
      expect(localStorage.getItem(LS.IS_CALENDAR_PANEL_EXPANDED)).toBe('true');
    });

    const pointer = (type: string, extra: PointerEventInit = {}): PointerEvent =>
      new PointerEvent(type, { bubbles: true, pointerId: 1, ...extra });
    const mouse = (type: string, extra: MouseEventInit = {}): MouseEvent =>
      new MouseEvent(type, { bubbles: true, cancelable: true, ...extra });
    const trackClicks = (
      el: HTMLElement,
    ): { received: string[]; add: () => void; remove: () => void } => {
      const received: string[] = [];
      const onClick = (): void => {
        received.push('click');
      };
      const onDblClick = (): void => {
        received.push('dblclick');
      };
      return {
        received,
        add: () => {
          el.addEventListener('click', onClick);
          el.addEventListener('dblclick', onDblClick);
        },
        remove: () => {
          el.removeEventListener('click', onClick);
          el.removeEventListener('dblclick', onDblClick);
        },
      };
    };

    it('N1: swallows the click and dblclick that closed the overlay, not a later click', async () => {
      toggleBtn().click();
      await render();

      const outside = fixture.nativeElement.querySelector('.outside') as HTMLElement;
      const track = trackClicks(outside);
      track.add();

      outside.dispatchEvent(pointer('pointerdown'));
      await render();
      expect(panel().dataset['mode']).toBe('strip');
      outside.dispatchEvent(pointer('pointerup'));

      // той самий жест: перший click і другий click (detail > 1) + dblclick
      outside.dispatchEvent(mouse('click', { detail: 1 }));
      outside.dispatchEvent(mouse('click', { detail: 2 }));
      outside.dispatchEvent(mouse('dblclick'));
      expect(track.received).toEqual([]);

      await new Promise((resolve) => setTimeout(resolve, 550));
      outside.dispatchEvent(mouse('click', { detail: 1 }));
      expect(track.received).toEqual(['click']);
      track.remove();
    });

    it('P2: a long press outside still swallows the late click', async () => {
      toggleBtn().click();
      await render();

      const outside = fixture.nativeElement.querySelector('.outside') as HTMLElement;
      const track = trackClicks(outside);
      track.add();

      outside.dispatchEvent(pointer('pointerdown'));
      await render();
      expect(panel().dataset['mode']).toBe('strip');

      await new Promise((resolve) => setTimeout(resolve, 700));
      outside.dispatchEvent(pointer('pointerup'));
      outside.dispatchEvent(mouse('click', { detail: 1 }));
      expect(track.received).toEqual([]);
      track.remove();
    });

    it('P1: a drag without a click does not swallow the next click', async () => {
      toggleBtn().click();
      await render();

      const outside = fixture.nativeElement.querySelector('.outside') as HTMLElement;
      const track = trackClicks(outside);
      track.add();

      outside.dispatchEvent(pointer('pointerdown'));
      await render();
      expect(panel().dataset['mode']).toBe('strip');
      outside.dispatchEvent(pointer('pointerup'));
      // click цього жесту не було — слухачі мають знятися
      await new Promise((resolve) => setTimeout(resolve, 80));
      outside.dispatchEvent(mouse('click', { detail: 1 }));
      expect(track.received).toEqual(['click']);
      track.remove();
    });

    it('P1: a click on the toggle right after close reopens the overlay', async () => {
      toggleBtn().click();
      await render();

      const outside = fixture.nativeElement.querySelector('.outside') as HTMLElement;
      outside.dispatchEvent(pointer('pointerdown'));
      outside.dispatchEvent(pointer('pointerup'));
      outside.dispatchEvent(mouse('click', { detail: 1 }));
      await render();
      expect(panel().dataset['mode']).toBe('strip');

      toggleBtn().click();
      await render();
      expect(panel().dataset['mode']).toBe('overlay');
    });

    it('P1: pointercancel clears swallow listeners so the next click passes', async () => {
      toggleBtn().click();
      await render();

      const outside = fixture.nativeElement.querySelector('.outside') as HTMLElement;
      const track = trackClicks(outside);
      track.add();

      outside.dispatchEvent(pointer('pointerdown'));
      await render();
      expect(panel().dataset['mode']).toBe('strip');
      outside.dispatchEvent(pointer('pointercancel'));
      outside.dispatchEvent(mouse('click', { detail: 1 }));
      expect(track.received).toEqual(['click']);
      track.remove();
    });

    it('Info: a later pointer of another id ends the swallow window', async () => {
      toggleBtn().click();
      await render();

      const outside = fixture.nativeElement.querySelector('.outside') as HTMLElement;
      const track = trackClicks(outside);
      track.add();

      // pointerdown без pointerup того самого id — раніше вікно трималось 8 с
      outside.dispatchEvent(pointer('pointerdown', { pointerId: 1 }));
      await render();
      expect(panel().dataset['mode']).toBe('strip');

      outside.dispatchEvent(pointer('pointerdown', { pointerId: 2 }));
      outside.dispatchEvent(pointer('pointerup', { pointerId: 2 }));
      outside.dispatchEvent(mouse('click', { detail: 1 }));
      expect(track.received).toEqual(['click']);
      track.remove();
    });

    it('docks again once the window is wide enough', async () => {
      fixture.componentInstance.width.set(1400);
      await render();
      expect(panel().dataset['mode']).toBe('docked');
    });
  });

  it('L1: counts the list without the task details panel', async () => {
    fixture.componentInstance.width.set(1200);
    await render();
    expect(panel().dataset['mode']).toBe('docked');

    // 1200 − 340 − 400 (деталі) = 460 < 480: сам список був би завузьким
    fixture.componentInstance.isDetailsOpen.set(true);
    await render();
    expect(panel().dataset['mode']).toBe('strip');
    const list = fixture.nativeElement.querySelector('.content') as HTMLElement;
    expect(list.getBoundingClientRect().width).toBeGreaterThanOrEqual(480);
    expect(localStorage.getItem(LS.IS_CALENDAR_PANEL_EXPANDED)).toBe('true');

    fixture.componentInstance.isDetailsOpen.set(false);
    await render();
    expect(panel().dataset['mode']).toBe('docked');
  });

  it('F7: mentions tasks from previous days in the status', async () => {
    store.overrideSelector(selectCalendarTodayStatus, { done: 1, total: 3, overdue: 2 });
    store.refreshState();
    await render();

    expect(panel().querySelector('.today-status-text')?.textContent).toContain(
      'TODAY_DONE_OVERDUE',
    );
  });

  it('updates the status when today progress changes', async () => {
    store.overrideSelector(selectCalendarTodayStatus, { done: 8, total: 8, overdue: 0 });
    store.refreshState();
    await render();

    expect(panel().querySelector('.today-progress-bar')?.getAttribute('style')).toContain(
      'width: 100%',
    );
  });
});
