# Recording a custom game off the replay

Written 10 Sep 2026, when the recorder shipped.

## Why this exists

**Riot's API cannot see a custom game.** A tournament game or a scrim played in
a lobby has no Match-V5 entry and no timeline — the two things every other game
on the Games page is built from. A `.rofl` replay file gives totals only, which
is why those games have always had the thin end-of-game review: a scoreline, no
minutes, no map.

The League client fills that gap while it is playing a replay. It serves the
**Live Client Data API** and the **Replay API** on `https://127.0.0.1:2999`
(self-signed certificate), and between them they answer what happened and when,
and will render a frame of any second of the game to a file.

`scripts/replay-recorder.mjs` walks the replay on that basis: it samples every
minute, reads the whole event list, sets the replay's own interface so a frame
shows the minimap and the spectated player's HUD and none of the panels that
print a Riot id, and takes a real picture two seconds before each death of ours
(the frame at the death itself is the grey recap screen). The frames go to the
review with the rest of the game — the model reads the minimap for where
everyone was and the HUD for the spectated player's abilities and items — and
the app shows them beside the game on the Games row.

A full video is neither needed nor readable. A frame at each death is.

## In the client first

The lead does this, then runs the script.

1. **Open the replay.** Match History → Download → Watch, or double-click the
   `.rofl` file. Wait until it is actually playing: the Live Client and Replay
   APIs answer only while a replay is up.
2. **Open the right replay.** Nothing in the client says *which* game a replay
   is, so the id on the command line is taken on trust — the script checks the
   replay's length against the length the analysis holds for that id and stops
   when they are more than 30 seconds apart, which is what catches "the wrong
   scrim from the same evening".
3. **Leave the window open** and do not close it during the run. The script does
   all the seeking and pausing itself, and sets the replay's interface itself
   (see below), so nothing else has to be true.
4. **Run the client at 1920x1080 or smaller.** The render asks for 1280x720 and
   most clients honour it; a client that ignores the request renders at the
   client's own resolution, and at 2560x1440 those frames blow the 700 KB a
   Firestore document can hold and are dropped rather than stored. The drop
   message prints the frame's real pixel size, so it says which case you are in.
5. **Leave the camera attached to a champion.** Since 11 Sep 2026 the run points
   it itself: before each picture it puts the camera on whoever that picture is
   about, so a death's frame carries the victim's own HUD. That matters because
   the abilities, the items and the cooldowns in the corner belong to the
   followed champion alone, and they are the one thing a frame says about a
   player that the minute-by-minute figures do not.
   The one thing it cannot do for you is get the replay **out of manual
   camera**. A replay whose camera you have detached — dragged the map, or
   pressed the key that frees it — takes the request and goes on showing what it
   was showing, and the run says so on the first picture and carries on. Click a
   champion in the replay's own player bar once before you start, and it will
   follow from there. Nothing else in the data depends on it: the per-minute
   figures and the whole event list cover all ten players whoever the camera is
   on, and every frame's minimap shows the whole map. `--no-follow` leaves the
   camera exactly where you put it, for a run where you want one seat's HUD —
   the jungler's, usually — on every frame instead.
6. **Have the match id.** It is the dashed replay id the Games page shows on the
   row, e.g. `EUW1-7977592156` — the same string the `.rofl` filename carries.
   Case and the underscore spelling do not matter; the script folds both.

## Running it

The service account is the same one the e2e runner uses. The environment
variable takes either the JSON itself or a path to the file; the path is the
easier road on Windows. It is never printed, and a parse failure says so without
quoting the value.

PowerShell:

```powershell
$env:FIREBASE_SERVICE_ACCOUNT = 'C:\keys\service-account.json'
npm run record -- EUW1-7977592156
Remove-Item Env:FIREBASE_SERVICE_ACCOUNT
```

Git Bash:

```bash
FIREBASE_SERVICE_ACCOUNT=/c/keys/service-account.json npm run record -- EUW1-7977592156
```

