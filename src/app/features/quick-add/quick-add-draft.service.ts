import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { truncate } from '../../util/truncate';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import { INBOX_PROJECT } from '../project/project.const';
import { selectTagFeatureState } from '../tag/store/tag.reducer';
import { TODAY_TAG } from '../tag/tag.const';
import { addSubTask } from '../tasks/store/task.actions';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { TaskService } from '../tasks/task.service';
import { WorkContextType } from '../work-context/work-context.model';
import { WorkContextService } from '../work-context/work-context.service';
import { QUICK_ADD_ARM_TIMEOUT_MS, QUICK_ADD_DRAFT_LS_KEY } from './quick-add.const';

/**
 * idle    — нічого не відбувається;
 * armed   — один клік по порожньому місцю, чекаємо на перший символ;
 * editing — рядок вводу видно, триває набір.
 */
export type QuickAddState = 'idle' | 'armed' | 'editing';

/** Що завершило редагування: Enter, Alt/Ctrl+Enter (підзадача) чи втрата фокусу. */
export type QuickAddCommitTrigger = 'enter' | 'subtask' | 'blur';

/** Куди створювати задачу. Фіксується в момент початку чернетки. */
export interface QuickAddTarget {
  workContextId: string;
  workContextType: WorkContextType;
  parentId: string | null;
}

interface StoredQuickAddDraft {
  v: 1;
  title: string;
  target: QuickAddTarget;
}

/**
 * Стан inline-рядка швидкого додавання задачі.
 *
 * Модель «чернетка локально, задача — один раз»:
 * - кожен символ синхронно пишеться в localStorage — 0 операцій op-log,
 *   але текст переживає вимкнення світла чи аварійне закриття;
 * - задача створюється рівно один раз, на commit (Enter / blur з текстом /
 *   зникнення рядка) — 1× Create, short syntax (#тег, @дата, +проєкт)
 *   парситься один раз, жодних проміжних Update;
 * - задача створюється в контексті (проєкт/тег/батько), зафіксованому на
 *   початку чернетки, а не в тому, що відкритий у момент commit;
 * - Esc / порожньо — 0 операцій, чернетка просто стирається;
 * - незавершена чернетка з попереднього запуску відновлюється як задача
 *   (restorePendingDraft).
 *
 * Нових actions немає: диспатчимо існуючі addTask / addSubTask, як TaskService.
 */
@Injectable({ providedIn: 'root' })
export class QuickAddDraftService implements OnDestroy {
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _snackService = inject(SnackService);

  private readonly _state = signal<QuickAddState>('idle');
  private readonly _listKey = signal<string | null>(null);
  private readonly _parentId = signal<string | null>(null);

  readonly state = this._state.asReadonly();
  /** Список, у якому відкрито рядок (напр. 'UNDONE'); за ним рядок знає, чи він активний. */
  readonly listKey = this._listKey.asReadonly();
  /** Батьківська задача, якщо рядок створює підзадачу. */
  readonly parentId = this._parentId.asReadonly();

  private readonly _projectState = this._store.selectSignal(selectProjectFeatureState);
  private readonly _tagState = this._store.selectSignal(selectTagFeatureState);
  private readonly _taskEntities = this._store.selectSignal(selectTaskEntities);

  private _title = '';
  private _target: QuickAddTarget | null = null;
  private _armTimer: number | undefined;

  /** Один клік: чекаємо, поки користувач почне друкувати. */
  arm(listKey: string): void {
    this._start(listKey, null);
    this._state.set('armed');
    this._armTimer = window.setTimeout(() => this.disarm(), QUICK_ADD_ARM_TIMEOUT_MS);
  }

  /** Скасувати «озброєний» стан (Esc, клік деінде, таймаут). */
  disarm(): void {
    if (this._state() === 'armed') {
      this._resetToIdle();
    }
  }

  /** Подвійний клік або Enter/Alt+Enter: одразу показати порожній рядок. */
  open(listKey: string, parentId: string | null = null): void {
    this._start(listKey, parentId);
    this._state.set('editing');
  }

  /** Викликається на кожну зміну тексту в рядку. Операцій op-log не створює. */
  setTitle(raw: string): void {
    if (this._state() === 'idle' || !this._target) {
      return;
    }
    if (this._state() === 'armed') {
      this._clearArmTimer();
      this._state.set('editing');
    }
    this._title = raw;
    if (raw.trim()) {
      this._persist({ v: 1, title: raw, target: this._target });
    } else {
      this._clearPersisted();
    }
  }

  /**
   * Завершити чернетку: створити задачу (1× Create). Повертає її id
   * (потрібен для Alt+Enter) або null, якщо текст порожній.
   */
  commit(_trigger: QuickAddCommitTrigger): string | null {
    const title = this._title.trim();
    const target = this._target;
    if (!title || !target) {
      this.discard();
      return null;
    }
    const id = this._createTask(title, target);
    this._resetToIdle();
    return id;
  }

  /** Esc або втрата фокусу на порожньому: прибрати чернетку (0 операцій). */
  discard(): void {
    this._resetToIdle();
  }

