import { TestBed } from '@angular/core/testing';
import { deleteDB, openDB } from 'idb';
import { UiPrefDurableStore } from './ui-pref-durable-store';

const DB_NAME = 'SUP_UI_PREFS';

describe('UiPrefDurableStore', () => {
  const create = (): UiPrefDurableStore => {
    TestBed.resetTestingModule();
    return TestBed.inject(UiPrefDurableStore);
  };
  /** Підготувати «чужу» базу (інша версія / схема) і закрити з'єднання. */
  const seed = async (version: number, stores: string[]): Promise<void> => {
    const db = await openDB(DB_NAME, version, {
      upgrade: (d) => stores.forEach((s) => d.createObjectStore(s)),
    });
    db.close();
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await deleteDB(DB_NAME);
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await deleteDB(DB_NAME);
  });

  it('stores and reads a value in a fresh DB', async () => {
    const store = create();
    await store.set('k', 'v');

    expect(await create().get('k')).toBe('v');
  });

  it('L2: works with a DB that has no kv store (bumps the version)', async () => {
    await seed(1, ['other']);
    const store = create();

    await store.set('k', 'v');

    expect(await store.get('k')).toBe('v');
  });

  it('L2: works with a DB at a higher version', async () => {
    await seed(7, ['kv']);
    const store = create();

    await store.set('k', 'v');

    expect(await create().get('k')).toBe('v');
  });

  it('reuses one pending open request', async () => {
    const openSpy = spyOn(indexedDB, 'open').and.callThrough();
    const store = create();

    await Promise.all([store.get('a'), store.set('b', '1'), store.get('b')]);
    await store.get('c');

    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('never throws; failures are only logged', async () => {
    spyOn(indexedDB, 'open').and.throwError('SecurityError');
    const store = create();

    await expectAsync(store.set('k', 'v')).toBeResolved();
    expect(await store.get('k')).toBeUndefined();
  });
});