Keep the `--` after `npm run record`, or npm eats the flags. The script can also
be run directly: `node scripts/replay-recorder.mjs EUW1-7977592156`.

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `--shots N` | 20 | How many pictures to keep. Hard cap 30. |
| `--out-dir <dir>` | `./replay-shots` | Where the client writes the frames. They stay on disk after the run (gitignored) so the lead can look at them. |
| `--dry-run` | off | Writes the documents as JSON into the out dir and touches no Firestore. |
| `--roster <file.json>` | — | Only needed for a dry run with no service account: `[{ "name": "Ruan", "role": "Top", "profile": { "riotTag": "EUW" } }, …]`. `riotTag` is the tag alone, not `Name#TAG`. |
| `--no-follow` | off | Leaves the camera where you put it instead of moving it onto whoever each picture is about. For a run where one seat's HUD on every frame is what you want. |

A 35-minute game is roughly 35 seeks for the samples plus one per picture, so
expect a few minutes. It prints `minute 12 of 34` as it goes, then a summary:
minutes sampled (and how many were **not** read), events, pictures kept and
dropped, and the KB it wrote. A minute the client never landed on is left out
of the recording entirely rather than stored with whatever the client happened
to be showing — the run parks the client at the end of the game first, so a
stuck seek would otherwise file the final scoreboard under minute 1.

### After a run

The last line says it: **press Re-review on the game** (the Games row) so the
review reads the frames. Nothing happens automatically — a recording sitting in
Firestore does not re-run a review on its own.

The recorder writes `replayShots/{matchId}__{sec}` first, one document a
picture, and `replayRecordings/{matchId}` last. If it dies half way, nothing
points at pictures that are not there; running it again simply overwrites the
same documents. Every frame the last run left on disk under the same name is
deleted before the client is asked for a new one, so a re-run can never upload
the old pictures — which matters because the usual reason to re-run is that the
first run's frames were bad.

The review reads a recording on **either** tier (11 Sep 2026). A custom game is
the reason the recorder exists — Riot has no match and no timeline for one — but
a recording of a game Riot *can* see is read too, with its frames alongside the
timeline: the frames are the only view of the map either tier has, and the
recorder never asked which kind of game it was recording.

## What it costs

About **a dime of pictures a review**. The review attaches at most eight frames
(`MAX_REVIEW_SHOTS`), which is roughly ten thousand input tokens — about five
cents at Opus's list price, on top of the two calls the review already makes.
The usage the API returns already counts the images, so the cost the app records
needs no arithmetic of its own.

Twenty pictures are recorded and eight are read, because the extra ones cost
almost nothing to store and give the frames strip on the Games row something to
show.

## What it cannot know

The review must not claim any of this, and neither may anything built on a
recording:

- **No team gold, at any minute.** The Live Client gives `currentGold` for the
  spectated player alone. There is no gold figure for either side. Never infer
  one.
- **No positions between frames.** Nothing in the client's data says where
  anyone stood. The only view of the map is the minimap inside a frame, which is
  one moment and approximate.
- **No cooldowns** beyond what the spectated player's HUD happens to show in a
  picture.

A recorded game gets the recorder's own account of the game in "How the game
went" and the frames strip, and still no tape and no map in the film room —
those are built from a Riot timeline, which a custom game does not have.

## Riot's rules, and how they are kept

The other team is **a champion in a seat**, everywhere and always. No name, no
Riot id and no puuid of theirs reaches either document, or any line the script
prints.

This is structural, not a filter at the end. Every side is read off a seat, so
an event's words are champions only ("Gragas kills Ornn"); a killer who is not
one of the ten becomes "a turret", "minions" or "the map"; a tower that minions
finished still knows whose it was from the structure's own T1/T2 name; and an
event whose side cannot be read is dropped rather than guessed — a `GameEnd` the
client will not resolve writes no end event at all.

Our own five are matched by the roster's Riot ids and are the only people named.
A frame is a picture of **our own** game.

### What a frame does and does not contain

Until 11 Sep 2026 that last sentence was true of the text and not of the
picture: the script never touched `/replay/render`, so a frame was whatever the
replay UI happened to be showing — normally including the ten-player scoreboard
and the top-right kill callouts, both of which print the other team's Riot ids,
and those pixels went to Anthropic with the review.

