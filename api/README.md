# Cloud Functions

The Firebase Cloud Functions behind Bom Squad Draft Hub — sixteen of them; `CLAUDE.md` at the repo root is the
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

## Admin-only manual triggers

`syncChampionTraits`, `crawlOnce` and `buildMatchupIndexOnce` run by hand what their scheduled twins
(`refreshChampionTraits`, `crawlChampionStats`, `buildMatchupIndex`) run on their own. Since 27 Sep 2026 they are
**POST only, and only for an admin** (the bootstrap admin or an active `access/{email}` entry with role `admin`),
signed in with Google or the e2e custom token, the same two providers `firestore.rules` accepts. The check is
`admitAdmin` in `src/admin-auth.ts`; `riotKeyHealth` stays open, since the public e2e checks call it signed out.

| Answer | Why |
| --- | --- |
| 204 | CORS preflight (`OPTIONS`) |
| 405 | anything but POST, even from an admin |
| 401 | no `Authorization: Bearer <ID_TOKEN>`, a token that does not verify (expired, forged), or no email claim |
| 403 | a contributor, a viewer, no access entry, an entry switched off (`active` false, even with role `admin`), or a provider other than `google.com` / `custom` |
| 500 | either the access lookup failed and nothing ran (the error starts `Could not check access:`), or the admin was let in and the job itself failed part-way (see below) |

A 500 from the job is not "nothing happened". `crawlOnce` moves the switch *before* it ticks, so after
`?enable=true` the crawler can be on — and the scheduled `crawlChampionStats` ticking every two minutes — even
though the reply was a 500; check `crawlState/championStats.enabled`, or run it again. `buildMatchupIndexOnce`
rewrites `matchupIndex` one bucket at a time, so a failure part-way leaves some buckets new and the rest as they
were; run it again. `syncChampionTraits` writes `meta/championTraits` in one piece at the end, so its 500 leaves
the stored map as it was.

Nothing in the app calls them, so the way in is the app's own tab. Open the deployed site, sign in with Google as an
admin, then in DevTools → Console:

```js
const BASE = 'https://europe-west1-lol-bom-squad.cloudfunctions.net';
// The signed-in session's ID token, where the Firebase SDK keeps it. The store also holds a
// '__sak' marker row, so pick the session by its key rather than taking the first row.
const token = await new Promise((resolve, reject) => {
  const open = indexedDB.open('firebaseLocalStorageDb');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('firebaseLocalStorage')) return reject(new Error('Not signed in in this tab.'));
    const rows = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll();
    rows.onerror = () => reject(rows.error);
    rows.onsuccess = () => {
      const user = rows.result.find((row) => String(row.fbase_key).startsWith('firebase:authUser:'));
      user ? resolve(user.value.stsTokenManager.accessToken) : reject(new Error('Not signed in in this tab.'));
    };
  };
});
const run = async (name, query = '') => {
  const response = await fetch(`${BASE}/${name}${query}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  console.log(name, response.status, await response.json());
};

await run('buildMatchupIndexOnce');          // republish matchupIndex from matchupStats
// await run('syncChampionTraits');          // refill meta/championTraits (173 champions in Sep 2026, never the 236 with Jade_*)
// await run('crawlOnce');                   // one crawl tick; the reply states the switch
// await run('crawlOnce', '?enable=false');  // move the switch (true / false), then tick
```

### Refreshing a team by hand

`refreshTeamDataOnce` runs the morning refresh on demand for an editor (admin or contributor). Since release 2
(27 Sep 2026) its body may name the team: no body at all is the root, Bom Squad, exactly as before; `{ teamId }`
runs it for `teams/<id>/` instead, and its log lands at `teams/<id>/meta/refreshLog`. Nothing in the app calls it
for another team yet, so with `BASE` and `token` from the snippet above:

```js
const refresh = async (teamId) => {
  const response = await fetch(`${BASE}/refreshTeamDataOnce`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: teamId ? JSON.stringify({ teamId }) : undefined
  });
  console.log('refreshTeamDataOnce', response.status, await response.json());
};

await refresh('<team id>');   // one team, under teams/<team id>/; the answer is its log and names the team
// await refresh();           // no body: the root, Bom Squad
```

A run takes minutes, so the tab waits; a 400 `teamId must be a team id.` means the id is not lower-case letters, digits
and hyphens (1 to 40, starting with a letter or digit) or is the word `teams`; `default`, null and no body all mean the
root.

The other teams' mornings are `refreshTeams`, scheduled at 07:00, 07:15, 07:30 and 07:45 Amsterdam after the root's
`refreshTeamData` at 06:30: each tick runs the same refresh for exactly one team from the root `teams` list, never the
root, skipping a team switched off (`refresh: 'off'` on its document) or already run or started today, the one refreshed
longest ago first. Nothing runs it by hand; the snippet above is the way to refresh one team now.

A 401 saying the token could not be verified means the stored token had expired: reload the tab (the SDK refreshes
it) and run the snippet again. For a terminal instead, `copy(token)` in the same console and
`curl -X POST -H "Authorization: Bearer <token>" <BASE>/<name>`; the token lasts an hour. The snippet was checked
against a page seeded the way the SDK writes its store, not against the live functions.

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
