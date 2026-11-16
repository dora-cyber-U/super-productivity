import { Injectable, signal } from '@angular/core';
import { LS } from '../../core/persistence/storage-keys.const';
import { lsGetBoolean, lsSetItem } from '../../util/ls-util';
import { CalendarViewMode } from './calendar-panel.model';

/**
 * Стан правої панелі-календаря.
 *
 * «Розгорнуто / згорнуто» — локальне налаштування інтерфейсу цього пристрою:
 * лежить у localStorage, не потрапляє ні в op-log, ні в синхронізацію.
 */
@Injectable({ providedIn: 'root' })
export class CalendarPanelStateService {
  private readonly _isExpanded = signal(
    readLsSafe(() => lsGetBoolean(LS.IS_CALENDAR_PANEL_EXPANDED, true), true),
  );
  private readonly _viewMode = signal<CalendarViewMode>('day');

  readonly isExpanded = this._isExpanded.asReadonly();
  /** Поки лише перемикач-заготовка; самі режими — у наступних PR. */
  readonly viewMode = this._viewMode.asReadonly();

  toggle(): void {
    this.setExpanded(!this._isExpanded());
  }

  setExpanded(isExpanded: boolean): void {
    this._isExpanded.set(isExpanded);
    try {
      lsSetItem(LS.IS_CALENDAR_PANEL_EXPANDED, isExpanded);
    } catch {
      // localStorage недоступний — стан діє лише до перезапуску
    }
  }

  setViewMode(mode: CalendarViewMode): void {
    this._viewMode.set(mode);
  }
}

const readLsSafe = <V>(read: () => V, fallback: V): V => {
  try {
    return read();
  } catch {
    return fallback;
  }
};