The script now POSTs `/replay/render` once, before the first picture, and reads
the answer back:

| Off | Why |
| --- | --- |
| `interfaceScoreboard`, `interfaceFrames`, `interfaceTimeline` | The three panels that list players by Riot id. |
| `interfaceAnnounce`, `interfaceChat` | The kill callouts and the chat, which name a killer and a victim. |
| `interfaceScore`, `selectionName` | The top-right scoreline and the name over a selected champion. |
| `healthBarChampions` | **On since 11 Sep 2026.** A bar over each champion says who is who and how the fight was going, which is most of what a frame is read for. It carries a Riot id only when the client's own "Show Summoner Names" is on; this team's is off. Run with `--no-health-bars` on a client set the other way, and look at the first frame of a run before the pictures are trusted. |

| On | Why |
| --- | --- |
| `interfaceMinimap` | Where everyone was — the one thing the review reads a frame for. |
| `interfaceAll` | The spectated player's own HUD: abilities, items, the shop bar. |
| `fogOfWar` **off** | Fog would hide the half of the minimap the review is there for. |

**A flag the client will not confirm as off stops the pictures.** The samples
and the events are still written and the summary says so; nothing else in the
run changes. Flags differ across client versions, so the answer is read back
rather than assumed, and a key the client does not carry counts as not
confirmed. If the lead's judgement is ever that a frame of our own game may
carry their ids after all, that decision belongs in `CLAUDE.md` beside the rule
— it cannot be granted here.

The minimap and the fog are the softer half: a client that will not take those
gets one warning line and the run carries on, because a frame with no minimap
breaks no rule, it just costs the review most of its use.

## How to read a failure

| What it says | What it means |
| --- | --- |
| `"…" is not a replay id.` | The match id is not the dashed form. It is `EUW1-7977592156`, not a `.rofl` path and not a numeric id. Answered before anything asks for a service account. |
| `GET /replay/game failed (connect ECONNREFUSED 127.0.0.1:2999)` | No replay is playing. Open it in the client and wait until it is actually running, then run this again. |
| `The client answered /replay/game with no gameLength` | The client is up but not on a replay — a live game or the lobby. |
| `The Live Client answered with N players` | The replay is loading, or it is not a Summoner's Rift game. Wait for it to start playing. |
| `Only N of our roster are in this replay, so it is probably not one of ours.` | Fewer than three seats matched. Check the Riot ids on the Roster page against the players in the game, or record a different replay. |
| `<name> is not in this replay; carrying on without their seat.` | One roster player was not found — a sub played, or their Riot id changed. The run continues; that seat has no name. |
| `… came back at 2560x1440, N KB, M KB encoded, over the 700 KB a document can hold — dropped.` | The render asked for 1280x720 and this client ignored it. Run the client at 1920x1080 or smaller and record again. |
| `no picture landed for <label>; carrying on.` | The client swallowed one render request. One frame is lost, the run continues. |
| `the client did not settle on MM:SS in time; nothing is read there.` | A slow seek, re-posted once and given ten seconds. That minute is left out of the samples, or that picture is not taken; the run continues and the summary counts it. |
| `no pictures this run: the client did not confirm … off` | The client would not hide a panel that prints the other team's Riot ids, so no frame was taken. The samples and the events are still written. See "What a frame does and does not contain". |
| `three pictures in a row failed, so the rest are given up` | Usually the client was closed mid-run. Whatever landed is written; re-run when the replay is up again. |
| `The replay playing is MM:SS long but EUW1-… is MM:SS` | A different game is open — most likely another scrim from the same evening. Open the right replay. |
| `<file> did not read as JSON` | The `--roster` file. PowerShell writes a UTF-8 BOM by default; the script trims one, so this is a real syntax error. |
| `FIREBASE_SERVICE_ACCOUNT is not set` / `is neither JSON nor a path` / `did not parse as JSON` | The service account. Its contents are never printed, including on a parse failure. |
| `The client refused to render a frame.` | Usually the out dir: can the client write there? |

