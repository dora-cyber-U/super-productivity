import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { switchMap } from 'rxjs/operators';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { T } from '../../t.const';
import { CalendarDayViewComponent } from './calendar-day-view.component';
import { CalendarPanelStateService } from './calendar-panel-state.service';
import {
  CALENDAR_PANEL_MIN_CENTRE_PX,
  CALENDAR_PANEL_WIDTH_PX,
  CALENDAR_TIME_STEPS,
} from './calendar-panel.const';
import {
  CalendarPanelMode,
  CalendarTimeStep,
  CalendarViewMode,
  EMPTY_CALENDAR_DAY_VIEW,
} from './calendar-panel.model';
import {
  selectCalendarDayView,
  selectCalendarTodayStatus,
} from './calendar-panel.selectors';
import { selectStartOfNextDayDiffMs } from '../../root-store/app-state/app-state.selectors';

/**
 * Права колонка макета: календар (поки каркас).
 *
 * Окрема постійна колонка, а не ще один вміст наявної right-panel: та
 * відкривається лише під конкретний вміст (деталі задачі, нотатки, день
 * розкладу) і закривається разом із ним, а календар має бути завжди під
 * рукою і пам'ятати, згорнутий він чи ні.
 *
 * Ліворуч завжди є смуга-мітка (36 px) з однією кнопкою-перемикачем — тож
 * фокус клавіатури не губиться. Якщо поруч із колонкою центр став би вужчим
 * за CALENDAR_PANEL_MIN_CENTRE_PX, колонка не відкривається: лишається
 * смуга, а календар відкривається поверх списку (overlay). Збережений вибір
 * користувача при цьому не змінюється.
 */
@Component({
  selector: 'calendar-panel',
  templateUrl: './calendar-panel.component.html',
  styleUrl: './calendar-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconButton,
    MatIcon,
    MatTooltip,
    MatButtonToggleGroup,
    MatButtonToggle,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    TranslatePipe,
    CalendarDayViewComponent,
  ],
  host: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[attr.data-mode]': 'mode()',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '(keydown.escape)': 'closeOverlay()',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
})
export class CalendarPanelComponent {
  private readonly _state = inject(CalendarPanelStateService);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _destroyRef = inject(DestroyRef);

  /**
   * Знімає слухачі, що глушать click/dblclick жесту, яким закрили
   * overlay. Інакше той самий клік увімкнув би quick-add.
   */
  private _disarmSwallowOutsideClick: (() => void) | null = null;

  private readonly _store = inject(Store);
  private readonly _date = inject(DateService);
  private readonly _dt = inject(DateTimeFormatService);

  readonly T = T;
  readonly contentId = 'calendar-panel-content';
  readonly viewMode = this._state.viewMode;
  readonly visibleDay = this._state.visibleDay;
  readonly timeStep = this._state.timeStep;
  readonly timeSteps = CALENDAR_TIME_STEPS;
  readonly viewModes: readonly { mode: CalendarViewMode; icon: string; label: string }[] =
    [
      { mode: 'day', icon: 'view_day', label: T.F.CALENDAR_PANEL.DAY },
      { mode: 'week', icon: 'view_week', label: T.F.CALENDAR_PANEL.WEEK },
      { mode: 'month', icon: 'calendar_view_month', label: T.F.CALENDAR_PANEL.MONTH },
    ];

  /** Чи вміщується колонка поруч зі списком (оновлює ResizeObserver). */
  private readonly _isRoomForColumn = signal(true);
  private readonly _isOverlayOpen = signal(false);

  readonly mode = computed<CalendarPanelMode>(() => {
    if (!this._isRoomForColumn()) {
      return this._isOverlayOpen() ? 'overlay' : 'strip';
    }
    return this._state.isExpanded() ? 'docked' : 'strip';
  });
  readonly isOpen = computed(() => this.mode() !== 'strip');

