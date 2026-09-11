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

**A picture is no longer all that is taken at a death** (11 Sep 2026). The run
seeks to two seconds before each death of ours — the same second that death's
picture is rendered from, so the board and the frame agree — and reads the whole
board off the Live Client's player list: all ten by seat, the level each was,
the cs each had, the items each was holding in slot order with the trinket among
them, and, for anyone already on the floor, that they were down and the seconds
left on them. The first `MAX_DEATH_STATES` (30) deaths of ours get one, which
covers a bloodbath and still leaves the document far under Firestore's megabyte.

The summoner spells and the keystone are kept on the **seat** instead. Neither
changes during a game, so they belong once beside the champion rather than
repeated at every death of that seat.

**Why a board and not a frame per champion.** The lead asked whether to run the
recorder once with `--no-follow` and then once per seat, and merge the runs. It
would not have worked: a picture is stored at `replayShots/{matchId}__{sec}` and
that id has no room for *whose* HUD it is, so the second run overwrites the
first; a review reads at most eight frames (`MAX_REVIEW_SHOTS`) however many are
stored; and each run costs about six minutes. It was also the expensive way
round — everything except live ability cooldowns is already in the per-player
list as JSON, for all ten at once, at any second the run cares to ask. The
cooldowns are the exception and they really are pixels only; see "What it cannot
know".

`RECORDER_VERSION` was **2** as of this, and is **3** since the strip below.
Every block either of them added is optional, so a document written before them
reads exactly as it did.

## Five frames on the moments that matter

Added 12 Sep 2026. One picture of a death says where everyone ended up and
nothing about how they got there, so the run keeps `SHOT_FRAMES` (5) frames on
the first `STRIP_MOMENTS` (8) deaths of ours — the moment itself and the eight
seconds leading into it, one frame every two — and the single picture it always
kept on every other moment. Eight is not a round number: it is
`MAX_REVIEW_SHOTS`, the frames a review reads, so the moments a reader can watch
a fight start on are the very moments the model was shown.

A run-up frame is stored at `replayShots/{matchId}__{sec}__{frame}`, where
`{sec}` is the moment's own second and `{frame}` is how many seconds before it
the picture is. It is never keyed by its own second: `{matchId}__{sec-2}` would
have the later of two deaths three seconds apart overwrite the earlier one's
moment, and a 2v2 trade in the river produces exactly that. The moment keeps the
id it has always had and the index points at the run-up only through that
moment's own `runUp`, which is why a version 3 recording reads on an api that
has not been redeployed exactly as a version 2 one does.

**The moment gates the strip.** Its picture is made and measured first, and a
run-up frame that will not fit a document shortens the strip rather than costing
the moment — nothing anywhere reads a run-up frame on its own, so storing one
whose moment was dropped would be paying Firestore for pictures with no door
into them.

## The clip

Added 12 Sep 2026, because the lead asked the obvious question: *"we don't get to see a short video
of the fight?"* We do now. The client renders **webm** natively, so each of the eight moments a
review looks at also gets nine seconds of video — the run-up and the moment, the same window the
strip covered.

**It lives in Cloud Storage, not Firestore.** A clip is about 2.3 MB against the megabyte a document
holds, so only its URL is stored on the shot ref as `clip`. That is the cheaper half of the trade as
well: Firestore charges roughly eight times what Cloud Storage does per byte at rest, and a moment
that got a clip keeps **no run-up stills at all** — so a recorded game is now *smaller* in Firestore
than it was with pictures alone (about 7.0 MB down to 2.7 MB), with the video sitting in the cheap
tier beside it.

**The bucket is `{project}-clips`, in us-central1.** Not beside the functions, and deliberately:
Google's free allowance for Cloud Storage — 5 GB stored and 100 GB a month downloaded — exists only
in us-central1, us-west1 and us-east1. A season of recordings is under a gigabyte, so the whole
feature is free there and about thirty cents a season anywhere else. The clips are frames of our own
games with streamer mode on, so there is no personal data and no reason to keep them in Europe.

