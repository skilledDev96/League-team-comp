import { expect, test } from '@playwright/test';

/** Temporary: a tight shot of the panel itself, both views. Delete after reading. */
test('the review panel, shot', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1400 });
  await page.goto('./games?match=EUW1-7979615260&tab=games');
  await page.getByRole('button', { name: /^(Got it|Skip tour)$/ }).first().click().catch(() => {});
  const panel = page.locator('.game-review').first();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await panel.getByRole('button', { name: 'Team', exact: true }).click();
  await page.waitForTimeout(400);
  await panel.screenshot({ path: 'test-results/panel-team.png' });
  await panel.getByRole('button', { name: 'My seat', exact: true }).click();
  await page.waitForTimeout(600);
  await panel.locator('.review-seat-more > summary').click().catch(() => {});
  await page.waitForTimeout(300);
  await panel.screenshot({ path: 'test-results/panel-seat.png' });
});