Every call to the client gets one timeout and one retry before it fails, because
the client drops a request now and then while it is seeking.

## Where the pieces are

- `scripts/replay-recorder.mjs` — the recorder. Pure parts exported and driven
  by fakes in its spec; `run()` takes an injectable `fetchImpl`, `fs` and
  `firestore`, so a dry run needs no client and no Firestore.
- `api/src/replay-recorder.spec.mjs` — its spec (`cd api && npx vitest run`).
  It lives in `api/` because that is the only place in the repo a node spec
  actually runs; the `.mjs` is invisible to `npm run build`.
- `api/src/replay-recording.ts` — the stored shape and `recordingLines` /
  `shotsFor`, which turn a recording into the review's prompt lines and pick the
  frames it attaches.
- `frontend/src/app/core/replay-lines.ts` — a true mirror of that file, like
  `compareCurve`. The two produce the same lines for the same recording, and
  each has the other's spec; if either drifts, a suite goes red.
- `frontend/src/app/services/replay-recording.service.ts` — reads the two
  collections on demand (`getDoc`, never a listener; a picture only when its
  thumbnail is in view or tapped).
- `frontend/src/app/shared/replay-frames.component.ts` — the frames strip and
  its lightbox, inside the Games row's drawer.

## What the first live run corrected (11 Sep 2026)

The client is the authority, and it disagreed with the plan five times. Each is
handled now, and each is worth knowing if a patch ever changes it back.

- **`EnableReplayApi=1`** must be in `C:\Riot Games\League of Legends\Config\game.cfg`
  under `[General]`, and the game rewrites that file when it exits, so add the
  line with the replay closed. Without it every `/replay/*` call answers 404
  while the Live Client API answers fine.
- **`/replay/game`** gives the process id alone here; the length is on
  `/replay/playback`, which the script now falls back to.
- **Seeking fires no events.** The client builds its event list as the playhead
  passes them, so the run plays the game through once at 16x before reading it.
  Seeking straight to the end read one event for a 36-minute game; playing
  through read 242.
- **Reaching the very end closes the replay** and takes the API with it, so
  every seek now stops ten seconds short and the result comes off the analysis.
- **The events name champions, not summoners**, because the team plays with the
  client's streamer mode on. Our five are matched by champion first — before
  that, every death of a 36-minute game was dropped.
- **A still is `png` only** (jpg is a 400 from the AVContainer enum), the `path`
  is a **folder** the client fills with a numbered sequence, and an empty time
  range writes nothing, so the range is one second. A 1280x720 png is about 2 MB
  against a 1 MiB document, so `sharp` (a devDependency of the repo root) turns
  it into a ~100 KB jpeg: run `npm install` at the root once.
- **`/replay/render` answers 400 for a key it does not know**, and `selectionName`
  is a string (the champion being followed), not a toggle. The run reads the
  client's own render object first and sends back only the keys it reported, in
  the type it reported them.
- **The camera followed nobody**, and for three reasons at once. It was pointed
  *before* the seek, and a seek across half an hour of replay drops the
  selection; the request went out blind inside an empty `catch`, so a client
  that refused it said nothing at all; and a champion the client knows only by
  its id (`MissFortune`, not `Miss Fortune`) was never going to be found. All
  three are handled now: the camera is pointed after the seek and before the
  render, out of the keys the client reported, with both spellings tried and the
  answer read back. A replay in **manual camera** still keeps its own view
  whatever it is told — the run says so once, on the first picture, and takes
  the frames anyway. The selection is put back at the end with the panels, so
  the replay you carry on watching is the one you started with.

**The panels stay up.** With streamer mode on they print champions, never a Riot
id, and they carry the team gold, the items, the KDA and the event bar. That
matters more than it sounds: the recording itself has **no team gold** (the
client gives gold for the spectated player alone), so the frame is the only
place it exists. `--hide-panels` turns them off for a client that is not in
streamer mode, at the cost of everything in that list.

A run also hands the client back the interface it had, so the replay you carry
on watching is the one you started with.