**A clip is as long as the fight.** It was forty-five seconds flat for about an hour, and the lead
said what was wrong with that: *"not all fights are 45 seconds long"*. A fixed window is wrong in
both directions — forty-five seconds of walking around before a solo death, and still short of the
fight where five fell over forty-one. So the window is grouped from the deaths themselves by the
same rule `fightLines` uses (`CLIP_FIGHT_WINDOW_SEC`, 30), running from `CLIP_LEAD_SEC` (12) before
the first death to `CLIP_TAIL_SEC` (3) after the last, capped at `CLIP_MAX_SEC` (90) and trimmed
from the front when it runs long — the end is where the fight was decided. On the recorded game
that gives 15s for the solo death at 4:25, 19s for the three that fell at 24:07, and 50s for 35:03.
A clip and the review sentence about the same fight therefore cover the same seconds.

**`enforceFrameRate` is never sent true**, and that was the other half of the first clips being
wrong: the client drops frames to hit the rate asked for and then tags the container at that rate
anyway, so nine seconds of game came back as a 3.5-second video playing three times too fast. The
trap is that the broken setting was also the SMALLEST file — 2.28 MB against 5.25 MB — so size
alone never proves a clip is right. Check the duration with it.

**The clip is re-encoded before it is uploaded, and captured at the game's own frame rate.** What
the client writes is VP9 at 1920x1080 whatever it is asked for, which is the one combination a
browser struggles to play: a thirty-second fight stuttered. ffmpeg takes it to 720p H.264 CRF 26 —
measured, 11.6 MB became 5.2 MB — and H.264 at 720p is hardware-decoded essentially everywhere.
ffmpeg is not a dependency: a machine without it uploads the client's own file, bigger and
choppier but there.

Once that was true, capturing at fifteen frames stopped being worth it. On one twenty-two-second
fight, after the re-encode: **15fps 4.1 MB, 30fps 5.0 MB, 60fps 5.4 MB**. Sixty costs eight per
cent more than thirty because H.264 codes the difference between frames and consecutive frames at
60fps are nearly identical — so  is 60, the game's own rate, and the choppiness goes for
a third more bytes.

**Two settings are measured, not guessed.** The same nine seconds came back at **9.8 MB** at the
client's lossless default and **2.3 MB** at `framesPerSecond: 30` with `lossless: false`. Asking for
a smaller picture does nothing — 854x480 measured 2.3 MB too, because this client renders at its own
resolution whatever it is told, exactly as it does for a png.

**What it does not fix:** the framing. The director points the camera and we cannot, so a death it
chose not to frame is off screen in the video as much as it was in the stills. What a clip buys is
all nine seconds of wherever the camera did go, instead of five samples of it.

The moment's own still is always kept whatever the clip does — a review reads images and cannot
watch a video, and the still is what the film shows until the reader presses play. A clip that fails
costs the reader a video and nothing else: the stills are written in its place. Clips are swept on a
re-record under the same rule as the pictures, and with the same guard: a run that made none leaves
the old ones alone.

## Recording the same game twice

The run overwrites what it writes, so re-recording is safe — but it does not
overwrite *everything*, which is why it now sweeps (12 Sep 2026).

A picture's document id carries the second it is of (`{matchId}__{sec}`), and a
second run picks its moments from its own reading of the event list. Those
seconds rarely match the first run's, so the old pictures are not replaced —
they are simply left, and the new index never names them again. Nothing in the
app can reach one: a review walks the recording's own `shots`, and the film's
strip walks a moment's `runUp`. A real re-record of one game left four, at 825,
1223, 1450 and 1627 — each up to 700 KB, paid for every month, unreachable.

