import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { first } from 'rxjs/operators';
import { TaskService } from '../tasks/task.service';
import {
  QUICK_ADD_ARM_TIMEOUT_MS,
  QUICK_ADD_CREATE_IDLE_MS,
  QUICK_ADD_UPDATE_IDLE_MS,
  QUICK_ADD_UPDATE_MAX_WAIT_MS,
} from './quick-add.const';

/**
 * idle    — нічого не відбувається;
 * armed   — один клік по порожньому місцю, чекаємо на перший символ;
 * editing — рядок вводу видно, триває набір.
 */
export type QuickAddState = 'idle' | 'armed' | 'editing';

/** Що завершило редагування: Enter, Alt/Ctrl+Enter (підзадача) чи втрата фокусу. */
export type QuickAddCommitTrigger = 'enter' | 'subtask' | 'blur';

/**
 * Стан inline-рядка швидкого додавання задачі.
 *
 * Це єдине місце quick-add, яке створює операції (через публічні методи
 * TaskService, без нових actions і без змін шару даних):
 * - набір перших символів — 0 опів, текст живе лише тут;
 * - пауза QUICK_ADD_CREATE_IDLE_MS — 1 Create (short syntax вимкнено);
 * - подальший набір — не більше 1 Update на паузу (short syntax вимкнено);
 * - commit — фінальний Update, і лише тоді один раз парситься short syntax
 *   (#тег, @дата, +проєкт), щоб проміжний текст не створював теги/дати;
 * - Esc / порожньо — 0 опів, або 1 Delete, якщо задача вже створена.
 */
@Injectable({ providedIn: 'root' })
export class QuickAddDraftService implements OnDestroy {
  private readonly _taskService = inject(TaskService);

  private readonly _state = signal<QuickAddState>('idle');
  private readonly _listKey = signal<string | null>(null);
  private readonly _parentId = signal<string | null>(null);
  private readonly _taskId = signal<string | null>(null);

  readonly state = this._state.asReadonly();
  /** Список, у якому відкрито рядок (напр. 'UNDONE' або ключ секції). */
  readonly listKey = this._listKey.asReadonly();
  /** Батьківська задача, якщо рядок створює підзадачу. */
  readonly parentId = this._parentId.asReadonly();
  /** Id створеної задачі; null — чернетка ще лише локальна. */
  readonly taskId = this._taskId.asReadonly();
  /** Поки триває набір, реальну задачу ховаємо зі списку, щоб не було дубля. */
  readonly hiddenTaskId = computed(() =>
    this._state() === 'editing' ? this._taskId() : null,
  );

  private _title = '';
  private _lastSavedTitle = '';
  private _firstUnsavedAt: number | null = null;
  private _createTimer: number | undefined;
  private _updateTimer: number | undefined;
  private _armTimer: number | undefined;

  /** Один клік: чекаємо, поки користувач почне друкувати. */
  arm(listKey: string): void {
    this._settleCurrent();
    this._listKey.set(listKey);
    this._state.set('armed');
    this._armTimer = window.setTimeout(() => this.disarm(), QUICK_ADD_ARM_TIMEOUT_MS);
  }

  /** Скасувати «озброєний» стан (Esc, клік деінде, таймаут). */
  disarm(): void {
    if (this._state() !== 'armed') {
      return;
    }
    this._resetToIdle();
  }

  /** Подвійний клік або Enter/Alt+Enter: одразу показати порожній рядок. */
  open(listKey: string, parentId: string | null = null): void {
    this._settleCurrent();
    this._listKey.set(listKey);
    this._parentId.set(parentId);
    this._state.set('editing');
  }

  /** Викликається на кожну зміну тексту в рядку. */
  setTitle(raw: string): void {
    if (this._state() === 'idle') {
      return;
    }
    if (this._state() === 'armed') {
      window.clearTimeout(this._armTimer);
      this._state.set('editing');
    }
    this._title = raw;
    const title = raw.trim();

    if (this._taskId()) {
      // Порожній текст не зберігаємо: на commit/blur чернетку буде видалено
      if (title) {
        this._scheduleUpdate();
      } else {
        this._clearUpdateTimer();
      }
      return;
    }

    window.clearTimeout(this._createTimer);
    // Підзадачі створюємо лише на commit: addSubTaskTo не вміє вимикати
    // short syntax, а проміжний текст не повинен ставати тегами/датами
    if (title && !this._parentId()) {
      this._createTimer = window.setTimeout(
        () => this._create(true),
        QUICK_ADD_CREATE_IDLE_MS,
      );
    }
  }

