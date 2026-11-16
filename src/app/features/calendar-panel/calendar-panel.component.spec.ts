import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { LS } from '../../core/persistence/storage-keys.const';
import { CalendarPanelComponent } from './calendar-panel.component';
import { selectCalendarTodayStatus } from './calendar-panel.selectors';

describe('CalendarPanelComponent', () => {
  let fixture: ComponentFixture<CalendarPanelComponent>;
  let store: MockStore;

  const el = (): HTMLElement => fixture.nativeElement;

  beforeEach(async () => {
    localStorage.removeItem(LS.IS_CALENDAR_PANEL_EXPANDED);
    await TestBed.configureTestingModule({
      imports: [CalendarPanelComponent, TranslateModule.forRoot(), NoopAnimationsModule],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCalendarTodayStatus, value: { done: 3, total: 8 } },
          ],
        }),
      ],
    }).compileComponents();
    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(CalendarPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => localStorage.removeItem(LS.IS_CALENDAR_PANEL_EXPANDED));

  it('is expanded by default: header with three view modes and today progress', () => {
    expect(el().classList).toContain('isExpanded');
    expect(el().querySelectorAll('mat-button-toggle').length).toBe(3);
    expect(el().querySelector('.today-progress-bar')?.getAttribute('style')).toContain(
      'width: 38%',
    );
  });

  it('the edge toggle collapses the panel to a strip with X/Y, and back', () => {
    (el().querySelector('.edge-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el().classList).not.toContain('isExpanded');
    expect(el().querySelector('.panel')).toBeNull();
    expect(el().querySelector('.mini-status')?.textContent).toBe('3/8');
    expect(localStorage.getItem(LS.IS_CALENDAR_PANEL_EXPANDED)).toBe('false');

    (el().querySelector('.collapsed-strip') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().classList).toContain('isExpanded');
    expect(localStorage.getItem(LS.IS_CALENDAR_PANEL_EXPANDED)).toBe('true');
  });

  it('updates the status when today progress changes', () => {
    store.overrideSelector(selectCalendarTodayStatus, { done: 8, total: 8 });
    store.refreshState();
    fixture.detectChanges();

    expect(el().querySelector('.today-progress-bar')?.getAttribute('style')).toContain(
      'width: 100%',
    );
  });
});
