import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  afterRenderEffect,
  computed,
  effect,
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
  /**
   * id задач у тому порядку, як їх видно над рядком. Після reload
   * Alt+Enter на порожньому рядку бере останню звідси, а не з taskIds.
   */
  readonly visibleTaskIds = input<readonly string[]>([]);
  /**
   * Якщо задано — цей екземпляр є рядком підзадачі під вказаним батьком.
   * Верхній рядок списку лишає значення порожнім (null).
   */
  readonly forParentId = input<string | null>(null);

  readonly T = T;
  /** Підказка залежить від того, чи це рядок підзадачі. */
  readonly placeholderKey = computed(() =>
    this.forParentId() ? T.F.QUICK_ADD.PLACEHOLDER_SUBTASK : T.F.QUICK_ADD.PLACEHOLDER,
  );
  /** Рядок належить цьому списку, цьому рівню вкладеності і чернетка активна. */
  readonly isActive = computed(
    () =>
      this._draft.state() !== 'idle' &&
      this._draft.listKey() === this.listKey() &&
      (this._draft.parentId() ?? null) === (this.forParentId() ?? null),
  );
  /** Після одинарного кліку: поле вже у фокусі, але невидиме до першого символу. */
  readonly isArmed = computed(() => this.isActive() && this._draft.state() === 'armed');
  /** Рядок видно і йде набір. */
  readonly isOpen = computed(() => this.isActive() && this._draft.state() === 'editing');

  private readonly _inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  constructor() {
    effect(() => {
      const listKey = this.listKey();
      const ids = this.visibleTaskIds();
      untracked(() => this._draft.setVisibleTaskIds(listKey, ids));
    });
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
    // Рядок підзадачі з'являється під батьком і не є «поверхнею» для кліку
    // по порожньому місцю — реєструємо лише верхній рядок списку.
    const isSurfaceRow = !this.forParentId();
    if (isSurfaceRow) {
      this._draft.registerRow(listKey);
      // Страховка: основне відновлення вже робить QuickAddRestoreEffects після
      // завантаження store. Якщо рядок змонтовано першим — той самий Web Lock
      // не дасть створити задачу двічі.
      void this._draft.restorePendingDraft();
    }
    this._destroyRef.onDestroy(() => {
      // Рядок зникає (зміна контексту/режиму) — завершуємо набране, а не губимо
      if (this.isOpen()) {
        this._draft.commit('blur');
      } else if (this.isArmed()) {
        this._draft.disarm();
      }
      if (isSurfaceRow) {
        this._draft.unregisterRow(listKey);
      }
    });
  }

  /**
   * Перший символ (або початок IME-композиції) у стані armed робить рядок
   * видимим: це те саме поле, тож символ уже в ньому і нічого не губиться.
   */
  onInput(): void {
    const wasArmed = this.isArmed();
    // Значення читаємо з DOM — безпечно для IME і мертвих клавіш
    this._draft.setTitle(this._liveValue());
    if (wasArmed) {
      this._moveCaretToEnd();
    }
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
      // Порожній Esc на підзадачі — на рівень вище; з текстом — скасувати, як завжди
      if (!this._liveValue().trim() && this.forParentId()) {
        this._draft.goUpOneLevel(this.listKey());
      } else {
        this._draft.discard();
      }
      return;
    }
    if (ev.key === 'Tab' && ev.shiftKey && this.forParentId()) {
      ev.preventDefault();
      // Порожній Shift+Tab — вгору; з текстом — спочатку зберегти, потім вгору
      if (this._liveValue().trim()) {
        this._commitAndGoUp();
      } else {
        this._draft.goUpOneLevel(this.listKey());
      }
      return;
    }
    // Alt/Ctrl/Cmd+Enter: зберегти і відкрити рядок підзадачі (або сусіда, якщо вже 2-й рівень)
    if (ev.key === 'Enter' && (ev.altKey || ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      this._draft.setTitle(this._liveValue());
      this._draft.startSubtaskRow(this.listKey());
      this._clearInput();
      return;
    }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      this.commitAndContinue(true);
    }
  }

  /** Зберегти задачу і одразу відкрити новий порожній рядок на тому ж рівні. */
  commitAndContinue(isFromKeyboard: boolean): void {
    if (!this._liveValue().trim()) {
      // Порожній Enter не створює задачу; з кнопки — просто лишаємось у полі
      if (isFromKeyboard) {
        this._draft.discard();
      }
      return;
    }
    // Батька беремо до commit: після нього parentId скидається в idle
    const parentId = this._draft.parentId();
    this._draft.setTitle(this._liveValue());
    this._draft.commit('enter');
    this._clearInput();
    this._draft.open(this.listKey(), parentId);
  }

  /** Shift+Tab з текстом на рядку підзадачі: зберегти і піднятися наверх. */
  private _commitAndGoUp(): void {
    this._draft.setTitle(this._liveValue());
    this._draft.commit('enter');
    this._clearInput();
    this._draft.open(this.listKey(), null);
  }

  onBlur(): void {
    // Перемкнулись в інше вікно (Alt+Tab): чернетку в цю мить записано в
    // IndexedDB (QuickAddDraftStore слухає blur вікна), тож лишаємо рядок
    // відкритим — після повернення фокус повернеться в поле
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

  /**
   * Текст, вставлений без keydown (диктування, емодзі-панель, частина IME),
   * у прихованому (висота 0) полі лишає каретку на 0 — і далі набір іде
   * ПЕРЕД першим символом («упити фарбуК»). Після першого вводу ставимо
   * каретку в кінець.
   */
  private _moveCaretToEnd(): void {
    const el = this._inputEl()?.nativeElement;
    if (el) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }

  private _clearInput(): void {
    const el = this._inputEl()?.nativeElement;
    if (el) {
      el.value = '';
    }
  }
}
