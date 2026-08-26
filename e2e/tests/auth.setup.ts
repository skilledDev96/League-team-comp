import { expect, test as setup } from '@playwright/test';
import { AUTH_STATE } from '../playwright.config';

/**
 * Signs in once and saves the session for the authenticated tests to reuse.
 *
 * Email/password rather than Google: nobody on the team signs in that way, but
 * an OAuth popup cannot be driven reliably from a test — it fights bot
 * detection and can demand a second factor. The provider being unused by humans
 * is what makes it a clean door for automation.
 *
 * Firebase keeps its session in IndexedDB rather than cookies, so the saved
 * state has to include it.
 */
setup('sign in', async ({ page, context }) => {
  const email = process.env.E2E_EMAIL!;
  const password = process.env.E2E_PASSWORD!;

  await page.goto('./');
  await expect(page.getByText(/Team Login/i)).toBeVisible({ timeout: 30_000 });

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: /^Log in$/ }).click();

  // The form reports its own failures, and its message is far more useful than
  // a timeout on whatever we were waiting for next.
  const error = page.locator('[role="alert"]');
  await expect
    .poll(async () => ((await error.isVisible()) ? await error.innerText() : 'signed-in'), {
      timeout: 30_000,
      message: 'sign-in did not complete'
    })
    .toBe('signed-in');

  // The nav only renders once a session with a role is established.
  await expect(page.getByRole('link', { name: 'Comps' })).toBeVisible({ timeout: 30_000 });

  await context.storageState({ path: AUTH_STATE, indexedDB: true });
});