So after the index is written, and only after — until that moment the old index
is still the one being read, and sweeping first would delete the pictures it
points at — every picture of that game the new index does not name is deleted.
A sweep that fails never fails the run: the recording is already written and
correct, and the cost of an orphan is a fraction of a cent against a ten-minute
run.

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
5. **Set the camera to Directed Camera, then leave the mouse alone.** The run
   does not point the camera any more and has not since 11 Sep 2026 — it wakes
   the client's own director instead, and the director is what frames the fight.

   The one thing that breaks it is you: **moving the mouse over the replay flips
   the client to Manual Camera**, and a manual camera ignores the run entirely,
   so every picture comes back as the same patch of map. Start the run and leave
   the machine alone for its ten minutes.

   There are two ways to run it, and the default changed on 11 Sep 2026:

   | | what each frame shows |
   | --- | --- |
   | *(no flag)* | **the fight** — the replay's own Directed Camera frames it, and no HUD |
   | `--follow jungle` | our jungler's HUD on every picture, but a camera that never leaves where it was parked |

   **Why the default flipped.** Holding a selection keeps the client's Directed
   Camera from ever engaging — its countdown restarts every time the run asserts
   the champion — so a run that follows somebody gets their HUD over the same
   parked patch of map, twenty times over. A real run on 11 Sep proved it: all
   twenty pictures were the same rock.

   **And why a picture takes longer now.** A render on its own snaps the camera
   to a fixed spot, which is the other half of why every frame looked alike. The
   director only wakes when the replay is genuinely *playing* and nothing else is
   being asked of the client, and it needs about five seconds of that. So the run
   parks `WARMUP_SEC` (9) before the render's own start, plays into it at
   ordinary speed, and only then renders — from exactly the second playback
   stopped, so the render asks for no seek of its own and the countdown is not
   knocked back. That is nine seconds a picture, about three minutes on a
   twenty-shot run, and it is the difference between a frame of the fight that
   killed us and a frame of an empty pit.

   The HUD is no longer the thing worth paying for. The death boards carry the
   items, the levels and the farm of all ten as text, so the only thing left in
   a HUD that exists nowhere else is **ability cooldowns** — and the camera is
   the one thing the client does better than we can.

   **How the run does it** (measured against patch 26.17 on 11 Sep 2026, after
   three attempts that did not work): `selectionName` and `cameraAttached` are
   accepted and echoed back whenever you send them, and setting them before a
   render does **nothing** — a seek clears the selection, and starting a render
   clears it again. The camera only moves while a render is playing, so the run
   re-asserts the champion on every turn of the wait that watches the render
   write its frames. That walks the camera onto the champion and keeps it there.
   `cameraMode` is never sent: it is the one key that moves the camera on its
   own, and setting it to `"fps"` took the whole client down mid-test.
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
| `--shots N` | 20 | How many moments to keep a picture of. Hard cap 30. |
| `--frames N` | 5 | How many frames to keep on a moment that gets a strip: the moment itself and `N-1` more spread across the `SHOT_LEAD_SEC` (8) seconds leading into it, so five of them is one every two seconds. `--frames=1` records the way every run before 12 Sep 2026 did. More than `SHOT_FRAMES` (5) is taken as 5, and the moments that get a strip are the first `STRIP_MOMENTS` (8) deaths of ours either way. |
| `--out-dir <dir>` | `./replay-shots` | Where the client writes the frames. They stay on disk after the run (gitignored) so the lead can look at them. |
| `--dry-run` | off | Writes the documents as JSON into the out dir and touches no Firestore. |
| `--roster <file.json>` | — | Only needed for a dry run with no service account: `[{ "name": "Ruan", "role": "Top", "profile": { "riotTag": "EUW" } }, …]`. `riotTag` is the tag alone, not `Name#TAG`. |
| `--follow <seat\|champion>` | — | Holds one player for every picture instead of following each death's victim, so every frame carries that seat's HUD — the jungler for pathing and smite, a carry for the cooldowns in the fights they died in. **Say the seat** (`jungle`, `jg`, `top`, `mid`, `adc`, `bot`, `support`, `sup`) and the same command line keeps working next week, whoever is playing what; a champion by either spelling (`Vi`, `Miss Fortune`, `MissFortune`) works too. A seat always resolves to one of ours. Anything that matches neither is refused before the run starts rather than after it. |
| `--no-follow` | off | Touches the camera not at all, so the replay's own **Directed Camera** decides every shot. Use it when you want frames of the fight rather than of one player. |

