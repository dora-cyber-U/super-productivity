import { InjectionToken, inject } from '@angular/core';
import { ExternalCalendarSyncProvider } from './external-calendar-sync.model';
import { GoogleCalendarSyncStub } from './google-calendar-sync.stub';

/**
 * Точка підключення провайдера зовнішнього календаря.
 * Зараз резолвиться в GoogleCalendarSyncStub (вимкнено, без мережі).
 * Пізніше фабрику можна замінити живою реалізацією, не чіпаючи споживачів.
 */
export const EXTERNAL_CALENDAR_SYNC = new InjectionToken<ExternalCalendarSyncProvider>(
  'EXTERNAL_CALENDAR_SYNC',
  {
    providedIn: 'root',
    factory: (): ExternalCalendarSyncProvider => inject(GoogleCalendarSyncStub),
  },
);