  /**
   * Завершити поточну чернетку. Повертає id задачі (потрібен для Alt+Enter)
   * або null, якщо текст порожній і чернетку прибрано.
   */
  commit(_trigger: QuickAddCommitTrigger): string | null {
    const title = this._title.trim();
    if (!title) {
      this.discard();
      return null;
    }
    this._clearTimers();

    let id = this._taskId();
    if (id) {
      // Фінальний Update без isIgnoreShortSyntax — short syntax парситься один раз
      this._taskService.update(id, { title }, false);
    } else {
      // Ще не створена (швидкий набір + Enter) — звичайне створення, 1 Create
      id = this._create(false);
    }
    this._resetToIdle();
    return id;
  }

  /** Esc або втрата фокусу на порожньому: прибрати чернетку. */
  discard(): void {
    this._clearTimers();
    const id = this._taskId();
    if (id) {
      // Задача вже в op-log — видаляємо одним Delete-опом
      this._taskService
        .getByIdWithSubTaskData$(id)
        .pipe(first())
        .subscribe((task) => {
          if (task) {
            this._taskService.remove(task);
          }
        });
    }
    this._resetToIdle();
  }

  /**
   * Негайно зберегти незбережений текст без парсингу short syntax.
   * Для visibilitychange (hidden), pagehide/beforeunload, зміни роуту
   * чи контексту — щоб не втратити набране при закритті вкладки.
   */
  flush(): void {
    this._clearUpdateTimer();
    const id = this._taskId();
    const title = this._title.trim();
    if (id && title && title !== this._lastSavedTitle) {
      this._taskService.update(id, { title }, true);
      this._lastSavedTitle = title;
    }
  }

  ngOnDestroy(): void {
    this._clearTimers();
  }

  private _create(isIgnoreShortSyntax: boolean): string {
    window.clearTimeout(this._createTimer);
    const title = this._title.trim();
    const parentId = this._parentId();
    const id = parentId
      ? this._taskService.addSubTaskTo(parentId, { title })
      : this._taskService.add(
          title,
          false,
          {},
          // у кінець списку — там, де стоїть рядок вводу
          true,
          isIgnoreShortSyntax,
        );
    this._taskId.set(id);
    this._lastSavedTitle = title;
    return id;
  }

  private _scheduleUpdate(): void {
    // Debounce з maxWait: при безперервному наборі зберігаємо хоча б раз на 4 с
    const now = Date.now();
    if (this._firstUnsavedAt === null) {
      this._firstUnsavedAt = now;
    }
    const waited = now - this._firstUnsavedAt;
    const delay = Math.max(
      0,
      Math.min(QUICK_ADD_UPDATE_IDLE_MS, QUICK_ADD_UPDATE_MAX_WAIT_MS - waited),
    );
    window.clearTimeout(this._updateTimer);
    this._updateTimer = window.setTimeout(() => this.flush(), delay);
  }

  /** Перед відкриттям нового рядка завершуємо попередній, щоб не загубити текст. */
  private _settleCurrent(): void {
    if (this._state() === 'editing' && this._title.trim()) {
      this.commit('blur');
    } else {
      this.discard();
    }
  }

  private _clearUpdateTimer(): void {
    window.clearTimeout(this._updateTimer);
    this._updateTimer = undefined;
    this._firstUnsavedAt = null;
  }

  private _clearTimers(): void {
    window.clearTimeout(this._createTimer);
    window.clearTimeout(this._armTimer);
    this._clearUpdateTimer();
  }

  private _resetToIdle(): void {
    this._clearTimers();
    this._title = '';
    this._lastSavedTitle = '';
    this._taskId.set(null);
    this._parentId.set(null);
    this._listKey.set(null);
    this._state.set('idle');
  }
}
