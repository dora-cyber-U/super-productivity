import { DOCUMENT } from '@angular/common';
import { Directive, inject, input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TaskMultiSelectService } from '../tasks/task-multi-select.service';
import { QuickAddDraftService } from './quick-add-draft.service';
import { isEmptySurfaceClick } from './is-empty-surface-click';

/**
 * Робить контейнер «поверхнею» швидкого додавання в списку `quickAddSurface`:
 * - одинарний клік по порожньому місцю «озброює» рядок: поле вже у фокусі,
 *   але з'являється лише з першим надрукованим символом;
 * - подвійний клік одразу відкриває рядок з курсором;
 * - на сенсорному екрані одразу відкриває один тап (без видимого поля
 *   не з'явиться клавіатура).
 *
 * Директива лише розпізнає жест; стан і створення задач — у QuickAddDraftService.
 */
@Directive({
  selector: '[quickAddSurface]',
  /* eslint-disable @typescript-eslint/naming-convention */
  host: {
    '(pointerdown)': 'onPointerDown($event)',
    '(click)': 'onClick($event)',
    '(dblclick)': 'onDblClick($event)',
  },
  /* eslint-enable @typescript-eslint/naming-convention */
})
export class QuickAddSurfaceDirective {
  private readonly _draft = inject(QuickAddDraftService);
  private readonly _multiSelect = inject(TaskMultiSelectService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _document = inject(DOCUMENT);

  /** Ключ списку, у якому відкривається рядок. */
  readonly quickAddSurface = input<string>('UNDONE');

  private _downX = 0;
  private _downY = 0;
  private _pointerType = '';

  onPointerDown(ev: PointerEvent): void {
    this._downX = ev.clientX;
    this._downY = ev.clientY;
    this._pointerType = ev.pointerType;
  }

  onClick(ev: MouseEvent): void {
    if (!this._isEmptyClick(ev, true)) {
      return;
    }
    if (this._pointerType === 'touch') {
      this._open();
    } else if (this._draft.hasRow(this.quickAddSurface())) {
      this._draft.arm(this.quickAddSurface());
    }
  }

  onDblClick(ev: MouseEvent): void {
    if (this._pointerType === 'touch' || !this._isEmptyClick(ev, false)) {
      return;
    }
    // Подвійний клік міг виділити слово поруч — прибираємо, щоб не заважало
    this._document.getSelection()?.removeAllRanges();
    this._open();
  }

  private _open(): void {
    const listKey = this.quickAddSurface();
    // Рядка може не бути (напр. у режимі секцій/груп) — тоді нічого не робимо
    if (this._draft.hasRow(listKey)) {
      this._draft.open(listKey);
    }
  }

  private _isEmptyClick(ev: MouseEvent, isCheckSelection: boolean): boolean {
    return isEmptySurfaceClick(ev, {
      movedPx: Math.hypot(ev.clientX - this._downX, ev.clientY - this._downY),
      isMultiSelectActive: this._multiSelect.isActive(),
      hasOpenDialog: this._matDialog.openDialogs.length > 0,
      isDragging: !!this._document.querySelector('.cdk-drag-preview'),
      isCheckSelection,
    });
  }
}
