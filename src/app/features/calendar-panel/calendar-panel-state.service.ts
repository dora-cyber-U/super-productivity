import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { DateService } from '../../core/date/date.service';
import { selectTodayStr } from '../../root-store/app-state/app-state.selectors';
import { LS } from '../../core/persistence/storage-keys.const';
import {
  CALENDAR_DEFAULT_TIME_STEP,
  CALENDAR_PANEL_DEFAULT_EXPANDED_MEDIA,
} from './calendar-panel.const';
import { CalendarTimeStep, CalendarViewMode } from './calendar-panel.model';
import { isCalendarTimeStep, shiftDayStr } from './calendar-day.util';
import { periodContainsDay, shiftMonthStr } from './calendar-period.util';
import { UiPrefDurableStore } from './ui-pref-durable-store';

const PREF_KEY = LS.IS_CALENDAR_PANEL_EXPANDED;
const STEP_KEY = LS.CALENDAR_PANEL_TIME_STEP;

/**
 * Стан правої панелі-календаря.
 *
 * «Розгорнуто / згорнуто» — локальне налаштування інтерфейсу цього пристрою,
 * поза op-log і синхронізацією:
 * - поки користувач нічого не обирав, панель розгорнута лише на широкому
 *   вікні (≥ 1280 px) і стежить за його шириною;
 * - вибір користувача пишеться в localStorage (синхронно, для першого кадру)
 *   і в IndexedDB (переживає kill, див. UiPrefDurableStore); після старту
 *   значення з IndexedDB виправляє застарілу копію localStorage.
 */
@Injectable({ providedIn: 'root' })
export class CalendarPanelStateService {
  private readonly _durable = inject(UiPrefDurableStore);

  /** null — користувач ще не обирав. */
  private readonly _userChoice = signal<boolean | null>(readLsChoice());
  private readonly _isWideViewport = signal(false);
  private readonly _viewMode = signal<CalendarViewMode>('day');
  private readonly _date = inject(DateService);
  private readonly _store = inject(Store);
  /** «Сьогодні» зі стору (оновлюється опівночі), не разовий виклик DateService. */
  private readonly _storeTodayStr = this._store.selectSignal(selectTodayStr);
  private readonly _visibleDay = signal<string>(
    this._storeTodayStr() || this._date.todayStr(),
  );
  /** Останнє «сьогодні», за яким стежили, щоб перевести панель лише якщо користувач був на сьогодні. */
  private _followedToday: string | null = null;
  private readonly _timeStep = signal<CalendarTimeStep>(readLsStep());
  private _isChangedThisSession = false;
  private _isStepChangedThisSession = false;

  /** Бажаний стан: вибір користувача або типовий за шириною вікна. */
  readonly isExpanded = computed(() => this._userChoice() ?? this._isWideViewport());
  readonly viewMode = this._viewMode.asReadonly();
  /** Видимий день (YYYY-MM-DD), локально для пристрою, без op-log. */
  readonly visibleDay = this._visibleDay.asReadonly();
  /** Поточний логічний день зі стору; падає на DateService, доки стор не готовий. */
  readonly todayStr = computed(() => this._storeTodayStr() || this._date.todayStr());
  /** Крок шкали дня; зберігається як і стан розгортання. */
  readonly timeStep = this._timeStep.asReadonly();
  /** Завершилось звіряння з IndexedDB (для тестів і діагностики). */
  readonly restored: Promise<void>;

  constructor() {
    const mql =
      typeof window !== 'undefined'
        ? window.matchMedia?.(CALENDAR_PANEL_DEFAULT_EXPANDED_MEDIA)
        : undefined;
    if (mql) {
      this._isWideViewport.set(mql.matches);
      // Подія лише на перетині межі — без підписки на кожен resize
      const onChange = (e: MediaQueryListEvent): void =>
        this._isWideViewport.set(e.matches);
      mql.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', onChange));
    }
    this.restored = this._restoreDurable();
    // Якщо користувач дивився «сьогодні», після зміни дня в сторі переходимо на новий день.
    effect(() => {
      const today = this._storeTodayStr() || this._date.todayStr();
      if (!today) {
        return;
      }
      const followed = this._followedToday;
      if (followed && today !== followed) {
        const visible = untracked(() => this._visibleDay());
        const mode = untracked(() => this._viewMode());
        if (
          periodContainsDay(visible, followed, mode) &&
          !periodContainsDay(visible, today, mode)
        ) {
          untracked(() => this._visibleDay.set(today));
        }
      }
      this._followedToday = today;
    });
  }

  toggle(): void {
    this.setExpanded(!this.isExpanded());
  }

  setExpanded(isExpanded: boolean): void {
    this._isChangedThisSession = true;
    this._userChoice.set(isExpanded);
    writeLsChoice(isExpanded);
    void this._durable.set(PREF_KEY, String(isExpanded));
  }

  setViewMode(mode: CalendarViewMode): void {
    this._viewMode.set(mode);
  }

  goToday(): void {
    this._visibleDay.set(this.todayStr());
  }

  goBy(delta: number, mode: CalendarViewMode = 'day'): void {
    const day = this._visibleDay();
    if (mode === 'week') {
      this._visibleDay.set(shiftDayStr(day, delta * 7));
      return;
    }
    if (mode === 'month') {
      this._visibleDay.set(shiftMonthStr(day, delta));
      return;
    }
    this._visibleDay.set(shiftDayStr(day, delta));
  }

  setVisibleDay(day: string): void {
    this._visibleDay.set(day);
  }

  setTimeStep(step: CalendarTimeStep): void {
    this._isStepChangedThisSession = true;
    this._timeStep.set(step);
    writeLsStep(step);
    void this._durable.set(STEP_KEY, String(step));
  }

  /** Після kill localStorage міг не встигнути на диск — віримо IndexedDB. */
  private async _restoreDurable(): Promise<void> {
    const [stored, storedStep] = await Promise.all([
      this._durable.get(PREF_KEY),
      this._durable.get(STEP_KEY),
    ]);
    if (!this._isChangedThisSession && (stored === 'true' || stored === 'false')) {
      const choice = stored === 'true';
      if (choice !== this._userChoice()) {
        this._userChoice.set(choice);
        writeLsChoice(choice);
      }
    }
    const step = Number(storedStep);
    if (
      !this._isStepChangedThisSession &&
      isCalendarTimeStep(step) &&
      step !== this._timeStep()
    ) {
      this._timeStep.set(step);
      writeLsStep(step);
    }
  }
}

const readLsChoice = (): boolean | null => {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw === 'true' ? true : raw === 'false' ? false : null;
  } catch {
    return null;
  }
};

const writeLsChoice = (isExpanded: boolean): void => {
  try {
    localStorage.setItem(PREF_KEY, String(isExpanded));
  } catch {
    // localStorage недоступний — лишається копія в IndexedDB
  }
};

const readLsStep = (): CalendarTimeStep => {
  try {
    const parsed = Number(localStorage.getItem(STEP_KEY));
    return isCalendarTimeStep(parsed) ? parsed : CALENDAR_DEFAULT_TIME_STEP;
  } catch {
    return CALENDAR_DEFAULT_TIME_STEP;
  }
};

const writeLsStep = (step: CalendarTimeStep): void => {
  try {
    localStorage.setItem(STEP_KEY, String(step));
  } catch {
    // localStorage недоступний — лишається копія в IndexedDB
  }
};
