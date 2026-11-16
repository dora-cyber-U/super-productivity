import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { LS } from '../../core/persistence/storage-keys.const';
import { CALENDAR_PANEL_DEFAULT_EXPANDED_MEDIA } from './calendar-panel.const';
import { CalendarViewMode } from './calendar-panel.model';
import { UiPrefDurableStore } from './ui-pref-durable-store';

const PREF_KEY = LS.IS_CALENDAR_PANEL_EXPANDED;

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
  private _isChangedThisSession = false;

  /** Бажаний стан: вибір користувача або типовий за шириною вікна. */
  readonly isExpanded = computed(() => this._userChoice() ?? this._isWideViewport());
  /** Поки лише перемикач-заготовка; самі режими — у наступних PR. */
  readonly viewMode = this._viewMode.asReadonly();
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

  /** Після kill localStorage міг не встигнути на диск — віримо IndexedDB. */
  private async _restoreDurable(): Promise<void> {
    const stored = await this._durable.get(PREF_KEY);
    if (this._isChangedThisSession || (stored !== 'true' && stored !== 'false')) {
      return;
    }
    const choice = stored === 'true';
    if (choice !== this._userChoice()) {
      this._userChoice.set(choice);
      writeLsChoice(choice);
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
