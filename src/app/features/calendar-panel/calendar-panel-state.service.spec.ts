import { TestBed } from '@angular/core/testing';
import { LS } from '../../core/persistence/storage-keys.const';
import { CalendarPanelStateService } from './calendar-panel-state.service';

describe('CalendarPanelStateService', () => {
  const create = (): CalendarPanelStateService => {
    TestBed.resetTestingModule();
    return TestBed.inject(CalendarPanelStateService);
  };

  beforeEach(() => localStorage.removeItem(LS.IS_CALENDAR_PANEL_EXPANDED));
  afterEach(() => localStorage.removeItem(LS.IS_CALENDAR_PANEL_EXPANDED));

  it('is expanded by default (nothing stored yet)', () => {
    expect(create().isExpanded()).toBe(true);
  });

  it('toggle collapses and expands', () => {
    const state = create();

    state.toggle();
    expect(state.isExpanded()).toBe(false);

    state.toggle();
    expect(state.isExpanded()).toBe(true);
  });

  it('keeps the collapsed state across sessions (localStorage)', () => {
    create().toggle();
    expect(localStorage.getItem(LS.IS_CALENDAR_PANEL_EXPANDED)).toBe('false');

    // «перезапуск»: новий екземпляр читає збережений стан
    expect(create().isExpanded()).toBe(false);

    create().setExpanded(true);
    expect(create().isExpanded()).toBe(true);
  });

  it('works without localStorage (state lives until restart)', () => {
    spyOn(localStorage, 'getItem').and.throwError('SecurityError');
    spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');
    const state = create();

    expect(state.isExpanded()).toBe(true);
    expect(() => state.toggle()).not.toThrow();
    expect(state.isExpanded()).toBe(false);
  });

  it('switches the view mode placeholder', () => {
    const state = create();
    expect(state.viewMode()).toBe('day');

    state.setViewMode('month');
    expect(state.viewMode()).toBe('month');
  });
});
