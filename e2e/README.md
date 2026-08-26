# End-to-end checks

These run against the **deployed** system, not a local build.

```bash
npm --prefix e2e install
npm --prefix e2e test
```

The browser download happens automatically before each run — it is separate
from `npm install`, and a partial one fails at launch rather than at install,
which is confusing enough to be worth the second it costs to check.

Run these from the repo root. `--prefix` rather than `cd e2e && …` because
PowerShell 5.1 rejects `&&` as a statement separator.

## Why they exist

The frontend and backend deploy separately — GitHub Pages publishes itself on a
push to `main`, the Cloud Functions only move when someone runs
`npm run deploy:functions` from the repo root. Nothing else notices when they
drift apart, and the symptom is a feature that quietly stops working rather than
an error anyone sees.

So the test that earns its place here is **`the deployed backend is running the
current api code`**. It does not compare SHAs for equality — the stamp is
whatever HEAD was at deploy time, so any later frontend-only commit would fail
that, and a check which cries wolf is one people learn to ignore. It asks git
whether anything under `api/` has changed since the deployed commit, ignoring
the generated build stamp. When it fails, the functions need deploying.

The Riot key check matters for the same reason — the key expires, and when it
does, enrichment and analysis stop while the UI simply shows nothing.

## The authenticated half

Ten of the tests need no account. Nine more run only when a test account is
configured, and they are **not registered at all** without one — a suite that is
permanently part-yellow stops meaning anything.

```
E2E_EMAIL=e2e@bomsquad.test
E2E_PASSWORD=…
```

Set them as environment variables, or copy `.env.example` to `.env` (ignored).
In CI they are repository secrets.

They sign in through the **email/password** form rather than Google. Nobody on
the team signs in that way, which is exactly what makes it a clean door for
automation: an OAuth popup fights bot detection and can demand a second factor.

### The account must be a viewer

One test asserts that Edit mode is **absent**. If it fails, the account has been
over-granted and every other test is a stray click away from editing live data.
Read-only is what makes it safe to point these at production; testing writes
honestly needs a second Firebase project, not careful writes against the real
one.

### What is still not covered

Drafting, the analysis refresh and the admin editors — everything that writes.
Those stay covered by the unit tests in `frontend/` and `api/`, and by using
the app.

## In CI

They run in two places, neither of them on a pull request — these check what is
*deployed*, so on a PR they would report on `main` and tell you nothing about
the change under review.

- **After a deploy** (`deploy.yml`, the `verify` job) — a green build that
  publishes a broken page fails here rather than in front of the team.
- **Daily at 07:00 UTC** (`e2e-scheduled.yml`) — for the failures that arrive
  with no push at all: the Riot key expiring, or someone changing `api/` and
  not deploying it. Also runnable on demand from the Actions tab.

Both check out with `fetch-depth: 0`, because the drift check needs `api/`
history rather than the single commit a shallow clone gives it. Both pass
`E2E_EMAIL`/`E2E_PASSWORD` from repository secrets; without them the
authenticated tests simply are not registered.

## Pointing somewhere else

```bash
E2E_SITE=http://localhost:4200/ npm test
E2E_API=http://127.0.0.1:5001/lol-bom-squad/europe-west1 npm test
```
