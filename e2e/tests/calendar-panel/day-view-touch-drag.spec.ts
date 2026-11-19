import { expect, test } from '../../fixtures/test.fixture';
import { touchPan } from '../../utils/touch-pan';
const PX_PER_HOUR = 52;

/**
 * N2: after long-press, a vertical touch move must drag the block, not
 * scroll the scale (browser would otherwise keep the pan-y decided at
 * pointerdown and cancel the pointer).
 */
test.describe('Calendar day view touch drag', () => {
  test.use({ viewport: { width: 800, height: 900 } });

  test('long-press then vertical move reschedules a block; a swipe without hold scrolls', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    const expand = page.getByRole('button', { name: 'Expand calendar' });
    if (await expand.isVisible()) {
      await expand.click();
    }
    const scale = page.locator('calendar-day-view .scale');
    await expect(scale).toBeVisible();

    await scale.evaluate((el) => {
      (el as HTMLElement).scrollTop = 0;
    });
    const box = await scale.boundingBox();
    if (!box) {
      throw new Error('calendar scale has no box');
    }
    // 10:00 on the scale (52 px per hour), from the top of the un-scrolled scale.
    const halfWidth = box.width / 2;
    const tenHourY = 10 * PX_PER_HOUR;
    const clickX = box.x + halfWidth;
    const clickY = box.y + tenHourY;
    await page.mouse.dblclick(clickX, clickY);
    const input = page.locator('calendar-day-view .day-composer input');
    await expect(input).toBeVisible();
    await input.fill('Call');
    await input.press('Enter');

    const block = page.locator('calendar-day-view .day-block', { hasText: 'Call' });
    await expect(block).toBeVisible();
    const before = await block.getAttribute('aria-label');

    const scrollBefore = await scale.evaluate((el) => (el as HTMLElement).scrollTop);

    // Swipe without a long-press: the scale should scroll, the task stays put.
    const moveBlock = page.locator('calendar-day-view .day-block:not(.day-ghost)', {
      hasText: 'Call',
    });
    await touchPan(page, moveBlock, 0, { deltaY: -120, steps: 8, holdMs: 0 });
    await expect(moveBlock).toHaveAttribute('aria-label', before ?? '');
    const scrollAfterSwipe = await scale.evaluate((el) => (el as HTMLElement).scrollTop);
    expect(scrollAfterSwipe).not.toBe(scrollBefore);

    // Чекаємо, доки інерція скролу зупиниться: інакше long-press влучає в resize.
    await page.evaluate(async () => {
      const el = document.querySelector('calendar-day-view .scale') as HTMLElement;
      await new Promise<void>((resolve) => {
        let last = el.scrollTop;
        let stable = 0;
        const started = performance.now();
        const tick = (): void => {
          if (el.scrollTop === last) {
            stable += 1;
            if (stable >= 10) {
              resolve();
              return;
            }
          } else {
            stable = 0;
            last = el.scrollTop;
          }
          if (performance.now() - started > 4000) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    });

    const mid = await moveBlock.boundingBox();
    if (!mid) {
      throw new Error('block has no box after swipe');
    }
    const startY = mid.y + Math.max(4, Math.min(mid.height * 0.25, 10));
    await touchPan(page, moveBlock, 0, {
      deltaY: 2 * PX_PER_HOUR,
      steps: 10,
      holdMs: 450,
      start: { x: mid.x + Math.min(mid.width / 2, 40), y: startY },
      beforeRelease: async () => {
        await expect(page.locator('calendar-day-view .day-ghost')).toBeVisible();
      },
    });

    await expect(page.locator('calendar-day-view .day-ghost')).toHaveCount(0);
    await expect(moveBlock).not.toHaveAttribute('aria-label', before ?? '');
    const after = await moveBlock.getAttribute('aria-label');
    expect(after).toMatch(/Call/);
  });
});
