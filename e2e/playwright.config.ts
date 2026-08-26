import { defineConfig, devices } from '@playwright/test';

/**
 * These run against the deployed system, not a local build. That is the point:
 * the frontend and the backend deploy separately — Pages publishes itself on a
 * push, the functions need a deliberate deploy — so the only way to know they
 * are both live and agree with each other is to ask them.
 *
 * Most of it does not sign in: the public surface is that the site is served,
 * that deep links resolve, that unauthenticated visitors are gated, and that
 * the backend is answering with the build we think it is.
 *
 * The authenticated half runs only when a test account is configured, and is
 * read-only by design — see the README for why the account should be a viewer.
 */
export const SITE = process.env.E2E_SITE ?? 'https://skilleddev96.github.io/League-team-comp/';
export const API = process.env.E2E_API ?? 'https://europe-west1-lol-bom-squad.cloudfunctions.net';

/** Where the signed-in session is cached between the setup step and the tests. */
export const AUTH_STATE = '.auth/state.json';

/**
 * The authenticated tests need a test account. Without one they are not
 * registered at all, rather than reported as skipped — a suite that is always
 * partly yellow stops meaning anything.
 */
const CREDENTIALS = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

export default defineConfig({
  testDir: './tests',
  // Live endpoints, so a slow cold start is not a failure.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Retry once: these cross the internet, and one flake is not a regression.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: SITE,
    trace: 'on-first-retry',
    // A cold Cloud Run instance can take a while to answer.
    actionTimeout: 20_000
  },
  projects: [
    {
      name: 'public',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [/authenticated\.spec\.ts/, /auth\.setup\.ts/]
    },
    ...(CREDENTIALS
      ? [
          { name: 'sign-in', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
          {
            name: 'authenticated',
            testMatch: /authenticated\.spec\.ts/,
            dependencies: ['sign-in'],
            use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE }
          }
        ]
      : [])
  ]
});
