import { defineConfig, devices } from '@playwright/test';

/**
 * These run against the deployed system, not a local build. That is the point:
 * the frontend and the backend deploy separately — Pages publishes itself on a
 * push, the functions need a deliberate deploy — so the only way to know they
 * are both live and agree with each other is to ask them.
 *
 * Nothing here signs in. The app is gated by Google sign-in and these tests
 * hold no credentials, so they cover the public surface: that the site is
 * served, that deep links resolve, that unauthenticated visitors are gated, and
 * that the backend is answering with the build we think it is.
 */
export const SITE = process.env.E2E_SITE ?? 'https://skilleddev96.github.io/League-team-comp/';
export const API = process.env.E2E_API ?? 'https://europe-west1-lol-bom-squad.cloudfunctions.net';

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
