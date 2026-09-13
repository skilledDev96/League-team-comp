# Cloud Functions

The Firebase Cloud Functions behind Bom Squad Draft Hub — fifteen of them; `CLAUDE.md` at the repo root is the
authoritative list of what each one does and how they fit together. This file keeps the `enrichPlayer` request
contract and the local build and deploy notes.

## Endpoint (enrichPlayer)

- Function name: enrichPlayer
- Trigger type: HTTPS request
- Method: POST
- Auth: Firebase ID token required in Authorization header
- Role guard: admin or contributor only (access collection)

## Request payload

```json
{
  "summonerName": "SkilledScarecrow",
  "riotTag": "EUW",
  "region": "euw",
  "role": "Mid",
  "mobalyticsSlug": "skilledscarecrow-euw"
}
```

## Response payload

```json
{
  "playstyle": "Wave-control mid with roam windows around jungle pressure.",
  "strengths": ["Wave management under pressure", "Strong river skirmish setups"],
  "weaknesses": ["Roam timing can be late", "Needs tighter side-lane reset timing"],
  "source": "template",
  "provider": "built-in-role-template",
  "generatedAt": "2026-08-12T11:00:00.000Z"
}
```

## Ranked queue data

The enrichment function fetches official ranked entries from League V4 and keeps only these queues:

- `RANKED_SOLO_5x5` — Solo/Duo rank and queue `420` match history
- `RANKED_FLEX_SR` — Flex rank and queue `440` match history

Match-V5 requests include the queue filter, so ARAM (`450`), normal games, Arena, and other queues are excluded. The response includes optional `queueStats.solo` and `queueStats.flex` objects. Each object contains `rank` (tier, division, LP, wins, losses, and win rate) and `matches` (queue-specific champion, KDA, CS, damage, vision, role, and derived insights).

The client profile defaults to Flex and can switch to Solo/Duo or a Combined view. Combined is a transparent aggregation of ranked Solo + Flex match statistics; it does not invent a combined tier or LP value.

The newer weekend-only 5v5 mode is not included until Riot publishes a stable queue identifier and API contract for it.


## Local build

From app/functions:

```bash
npm install
npm run build
```

## Deploy

After adding Firebase project config in app/firebase.json and .firebaserc:

```bash
firebase deploy --only functions:enrichPlayer
```

## Notes

- Current implementation is a safe template generator.
- Replace enrichPlayerProfile in src/index.ts with a licensed provider adapter.
- Avoid scraping third-party sites directly from frontend code.
