import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { TaskService } from '../../tasks/task.service';
import { QuickAddDraftService } from '../quick-add-draft.service';
import { QuickAddRowComponent } from './quick-add-row.component';

describe('QuickAddRowComponent', () => {
  let fixture: ComponentFixture<QuickAddRowComponent>;
  let draft: QuickAddDraftService;
  let taskService: jasmine.SpyObj<TaskService>;

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
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'add',
      'addSubTaskTo',
      'update',
      'remove',
      'getByIdWithSubTaskData$',
    ]);
    taskService.add.and.returnValues('task-1', 'task-2', 'task-3');
    taskService.getByIdWithSubTaskData$.and.returnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [QuickAddRowComponent, TranslateModule.forRoot()],
      providers: [{ provide: TaskService, useValue: taskService }],
    }).compileComponents();

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
    expect(taskService.add).toHaveBeenCalledOnceWith('Buy milk', false, {}, true, false);
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

    expect(taskService.add.calls.allArgs().map((args) => args[0])).toEqual([
      'One',
      'Two',
      'Three',
    ]);
  });

  it('Enter on an empty row closes it without creating anything', async () => {
    draft.open('UNDONE');
    await render();

    keydown('Enter');
    await render();

    expect(taskService.add).not.toHaveBeenCalled();
    expect(input()).toBeNull();
  });

  it('Esc cancels the draft', async () => {
    draft.open('UNDONE');
    await render();
    type('Never mind');

    keydown('Escape');
    await render();

    expect(input()).toBeNull();
    expect(taskService.add).not.toHaveBeenCalled();
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

    expect(taskService.add).not.toHaveBeenCalled();
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

    expect(taskService.add).toHaveBeenCalledOnceWith(
      'Saved on blur',
      false,
      {},
      true,
      false,
    );
    expect(input()).toBeNull();
  });

  it('the submit button saves and continues like Enter', async () => {
    draft.open('UNDONE');
    await render();
    type('Via button');

    (fixture.nativeElement.querySelector('.submit-btn') as HTMLButtonElement).click();
    await render();

    expect(taskService.add).toHaveBeenCalledOnceWith(
      'Via button',
      false,
      {},
      true,
      false,
    );
    expect(draft.state()).toBe('editing');
  });

  it('saves typed text when the row is destroyed (context switch)', async () => {
    draft.open('UNDONE');
    await render();
    type('Do not lose me');

    fixture.destroy();

    expect(taskService.add).toHaveBeenCalledOnceWith(
      'Do not lose me',
      false,
      {},
      true,
      false,
    );
    expect(draft.state()).toBe('idle');
  });
});
