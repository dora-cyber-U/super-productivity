import {
  parseCompoundExternalId,
  toCompoundExternalId,
} from './external-calendar-sync.model';

describe('external calendar compound ids', () => {
  it('builds calendarId::eventId like the google-calendar-provider plugin', () => {
    expect(toCompoundExternalId('primary', 'abc123')).toBe('primary::abc123');
  });

  it('parses a compound id', () => {
    expect(parseCompoundExternalId('work@example.com::evt-9')).toEqual({
      calendarId: 'work@example.com',
      eventId: 'evt-9',
    });
  });

  it('falls back to primary when the separator is missing', () => {
    expect(parseCompoundExternalId('evt-only')).toEqual({
      calendarId: 'primary',
      eventId: 'evt-only',
    });
  });

  it('accepts a custom fallback calendar', () => {
    expect(parseCompoundExternalId('evt-only', 'secondary')).toEqual({
      calendarId: 'secondary',
      eventId: 'evt-only',
    });
  });
});