  /**
   * Якщо попередній запуск завершився з незбереженою чернеткою (світло,
   * аварія), створюємо з неї задачу в зафіксованому тоді контексті.
   * Задача видима й синхронізується — надійніше, ніж чекати, поки користувач
   * відкриє той самий список. Запис стирається ДО створення, щоб повторний
   * виклик не створив дубль. Викликати після завантаження даних.
   */
  restorePendingDraft(): string | null {
    if (this._state() !== 'idle') {
      return null;
    }
    const stored = this._readPersisted();
    this._clearPersisted();
    const title = stored?.title.trim();
    if (!stored || !title) {
      return null;
    }
    const id = this._createTask(title, stored.target);
    this._snackService.open({
      msg: T.F.QUICK_ADD.RESTORED,
      translateParams: { title: truncate(title) },
    });
    return id;
  }

  ngOnDestroy(): void {
    this._clearArmTimer();
  }

  /** Початок нової чернетки: завершуємо попередню і фіксуємо контекст. */
  private _start(listKey: string, parentId: string | null): void {
    this._settleCurrent();
    this._listKey.set(listKey);
    this._parentId.set(parentId);
    // Поза робочим контекстом (напр. налаштування) — у «Вхідні»
    const activeId = this._workContextService.activeWorkContextId;
    const activeType = this._workContextService.activeWorkContextType;
    this._target =
      activeId && activeType
        ? { workContextId: activeId, workContextType: activeType, parentId }
        : {
            workContextId: INBOX_PROJECT.id,
            workContextType: WorkContextType.PROJECT,
            parentId,
          };
  }

  /** Перед відкриттям нового рядка завершуємо попередній, щоб не загубити текст. */
  private _settleCurrent(): void {
    if (this._state() === 'editing' && this._title.trim()) {
      this.commit('blur');
    } else {
      this.discard();
    }
  }

  private _createTask(title: string, target: QuickAddTarget): string {
    const { workContextId, workContextType, parentId } = this._resolveTarget(target);
    const task = this._taskService.createNewTaskWithDefaults({
      title,
      workContextId,
      workContextType,
    });
    if (parentId) {
      this._store.dispatch(addSubTask({ task, parentId }));
    } else {
      this._store.dispatch(
        TaskSharedActions.addTask({
          task,
          workContextId,
          workContextType,
          isAddToBacklog: false,
          // у кінець списку — там, де стоїть рядок вводу
          isAddToBottom: true,
        }),
      );
    }
    return task.id;
  }

  /**
   * Контекст міг зникнути, поки чернетка чекала (видалили проєкт/тег/батька,
   * особливо між запусками) — тоді створюємо у «Вхідних» / на верхньому рівні.
   */
  private _resolveTarget(target: QuickAddTarget): QuickAddTarget {
    const parentId =
      target.parentId && this._taskEntities()[target.parentId] ? target.parentId : null;
    const isContextAlive =
      target.workContextType === WorkContextType.PROJECT
        ? !!this._projectState().entities[target.workContextId]
        : target.workContextId === TODAY_TAG.id ||
          !!this._tagState().entities[target.workContextId];
    return isContextAlive
      ? { ...target, parentId }
      : {
          workContextId: INBOX_PROJECT.id,
          workContextType: WorkContextType.PROJECT,
          parentId,
        };
  }

  private _resetToIdle(): void {
    this._clearArmTimer();
    this._clearPersisted();
    this._title = '';
    this._target = null;
    this._parentId.set(null);
    this._listKey.set(null);
    this._state.set('idle');
  }

  private _clearArmTimer(): void {
    window.clearTimeout(this._armTimer);
    this._armTimer = undefined;
  }

  // localStorage може бути недоступним або переповненим — тоді працюємо
  // як раніше, лише без захисту від втрати (і не ламаємо ввід).
  private _persist(draft: StoredQuickAddDraft): void {
    try {
      localStorage.setItem(QUICK_ADD_DRAFT_LS_KEY, JSON.stringify(draft));
    } catch {
      // quota / private mode — ігноруємо
    }
  }

  private _clearPersisted(): void {
    try {
      localStorage.removeItem(QUICK_ADD_DRAFT_LS_KEY);
    } catch {
      // недоступне сховище — нічого стирати
    }
  }

  private _readPersisted(): StoredQuickAddDraft | null {
    try {
      const raw = localStorage.getItem(QUICK_ADD_DRAFT_LS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return isStoredDraft(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

/** Перевірка форми запису з localStorage (його могли пошкодити або змінити вручну). */
const isStoredDraft = (value: unknown): value is StoredQuickAddDraft => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const draft = value as Partial<StoredQuickAddDraft>;
  const target = draft.target as Partial<QuickAddTarget> | undefined;
  return (
    draft.v === 1 &&
    typeof draft.title === 'string' &&
    !!target &&
    typeof target.workContextId === 'string' &&
    (target.workContextType === WorkContextType.PROJECT ||
      target.workContextType === WorkContextType.TAG) &&
    (target.parentId === null || typeof target.parentId === 'string')
  );
};
