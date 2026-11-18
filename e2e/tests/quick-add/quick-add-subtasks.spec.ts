import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * Alt+Enter у нашому рядочку швидкого додавання: підзадача на 2 рівні,
 * Enter лишається на тому ж рівні, порожній Esc / Shift+Tab піднімає вгору.
 */

const openQuickAdd = async (page: Page): Promise<void> => {
  const surface = page.locator('.today');
  await surface.waitFor({ state: 'visible' });

  // Між «Add more» і «Finish Day» — порожнє місце; низ .today часто
  // потрапляє в кнопку, і клік тоді ігнорується.
  const addMore = page.getByRole('button', { name: /Add more|Додати ще/i });
  const finishDay = page.getByRole('button', { name: /Finish Day|Завершити день/i });
  const list = page.locator('task-list.tour-undoneList');

  let midX: number;
  let clickY: number;
  if ((await addMore.count()) > 0 && (await addMore.isVisible())) {
    const addBox = await addMore.boundingBox();
    const finishBox = (await finishDay.isVisible())
      ? await finishDay.boundingBox()
      : null;
    expect(addBox).not.toBeNull();
    const area = addBox as { x: number; y: number; width: number; height: number };
    const halfWidth = area.width / 2;
    midX = area.x + halfWidth;
    if (finishBox) {
      const addBottom = area.y + area.height;
      const gap = finishBox.y - addBottom;
      const halfGap = gap / 2;
      clickY = addBottom + halfGap;
    } else {
      clickY = area.y + area.height + 48;
    }
  } else {
    const box = await ((await list.isVisible()) ? list : surface).boundingBox();
    expect(box).not.toBeNull();
    const area = box as { x: number; y: number; width: number; height: number };
    const halfWidth = area.width / 2;
    midX = area.x + halfWidth;
    clickY = area.y + area.height - 24;
  }
  await page.mouse.dblclick(midX, clickY);
};

test.describe('Quick-add Alt+Enter subtasks', () => {
  test('creates an indented subtask and stays at two levels', async ({
    page,
    workViewPage,
  }, testInfo) => {
    await workViewPage.waitForTaskList();
    await openQuickAdd(page);

    await expect(page.locator('input.e2e-quick-add-input')).toBeVisible({
      timeout: 10000,
    });
    await page.locator('input.e2e-quick-add-input').fill('Дзвінок клієнту');
    await page.keyboard.press('Alt+Enter');

    const subInput = page.locator('input.e2e-quick-add-subtask');
    await expect(subInput).toBeVisible({ timeout: 10000 });

    const parent = page.locator('task').filter({ hasText: 'Дзвінок клієнту' }).first();
    // Поки підзадач ще немає, .sub-tasks не рендериться — рядок у слоті під батьком
    await expect(parent.locator('input.e2e-quick-add-subtask')).toBeVisible();

    await subInput.fill('Підготувати порядок денний');
    await page.keyboard.press('Enter');
    await expect(
      parent.locator('.sub-tasks task-title').filter({
        hasText: 'Підготувати порядок денний',
      }),
    ).toBeVisible();
    await expect(page.locator('input.e2e-quick-add-subtask')).toBeVisible();
    await expect(page.locator('input.e2e-quick-add-subtask')).toHaveValue('');

    await page.locator('input.e2e-quick-add-subtask').fill('Надіслати запрошення');
    await page.keyboard.press('Enter');
    await expect(
      parent.locator('.sub-tasks task-title').filter({ hasText: 'Надіслати запрошення' }),
    ).toBeVisible();

    // Alt+Enter на 2-му рівні не створює онука — лише сусіда
    await page.locator('input.e2e-quick-add-subtask').fill('Зарезервувати залу');
    await page.keyboard.press('Alt+Enter');
    await expect(
      parent.locator('.sub-tasks task-title').filter({ hasText: 'Зарезервувати залу' }),
    ).toBeVisible();
    await expect(parent.locator('.sub-tasks task .sub-tasks')).toHaveCount(0);
    await expect(page.locator('input.e2e-quick-add-subtask')).toBeVisible();

    // Порожній Esc піднімає на верхній рівень
    await page.locator('input.e2e-quick-add-subtask').fill('');
    await page.keyboard.press('Escape');
    await expect(page.locator('input.e2e-quick-add-subtask')).toHaveCount(0);
    await expect(page.locator('input.e2e-quick-add-input')).toBeVisible();

    fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });
    // Повернути рядок підзадачі для скріна: Alt+Enter на порожньому верхньому рядку
    await page.keyboard.press('Alt+Enter');
    await expect(page.locator('input.e2e-quick-add-subtask')).toBeVisible();
    // dev-банер e2e («data will not be persisted») ховаємо зі скріна
    await page.addStyleTag({
      content:
        'snack-bar-container, .mat-mdc-snack-bar-container { display: none !important; }',
    });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
  });
});
