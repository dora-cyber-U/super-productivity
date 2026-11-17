import { TestBed } from '@angular/core/testing';
import { deleteDB } from 'idb';
import { LS } from '../../core/persistence/storage-keys.const';
import { CalendarPanelStateService } from './calendar-panel-state.service';
import { UiPrefDurableStore } from './ui-pref-durable-store';

describe('CalendarPanelStateService', () => {
  let isWide: boolean;
  let mqlListener: ((e: MediaQueryListEvent) => void) | null;

  const create = async (): Promise<CalendarPanelStateService> => {
    TestBed.resetTestingModule();
    const state = TestBed.inject(CalendarPanelStateService);
    await state.restored;
    return state;
  };

  beforeEach(async () => {
    localStorage.removeItem(LS.IS_CALENDAR_PANEL_EXPANDED);
    await deleteDB('SUP_UI_PREFS');
    isWide = true;
    mqlListener = null;
    spyOn(window, 'matchMedia').and.callFake(
      () =>
        ({
          matches: isWide,
          addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) =>
            (mqlListener = fn),
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
  });

  afterEach(async () => {
    localStorage.removeItem(LS.IS_CALENDAR_PANEL_EXPANDED);
    TestBed.resetTestingModule();
    await deleteDB('SUP_UI_PREFS');
  });

  describe('F1: default depends on the window width until the user chooses', () => {
    it('expanded on a wide window (≥ 1280 px)', async () => {
      expect((await create()).isExpanded()).toBe(true);
    });

    it('collapsed on a narrower window (e.g. 800 px — Electron default)', async () => {
      isWide = false;
      expect((await create()).isExpanded()).toBe(false);
    });

    it('follows the window width while there is no user choice', async () => {
      const state = await create();
      mqlListener?.({ matches: false } as MediaQueryListEvent);
      expect(state.isExpanded()).toBe(false);
    });

    it('a user choice wins over the width', async () => {
      isWide = false;
      const state = await create();
      state.setExpanded(true);
      mqlListener?.({ matches: false } as MediaQueryListEvent);
      expect(state.isExpanded()).toBe(true);
    });
  });

  it('toggle collapses and expands', async () => {
    const state = await create();

    state.toggle();
    expect(state.isExpanded()).toBe(false);

    state.toggle();
    expect(state.isExpanded()).toBe(true);
  });

  it('keeps the choice across sessions (localStorage)', async () => {
    (await create()).toggle();
    expect(localStorage.getItem(LS.IS_CALENDAR_PANEL_EXPANDED)).toBe('false');

    expect((await create()).isExpanded()).toBe(false);
  });

  it('F5: restores the choice from IndexedDB when localStorage lost it (kill)', async () => {
    const state = await create();
    state.toggle();
    // дочекатися durable-запису
    await TestBed.inject(UiPrefDurableStore).get(LS.IS_CALENDAR_PANEL_EXPANDED);
    // після kill localStorage не встиг на диск
    localStorage.removeItem(LS.IS_CALENDAR_PANEL_EXPANDED);

    const restarted = await create();

    expect(restarted.isExpanded()).toBe(false);
    expect(localStorage.getItem(LS.IS_CALENDAR_PANEL_EXPANDED)).toBe('false');
  });

  it('works without localStorage (state lives in memory / IndexedDB)', async () => {
    spyOn(localStorage, 'getItem').and.throwError('SecurityError');
    spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');
    const state = await create();

    expect(state.isExpanded()).toBe(true);
    expect(() => state.toggle()).not.toThrow();
    expect(state.isExpanded()).toBe(false);
  });

  it('switches the view mode placeholder', async () => {
    const state = await create();
    expect(state.viewMode()).toBe('day');

    state.setViewMode('month');
    expect(state.viewMode()).toBe('month');
  });
});
