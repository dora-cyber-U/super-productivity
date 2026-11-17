import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, deleteDB, openDB } from 'idb';
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
  /**
   * Один запит відкриття на всіх: після таймауту він лишається чекати далі,
   * і наступні звернення чекають той самий, а не відкривають нові з'єднання.
   */
  private _openPromise?: Promise<IDBPDatabase<UiPrefsDb>>;

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
    if (!this._openPromise) {
      this._openPromise = this._openOrRecreate().catch((e) => {
        this._openPromise = undefined;
        throw e;
      });
    }
    return withTimeout(this._openPromise, OPEN_TIMEOUT_MS);
  }

  /** База зіпсована (не та версія чи схема) — це лише кеш налаштувань, створюємо заново. */
  private async _openOrRecreate(): Promise<IDBPDatabase<UiPrefsDb>> {
    try {
      return await this._open();
    } catch (e) {
      const name = (e as DOMException | undefined)?.name;
      if (name !== 'VersionError' && name !== 'NotFoundError') {
        throw e;
      }
      TaskLog.warn('[UiPrefs] Recreating broken DB', e);
      await deleteDB(DB_NAME);
      return this._open();
    }
  }

  /**
   * Відкриття без фіксованої версії: підходить будь-яка наявна. Якщо в базі
   * немає store — піднімаємо версію на 1 і створюємо його.
   */
  private async _open(): Promise<IDBPDatabase<UiPrefsDb>> {
    const db = await this._openAt(undefined);
    if (db.objectStoreNames.contains(STORE_NAME)) {
      return db;
    }
    const version = db.version + 1;
    db.close();
    return this._openAt(version);
  }

  private _openAt(version: number | undefined): Promise<IDBPDatabase<UiPrefsDb>> {
    return openDB<UiPrefsDb>(DB_NAME, version, {
      upgrade: (db) => {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
      terminated: () => (this._openPromise = undefined),
      // Інша вкладка оновлює схему — звільняємо їй базу
      blocking: () => {
        const openPromise = this._openPromise;
        this._openPromise = undefined;
        void openPromise?.then((db) => db.close());
      },
    });
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
