# Bom Squad Draft Hub — Hardening Brief

**Written:** Aug 22, 2026 · **Status:** proposed, not yet verified against the code

> ⚠️ This was drafted from the Aug 21 session summary **without repo access**. Every item below is a
> hypothesis with a stated symptom and a proposed fix. Verify each against the actual code before
> acting — some may already be handled.

The theme: last session's worst bug (the corrupt match cache) wasn't bad because the cache was
wrong. It was bad because it was wrong **silently** — the number said 3 instead of 143 and nothing
in the system objected. Most of what follows is about making that class of failure loud.

---

## P0 — Make the pipeline auditable

**Symptom.** The cache bug took temporary instrumentation (`62e74aa`, `a28c582`) to diagnose, and
that instrumentation was then removed (`12c0287`). The next silent drop will cost the same
diagnosis time from scratch.

**Proposal.** A permanent, cheap funnel counter carried through the analysis pass — a plain object
accumulated as the pipeline runs and returned alongside the results:

| Stage | Count |
|---|---|
| candidate match IDs from scan | — |
| fetched from Riot (cache miss) | — |
| served from cache | — |
| re-fetched as self-heal | — |
| roster members identified | — |
| passed `teamMin` | — |
| attributed to a comp | — |
| **dropped** (with reason tally) | — |

Surface it behind the admin/edit-mode toggle that already exists. The dropped-with-reason tally is
the part that matters: `no_puuid_match`, `below_team_min`, `queue_excluded`, `fetch_failed`.

**Why first.** Every other item on this list gets easier to confirm once this exists, and it turns
"the count looks wrong" into a diagnosis rather than an investigation.

---

## P1 — Cache integrity beyond the zero-match case

**Symptom.** The self-heal in `f9172ee` / `3d29488` re-fetches a cached match when it contains
**none** of the roster. A match cached with *some* participants missing puuids still contains one or
two roster members, passes the check, and quietly under-counts — potentially dropping the game below
`teamMin = 4` and excluding it entirely. Same failure mode as the original bug, just harder to see.

**Proposal — two layers:**

1. **Shape validation, not content validation.** A cached match is valid only if it has 10
   participants and *every* participant has a non-empty `puuid`. That's a structural invariant and
   doesn't depend on who's on the roster.
2. **Schema version stamp.** Write `cacheVersion: N` on every cached match. Bump `N` whenever the
   cache shape changes; treat anything below current as a miss. This makes future cache migrations
   a one-line change instead of another archaeology session.

Layer 2 makes layer 1's fix retroactive without a manual purge.

---

## P2 — Deploy verification

