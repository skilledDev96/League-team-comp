# Cloud Functions Scaffold

This folder contains Firebase Cloud Functions for future player data enrichment.

## Endpoint

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
