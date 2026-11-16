import { DOCUMENT } from '@angular/common';
import { Injectable, OnDestroy, inject } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { TaskLog } from '../../core/log';
import { WorkContextType } from '../work-context/work-context.model';
import {
  QUICK_ADD_DRAFT_DB_NAME,
  QUICK_ADD_DRAFT_DB_OPEN_TIMEOUT_MS,
  QUICK_ADD_DRAFT_LS_KEY,
  QUICK_ADD_DRAFT_WRITE_INTERVAL_MS,
} from './quick-add.const';
import {
  QuickAddDraftTombstone,
  QuickAddTarget,
  StoredQuickAddDraft,
} from './quick-add.model';

const STORE_NAME = 'draft';
/** Чернетка одна на пристрій — один запис під сталим ключем. */
const DRAFT_KEY = 'current';

interface QuickAddDb extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: StoredQuickAddDraft | QuickAddDraftTombstone;
  };
}

/**
 * Сховище незавершеної чернетки quick-add, що переживає вимкнення світла.
 *
 * - IndexedDB (окрема база, див. QUICK_ADD_DRAFT_DB_NAME) — головне сховище:
 *   запис не частіше ніж раз на QUICK_ADD_DRAFT_WRITE_INTERVAL_MS з
 *   обов'язковим дописом останнього стану; durability 'strict', де браузер
 *   це підтримує (fsync — на випадок втрати живлення, а не лише kill);
 *   blur вікна, приховування вкладки і pagehide записують одразу;
 * - localStorage — синхронна копія на кожен символ: лише вона встигає при
 *   reload чи закритті вкладки, поки запис в IndexedDB чекає своєї черги;
 * - перший символ нової чернетки пишеться в IndexedDB одразу, без інтервалу;
 * - стирання пише в IndexedDB «надгробок» (id + ревізія), а не видаляє запис.
 *   Chromium скидає localStorage на диск із затримкою до хвилини, тож після
 *   kill там може лежати стара копія; новіший надгробок її перекриває, і
 *   збережена чи скасована чернетка не «воскресає».
 *
 * Читання бере новіший запис з двох сховищ — за монотонною ревізією (rev),
 * а не за системним часом; надгробок означає «чернетки немає». Якщо IndexedDB недоступна, працює лише localStorage — ввід
 * ніколи не ламається через сховище.
 */
@Injectable({ providedIn: 'root' })
export class QuickAddDraftStore implements OnDestroy {
  private readonly _document = inject(DOCUMENT);
  private readonly _window = this._document.defaultView;

  private _dbPromise?: Promise<IDBPDatabase<QuickAddDb>>;
  private _isIdbUnavailable = typeof indexedDB === 'undefined';
  /** Останній стан (чернетка або надгробок), ще не записаний в IndexedDB. */
  private _pending: DraftRecord | null = null;
  private _writeTimer: number | undefined;
  /** Операції з базою йдуть строго по черзі: запис, стирання, читання. */
  private _queue: Promise<unknown> = Promise.resolve();
  /** Остання видана або побачена ревізія — основа монотонного лічильника. */
  private _lastRev = 0;
  /** id чернетки, яку зберігали останньою: перший символ нової пишемо одразу. */
  private _lastSavedId: string | null = null;
  /**
   * Відкриття бази вже не вклалося в таймаут і досі чекає: наступні операції
   * не чекають ще раз, а одразу йдуть у localStorage (і лог — лише один раз).
   */
  private _isOpenStalled = false;
  /** Скільки чекати на відкриття бази (у тестах — менше). */
  private _openTimeoutMs = QUICK_ADD_DRAFT_DB_OPEN_TIMEOUT_MS;

  private readonly _flushNow = (): void => void this.flush();
  private readonly _onVisibilityChange = (): void => {
    if (this._document.visibilityState === 'hidden') {
      void this.flush();
    }
  };

