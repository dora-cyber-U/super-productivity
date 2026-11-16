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
import { MatIconButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { CalendarPanelStateService } from './calendar-panel-state.service';
import {
  CALENDAR_PANEL_MIN_CENTRE_PX,
  CALENDAR_PANEL_WIDTH_PX,
} from './calendar-panel.const';
import { CalendarPanelMode, CalendarViewMode } from './calendar-panel.model';
import { selectCalendarTodayStatus } from './calendar-panel.selectors';

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
    TranslatePipe,
  ],
  host: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[attr.data-mode]': 'mode()',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '(keydown.escape)': 'closeOverlay()',
  },
})
export class CalendarPanelComponent {
  private readonly _state = inject(CalendarPanelStateService);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly T = T;
  readonly contentId = 'calendar-panel-content';
  readonly viewMode = this._state.viewMode;
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
  readonly status = inject(Store).selectSignal(selectCalendarTodayStatus);
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
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const centre = this._host.nativeElement.parentElement?.querySelector<HTMLElement>(
        ':scope > .main-content',
      );
      if (!centre || typeof ResizeObserver === 'undefined') {
        return;
      }
      let frame = 0;
      // Колбек лише при зміні розміру центру; рішення — в наступному кадрі,
      // щоб не міняти розмітку посеред циклу ResizeObserver
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => this._measure(centre));
      });
      observer.observe(centre);
      destroyRef.onDestroy(() => {
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

  setViewMode(mode: CalendarViewMode): void {
    this._state.setViewMode(mode);
  }

  /**
   * Місце, яке ділять центр і календар, не залежить від стану панелі
   * (центр + сама панель), тож рішення не «скаче» туди-назад.
   */
  private _measure(centre: HTMLElement): void {
    const shared =
      centre.getBoundingClientRect().width +
      this._host.nativeElement.getBoundingClientRect().width;
    const isRoom = shared - CALENDAR_PANEL_WIDTH_PX >= CALENDAR_PANEL_MIN_CENTRE_PX;
    this._isRoomForColumn.set(isRoom);
    if (isRoom) {
      this._isOverlayOpen.set(false);
    }
  }
}
