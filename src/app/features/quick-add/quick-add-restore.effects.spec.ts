import { TestBed } from '@angular/core/testing';
import { ReplaySubject, firstValueFrom } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { QuickAddDraftService } from './quick-add-draft.service';
import { QuickAddRestoreEffects } from './quick-add-restore.effects';

describe('QuickAddRestoreEffects', () => {
  let dataLoaded$: ReplaySubject<boolean>;
  let draft: jasmine.SpyObj<QuickAddDraftService>;

  const createEffects = (): QuickAddRestoreEffects => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        QuickAddRestoreEffects,
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: dataLoaded$.asObservable() },
        },
        { provide: QuickAddDraftService, useValue: draft },
      ],
    });
    return TestBed.inject(QuickAddRestoreEffects);
  };

  beforeEach(() => {
    dataLoaded$ = new ReplaySubject<boolean>(1);
    draft = jasmine.createSpyObj('QuickAddDraftService', ['restorePendingDraft']);
    draft.restorePendingDraft.and.resolveTo('task-1');
  });

  it('does not restore before the task store has loaded', async () => {
    const effects = createEffects();
    const sub = effects.restoreAfterDataLoad$.subscribe();
    expect(draft.restorePendingDraft).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('restores once after data load, without a mounted row', async () => {
    const effects = createEffects();
    const done = firstValueFrom(effects.restoreAfterDataLoad$.pipe(take(1)));
    dataLoaded$.next(true);
    await done;
    expect(draft.restorePendingDraft).toHaveBeenCalledTimes(1);
  });

  it('does not restore again if data-loaded emits twice', async () => {
    const effects = createEffects();
    const seen = firstValueFrom(effects.restoreAfterDataLoad$.pipe(take(1), toArray()));
    dataLoaded$.next(true);
    dataLoaded$.next(true);
    await seen;
    expect(draft.restorePendingDraft).toHaveBeenCalledTimes(1);
  });
});
