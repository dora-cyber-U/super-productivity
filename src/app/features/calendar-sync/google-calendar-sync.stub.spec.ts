import { TestBed } from '@angular/core/testing';
import { EXTERNAL_CALENDAR_SYNC } from './external-calendar-sync.token';
import { ExternalCalendarSyncProvider } from './external-calendar-sync.model';
import { GoogleCalendarSyncStub } from './google-calendar-sync.stub';

describe('GoogleCalendarSyncStub', () => {
  let stub: GoogleCalendarSyncStub;
  let viaToken: ExternalCalendarSyncProvider;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    fetchSpy = spyOn(window, 'fetch');
    TestBed.configureTestingModule({});
    stub = TestBed.inject(GoogleCalendarSyncStub);
    viaToken = TestBed.inject(EXTERNAL_CALENDAR_SYNC);
  });

  it('is disabled and exposes the google-calendar id', () => {
    expect(stub.id).toBe('google-calendar');
    expect(stub.status()).toEqual({ state: 'disabled' });
  });

  it('resolves the DI token to the same stub', () => {
    expect(viaToken).toBe(stub);
    expect(viaToken.status()).toEqual({ state: 'disabled' });
  });

  it('keeps status disabled after connect and disconnect (no OAuth)', async () => {
    await stub.connect();
    expect(stub.status()).toEqual({ state: 'disabled' });
    await stub.disconnect();
    expect(stub.status()).toEqual({ state: 'disabled' });
  });

  it('pull returns no events', async () => {
    const events = await stub.pull({
      fromMs: Date.UTC(2026, 10, 16),
      toMs: Date.UTC(2026, 10, 23),
    });
    expect(events).toEqual([]);
  });

  it('push is a no-op', async () => {
    await expectAsync(
      stub.push([
        { type: 'upsert', taskId: 't1', event: { title: 'Standup' } },
        { type: 'delete', taskId: 't2', externalId: 'primary::evt-1' },
      ]),
    ).toBeResolved();
  });

  it('does not perform network requests', async () => {
    await stub.connect();
    await stub.pull({ fromMs: 1, toMs: 2 });
    await stub.push([{ type: 'delete', taskId: 't', externalId: 'primary::x' }]);
    await stub.disconnect();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