**Symptom.** From the ops notes: *"Cloud Functions require a manual `firebase deploy --only
functions`… This tripped us up repeatedly."* The failure is invisible — the frontend looks updated
because Pages auto-deployed, the backend silently didn't.

**Proposal.** Make deployed backend state observable:

- Functions expose the git SHA they were built from (inject at deploy time via an env var, or read
  from a generated `build-info.json`).
- Frontend fetches it and shows it in admin next to the frontend's own SHA.
- **Mismatched SHAs render in the accent/warning colour.** You'd have seen "backend is 6 commits
  behind" at a glance every time it happened.

Optional follow-on: a GitHub Action that deploys functions on push to `main` when `functions/**`
changed, which removes the manual step rather than just flagging it.

---

## P3 — Rate limiting as a budget, not a retry count

**Symptom.** The fix in `ff766b3` / `7eafd36` / `cf37351` was to scan fewer queues and raise retries
3→6. That treats the symptom: retries burn the same budget more politely, and the ordering fix
(Flex first) only works because Flex happens to be the queue you care about most. Add a third queue
later and the same failure returns.

**Proposal.**

- A shared request scheduler with a token bucket matching Riot's published app limits, so calls
  queue rather than fail-and-retry.
- Honour `Retry-After` and read `X-App-Rate-Limit-Count` / `X-Method-Rate-Limit-Count` from
  responses instead of inferring headroom.
- **Persist the scan cursor.** A run that exhausts its budget should resume from where it stopped on
  the next invocation, not restart from the top. This is the single highest-value piece — it makes
  the scan eventually-complete instead of best-effort.

---

## P4 — Comp attribution ambiguity

**Symptom.** Attribution uses champion overlap with a default of 3 of 5, tunable 2–5. At threshold 2
or 3, one game can plausibly satisfy **multiple** comps — especially comps sharing a meta jungler or
support. Unclear from the summary what the tie-break is.

**Questions to answer in the code:**

- Does a game get attributed to the first matching comp, the best-overlap comp, or all of them?
- If first-match: is comp order stable, or does it shift when the user reorders comps in admin?
  Silently changing analytics on reorder would be a nasty one.
- Should a genuinely ambiguous game (equal overlap, 2+ comps) be flagged in the UI rather than
  silently assigned? You already have per-row "in this comp" indicators (`3dfa326`) — an
  "ambiguous" state would fit there naturally.

**Proposal.** Attribute to best overlap; on a tie, mark ambiguous and show it. At minimum, make the
current behaviour explicit and intentional rather than emergent.

---

## P5 — Small stuff worth doing while you're in there

- **`environment.ts` footgun.** The blank-`apiKey` local-dev edit is a commit waiting to happen.
  Move the override to a gitignored `environment.local.ts`, or add a pre-commit hook that rejects
  the blank value. Cheaper than the incident.
- **DDragon id→name cache invalidation.** The champion map is cached — confirm it has a patch-based
  or TTL invalidation path, or new champions will render as blank icons until someone clears it.
- **`teamMin = 4` edge case.** With a rotating 6-player squad, check the case where 4 are on one
  team and 2 are on the *other* (in-house / scrim). Detection is "same team" so it's probably
  correct, but worth an explicit test — it's the kind of thing that produces one weird row nobody
  trusts.

---

## Suggested order

1. **P0 funnel counters** — small, and makes everything below verifiable.
2. **P1 cache validation + version stamp** — closes the known gap in the known bug.
3. **P2 SHA display** — tiny, removes a recurring papercut.
4. **P3 scan cursor persistence** — the durable rate-limit fix; the scheduler can follow later.
5. **P4 attribution** — investigate first, decide, then implement.
6. **P5** — opportunistic.

## Starting prompt for the Code tab

> Read `docs/hardening-brief.md`. Verify P0 and P1 against the actual code — I want to know which of
> those hypotheses are real before we write anything. Then implement P0 (pipeline funnel counters
> surfaced in admin).

---

# Verification log — Aug 22, 2026

Each hypothesis above checked against the actual code.

## P0 — CONFIRMED (implemented)

`computeCompAnalysis` returned only four aggregate counters (`totalTeamGames`, `scannedMatches`,
`newMatches`, `pendingMatches`) and no drop accounting. Real gap.

**Implemented.** An `AnalysisFunnel` is accumulated through the pass and returned on the response:
candidates → served from cache → fetched from Riot → re-fetched (self-heal) → passed team minimum →
attributed to a comp, plus a `dropped` tally with reasons `fetch_failed`, `budget_exhausted`,
`no_roster_in_match`, `below_team_min`. Surfaced as a collapsible "Pipeline audit" panel in Match
Analysis, editor-only. `no_roster_in_match` is the exact signature of the old corrupt-cache bug, so
that failure is now loud instead of silent.

## P1 — CONFIRMED, with one correction (not yet implemented)

- The self-heal check is `cached.participants?.some(p => rosterPuuids.has(p.puuid))` — content-based,
  and a single roster puuid is enough to accept the entry. As described.
- There is **no `cacheVersion` field** on `CachedMatch`. As described.
- **Correction:** the write path maps `puuid` for every participant, so a partial-puuid entry cannot
  originate from our own writes — only from Riot returning participants without puuids (bots, very
  old matches). The original corruption was *total* (zero roster puuids), not partial. This narrows
  the likelihood but not the argument: content-based validation is the wrong shape of check.

Proposal stands: structural invariant (10 participants, all with non-empty puuid) + `cacheVersion`
stamp so future migrations are a constant bump rather than archaeology.

## P4 — REAL, but narrower than stated (not yet implemented)

Answering the brief's questions directly from `functions/src/comp-match.ts`:

- **First-match, best-overlap, or all?** → **Best overlap.** `matchComp` keeps the highest overlap
  across all comps (`if (overlap > bestOverlap)`). Already correct; no change needed.
- **Order-sensitive?** → **Yes, on exact ties only.** Because the comparison is strictly `>`, the
  first comp encountered wins a tie, and the comps array arrives ordered by the admin `order` field.
  So reordering comps in admin **can silently flip attribution for tied games**. The concern is
  justified, but scoped to ties rather than all matching.
- **Ambiguity surfaced?** → No. Nothing marks a game as ambiguous.

Recommendation: keep best-overlap, make the tie-break explicit (deterministic and order-independent),
and surface an "ambiguous" state rather than silently assigning.

## P2, P3, P5 — not yet verified


---

# P1 follow-up — Aug 22, evening

The pipeline audit (P0) was used to settle whether the cache corruption was
historical or ongoing. Three refresh passes were run to work through the
40-fetch-per-run budget. Final pass:

| Stage | Count |
|---|---|
| Candidate matches | 143 |
| Served from cache | 143 |
| Fetched from Riot | 0 |
| Re-fetched (self-heal) | 0 |
| Passed team minimum | 143 |
| Attributed to a comp | 18 |
| Dropped | none |

**Conclusion: the corruption was one-time legacy data, not an active bug.** With a
settled cache, self-heal is 0 — nothing is writing invalid entries. The earlier
run showing 40 self-heals plus 63 over-budget was simply the repair working
through the backlog under the fetch cap.

**Effect on P1's priority:** downgraded from "closes the known gap in the known
bug" to defensive hardening. The structural invariant + `cacheVersion` stamp are
still worth doing — they make the *next* schema change a constant bump instead of
another archaeology session — but there is no live defect to chase.

Also worth noting: a settled cache means a refresh costs **zero** Riot API calls,
so rate limiting is no longer a practical concern for repeat refreshes (relevant
to P3, which can likewise be deprioritised).

---

# Implementation log — Aug 23, 2026

P4, P1 and P2 implemented together.

## P4 — attribution tie-break + ambiguity (done)

`matchComp` now collects every comp tied at the best overlap and picks the winner
by **lowest comp id**, not array position. Reordering comps in the admin editor can
no longer silently change historical attribution. The result carries `tiedNames`,
and a game credited on a tie renders an **"ambiguous"** chip in the game panel,
tooltipped with the comps it fits equally well.

Best-overlap selection was already correct and is unchanged. Five new unit tests
cover the tie-break, including asserting the same winner when the comps array is
reversed (11 function tests total).

## P1 — cache versioning + structural validation (done)

`CachedMatch` now carries `cacheVersion`, stamped on every write, and acceptance
runs through `isCacheUsable`:

- **Stamped with the current version** → trusted outright. We wrote it, so a
  re-fetch would return the same bytes.
- **Unversioned legacy entry** → accepted only if structurally sound: exactly ten
  participants, every one with a non-empty puuid.

Trusting our own stamp is what bounds the work: a match Riot returns oddly (a
missing puuid, say) is re-fetched **once**, then stamped and trusted, instead of
being re-fetched on every run forever. That failure mode is why acceptance is not
purely structural. The old roster-content check (`some(p => rosterPuuids.has(...))`)
is gone, along with the now-unused `rosterPuuids` parameter.

Legacy entries that pass the structural check are grandfathered in, so this does
**not** trigger a mass re-fetch of the existing 143-match cache.

## P2 — deploy verification (done)

`scripts/gen-build-info.mjs` stamps the current git SHA into both `app/src/app/
build-info.ts` and `functions/src/build-info.ts`, wired as a `prebuild` hook in
both package.json files. The backend returns `backendSha` on the analysis
response; the pipeline audit shows frontend and backend SHAs side by side and
turns warning-coloured with "versions differ — redeploy functions" when they
diverge. The invisible failure that cost hours — Pages auto-deploying while the
functions did not — is now visible at a glance.

## Remaining

P3 (rate-limit scheduler / scan cursor) and P5 (small stuff) are still open. P3 is
low priority while a settled cache means refreshes cost zero API calls.

## Verified live — Aug 23, 15:51

First run of P1/P2/P4 against production:

- **P2 works.** Pipeline audit shows `frontend 741a105 / backend 741a105`. The
  frontend-vs-backend drift check is live and matching.
- **P1 grandfathering confirmed.** Self-heal = 0 on the existing 143-match cache,
  so the structural check accepted every legacy entry rather than forcing a mass
  re-fetch — the specific risk this design was built to avoid.
- Analysis persisted cleanly (143 candidates → 143 cached → 143 passed, no drops,
  0 Riot calls) after the `stripUndefinedDeep` fix for the undefined-field write
  failure.
