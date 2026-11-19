import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { from } from 'rxjs';
import { catchError, filter, switchMap, take } from 'rxjs/operators';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { TaskLog } from '../../core/log';
import { QuickAddDraftService } from './quick-add-draft.service';

/**
 * F3: відновити незавершену чернетку після завантаження store задач,
 * навіть якщо рядок quick-add не змонтовано (Planner, проєкт із секціями).
 *
 * Повторний виклик з QuickAddRow.ngOnInit безпечний: restorePendingDraft
 * бере той самий Web Lock і не створює дубль.
 */
@Injectable()
export class QuickAddRestoreEffects {
  private readonly _dataInit = inject(DataInitStateService);
  private readonly _draft = inject(QuickAddDraftService);

  restoreAfterDataLoad$ = createEffect(
    () =>
      this._dataInit.isAllDataLoadedInitially$.pipe(
        filter(Boolean),
        take(1),
        switchMap(() =>
          from(this._draft.restorePendingDraft()).pipe(
            catchError((e) => {
              TaskLog.err('[QuickAdd] Restore after boot failed', e);
              return from([null]);
            }),
          ),
        ),
      ),
    { dispatch: false },
  );
}
