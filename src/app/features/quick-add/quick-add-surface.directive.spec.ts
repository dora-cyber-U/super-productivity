import { NO_ERRORS_SCHEMA, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TaskMultiSelectService } from '../tasks/task-multi-select.service';
import { QuickAddDraftService } from './quick-add-draft.service';
import { QuickAddSurfaceDirective } from './quick-add-surface.directive';

@Component({
  template: `
    <div
      class="surface"
      quickAddSurface="UNDONE"
    >
      <div class="gap"></div>
      <task><span class="title">Task</span></task>
    </div>
  `,
  imports: [QuickAddSurfaceDirective],
  // <task> тут лише розмітка для hit-test, без справжнього компонента
  schemas: [NO_ERRORS_SCHEMA],
})
class HostComponent {}

describe('QuickAddSurfaceDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let draft: jasmine.SpyObj<QuickAddDraftService>;
  const isMultiSelectActive = signal(false);
  const openDialogs: unknown[] = [];

  const el = (sel: string): HTMLElement =>
    fixture.nativeElement.querySelector(sel) as HTMLElement;

  // pointerdown → click → (опційно) dblclick, як це робить браузер
  const pointerSequence = (
    target: HTMLElement,
    pointerType: string,
    { isDouble = false, moveBy = 0 } = {},
  ): void => {
    target.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType, clientX: 10 }),
    );
    const init = { bubbles: true, button: 0, clientX: 10 + moveBy };
    target.dispatchEvent(new MouseEvent('click', init));
    if (isDouble) {
      target.dispatchEvent(new MouseEvent('click', init));
      target.dispatchEvent(new MouseEvent('dblclick', init));
    }
  };

  beforeEach(() => {
    isMultiSelectActive.set(false);
    openDialogs.length = 0;
    draft = jasmine.createSpyObj<QuickAddDraftService>('QuickAddDraftService', [
      'open',
      'arm',
      'hasRow',
    ]);
    draft.hasRow.and.returnValue(true);

    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: QuickAddDraftService, useValue: draft },
        { provide: TaskMultiSelectService, useValue: { isActive: isMultiSelectActive } },
        { provide: MatDialog, useValue: { openDialogs } },
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('opens the row on mouse double click on empty space', () => {
    pointerSequence(el('.gap'), 'mouse', { isDouble: true });

    expect(draft.open).toHaveBeenCalledOnceWith('UNDONE');
  });

  it('arms (not opens) the row on a single mouse click', () => {
    pointerSequence(el('.gap'), 'mouse');

    expect(draft.arm).toHaveBeenCalledOnceWith('UNDONE');
    expect(draft.open).not.toHaveBeenCalled();
  });

  it('does not arm on a single click on a task or with selected text', () => {
    pointerSequence(el('.title'), 'mouse');
    const range = document.createRange();
    range.selectNodeContents(el('.title'));
    window.getSelection()?.addRange(range);
    pointerSequence(el('.gap'), 'mouse');
    window.getSelection()?.removeAllRanges();

    expect(draft.arm).not.toHaveBeenCalled();
  });

  it('opens on a single touch tap', () => {
    pointerSequence(el('.gap'), 'touch');

    expect(draft.open).toHaveBeenCalledOnceWith('UNDONE');
    expect(draft.arm).not.toHaveBeenCalled();
  });

  it('ignores double clicks on a task', () => {
    pointerSequence(el('.title'), 'mouse', { isDouble: true });

    expect(draft.open).not.toHaveBeenCalled();
  });

  it('ignores the gesture when the pointer moved', () => {
    pointerSequence(el('.gap'), 'mouse', { isDouble: true, moveBy: 20 });

    expect(draft.open).not.toHaveBeenCalled();
  });

  it('ignores the gesture during multi-select or with an open dialog', () => {
    isMultiSelectActive.set(true);
    pointerSequence(el('.gap'), 'mouse', { isDouble: true });
    isMultiSelectActive.set(false);
    openDialogs.push({});
    pointerSequence(el('.gap'), 'mouse', { isDouble: true });

    expect(draft.open).not.toHaveBeenCalled();
  });

  it('does nothing when no row is rendered for the list', () => {
    draft.hasRow.and.returnValue(false);
    pointerSequence(el('.gap'), 'mouse', { isDouble: true });

    pointerSequence(el('.gap'), 'mouse');

    expect(draft.hasRow).toHaveBeenCalledWith('UNDONE');
    expect(draft.open).not.toHaveBeenCalled();
    expect(draft.arm).not.toHaveBeenCalled();
  });
});
