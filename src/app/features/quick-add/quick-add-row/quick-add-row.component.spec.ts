import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { SnackService } from '../../../core/snack/snack.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { selectTagFeatureState } from '../../tag/store/tag.reducer';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import { Task } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { QUICK_ADD_ARM_TIMEOUT_MS } from '../quick-add.const';
import { QuickAddDraftStore } from '../quick-add-draft-store.service';
import { QuickAddDraftService } from '../quick-add-draft.service';
import { FakeQuickAddDraftStore } from '../testing/fake-quick-add-draft-store';
import { QuickAddRowComponent } from './quick-add-row.component';

describe('QuickAddRowComponent', () => {
  let fixture: ComponentFixture<QuickAddRowComponent>;
  let draft: QuickAddDraftService;
  let dispatchSpy: jasmine.Spy;
  let hasFocusSpy: jasmine.Spy;
  let draftStore: FakeQuickAddDraftStore;

  /** Назви задач, створених через addTask (кожна — одна операція op-log). */
  const createdTitles = (): string[] =>
    dispatchSpy.calls
      .allArgs()
      .map((args) => args[0])
      .filter((a) => a.type === TaskSharedActions.addTask.type)
      .map((a) => a.task.title);

  const input = (): HTMLInputElement | null =>
    fixture.nativeElement.querySelector('input.quick-add-input');

  const type = (value: string): void => {
    const el = input() as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };

  const keydown = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    (input() as HTMLInputElement).dispatchEvent(ev);
    return ev;
  };

  const render = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    jasmine.clock().install();
    draftStore = new FakeQuickAddDraftStore();
    const taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'createNewTaskWithDefaults',
    ]);
    let idCounter = 0;
    taskService.createNewTaskWithDefaults.and.callFake(
      ({ title, id }) => ({ id: id ?? `task-${++idCounter}`, title }) as Task,
    );

    await TestBed.configureTestingModule({
      imports: [QuickAddRowComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore({
          selectors: [
            {
              selector: selectProjectFeatureState,
              value: { ids: [], entities: { projectA: {} } },
            },
            { selector: selectTagFeatureState, value: { ids: [], entities: {} } },
            { selector: selectTaskEntities, value: {} },
          ],
        }),
        { provide: TaskService, useValue: taskService },
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContextId: 'projectA',
            activeWorkContextType: WorkContextType.PROJECT,
          },
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        { provide: QuickAddDraftStore, useValue: draftStore },
        {
          provide: OperationWriteFlushService,
          useValue: { flushPendingWrites: () => Promise.resolve() },
        },
      ],
    }).compileComponents();

    dispatchSpy = spyOn(TestBed.inject(MockStore), 'dispatch');
    // Тестовий браузер може не мати фокусу вікна — за замовчуванням вважаємо, що має
    hasFocusSpy = spyOn(document, 'hasFocus').and.returnValue(true);
    draft = TestBed.inject(QuickAddDraftService);
    fixture = TestBed.createComponent(QuickAddRowComponent);
    fixture.componentRef.setInput('listKey', 'UNDONE');
    await render();
  });

  afterEach(() => {
    fixture.destroy();
    jasmine.clock().uninstall();
  });

  it('registers itself so the surface knows where it can open', () => {
    expect(draft.hasRow('UNDONE')).toBeTrue();

    fixture.destroy();

    expect(draft.hasRow('UNDONE')).toBeFalse();
  });

  it('renders nothing while idle or when another list is active', async () => {
    expect(input()).toBeNull();

    draft.open('OTHER');
    await render();

    expect(input()).toBeNull();
  });

  it('shows a focused input when opened', async () => {
    draft.open('UNDONE');
    await render();

    expect(input()).not.toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it('Enter creates the task and keeps an empty focused row for the next one', async () => {
    draft.open('UNDONE');
    await render();
    type('Buy milk');

    const ev = keydown('Enter');
    await render();

    expect(ev.defaultPrevented).toBeTrue();
    expect(createdTitles()).toEqual(['Buy milk']);
    expect(draft.state()).toBe('editing');
    expect(input()?.value).toBe('');
    expect(document.activeElement).toBe(input());
  });

  it('chains several tasks with Enter', async () => {
    draft.open('UNDONE');
    await render();
    for (const title of ['One', 'Two', 'Three']) {
      type(title);
      keydown('Enter');
      await render();
    }

    expect(createdTitles()).toEqual(['One', 'Two', 'Three']);
  });

  it('Enter on an empty row closes it without creating anything', async () => {
    draft.open('UNDONE');
    await render();

    keydown('Enter');
    await render();

    expect(createdTitles()).toEqual([]);
    expect(input()).toBeNull();
  });

  it('Esc cancels the draft', async () => {
    draft.open('UNDONE');
    await render();
    type('Never mind');

    keydown('Escape');
    await render();

    expect(input()).toBeNull();
    expect(createdTitles()).toEqual([]);
  });

  it('does not let typing reach global shortcuts', async () => {
    draft.open('UNDONE');
    await render();
    const docSpy = jasmine.createSpy('documentKeydown');
    document.addEventListener('keydown', docSpy);

    keydown('c');

    document.removeEventListener('keydown', docSpy);
    expect(docSpy).not.toHaveBeenCalled();
  });

  it('ignores Enter during IME composition', async () => {
    draft.open('UNDONE');
    await render();
    type('Зада');

    keydown('Enter', { isComposing: true });

    expect(createdTitles()).toEqual([]);
  });

  it('blur on an empty row closes it; blur with text saves it', async () => {
    draft.open('UNDONE');
    await render();
    input()?.dispatchEvent(new Event('blur'));
    await render();
    expect(input()).toBeNull();

    draft.open('UNDONE');
    await render();
    type('Saved on blur');
    input()?.dispatchEvent(new Event('blur'));
    await render();

    expect(createdTitles()).toEqual(['Saved on blur']);
    expect(input()).toBeNull();
  });

  it('the submit button saves and continues like Enter', async () => {
    draft.open('UNDONE');
    await render();
    type('Via button');

    (fixture.nativeElement.querySelector('.submit-btn') as HTMLButtonElement).click();
    await render();

    expect(createdTitles()).toEqual(['Via button']);
    expect(draft.state()).toBe('editing');
  });

  it('saves typed text when the row is destroyed (context switch)', async () => {
    draft.open('UNDONE');
    await render();
    type('Do not lose me');

    fixture.destroy();

    expect(createdTitles()).toEqual(['Do not lose me']);
    expect(draft.state()).toBe('idle');
  });
  it('keeps the row and the draft when the window loses focus (Alt+Tab)', async () => {
    draft.open('UNDONE');
    await render();
    type('Half typed');
    hasFocusSpy.and.returnValue(false);

    input()?.dispatchEvent(new Event('blur'));
    await render();

    expect(input()).not.toBeNull();
    expect(createdTitles()).toEqual([]);
    expect(draftStore.draft?.title).toBe('Half typed');
  });

  it('typing creates no task until Enter', async () => {
    draft.open('UNDONE');
    await render();
    type('Slow');
    jasmine.clock().tick(60_000);
    type('Slow typing');
    jasmine.clock().tick(60_000);

    expect(createdTitles()).toEqual([]);
  });

  it('restores an unfinished draft from the last session when it appears', async () => {
    fixture.destroy();
    draftStore.draft = {
      v: 2,
      id: 'before-blackout',
      ts: 1,
      title: 'From before the blackout',
      target: {
        workContextId: 'projectA',
        workContextType: WorkContextType.PROJECT,
        parentId: null,
      },
    };

    fixture = TestBed.createComponent(QuickAddRowComponent);
    fixture.componentRef.setInput('listKey', 'UNDONE');
    await render();
    await draft.restorePendingDraft();

    expect(createdTitles()).toEqual(['From before the blackout']);
    expect(draftStore.draft).toBeNull();
  });
  describe('single click arm', () => {
    const row = (): HTMLElement | null =>
      fixture.nativeElement.querySelector('.quick-add-row');

    it('focuses an invisible input while armed', async () => {
      draft.arm('UNDONE');
      await render();

      expect(input()).not.toBeNull();
      expect(document.activeElement).toBe(input());
      expect(row()?.classList).toContain('is-armed');
      expect(getComputedStyle(row() as HTMLElement).opacity).toBe('0');
    });

    it('the first typed character reveals the row and is kept', async () => {
      draft.arm('UNDONE');
      await render();
      const armedInput = input();

      type('К');
      await render();

      expect(draft.state()).toBe('editing');
      expect(row()?.classList).not.toContain('is-armed');
      expect(input()).toBe(armedInput);
      expect(input()?.value).toBe('К');
      expect(document.activeElement).toBe(input());
    });

    it('text inserted without keydown keeps the caret after the first character', async () => {
      draft.arm('UNDONE');
      await render();
      // Так поводиться Chromium з прихованим полем при insertText (диктування,
      // емодзі-панель): символ вставлено, а каретка лишилась на 0
      const el = input() as HTMLInputElement;
      el.value = 'К';
      el.setSelectionRange(0, 0);
      el.dispatchEvent(new Event('input'));
      await render();

      expect(el.selectionStart).toBe(1);
      expect(el.selectionEnd).toBe(1);

      // наступний ввід у позицію каретки дає правильний порядок
      el.setRangeText(
        'упити',
        el.selectionStart as number,
        el.selectionEnd as number,
        'end',
      );
      el.dispatchEvent(new Event('input'));
      expect(el.value).toBe('Купити');
    });

    it('IME composition start also reveals the row', async () => {
      draft.arm('UNDONE');
      await render();

      input()?.dispatchEvent(new CompositionEvent('compositionstart'));
      await render();

      expect(draft.state()).toBe('editing');
    });

    it('then Enter creates exactly one task', async () => {
      draft.arm('UNDONE');
      await render();
      type('Перевірити креслення');

      keydown('Enter');
      await render();

      expect(createdTitles()).toEqual(['Перевірити креслення']);
    });

    for (const key of ['Escape', 'Enter', 'Tab', 'ArrowDown']) {
      it(`${key} before typing disarms without creating anything`, async () => {
        draft.arm('UNDONE');
        await render();

        keydown(key);
        await render();

        expect(draft.state()).toBe('idle');
        expect(input()).toBeNull();
        expect(createdTitles()).toEqual([]);
      });
    }

    it('single-letter global shortcuts do not fire while armed', async () => {
      draft.arm('UNDONE');
      await render();
      const docSpy = jasmine.createSpy('documentKeydown');
      document.addEventListener('keydown', docSpy);

      for (const key of ['c', 'b', 'f', 'w', 'j', 'k']) {
        keydown(key);
      }

      document.removeEventListener('keydown', docSpy);
      expect(docSpy).not.toHaveBeenCalled();
    });

    it('clicking elsewhere (blur) disarms', async () => {
      draft.arm('UNDONE');
      await render();

      input()?.dispatchEvent(new Event('blur'));
      await render();

      expect(draft.state()).toBe('idle');
    });

    it('disarms by itself after the timeout', async () => {
      draft.arm('UNDONE');
      await render();

      jasmine.clock().tick(QUICK_ADD_ARM_TIMEOUT_MS);
      await render();

      expect(input()).toBeNull();
    });
  });
});
