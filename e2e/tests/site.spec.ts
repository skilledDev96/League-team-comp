import { expect, test } from '@playwright/test';

/**
 * The deployed frontend. GitHub Pages has no server-side routing, so a deep
 * link is served as a 404 whose body is the app — these check that the
 * arrangement actually works, since a broken fallback looks like a dead link
 * rather than an error.
 */

test('the site is served and boots', async ({ page }) => {
  const response = await page.goto('./');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/BomSquad/i);
});

test('an unauthenticated visitor is gated, not shown team data', async ({ page }) => {
  await page.goto('./');
  // The guard renders the login screen in place rather than changing the URL,
  // so the assertion has to be on what is shown, not where the browser is.
  await expect(page.getByText(/Team Login/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('body')).not.toContainText('Bom Squad Comps');
});

test('a deep link resolves to the app rather than a dead page', async ({ page }) => {
  // Pages answers 404 here and serves 404.html, which is a copy of index.html.
  // The status is expected; what matters is that the app boots and routes.
  await page.goto('./comps');
  await page.waitForURL(/\/(login|comps)$/, { timeout: 30_000 });
  await expect(page.locator('app-root')).toBeAttached();
});

test('the page loads without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Pages serves deep links as 404, so the document request logs one by
    // design. Anything else is a real error.
    if (/404/.test(text) && /League-team-comp/.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('./');
  // Not networkidle: Firestore holds a long-lived connection open, so the page
  // is never idle. Wait for the app to have rendered instead.
  await expect(page.getByText(/Team Login/i)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2_000);

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('the login screen offers a way in', async ({ page }) => {
  await page.goto('./login');
  await expect(page.getByRole('button', { name: /sign in|google/i }).first()).toBeVisible();
});
