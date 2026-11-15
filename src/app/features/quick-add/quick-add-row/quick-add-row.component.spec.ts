import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { selectTagFeatureState } from '../../tag/store/tag.reducer';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import { Task } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { QUICK_ADD_DRAFT_LS_KEY } from '../quick-add.const';
import { QuickAddDraftService } from '../quick-add-draft.service';
import { QuickAddRowComponent } from './quick-add-row.component';

describe('QuickAddRowComponent', () => {
  let fixture: ComponentFixture<QuickAddRowComponent>;
  let draft: QuickAddDraftService;
  let dispatchSpy: jasmine.Spy;
  let hasFocusSpy: jasmine.Spy;

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
    localStorage.removeItem(QUICK_ADD_DRAFT_LS_KEY);
    const taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'createNewTaskWithDefaults',
    ]);
    let idCounter = 0;
    taskService.createNewTaskWithDefaults.and.callFake(
      ({ title }) => ({ id: `task-${++idCounter}`, title }) as Task,
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
    localStorage.removeItem(QUICK_ADD_DRAFT_LS_KEY);
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
    expect(localStorage.getItem(QUICK_ADD_DRAFT_LS_KEY)).toContain('Half typed');
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
    localStorage.setItem(
      QUICK_ADD_DRAFT_LS_KEY,
      JSON.stringify({
        v: 1,
        title: 'From before the blackout',
        target: { workContextId: 'projectA', workContextType: 'PROJECT', parentId: null },
      }),
    );

    fixture = TestBed.createComponent(QuickAddRowComponent);
    fixture.componentRef.setInput('listKey', 'UNDONE');
    await render();

    expect(createdTitles()).toEqual(['From before the blackout']);
    expect(localStorage.getItem(QUICK_ADD_DRAFT_LS_KEY)).toBeNull();
  });
});