A 35-minute game is roughly 35 seeks for the samples, one more per death board
and one per picture, so expect a few minutes. It prints `minute 12 of 34` as it
goes and `reading the board at 9 deaths of ours...` when it reaches them, then a
summary: minutes sampled (and how many were **not** read), events, the boards
read, pictures kept and dropped, and the KB it wrote. A minute the client never landed on is left out
of the recording entirely rather than stored with whatever the client happened
to be showing — the run parks the client at the end of the game first, so a
stuck seek would otherwise file the final scoreboard under minute 1.

### After a run

The last line says it: **press Re-review on the game** (the Games row) so the
review reads the frames. Nothing happens automatically — a recording sitting in
Firestore does not re-run a review on its own.

The recorder writes the pictures first — `replayShots/{matchId}__{sec}` for a
moment and `{matchId}__{sec}__{frame}` for a frame leading into one, one
document a picture — and `replayRecordings/{matchId}` last. If it dies half way, nothing
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
show. The run-up adds at most thirty-two more, four on each of eight moments,
and not one of them is ever sent to a review: eight moments tell a coach more
than one moment seen five times over, so the strip is for the reader in the film
room, who can watch a fight start.

The death boards cost nothing worth counting against that: a few hundred bytes
each, thirty at most, in the recording document beside the samples, and the only
tokens they spend are the lines they print. What they cost is time — one seek
and one read each, which is the same order as a picture, and what
`MAX_DEATH_STATES` (30) is there to bound. Fewer reach the review than are
stored, as with the frames: `MAX_DEATH_LINES` (20) boards are printed into the
prompt, earliest first, and the rest are kept and simply not read.

## What it cannot know

The review must not claim any of this, and neither may anything built on a
recording:

- **No team gold, at any minute.** The Live Client gives `currentGold` for the
  spectated player alone. There is no gold figure for either side. Never infer
  one.
- **No positions between frames.** Nothing in the client's data says where
  anyone stood. The only view of the map is the minimap inside a frame, which is
  one moment and approximate.
- **No ability cooldowns**, at a death or anywhere else, beyond what the
  spectated player's HUD happens to show in a picture.
  `/liveclientdata/activeplayer` is where the client keeps them and it answers
  **400** in a replay — there is no active player when nobody is playing. It is
  the one part of "champion-specific data with cooldowns" the run cannot give,
  and the reason everything else is read off the per-player list instead.
- **No board except at a death of ours**, and only the first thirty of those.
  What anyone was holding at any other second is not stored — the minute samples
  carry levels, cs, kills, deaths, assists and the ward score by seat, and no
  items — so a death's board is that second and not the minute around it.
- **No objective events at all** (measured 12 Sep 2026). The client's event list
  for a custom game holds champion kills, structures, multikills, aces and the
  game's own start and end, and **not one epic monster**: a real recording of a
  game decided by `barons 0-2` came back with a hundred raw events and no
  dragon, no Baron, no herald and no grubs. So the minute-by-minute lines
  genuinely have none, and their absence there is not evidence that none fell.
  What there is instead is the **count in each frame's top bar**, which is why
  the review's rules tell it to bracket an objective between two frames —
  "between 12:13 and 15:41 they took a second dragon" — rather than name a
  minute the pictures cannot support. That is also why a fight line stops at the
  fight: "and their Baron followed forty seconds later" cannot be sourced and is
  not claimed.
