import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Action } from '@ngrx/store';
import { SnackService } from '../../core/snack/snack.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { INBOX_PROJECT } from '../project/project.const';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import { selectTagFeatureState } from '../tag/store/tag.reducer';
import { TODAY_TAG } from '../tag/tag.const';
import { addSubTask } from '../tasks/store/task.actions';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { Task } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { WorkContextType } from '../work-context/work-context.model';
import { WorkContextService } from '../work-context/work-context.service';
import { QuickAddDraftService } from './quick-add-draft.service';
import { QUICK_ADD_ARM_TIMEOUT_MS, QUICK_ADD_DRAFT_LS_KEY } from './quick-add.const';

describe('QuickAddDraftService', () => {
  let service: QuickAddDraftService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;
  let taskService: jasmine.SpyObj<TaskService>;
  let snackService: jasmine.SpyObj<SnackService>;
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

  const stored = (): unknown => {
    const raw = localStorage.getItem(QUICK_ADD_DRAFT_LS_KEY);
    return raw ? JSON.parse(raw) : null;
  };

  const dispatched = (): Action[] => dispatchSpy.calls.allArgs().map((args) => args[0]);

  const createActions = (): Action[] =>
    dispatched().filter(
      (a) => a.type === TaskSharedActions.addTask.type || a.type === addSubTask.type,
    );

  const lastAddTask = (): ReturnType<typeof TaskSharedActions.addTask> =>
    createActions().at(-1) as ReturnType<typeof TaskSharedActions.addTask>;

  /** Імітація перезапуску застосунку: новий екземпляр сервісу, той самий localStorage. */
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
      ({ title, workContextId, workContextType }) =>
        ({
          id: `task-${++idCounter}`,
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
      ],
    });
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch');
    service = TestBed.inject(QuickAddDraftService);
  };

  beforeEach(() => {
    jasmine.clock().install();
    localStorage.removeItem(QUICK_ADD_DRAFT_LS_KEY);
    workContext.activeWorkContextId = 'projectA';
    workContext.activeWorkContextType = WorkContextType.PROJECT;
    idCounter = 0;
    configure();
  });

  afterEach(() => {
    service.ngOnDestroy();
    jasmine.clock().uninstall();
    localStorage.removeItem(QUICK_ADD_DRAFT_LS_KEY);
  });

  describe('QA #1: typed text survives power loss / process kill', () => {
    it('writes every keystroke to localStorage synchronously', () => {
      service.open('UNDONE');

      service.setTitle('К');
      expect(stored()).toEqual({
        v: 1,
        title: 'К',
        target: {
          workContextId: 'projectA',
          workContextType: WorkContextType.PROJECT,
          parentId: null,
        },
      });

      service.setTitle('Купити');
      expect((stored() as { title: string }).title).toBe('Купити');
    });

    it('restores an unfinished draft after a restart as exactly one task', () => {
      service.open('UNDONE');
      typeChars('Купити фарбу');
      expect(createActions().length).toBe(0);

      restartApp();
      const id = service.restorePendingDraft();

      expect(id).toBe('task-1');
      expect(createActions().length).toBe(1);
      expect(lastAddTask().task.title).toBe('Купити фарбу');
      expect(lastAddTask().workContextId).toBe('projectA');
      expect(stored()).toBeNull();
      expect(snackService.open).toHaveBeenCalledTimes(1);
    });

    it('restoring twice never creates a duplicate', () => {
      service.open('UNDONE');
      typeChars('Once');
      restartApp();

      service.restorePendingDraft();
      service.restorePendingDraft();

      expect(createActions().length).toBe(1);
    });

    it('ignores missing, empty or corrupted stored drafts', () => {
      expect(service.restorePendingDraft()).toBeNull();

      localStorage.setItem(QUICK_ADD_DRAFT_LS_KEY, '{not json');
      expect(service.restorePendingDraft()).toBeNull();

      localStorage.setItem(QUICK_ADD_DRAFT_LS_KEY, JSON.stringify({ v: 1, title: 'x' }));
      expect(service.restorePendingDraft()).toBeNull();

      expect(createActions().length).toBe(0);
      expect(stored()).toBeNull();
    });

    it('does not restore while a draft is being edited', () => {
      localStorage.setItem(
        QUICK_ADD_DRAFT_LS_KEY,
        JSON.stringify({
          v: 1,
          title: 'Old',
          target: {
            workContextId: 'projectA',
            workContextType: 'PROJECT',
            parentId: null,
          },
        }),
      );
      service.open('UNDONE');

      expect(service.restorePendingDraft()).toBeNull();
    });

    it('keeps working when localStorage throws (quota / unavailable)', () => {
      spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');
      service.open('UNDONE');

      expect(() => typeChars('Still works')).not.toThrow();
      expect(service.commit('enter')).toBe('task-1');
    });

    it('restores into Inbox when the original project no longer exists', () => {
      localStorage.setItem(
        QUICK_ADD_DRAFT_LS_KEY,
        JSON.stringify({
          v: 1,
          title: 'Orphan',
          target: {
            workContextId: 'deleted',
            workContextType: 'PROJECT',
            parentId: null,
          },
        }),
      );

      service.restorePendingDraft();

      expect(lastAddTask().workContextId).toBe(INBOX_PROJECT.id);
      expect(lastAddTask().workContextType).toBe(WorkContextType.PROJECT);
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
    it('commit dispatches a single addTask at the bottom, with short syntax', () => {
      service.open('UNDONE');
      typeChars('Call Anna #work @tomorrow');
      jasmine.clock().tick(10_000);

      const id = service.commit('enter');

      expect(id).toBe('task-1');
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

    it('opening a new row commits the previous non-empty draft', () => {
      service.open('UNDONE');
      typeChars('First');

      service.open('UNDONE');

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
