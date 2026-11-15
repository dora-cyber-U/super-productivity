import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TaskService } from '../tasks/task.service';
import { TaskWithSubTasks } from '../tasks/task.model';
import { QuickAddDraftService } from './quick-add-draft.service';
import {
  QUICK_ADD_ARM_TIMEOUT_MS,
  QUICK_ADD_CREATE_IDLE_MS,
  QUICK_ADD_UPDATE_IDLE_MS,
  QUICK_ADD_UPDATE_MAX_WAIT_MS,
} from './quick-add.const';

describe('QuickAddDraftService', () => {
  let service: QuickAddDraftService;
  let taskService: jasmine.SpyObj<TaskService>;
  const storedTask = { id: 'new-task', subTaskIds: [] } as unknown as TaskWithSubTasks;

  // Набір посимвольно, як це робитиме input
  const typeChars = (text: string, startFrom = ''): void => {
    let value = startFrom;
    for (const char of text) {
      value += char;
      service.setTitle(value);
    }
  };

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 10, 15, 10, 0, 0));
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'add',
      'addSubTaskTo',
      'update',
      'remove',
      'getByIdWithSubTaskData$',
    ]);
    taskService.add.and.returnValue('new-task');
    taskService.addSubTaskTo.and.returnValue('new-sub-task');
    taskService.getByIdWithSubTaskData$.and.returnValue(of(storedTask));

    TestBed.configureTestingModule({
      providers: [QuickAddDraftService, { provide: TaskService, useValue: taskService }],
    });
    service = TestBed.inject(QuickAddDraftService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    jasmine.clock().uninstall();
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
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS);

      expect(taskService.add).not.toHaveBeenCalled();
    });

    it('hides the created task from the list only while editing', () => {
      service.open('UNDONE');
      typeChars('Task');
      expect(service.hiddenTaskId()).toBeNull();

      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS);
      expect(service.hiddenTaskId()).toBe('new-task');

      service.commit('enter');
      expect(service.hiddenTaskId()).toBeNull();
    });
  });

  describe('create (debounced)', () => {
    it('creates nothing while typing and exactly one task after the idle pause', () => {
      service.open('UNDONE');
      typeChars('Buy milk');
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS - 1);
      expect(taskService.add).not.toHaveBeenCalled();

      jasmine.clock().tick(1);
      expect(taskService.add).toHaveBeenCalledOnceWith('Buy milk', false, {}, true, true);
      expect(service.taskId()).toBe('new-task');
    });

    it('does not create a task for whitespace only', () => {
      service.open('UNDONE');
      typeChars('   ');
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS * 2);

      expect(taskService.add).not.toHaveBeenCalled();
    });

    it('commit before the pause creates once with short syntax and no update', () => {
      service.open('UNDONE');
      typeChars('Call Anna #work');

      const id = service.commit('enter');

      expect(id).toBe('new-task');
      expect(taskService.add).toHaveBeenCalledOnceWith(
        'Call Anna #work',
        false,
        {},
        true,
        false,
      );
      expect(taskService.update).not.toHaveBeenCalled();
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS * 2);
      expect(taskService.add).toHaveBeenCalledTimes(1);
      expect(service.state()).toBe('idle');
    });

    it('creates sub-tasks only on commit via addSubTaskTo', () => {
      service.open('UNDONE', 'parent-1');
      typeChars('Sub step');
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS * 2);
      expect(taskService.addSubTaskTo).not.toHaveBeenCalled();

      const id = service.commit('enter');

      expect(id).toBe('new-sub-task');
      expect(taskService.addSubTaskTo).toHaveBeenCalledOnceWith('parent-1', {
        title: 'Sub step',
      });
      expect(taskService.add).not.toHaveBeenCalled();
    });
  });

  describe('update (debounced + max wait)', () => {
    const createDraft = (): void => {
      service.open('UNDONE');
      typeChars('Buy');
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS);
    };

    it('saves further typing once per pause, ignoring short syntax', () => {
      createDraft();
      typeChars(' milk', 'Buy');
      jasmine.clock().tick(QUICK_ADD_UPDATE_IDLE_MS - 1);
      expect(taskService.update).not.toHaveBeenCalled();

      jasmine.clock().tick(1);
      expect(taskService.update).toHaveBeenCalledOnceWith(
        'new-task',
        { title: 'Buy milk' },
        true,
      );
    });

    it('saves at least every max-wait interval during continuous typing', () => {
      createDraft();
      let value = 'Buy';
      // символ кожні 200 мс — debounce сам по собі ніколи б не спрацював
      for (let i = 0; i < 25; i++) {
        value += 'x';
        service.setTitle(value);
        jasmine.clock().tick(200);
      }

      // 25 * 200 = 5000 мс безперервного набору → одне збереження по maxWait
      expect(taskService.update).toHaveBeenCalledTimes(1);
      expect(QUICK_ADD_UPDATE_MAX_WAIT_MS).toBeLessThan(5000);
    });

    it('skips the update when the title did not change', () => {
      createDraft();
      service.setTitle('Buy ');
      service.setTitle('Buy');
      jasmine.clock().tick(QUICK_ADD_UPDATE_IDLE_MS);

      expect(taskService.update).not.toHaveBeenCalled();
    });

    it('commit flushes pending typing with one short-syntax update', () => {
      createDraft();
      typeChars(' milk #home', 'Buy');

      const id = service.commit('enter');

      expect(id).toBe('new-task');
      expect(taskService.update).toHaveBeenCalledOnceWith(
        'new-task',
        { title: 'Buy milk #home' },
        false,
      );
      jasmine.clock().tick(QUICK_ADD_UPDATE_MAX_WAIT_MS);
      expect(taskService.update).toHaveBeenCalledTimes(1);
      expect(taskService.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('discard (Esc / empty blur)', () => {
    it('discarding a local-only draft creates no ops', () => {
      service.open('UNDONE');
      typeChars('Oops');

      service.discard();
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS * 2);

      expect(taskService.add).not.toHaveBeenCalled();
      expect(taskService.remove).not.toHaveBeenCalled();
      expect(service.state()).toBe('idle');
    });

    it('discarding a created draft deletes it once', () => {
      service.open('UNDONE');
      typeChars('Oops');
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS);

      service.discard();

      expect(taskService.getByIdWithSubTaskData$).toHaveBeenCalledWith('new-task');
      expect(taskService.remove).toHaveBeenCalledOnceWith(storedTask);
      expect(service.taskId()).toBeNull();
    });

    it('committing an emptied draft deletes it instead of saving', () => {
      service.open('UNDONE');
      typeChars('Oops');
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS);
      service.setTitle('');
      jasmine.clock().tick(QUICK_ADD_UPDATE_MAX_WAIT_MS);

      expect(service.commit('blur')).toBeNull();
      expect(taskService.update).not.toHaveBeenCalled();
      expect(taskService.remove).toHaveBeenCalledTimes(1);
    });

    it('does not delete when the task is already gone', () => {
      taskService.getByIdWithSubTaskData$.and.returnValue(of(undefined));
      service.open('UNDONE');
      typeChars('Oops');
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS);

      service.discard();

      expect(taskService.remove).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('saves unsaved typing immediately without short syntax', () => {
      service.open('UNDONE');
      typeChars('Buy');
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS);
      typeChars(' milk', 'Buy');

      service.flush();

      expect(taskService.update).toHaveBeenCalledOnceWith(
        'new-task',
        { title: 'Buy milk' },
        true,
      );
      jasmine.clock().tick(QUICK_ADD_UPDATE_MAX_WAIT_MS);
      expect(taskService.update).toHaveBeenCalledTimes(1);
      expect(service.state()).toBe('editing');
    });

    it('does nothing without a created task or unsaved changes', () => {
      service.open('UNDONE');
      typeChars('Buy');
      service.flush();
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS);
      service.flush();

      expect(taskService.update).not.toHaveBeenCalled();
    });
  });

  describe('switching drafts', () => {
    it('opening a new row commits the previous non-empty draft', () => {
      service.open('UNDONE');
      typeChars('First');

      service.open('UNDONE');

      expect(taskService.add).toHaveBeenCalledOnceWith('First', false, {}, true, false);
      expect(service.state()).toBe('editing');
      expect(service.taskId()).toBeNull();
    });

    it('arming elsewhere discards an empty created draft', () => {
      service.open('UNDONE');
      typeChars('X');
      jasmine.clock().tick(QUICK_ADD_CREATE_IDLE_MS);
      service.setTitle('');

      service.arm('UNDONE');

      expect(taskService.remove).toHaveBeenCalledTimes(1);
      expect(service.state()).toBe('armed');
    });
  });
});
