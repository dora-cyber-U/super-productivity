import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  untracked,
} from '@angular/core';
import { QuickAddDraftService } from './quick-add-draft.service';
import { QuickAddRowComponent } from './quick-add-row/quick-add-row.component';

/**
 * Монтує рядок підзадачі в слот під батьком (data-quick-add-parent),
 * який рендерить task.component. Сам лишається в work-view, щоб
 * features/tasks не імпортував UI з features/quick-add.
 */
@Component({
  selector: 'quick-add-subtask-outlet',
  template: `
    @if (parentId(); as id) {
      <quick-add-row
        [listKey]="listKey()"
        [forParentId]="id"
      ></quick-add-row>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QuickAddRowComponent],
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class QuickAddSubtaskOutletComponent {
  private readonly _draft = inject(QuickAddDraftService);
  private readonly _el = inject(ElementRef<HTMLElement>);
  private _home: ParentNode | null = null;

  readonly parentId = computed(() => this._draft.parentId());
  readonly listKey = computed(() => this._draft.listKey() ?? 'UNDONE');

  constructor() {
    afterRenderEffect(() => {
      const parentId = this.parentId();
      const el = this._el.nativeElement;
      untracked(() => {
        this._home ??= el.parentNode;
        if (!parentId) {
          if (this._home && el.parentNode !== this._home) {
            this._home.appendChild(el);
          }
          return;
        }
        const host = el.ownerDocument.querySelector(
          `[data-quick-add-parent="${CSS.escape(parentId)}"]`,
        );
        if (host && el.parentNode !== host) {
          host.appendChild(el);
        }
      });
    });
  }
}
