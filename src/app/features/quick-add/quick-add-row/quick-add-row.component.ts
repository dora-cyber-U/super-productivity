import { DOCUMENT } from '@angular/common';
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
  private static readonly _DISARM_KEYS = new Set([
    'Escape',
    'Enter',
    'Tab',
    'ArrowUp',
    'ArrowDown',
  ]);

  private readonly _draft = inject(QuickAddDraftService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _document = inject(DOCUMENT);

  /** Ключ списку, до якого належить рядок (напр. 'UNDONE'). */
  readonly listKey = input.required<string>();

  readonly T = T;
  /** Рядок належить цьому списку і чернетка активна (armed або editing). */
  readonly isActive = computed(
    () => this._draft.state() !== 'idle' && this._draft.listKey() === this.listKey(),
  );
  /** Після одинарного кліку: поле вже у фокусі, але невидиме до першого символу. */
  readonly isArmed = computed(() => this.isActive() && this._draft.state() === 'armed');
  /** Рядок видно і йде набір. */
  readonly isOpen = computed(() => this.isActive() && this._draft.state() === 'editing');

  private readonly _inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  constructor() {
    afterRenderEffect(() => {
      const el = this._inputEl()?.nativeElement;
      if (!el || !this.isActive()) {
        return;
      }
      const isArmed = this.isArmed();
      untracked(() => {
        // У стані armed не прокручуємо до кінця списку — поле ще невидиме
        if (this._document.activeElement !== el) {
          el.focus({ preventScroll: isArmed });
        }
        if (!isArmed) {
          el.scrollIntoView({ block: 'nearest' });
        }
      });
    });
  }

  ngOnInit(): void {
    const listKey = this.listKey();
    this._draft.registerRow(listKey);
    // Чернетка, що лишилась після вимкнення світла чи аварії, стає задачею.
    // Роут робочого вигляду активується лише після завантаження даних (app.guard),
    // тож проєкти/теги для перевірки контексту вже є в store.
    this._draft.restorePendingDraft();
    this._destroyRef.onDestroy(() => {
      // Рядок зникає (зміна контексту/режиму) — завершуємо набране, а не губимо
      if (this.isOpen()) {
        this._draft.commit('blur');
      } else if (this.isArmed()) {
        this._draft.disarm();
      }
      this._draft.unregisterRow(listKey);
    });
  }

  /**
   * Перший символ (або початок IME-композиції) у стані armed робить рядок
   * видимим: це те саме поле, тож символ уже в ньому і нічого не губиться.
   */
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
    // Клавіші керування до першого символу — передумали, виходимо з armed
    if (this.isArmed()) {
      if (QuickAddRowComponent._DISARM_KEYS.has(ev.key)) {
        ev.preventDefault();
        this._draft.disarm();
      }
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
    // Перемкнулись в інше вікно (Alt+Tab): чернетка вже в localStorage,
    // лишаємо рядок відкритим — після повернення фокус повернеться в поле
    if (!this.isActive() || !this._document.hasFocus()) {
      return;
    }
    // Клік деінде до першого символу — просто знімаємо armed
    if (this.isArmed()) {
      this._draft.disarm();
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