  constructor() {
    // Alt+Tab, згортання, перемикання вкладки, закриття — пишемо, не чекаючи інтервалу
    this._window?.addEventListener('blur', this._flushNow);
    this._window?.addEventListener('pagehide', this._flushNow);
    this._document.addEventListener('visibilitychange', this._onVisibilityChange);
    // Ревізії продовжують ті, що вже лежать у сховищах, навіть якщо годинник
    // після перезапуску відстає; заодно база відкривається заздалегідь
    this._observeRev(readLs());
    void this._enqueue(async (db) => {
      const stored: unknown = await db.get(STORE_NAME, DRAFT_KEY);
      this._observeRev(isStoredDraft(stored) || isTombstone(stored) ? stored : null);
    });
  }

  /** Зберегти поточний стан чернетки: localStorage одразу, IndexedDB — з інтервалом. */
  save(draft: StoredQuickAddDraft): void {
    const record: StoredQuickAddDraft = { ...draft, rev: this._nextRev() };
    writeLs(record);
    this._pending = record;
    if (draft.id !== this._lastSavedId) {
      // Нова чернетка: не чекаємо інтервалу, щоб kill одразу після Enter
      // попереднього рядка не забрав її початок
      this._lastSavedId = draft.id;
      void this.flush();
      return;
    }
    if (this._writeTimer === undefined) {
      this._writeTimer = this._window?.setTimeout(
        this._flushNow,
        QUICK_ADD_DRAFT_WRITE_INTERVAL_MS,
      );
    }
  }

  /** Негайно записати в IndexedDB те, що ще чекає інтервалу. */
  async flush(): Promise<void> {
    this._clearWriteTimer();
    const record = this._pending;
    this._pending = null;
    if (!record) {
      await this._enqueue(async () => undefined);
      return;
    }
    const isWritten = await this._enqueue((db) => writeRecord(db, record));
    if (!isWritten && !this._pending) {
      // База ще не відкрилась (upgrade заблоковано) — запис не губимо,
      // повторимо пізніше, якщо за цей час не з'явилося нічого новішого
      this._pending = record;
      this._writeTimer ??= this._window?.setTimeout(this._flushNow, this._openTimeoutMs);
    }
  }

  /**
   * Стерти чернетку (надгробком в IndexedDB) — лише якщо в сховищі саме вона
   * або нічого новішого, щоб не зачепити чернетку, яку вже почали набирати.
   */
  clear(id: string): Promise<void> {
    if (this._pending?.id === id) {
      this._pending = null;
      this._clearWriteTimer();
    }
    if (readLs()?.id === id) {
      removeLs();
    }
    if (!this._pending || isTombstone(this._pending)) {
      this._pending = { v: 2, id, ts: Date.now(), rev: this._nextRev(), cleared: true };
    }
    // Інакше вже набирається інша чернетка: її запис під тим самим ключем і є
    // стиранням цієї — одна транзакція замість надгробка, що став би в черзі
    // перед нею
    return this.flush();
  }

  /** Чернетка з попереднього запуску або null (новіший запис з двох сховищ). */
  async read(): Promise<StoredQuickAddDraft | null> {
    const fromLs = readLs();
    let fromIdb: unknown = null;
    await this._enqueue(async (db) => {
      fromIdb = await db.get(STORE_NAME, DRAFT_KEY);
    });
    const idbRecord = isStoredDraft(fromIdb) || isTombstone(fromIdb) ? fromIdb : null;
    this._observeRev(fromLs);
    this._observeRev(idbRecord);
    // При рівній ревізії віримо IndexedDB: копія в localStorage могла застаріти
    const newest =
      fromLs && (!idbRecord || revOf(fromLs) > revOf(idbRecord)) ? fromLs : idbRecord;
    return newest && !('cleared' in newest) ? newest : null;
  }

  ngOnDestroy(): void {
    this._clearWriteTimer();
    this._window?.removeEventListener('blur', this._flushNow);
    this._window?.removeEventListener('pagehide', this._flushNow);
    this._document.removeEventListener('visibilitychange', this._onVisibilityChange);
  }

