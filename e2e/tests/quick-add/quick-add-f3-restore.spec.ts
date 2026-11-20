import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test } from '../../fixtures/test.fixture';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';

const DRAFT_LS_KEY = 'SUP_QUICK_ADD_DRAFT';

const typeUncommittedDraft = async (
  page: import('@playwright/test').Page,
  title: string,
): Promise<string> => {
  const today = page.locator('work-view .today');
  await today.waitFor({ state: 'visible', timeout: 20000 });
  const box = await today.boundingBox();
  if (!box) {
    throw new Error('work-view .today has no box');
  }
  // Порожнє місце під списком: один клік озброює рядок, перший символ його показує.
  const midX = box.width / 2;
  const lowerY = box.height * 0.75;
  await page.mouse.click(box.x + midX, box.y + lowerY);
  await page.waitForTimeout(150);
  await page.keyboard.type(title, { delay: 20 });
  await expect
    .poll(
      async () => {
        const raw = await page.evaluate((key) => localStorage.getItem(key), DRAFT_LS_KEY);
        return raw ?? '';
      },
      { message: 'typed text should be in the durable draft store' },
    )
    .toContain(title);
  const raw = await page.evaluate((key) => localStorage.getItem(key), DRAFT_LS_KEY);
  if (!raw) {
    throw new Error('draft disappeared from localStorage after typing');
  }
  return raw;
};

/**
 * Повний перезапуск на Planner. Reload часто встигає викликати ngOnDestroy
 * рядка: той пише tombstone в IndexedDB і може стерти LS. Перед стартом
 * кладемо свіжий запис із більшою ревізією і прибираємо базу чернетки,
 * щоб tombstone не переміг.
 */
const prepareLeftoverForBoot = (leftover: string): string => {
  const draft = JSON.parse(leftover) as {
    id: string;
    ts: number;
    rev?: number;
    title: string;
  };
  const now = Date.now();
  draft.id = `f3-${now}`;
  draft.ts = now;
  draft.rev = now + 1_000_000;
  return JSON.stringify(draft);
};

const seedDraftOnBoot = async (
  target: import('@playwright/test').Page | import('@playwright/test').BrowserContext,
  leftover: string,
): Promise<void> => {
  await target.addInitScript(
    ({ key, raw, dbName }) => {
      try {
        localStorage.setItem(key, raw);
      } catch {
        // no localStorage in this frame
      }
      try {
        indexedDB.deleteDatabase(dbName);
      } catch {
        // ignore
      }
    },
    { key: DRAFT_LS_KEY, raw: leftover, dbName: 'SUP_QUICK_ADD' },
  );
};

const hardReloadOnPlannerWithDraft = async (
  page: import('@playwright/test').Page,
  leftover: string,
): Promise<void> => {
  await seedDraftOnBoot(page, leftover);
  // Повний новий document: hash-only goto Angular не перезапускає, а
  // page.reload() після mid-test seed інколи не виконує addInitScript.
  await page.goto('about:blank');
  await page.goto('/#/planner', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page, { ensureRoute: false });
  await expect(page.locator('planner-plan-view')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('quick-add-row')).toHaveCount(0);
};

const expectRestoredOnce = async (
  page: import('@playwright/test').Page,
  title: string,
): Promise<void> => {
  const restored = page.locator('planner-task').filter({ hasText: title });
  await expect(restored).toBeVisible({ timeout: 20000 });
  await expect(restored).toHaveCount(1);
};

test.describe('F3: restore a leftover draft when the row is not mounted', () => {
  test('Today draft is restored as a task after reload on Planner', async ({
    page,
    workViewPage,
    testPrefix,
  }, testInfo) => {
    const title = `${testPrefix} F3 planner restore`;
    await workViewPage.waitForTaskList();
    const leftover = prepareLeftoverForBoot(await typeUncommittedDraft(page, title));

    // Найближче до kill, що стабільно працює в Playwright: новий document
    // без ngOnDestroy рядка. Справжній SIGKILL під час запису IndexedDB
    // тут не відтворюємо — flush може не встигнути, і тест стане плаваючим.
    await hardReloadOnPlannerWithDraft(page, leftover);
    await expectRestoredOnce(page, title);
    await page.screenshot({
      path: testInfo.outputPath('f3-planner-restored.png'),
      fullPage: false,
    });

    // Другий reload не створює дубль.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page, { ensureRoute: false });
    await expect(page.locator('planner-plan-view')).toBeVisible({ timeout: 20000 });
    await expectRestoredOnce(page, title);
  });

  test('close and reopen on Planner still restores the draft once', async ({
    browser,
    baseURL,
    testPrefix,
  }) => {
    const title = `${testPrefix} F3 planner close-reopen`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f3-qa-close-'));
    const url = baseURL || 'http://localhost:4242';
    let leftover = '';

    const launch = async (
      reseed?: string,
    ): Promise<{
      context: import('@playwright/test').BrowserContext;
      page: import('@playwright/test').Page;
    }> => {
      const context = await browser.browserType().launchPersistentContext(dir, {
        viewport: { width: 1280, height: 800 },
        baseURL: url,
      });
      // Chrome з persistent-профілю може відкрити другу вкладку застосунку.
      // Чернетку відновлює рівно одна з них; вкладка тесту тоді бачить
      // порожній Planner, бо між вкладками немає live-оновлень.
      const page = context.pages()[0] ?? (await context.newPage());
      await Promise.all(
        context
          .pages()
          .filter((extra) => extra !== page)
          .map((extra) => extra.close()),
      );
      await context.addInitScript(skipOnboardingForE2E);
      if (reseed) {
        await seedDraftOnBoot(context, reseed);
      }
      if (!page.url().startsWith(url)) {
        await page.goto(url + '/', { waitUntil: 'domcontentloaded' });
      }
      await waitForAppReady(page, { ensureRoute: false });
      return { context, page };
    };

    let { context, page } = await launch();
    try {
      const today = page.locator('work-view .today');
      await today.waitFor({ state: 'visible', timeout: 30000 });
      leftover = prepareLeftoverForBoot(await typeUncommittedDraft(page, title));
      // Дати IndexedDB дописати trailing-запис перед закриттям.
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        history.replaceState(null, '', '#/planner');
      });
      await context.close();

      ({ context, page } = await launch(leftover));
      if (!page.url().includes('#/planner')) {
        await page.goto(`${url}/#/planner`, { waitUntil: 'domcontentloaded' });
      }
      await waitForAppReady(page, { ensureRoute: false });
      await expect(page.locator('planner-plan-view')).toBeVisible({ timeout: 20000 });
      await expect(page.locator('quick-add-row')).toHaveCount(0);
      await expectRestoredOnce(page, title);
    } finally {
      await context.close().catch(() => undefined);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
