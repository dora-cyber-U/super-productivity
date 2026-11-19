import { Injectable } from '@angular/core';
import {
  ExternalCalendarChange,
  ExternalCalendarEvent,
  ExternalCalendarSyncProvider,
  ExternalCalendarSyncStatus,
  ExternalCalendarTimeRange,
  GOOGLE_CALENDAR_SYNC_ID,
} from './external-calendar-sync.model';

/**
 * Вимкнена заглушка двосторонньої синхронізації з Google Calendar.
 *
 * У цьому PR немає OAuth, HTTP-запитів і нових залежностей. Методи
 * connect/disconnect/pull/push нічого не роблять і не змінюють статус.
 *
 * Планований потік (коли заглушку замінять живою реалізацією):
 *
 * 1. connect — OAuth на цьому пристрої через уже наявний механізм
 *    plugin-oauth (як у bundled-плагіні google-calendar-provider).
 *    Токен не потрапляє в sync/op-log: у upstream він і так per-device.
 *
 * 2. pull(range) — events.list з timeMin/timeMax, singleEvents=true,
 *    у тому ж форматі id «calendarId::eventId». Події з
 *    extendedProperties.private.spTaskId (дзеркала time-block) не
 *    імпортуємо, щоб не дублювати локальну задачу (upstream #8171).
 *
 * 3. push(changes) — офлайн-черга: зміни з правої панелі-календаря
 *    накопичуються локально, поки немає мережі, і відправляються пакетом
 *    після появи зв’язку. Коалесувати кілька правок однієї задачі
 *    (у плагіні вже є вікно ~1000 мс і обмеження паралелі 3), інакше
 *    легко впертися в ліміт Google.
 *
 * 4. Ліміти — повтор 429 і 403 rateLimitExceeded / userRateLimitExceeded
 *    з експоненційним backoff, як withRateLimitRetry у плагіні
 *    (до 4 спроб). Інші 403 не ретраїти.
 *
 * 5. Конфлікти — Google дає etag і updated. Для запису варто слати
 *    If-Match (LWW на стороні API). Локально джерело істини для самої
 *    задачі — op-log, а не «останній запис з Google». Мапінг
 *    (externalId, etag, lastSyncedAt) живе в окремому локальному сховищі,
 *    не в Task і не в op-log, щоб роз’їзд etag між пристроями не псував
 *    журнал операцій. Якщо змінили і локальну задачу, і подію, поки
 *    пристрій був офлайн: локальний op-log виграє для полів задачі;
 *    розбіжність etag — привід перечитати подію і злити обережно, а не
 *    сліпо затерти Google чи локальні дані.
 *
 * Існуючий плагін (імпорт у планувальник, fieldMappings, time-block)
 * не замінюємо цим PR; заглушка лише готує окремий шар для панелі.
 */
@Injectable({ providedIn: 'root' })
export class GoogleCalendarSyncStub implements ExternalCalendarSyncProvider {
  readonly id = GOOGLE_CALENDAR_SYNC_ID;

  status(): ExternalCalendarSyncStatus {
    return { state: 'disabled' };
  }

  async connect(): Promise<void> {
    // Без OAuth і мережі: статус лишається disabled.
    return;
  }

  async disconnect(): Promise<void> {
    return;
  }

  async pull(
    _range: ExternalCalendarTimeRange,
  ): Promise<readonly ExternalCalendarEvent[]> {
    return [];
  }

  async push(_changes: readonly ExternalCalendarChange[]): Promise<void> {
    return;
  }
}
