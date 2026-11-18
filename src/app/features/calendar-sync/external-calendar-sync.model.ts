/**
 * Контракт двосторонньої синхронізації зовнішнього календаря.
 *
 * Мапінг подія↔задача (externalId, etag, updated, lastSyncedAt) свідомо
 * тримаємо поза моделлю Task і поза op-log: інакше Google-ідентифікатори
 * роз’їжджалися б між пристроями, а OAuth і так уже локальний на пристрій.
 * Пізніше сховок лінків буде окремим локальним сховищем.
 *
 * Ідентифікатор події збігається з плагіном google-calendar-provider:
 * «calendarId::eventId» (див. packages/plugin-dev/google-calendar-provider).
 */

/** Стан провайдера. Заглушка завжди повертає disabled. */
export type ExternalCalendarSyncStatus =
  | { readonly state: 'disabled' }
  | { readonly state: 'disconnected' }
  | {
      readonly state: 'connected';
      readonly accountLabel?: string;
      readonly lastSyncedAt?: number;
    }
  | { readonly state: 'error'; readonly message: string };

export interface ExternalCalendarTimeRange {
  readonly fromMs: number;
  readonly toMs: number;
}

/** Нормалізована подія зовнішнього календаря (не Task). */
export interface ExternalCalendarEvent {
  /** Складений id: calendarId::eventId, як у плагіні. */
  readonly externalId: string;
  readonly calendarId: string;
  /** HTTP ETag події Google, якщо є; для If-Match при push. */
  readonly etag?: string;
  /** event.updated у мс (плагін кладе це в lastUpdated). */
  readonly updatedMs?: number;
  readonly title: string;
  readonly description?: string;
  /** Початок у мс; для all-day можна лишити null і вказати dueDay. */
  readonly startMs: number | null;
  readonly endMs?: number;
  readonly durationMs: number;
  readonly isAllDay: boolean;
  /** YYYY-MM-DD для події без конкретного часу. */
  readonly dueDay?: string;
}

/**
 * Зв’язок локальної задачі з зовнішньою подією.
 * Не пишеться в Task і не потрапляє в op-log.
 */
export interface ExternalCalendarTaskLink {
  readonly taskId: string;
  readonly externalId: string;
  readonly calendarId: string;
  readonly etag?: string;
  readonly updatedMs?: number;
  readonly lastSyncedAt: number;
}

export type ExternalCalendarChange =
  | {
      readonly type: 'upsert';
      readonly taskId: string;
      readonly event: Partial<ExternalCalendarEvent>;
    }
  | {
      readonly type: 'delete';
      readonly taskId: string;
      readonly externalId: string;
    };

/**
 * Провайдер двосторонньої синхронізації.
 * Реалізація в цьому PR — вимкнена заглушка без мережі й OAuth.
 */
export interface ExternalCalendarSyncProvider {
  readonly id: string;
  status(): ExternalCalendarSyncStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  pull(range: ExternalCalendarTimeRange): Promise<readonly ExternalCalendarEvent[]>;
  push(changes: readonly ExternalCalendarChange[]): Promise<void>;
}

export const GOOGLE_CALENDAR_SYNC_ID = 'google-calendar';

/** Той самий роздільник, що COMPOUND_SEP у google-calendar-provider. */
export const EXTERNAL_CALENDAR_ID_SEP = '::';

export const toCompoundExternalId = (calendarId: string, eventId: string): string =>
  `${calendarId}${EXTERNAL_CALENDAR_ID_SEP}${eventId}`;

export const parseCompoundExternalId = (
  externalId: string,
  fallbackCalendarId = 'primary',
): { calendarId: string; eventId: string } => {
  const sep = externalId.indexOf(EXTERNAL_CALENDAR_ID_SEP);
  if (sep === -1) {
    return { calendarId: fallbackCalendarId, eventId: externalId };
  }
  return {
    calendarId: externalId.slice(0, sep),
    eventId: externalId.slice(sep + EXTERNAL_CALENDAR_ID_SEP.length),
  };
};
