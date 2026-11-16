import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { CalendarPanelStateService } from './calendar-panel-state.service';
import { CalendarViewMode } from './calendar-panel.model';
import { selectCalendarTodayStatus } from './calendar-panel.selectors';

/**
 * Права колонка макета: календар (поки каркас).
 *
 * Окрема постійна колонка, а не ще один вміст наявної right-panel: та
 * відкривається лише під конкретний вміст (деталі задачі, нотатки, день
 * розкладу) і закривається разом із ним, а календар має бути завжди під
 * рукою і пам'ятати, згорнутий він чи ні.
 *
 * Згорнута панель — вузька смуга з іконкою і лічильником «X/Y» на межі з
 * центральною колонкою; розгорнута — шапка з перемикачем режимів, статус
 * «сьогодні виконано X з Y» і місце під календар.
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
    '[class.isExpanded]': 'isExpanded()',
  },
})
export class CalendarPanelComponent {
  private readonly _state = inject(CalendarPanelStateService);

  readonly T = T;
  readonly isExpanded = this._state.isExpanded;
  readonly viewMode = this._state.viewMode;
  readonly viewModes: readonly { mode: CalendarViewMode; icon: string; label: string }[] =
    [
      { mode: 'day', icon: 'view_day', label: T.F.CALENDAR_PANEL.DAY },
      { mode: 'week', icon: 'view_week', label: T.F.CALENDAR_PANEL.WEEK },
      { mode: 'month', icon: 'calendar_view_month', label: T.F.CALENDAR_PANEL.MONTH },
    ];

  /** Одна підписка на мемоізований селектор: перемальовується лише при зміні X чи Y. */
  readonly status = inject(Store).selectSignal(selectCalendarTodayStatus);
  readonly donePercent = computed(() => {
    const { done, total } = this.status();
    return total ? Math.round((done / total) * 100) : 0;
  });

  toggle(): void {
    this._state.toggle();
  }

  setViewMode(mode: CalendarViewMode): void {
    this._state.setViewMode(mode);
  }
}
