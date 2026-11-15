import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  afterRenderEffect,
  computed,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { QuickAddDraftService } from '../quick-add-draft.service';

/**
 * Inline-рядок вводу нової задачі, що стоїть одразу після списку задач
 * (поза cdkDropList, щоб не ламати індекси drag-drop).
 * Сам нічого не створює — лише передає текст і клавіші в QuickAddDraftService.
 */
@Component({
  selector: 'quick-add-row',
  templateUrl: './quick-add-row.component.html',
  styleUrl: './quick-add-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconButton, MatIcon, MatTooltip, TranslatePipe],
})
export class QuickAddRowComponent implements OnInit {
  private readonly _draft = inject(QuickAddDraftService);
  private readonly _destroyRef = inject(DestroyRef);

  /** Ключ списку, до якого належить рядок (напр. 'UNDONE'). */
  readonly listKey = input.required<string>();

  readonly T = T;
  readonly isOpen = computed(
    () => this._draft.state() === 'editing' && this._draft.listKey() === this.listKey(),
  );

  private readonly _inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  constructor() {
    // Фокус одразу після появи поля
    afterRenderEffect(() => {
      const el = this._inputEl()?.nativeElement;
      if (el && this.isOpen()) {
        untracked(() => el.focus());
      }
    });
  }

  ngOnInit(): void {
    const listKey = this.listKey();
    this._draft.registerRow(listKey);
    this._destroyRef.onDestroy(() => {
      // Рядок зникає (зміна контексту/режиму) — завершуємо набране, а не губимо
      if (this.isOpen()) {
        this._draft.commit('blur');
      }
      this._draft.unregisterRow(listKey);
    });
  }

  onInput(): void {
    // Значення читаємо з DOM — безпечно для IME і мертвих клавіш
    this._draft.setTitle(this._liveValue());
  }

  onKeydown(ev: KeyboardEvent): void {
    // Глобальні й задачні шорткати не повинні перехоплювати набір
    ev.stopPropagation();
    if (ev.isComposing || ev.repeat) {
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this._draft.discard();
      return;
    }
    // Alt/Ctrl+Enter (підзадача) — PR-5; поки що обробляємо лише чистий Enter
    if (ev.key === 'Enter' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      ev.preventDefault();
      this.commitAndContinue(true);
    }
  }

  /** Зберегти задачу і одразу відкрити новий порожній рядок під нею. */
  commitAndContinue(isFromKeyboard: boolean): void {
    if (!this._liveValue().trim()) {
      // Порожній Enter не створює задачу; з кнопки — просто лишаємось у полі
      if (isFromKeyboard) {
        this._draft.discard();
      }
      return;
    }
    this._draft.setTitle(this._liveValue());
    this._draft.commit('enter');
    this._clearInput();
    this._draft.open(this.listKey());
  }

  onBlur(): void {
    if (!this.isOpen()) {
      return;
    }
    if (this._liveValue().trim()) {
      this._draft.commit('blur');
    } else {
      this._draft.discard();
    }
  }

  private _liveValue(): string {
    return this._inputEl()?.nativeElement.value ?? '';
  }

  private _clearInput(): void {
    const el = this._inputEl()?.nativeElement;
    if (el) {
      el.value = '';
    }
  }
}
