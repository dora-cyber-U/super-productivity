import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { SnackService } from '../../core/snack/snack.service';
import { TaskLog } from '../../core/log';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
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
import { QUICK_ADD_ARM_TIMEOUT_MS, QUICK_ADD_RESTORE_LOCK } from './quick-add.const';
import { QuickAddDraftStore } from './quick-add-draft-store.service';
import { QuickAddTarget } from './quick-add.model';

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
 * Модель «чернетка локально, задача — один раз»:
 * - кожен символ зберігається в QuickAddDraftStore (окрема IndexedDB) —
 *   0 операцій op-log, але текст переживає вимкнення світла чи kill процесу;
 * - id чернетки стає id задачі: якщо задача з цим id уже є, чернетка — лише
 *   застаріла копія, і повторно її не створюємо (жодних дублів після аварії);
 * - чернетка стирається лише після того, як op-log записав створення задачі;
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
  private readonly _draftStore = inject(QuickAddDraftStore);
  private readonly _opLogFlush = inject(OperationWriteFlushService);

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

  /** Списки, у яких зараз відрендерено рядок вводу (куди взагалі можна додавати). */
  private readonly _rowKeys = signal<ReadonlySet<string>>(new Set());

  private _title = '';
  private _target: QuickAddTarget | null = null;
  /** id поточної чернетки у сховищі (null — нічого не набирається). */
  private _draftId: string | null = null;
  private _armTimer: number | undefined;
  private _restoring: Promise<string | null> | null = null;

  /** Рядок вводу повідомляє, що він є в DOM для цього списку. */
  registerRow(listKey: string): void {
    this._rowKeys.update((keys) => new Set(keys).add(listKey));
  }

  unregisterRow(listKey: string): void {
    this._rowKeys.update((keys) => {
      const next = new Set(keys);
      next.delete(listKey);
      return next;
    });
  }

  /** Чи можна відкрити рядок у цьому списку (напр. у режимі секцій його ще нема). */
  hasRow(listKey: string): boolean {
    return this._rowKeys().has(listKey);
  }

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
    if (!this._draftId) {
      this._draftId = nanoid();
    }
    if (raw.trim()) {
      this._draftStore.save({
        v: 2,
        id: this._draftId,
        ts: Date.now(),
        title: raw,
        target: this._target,
      });
    } else {
      void this._draftStore.clear(this._draftId);
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
    const draftId = this._draftId ?? nanoid();
    const id = this._createTask(title, target, draftId);
    // Чернетку не стираємо разом зі станом — лише після запису задачі в op-log
    this._draftId = null;
    this._resetToIdle();
    void this._clearWhenPersisted(draftId);
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
   * відкриє той самий список. Викликати після завантаження даних.
   *
   * Асинхронно (читає IndexedDB) та ідемпотентно: задача отримує id
   * чернетки, тож якщо вона вже існує (аварія між створенням і стиранням
   * чернетки), чернетку просто прибираємо. Стирається вона лише після запису
   * задачі в op-log — аварія між ними дасть повторну перевірку, а не втрату.
   *
   * Між вкладками — під Web Lock: після аварії Chromium відновлює попередню
   * вкладку поруч із новою, і обидві встигають стартувати раніше, ніж
   * спрацює блокування другої вкладки. Друга чекає, доки перша створить
   * задачу і зітре чернетку, і вже нічого не знаходить.
   */
  restorePendingDraft(): Promise<string | null> {
    if (!this._restoring) {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      const run = locks
        ? locks.request(QUICK_ADD_RESTORE_LOCK, () => this._restore())
        : this._restore();
      this._restoring = run.finally(() => {
        this._restoring = null;
      });
    }
    return this._restoring;
  }

  ngOnDestroy(): void {
    this._clearArmTimer();
  }

  private async _restore(): Promise<string | null> {
    const stored = await this._draftStore.read();
    // Те, що зараз набирається, — не «залишок» попереднього запуску
    if (!stored || stored.id === this._draftId) {
      return null;
    }
    const title = stored.title.trim();
    // Задача вже створена (Enter встиг до аварії) або текст порожній — лише прибираємо
    if (!title || this._taskEntities()[stored.id]) {
      await this._draftStore.clear(stored.id);
      return null;
    }
    const id = this._createTask(title, stored.target, stored.id);
    // чекаємо: інша вкладка під тим самим lock'ом має побачити вже стерту чернетку
    await this._clearWhenPersisted(stored.id);
    this._snackService.open({
      msg: T.F.QUICK_ADD.RESTORED,
      translateParams: { title: truncate(title) },
    });
    return id;
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

  private _createTask(title: string, target: QuickAddTarget, id: string): string {
    const { workContextId, workContextType, parentId } = this._resolveTarget(target);
    // id задачі = id чернетки: повторне відновлення тієї самої чернетки впізнається
    const task = this._taskService.createNewTaskWithDefaults({
      title,
      id,
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

  /**
   * Стерти чернетку, коли op-log підтвердив запис створення задачі. Якщо
   * дочекатися не вдалося — лишаємо чернетку: при наступному запуску вона
   * впізнається за id задачі, а не створить дубль.
   */
  private async _clearWhenPersisted(draftId: string): Promise<void> {
    try {
      await this._opLogFlush.flushPendingWrites();
    } catch (e) {
      TaskLog.err('[QuickAdd] Op-log flush failed, keeping the draft', e);
      return;
    }
    await this._draftStore.clear(draftId);
  }

  private _resetToIdle(): void {
    this._clearArmTimer();
    if (this._draftId) {
      void this._draftStore.clear(this._draftId);
      this._draftId = null;
    }
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
}
