import { StoredQuickAddDraft } from '../quick-add.model';

/**
 * Сховище чернетки в пам'яті для unit-тестів: поводиться як QuickAddDraftStore
 * (стирає лише «свою» чернетку за id), але без IndexedDB і таймерів.
 * Один екземпляр на кілька TestBed імітує дані, що пережили перезапуск.
 */
export class FakeQuickAddDraftStore {
  draft: StoredQuickAddDraft | null = null;

  save(draft: StoredQuickAddDraft): void {
    this.draft = draft;
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  clear(id: string): Promise<void> {
    if (this.draft?.id === id) {
      this.draft = null;
    }
    return Promise.resolve();
  }

  read(): Promise<StoredQuickAddDraft | null> {
    return Promise.resolve(this.draft);
  }
}
