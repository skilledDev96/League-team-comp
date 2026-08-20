# Cloud Functions Scaffold

This folder contains Firebase Cloud Functions for future player data enrichment.

## Endpoint

- Function name: enrichPlayer
- Function name: getTeamSynergy
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

`getTeamSynergy` accepts the current roster and resolves each Riot ID to a PUUID. It fetches recent queue `420` and `440` match IDs, deduplicates match details, and returns pairs, trios, four-player groups, and full five-player groups found on the same team. It stores no raw match history.

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
