import { DOCUMENT } from '@angular/common';
import { Injectable, OnDestroy, inject } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { TaskLog } from '../../core/log';
import { WorkContextType } from '../work-context/work-context.model';
import {
  QUICK_ADD_DRAFT_DB_NAME,
  QUICK_ADD_DRAFT_LS_KEY,
  QUICK_ADD_DRAFT_WRITE_INTERVAL_MS,
} from './quick-add.const';
import { QuickAddTarget, StoredQuickAddDraft } from './quick-add.model';

const DB_VERSION = 1;
const STORE_NAME = 'draft';
/** Чернетка одна на пристрій — один запис під сталим ключем. */
const DRAFT_KEY = 'current';

interface QuickAddDb extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: StoredQuickAddDraft;
  };
}

/**
 * Сховище незавершеної чернетки quick-add, що переживає вимкнення світла.
 *
 * - IndexedDB (окрема база, див. QUICK_ADD_DRAFT_DB_NAME) — основне сховище:
 *   запис не частіше ніж раз на QUICK_ADD_DRAFT_WRITE_INTERVAL_MS з
 *   обов'язковим дописом останнього стану; durability 'strict', де браузер
 *   це підтримує (fsync — на випадок втрати живлення, а не лише kill);
 * - localStorage — синхронна копія на кожен символ для reload/закриття
 *   вкладки, поки запис в IndexedDB ще чекає своєї черги;
 * - blur вікна, приховування вкладки і pagehide записують одразу.
 *
 * Читання бере новіший запис з двох сховищ. Якщо IndexedDB недоступна
 * (приватний режим, пошкоджений профіль), працює лише localStorage —
 * ввід ніколи не ламається через сховище.
 */
@Injectable({ providedIn: 'root' })
export class QuickAddDraftStore implements OnDestroy {
  private readonly _document = inject(DOCUMENT);
  private readonly _window = this._document.defaultView;

  private _dbPromise?: Promise<IDBPDatabase<QuickAddDb>>;
  private _isIdbUnavailable = typeof indexedDB === 'undefined';
  /** Останній стан, ще не записаний в IndexedDB. */
  private _pending: StoredQuickAddDraft | null = null;
  private _writeTimer: number | undefined;
  /** Операції з базою йдуть строго по черзі: запис, стирання, читання. */
  private _queue: Promise<unknown> = Promise.resolve();

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
  }

  /** Зберегти поточний стан чернетки. Синхронна частина — localStorage. */
  save(draft: StoredQuickAddDraft): void {
    writeLs(draft);
    this._pending = draft;
    if (this._writeTimer === undefined) {
      this._writeTimer = this._window?.setTimeout(
        this._flushNow,
        QUICK_ADD_DRAFT_WRITE_INTERVAL_MS,
      );
    }
  }

  /** Негайно записати в IndexedDB те, що ще чекає інтервалу. */
  flush(): Promise<void> {
    this._clearWriteTimer();
    const draft = this._pending;
    this._pending = null;
    if (!draft) {
      return this._enqueue(async () => undefined);
    }
    return this._enqueue(async (db) => {
      const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
      await Promise.all([tx.store.put(draft, DRAFT_KEY), tx.done]);
    });
  }

  /**
   * Стерти чернетку з обох сховищ — лише якщо там саме вона (за id), щоб
   * не зачепити новішу, яку вже почали набирати.
   */
  clear(id: string): Promise<void> {
    if (this._pending?.id === id) {
      this._pending = null;
      this._clearWriteTimer();
    }
    if (readLs()?.id === id) {
      removeLs();
    }
    return this._enqueue(async (db) => {
      const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
      const current = await tx.store.get(DRAFT_KEY);
      if (current?.id === id) {
        await tx.store.delete(DRAFT_KEY);
      }
      await tx.done;
    });
  }

  /** Чернетка з попереднього запуску (новіша з двох сховищ) або null. */
  async read(): Promise<StoredQuickAddDraft | null> {
    const fromLs = readLs();
    let fromIdb: unknown = null;
    await this._enqueue(async (db) => {
      fromIdb = await db.get(STORE_NAME, DRAFT_KEY);
    });
    const candidates = [fromLs, isStoredDraft(fromIdb) ? fromIdb : null].filter(
      (d): d is StoredQuickAddDraft => !!d,
    );
    return candidates.reduce<StoredQuickAddDraft | null>(
      (newest, d) => (!newest || d.ts > newest.ts ? d : newest),
      null,
    );
  }

  ngOnDestroy(): void {
    this._clearWriteTimer();
    this._window?.removeEventListener('blur', this._flushNow);
    this._window?.removeEventListener('pagehide', this._flushNow);
    this._document.removeEventListener('visibilitychange', this._onVisibilityChange);
  }

  /** Поставити операцію в чергу; помилка бази не ламає ні чергу, ні ввід. */
  private _enqueue(op: (db: IDBPDatabase<QuickAddDb>) => Promise<void>): Promise<void> {
    const run = this._queue.then(async () => {
      if (this._isIdbUnavailable) {
        return;
      }
      let db: IDBPDatabase<QuickAddDb>;
      try {
        db = await this._db();
      } catch (e) {
        // База не відкривається (приватний режим, пошкоджений профіль) — далі лише localStorage
        this._isIdbUnavailable = true;
        TaskLog.err('[QuickAdd] Draft database unavailable, using localStorage only', e);
        return;
      }
      try {
        await op(db);
      } catch (e) {
        TaskLog.err('[QuickAdd] Draft storage failed', e);
      }
    });
    this._queue = run;
    return run;
  }

  private _db(): Promise<IDBPDatabase<QuickAddDb>> {
    if (!this._dbPromise) {
      this._dbPromise = openDB<QuickAddDb>(QUICK_ADD_DRAFT_DB_NAME, DB_VERSION, {
        upgrade: (db) => {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        },
        // Браузер закрив з'єднання — відкриємо знову при наступному зверненні
        terminated: () => {
          this._dbPromise = undefined;
        },
        blocking: () => {
          const dbPromise = this._dbPromise;
          this._dbPromise = undefined;
          void dbPromise?.then((db) => db.close());
        },
      }).catch((e) => {
        this._dbPromise = undefined;
        throw e;
      });
    }
    return this._dbPromise;
  }

  private _clearWriteTimer(): void {
    this._window?.clearTimeout(this._writeTimer);
    this._writeTimer = undefined;
  }
}

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
    typeof draft.title === 'string' &&
    !!target &&
    typeof target.workContextId === 'string' &&
    (target.workContextType === WorkContextType.PROJECT ||
      target.workContextType === WorkContextType.TAG) &&
    (target.parentId === null || typeof target.parentId === 'string')
  );
};
