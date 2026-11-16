import { TestBed } from '@angular/core/testing';
import { deleteDB, openDB } from 'idb';
import { WorkContextType } from '../work-context/work-context.model';
import {
  QUICK_ADD_DRAFT_DB_NAME,
  QUICK_ADD_DRAFT_LS_KEY,
  QUICK_ADD_DRAFT_WRITE_INTERVAL_MS,
} from './quick-add.const';
import { QuickAddDraftStore } from './quick-add-draft-store.service';
import { QuickAddDraftTombstone, StoredQuickAddDraft } from './quick-add.model';

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
  const idbDraft = async (): Promise<
    StoredQuickAddDraft | QuickAddDraftTombstone | undefined
  > => {
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

  /** Дочекатися всіх поставлених у чергу операцій (читання стоїть у тій самій черзі). */
  const settle = async (): Promise<void> => {
    await store.read();
  };

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

    expect(((await idbDraft()) as StoredQuickAddDraft)?.title).toBe('Купити фарбу');
  });

  it('throttles IndexedDB writes and always writes the latest state', async () => {
    jasmine.clock().install();
    try {
      store.save(draft('К'));
      await settle();
      // перший символ нової чернетки — одразу (N5)
      expect(((await idbDraft()) as StoredQuickAddDraft).title).toBe('К');

      store.save(draft('Ку'));
      store.save(draft('Куп'));
      jasmine.clock().tick(QUICK_ADD_DRAFT_WRITE_INTERVAL_MS - 1);
      await settle();
      expect(((await idbDraft()) as StoredQuickAddDraft).title).toBe('К');

      jasmine.clock().tick(1);
      await settle();
      expect(((await idbDraft()) as StoredQuickAddDraft).title).toBe('Куп');
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

      expect(((await idbDraft()) as StoredQuickAddDraft)?.title).toBe('Не чекати');
    });
  }

  it('writes immediately when the page becomes hidden', async () => {
    spyOnProperty(document, 'visibilityState').and.returnValue('hidden');
    store.save(draft('Згорнули вікно'));

    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(((await idbDraft()) as StoredQuickAddDraft)?.title).toBe('Згорнули вікно');
  });

  it('clear removes the draft from both stores only when the id matches', async () => {
    store.save(draft('Mine', 'mine'));
    await store.flush();

    await store.clear('someone-else');
    expect(lsDraft()?.id).toBe('mine');
    expect((await idbDraft())?.id).toBe('mine');

    await store.clear('mine');
    expect(lsDraft()).toBeNull();
    expect(await idbDraft()).toEqual({
      v: 2,
      id: 'mine',
      ts: jasmine.any(Number),
      rev: jasmine.any(Number),
      cleared: true,
    } as unknown as QuickAddDraftTombstone);
    expect(await store.read()).toBeNull();
  });

  it('clear cancels a pending write of the same draft', async () => {
    store.save(draft('Gone', 'gone'));

    await store.clear('gone');
    await store.flush();

    expect(await idbDraft()).toEqual(
      jasmine.objectContaining({ id: 'gone', cleared: true }),
    );
    expect(await store.read()).toBeNull();
  });

  describe('PR #5 review H1: a stale localStorage copy never comes back', () => {
    /** Те, що лежить у localStorage на диску після kill: копія ще до стирання. */
    const staleLs = (d: StoredQuickAddDraft): void =>
      localStorage.setItem(QUICK_ADD_DRAFT_LS_KEY, JSON.stringify(d));

    it('after Enter/Esc + kill the tombstone wins over the stale copy', async () => {
      const typed = draft('Saved long ago', 'h1', Date.now() - 70_000);
      store.save(typed);
      await store.flush();

      await store.clear('h1');
      staleLs(typed);

      expect(await store.read()).toBeNull();
    });

    it('an older copy of another draft does not come back either', async () => {
      store.save(draft('Current', 'b'));
      await store.flush();
      await store.clear('b');
      staleLs(draft('Much older', 'a', 1));

      expect(await store.read()).toBeNull();
    });

    it('a newer draft still only in localStorage is restored', async () => {
      store.save(draft('Committed', 'a', 100));
      await store.flush();
      await store.clear('a');
      // новий набір після стирання: до IndexedDB ще не дійшов
      staleLs(draft('Typed after', 'b', Date.now() + 1000));

      expect((await store.read())?.title).toBe('Typed after');
    });

    it('clearing an old draft does not overwrite a newer one already in IndexedDB', async () => {
      store.save(draft('Newer', 'b'));
      await store.flush();

      await store.clear('a');

      expect(((await idbDraft()) as StoredQuickAddDraft).title).toBe('Newer');
    });
  });

  it('read picks the newer of IndexedDB and localStorage', async () => {
    store.save(draft('Older in IDB', 'a'));
    await store.flush();
    const idbRev = ((await idbDraft()) as StoredQuickAddDraft).rev as number;
    localStorage.setItem(
      QUICK_ADD_DRAFT_LS_KEY,
      JSON.stringify({ ...draft('Newer in LS', 'b'), rev: idbRev + 1 }),
    );
    expect((await store.read())?.title).toBe('Newer in LS');

    // localStorage загубив останні зміни (kill до запису на диск) — береться IndexedDB
    localStorage.setItem(
      QUICK_ADD_DRAFT_LS_KEY,
      JSON.stringify({ ...draft('Stale LS', 'a'), rev: idbRev - 1 }),
    );
    expect((await store.read())?.title).toBe('Older in IDB');

    localStorage.removeItem(QUICK_ADD_DRAFT_LS_KEY);
    expect((await store.read())?.title).toBe('Older in IDB');
  });

  describe('PR #5 review N3: order does not depend on the system clock', () => {
    const putIdb = async (
      record: StoredQuickAddDraft | QuickAddDraftTombstone,
    ): Promise<void> => {
      const db = await openDB(QUICK_ADD_DRAFT_DB_NAME);
      try {
        await db.put('draft', record, 'current');
      } finally {
        db.close();
      }
    };

    it('a draft typed after a clear wins even if the clock went back', async () => {
      const now = Date.now();
      const clock = spyOn(Date, 'now').and.returnValue(now);
      store.save(draft('Committed', 'a'));
      await store.flush();
      await store.clear('a');
      const tombstone = (await idbDraft()) as QuickAddDraftTombstone;

      // годинник відстав (синхронізація NTP) — і новий набір іще лише в localStorage
      clock.and.returnValue(now - 60_000);
      store.save(draft('Typed after', 'b', now - 60_000));
      await settle();
      await putIdb(tombstone);

      expect(lsDraft()?.rev).toBeGreaterThan(tombstone.rev as number);
      expect((await store.read())?.title).toBe('Typed after');
    });

    it('continues revisions stored before a restart with a lagging clock', async () => {
      const future = Date.now() + 3_600_000;
      await putIdb({ v: 2, id: 'old', ts: future, rev: future, cleared: true });
      store.ngOnDestroy();
      TestBed.resetTestingModule();
      store = TestBed.inject(QuickAddDraftStore);
      await settle();

      store.save(draft('After restart', 'new'));

      expect(lsDraft()?.rev).toBeGreaterThan(future);
      expect((await store.read())?.title).toBe('After restart');
    });

    it('reads records of older builds (no rev) by their time', async () => {
      await putIdb({ v: 2, id: 'old', ts: 100, cleared: true });
      localStorage.setItem(
        QUICK_ADD_DRAFT_LS_KEY,
        JSON.stringify(draft('Older build', 'x', 200)),
      );

      expect((await store.read())?.title).toBe('Older build');
    });
  });

  describe('PR #5 review N4: an empty database without the store', () => {
    /** Хтось (напр. тестовий скрипт) створив базу потрібної версії без сховища. */
    const createEmptyDb = async (version: number): Promise<void> => {
      store.ngOnDestroy();
      await deleteDB(QUICK_ADD_DRAFT_DB_NAME);
      (await openDB(QUICK_ADD_DRAFT_DB_NAME, version)).close();
      TestBed.resetTestingModule();
      store = TestBed.inject(QuickAddDraftStore);
    };

    for (const version of [1, 2]) {
      it(`creates the store in a v${version} database and writes to IndexedDB`, async () => {
        await createEmptyDb(version);

        store.save(draft('Не мовчки', 'n4'));
        await store.flush();

        expect(((await idbDraft()) as StoredQuickAddDraft)?.title).toBe('Не мовчки');
        localStorage.removeItem(QUICK_ADD_DRAFT_LS_KEY);
        expect((await store.read())?.title).toBe('Не мовчки');
      });
    }
  });

  describe('PR #5 review N5: Enter, then typing right away', () => {
    it('clearing the committed draft while the next one waits writes the next one', async () => {
      store.save(draft('A', 'a'));
      await settle();
      store.save(draft('B', 'b'));
      store.save(draft('B tail', 'b'));

      await store.clear('a');

      expect(((await idbDraft()) as StoredQuickAddDraft).title).toBe('B tail');
      expect((await store.read())?.title).toBe('B tail');
    });
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