  /**
   * Поставити операцію в чергу; помилка бази не ламає ні чергу, ні ввід.
   * Повертає, чи операцію виконано (false — бази немає або вона ще не відкрилась).
   */
  private _enqueue(
    op: (db: IDBPDatabase<QuickAddDb>) => Promise<void>,
  ): Promise<boolean> {
    const run = this._queue.then(async () => {
      if (this._isIdbUnavailable) {
        return false;
      }
      let db: IDBPDatabase<QuickAddDb>;
      try {
        db = await this._dbWithin(this._openTimeoutMs);
      } catch (e) {
        if (e instanceof DraftDbOpenTimeout) {
          // Відкриття чекає (інше з'єднання не відпускає стару версію). Черга не
          // висить: поки що лише localStorage; щойно базу відпустять, відкладений
          // запис піде сам (див. _db)
          if (!this._isOpenStalled) {
            this._isOpenStalled = true;
            TaskLog.warn(
              '[QuickAdd] Draft database is blocked, using localStorage for now',
            );
          }
          return false;
        }
        // База не відкривається (приватний режим, пошкоджений профіль) — далі лише localStorage
        this._isIdbUnavailable = true;
        TaskLog.err('[QuickAdd] Draft database unavailable, using localStorage only', e);
        return false;
      }
      try {
        await op(db);
        return true;
      } catch (e) {
        TaskLog.err('[QuickAdd] Draft storage failed', e);
        return false;
      }
    });
    this._queue = run;
    return run;
  }

  /**
   * Гібридний годинник: не менше за Date.now() і завжди більше за попередню
   * ревізію — порядок записів не залежить від зсуву системного часу.
   */
  private _nextRev(): number {
    this._lastRev = Math.max(Date.now(), this._lastRev + 1);
    return this._lastRev;
  }

  private _observeRev(record: StoredQuickAddDraft | QuickAddDraftTombstone | null): void {
    if (record) {
      this._lastRev = Math.max(this._lastRev, revOf(record));
    }
  }

