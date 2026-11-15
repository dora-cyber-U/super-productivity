import { TestBed } from '@angular/core/testing';
import { deleteDB, openDB } from 'idb';
import { WorkContextType } from '../work-context/work-context.model';
import {
  QUICK_ADD_DRAFT_DB_NAME,
  QUICK_ADD_DRAFT_LS_KEY,
  QUICK_ADD_DRAFT_WRITE_INTERVAL_MS,
} from './quick-add.const';
import { QuickAddDraftStore } from './quick-add-draft-store.service';
import { StoredQuickAddDraft } from './quick-add.model';

describe('QuickAddDraftStore', () => {
  let store: QuickAddDraftStore;

  const draft = (title: string, id = 'd1', ts = Date.now()): StoredQuickAddDraft => ({
    v: 2,
    id,
    ts,
    title,
    target: {
      workContextId: 'projectA',
      workContextType: WorkContextType.PROJECT,
      parentId: null,
    },
  });

  /** Що лежить саме в IndexedDB (поза сервісом). */
  const idbDraft = async (): Promise<StoredQuickAddDraft | undefined> => {
    const db = await openDB(QUICK_ADD_DRAFT_DB_NAME);
    try {
      return db.objectStoreNames.contains('draft')
        ? await db.get('draft', 'current')
        : undefined;
    } finally {
      db.close();
    }
  };

  const lsDraft = (): StoredQuickAddDraft | null => {
    const raw = localStorage.getItem(QUICK_ADD_DRAFT_LS_KEY);
    return raw ? JSON.parse(raw) : null;
  };

  /** Дочекатися всіх поставлених у чергу операцій (стирання чужого id нічого не робить). */
  const settle = (): Promise<void> => store.clear('nobody');

  beforeEach(async () => {
    localStorage.removeItem(QUICK_ADD_DRAFT_LS_KEY);
    await deleteDB(QUICK_ADD_DRAFT_DB_NAME);
    store = TestBed.inject(QuickAddDraftStore);
  });

  afterEach(async () => {
    store.ngOnDestroy();
    localStorage.removeItem(QUICK_ADD_DRAFT_LS_KEY);
    // відкрите з'єднання сервісу закриється через blocking-обробник
    await deleteDB(QUICK_ADD_DRAFT_DB_NAME);
  });

  it('writes localStorage synchronously and IndexedDB on flush', async () => {
    store.save(draft('Купити фарбу'));
    expect(lsDraft()?.title).toBe('Купити фарбу');

    await store.flush();

    expect((await idbDraft())?.title).toBe('Купити фарбу');
  });

  it('throttles IndexedDB writes and always writes the latest state', async () => {
    jasmine.clock().install();
    try {
      store.save(draft('К'));
      store.save(draft('Ку'));
      store.save(draft('Куп'));
      jasmine.clock().tick(QUICK_ADD_DRAFT_WRITE_INTERVAL_MS - 1);
      await settle();
      expect(await idbDraft()).toBeUndefined();

      jasmine.clock().tick(1);
      await settle();
      expect((await idbDraft())?.title).toBe('Куп');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  for (const [name, fire] of [
    ['window blur (Alt+Tab)', () => window.dispatchEvent(new Event('blur'))],
    ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
  ] as const) {
    it(`writes immediately on ${name}`, async () => {
      store.save(draft('Не чекати'));

      fire();
      await settle();

      expect((await idbDraft())?.title).toBe('Не чекати');
    });
  }

  it('writes immediately when the page becomes hidden', async () => {
    spyOnProperty(document, 'visibilityState').and.returnValue('hidden');
    store.save(draft('Згорнули вікно'));

    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect((await idbDraft())?.title).toBe('Згорнули вікно');
  });

  it('clear removes the draft from both stores only when the id matches', async () => {
    store.save(draft('Mine', 'mine'));
    await store.flush();

    await store.clear('someone-else');
    expect(lsDraft()?.id).toBe('mine');
    expect((await idbDraft())?.id).toBe('mine');

    await store.clear('mine');
    expect(lsDraft()).toBeNull();
    expect(await idbDraft()).toBeUndefined();
  });

  it('clear cancels a pending write of the same draft', async () => {
    store.save(draft('Gone', 'gone'));

    await store.clear('gone');
    await store.flush();

    expect(await idbDraft()).toBeUndefined();
  });

  it('read picks the newer of IndexedDB and localStorage', async () => {
    store.save(draft('Older in IDB', 'a', 100));
    await store.flush();
    localStorage.setItem(
      QUICK_ADD_DRAFT_LS_KEY,
      JSON.stringify(draft('Newer in LS', 'b', 200)),
    );
    expect((await store.read())?.title).toBe('Newer in LS');

    // localStorage загубив останні зміни (kill до запису на диск) — береться IndexedDB
    localStorage.setItem(
      QUICK_ADD_DRAFT_LS_KEY,
      JSON.stringify(draft('Stale LS', 'a', 50)),
    );
    expect((await store.read())?.title).toBe('Older in IDB');

    localStorage.removeItem(QUICK_ADD_DRAFT_LS_KEY);
    expect((await store.read())?.title).toBe('Older in IDB');
  });

  it('read ignores corrupted or old-format records', async () => {
    expect(await store.read()).toBeNull();

    localStorage.setItem(QUICK_ADD_DRAFT_LS_KEY, '{not json');
    expect(await store.read()).toBeNull();

    localStorage.setItem(
      QUICK_ADD_DRAFT_LS_KEY,
      JSON.stringify({ v: 1, title: 'x', target: draft('x').target }),
    );
    expect(await store.read()).toBeNull();
  });

  it('falls back to localStorage when IndexedDB cannot be opened', async () => {
    TestBed.resetTestingModule();
    spyOn(indexedDB, 'open').and.throwError('SecurityError');
    store = TestBed.inject(QuickAddDraftStore);

    store.save(draft('LS only'));
    await expectAsync(store.flush()).toBeResolved();

    expect((await store.read())?.title).toBe('LS only');
  });

  it('keeps the IndexedDB copy when localStorage throws (quota / unavailable)', async () => {
    spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');

    expect(() => store.save(draft('IDB only'))).not.toThrow();
    await store.flush();

    expect((await store.read())?.title).toBe('IDB only');
  });
});
