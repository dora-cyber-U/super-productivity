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

    const box = await scale.boundingBox();
    if (!box) {
      throw new Error('calendar scale has no box');
    }
    // 10:00 on the scale (52 px per hour).
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
    await touchPan(page, block, 0, { deltaY: -120, steps: 8, holdMs: 0 });
    await expect(block).toHaveAttribute('aria-label', before ?? '');
    const scrollAfterSwipe = await scale.evaluate((el) => (el as HTMLElement).scrollTop);
    expect(scrollAfterSwipe).not.toBe(scrollBefore);

    const mid = await block.boundingBox();
    if (!mid) {
      throw new Error('block has no box after swipe');
    }
    await touchPan(page, block, 0, {
      deltaY: 2 * PX_PER_HOUR,
      steps: 10,
      holdMs: 450,
      start: { x: mid.x + Math.min(mid.width / 2, 40), y: mid.y + 8 },
      beforeRelease: async () => {
        await expect(page.locator('calendar-day-view .day-ghost')).toBeVisible();
      },
    });

    await expect(block).not.toHaveAttribute('aria-label', before ?? '');
    const after = await block.getAttribute('aria-label');
    expect(after).toMatch(/Call/);
  });
});
