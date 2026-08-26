# End-to-end checks

These run against the **deployed** system, not a local build.

```bash
cd e2e
npm install
npx playwright install chromium   # once
npm test
```

## Why they exist

The frontend and backend deploy separately — GitHub Pages publishes itself on a
push to `main`, the Cloud Functions only move when someone runs
`npm run deploy:functions` from the repo root. Nothing else notices when they
drift apart, and the symptom is a feature that quietly stops working rather than
an error anyone sees.

So the test that earns its place here is **`the deployed backend matches this
checkout`**: it compares the `backendSha` the health endpoint reports against
your current `git HEAD`. When it fails, the functions need deploying.

The Riot key check matters for the same reason — the key expires, and when it
does, enrichment and analysis stop while the UI simply shows nothing.

## What they do not cover

Nothing here signs in. The app is gated by Google sign-in and these tests hold
no credentials, so they cover the public surface only: that the site is served,
that deep links resolve through the Pages 404 fallback, that unauthenticated
visitors are gated, and that the backend answers with the build we expect.

Anything behind the login — drafting, the analysis refresh, the admin editors —
is covered by the unit tests in `frontend/` and `api/`, and by using the app.
Adding authenticated coverage would mean giving these tests a real account,
which is a deliberate decision rather than an oversight.

## Pointing somewhere else

```bash
E2E_SITE=http://localhost:4200/ npm test
E2E_API=http://127.0.0.1:5001/lol-bom-squad/europe-west1 npm test
```
