import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Action } from '@ngrx/store';
import { SnackService } from '../../core/snack/snack.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { INBOX_PROJECT } from '../project/project.const';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import { selectTagFeatureState } from '../tag/store/tag.reducer';
import { TODAY_TAG } from '../tag/tag.const';
import { addSubTask } from '../tasks/store/task.actions';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { Task } from '../tasks/task.model';
import { TaskArchiveService } from '../archive/task-archive.service';
import { RecentlyDeletedStoreService } from '../tasks/recently-deleted/recently-deleted-store.service';
import { RecentlyDeletedEntry } from '../tasks/recently-deleted/recently-deleted.util';
import { TaskService } from '../tasks/task.service';
import { WorkContextType } from '../work-context/work-context.model';
import { WorkContextService } from '../work-context/work-context.service';
import { QuickAddDraftService } from './quick-add-draft.service';
import { QUICK_ADD_ARM_TIMEOUT_MS, QUICK_ADD_RESTORE_LOCK } from './quick-add.const';
import { QuickAddDraftStore } from './quick-add-draft-store.service';
import { StoredQuickAddDraft } from './quick-add.model';
import { FakeQuickAddDraftStore } from './testing/fake-quick-add-draft-store';

describe('QuickAddDraftService', () => {
  let service: QuickAddDraftService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;
  let taskService: jasmine.SpyObj<TaskService>;
  let snackService: jasmine.SpyObj<SnackService>;
  let draftStore: FakeQuickAddDraftStore;
  let opLogFlush: jasmine.SpyObj<OperationWriteFlushService>;
  let taskArchive: jasmine.SpyObj<TaskArchiveService>;
  let recentlyDeleted: jasmine.SpyObj<RecentlyDeletedStoreService>;
  const workContext = {
    activeWorkContextId: 'projectA' as string | undefined,
    activeWorkContextType: WorkContextType.PROJECT as WorkContextType | undefined,
  };
  let idCounter = 0;

  const typeChars = (text: string): void => {
    let value = '';
    for (const char of text) {
      value += char;
      service.setTitle(value);
    }
  };

  const stored = (): StoredQuickAddDraft | null => draftStore.draft;

  const leftover = (title: string, workContextId = 'projectA'): StoredQuickAddDraft => ({
    v: 2,
    id: `old-${title}`,
    ts: 1,
    title,
    target: { workContextId, workContextType: WorkContextType.PROJECT, parentId: null },
  });

  /** Дочекатися ланцюжка «op-log записав → чернетку стерто» (без реальних таймерів). */
  const flushPromises = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  };

  const dispatched = (): Action[] => dispatchSpy.calls.allArgs().map((args) => args[0]);

  const createActions = (): Action[] =>
    dispatched().filter(
      (a) => a.type === TaskSharedActions.addTask.type || a.type === addSubTask.type,
    );

  const lastAddTask = (): ReturnType<typeof TaskSharedActions.addTask> =>
    createActions().at(-1) as ReturnType<typeof TaskSharedActions.addTask>;

  /** Імітація перезапуску застосунку: новий екземпляр сервісу, те саме сховище. */
  const restartApp = (): void => {
    service.ngOnDestroy();
    TestBed.resetTestingModule();
    configure();
  };

  const configure = (): void => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'createNewTaskWithDefaults',
      'add',
      'update',
      'remove',
      'addSubTaskTo',
    ]);
    taskService.createNewTaskWithDefaults.and.callFake(
      ({ title, id, workContextId, workContextType }) =>
        ({
          id: id ?? `task-${++idCounter}`,
          title,
          projectId:
            workContextType === WorkContextType.PROJECT ? workContextId : 'INBOX',
        }) as Task,
    );
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);

    TestBed.configureTestingModule({
      providers: [
        QuickAddDraftService,
        provideMockStore({
          selectors: [
            {
              selector: selectProjectFeatureState,
              value: { ids: [], entities: { projectA: {}, projectB: {} } },
            },
            {
              selector: selectTagFeatureState,
              value: { ids: [], entities: { tagA: {} } },
            },
            { selector: selectTaskEntities, value: { parent1: {} } },
          ],
        }),
        { provide: TaskService, useValue: taskService },
        { provide: WorkContextService, useValue: workContext },
        { provide: SnackService, useValue: snackService },
        { provide: QuickAddDraftStore, useValue: draftStore },
        { provide: OperationWriteFlushService, useValue: opLogFlush },
        { provide: TaskArchiveService, useValue: taskArchive },
        { provide: RecentlyDeletedStoreService, useValue: recentlyDeleted },
      ],
    });
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch');
    service = TestBed.inject(QuickAddDraftService);
  };

  beforeEach(() => {
    jasmine.clock().install();
    draftStore = new FakeQuickAddDraftStore();
    opLogFlush = jasmine.createSpyObj<OperationWriteFlushService>(
      'OperationWriteFlushService',
      ['flushPendingWrites'],
    );
    opLogFlush.flushPendingWrites.and.resolveTo();
    taskArchive = jasmine.createSpyObj<TaskArchiveService>('TaskArchiveService', [
      'hasTask',
    ]);
    taskArchive.hasTask.and.resolveTo(false);
    recentlyDeleted = jasmine.createSpyObj<RecentlyDeletedStoreService>(
      'RecentlyDeletedStoreService',
      ['getAll'],
    );
    recentlyDeleted.getAll.and.resolveTo([]);
    workContext.activeWorkContextId = 'projectA';
    workContext.activeWorkContextType = WorkContextType.PROJECT;
    idCounter = 0;
    configure();
  });

  afterEach(() => {
    service.ngOnDestroy();
    jasmine.clock().uninstall();
  });

  describe('QA #1: typed text survives power loss / process kill', () => {
    it('saves every keystroke to the durable draft store', () => {
      service.open('UNDONE');

      service.setTitle('К');
      expect(stored()).toEqual({
        v: 2,
        id: jasmine.any(String),
        ts: jasmine.any(Number),
        title: 'К',
        target: {
          workContextId: 'projectA',
          workContextType: WorkContextType.PROJECT,
          parentId: null,
        },
      } as unknown as StoredQuickAddDraft);
      const id = stored()?.id;

      service.setTitle('Купити');
      expect(stored()?.title).toBe('Купити');
      expect(stored()?.id).toBe(id);
    });

    it('each new draft gets its own id', () => {
      service.open('UNDONE');
      typeChars('First');
      const firstId = stored()?.id;
      service.commit('enter');

      service.open('UNDONE');
      typeChars('Second');

      expect(stored()?.id).not.toBe(firstId);
    });

    it('restores an unfinished draft after a restart as exactly one task', async () => {
      service.open('UNDONE');
      typeChars('Купити фарбу');
      expect(createActions().length).toBe(0);

      const draftId = stored()?.id;
      restartApp();
      const id = await service.restorePendingDraft();

      expect(id).toBe(draftId as string);
      expect(lastAddTask().task.id).toBe(draftId as string);
      expect(createActions().length).toBe(1);
      expect(lastAddTask().task.title).toBe('Купити фарбу');
      expect(lastAddTask().workContextId).toBe('projectA');
      expect(stored()).toBeNull();
      expect(snackService.open).toHaveBeenCalledTimes(1);
    });

    it('concurrent and repeated restores never create a duplicate', async () => {
      service.open('UNDONE');
      typeChars('Once');
      restartApp();

      await Promise.all([service.restorePendingDraft(), service.restorePendingDraft()]);
      await service.restorePendingDraft();

      expect(createActions().length).toBe(1);
    });

    it('two tabs restoring at once create the task only once (Web Lock)', async () => {
      draftStore.draft = leftover('Shared');
      const lockSpy = spyOn(navigator.locks, 'request').and.callThrough();
      // друга «вкладка» — окремий екземпляр сервісу над тим самим сховищем
      const otherTab = TestBed.runInInjectionContext(() => new QuickAddDraftService());

      await Promise.all([service.restorePendingDraft(), otherTab.restorePendingDraft()]);

      expect(createActions().length).toBe(1);
      expect(lockSpy.calls.allArgs().map((args) => args[0])).toEqual([
        QUICK_ADD_RESTORE_LOCK,
        QUICK_ADD_RESTORE_LOCK,
      ]);
      otherTab.ngOnDestroy();
    });

    it('does not restore the same draft twice even if clearing it failed', async () => {
      spyOn(draftStore, 'clear').and.resolveTo();
      const draft = leftover('Sticky');
      draftStore.draft = draft;

      await service.restorePendingDraft();
      // редʼюсер уже додав задачу з id чернетки (MockStore сам цього не робить)
      store.overrideSelector(selectTaskEntities, {
        [draft.id]: { id: draft.id } as Task,
      });
      store.refreshState();
      await service.restorePendingDraft();

      expect(createActions().length).toBe(1);
    });

    it('creates the task before the stored draft is cleared', async () => {
      draftStore.draft = leftover('Order');
      spyOn(draftStore, 'clear').and.callFake(() => {
        expect(createActions().length).toBe(1);
        return Promise.resolve();
      });

      await service.restorePendingDraft();

      expect(draftStore.clear).toHaveBeenCalledWith('old-Order');
    });

    it('ignores a missing or blank stored draft', async () => {
      expect(await service.restorePendingDraft()).toBeNull();

      draftStore.draft = leftover('   ');
      expect(await service.restorePendingDraft()).toBeNull();

      expect(createActions().length).toBe(0);
      expect(stored()).toBeNull();
    });

    it('never turns the draft being typed right now into a task', async () => {
      service.open('UNDONE');
      typeChars('Typing now');

      expect(await service.restorePendingDraft()).toBeNull();
      expect(createActions().length).toBe(0);
      expect(stored()?.title).toBe('Typing now');
    });

    it('restores into Inbox when the original project no longer exists', async () => {
      draftStore.draft = leftover('Orphan', 'deleted');

      await service.restorePendingDraft();

      expect(lastAddTask().workContextId).toBe(INBOX_PROJECT.id);
      expect(lastAddTask().workContextType).toBe(WorkContextType.PROJECT);
    });
  });

  describe('PR #5 review H1/M1: no duplicate, no resurrection after a crash', () => {
    it('the draft id becomes the task id', () => {
      service.open('UNDONE');
      typeChars('Same id');
      const draftId = stored()?.id;

      expect(service.commit('enter')).toBe(draftId as string);
      expect(lastAddTask().task.id).toBe(draftId as string);
    });

    it('clears the draft only after the op-log has persisted the task', async () => {
      let persist!: () => void;
      opLogFlush.flushPendingWrites.and.returnValue(
        new Promise<void>((resolve) => (persist = resolve)),
      );
      service.open('UNDONE');
      typeChars('Wait for op-log');

      service.commit('enter');
      await flushPromises();
      expect(stored()?.title).toBe('Wait for op-log');

      persist();
      await flushPromises();
      expect(stored()).toBeNull();
    });

    it('keeps the draft when the op-log flush fails (it is recognised later by id)', async () => {
      opLogFlush.flushPendingWrites.and.rejectWith(new Error('timeout'));
      service.open('UNDONE');
      typeChars('Keep me');

      service.commit('enter');
      await flushPromises();

      expect(stored()?.title).toBe('Keep me');
    });

    it('a stale copy of an already created task is cleared, not restored again', async () => {
      const draft = leftover('Already saved');
      draftStore.draft = draft;
      store.overrideSelector(selectTaskEntities, {
        [draft.id]: { id: draft.id } as Task,
      });
      store.refreshState();

      expect(await service.restorePendingDraft()).toBeNull();

      expect(createActions().length).toBe(0);
      expect(stored()).toBeNull();
      expect(snackService.open).not.toHaveBeenCalled();
    });

    it('N2: a stale copy of an existing task is cleared only after the op-log flush', async () => {
      let persist!: () => void;
      opLogFlush.flushPendingWrites.and.returnValue(
        new Promise<void>((resolve) => (persist = resolve)),
      );
      const draft = leftover('Just entered');
      draftStore.draft = draft;
      store.overrideSelector(selectTaskEntities, {
        [draft.id]: { id: draft.id } as Task,
      });
      store.refreshState();

      const restoring = service.restorePendingDraft();
      await flushPromises();
      expect(stored()?.title).toBe('Just entered');

      persist();
      expect(await restoring).toBeNull();
      expect(stored()).toBeNull();
      expect(createActions().length).toBe(0);
    });

    it('N5: Enter writes the pending tail of the draft durably right away', () => {
      const flush = spyOn(draftStore, 'flush').and.callThrough();
      service.open('UNDONE');
      typeChars('Tail matters');

      service.commit('enter');

      expect(flush).toHaveBeenCalledTimes(1);
      expect(flush).toHaveBeenCalledBefore(dispatchSpy);
    });

    it('Esc removes the draft right away (no task to wait for)', () => {
      service.open('UNDONE');
      typeChars('Cancelled');

      service.discard();

      expect(stored()).toBeNull();
      expect(opLogFlush.flushPendingWrites).not.toHaveBeenCalled();
    });
  });

  describe('PR #5 review N1: an archived or deleted task does not come back', () => {
    const trashEntry = (id: string, subTaskIds: string[] = []): RecentlyDeletedEntry => ({
      id,
      deletedAt: 1,
      task: { id } as Task,
      subTasks: subTaskIds.map((subId) => ({ id: subId }) as Task),
    });

    it('a leftover draft of an archived task is cleared, not restored', async () => {
      const draft = leftover('Archived');
      draftStore.draft = draft;
      taskArchive.hasTask.and.callFake((id) => Promise.resolve(id === draft.id));

      expect(await service.restorePendingDraft()).toBeNull();

      expect(createActions().length).toBe(0);
      expect(stored()).toBeNull();
    });

    it('a leftover draft of a deleted task (in the trash) is cleared, not restored', async () => {
      const draft = leftover('Deleted');
      draftStore.draft = draft;
      recentlyDeleted.getAll.and.resolveTo([trashEntry(draft.id)]);

      expect(await service.restorePendingDraft()).toBeNull();

      expect(createActions().length).toBe(0);
      expect(stored()).toBeNull();
    });

    it('also recognises a sub-task deleted together with its parent', async () => {
      const draft = leftover('Deleted sub-task');
      draftStore.draft = draft;
      recentlyDeleted.getAll.and.resolveTo([trashEntry('parent', [draft.id])]);

      expect(await service.restorePendingDraft()).toBeNull();
      expect(createActions().length).toBe(0);
    });

    it('a task deleted after a failed op-log flush is not recreated in the same session', async () => {
      opLogFlush.flushPendingWrites.and.rejectWith(new Error('timeout'));
      service.open('UNDONE');
      typeChars('Deleted right away');
      service.commit('enter');
      await flushPromises();
      expect(stored()?.title).toBe('Deleted right away');
      // задачу видалили, кошик теж порожній (напр. очищений) — у store її немає

      opLogFlush.flushPendingWrites.and.resolveTo();
      expect(await service.restorePendingDraft()).toBeNull();

      expect(createActions().length).toBe(1);
      expect(stored()).toBeNull();
    });

    it('restores the draft when the archive cannot be read (no text loss)', async () => {
      draftStore.draft = leftover('Archive broken');
      taskArchive.hasTask.and.rejectWith(new Error('idb'));

      await service.restorePendingDraft();

      expect(createActions().length).toBe(1);
    });
  });

  describe('QA #2: the task is created where typing started', () => {
    it('creates in the captured project even after switching project', () => {
      service.open('UNDONE');
      typeChars('Draft in A');
      workContext.activeWorkContextId = 'projectB';
      jasmine.clock().tick(5000);

      service.commit('blur');

      expect(createActions().length).toBe(1);
      expect(lastAddTask().workContextId).toBe('projectA');
      expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith({
        title: 'Draft in A',
        id: jasmine.any(String),
        workContextId: 'projectA',
        workContextType: WorkContextType.PROJECT,
      });
    });

    it('nothing is created by timers alone', () => {
      service.open('UNDONE');
      typeChars('No timers');
      jasmine.clock().tick(60_000);

      expect(createActions().length).toBe(0);
    });

    it('keeps tag contexts (incl. Today) as captured', () => {
      workContext.activeWorkContextId = TODAY_TAG.id;
      workContext.activeWorkContextType = WorkContextType.TAG;
      service.open('UNDONE');
      typeChars('Today task');

      service.commit('enter');

      expect(lastAddTask().workContextId).toBe(TODAY_TAG.id);
      expect(lastAddTask().workContextType).toBe(WorkContextType.TAG);
    });

    it('falls back to Inbox outside of any work context', () => {
      workContext.activeWorkContextId = undefined;
      workContext.activeWorkContextType = undefined;
      service.open('UNDONE');
      typeChars('From settings');

      service.commit('enter');

      expect(lastAddTask().workContextId).toBe(INBOX_PROJECT.id);
    });
  });

  describe('QA #3/#4: exactly one create op, no updates', () => {
    it('commit dispatches a single addTask at the bottom, with short syntax', async () => {
      service.open('UNDONE');
      typeChars('Call Anna #work @tomorrow');
      jasmine.clock().tick(10_000);
      const draftId = stored()?.id;

      const id = service.commit('enter');
      await flushPromises();

      expect(id).toBe(draftId as string);
      expect(dispatched().length).toBe(1);
      const action = lastAddTask();
      expect(action.type).toBe(TaskSharedActions.addTask.type);
      expect(action.isAddToBottom).toBeTrue();
      expect(action.isAddToBacklog).toBeFalse();
      expect(action.isIgnoreShortSyntax).toBeUndefined();
      expect(taskService.update).not.toHaveBeenCalled();
      expect(taskService.add).not.toHaveBeenCalled();
      expect(stored()).toBeNull();
      expect(service.state()).toBe('idle');
    });

    it('trims the title', () => {
      service.open('UNDONE');
      service.setTitle('  Spaces  ');

      service.commit('enter');

      expect(lastAddTask().task.title).toBe('Spaces');
    });

    it('creates sub-tasks with addSubTask under the captured parent', () => {
      service.open('UNDONE', 'parent1');
      typeChars('Step');

      service.commit('enter');

      expect(dispatched().length).toBe(1);
      const action = dispatched()[0] as ReturnType<typeof addSubTask>;
      expect(action.type).toBe(addSubTask.type);
      expect(action.parentId).toBe('parent1');
    });

    it('creates a top-level task when the parent was deleted meanwhile', () => {
      service.open('UNDONE', 'goneParent');
      typeChars('Step');

      service.commit('enter');

      expect(lastAddTask().type).toBe(TaskSharedActions.addTask.type);
    });
  });

  describe('cancel (Esc / empty blur)', () => {
    it('discard creates nothing and clears the stored draft', () => {
      service.open('UNDONE');
      typeChars('Oops');

      service.discard();

      expect(dispatched().length).toBe(0);
      expect(stored()).toBeNull();
      expect(service.state()).toBe('idle');
    });

    it('commit of an empty or whitespace title is a discard', () => {
      service.open('UNDONE');
      typeChars('   ');

      expect(service.commit('blur')).toBeNull();
      expect(dispatched().length).toBe(0);
    });

    it('clearing the text removes the stored draft', () => {
      service.open('UNDONE');
      typeChars('X');
      service.setTitle('');

      expect(stored()).toBeNull();
    });
  });

  describe('row registry', () => {
    it('knows which lists currently render an input row', () => {
      expect(service.hasRow('UNDONE')).toBeFalse();

      service.registerRow('UNDONE');
      expect(service.hasRow('UNDONE')).toBeTrue();
      expect(service.hasRow('OTHER')).toBeFalse();

      service.unregisterRow('UNDONE');
      expect(service.hasRow('UNDONE')).toBeFalse();
    });
  });

  describe('state', () => {
    it('arm() waits for typing and the first character switches to editing', () => {
      service.arm('UNDONE');
      expect(service.state()).toBe('armed');
      expect(service.listKey()).toBe('UNDONE');

      service.setTitle('K');
      expect(service.state()).toBe('editing');
    });

    it('an armed draft without typing falls back to idle after the timeout', () => {
      service.arm('UNDONE');
      jasmine.clock().tick(QUICK_ADD_ARM_TIMEOUT_MS);

      expect(service.state()).toBe('idle');
      expect(service.listKey()).toBeNull();
    });

    it('typing cancels the arm timeout', () => {
      service.arm('UNDONE');
      service.setTitle('K');
      jasmine.clock().tick(QUICK_ADD_ARM_TIMEOUT_MS);

      expect(service.state()).toBe('editing');
    });

    it('ignores input while idle', () => {
      service.setTitle('Task');

      expect(stored()).toBeNull();
      expect(service.commit('enter')).toBeNull();
    });

    it('opening a new row commits the previous non-empty draft', async () => {
      service.open('UNDONE');
      typeChars('First');

      service.open('UNDONE');
      await flushPromises();

      expect(createActions().length).toBe(1);
      expect(service.state()).toBe('editing');
      expect(stored()).toBeNull();
    });

    it('opening a new row drops an empty previous draft silently', () => {
      service.open('UNDONE');

      service.arm('UNDONE');

      expect(dispatched().length).toBe(0);
      expect(service.state()).toBe('armed');
    });
  });
});
