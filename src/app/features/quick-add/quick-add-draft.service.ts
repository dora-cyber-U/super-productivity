import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { SnackService } from '../../core/snack/snack.service';
import { TaskLog } from '../../core/log';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { T } from '../../t.const';
import { truncate } from '../../util/truncate';
import { TaskArchiveService } from '../archive/task-archive.service';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import { INBOX_PROJECT } from '../project/project.const';
import { selectTagFeatureState } from '../tag/store/tag.reducer';
import { TODAY_TAG } from '../tag/tag.const';
import { addSubTask } from '../tasks/store/task.actions';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { RecentlyDeletedStoreService } from '../tasks/recently-deleted/recently-deleted-store.service';
import { TaskService } from '../tasks/task.service';
import { WorkContextType } from '../work-context/work-context.model';
import { WorkContextService } from '../work-context/work-context.service';
import { QUICK_ADD_ARM_TIMEOUT_MS, QUICK_ADD_RESTORE_LOCK } from './quick-add.const';
import { QuickAddDraftStore } from './quick-add-draft-store.service';
import {
  QUICK_ADD_SURFACE_WORK_VIEW,
  QuickAddTarget,
  resolveQuickAddSurface,
} from './quick-add.model';

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
 * - id чернетки стає id задачі: якщо задача з цим id уже є (активна, в
 *   архіві чи в кошику), чернетка — лише застаріла копія, і повторно її не
 *   створюємо (жодних дублів чи «воскреслих» задач після аварії);
 * - чернетка стирається лише після того, як op-log записав створення задачі;
 * - задача створюється рівно один раз, на commit (Enter / blur з текстом /
 *   зникнення рядка) — 1× Create, short syntax (#тег, @дата, +проєкт)
 *   парситься один раз, жодних проміжних Update;
 * - задача створюється в контексті (проєкт/тег/батько), зафіксованому на
 *   початку чернетки, а не в тому, що відкритий у момент commit;
 * - Esc / порожньо — 0 операцій, чернетка просто стирається;
 * - незавершена чернетка з попереднього запуску відновлюється як задача
 *   (restorePendingDraft). F3: виклик іде після завантаження store задач
 *   (QuickAddRestoreEffects), тож чернетка стає задачею і тоді, коли
 *   рядок не змонтовано (Planner, проєкт із секціями). Повторний виклик
 *   з ngOnInit рядка безпечний: той самий Web Lock.
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
  private readonly _taskArchive = inject(TaskArchiveService);
  private readonly _recentlyDeleted = inject(RecentlyDeletedStoreService);

  private readonly _state = signal<QuickAddState>('idle');
  private readonly _listKey = signal<string | null>(null);
  private readonly _parentId = signal<string | null>(null);
  /** Поверхня набору; зараз завжди work-view. Старі записи без поля — теж. */
  private _surface = QUICK_ADD_SURFACE_WORK_VIEW;

  readonly state = this._state.asReadonly();
  /** Список, у якому відкрито рядок (напр. 'UNDONE'); за ним рядок знає, чи він активний. */
  readonly listKey = this._listKey.asReadonly();
  /** Батьківська задача, якщо рядок створює підзадачу. */
  readonly parentId = this._parentId.asReadonly();

  /**
   * Остання створена в цій сесії задача і її батько (якщо це підзадача).
   * Потрібні для Alt+Enter на порожньому рядку («підзадача до останньої»)
   * і щоб не дивитись у store, який у тестах не оновлюється сам.
   */
  private _lastTaskId: string | null = null;
  private _lastTaskParentId: string | null = null;

  private readonly _projectState = this._store.selectSignal(selectProjectFeatureState);
  private readonly _tagState = this._store.selectSignal(selectTagFeatureState);
  private readonly _taskEntities = this._store.selectSignal(selectTaskEntities);

  /** Списки, у яких зараз відрендерено рядок вводу (куди взагалі можна додавати). */
  private readonly _rowKeys = signal<ReadonlySet<string>>(new Set());
  /**
   * Верхньорівневі задачі в тому порядку, як їх видно над рядком
   * (відсортований / відфільтрований список). Після reload _lastTaskId
   * порожній — беремо останню звідси, а не з taskIds контексту.
   */
  private readonly _visibleTaskIds = new Map<string, readonly string[]>();

  private _title = '';
  private _target: QuickAddTarget | null = null;
  /** id поточної чернетки у сховищі (null — нічого не набирається). */
  private _draftId: string | null = null;
  private _armTimer: number | undefined;
  private _restoring: Promise<string | null> | null = null;
  /**
   * id задач, створених з чернеток у цій сесії. Якщо чернетка після commit
   * лишилась (flush op-log не вдався), а задачу вже видалили чи заархівували,
   * відновлення не поверне її.
   */
  private readonly _committedIds = new Set<string>();

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
    this._visibleTaskIds.delete(listKey);
  }

  /** Порядок задач, які зараз видно над рядком цього списку. */
  setVisibleTaskIds(listKey: string, ids: readonly string[]): void {
    if (ids.length === 0) {
      this._visibleTaskIds.delete(listKey);
      return;
    }
    const current = this._visibleTaskIds.get(listKey);
    if (
      current &&
      current.length === ids.length &&
      current.every((id, i) => id === ids[i])
    ) {
      return;
    }
    this._visibleTaskIds.set(listKey, [...ids]);
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
    // Розгортаємо лише якщо зараз згорнуто — інакше зайвий op «expand subtasks».
    if (parentId) {
      const parent = this._taskEntities()[parentId];
      if (parent?._hideSubTasksMode != null) {
        this._taskService.showSubTasks(parentId);
      }
    }
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
        surface: this._surface,
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
    // Останні символи, що ще чекають інтервалу, — одразу в IndexedDB: якщо
    // kill прийде раніше, ніж op-log запише задачу, відновиться повна назва
    void this._draftStore.flush();
    const id = this._createTask(title, target, draftId, this._surface);
    this._committedIds.add(draftId);
    this._lastTaskId = id;
    this._lastTaskParentId = this._resolveTarget(target).parentId;
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

  /** Чи цей рядок зараз є підзадачею вказаної задачі (для відступу під батьком). */
  isSubtaskRowFor(taskId: string): boolean {
    return this._state() !== 'idle' && this._parentId() === taskId;
  }

  /**
   * Alt/Ctrl/Cmd+Enter: зберегти поточний заголовок (якщо є) і відкрити
   * рядок підзадачі під цією (або останньою) задачею.
   *
   * Super Productivity нативно тримає лише 2 рівні (задача + підзадача).
   * addSubTask формально запише онука в store, але видалення, архів,
   * перенесення, підрахунок часу і селектори дивляться лише на один рівень
   * subTaskIds — онуки можуть осиротіти. Тому глибше не йдемо: якщо остання
   * задача вже підзадача, відкриваємо сусідній рядок того самого батька
   * і показуємо підказку. Зміну моделі даних / op-log / синхронізації
   * тут не робимо.
   */
  startSubtaskRow(listKey: string): void {
    const title = this._title.trim();
    if (title) {
      this.commit('subtask');
    }
    const candidateId = this._lastTaskId ?? this._lastTopLevelTaskId(listKey);
    if (!candidateId) {
      return;
    }
    const parentOfCandidate =
      this._lastTaskParentId ?? this._taskEntities()[candidateId]?.parentId ?? null;
    if (parentOfCandidate) {
      this._snackService.open({ msg: T.F.QUICK_ADD.DEPTH_LIMITED });
      this.open(listKey, parentOfCandidate);
      return;
    }
    this.open(listKey, candidateId);
  }

  /**
   * Порожній Esc / Shift+Tab на рядку підзадачі: піднятися на рівень вище.
   * Поки глибина лише 2, це завжди верхній рівень того самого списку.
   */
  goUpOneLevel(listKey: string): void {
    if (!this._parentId()) {
      return;
    }
    this.discard();
    this.open(listKey, null);
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
    if (!title) {
      await this._draftStore.clear(stored.id);
      return null;
    }
    // Задача вже створена (Enter встиг до аварії) — лише прибираємо чернетку,
    // і теж лише після запису в op-log: Enter міг бути щойно, мс тому
    if (await this._isKnownTask(stored.id)) {
      await this._clearWhenPersisted(stored.id);
      return null;
    }
    // Surface лише локально: не перезаписуємо this._surface поточної чернетки,
    // якщо відновлення застало вже відкритий рядок (гонка з набором).
    const surface = resolveQuickAddSurface(stored);
    const id = this._createTask(title, stored.target, stored.id, surface);
    // чекаємо: інша вкладка під тим самим lock'ом має побачити вже стерту чернетку
    await this._clearWhenPersisted(stored.id);
    this._snackService.open({
      msg: T.F.QUICK_ADD.RESTORED,
      translateParams: { title: truncate(title) },
    });
    return id;
  }

  /**
   * Чи задача з цим id уже існувала: активна, створена в цій сесії, в архіві
   * або в кошику «Нещодавно видалені». Лише читання. Якщо архів чи кошик не
   * читаються — вважаємо, що ні: краще можливий дубль, ніж втрачений текст.
   */
  private async _isKnownTask(id: string): Promise<boolean> {
    if (this._committedIds.has(id) || this._taskEntities()[id]) {
      return true;
    }
    try {
      if (await this._taskArchive.hasTask(id)) {
        return true;
      }
      const trash = await this._recentlyDeleted.getAll();
      return trash.some(
        (entry) => entry.id === id || entry.subTasks.some((sub) => sub.id === id),
      );
    } catch (e) {
      // Не знаємо, чи задача була: відновлюємо, але лишаємо слід у журналі
      // застосунку — якщо з'явиться дубль, його буде видно в діагностиці
      TaskLog.err(
        '[QuickAdd] Archive / trash check failed, restoring the draft anyway (possible duplicate)',
        { draftId: id },
        e,
      );
      return false;
    }
  }

  /** Початок нової чернетки: завершуємо попередню і фіксуємо контекст. */
  private _start(listKey: string, parentId: string | null): void {
    this._settleCurrent();
    this._listKey.set(listKey);
    this._parentId.set(parentId);
    // Поки рядок є лише в work-view; інші поверхні — окремим PR.
    this._surface = QUICK_ADD_SURFACE_WORK_VIEW;
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

  private _createTask(
    title: string,
    target: QuickAddTarget,
    id: string,
    // Локальний параметр, не спільне поле: відновлення не змінює чернетку в рядку.
    _surface: string = this._surface,
  ): string {
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
  /**
   * Остання верхньорівнева задача поточного списку. Після reload
   * _lastTaskId порожній, але Alt+Enter на порожньому рядку має
   * відкрити підзадачу під нею. Спочатку дивимось видимий порядок
   * над рядком, і лише якщо його немає — taskIds контексту.
   */
  private _lastTopLevelTaskId(listKey: string): string | null {
    const visible = this._visibleTaskIds.get(listKey);
    if (visible && visible.length > 0) {
      const entities = this._taskEntities();
      for (let i = visible.length - 1; i >= 0; i--) {
        const task = entities[visible[i]];
        if (task && !task.parentId && !task.isDone) {
          return task.id;
        }
      }
    }
    const ctxId = this._workContextService.activeWorkContextId;
    const ctxType = this._workContextService.activeWorkContextType;
    if (!ctxId || !ctxType) {
      return null;
    }
    const ids =
      ctxType === WorkContextType.PROJECT
        ? (this._projectState().entities[ctxId]?.taskIds ?? [])
        : (this._tagState().entities[ctxId]?.taskIds ?? []);
    const entities = this._taskEntities();
    for (let i = ids.length - 1; i >= 0; i--) {
      const task = entities[ids[i]];
      if (task && !task.parentId && !task.isDone) {
        return task.id;
      }
    }
    return null;
  }

  private _resolveTarget(target: QuickAddTarget): QuickAddTarget {
    const entities = this._taskEntities();
    const requested =
      target.parentId && entities[target.parentId] ? target.parentId : null;
    // Читаємо актуальний parentId на момент створення: якщо батько сам став
    // підзадачею (напр. через sync), не створюємо 3-й рівень.
    let parentId: string | null = null;
    if (requested) {
      const parent = entities[requested];
      if (parent?.parentId) {
        const grand = entities[parent.parentId];
        parentId = grand && !grand.parentId ? parent.parentId : null;
      } else {
        parentId = requested;
      }
    }
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
    this._surface = QUICK_ADD_SURFACE_WORK_VIEW;
    this._state.set('idle');
  }

  private _clearArmTimer(): void {
    window.clearTimeout(this._armTimer);
    this._armTimer = undefined;
  }
}
