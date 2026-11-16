import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { TaskLog } from '../../core/log';

const DB_NAME = 'SUP_UI_PREFS';
const STORE_NAME = 'kv';
/** Довше на відкриття бази не чекаємо — налаштування інтерфейсу того не варте. */
const OPEN_TIMEOUT_MS = 2000;

interface UiPrefsDb extends DBSchema {
  [STORE_NAME]: { key: string; value: string };
}

/**
 * Крихітне durable-сховище налаштувань інтерфейсу (ключ → рядок).
 *
 * localStorage лишається синхронним джерелом для першого кадру, але Chromium
 * пише його на диск із затримкою до хвилини, і після kill свіжа зміна
 * губиться. Запис IndexedDB зі strict durability переживає kill. Окрема база
 * (не SUP_OPS): локально для пристрою, без op-log і синхронізації.
 * Будь-яка помилка тут лише логується — інтерфейс від неї не ламається.
 */
@Injectable({ providedIn: 'root' })
export class UiPrefDurableStore {
  private _dbPromise?: Promise<IDBPDatabase<UiPrefsDb>>;

  async get(key: string): Promise<string | undefined> {
    try {
      return await (await this._db()).get(STORE_NAME, key);
    } catch (e) {
      TaskLog.warn('[UiPrefs] Read failed', e);
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const tx = (await this._db()).transaction(STORE_NAME, 'readwrite', {
        durability: 'strict',
      });
      await Promise.all([tx.store.put(value, key), tx.done]);
    } catch (e) {
      TaskLog.warn('[UiPrefs] Write failed', e);
    }
  }

  private _db(): Promise<IDBPDatabase<UiPrefsDb>> {
    if (!this._dbPromise) {
      const open = openDB<UiPrefsDb>(DB_NAME, 1, {
        upgrade: (db) => {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        },
        terminated: () => (this._dbPromise = undefined),
        blocking: () => {
          const dbPromise = this._dbPromise;
          this._dbPromise = undefined;
          void dbPromise?.then((db) => db.close());
        },
      });
      this._dbPromise = withTimeout(open, OPEN_TIMEOUT_MS).catch((e) => {
        this._dbPromise = undefined;
        throw e;
      });
    }
    return this._dbPromise;
  }
}

const withTimeout = <V>(promise: Promise<V>, ms: number): Promise<V> =>
  new Promise<V>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('UI prefs DB open timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
