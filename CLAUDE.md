# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

The product is a single **Angular app** in `app/` (**Bom Squad Draft Hub**). GitHub
Pages deploys only `app/` (see `.github/workflows/deploy.yml`). The original
JSON-driven static prototype that used to live at the repo root has been removed —
everything is the Angular app now. "The app" means `app/`.

## Commands (run from `app/`)

```bash
npm start            # ng serve — dev server on http://localhost:4200
npm run build        # production build to dist/bom-squad
npm test             # vitest via @angular/build:unit-test
npm run watch        # dev build in watch mode

# Firebase Cloud Functions (in app/functions)
npm run functions:build    # tsc build of functions
npm run functions:deploy   # firebase deploy --only functions:enrichPlayer
```

Run the suite once (CI-style) with `npm test -- --no-watch`; filter with `npx ng test --include='**/ui.service.spec.ts'` or by test name. `src/test-setup.ts` (wired via `angular.json` `test.options.setupFiles`) polyfills `window.matchMedia` and stubs `fetch` so services that fetch on construction (e.g. `ChampionDataService`) stay offline in tests. Specs live next to their targets and focus on pure logic (`core/access`, `UiService`, `ChampionDataService`); CI runs them before the build.

## Local vs Firebase mode — the core runtime switch

`app/src/app/core/firebase.ts` `isFirebaseConfigured()` returns true when `environment.firebase.apiKey` **and** `projectId` are set. This single flag drives the whole app:

- **Firebase mode**: Firestore is the source of truth; login is Google sign-in gated by `access/{email}` role docs.
- **Local mode**: no backend. `TeamDataService` seeds from `SEED_DATA` into `localStorage` (`bom-team-data`), and `AuthService` treats *any* email/password as an admin session (`sessionStorage` flag `bom-local-auth`).

`environment.ts` is committed **with real Firebase web config**, so `npm start` runs against real Firebase and requires sign-in. To develop offline in local mode, blank the `apiKey` in `environment.ts` — **do not commit that change**. (Firebase web config is public by design; it is not a secret.)

## Architecture

**`TeamDataService` (`app/src/app/services/team-data.service.ts`) is the single source of truth.** Every page reads from its signals (`players`, `comps`, `compResults`, `fillIns`, `accessEntries`, `teamIdentity`, `macroSummary`, `resourceLinks`, `settings`). All writes go through `persistUpsert`/`persistRemove`, which branch on `this.mode`:
- Firebase mode → Firestore `setDoc`/`deleteDoc`, with `stripUndefined()` first (Firestore rejects `undefined` fields).
- Local mode → mutate the signal + `persistLocal()` to `localStorage`.

In Firebase mode the signals are kept live by `onSnapshot` listeners set up in `initFirebase()`. When adding a new persisted entity, wire **all** of: the model in `team.models.ts` + `TeamData`, a signal, an `onSnapshot` listener, `EntityKey`, `pushLocalToSignals`/`persistLocal`, `seedFirestore`, and CRUD methods — mirror how `compResults` is done.

**Firestore layout**: list collections `players`, `fillIns`, `comps`, `compResults`, `access`; singleton docs under `meta/` (`teamIdentity`, `macro`, `resourceLinks`, `settings`). `SEED_DATA` (`app/src/app/data/seed-data.ts`) is the one-time migration source and the local-mode seed; its shape must stay in sync with the `TeamData` interface.

**Auth & roles** (`app/src/app/services/auth.service.ts`): roles are `admin` / `contributor` / `viewer`. `canEdit()` is true for local mode, `admin`, or `contributor`; `canManageUsers()` for local mode or `admin`. A bootstrap admin email is hardcoded (`ruanhart7@gmail.com`) in both the service and `firestore.rules`. Content routes are gated by `viewerGuard` (`app/src/app/app.routes.ts`); `AuthService.ready`/`waitUntilReady()` prevents guard-redirect races on refresh.

**Firestore security** (`app/firestore.rules`): public read on everything; writes require `canEdit()` via the catch-all `match /{document=**}`, so a new collection is automatically covered (public read, editor write) — no rules change needed. `access` and `meta/settings` have their own stricter rules.

**Cloud Functions** (`app/functions/src/index.ts`): `enrichPlayer` and `getTeamSynergy`, both `onRequest` with `cors: true`, using the `RIOT_API_KEY` secret, deployed to region `europe-west1` (see `SynergyService.functionUrl()`). They enrich player/team stats from the Riot API.

## Conventions

- **Angular 22, standalone components, signals throughout.** No NgModules; components declare their own `imports`. State is signals + `computed`; prefer this over RxJS for view state.
- Forms use `[ngModel]` + `(ngModelChange)` with `FormsModule` (template-driven, one-way bound to signals), not reactive forms — see `admin.component.html`.
- Styling is one global `app/src/styles.css` (no per-component styles) built on CSS custom properties. Theme is switched via `body[data-theme="..."]` (`dark`, `dark-blue`, `dark-red`, `light`); **always style through tokens** (`--accent`, `--text-0/1`, `--ok` for wins/positive, `--warn` for losses/negative, `--card-border`, `--surface-*`) so all four themes work.
- Shared UI lives in `app/src/app/shared/` (e.g. `overflow-menu.component.ts`, `champion-chip.component.ts`, `external-profiles.component.ts`); reuse these rather than re-rolling menus/chips.
- Commit messages in this repo are a single imperative summary line describing the user-facing change, often with a short rationale after a semicolon.