  /** Одна підписка на мемоізований селектор: перемальовується лише при зміні чисел. */
  readonly status = this._store.selectSignal(selectCalendarTodayStatus);
  readonly startOfNextDayDiffMs = this._store.selectSignal(selectStartOfNextDayDiffMs);
  /** Задачі видимого дня (мемоізований селектор, одна підписка). */
  readonly dayView = toSignal(
    toObservable(this.visibleDay).pipe(
      switchMap((day) => this._store.select(selectCalendarDayView, { day })),
    ),
    { initialValue: EMPTY_CALENDAR_DAY_VIEW },
  );
  readonly isViewingToday = computed(() => this.visibleDay() === this._date.todayStr());
  readonly periodLabel = computed(() => {
    const day = this.visibleDay();
    if (!day) {
      return '';
    }
    const date = new Date(`${day}T12:00:00`);
    const opts: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    };
    if (date.getFullYear() !== new Date().getFullYear()) {
      opts.year = 'numeric';
    }
    return new Intl.DateTimeFormat(this._dt.textLocale(), opts).format(date);
  });
  readonly statusKey = computed(() =>
    this.status().overdue
      ? T.F.CALENDAR_PANEL.TODAY_DONE_OVERDUE
      : T.F.CALENDAR_PANEL.TODAY_DONE,
  );
  readonly donePercent = computed(() => {
    const { done, total } = this.status();
    return total ? Math.round((done / total) * 100) : 0;
  });

  constructor() {
    this._destroyRef.onDestroy(() => this._clearSwallowOutsideClick());
    afterNextRender(() => {
      const centre = this._host.nativeElement.parentElement?.querySelector<HTMLElement>(
        ':scope > .main-content',
      );
      if (!centre || typeof ResizeObserver === 'undefined') {
        return;
      }
      // Сам список — без панелі деталей задачі (right-panel), що теж у центрі
      const list = centre.querySelector<HTMLElement>('right-panel > .content') ?? centre;
      let frame = 0;
      // Колбек лише при зміні розміру; рішення — в наступному кадрі,
      // щоб не міняти розмітку посеред циклу ResizeObserver
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => this._measure(list));
      });
      observer.observe(centre);
      observer.observe(list);
      this._destroyRef.onDestroy(() => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      });
    });
  }

  toggle(): void {
    if (this._isRoomForColumn()) {
      this._state.toggle();
    } else {
      this._isOverlayOpen.update((isOpen) => !isOpen);
    }
  }

  closeOverlay(): void {
    this._isOverlayOpen.set(false);
  }

  /** Клік поза календарем закриває overlay (Esc у quick-add не чіпаємо). */
  onDocumentPointerDown(ev: PointerEvent): void {
    if (this.mode() !== 'overlay') {
      return;
    }
    const target = ev.target as Element | null;
    // Тултіпи й меню панелі живуть у cdk-overlay — це не «поза»
    if (
      target &&
      (this._host.nativeElement.contains(target) ||
        target.closest('.cdk-overlay-container'))
    ) {
      return;
    }
    this.closeOverlay();
    this._armSwallowOutsideClick(ev.pointerId);
  }

  /**
   * Поглинає click/dblclick того самого жесту, яким закрили overlay (N1),
   * щоб вони не ввімкнули quick-add. Вікно тримається до pointerup того
   * самого pointerId, а не фіксовані 500 мс: long-press теж глушиться,
   * а після drag/swipe без click слухачі знімаються одразу. Кліки всередині
   * панелі (кнопка-перемикач) не глушимо. Пріоритет Esc у quick-add
   * не змінюємо.
   */
  private _armSwallowOutsideClick(pointerId: number): void {
    this._clearSwallowOutsideClick();
    const host = this._host.nativeElement;
    const isInsidePanel = (event: Event): boolean => {
      const target = event.target;
      return (
        target instanceof Element &&
        (host.contains(target) || target.closest('.cdk-overlay-container') !== null)
      );
    };
    const swallow = (event: Event): void => {
      event.stopPropagation();
      event.preventDefault();
    };

    let primaryClickSwallowed = false;
    let afterUpTimer = 0;
    let dblClickTimer = 0;

    const onClick = (event: MouseEvent): void => {
      if (isInsidePanel(event)) {
        return;
      }
      if (!primaryClickSwallowed) {
        swallow(event);
        primaryClickSwallowed = true;
        window.clearTimeout(afterUpTimer);
        // далі лише dblclick і click з detail > 1 того самого жесту
        dblClickTimer = window.setTimeout(() => this._clearSwallowOutsideClick(), 500);
        return;
      }
      if (event.detail > 1) {
        swallow(event);
      }
    };
    const onDblClick = (event: MouseEvent): void => {
      if (isInsidePanel(event)) {
        return;
      }
      swallow(event);
      this._clearSwallowOutsideClick();
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) {
        // інший вказівник — попередній жест завис без pointerup
        this._clearSwallowOutsideClick();
        return;
      }
      // click приходить одразу після pointerup; якщо ні — це drag/swipe
      afterUpTimer = window.setTimeout(() => {
        if (!primaryClickSwallowed) {
          this._clearSwallowOutsideClick();
        }
      }, 50);
    };
    const onPointerCancel = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) {
        return;
      }
      this._clearSwallowOutsideClick();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) {
        this._clearSwallowOutsideClick();
      }
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    // запобіжник, якщо pointerup так і не стався — слухачі не накопичуються
    const safetyTimer = window.setTimeout(() => this._clearSwallowOutsideClick(), 8000);

    this._disarmSwallowOutsideClick = () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('dblclick', onDblClick, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.clearTimeout(afterUpTimer);
      window.clearTimeout(dblClickTimer);
      window.clearTimeout(safetyTimer);
      this._disarmSwallowOutsideClick = null;
    };
  }

  private _clearSwallowOutsideClick(): void {
    this._disarmSwallowOutsideClick?.();
  }

  setViewMode(mode: CalendarViewMode): void {
    this._state.setViewMode(mode);
  }

  goToday(): void {
    this._state.goToday();
  }

  goPrev(): void {
    this._state.goBy(-1);
  }

  goNext(): void {
    this._state.goBy(1);
  }

  setTimeStep(step: CalendarTimeStep): void {
    this._state.setTimeStep(step);
  }

  /**
   * Місце, яке ділять список і календар: ширина самого списку (без панелі
   * деталей) + сама колонка. Коли колонка розгорнута, панель деталей може лише
   * звузитись, тож у розгорнутому стані це місце не менше, ніж у згорнутому, —
   * рішення не «скаче» туди-назад.
   */
  private _measure(list: HTMLElement): void {
    const shared =
      list.getBoundingClientRect().width +
      this._host.nativeElement.getBoundingClientRect().width;
    const isRoom = shared - CALENDAR_PANEL_WIDTH_PX >= CALENDAR_PANEL_MIN_CENTRE_PX;
    this._isRoomForColumn.set(isRoom);
    if (isRoom) {
      this._isOverlayOpen.set(false);
    }
  }
}