- **Farm only to the nearest ten** (measured 12 Sep 2026). The Live Client's
  `creepScore` is coarse in a replay: every one of the six hundred and sixty CS
  figures in a real recording was a multiple of ten, while the `wardScore` beside
  each of them was a full float. The figures are stored as the client gave them,
  and `RECORDING_HEAD` says outright that a CS gap under ten is not a gap — so a
  review may read "160 cs against 210" and may not read "our ADC was seven CS
  down".

## The fights

Added 12 Sep 2026, after the lead asked for the data to be tested from a
coach's point of view. A recording already carried every figure below and
printed none of them: the respawn seconds sat unread on every board, and the
prompt's forty minute-by-minute lines went almost entirely on the kill list —
sixty-three separate "Fiddlesticks kills Mordekaiser" sentences in the game this
was measured on, which is a roll call and not a game.

`fightLines` groups the deaths of ours within `FIGHT_WINDOW_SEC` (30 seconds) of
one another into one fight and says, per fight, what a coach actually asks:

> `33:05 — four of ours fell inside 6 seconds, one of theirs with them: our Jungle, then our Support, then our ADC, then our Top; we were three down at the worst of it: our Jungle (54s left), our ADC (55s left), our Support (45s left); they were one down: their Support (46s left); our Jungle was level 17 on 220 cs against their Jungle’s 16 and 200.`

Three things about it are deliberate. **The hole is read across the whole
fight**, not off the board it opened on: a fight opens five on five and says
nothing, and the 4v5 shows a few seconds later once one of ours is down and the
rest fight on anyway. **The one who is falling is never counted as already
down**, since the board is read two seconds before them. And **the count either
side is the trade**: three of ours for four of theirs is a fight we won,
whatever it felt like.

It is built from the **kill events** and not from the boards, so a death past
`MAX_DEATH_STATES` still gets a line and a recording made before the boards
existed still gets its fights — the board is looked up per fight and adds the
levels, the farm and the respawns when it is there. Over `MAX_FIGHT_LINES` (12)
the fights kept are the ones that cost most, put back into time order.

A recorded game gets the recorder's own account of the game in "How the game
went", the frames strip on its Games row, and **The frames** in the film room
(12 Sep 2026), which walks the moments the run kept pictures of with the board
of ten beside each death of ours. The tape and the map are still not among them:
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
| `interfaceNeutralTimers` | **On since 11 Sep 2026** (the lead: "spawn timers to see if an objective was available"). The corner timers are the one thing in a frame that says what was *up* rather than what happened, and a review cannot work it out any other way — the respawn rules are patch-dependent and nothing in the data carries them. The recorder had never set this key, so until now it depended on the lead remembering to tick it. |
| `fogOfWar` **off** | Fog would hide the half of the minimap the review is there for. |

**What a frame carries, which is more than it looks.** The prompt used to open
by telling the model *"There is no team gold in a recording"* — true of the
minutes, and flatly false of the pictures it was being sent. Every frame's top
bar shows **both teams' gold**, their kills, their towers and the objectives
taken; the panel across the bottom shows all ten players' items, KDA and CS; the
corner shows the neutral timers; and the minimap shows where everyone stood. The
head now says so, and tells the model to say when a number is not legible rather
than guess at it.

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
  `deathLines` / `shotsFor`, which turn a recording into the review's prompt
  lines (the minutes, then the board at each death) and pick the frames it
  attaches.
- `frontend/src/app/core/replay-lines.ts` — a true mirror of that file, like
  `compareCurve`. The two produce the same lines for the same recording, and
  each has the other's spec; if either drifts, a suite goes red.
- `frontend/src/app/services/replay-recording.service.ts` — reads the two
  collections on demand (`getDoc`, never a listener; a picture only when its
  thumbnail is in view or tapped).
- `frontend/src/app/shared/replay-frames.component.ts` — the frames strip and
  its lightbox, inside the Games row's drawer.
- `frontend/src/app/core/film-build.ts` — `buildStrip`, which turns a recording
  into the film's **The frames** chapter: the moments, their frames as document
  ids and never pictures, and `deathLine`'s own sentence for each death.