  /**
   * Відкрита база, але чекаємо не довше за timeoutMs. Саме відкриття не
   * скасовується: воно лишається в _dbPromise, і наступні операції
   * отримають базу, щойно стороннє з'єднання її відпустить.
   */
  private _dbWithin(timeoutMs: number): Promise<IDBPDatabase<QuickAddDb>> {
    if (this._isOpenStalled && this._dbPromise) {
      return Promise.reject(new DraftDbOpenTimeout());
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new DraftDbOpenTimeout()), timeoutMs);
      this._db().then(
        (db) => {
          clearTimeout(timer);
          resolve(db);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  private _db(): Promise<IDBPDatabase<QuickAddDb>> {
    if (!this._dbPromise) {
      this._dbPromise = this._openWithStore().then(
        (db) => {
          if (this._isOpenStalled) {
            // Базу нарешті відпустили — дописуємо те, що чекало
            this._isOpenStalled = false;
            void this.flush();
          }
          return db;
        },
        (e) => {
          this._dbPromise = undefined;
          this._isOpenStalled = false;
          throw e;
        },
      );
    }
    return this._dbPromise;
  }

  /**
   * Відкрити базу так, щоб сховище в ній точно було. Відкриваємо поточну
   * версію (нову базу створить upgrade разом зі сховищем). Якщо базу вже
   * хтось створив порожньою (напр. сторонній скрипт відкрив її без сховища),
   * upgrade сам не запуститься і запис мовчки не працював би — тоді
   * піднімаємо версію на одну, і upgrade створить сховище. Фіксованої версії
   * немає навмисно: так не буває VersionError після такого підняття.
   */
  private async _openWithStore(): Promise<IDBPDatabase<QuickAddDb>> {
    const db = await this._open();
    if (db.objectStoreNames.contains(STORE_NAME)) {
      return db;
    }
    const nextVersion = db.version + 1;
    db.close();
    return this._open(nextVersion);
  }

  private _open(version?: number): Promise<IDBPDatabase<QuickAddDb>> {
    return openDB<QuickAddDb>(QUICK_ADD_DRAFT_DB_NAME, version, {
      upgrade: (db) => {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
      // Інше з'єднання (стара вкладка, сторонній скрипт) не відпускає базу —
      // upgrade чекає; не висимо разом із ним (див. _dbWithin), лише фіксуємо
      blocked: (currentVersion, blockedVersion) => {
        TaskLog.warn('[QuickAdd] Draft database upgrade blocked by another connection', {
          currentVersion,
          blockedVersion,
        });
      },
      // Браузер закрив з'єднання — відкриємо знову при наступному зверненні
      terminated: () => {
        this._dbPromise = undefined;
      },
      // versionchange: інша вкладка піднімає версію — закриваємо своє з'єднання,
      // щоб не блокувати її; наступне звернення відкриє базу заново
      blocking: () => {
        const dbPromise = this._dbPromise;
        this._dbPromise = undefined;
        void dbPromise?.then((db) => db.close());
      },
    });
  }

  private _clearWriteTimer(): void {
    this._window?.clearTimeout(this._writeTimer);
    this._writeTimer = undefined;
  }
}

type DraftRecord = StoredQuickAddDraft | QuickAddDraftTombstone;

/** Відкриття бази не вклалося в таймаут (див. _dbWithin). */
class DraftDbOpenTimeout extends Error {
  constructor() {
    super('Quick-add draft database open timed out');
  }
}

/**
 * Записати чернетку або надгробок. Надгробок пишеться, лише якщо в сховищі
 * саме ця чернетка або нічого новішого — чужу, вже почату, не зачіпає.
 */
const writeRecord = async (
  db: IDBPDatabase<QuickAddDb>,
  record: DraftRecord,
): Promise<void> => {
  const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
  if (isTombstone(record)) {
    const current = await tx.store.get(DRAFT_KEY);
    if (!current || current.id === record.id || 'cleared' in current) {
      await tx.store.put(record, DRAFT_KEY);
    }
  } else {
    await tx.store.put(record, DRAFT_KEY);
  }
  await tx.done;
};

// localStorage може бути недоступним або переповненим — тоді просто без копії.
const writeLs = (draft: StoredQuickAddDraft): void => {
  try {
    localStorage.setItem(QUICK_ADD_DRAFT_LS_KEY, JSON.stringify(draft));
  } catch {
    // quota / private mode — ігноруємо
  }
};

const removeLs = (): void => {
  try {
    localStorage.removeItem(QUICK_ADD_DRAFT_LS_KEY);
  } catch {
    // недоступне сховище — нічого стирати
  }
};

const readLs = (): StoredQuickAddDraft | null => {
  try {
    const raw = localStorage.getItem(QUICK_ADD_DRAFT_LS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isStoredDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Порядок запису: ревізія, а для записів старіших збірок — час. */
const revOf = (record: StoredQuickAddDraft | QuickAddDraftTombstone): number =>
  record.rev ?? record.ts;

const isRevValid = (rev: unknown): boolean =>
  rev === undefined || (typeof rev === 'number' && Number.isFinite(rev));

const isTombstone = (value: unknown): value is QuickAddDraftTombstone => {
  const record = value as Partial<QuickAddDraftTombstone> | null;
  return (
    !!record &&
    record.v === 2 &&
    record.cleared === true &&
    typeof record.id === 'string' &&
    typeof record.ts === 'number' &&
    isRevValid(record.rev)
  );
};

/** Перевірка форми запису (його могли пошкодити або залишити старий формат). */
export const isStoredDraft = (value: unknown): value is StoredQuickAddDraft => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const draft = value as Partial<StoredQuickAddDraft>;
  const target = draft.target as Partial<QuickAddTarget> | undefined;
  return (
    draft.v === 2 &&
    typeof draft.id === 'string' &&
    typeof draft.ts === 'number' &&
    isRevValid(draft.rev) &&
    typeof draft.title === 'string' &&
    !!target &&
    typeof target.workContextId === 'string' &&
    (target.workContextType === WorkContextType.PROJECT ||
      target.workContextType === WorkContextType.TAG) &&
    (target.parentId === null || typeof target.parentId === 'string')
  );
};
