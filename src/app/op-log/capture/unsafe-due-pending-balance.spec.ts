import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import { OpLog } from '../../core/log';
import { SnackService } from '../../core/snack/snack.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { ImmediateUploadService } from '../sync/immediate-upload.service';
import { LockService } from '../sync/lock.service';
import { VectorClockService } from '../sync/vector-clock.service';
import {
  clearDeferredActions,
  operationCaptureMetaReducer,
  setIsApplyingRemoteOps,
  setOperationCaptureService,
} from './operation-capture.meta-reducer';
import { OperationCaptureService } from './operation-capture.service';
import { OperationLogEffects } from './operation-log.effects';

/**
 * Z8: після відкату 104e4ec meta-reducer знову рахує pending, а
 * persistOperation$ записує HU і зменшує лічильник. Вони мають
 * сходитися, без «decrementPending called with no pending operations».
 */
describe('pending counter for an unsafe dueWithTime (Z8)', () => {
  let effects: OperationLogEffects;
  let actions$: Observable<Action>;
  let capture: OperationCaptureService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;

  const configure = (): void => {
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'append',
      'appendWithVectorClockOverwrite',
      'getCompactionCounter',
      'clearVectorClockCache',
    ]);
    const mockLockService = jasmine.createSpyObj('LockService', ['request']);
    const mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    const mockCompactionService = jasmine.createSpyObj('OperationLogCompactionService', [
      'compact',
      'emergencyCompact',
    ]);
    const mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    const mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    const mockImmediateUploadService = jasmine.createSpyObj('ImmediateUploadService', [
      'trigger',
    ]);
    const mockClientIdService = jasmine.createSpyObj('ClientIdService', [
      'getOrGenerateClientId',
    ]);

    mockLockService.request.and.callFake(async <T>(_name: string, fn: () => Promise<T>) =>
      fn(),
    );
    mockOpLogStore.append.and.returnValue(Promise.resolve(1));
    mockOpLogStore.appendWithVectorClockOverwrite.and.returnValue(Promise.resolve(1));
    mockOpLogStore.getCompactionCounter.and.returnValue(Promise.resolve(0));
    mockVectorClockService.getCurrentVectorClock.and.returnValue(
      Promise.resolve({ testClient: 5 }),
    );
    mockCompactionService.compact.and.returnValue(Promise.resolve(true));
    mockCompactionService.emergencyCompact.and.returnValue(Promise.resolve(true));
    mockStore.select.and.returnValue(of({}));
    mockClientIdService.getOrGenerateClientId.and.returnValue(
      Promise.resolve('testClient'),
    );

    capture = new OperationCaptureService();
    setOperationCaptureService(capture);
    setIsApplyingRemoteOps(false);
    clearDeferredActions();

    TestBed.configureTestingModule({
      providers: [
        OperationLogEffects,
        provideMockActions(() => actions$),
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LockService, useValue: mockLockService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: OperationLogCompactionService, useValue: mockCompactionService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: Store, useValue: mockStore },
        { provide: ImmediateUploadService, useValue: mockImmediateUploadService },
        { provide: ClientIdService, useValue: mockClientIdService },
        { provide: OperationCaptureService, useValue: capture },
      ],
    });
    effects = TestBed.inject(OperationLogEffects);
  };

  beforeEach(() => {
    configure();
  });

  afterEach(() => {
    capture.clear();
    clearDeferredActions();
    setIsApplyingRemoteOps(false);
    setOperationCaptureService(null as never);
    TestBed.resetTestingModule();
  });

  (
    [
      ['-5', -5],
      ['1e17', 1e17],
    ] as const
  ).forEach(([label, dueWithTime]) => {
    it(`stays balanced for updateTask with dueWithTime ${label}`, (done) => {
      const warnSpy = spyOn(OpLog, 'warn');
      const incrementSpy = spyOn(capture, 'incrementPending').and.callThrough();
      const decrementSpy = spyOn(capture, 'decrementPending').and.callThrough();

      const action = TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { dueWithTime } },
      });
      const reduce = operationCaptureMetaReducer((state) => state);
      reduce({} as never, action);

      expect(capture.getPendingCount()).toBe(1);

      actions$ = of(action);
      effects.persistOperation$.subscribe({
        complete: () => {
          expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalled();
          expect(incrementSpy).toHaveBeenCalledTimes(1);
          expect(decrementSpy).toHaveBeenCalledTimes(1);
          expect(incrementSpy.calls.count()).toBe(decrementSpy.calls.count());
          expect(capture.getPendingCount()).toBe(0);
          const underflow = warnSpy.calls
            .allArgs()
            .some((args) =>
              String(args[0]).includes(
                'decrementPending called with no pending operations',
              ),
            );
          expect(underflow).toBeFalse();
          done();
        },
      });
    });
  });
});