- `frontend/src/app/pages/film/chapters/film-strip.component.ts` and
  `frontend/src/app/shared/film/replay-shot-image.component.ts` — that chapter
  and the one picture at a time it reads, which is nothing at all until the
  chapter is on stage.

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
- **The camera can be pointed, but only through a render**, which took four
  passes to find. The first pass fixed three real faults — the camera was aimed
  *before* the seek (and seeking clears the selection outright), the request
  went out blind inside an empty `catch` so a refusal was silent, and a champion
  the client knows only by its id (`MissFortune`, not `Miss Fortune`) was never
  going to be found. With all three fixed the client answered "following Vi" and
  rendered the same patch of map it had been showing since 00:07.

  So the next pass stopped believing it and watched `cameraPosition` instead:

  | asked for | camera went |
  | --- | --- |
  | `selectionName: Sion`, `cameraAttached: true`, paused | nowhere |
  | `selectionName: Nautilus`, `cameraAttached: true`, paused | nowhere |
  | a second of playback at 1× | nowhere |
  | nine seconds of being left alone | nowhere |
  | `cameraMode: "fps"` | 400 units — **and the client died** |

  The answer was that a paused replay's camera does not move at all, and a
  render **clears the selection when it starts**. Re-asserting it every half
  second *through* a nine-second render walked the camera along with its
  champion — 6204, then 6761, then 7248 as Nautilus moved — and the frame came
  back centred on him mid-fight. That is what the run does now: `makeCameraHold`
  is handed to the wait that watches the sequence land, re-asserts the champion
  on every turn, and reads the selection back once to find out whether this
  client holds it at all.

  Two things will still beat it. **Moving the mouse** flips the client to Manual
  Camera, which ignores the run entirely — hands off while it works. And
  `cameraMode` is never sent under any circumstance.

  What the selection reliably buys is the **HUD**: the frame at a death carries
  that champion's own health, mana, abilities, items and CS in the corner, which
  is the one thing a picture says about a player that the minute-by-minute
  figures cannot. The framing is the client's to decide.

- **The event list repeats itself, and its clock drifts.** The client APPENDS to
  it every time the playhead crosses an event, and a run crosses the same
  seconds over and over — once for the play-through, then again for every
  picture's run-up. A real 36-minute game came back with **266 events of which
  108 were distinct**, one kill listed sixteen times; a review reading that would
  have seen sixteen kills in one second.

  Keying on the exact second was not enough: the same kill comes back as 354.6
  on one crossing and 355.2 on the next, which still left **26 duplicate pairs
  in 89 kills**. So `readEvents` reads the same actors doing the same thing
  within `EVENT_SAME_WINDOW_SEC` (3) as one event — far under any death timer,
  comfortably over the drift — and remembers **every** second a pair has been
  seen at, not just the newest, because a pass covers the whole game before the
  next begins. The client's own `EventID` is no use here; it is not stable
  across passes.

**The panels stay up.** With streamer mode on they print champions, never a Riot
id, and they carry the team gold, the items, the KDA and the event bar. That
matters more than it sounds: the recording itself has **no team gold** (the
client gives gold for the spectated player alone), so the frame is the only
place it exists. `--hide-panels` turns them off for a client that is not in
streamer mode, at the cost of everything in that list.

A run also hands the client back the interface it had, so the replay you carry
on watching is the one you started with — and since 11 Sep 2026 it does that on
the way out of a **Ctrl-C** too, after the lead found the scoreboard missing and
had to tick it back on. That mattered more than it sounds: a run that died
without restoring left the panels where it had put them, and the *next* run then
read that as "what the lead had" and faithfully restored it, so one interrupted
run quietly degraded every run after it.

The one case nothing can fix is the **client itself** going down mid-run: the
API goes with it, so there is nobody left to restore anything. Tick the panels
back on in the replay's own controls, and the next run will take that as the
baseline.
