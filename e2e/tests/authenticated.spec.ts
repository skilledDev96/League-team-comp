import { expect, test } from '@playwright/test';

/**
 * The signed-in surface, using the session saved by auth.setup.
 *
 * Read-only on purpose. The account is a viewer, so these exercise real pages
 * against real data without being able to touch it — writing would mean tests
 * mutating a live tournament, which is what a second Firebase project is for.
 *
 * The assertions are structural rather than about content: that the roster
 * renders, not who is on it. A test that knows the comps are called "Engage"
 * and "Poke" breaks when someone renames one, which teaches people to ignore it.
 */

/**
 * The setup step dismisses the welcome tour, but a fresh account or a lost
 * userPrefs write would bring it back over the page. Cheap to absorb here
 * rather than have every test fail on an overlay.
 */
test.beforeEach(async ({ page }) => {
  page.on('load', () => {
    void page
      .getByRole('button', { name: /^Got it$/ })
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  });
});

test('the session gets past the login gate', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText(/Team Login/i)).toBeHidden();
  await expect(page.getByRole('link', { name: 'Comps' })).toBeVisible();
});

test('the account is a viewer, so the tests cannot change anything', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('link', { name: 'Comps' })).toBeVisible();

  // If this fails the test account has been over-granted, and every test below
  // is one stray click away from editing live data. Worth failing loudly.
  await expect(
    page.getByRole('button', { name: /edit mode/i }),
    'test account can edit — it should be a viewer'
  ).toHaveCount(0);
});

test('the roster page renders players', async ({ page }) => {
  await page.goto('./players');
  await expect(page.locator('.intel-card, .player-card').first()).toBeVisible({ timeout: 30_000 });
});

test('the comps page renders comps', async ({ page }) => {
  await page.goto('./comps');
  await expect(page.locator('.comp-card').first()).toBeVisible({ timeout: 30_000 });
});

test('the analysis page renders', async ({ page }) => {
  await page.goto('./analysis');
  // Either a comp breakdown or the empty state — both mean the page worked.
  await expect(page.locator('.analysis-list, .analysis-empty, .log-list').first()).toBeVisible({
    timeout: 30_000
  });
});

test('the tournaments page offers both views', async ({ page }) => {
  await page.goto('./tournaments');
  await expect(page.getByRole('button', { name: /^Plan$/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Draft$/ })).toBeVisible();
});

test('the draft board loads', async ({ page }) => {
  await page.goto('./tournaments');
  await page.getByRole('button', { name: /^Draft$/ }).click();
  // A series with games, or the message saying there are none — either is the
  // page working; which one depends on where the split happens to be.
  await expect(page.locator('.draft-page, .muted').first()).toBeVisible({ timeout: 30_000 });
});

test('no console errors while moving around signed in', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Pages serves deep links as 404 by design; the app boots from that body.
    if (/404/.test(text) && /League-team-comp/.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  for (const path of ['./', './comps', './analysis', './tournaments']) {
    await page.goto(path);
    await expect(page.getByRole('link', { name: 'Comps' })).toBeVisible({ timeout: 30_000 });
  }

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});
