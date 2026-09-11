#!/usr/bin/env node
/**
 * replay-recorder: what a tournament game leaves behind, taken off the League
 * client while it plays the replay.
 *
 * Why (10 Sep 2026): customs — every tournament game and every scrim — are
 * invisible to Riot's API. There is no match and no timeline for them, and a
 * .rofl carries totals only, so those games get a thin review and no tape
 * (docs and CLAUDE.md, "Prep & Draft" and "The film room"). The client itself
 * is the one thing that can still see them: while it plays a replay it serves
 * the Live Client Data API and the Replay API on https://127.0.0.1:2999, so a
 * script running beside it can walk the game a minute at a time, read the
 * event list, and have the client render a real frame at each death. Those
 * frames go to the review with the game (Opus reads the minimap for where
 * everyone was and the HUD for the spectated player's abilities and items),
 * and the app shows them beside it. About a dime of pictures a game; a full
 * video is neither needed nor readable.
 *
 *   Usage (bash):
 *     FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" node scripts/replay-recorder.mjs EUW1-7977592156
 *   Usage (PowerShell):
 *     $env:FIREBASE_SERVICE_ACCOUNT = (Get-Content service-account.json -Raw); node scripts/replay-recorder.mjs EUW1-7977592156
 *   Options: [--shots 20] [--frames 5] [--clip-seconds 45] [--clip-fps 15] [--out-dir <dir>] [--dry-run] [--roster <file.json>]
 *
 * In the client first: open the replay for that game (Match History → Download
 * → Watch, or double-click the .rofl), let it start playing, and leave the
 * window open. The script does the seeking, and it sets the replay's own
 * interface itself (below), so nothing else has to be true.
 *
 * What it writes (the shape both sides mirror; builder B owns the types):
 *   replayShots/{matchId}__{sec}   one picture a document, base64, under the 1 MiB cap
 *   replayShots/{matchId}__{sec}__8
 *   replayShots/{matchId}__{sec}__6
 *   replayShots/{matchId}__{sec}__4
 *   replayShots/{matchId}__{sec}__2
 *                                  the run-up spread across the eight seconds leading into that
 *                                  moment, one frame every two, kept only on the moments a review
 *                                  looks at (SHOT_FRAMES, STRIP_MOMENTS). A run-up frame is keyed
 *                                  to the moment it leads into and never to its own second, so two
 *                                  deaths three seconds apart cannot overwrite each other.
 *   replayRecordings/{matchId}     the index — seats, samples, events, the shots — written LAST,
 *                                  so a run that dies half way leaves no index pointing at
 *                                  pictures that are not there, the run-up frames included.
 * Running it twice overwrites the same documents; it is safe to re-run, and
 * every frame left on disk by the last run is deleted before the client is
 * asked for a new one, so a re-run can never upload the old pictures.
 *
 * It does NOT overwrite them all, which is why the run sweeps (12 Sep 2026). A moment's id carries
 * the second it is of, and a second run picks its moments from its own event list, so the seconds
 * rarely match: a real re-record left four pictures at 825, 1223, 1450 and 1627 that the new index
 * never named again. Nothing in the app could reach them — `shotsFor` walks the recording's own
 * `shots` and the film's strip walks a moment's `runUp` — and each was up to 700 KB paid for every
 * month. So after the index is written, and only after, every picture of this game the new index
 * does not name is deleted.
 *
 * Riot's rules, enforced here and not negotiable: the other team is a champion
 * in a seat and nothing else. No name, Riot id or puuid of theirs is stored or
 * printed anywhere — our own five are matched by the roster's Riot ids and are
 * the only players with a name on them. The pictures are frames of our own
 * game, and (11 Sep 2026) that now holds of the pixels as well as the text:
 * before the first render the script POSTs /replay/render to turn the panels
 * that print a Riot id off — the scoreboard, the team frames, the event
 * timeline, the kill callouts, the chat, the name over a selection and the
 * spectator health bars — keeping the minimap and the spectated player's own
 * HUD, which is all a frame is read for. A panel the client will not confirm
 * as off stops the pictures rather than storing one that may name them; the
 * samples and the events are still written. The service account is never
 * printed.
 */
import fsDefault from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** The client's own loopback address. It is https with a certificate it signed itself. */
export const CLIENT_ORIGIN = 'https://127.0.0.1:2999';

/** The stored shape's version. Bump it when a field changes meaning; readers check it. */
export const RECORDER_VERSION = 3;

/**
 * How many deaths of ours get the full board read at them. Each costs one seek and one read, and
 * carries what all ten were holding — a few hundred bytes. Thirty covers a bloodbath and still
 * leaves the index far under Firestore's megabyte.
 */
export const MAX_DEATH_STATES = 30;

export const DEFAULT_SHOTS = 20;
/** Twenty pictures is about a dime of input tokens; thirty is the ceiling the lead agreed to. */
export const MAX_SHOTS = 30;
/**
 * A picture whose base64 is over this is dropped rather than stored — measured
 * on the encoded string, not the JPEG, because that is what the document holds
 * and what the review checks (the same constant in
 * api/src/replay-recording.ts). 700 KB leaves room under Firestore's 1 MiB cap.
 */
export const MAX_SHOT_BYTES = 700 * 1024;

/** A replay id is the dashed form the Games page keeps for a replay row, e.g. EUW1-7977592156. */
const MATCH_ID_RE = /^[A-Z0-9]+-\d+$/i;

/**
 * How far the replay's own length may sit from the length the analysis holds
 * for the id on the command line before the run stops. A replay's clock and
 * Riot's `gameDuration` differ by the loading screen and a second of rounding;
 * two different games of an evening's scrims differ by minutes.
 */
export const DURATION_TOLERANCE_SEC = 30;

/**
 * How many seconds of replay are played into each picture (11 Sep 2026, measured).
 *
 * The client renders the range it is GIVEN, and the range is the only window in which the replay's
 * own **Directed Camera** can swing onto the action: a paused replay has nothing to direct, and the
 * combo counts "Directed Camera in 5..." for five seconds after every seek. A one-second range
 * therefore stored the same parked view at all eight deaths of a dry run — an empty Nexus with a
 * SHUT DOWN! banner over it — while nine seconds of run-up put the fight that killed us on screen,
 * with everyone's health bars and the ult that landed.
 *
 * The frame kept is the LAST of the sequence, so the run-up is spent moving the camera and the
 * picture is still the moment (a second before the death, which is a grey recap screen).
 */
export const SHOT_LEAD_SEC = 8;
/**
 * How many frames a second the client writes while it renders that range. Left alone it writes at
 * **60**, and nine seconds of that came back as 161 PNGs of 2 MB each — 360 MB for one picture.
 * The sequence is only ever read for its last frame, so one a second is plenty, and a nine-second
 * run-up at one frame a second costs less disk than the old one-second range did at sixty.
 */
export const SHOT_FPS = 1;

/**
 * How many of a moment's rendered frames are kept (12 Sep 2026, the lead: the run renders ten and
 * throws nine away).
 *
 * A strip is the difference between a picture of a fight and the fight itself: whether we walked
 * into it, whether the ward was already gone, who turned first. The client has already rendered
 * every one of these frames by the time the moment's is written, so keeping them costs the run
 * nothing at all; what they cost is Firestore, which is why only the moments a review actually
 * looks at get one.
 *
 * **Five, spread across the whole run-up, not bunched at the death** (12 Sep 2026, the lead: "I
 * don't want the screenshots, I want the actual deaths and see what happened before that to have
 * caused it"). Three frames at one-second steps were three pictures of the same instant — the death
 * itself, three times — while the eight seconds that explain it were rendered and thrown away. Five
 * across `SHOT_LEAD_SEC` is one every two seconds: the approach, the engage, the turn, the death.
 */
export const SHOT_FRAMES = 5;

/**
 * How many moments get a strip. `shotsFor` sends a review its first `MAX_REVIEW_SHOTS` (8) frames,
 * deaths first in time order, so the first eight deaths of the chosen list are exactly the moments
 * the model will see — and keeping the strip to those is what makes the film and the model look at
 * the same seconds. Every other moment keeps the single picture it has always had.
 */
export const STRIP_MOMENTS = 8;

/**
 * How many seconds of ordinary playback run into a picture before the render starts (11 Sep 2026,
 * measured against patch 26.17 after five attempts that did not work).
 *
 * The client's own **Directed Camera** is the only thing that will frame a fight — the API cannot
 * move the replay camera, and a render on its own snaps it back to a fixed spot, which is why
 * twenty pictures of a real game all came back as the same patch of map. The director needs about
 * five seconds of the replay actually *playing*, with nothing else asked of the client, before it
 * wakes up and swings onto the action. So the run parks well before the moment, plays into it, and
 * only then renders — from the second playback has reached, so the render's own seek is a no-op and
 * the director is not knocked back to the start of its countdown.
 *
 * The frame that proved it: at 12:13, "Akali has slain Fiddlesticks!" with Rell channelling her
 * ult, against the same second rendered cold, which was an empty corner of the map.
 */
export const WARMUP_SEC = 9;

/**
 * How close two identical-looking events have to be before they are read as one crossing of the
 * same moment rather than two moments. Three seconds is far under any death timer, so a killer
 * cannot legitimately kill the same victim twice inside it — and comfortably over the second the
 * client's own clock drifts between passes.
 */
export const EVENT_SAME_WINDOW_SEC = 3;

/**
 * How fast the replay is played through to fill the client's event list (11 Sep 2026). Seeking does
 * not fire the events between two seconds — the first live run seeked to the end and read a single
 * event for a whole game — so the run plays it once at speed first: a thirty-six minute game takes
 * about two and a half minutes at sixteen. The client clamps what it will not do.
 */
export const PLAY_THROUGH_SPEED = 16;
/** How long the play-through may take before the run carries on with whatever the list holds. */
export const PLAY_THROUGH_MAX_MS = 6 * 60 * 1000;

/**
 * What the frame must and must not show (11 Sep 2026). `/replay/render` is
 * POSTed once before the first picture, because a frame is whatever the replay
 * UI happened to be showing otherwise — and the replay UI normally includes the
 * ten-player scoreboard and the kill callouts, both of which print the other
 * team's Riot ids. `NAMING_FLAGS` is the subset Riot's rule hangs on: a flag
 * the client does not confirm as off means no pictures at all. The rest are
 * what makes a frame worth reading; those only earn a warning.
 */
export const RENDER_FLAGS = {
  // Keep: the spectated player's own HUD — abilities, items, the shop bar.
  interfaceAll: true,
  // Keep: the one thing the review reads a frame for.
  interfaceMinimap: true,
  // Off: the ten-player panel, the team frames across the top and the event
  // bar all carry Riot ids, and so do the kill callouts and the chat.
  interfaceScoreboard: false,
  interfaceFrames: false,
  interfaceTimeline: false,
  interfaceAnnounce: false,
  interfaceChat: false,
  interfaceScore: false,
  // Off: the kill callouts, which print a Riot id at every kill (this client's own key, read off
  // /replay/render on 11 Sep 2026; older clients fold it into interfaceAnnounce).
  interfaceKillCallouts: false,
  // On (11 Sep 2026, the lead: "we can allow healthbar of champions, I have no
  // summoner names on the champs"): a bar over each champion says who is who and
  // how the fight was going, which is most of what a frame is read for. The bar
  // carries a name only when the client's own "Show Summoner Names" is on, so
  // `--no-health-bars` turns it off again for a client set the other way, and the
  // first frame of every run is worth a look before the pictures are trusted.
  healthBarChampions: true,
  // Off: fog would hide the half of the minimap the review is there to read.
  fogOfWar: false,
  // On (11 Sep 2026, the lead: "I also added objective timers — spawn timers to see if an objective
  // was available"). The client reports this key and the recorder had never set it, so the timers in
  // the corner depended on the lead remembering to tick them. They are the one thing in a frame that
  // says what was UP rather than what happened, and a review cannot work it out any other way: the
  // respawn rules are patch-dependent and nothing in the data carries them.
  interfaceNeutralTimers: true
};

/** The flags Riot's rule hangs on: not confirmed off means no pictures this run. */
export const NAMING_FLAGS = [
  'interfaceKillCallouts',
  'interfaceScoreboard',
  'interfaceFrames',
  'interfaceTimeline',
  'interfaceAnnounce',
  'interfaceChat',
  'interfaceScore'
];

/**
 * Keeping the camera on one champion (11 Sep 2026, the lead: "look into if we
 * can attach the camera to each of our champions like Vi, Akali"). The HUD in
 * the corner of a frame — the abilities, the items, the cooldowns — belongs to
 * the followed champion alone, so a death's frame is worth twice as much when
 * the camera is on the victim.
 *
 * `/replay/render` is the only way to ask, and it took four measured passes
 * against the real client to find the one that works:
 *
 * - `selectionName` is the champion being followed and `cameraAttached`
 *   whether the camera rides them. Both are built out of the keys THIS client
 *   reported, because a key it does not carry answers 400 for the whole
 *   request — `selectionName: false` once cost a run every one of its pictures.
 * - Setting them **before** the render does nothing whatsoever. A seek clears
 *   the selection, and starting a render clears it again. Measured: the camera
 *   sat on 14052,12817 through two different champions, a second of playback
 *   and a nine-second wait, while the client reported every request as done.
 *   Nothing this client SAYS about its camera is worth believing.
 * - What works is holding the selection **while the render plays**. A render
 *   is the only window in which the replay's camera moves at all, and
 *   re-POSTing the selection every poll through it walks the camera onto the
 *   champion and keeps it there — 6204, then 6761, then 7248 as Nautilus moved,
 *   and the frame came back centred on Nautilus in the middle of the fight.
 * - **`cameraMode` is never sent.** It is the one key that moved the camera on
 *   its own, and setting it to `fps` took the client with it: every request
 *   after that was refused because the replay had gone. Moving a camera is not
 *   worth killing a run that has spent five minutes gathering minutes.
 *
 * A client that will not hold the selection loses nothing by trying: its frames
 * carry whatever the replay's own camera was showing, which is what they always
 * did, and the run says so once rather than at every picture.
 */
export const CAMERA_KEYS = ['selectionName', 'cameraAttached'];

/**
 * Which poll of a render reads the selection back. Early enough that the answer
 * is known while there is still time to try the other spelling of the
 * champion's name, late enough that the client has had a moment to take it.
 */
export const CAMERA_CHECK_POLL = 4;

/**
 * The champion's own id, which is not always the name the client prints: the
 * Live Client answers `championName: "Miss Fortune"` beside
 * `rawChampionName: "game_character_displayname_MissFortune"`, and the engine
 * knows the unit by the second spelling. The camera is pointed by name, so a
 * champion with a space or an apostrophe in it has two spellings and the run
 * tries both. Falls back to the printed name with the punctuation taken out.
 */
export function championIdOf(player) {
  const raw = String(player?.rawChampionName ?? '').trim();
  const tail = raw.includes('_') ? raw.slice(raw.lastIndexOf('_') + 1).trim() : '';
  if (tail) return tail;
  return String(player?.championName ?? '').replace(/[^A-Za-z0-9]/g, '');
}

/** Two spellings of one champion: "Miss Fortune", "MissFortune" and "missfortune" are one. */
export function sameChampion(a, b) {
  const flat = (value) => String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  const left = flat(a);
  return Boolean(left) && left === flat(b);
}

/**
 * What to POST to put the camera on one champion, built out of the keys THIS
 * client reported and their types — the same rule `setRenderFlags` follows, for
 * the same reason. Null when the client carries no `selectionName` at all,
 * which means the camera cannot be pointed from here and the run should say so
 * once rather than try it at every picture.
 */
export function followBody(shape, name) {
  const said = shape && typeof shape === 'object' ? shape : {};
  if (typeof said.selectionName !== 'string') return null;
  const body = { selectionName: String(name ?? '') };
  if (typeof said.cameraAttached === 'boolean') body.cameraAttached = true;
  return body;
}

/**
 * The camera for one picture. `poll` is called on every turn of the wait that
 * watches the render write its frames, which is exactly the window the camera
 * can be moved in, and it does two things: re-assert the champion, and on one
 * poll read the selection back to find out whether the client is holding it.
 *
 * A client that is not holding it gets the champion's other spelling tried —
 * some know the unit only as `MissFortune` — and if that will not hold either,
 * `held` goes false and the run says so once and stops asking.
 *
 * `held` is null until the check has run: unknown, not no.
 */
export function makeCameraHold({ call, shape, champion, championId, checkAt = CAMERA_CHECK_POLL }) {
  const names = [...new Set([champion, championId].map((name) => String(name ?? '').trim()).filter(Boolean))];
  let which = 0;
  let held = null;
  let checked = 0;
  return {
    get held() {
      return held;
    },
    get name() {
      return names[which] ?? '';
    },
    /** True while there is any point calling `poll`. */
    get on() {
      return held !== false && names.length > 0 && Boolean(followBody(shape, names[which]));
    },
    async poll(i) {
      if (!this.on) return;
      const body = followBody(shape, names[which]);
      await call('/replay/render', { method: 'POST', body }).catch(() => undefined);
      // One read-back per spelling, so a run of twenty pictures does not spend forty extra reads
      // asking a question it already has the answer to.
      if (held === true || i !== checkAt + checked) return;
      const said = await call('/replay/render').catch(() => null);
      if (sameChampion(said?.selectionName, names[which])) {
        held = true;
        return;
      }
      checked += 1;
      // The client may know this champion only by its id; if that was the last spelling, the
      // camera is the lead's and the run stops asking for it.
      if (which + 1 < names.length) which += 1;
      else held = false;
    }
  };
}

/**
 * The seat words `--follow` accepts, so a lead can say what they mean once and mean it every game:
 * the champion in the jungle changes weekly, the jungle does not.
 */
export const SEAT_WORDS = {
  top: 'Top',
  toplane: 'Top',
  toplaner: 'Top',
  jungle: 'Jungle',
  jungler: 'Jungle',
  jg: 'Jungle',
  jung: 'Jungle',
  mid: 'Mid',
  middle: 'Mid',
  midlane: 'Mid',
  midlaner: 'Mid',
  adc: 'ADC',
  bot: 'ADC',
  botlane: 'ADC',
  bottom: 'ADC',
  carry: 'ADC',
  marksman: 'ADC',
  support: 'Support',
  supp: 'Support',
  sup: 'Support',
  utility: 'Support'
};

/**
 * Who `--follow` names, resolved against this game. Either a seat of ours (`jungle`, `adc`, `sup`)
 * or a champion by either spelling — no champion is called "Jungle", so the two cannot collide.
 * A word that matches neither is answered before the run spends five minutes on it, rather than by
 * twenty frames of nobody in particular.
 */
export function pinnedChampion(name, livePlayers, plan = null) {
  const said = String(name ?? '').trim();
  if (!said) return null;

  // A seat first: it is what the lead actually means, and it survives next week's draft.
  const seat = SEAT_WORDS[said.toLowerCase().replace(/[^a-z]/g, '')];
  if (seat) {
    const ours = (plan?.seats ?? []).filter((one) => one.ours);
    const mine = ours.find((one) => one.seat === seat);
    if (!mine?.champion) {
      const seats = ours.map((one) => `${one.seat} (${one.champion})`).join(', ');
      throw new Error(`--follow ${said}: nobody of ours is in the ${seat} seat in this game.${seats ? ` Our five are ${seats}.` : ''}`);
    }
    const player = (livePlayers ?? []).find((one) => sameChampion(one?.championName, mine.champion));
    return { champion: mine.champion, championId: player ? championIdOf(player) : mine.champion.replace(/[^A-Za-z0-9]/g, ''), seat };
  }

  const found = (livePlayers ?? []).find((player) => sameChampion(player?.championName, said) || sameChampion(championIdOf(player), said));
  if (!found) {
    // Champions are what the other team is allowed to be, so naming the ten here breaks no rule.
    const playing = [...new Set((livePlayers ?? []).map((player) => String(player?.championName ?? '').trim()).filter(Boolean))];
    throw new Error(`--follow ${said}: no seat of ours and nobody playing that champion. Seats are top, jungle, mid, adc, support; the ten champions here are ${playing.join(', ')}.`);
  }
  return { champion: String(found.championName ?? '').trim(), championId: championIdOf(found) };
}

/**
 * Play the replay for a few seconds and stop, so the client's own Directed Camera is awake before a
 * frame is rendered. Best effort throughout: a client that refuses to play gives the picture it
 * would have given anyway, which is what every run did before this existed.
 */
export async function warmDirector({ call, sleep = realSleep, seconds = WARMUP_SEC }) {
  await call('/replay/playback', { method: 'POST', body: { paused: false, speed: 1 } }).catch(() => undefined);
  await sleep(seconds * 1000);
  await call('/replay/playback', { method: 'POST', body: { paused: true } }).catch(() => undefined);
}

/** Said once when the client will not hold a selection, so the lead knows what their frames show. */
export const CAMERA_NOT_HELD =
  'the client would not keep the camera on a champion while it rendered, so every frame carries whatever the replay\'s own camera was showing. Set the replay\'s camera to Directed Camera before a run and the frames will at least be of the fight.';

/** The Live Client's positions, in our own seat words. Mirrors POSITION_ROLE in api/src/lane-read.ts. */
export const POSITION_ROLE = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC',
  UTILITY: 'Support'
};

/** Seat order, so every list reads top to support. Mirrors ROLES in frontend team.models.ts. */
export const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

const USAGE =
  'Usage: FIREBASE_SERVICE_ACCOUNT=<json or a path to it> node scripts/replay-recorder.mjs <matchId> [--shots 20] [--frames 5] [--out-dir <dir>] [--dry-run] [--roster <file.json>] [--hide-panels] [--no-health-bars] [--follow <seat|champion>]';

const CLIENT_HELP =
  'Is the League client open, with the replay playing? The Live Client and Replay APIs only answer while a replay is up.';

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isReplayId(id) {
  return MATCH_ID_RE.test(String(id ?? '').trim());
}

/**
 * The one spelling of an id (11 Sep 2026). Firestore document ids are
 * case-sensitive and every reader looks this one up exactly — the app's own
 * `matchIdFromFilename` ends `.toUpperCase()`, so `game.matchId` is uppercase
 * by construction. A lowercase id used to record a whole game into documents
 * nothing would ever read, and the run said "Wrote replayShots (16)" on its way
 * out. The underscore spelling is folded to the dashed one because
 * `core/match-link.ts` already knows both reach this app.
 */
export function normaliseMatchId(id) {
  return String(id ?? '').trim().replace('_', '-').toUpperCase();
}

/**
 * The only place a shot's document id is built (12 Sep 2026). Offset 0 keeps the id the moment has
 * always had, `{matchId}__{sec}`, which is what `shotsFor` and every reader of an older recording
 * already look up; a run-up frame hangs off it by how many seconds before the moment it is.
 *
 * A run-up frame is NEVER keyed by its own second (`{matchId}__{sec-2}`): two deaths three seconds
 * apart would have the later one's run-up overwrite the earlier one's moment, and a 2v2 trade in
 * the river produces exactly that.
 */
export function shotDocId(matchId, sec, frame = 0) {
  return frame ? `${matchId}__${sec}__${frame}` : `${matchId}__${sec}`;
}

/**
 * Every `replayShots` document a recording points at: each moment's own picture, and every run-up
 * frame hanging off it.
 *
 * Read off the recording rather than off what the run uploaded, because the recording is what a
 * reader follows — `shotsFor` walks `shots`, and the film's strip walks a moment's `runUp`. A
 * picture the recording does not name is unreachable by anything in the app however it got there,
 * which is exactly what makes it an orphan (12 Sep 2026).
 *
 * Why orphans happen at all: a moment's id carries the second it is of, and a second run of the
 * same game picks its moments from its own event list. The deaths it keeps are rarely the same
 * seconds — a re-record of one real game left four pictures at 825, 1223, 1450 and 1627 that
 * nothing has referenced since — and each is up to 700 KB that is paid for forever.
 */
export function referencedShotIds(recording) {
  const ids = new Set();
  for (const shot of recording?.shots ?? []) {
    if (typeof shot?.docId === 'string' && shot.docId) ids.add(shot.docId);
    for (const id of shot?.runUp ?? []) if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

/** One sentence for a bad id, said the same way whether the run or the command line catches it. */
export function badIdMessage(id) {
  return `"${id}" is not a replay id. It is the dashed id the Games page shows for a replay row, e.g. EUW1-7977592156.`;
}

/** mm:ss, for the words on a shot and the progress lines. */
export function mmss(sec) {
  const whole = Math.max(0, Math.round(sec));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The argument line. Only `--dry-run` is a flag; the rest take a value, either
 * `--shots 20` or `--shots=20`, and an unknown option stops the run rather
 * than being ignored — a typo that silently records the default helps nobody.
 */
export function parseArgs(argv) {
  // `typed` is what the lead actually wrote, kept only so a refusal quotes it
  // back rather than the normalised form nobody typed.
  // Panels on unless the lead says otherwise: the client's streamer mode is what keeps a Riot id off the screen,
  // and a frame without the scoreboard and the team frames is missing the gold, the items and the kills.
  const parsed = { matchId: '', typed: '', shots: DEFAULT_SHOTS, frames: SHOT_FRAMES, clipSeconds: CLIP_LEAD_SEC, clipFps: CLIP_FPS, outDir: '', dryRun: false, roster: '', noHealthBars: false, streamerMode: true, follow: false, followChampion: '' };
  const assign = (name, value) => {
    // `--out-dir --dry-run` used to swallow the flag as the value, write the
    // frames to a directory called "--dry-run" and upload to Firestore for
    // real — the one typo that got past the unknown-option guard, with the
    // worst outcome of any of them (11 Sep 2026).
    if (String(value).startsWith('--')) throw new Error(`${name} wants a value.\n${USAGE}`);
    if (name === '--shots') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1) throw new Error(`--shots wants a number of pictures, not "${value}".`);
      parsed.shots = Math.min(MAX_SHOTS, Math.floor(n));
    } else if (name === '--clip-seconds') {
      // How much of the game a clip reaches back over. The default covers a whole fight; the lead
      // asked for it after the first clips, which were the picture's own eight seconds and much too
      // short to see one. A clip is rendered by playing the game through, so this is also seconds
      // added to the run: eight clips at forty-five is six minutes of rendering.
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1 || n > 180) throw new Error(`--clip-seconds wants how many seconds of the fight to keep, 1 to 180, not "${value}".`);
      parsed.clipSeconds = Math.floor(n);
    } else if (name === '--clip-fps') {
      // Frames a second in a clip. Fifteen is the default and halves the bytes against thirty;
      // raise it if a fight reads as choppy, and expect the file to grow in step.
      const n = Number(value);
      if (!Number.isFinite(n) || n < 5 || n > 60) throw new Error(`--clip-fps wants frames a second, 5 to 60, not "${value}".`);
      parsed.clipFps = Math.floor(n);
    } else if (name === '--frames') {
      // How many of a moment's rendered frames to keep. `--frames 1` is what every run before
      // 12 Sep 2026 did, and it writes the same documents those runs wrote, key for key — worth
      // keeping as a way out for a game whose pictures are already near the Firestore bill the
      // lead wants to pay.
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1) throw new Error(`--frames wants how many frames to keep on a moment, 1 to ${SHOT_FRAMES}, not "${value}".`);
      parsed.frames = Math.min(SHOT_FRAMES, Math.floor(n));
    } else if (name === '--out-dir') parsed.outDir = value;
    else if (name === '--roster') parsed.roster = value;
    // One seat's HUD on every frame, instead of leaving the camera to the replay's own director.
    // A seat word or a champion. It has to turn following ON as well as name who, because since
    // 11 Sep 2026 the default is to leave the camera alone entirely.
    else if (name === '--follow') {
      parsed.followChampion = value;
      parsed.follow = true;
    }
    else throw new Error(`Unknown option ${name}.\n${USAGE}`);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    // A client with "Show Summoner Names" on prints a Riot id over every champion, and the bars have to go with it.
    if (arg === '--no-health-bars') {
      parsed.noHealthBars = true;
      continue;
    }
    // The default since 11 Sep 2026, kept as a word for the command lines already written down and
    // for anyone who wants to say out loud that the camera is the replay's own business.
    if (arg === '--no-follow') {
      parsed.follow = false;
      continue;
    }
    // Kept for the command lines already written down; the panels stay up either way now.
    if (arg === '--streamer-mode') {
      parsed.streamerMode = true;
      continue;
    }
    // For a client NOT in streamer mode, where the panels print Riot ids: the frames lose the gold,
    // the items and the event bar, and keep the map and the champions (11 Sep 2026, the lead: "we
    // don't need the panels off like discussed" — this team's client hides the names itself).
    if (arg === '--hide-panels') {
      parsed.streamerMode = false;
      continue;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) assign(arg.slice(0, eq), arg.slice(eq + 1));
      else {
        assign(arg, argv[i + 1] ?? '');
        i += 1;
      }
      continue;
    }
    // Normalised at the edge, because the id is a Firestore document id and
    // every reader looks it up exactly.
    if (!parsed.matchId) {
      parsed.typed = arg;
      parsed.matchId = normaliseMatchId(arg);
    }
  }
  return parsed;
}

/**
 * A fetch built on node:https with the certificate check off for this agent
 * only. The client signs its own certificate, so nothing else would reach it —
 * and turning the check off process-wide (NODE_TLS_REJECT_UNAUTHORIZED) would
 * take every other request down with it.
 */
/**
 * The body as bytes and the headers that go with it (11 Sep 2026). Written by
 * hand, node streams a body chunked with no Content-Length, which is the one
 * request shape a small embedded HTTP server is likeliest to refuse — and
 * every seek and every render is a POST, so a client that answers 411 to it
 * makes nothing at all work, with a message that blames the replay. curl,
 * requests and undici all send a length; now so does this.
 */
export function bodyAndHeaders(init = {}) {
  const body = init.body === undefined ? null : Buffer.from(String(init.body));
  return { body, headers: body === null ? init.headers : { ...(init.headers ?? {}), 'Content-Length': body.length } };
}

export function clientFetch() {
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  return (url, init = {}) =>
    new Promise((resolve, reject) => {
      const { body, headers } = bodyAndHeaders(init);
      const request = https.request(
        url,
        { method: init.method ?? 'GET', headers, agent },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = response.statusCode ?? 0;
            resolve({
              ok: status >= 200 && status < 300,
              status,
              text: async () => text,
              json: async () => (text.trim() ? JSON.parse(text) : {})
            });
          });
        }
      );
      request.setTimeout(init.timeoutMs ?? 8000, () => {
        request.destroy(new Error(`no answer in ${init.timeoutMs ?? 8000}ms`));
      });
      request.on('error', reject);
      if (body !== null) request.write(body);
      request.end();
    });
}

const messageOf = (err) => (err instanceof Error ? err.message : String(err));

/**
 * Every call to the client goes through here: one timeout, one retry, and a
 * failure that says which endpoint went quiet and what to do about it. The
 * client drops a request now and then while it is seeking, which is exactly
 * what the single retry is for.
 */
export function makeCall({ fetchImpl, sleep = realSleep, timeoutMs = 8000 }) {
  return async function call(endpoint, { method = 'GET', body, help = CLIENT_HELP } = {}) {
    let last = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchImpl(`${CLIENT_ORIGIN}${endpoint}`, {
          method,
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          timeoutMs
        });
        if (!response.ok) throw new Error(`answered ${response.status}`);
        return await response.json();
      } catch (err) {
        last = messageOf(err);
        if (attempt === 0) await sleep(400);
      }
    }
    throw new Error(`${method} ${endpoint} failed (${last}). ${help}`);
  };
}

/** The name the Live Client gives a player. The field changed across patches, so read both. */
export function liveName(player) {
  return String(player?.riotId ?? player?.summonerName ?? '').trim();
}

/** "Name#TAG" split into its parts, lowercased. A name with no tag keeps an empty tag. */
export function splitRiotId(value) {
  const raw = String(value ?? '').trim();
  const hash = raw.indexOf('#');
  if (hash < 0) return { name: raw.toLowerCase(), tag: '' };
  return { name: raw.slice(0, hash).toLowerCase(), tag: raw.slice(hash + 1).toLowerCase() };
}

/**
 * Our five, found in the ten by the roster's Riot ids: case-insensitive, and
 * the tag optional because neither the client nor a player's card always
 * carries one. Two tags that disagree are two accounts, so they never match —
 * and every exact match is taken before any bare-name one, or one player of
 * ours could swallow the seat another matches properly.
 */
export function matchRoster(livePlayers, rosterPlayers) {
  const roster = (rosterPlayers ?? []).map((player) => ({
    player,
    name: String(player?.name ?? '').trim().toLowerCase(),
    tag: String(player?.profile?.riotTag ?? player?.riotTag ?? '').replace(/^#/, '').trim().toLowerCase()
  }));
  const live = (livePlayers ?? []).map((player, index) => ({ index, id: splitRiotId(liveName(player)) }));
  const taken = new Set();
  const byIndex = new Map();
  const pass = (fits) => {
    for (const one of live) {
      if (byIndex.has(one.index) || !one.id.name) continue;
      const found = roster.find((r) => !taken.has(r) && r.name === one.id.name && fits(r, one.id));
      if (!found) continue;
      taken.add(found);
      byIndex.set(one.index, found.player);
    }
  };
  pass((r, id) => Boolean(r.tag) && r.tag === id.tag);
  pass((r, id) => !r.tag || !id.tag);
  return {
    byIndex,
    matched: [...byIndex.values()],
    missing: roster.filter((r) => !taken.has(r)).map((r) => r.player)
  };
}

/**
 * One seat per player on a team. The client's own position is the truth when
 * it has one — in a custom it is often empty, which is why the roster's role
 * stands in for ours and the seats left over are handed out in order.
 */
function assignTeamSeats(entries) {
  const seatOf = new Map();
  const free = new Set(ROLES);
  const take = (entry, seat) => {
    if (!seat || !free.has(seat)) return false;
    free.delete(seat);
    seatOf.set(entry.index, seat);
    return true;
  };
  for (const entry of entries) take(entry, POSITION_ROLE[String(entry.live?.position ?? '').toUpperCase()]);
  for (const entry of entries) if (!seatOf.has(entry.index)) take(entry, entry.rosterRole);
  for (const entry of entries) {
    if (seatOf.has(entry.index)) continue;
    const next = ROLES.find((role) => free.has(role));
    if (next) take(entry, next);
  }
  return seatOf;
}

/**
 * The ten as they will be stored: our side, a seat and a champion each, and a
 * name only on the ones the roster claims. `seatOf` reads a seat back off a
 * later Live Client read — the champion is the stable key within a team, with
 * the array position as the fallback, because the order has never been
 * promised.
 */
export function seatPlan(livePlayers, rosterPlayers) {
  const players = livePlayers ?? [];
  const { byIndex, missing } = matchRoster(players, rosterPlayers);
  const teams = new Map();
  for (const [index, live] of players.entries()) {
    const team = String(live?.team ?? '').toUpperCase() || 'ORDER';
    if (!teams.has(team)) teams.set(team, []);
    teams.get(team).push({ index, live, roster: byIndex.get(index), rosterRole: byIndex.get(index)?.role ?? '' });
  }
  let ourTeam = '';
  let best = 0;
  for (const [team, entries] of teams) {
    const mine = entries.filter((e) => e.roster).length;
    if (mine > best) {
      best = mine;
      ourTeam = team;
    }
  }

  const seatByIndex = new Map();
  for (const entries of teams.values()) for (const [i, seat] of assignTeamSeats(entries)) seatByIndex.set(i, seat);

  const seats = [];
  const seatByChampion = new Map();
  const seatByPosition = new Map();
  for (const team of [ourTeam, ...[...teams.keys()].filter((t) => t !== ourTeam)]) {
    const entries = (teams.get(team) ?? []).filter((e) => seatByIndex.has(e.index));
    entries.sort((a, b) => ROLES.indexOf(seatByIndex.get(a.index)) - ROLES.indexOf(seatByIndex.get(b.index)));
    for (const entry of entries) {
      const seat = seatByIndex.get(entry.index);
      const champion = String(entry.live?.championName ?? '').trim();
      const ours = team === ourTeam;
      const name = ours && entry.roster?.name ? String(entry.roster.name) : '';
      // The two things that are fixed for a whole game and so belong on the seat rather than on
      // every death of it: which summoners they took, and what they keystoned into.
      const spellsOf = entry.live?.summonerSpells ?? {};
      const spells = [spellsOf.summonerSpellOne?.displayName, spellsOf.summonerSpellTwo?.displayName].map((one) => String(one ?? '').trim()).filter(Boolean);
      const keystone = String(entry.live?.runes?.keystone?.displayName ?? '').trim();
      seats.push({ seat, champion, ours, ...(name ? { name } : {}), ...(spells.length ? { spells } : {}), ...(keystone ? { keystone } : {}) });
      // A blind-pick custom can put the same champion twice on one side; when
      // it does, the champion stops being an answer and the array position is
      // the only key left.
      const key = `${team}|${champion.toLowerCase()}`;
      seatByChampion.set(key, seatByChampion.has(key) ? null : { seat, ours });
      seatByPosition.set(entry.index, { seat, ours, ...(name ? { name } : {}) });
    }
  }

  return {
    seats,
    ourTeam,
    ourSide: ourTeam === 'CHAOS' ? 'red' : 'blue',
    matchedCount: best,
    missing,
    /** Where a player from a later read sits: by champion first, by array position when that fails. */
    seatOf: (live, index) => {
      const team = String(live?.team ?? '').toUpperCase() || 'ORDER';
      const champion = String(live?.championName ?? '').trim().toLowerCase();
      return seatByChampion.get(`${team}|${champion}`) || seatByPosition.get(index) || null;
    },
    /**
     * A live name back to its seat — used to read the event list, never stored.
     *
     * The event list names whoever the client is willing to name, and with the
     * team's streamer mode on (11 Sep 2026, the first live run) that is the
     * CHAMPION: "KillerName": "Yasuo", "VictimName": "Aphelios". Every kill of a
     * thirty-six minute game was dropped for want of this, because the lookup only
     * knew Riot ids. A champion is unique in a game, and the ten seats already
     * carry theirs off the player list, so the champion is the surer key of the
     * two and is tried first; a Riot id still resolves for a client that gives one.
     */
    seatOfName: (name) => {
      const said = String(name ?? '').trim();
      if (!said) return null;
      const byChampionName = players.findIndex((p) => String(p?.championName ?? '').trim().toLowerCase() === said.toLowerCase());
      let index = byChampionName;
      if (index < 0) {
        const id = splitRiotId(said);
        if (!id.name) return null;
        const ids = players.map((p) => splitRiotId(liveName(p)));
        index = id.tag ? ids.findIndex((p) => p.name === id.name && p.tag === id.tag) : -1;
        if (index < 0) index = ids.findIndex((p) => p.name === id.name);
      }
      if (index < 0) return null;
      const spot = seatByPosition.get(index);
      return spot ? { ...spot, champion: String(players[index]?.championName ?? '').trim(), championId: championIdOf(players[index]) } : null;
    }
  };
}

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * What all ten were holding at one death of ours (11 Sep 2026, the lead: "follow the jungler, then
 * the adc, to get champion-specific data with cooldowns").
 *
 * The cheap half of that wish, and by far the larger half. Ability cooldowns live only in the
 * pixels — `/liveclientdata/activeplayer` answers 400 in a replay, so there is no active player to
 * ask — but the items, the levels, the farm and who was already dead are all in the per-player list
 * at any second, for all ten at once. Reading them at each death costs one seek and no pictures,
 * where a frame per seat would have cost five more runs and could only have reached eight frames.
 *
 * Their side stays a champion in a seat: no name, no Riot id, and the seat is the only key.
 */
export function deathStateFrom(sec, seat, allPlayers, plan) {
  const players = [];
  for (const [index, live] of (allPlayers ?? []).entries()) {
    const spot = plan.seatOf(live, index);
    if (!spot) continue;
    const scores = live?.scores ?? {};
    const row = {
      seat: spot.seat,
      ours: Boolean(spot.ours),
      level: Math.round(number(live?.level)),
      cs: Math.round(number(scores.creepScore)),
      // In slot order, trinket and control wards included: what somebody was holding when we died
      // is half the story of why, and a ward in the bag is not a ward on the map.
      items: (live?.items ?? [])
        .slice()
        .sort((a, b) => number(a?.slot) - number(b?.slot))
        .map((item) => String(item?.displayName ?? '').trim())
        .filter(Boolean)
        .slice(0, 7)
    };
    // Only when they are: an absent key is "alive", and a false one would read as a measurement.
    if (live?.isDead === true) {
      row.dead = true;
      const left = number(live?.respawnTimer);
      if (left > 0) row.respawn = Math.round(left * 10) / 10;
    }
    players.push(row);
  }
  const bySeat = (a, b) => (a.ours === b.ours ? ROLES.indexOf(a.seat) - ROLES.indexOf(b.seat) : a.ours ? -1 : 1);
  return { sec, seat, players: players.sort(bySeat) };
}

/** One minute of the game: what each of the ten had, by seat, and never a name. */
export function sampleFrom(minute, allPlayers, plan) {
  const ours = [];
  const theirs = [];
  for (const [index, live] of (allPlayers ?? []).entries()) {
    const spot = plan.seatOf(live, index);
    if (!spot) continue;
    const scores = live?.scores ?? {};
    const row = {
      seat: spot.seat,
      cs: Math.round(number(scores.creepScore)),
      level: Math.round(number(live?.level)),
      kills: Math.round(number(scores.kills)),
      deaths: Math.round(number(scores.deaths)),
      assists: Math.round(number(scores.assists))
    };
    if (Number.isFinite(Number(scores.wardScore))) row.wardScore = Math.round(number(scores.wardScore) * 10) / 10;
    (spot.ours ? ours : theirs).push(row);
  }
  const bySeat = (a, b) => ROLES.indexOf(a.seat) - ROLES.indexOf(b.seat);
  return { minute, ours: ours.sort(bySeat), theirs: theirs.sort(bySeat) };
}

/**
 * Is this client's streamer mode actually on? (11 Sep 2026, from the review.)
 *
 * The panels are left up on the strength of it — the scoreboard, the team frames and the event bar
 * carry the gold, the items and the kills, and with streamer mode on they print champions where
 * the Riot ids would be. But nothing checked, and the log said so as though it had: a client with
 * streamer mode off would have uploaded twenty frames carrying both teams' Riot ids while
 * announcing that it had not. That is the "mechanism that silently does nothing" this repo has
 * been bitten by before.
 *
 * The event list is the tell, and it costs nothing: the client names the victim of a
 * `ChampionKill` the same way it paints the panels — `"VictimName": "Aphelios"` with streamer mode
 * on, `"VictimName": "Name#TAG"` without it. Null when the list names nobody either way, which is
 * not a yes.
 */
export function streamerModeOn(rawEvents, livePlayers) {
  const champions = new Set((livePlayers ?? []).map((p) => String(p?.championName ?? '').trim().toLowerCase()).filter(Boolean));
  const ids = new Set((livePlayers ?? []).map((p) => liveName(p).toLowerCase()).filter(Boolean));
  let asChampion = 0;
  let asRiotId = 0;
  for (const raw of rawEvents ?? []) {
    if (String(raw?.EventName ?? '') !== 'ChampionKill') continue;
    const said = String(raw?.VictimName ?? '').trim().toLowerCase();
    if (!said) continue;
    if (champions.has(said)) asChampion += 1;
    else if (said.includes('#') || ids.has(said)) asRiotId += 1;
  }
  if (!asChampion && !asRiotId) return null;
  return asChampion >= asRiotId;
}

/** A killer the client names but the ten do not hold: a turret, minions, the jungle. Never stored raw. */
function killerLabel(name) {
  const raw = String(name ?? '');
  if (/^turret/i.test(raw)) return 'a turret';
  if (/^minion/i.test(raw)) return 'minions';
  if (/^sru_|^dragon|^riftherald|^baron/i.test(raw)) return 'the jungle';
  return 'the map';
}

/**
 * The client's event list in our own words. Every side is read off a seat, so
 * nothing here can carry one of their names: an event whose actor is not one
 * of the ten becomes "a turret" or "the map".
 */
export function readEvents(rawEvents, plan, watcherName = '', fallbackWin = null, fallbackEndSec = 0) {
  const events = [];
  const ourDeaths = [];
  const objectives = [];
  let endSec = 0;
  let winner = null;
  // The client APPENDS to its event list every time the playhead crosses an event, and this run
  // crosses the same seconds over and over — the play-through, then a nine-second run-up at every
  // picture. A real 36-minute game came back with 266 events of which 108 were distinct, one kill
  // repeated sixteen times (11 Sep 2026, measured). A review reading that would see sixteen kills
  // in one second. So each event is taken once, keyed on what happened rather than on the client's
  // own id, which is not stable across those passes.
  //
  // Nor is its clock: the same kill came back as 354.6 on one pass and 355.2 on the next, so an
  // exact-second key still let 26 pairs through on a real game. The same actors doing the same
  // thing within `EVENT_SAME_WINDOW_SEC` are therefore one event — a killer cannot kill the same
  // victim twice inside a death timer, and two different towers carry two different names.
  // Every second this pair of actors has already been seen at, not just the newest: a pass covers
  // the whole game before the next one starts, so "the last time we saw this key" is the END of the
  // game by the time the second pass reaches minute three, and the repeat sails through.
  const seenAt = new Map();

  /** Whose it was, off the seat the actor sits in. Null when the client named nobody we placed. */
  const sideOf = (name) => {
    const spot = plan.seatOfName(name);
    return spot ? (spot.ours ? 'us' : 'them') : null;
  };
  /** The client's own team words, for the events that carry them instead of a name. */
  const sideOfTeam = (team) => {
    const said = String(team ?? '').toUpperCase();
    return said === 'ORDER' || said === 'CHAOS' ? (said === plan.ourTeam ? 'us' : 'them') : null;
  };
  /**
   * A structure says whose it was in its own name — T1 is blue's, T2 is red's —
   * so the side that took it is the other one. This is the answer when minions
   * finished a tower, which happens often enough to matter.
   */
  const sideFromStructure = (name) => {
    const found = /_T([12])_/.exec(String(name ?? ''));
    if (!found) return null;
    return (found[1] === '1' ? 'blue' : 'red') === plan.ourSide ? 'them' : 'us';
  };

  for (const raw of rawEvents ?? []) {
    const sec = Math.max(0, Math.round(number(raw?.EventTime)));
    const name = String(raw?.EventName ?? '');
    // The same actors doing the same thing at about the same time is the same event, however many
    // times the playhead has crossed it and whatever second the client rounded it to that pass.
    const key = [name, raw?.KillerName ?? '', raw?.VictimName ?? '', raw?.TurretKilled ?? raw?.InhibKilled ?? '', raw?.DragonType ?? '', raw?.Recipient ?? '', raw?.Acer ?? ''].join('|');
    const before = seenAt.get(key);
    if (before?.some((was) => Math.abs(sec - was) <= EVENT_SAME_WINDOW_SEC)) continue;
    if (before) before.push(sec);
    else seenAt.set(key, [sec]);
    if (name === 'ChampionKill') {
      const killer = plan.seatOfName(raw.KillerName);
      const victim = plan.seatOfName(raw.VictimName);
      if (!victim) continue;
      const side = killer ? (killer.ours ? 'us' : 'them') : victim.ours ? 'them' : 'us';
      const text = killer
        ? `${killer.champion} kills ${victim.champion}`
        : `${victim.champion} falls to ${killerLabel(raw.KillerName)}`;
      events.push({
        sec,
        kind: 'kill',
        side,
        text,
        ...(killer ? { seat: killer.seat } : {}),
        victimSeat: victim.seat
      });
      if (victim.ours) ourDeaths.push({ sec, seat: victim.seat, champion: victim.champion, championId: victim.championId ?? '', name: victim.name ?? '' });
      continue;
    }
    if (name === 'DragonKill' || name === 'BaronKill' || name === 'HeraldKill' || name === 'HordeKill') {
      const subType =
        name === 'DragonKill' ? String(raw.DragonType ?? 'dragon').toLowerCase() : name.replace('Kill', '').toLowerCase();
      const label =
        name === 'DragonKill'
          ? `${String(raw.DragonType ?? 'Dragon')} dragon`
          : name === 'BaronKill'
            ? 'Baron'
            : name === 'HeraldKill'
              ? 'Rift Herald'
              : 'Void grubs';
      // No side, no event: a coach reading "to us" on a dragon that was theirs
      // is worse off than one who never sees the line.
      const side = sideOf(raw.KillerName);
      if (!side) continue;
      const text = `${label}${raw?.Stolen === 'True' || raw?.Stolen === true ? ', stolen' : ''}`;
      const event = { sec, kind: 'objective', side, text, subType };
      const spot = plan.seatOfName(raw.KillerName);
      if (spot) event.seat = spot.seat;
      events.push(event);
      // Grubs come in threes and would eat the shots; the three big ones are the picture.
      if (name !== 'HordeKill') objectives.push({ sec, text: `${text} (${side === 'us' ? 'ours' : 'theirs'})` });
      continue;
    }
    if (name === 'TurretKilled' || name === 'InhibKilled') {
      const side = sideOf(raw.KillerName) ?? sideFromStructure(raw.TurretKilled ?? raw.InhibKilled);
      if (!side) continue;
      const event = {
        sec,
        kind: name === 'TurretKilled' ? 'tower' : 'inhibitor',
        side,
        text: name === 'TurretKilled' ? 'Tower down' : 'Inhibitor down'
      };
      const spot = plan.seatOfName(raw.KillerName);
      if (spot) event.seat = spot.seat;
      events.push(event);
      continue;
    }
    if (name === 'FirstBlood' || name === 'FirstBrick') {
      const side = sideOf(raw.Recipient ?? raw.KillerName) ?? sideFromStructure(raw.TurretKilled);
      if (!side) continue;
      events.push({
        sec,
        kind: 'first',
        side,
        text: name === 'FirstBlood' ? 'First blood' : 'First tower',
        subType: name === 'FirstBlood' ? 'blood' : 'tower'
      });
      continue;
    }
    if (name === 'Ace') {
      const side = sideOf(raw.Acer) ?? sideOfTeam(raw.AcingTeam);
      if (!side) continue;
      events.push({ sec, kind: 'ace', side, text: 'Ace' });
      continue;
    }
    if (name === 'GameEnd') {
      endSec = sec;
      // The client says Win or Lose from the spectated player's seat — the one
      // `activePlayer` names — so the winner is only known when that player is
      // one of the ten we placed.
      const watcher = plan.seatOfName(raw.WatcherName ?? watcherName);
      const result = String(raw.Result ?? '').toLowerCase();
      if (watcher && (result === 'win' || result === 'lose')) {
        const watcherWon = result === 'win';
        winner = watcher.ours === watcherWon ? 'us' : 'them';
      }
      continue;
    }
  }

  // The end is one event, written from the winner. When the client will not say
  // who won, no event is written at all rather than one that reads as a result.
  // The run parks ten seconds short of the end (a client that reaches it closes the replay), so the GameEnd event
  // is often never played; the result the analysis already holds for this game stands in rather than no end at all.
  if (!winner && typeof fallbackWin === 'boolean') winner = fallbackWin ? 'us' : 'them';
  // The game ended even when the GameEnd never played (the run parks ten seconds short of it, since a client that
  // reaches the end closes the replay): the end is filed at the length, and the seek clamps the picture to the last
  // second the run may stand on.
  if (endSec <= 0 && fallbackEndSec > 0) endSec = fallbackEndSec;
  if (winner) events.push({ sec: endSec, kind: 'end', side: winner, text: winner === 'us' ? 'We won' : 'They won' });

  events.sort((a, b) => a.sec - b.sec);
  return { events, ourDeaths, objectives, endSec, winner };
}

/**
 * Which seconds are worth a picture: every death of ours first, then the big
 * objectives, then the last frame — cut to the cap in that order, so a long
 * game keeps the deaths. One picture a second; two events sharing a second
 * share the frame.
 */
export function chooseShots(matchId, { ourDeaths, objectives, endSec }, cap) {
  const wanted = [];
  for (const death of ourDeaths) {
    // Our own player is named where the roster gave us one; the champion is
    // what makes a thumbnail recognisable at a glance, so the label carries both.
    const who = death.name ? `${death.name} (${death.champion})` : death.champion;
    // Both spellings of the champion ride along, because the camera is pointed by name and the
    // client knows some champions only by their id ("MissFortune", not "Miss Fortune").
    wanted.push({
      sec: death.sec,
      kind: 'death',
      label: `${who} falls at ${mmss(death.sec)}`,
      seat: death.seat,
      champion: death.champion,
      ...(death.championId ? { championId: death.championId } : {})
    });
  }
  for (const objective of objectives) {
    wanted.push({ sec: objective.sec, kind: 'objective', label: `${objective.text} at ${mmss(objective.sec)}` });
  }
  if (endSec > 0) wanted.push({ sec: endSec, kind: 'end', label: `Game end at ${mmss(endSec)}` });

  const seen = new Set();
  const kept = [];
  for (const shot of wanted) {
    if (kept.length >= cap) break;
    if (seen.has(shot.sec)) continue;
    seen.add(shot.sec);
    kept.push({ ...shot, docId: shotDocId(matchId, shot.sec) });
  }
  return kept.sort((a, b) => a.sec - b.sec);
}

/**
 * A JPEG's own size, read off its start-of-frame marker. Optional in the
 * stored shape, so anything unexpected leaves the two fields off rather than
 * guessing.
 */
export function jpegSize(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buffer.length) {
    if (buffer[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buffer[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + buffer.readUInt16BE(i + 2);
  }
  return null;
}

/** The service account, as JSON or as a path to a file holding it. Its contents are never printed. */
export function parseServiceAccount(raw, fs = fsDefault) {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set. Put the service account JSON in it, or a path to the file, or run with --dry-run.');
  const text = value.startsWith('{') ? value : fs.existsSync(value) ? fs.readFileSync(value, 'utf8') : '';
  if (!text) throw new Error('FIREBASE_SERVICE_ACCOUNT is neither JSON nor a path to a readable file.');
  try {
    // Trimmed, because PowerShell writes a UTF-8 BOM by default on this
    // machine and JSON.parse refuses one — with a message that (rightly)
    // cannot quote the value that would explain it (11 Sep 2026).
    return JSON.parse(text.trim());
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT did not parse as JSON. (Its contents are never printed.)');
  }
}

/**
 * The whole run, with its doors open: `fetchImpl` stands in for the client,
 * `fs` for the disk, `firestore` for the three readers
 * ({ players(), game(), set() }), so the dry run can drive it with fakes.
 * Returns the documents it wrote.
 */
export async function run({
  matchId: rawMatchId,
  shots: shotCap = DEFAULT_SHOTS,
  // How many of a moment's rendered frames to keep, on the moments that get a strip at all.
  frames: frameWant = SHOT_FRAMES,
  clipSeconds: clipWant = CLIP_LEAD_SEC,
  clipFps: clipFpsWant = CLIP_FPS,
  outDir = process.cwd(),
  dryRun = false,
  noHealthBars = false,
  streamerMode = true,
  follow = false,
  followChampion = '',
  roster = null,
  fetchImpl,
  fs = fsDefault,
  firestore = null,
  now = () => new Date(),
  log = console.log,
  sleep = realSleep,
  // Seventy tries at 150ms is ten and a half seconds, and a seek that jumps
  // thirty-five minutes backwards on a cold disk needs most of them (the old
  // six were not enough, and an unsettled seek used to be stored anyway).
  settleTries = 70,
  settleWaitMs = 150,
  // A picture is now nine seconds of replay rendered at one frame a second, so the client is busy
  // for ten seconds or so before the sequence is even finished; sixty tries at 250ms used to be
  // fifteen seconds, which the run-up would have timed out on every time.
  shotTries = 160,
  shotWaitMs = 250,
  sequenceStill = 8,
  // Which poll of a render reads the selection back. Only a test moves it: a fake client writes
  // its whole sequence at once, so the real default would never be reached there.
  cameraCheckAt = CAMERA_CHECK_POLL
}) {
  // Normalised here as well as in parseArgs, because run() is called directly
  // by the spec and by any future caller, and the id becomes a Firestore
  // document id that every reader looks up exactly.
  const matchId = normaliseMatchId(rawMatchId);
  if (!isReplayId(matchId)) throw new Error(badIdMessage(rawMatchId));
  const cap = Math.max(1, Math.min(MAX_SHOTS, Math.floor(shotCap)));
  // Normalised here as well as in parseArgs, for the same reason the cap is: run() is called
  // directly by the spec and by any future caller.
  const frameCap = Math.max(1, Math.min(SHOT_FRAMES, Math.floor(number(frameWant) || SHOT_FRAMES)));
  const clipLead = Math.max(1, Math.min(180, Math.floor(number(clipWant) || CLIP_LEAD_SEC)));
  const clipFps = Math.max(5, Math.min(60, Math.floor(number(clipFpsWant) || CLIP_FPS)));
  const call = makeCall({ fetchImpl: fetchImpl ?? clientFetch(), sleep });

  // 1. The replay itself. The client only serves these while one is playing,
  //    so a failure here is almost always "the replay is not up yet".
  const game = await call('/replay/game', {
    help: `${CLIENT_HELP} Open the replay for ${matchId} and let it start playing, then run this again.`
  });
  // The client on this machine (patch 26.17, 11 Sep 2026) answers /replay/game
  // with the process id alone and keeps the length on /replay/playback, so the
  // second endpoint stands in rather than the run stopping on a client version.
  let gameLength = Math.round(number(game?.gameLength));
  if (gameLength <= 0) {
    const playback = await call('/replay/playback', { help: `${CLIENT_HELP} Open the replay for ${matchId} and let it start playing, then run this again.` });
    gameLength = Math.round(number(playback?.length));
  }
  if (gameLength <= 0) {
    throw new Error(`Neither /replay/game nor /replay/playback gave the replay's length. ${CLIENT_HELP}`);
  }
  log(`Replay is up: ${mmss(gameLength)} long.`);

  // 1b. Is it the right replay? Nothing in /replay/game says which game it is,
  //     so a mistyped id would store one game's minutes and frames under
  //     another game's review — and a team recording several scrims in an
  //     evening is recording several games with the same five players, which
  //     the "not one of ours" check below cannot tell apart. The length can
  //     (11 Sep 2026).
  const known = firestore?.game ? await firestore.game(matchId).catch(() => null) : null;
  const knownSec = Math.round(number(known?.durationSec));
  if (knownSec > 0) {
    log(`  ${matchId} is ${mmss(knownSec)} long in the analysis; the replay playing is ${mmss(gameLength)}.`);
    if (Math.abs(knownSec - gameLength) > DURATION_TOLERANCE_SEC) {
      throw new Error(
        `The replay playing is ${mmss(gameLength)} long but ${matchId} is ${mmss(knownSec)} — is the right replay open? Nothing in the client says which game a replay is, so recording this one would store it under the wrong game.`
      );
    }
  }

  /**
   * Waits for the client to land on a seek, and says whether it did. An
   * unsettled seek is no reading at all (11 Sep 2026): the sample or the
   * picture is skipped and counted rather than stored, because the run parks
   * the client at the end of the game first, so the reading a stuck client
   * hands back is the FINAL scoreboard under a minute's heading. The seek is
   * re-posted once half way through, since the client drops one now and then.
   */
  const settle = async (target, repost) => {
    for (let i = 0; i < settleTries; i += 1) {
      const playback = await call('/replay/playback');
      const at = number(playback?.time);
      // The last second is its own case: a client asked for the very end stops
      // a beat short of it and would never come within the tolerance.
      const landed = Math.abs(at - target) < 2 || (target >= gameLength && at >= gameLength - 3);
      if (playback?.seeking !== true && landed) return true;
      if (i === Math.floor(settleTries / 2) && repost) await repost();
      await sleep(settleWaitMs);
    }
    log(`  the client did not settle on ${mmss(target)} in time; nothing is read there.`);
    return false;
  };
  // Never the last second itself (11 Sep 2026, the first live run): this client ends the replay when the
  // playhead reaches the end, closes the window and takes the API with it, which killed a run mid-seek.
  const END_MARGIN_SEC = 10;
  const lastSafeSec = Math.max(0, gameLength - END_MARGIN_SEC);

  /** `{ target, settled }`: the second asked for, and whether the client is actually showing it. */
  const seek = async (sec) => {
    const target = Math.max(0, Math.min(lastSafeSec, Math.round(sec)));
    const post = () => call('/replay/playback', { method: 'POST', body: { time: target, paused: true } });
    await post();
    return { target, settled: await settle(target, post) };
  };

  // 2. Play it through once: the client fires its events as the playhead passes them, and a seek
  //    passes nothing. Then park at the end for the final scoreboard.
  log(`  playing the game through at ${PLAY_THROUGH_SPEED}x to collect the events (about ${Math.ceil(gameLength / PLAY_THROUGH_SPEED / 60)} min)...`);
  try {
    await call('/replay/playback', { method: 'POST', body: { time: 0, paused: false, speed: PLAY_THROUGH_SPEED } });
    const until = Date.now() + PLAY_THROUGH_MAX_MS;
    let last = -1;
    while (Date.now() < until) {
      await sleep(2000);
      const where = await call('/replay/playback').catch(() => null);
      const at = Math.round(number(where?.time));
      if (at >= lastSafeSec - 5) break;
      // A playhead that has not moved in two polls is a replay that stopped; the events it has are what there is.
      if (at === last) break;
      if (Math.floor(at / 300) !== Math.floor(last / 300)) log(`    played to ${mmss(at)}`);
      last = at;
    }
  } catch (err) {
    log(`  the play-through stopped early (${messageOf(err)}); the events may be short.`);
  }
  await call('/replay/playback', { method: 'POST', body: { speed: 1, paused: true } }).catch(() => null);

  const atEnd = await seek(lastSafeSec);
  if (!atEnd.settled) log('  the client never reached the end of the replay, so the event list may stop short of it.');
  const finalData = await call('/liveclientdata/allgamedata');
  const allPlayers = Array.isArray(finalData?.allPlayers) ? finalData.allPlayers : [];
  if (allPlayers.length < 2) {
    throw new Error(`The Live Client answered with ${allPlayers.length} players. ${CLIENT_HELP}`);
  }

  // 3. Our five, by the roster's Riot ids.
  const rosterPlayers = roster ?? (firestore ? await firestore.players() : []);
  const plan = seatPlan(allPlayers, rosterPlayers);
  for (const player of plan.missing) {
    log(`  ${player?.name ?? 'a roster player'} is not in this replay; carrying on without their seat.`);
  }
  if (plan.matchedCount < 3) {
    throw new Error(
      `Only ${plan.matchedCount} of our roster are in this replay, so it is probably not one of ours. Check the Riot ids on the Roster page against the players in the game, or record a different replay.`
    );
  }
  log(`Ours are ${plan.ourSide}: ${plan.matchedCount} of the roster matched, ${plan.seats.length} seats read.`);

  // Resolved here, before the thirty-six seeks, so `--follow Vhi` costs a sentence rather than five
  // minutes. Null means every picture follows its own victim, which is the default.
  // Naming somebody IS asking to follow them: `--follow jungle` turns it on at the command line, and
  // a caller that passes only `followChampion` plainly means the same thing. One rule, both doors.
  const following = follow || Boolean(followChampion);
  const pinned = following && followChampion ? pinnedChampion(followChampion, allPlayers, plan) : null;
  if (pinned) {
    log(`  every picture will follow ${pinned.seat ? `our ${pinned.seat}, ${pinned.champion}` : pinned.champion}, so each frame carries their HUD rather than the victim's.`);
  }

  const eventData = await call('/liveclientdata/eventdata');
  const rawEvents = Array.isArray(eventData?.Events) ? eventData.Events : [];
  const read = readEvents(rawEvents, plan, liveName(finalData?.activePlayer), typeof known?.win === 'boolean' ? known.win : null, gameLength);
  if (!read.winner) log('  the client did not say who won, so the recording carries no end event.');

  // The panels stay up only if streamer mode is really on, and this is where that is established
  // rather than assumed (11 Sep 2026). A client that is not hiding the names gets the panels turned
  // off instead — the frames lose the gold and the items, which is a real loss, and a good deal
  // cheaper than uploading their Riot ids to a review.
  let panelsUp = streamerMode;
  if (streamerMode) {
    const hidden = streamerModeOn(rawEvents, allPlayers);
    if (hidden === false) {
      panelsUp = false;
      log("  this client is NOT in streamer mode — its events name players rather than champions — so the panels that would print their Riot ids are turned off for this run, and the frames lose the gold, the items and the event bar with them.");
    } else if (hidden === null) {
      panelsUp = false;
      log('  the client named nobody in its event list, so streamer mode could not be confirmed; the panels that print Riot ids are turned off for this run.');
    }
  }

  // 4. A minute at a time. The client has to seek for each one, which is why
  //    this is the slow half of the run and says where it has got to. A minute
  //    the client would not land on is left out: the samples are a list, not
  //    one per minute, so a gap is legal and honest, and a reading taken off a
  //    stuck client is the end-of-game scoreboard under a minute's heading.
  const minutes = Math.floor(gameLength / 60);
  const samples = [];
  let unread = 0;
  for (let minute = 1; minute <= minutes; minute += 1) {
    const at = await seek(minute * 60);
    if (!at.settled) {
      unread += 1;
      log(`  minute ${minute} was not read; the client never landed on it.`);
      continue;
    }
    const data = await call('/liveclientdata/allgamedata');
    samples.push(sampleFrom(minute, Array.isArray(data?.allPlayers) ? data.allPlayers : [], plan));
    if (minute === 1 || minute === minutes || minute % 5 === 0) log(`  minute ${minute} of ${minutes}`);
  }

  // 4b. The board at each death of ours. A seek and a read each, no pictures: what all ten were
  //     holding, who was already down and for how long. The frames can only show one player's HUD
  //     and only eight of them ever reach a review; this reaches every death and every seat.
  const deathStates = [];
  const wanted = read.ourDeaths.slice(0, MAX_DEATH_STATES);
  if (wanted.length) {
    log(`  reading the board at ${wanted.length} death${wanted.length === 1 ? '' : 's'} of ours...`);
    for (const death of wanted) {
      // Two seconds before, the same second a picture of it is taken from, so the two agree: at the
      // death itself the victim is already a corpse and the fight is over.
      const at = await seek(Math.max(0, death.sec - 2));
      if (!at.settled) continue;
      const data = await call('/liveclientdata/allgamedata').catch(() => null);
      const ten = Array.isArray(data?.allPlayers) ? data.allPlayers : [];
      if (ten.length) deathStates.push(deathStateFrom(death.sec, death.seat, ten, plan));
    }
    log(`  the board was read at ${deathStates.length} of them.`);
  }

  // 5. The pictures. What a frame shows first (11 Sep 2026): the replay's own
  //    interface is whatever the lead left it as, and normally that includes
  //    the scoreboard and the kill callouts, which print the other team's Riot
  //    ids. `RENDER_FLAGS` turns those off and the minimap on; a naming panel
  //    the client will not confirm as off means no pictures at all this run.
  const chosen = chooseShots(matchId, read, cap);
  const shotsDir = path.resolve(outDir);
  if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
  // Which moments get the strip: the first `STRIP_MOMENTS` deaths, which are exactly the frames
  // `shotsFor` hands a review (deaths first, in time order), so the film and the model end up
  // looking at the same seconds. Everything else keeps the single picture it always had.
  const stripSeconds = new Set(
    chosen
      .filter((shot) => shot.kind === 'death')
      .slice(0, STRIP_MOMENTS)
      .map((shot) => shot.sec)
  );
  // The run-up document ids a moment ended up with, earliest first, so the index can point at them
  // once the pictures are written.
  const runUpBySec = new Map();
  /** The clip URL per moment, for the moments a review looks at. */
  const clipBySec = new Map();
  // No bucket on a dry run: a dry run touches nothing outside the out-dir, and that includes Storage.
  const clips = dryRun ? null : firestore?.clips ?? null;
  const kept = [];
  let dropped = 0;
  // Run-up frames lost on their own, counted apart from the moments: a moment dropped is a moment
  // the film and the review never see, and a run-up frame dropped is only a shorter strip.
  let runUpDropped = 0;
  let framesOff = '';
  let renderShape = null;
  // The client's own recording object, for the same reason the render one is read: a key it does
  // not carry answers 400 for the whole request, and `framesPerSecond` is the difference between
  // ten PNGs and a hundred and sixty.
  let recordShape = null;
  if (chosen.length) {
    const set = await setRenderFlags({ call, log, noHealthBars, streamerMode: panelsUp });
    framesOff = set.refused;
    renderShape = set.shape;
    if (set.warn) log(`  ${set.warn}`);
    if (!set.refused) recordShape = await call('/replay/recording').catch(() => null);
  }
  // Said once, however many pictures the camera will not take: a line a picture is twenty copies of
  // one sentence, and the lead leaves the run alone for five minutes anyway.
  let cameraSaid = false;
  // Whether this client holds a selection at all. Null until the first picture has asked and read
  // the answer back, because there is no way to find out while the replay is paused — the camera
  // only moves while a render plays (11 Sep 2026, measured).
  let cameraHeld = null;
  if (framesOff) {
    log(`  no pictures this run: ${framesOff}`);
  } else {
    let inARow = 0;
    for (const [i, shot] of chosen.entries()) {
      // Three failures in a row is the client gone (closed, or refusing every
      // render), so the phase stops and whatever landed is still written —
      // the samples and the events are worth storing on their own.
      if (inARow >= 3) {
        log('  three pictures in a row failed, so the rest are given up; the samples and the events are still written.');
        break;
      }
      // Two seconds before the moment, because the frame at the death itself is
      // a grey screen and the fight is already over — and the client renders
      // the range it is GIVEN, not wherever playback is parked, so the render
      // has to name the same second the seek landed on (11 Sep 2026; it used
      // to seek to shot.sec - 2 and render shot.sec, which is every frame the
      // comment says to avoid). `shot.sec` stays the death: the document id,
      // the file's name and the label all name the moment, not the frame.
      const at = Math.max(0, shot.sec - 2);
      // Where the render begins, and therefore where the warm-up has to leave the playhead.
      const runUpFrom = Math.max(0, at - SHOT_LEAD_SEC);
      // The sequence folder is named after the moment's own document, so a frame on disk and the
      // document it became are the same string to read.
      const stem = shotDocId(matchId, shot.sec);
      const file = path.join(shotsDir, stem);
      // A strip only where a review will look. Everywhere else one frame, as before.
      const want = stripSeconds.has(shot.sec) ? frameCap : 1;
      // The moments a review looks at are the moments worth a video, which is the same eight the
      // strip covered — so the reader can watch the fight the model was shown a picture of.
      const wantsClip = stripSeconds.has(shot.sec);
      try {
        // Park BEFORE the run-up, not on the moment: the seconds between here and `runUpFrom` are
        // played at ordinary speed so the client's own director wakes up, and the render then starts
        // from where playback stopped — no backwards seek, so nothing resets it (11 Sep 2026).
        const landed = await seek(Math.max(0, runUpFrom - WARMUP_SEC));
        if (!landed.settled) {
          dropped += 1;
          inARow += 1;
          log(`  the client never landed on ${mmss(at)}, so no picture was taken for ${shot.label}.`);
          continue;
        }
        await warmDirector({ call, sleep });
        // Follow whoever the picture is about (11 Sep 2026): the HUD in the corner belongs to the
        // followed champion alone, so a death's frame is worth twice as much when it is the
        // victim's. The asking happens THROUGH the render, not before it — a seek clears the
        // selection and starting a render clears it again, so the only window in which the camera
        // moves is the one where it is playing. `hold.poll` is handed to the wait below.
        const who = pinned ?? { champion: shot.champion, championId: shot.championId };
        const hold =
          following && who.champion && renderShape && cameraHeld !== false
            ? makeCameraHold({ call, shape: renderShape, champion: who.champion, championId: who.championId, checkAt: cameraCheckAt })
            : null;
        // Every frame this run's stem could match is deleted first, so nothing
        // an earlier run left behind can be picked up and uploaded as if it
        // were fresh — the usual reason to re-run is that the first run's
        // frames were bad, and those were exactly the ones being re-stored.
        // The FOLDER has to go, not just the frames in it (12 Sep 2026). The client treats `path`
        // as a folder and fills it with a numbered sequence — but only when it can make that folder
        // itself. Hand it one that already exists, even an empty one, and it writes a nested
        // `{patch}_{matchId}_NN` inside instead, which is two levels down and nothing was looking
        // there. `clearShotFiles` emptied the folder and left it standing, so the first run of a
        // game rendered fine and every RE-record rendered into a folder no one read: three in a row
        // came back empty, the run gave up, and the index it wrote named no pictures at all.
        try {
          fs.rmSync(file, { recursive: true, force: true });
        } catch {
          // Not fatal: the answer's own path is read below, which covers a folder we could not move.
        }
        const stale = clearShotFiles({ fs, dir: shotsDir, stem });
        // png or webm are the only codecs this client's AVContainer takes, and a png "path" is a
        // FOLDER it fills with a numbered sequence (11 Sep 2026, measured). The frame is picked out
        // of it below and turned into a jpeg, because a 1920x1080 png is about 2 MB and a document
        // holds 1 MiB — this client ignores the width and height asked for and renders at its own.
        const shotBody = {
          codec: 'png',
          // Where the warm-up left the playhead, so the render asks for no seek of its own; the LAST
          // frame of the sequence is the one kept.
          startTime: runUpFrom,
          endTime: at + 1,
          path: file,
          recording: true,
          replaySpeed: 1,
          width: 1280,
          height: 720
        };
        if (typeof recordShape?.framesPerSecond === 'number' && typeof recordShape?.enforceFrameRate === 'boolean') {
          shotBody.framesPerSecond = SHOT_FPS;
          shotBody.enforceFrameRate = true;
        }
        const answer = await call('/replay/recording', {
          method: 'POST',
          body: shotBody,
          help: 'The client refused to render a frame. Is the replay still open, and can it write to the --out-dir?'
        });
        // The client's own answer, once: which path it actually chose and
        // whether it says it is recording. That one line is the difference
        // between "the client refused" and "the client is still writing".
        if (i === 0) log(`  the client answered the first render with recording=${answer?.recording ?? 'nothing'}, path ${answer?.path ?? '(none)'}.`);
        // Where the client SAYS it wrote beats where it was asked to (12 Sep 2026). It answers with
        // the path it chose, and that is not always the one requested — the nested-folder case
        // above is exactly this. Reading its answer means a client that invents a path of its own
        // is followed rather than waited on in an empty folder until the run gives up.
        const said = typeof answer?.path === 'string' ? answer.path.trim() : '';
        const wrote = said ? path.resolve(said) : file;
        const nested = wrote !== file;
        if (nested && i === 0) log(`  the client chose its own path; following it there instead of ${stem}.`);
        const pngs = await waitForShot({
          fs,
          file: wrote,
          // A path of the client's own is a folder of frames in its own right, so it is read as the
          // directory; otherwise the layout is the usual one, a folder named for the moment.
          dir: nested ? wrote : shotsDir,
          stem: nested ? '' : stem,
          skip: stale,
          tries: shotTries,
          waitMs: shotWaitMs,
          sleep,
          sequenceStill,
          onPoll: hold ? (turn) => hold.poll(turn) : null,
          frames: want,
          // The range the client was asked for, which is the only honest way to work out how far
          // apart two of its frames are: a client that would not take `framesPerSecond` writes at
          // sixty, so "the frame before" is a sixtieth of a second earlier, not a second.
          rangeSec: shotBody.endTime - shotBody.startTime
        });
        // What the camera did, said once for the whole run rather than at every picture.
        if (hold && hold.held !== null && cameraHeld === null) {
          cameraHeld = hold.held;
          cameraSaid = true;
          log(
            cameraHeld
              ? pinned
                ? `  the camera is holding ${hold.name} for every picture.`
                : `  the camera is following whoever each picture is about (${hold.name} here).`
              : `  ${CAMERA_NOT_HELD}`
          );
        }
        // The frames of this moment, oldest first and the moment itself last. One flat file is one
        // frame and reads exactly as it always did.
        const strip = pngs ?? [];
        // THE MOMENT GATES THE STRIP. Its own frame is turned into a jpeg and measured first,
        // because the index points a review and the film at `{matchId}__{sec}` and nothing anywhere
        // reads a run-up frame on its own: uploading two run-up documents for a moment that is not
        // there would be paying Firestore for pictures with no door into them.
        const momentPng = strip.length ? strip[strip.length - 1] : null;
        const bytes = momentPng ? await toJpeg(momentPng, log) : null;
        if (!bytes) {
          dropped += 1;
          inARow += 1;
          log(`  no picture landed for ${shot.label}; carrying on.`);
          // A client that took the request but rendered nothing can be left
          // with its recording flag up, after which every later render is
          // refused too. Clearing it is best effort and never a failure of
          // its own: this shot is already lost either way.
          await call('/replay/recording', { method: 'POST', body: { recording: false } }).catch(() => undefined);
          continue;
        }
        // The ceiling measures the base64, because base64 is what the document
        // actually holds and what the review checks before it reads a frame
        // (`MAX_SHOT_BYTES` in api/src/replay-recording.ts). Measuring the JPEG
        // instead let a 600 KB frame through as 800 KB encoded: this run called it
        // kept, and the review then dropped it with nothing said on screen.
        const data = bytes.toString('base64');
        const size = jpegSize(bytes);
        if (data.length > MAX_SHOT_BYTES) {
          dropped += 1;
          inARow += 1;
          // The frame's real pixel size, so the message says which case this
          // is: the script asks for 1280x720, and a client that honoured it
          // cannot be fixed by changing the client's own resolution.
          const said = size ? `${size.width}x${size.height}` : 'an unreadable size';
          log(
            `  ${shot.label} came back at ${said}, ${Math.round(bytes.length / 1024)} KB, ${Math.round(data.length / 1024)} KB encoded, over the ${Math.round(MAX_SHOT_BYTES / 1024)} KB a document can hold — dropped. The render asked for 1280x720; this client ignored that, so run it at 1920x1080 or smaller and record again.`
          );
          continue;
        }
        // THE CLIP, where this moment is one a review looks at (12 Sep 2026).
        //
        // The client renders webm natively, so the fight can be watched rather than stepped
        // through. It goes to Cloud Storage and not to Firestore: a nine-second clip is about
        // 2.3 MB against the megabyte a document holds, and Cloud Storage is an eighth the price
        // per byte at rest anyway. Only its URL is stored.
        //
        // It is rendered BEFORE the run-up stills so that a moment which got a clip can skip them
        // entirely — that is the whole saving, and it is why a recorded game is smaller in
        // Firestore with video than it was with pictures. The moment's own still is always kept
        // whatever happens here: a review reads images and cannot watch a video, and the still is
        // the clip's poster frame.
        let clipUrl = '';
        if (wantsClip && clips) {
          try {
            // The clip has its OWN window and its own warm-up. It reaches `clipLead` seconds back —
            // far earlier than the picture's eight — so playback has to be taken there and the
            // director woken again; the picture's warm-up left the playhead at the picture's start,
            // which is already inside the fight this clip wants to open before.
            const clipFrom = Math.max(0, at - clipLead);
            const landedClip = await seek(Math.max(0, clipFrom - WARMUP_SEC));
            if (landedClip.settled) {
              await warmDirector({ call, sleep });
            }
            const file = await renderClip({
              call,
              sleep,
              fs,
              dir: shotsDir,
              matchId,
              sec: shot.sec,
              from: clipFrom,
              to: at + 1,
              fps: clipFps,
              // A clip is rendered by PLAYING the game through, so a forty-five second one takes
              // forty-five seconds; the wait has to cover that and then some, or the run gives up on
              // a render that was going to land.
              tries: Math.ceil(((at + 1 - clipFrom) * 1000) / shotWaitMs) + 60,
              waitMs: shotWaitMs
            });
            if (file) {
              clipUrl = await clips.put(file, matchId, shot.sec);
              try {
                fs.rmSync(file, { force: true });
              } catch {
                // A clip we could not tidy is a local file and nothing else; the upload is what counts.
              }
            }
          } catch (err) {
            // A clip is the luxury and the stills are the floor: losing one costs the reader a
            // video and nothing else, so it must never cost the picture or the run.
            log(`  no clip for ${shot.label} (${messageOf(err)}); its pictures are kept instead.`);
          }
          if (clipUrl) clipBySec.set(shot.sec, clipUrl);
        }

        // The run-up, now that the moment is safe — and only where no clip landed, because the clip
        // is what replaces it. Each frame is measured on its own, and one that will not fit
        // shortens the strip rather than costing the moment.
        const runUp = [];
        // Earliest first, which is the order the strip is read in and the order the documents are
        // written in, so a Firestore listing of one moment reads left to right like the film does.
        // The same spacing the picker used, so a frame's name says truthfully how far before the
        // moment it is: with five frames over an eight-second run-up that is 8s, 6s, 4s, 2s, then
        // the moment itself.
        const spread = shotFrameSpread(shotBody.endTime - shotBody.startTime, frameCap);
        for (const [n, png] of (clipUrl ? [] : strip.slice(0, -1)).entries()) {
          // How many seconds before the moment this frame is, which is also what hangs it off the
          // moment's document id.
          const frame = (strip.length - 1 - n) * spread;
          const runUpBytes = await toJpeg(png, log);
          const runUpData = runUpBytes ? runUpBytes.toString('base64') : '';
          if (!runUpData || runUpData.length > MAX_SHOT_BYTES) {
            runUpDropped += 1;
            // Said out loud, because a strip that quietly came back shorter than it should have is
            // exactly the kind of silence this repo has been bitten by before.
            log(`  the frame ${frame}s before ${shot.label} would not fit in a document, so the strip is that much shorter; the moment itself is kept.`);
            continue;
          }
          const runUpSize = jpegSize(runUpBytes);
          kept.push({
            matchId,
            sec: shot.sec,
            kind: shot.kind,
            label: shot.label,
            frame,
            mediaType: 'image/jpeg',
            ...(runUpSize ? { width: runUpSize.width, height: runUpSize.height } : {}),
            bytes: runUpBytes.length,
            data: runUpData
          });
          runUp.push(shotDocId(matchId, shot.sec, frame));
        }
        if (runUp.length) runUpBySec.set(shot.sec, runUp);
        kept.push({
          matchId,
          sec: shot.sec,
          kind: shot.kind,
          label: shot.label,
          mediaType: 'image/jpeg',
          ...(size ? { width: size.width, height: size.height } : {}),
          bytes: bytes.length,
          data
        });
        inARow = 0;
        log(
          `  picture ${i + 1} of ${chosen.length}: ${shot.label} (${Math.round(bytes.length / 1024)} KB${clipUrl ? ', and a clip of the fight' : runUp.length ? `, and ${runUp.length} frame${runUp.length === 1 ? '' : 's'} leading into it` : ''})`
        );
      } catch (err) {
        // One picture failing must not cost the run the thirty-five minutes of
        // samples that took the longest to gather — the client being closed
        // half way through is the likeliest thing to happen during a five
        // minute run. Three in a row is the client gone, so the phase stops
        // and whatever landed is written.
        dropped += 1;
        inARow += 1;
        log(`  ${shot.label} failed (${messageOf(err)}); carrying on.`);
      } finally {
        // The client needs a moment between renders; hammering it makes it drop
        // the next one — which is exactly what the failures used to do, because
        // this wait sat on the success path only.
        await sleep(shotWaitMs);
      }
    }
  }

  const shotIndex = chosen
    .filter((shot) => kept.some((k) => k.sec === shot.sec))
    .map((shot) => ({
      sec: shot.sec,
      kind: shot.kind,
      label: shot.label,
      ...(shot.seat ? { seat: shot.seat } : {}),
      docId: shot.docId,
      // The frames leading into the moment, earliest first — omitted rather than stored empty, so a
      // moment with a single picture is shaped exactly as it was before the strip existed.
      ...(runUpBySec.has(shot.sec) ? { runUp: runUpBySec.get(shot.sec) } : {}),
      ...(clipBySec.has(shot.sec) ? { clip: clipBySec.get(shot.sec) } : {})
    }));

  const recording = {
    matchId,
    recordedAt: now().toISOString(),
    recorderVersion: RECORDER_VERSION,
    durationSec: gameLength,
    ourSide: plan.ourSide,
    seats: plan.seats,
    samples,
    events: read.events,
    // Omitted rather than stored empty, so a document from a run that read none is shaped like one
    // from before this existed.
    ...(deathStates.length ? { deaths: deathStates } : {}),
    shots: shotIndex,
    bytes: 0
  };
  // What this recording costs in Firestore: the index's own JSON and every
  // picture as it is stored, which is base64 — a third larger than the JPEG,
  // so `shot.bytes` (the picture's real size) would understate the bill.
  recording.bytes = JSON.stringify(recording).length + kept.reduce((sum, shot) => sum + shot.data.length, 0);

  // 6. The pictures first, the index last. A run that dies half way then leaves
  //    no index pointing at documents that are not there.
  // In a `finally`, because the lead's replay must come back the way they left it whatever happens
  // here: a Firestore write that throws used to leave the panels moved, the fog off and the camera
  // on whoever died last, with no clue why (11 Sep 2026, from the review).
  try {
    if (dryRun) {
      for (const shot of kept) fs.writeFileSync(path.join(shotsDir, `replay-shot-${shotDocId(shot.matchId, shot.sec, shot.frame)}.json`), JSON.stringify(shot));
      fs.writeFileSync(path.join(shotsDir, `replay-recording-${matchId}.json`), JSON.stringify(recording, null, 2));
      log(`Dry run: wrote ${kept.length + 1} JSON files to ${shotsDir}; Firestore was not touched.`);
    } else {
      if (!firestore) throw new Error('No Firestore to write to. Set FIREBASE_SERVICE_ACCOUNT, or run with --dry-run.');
      for (const shot of kept) await firestore.set('replayShots', shotDocId(shot.matchId, shot.sec, shot.frame), shot);
      await firestore.set('replayRecordings', matchId, recording);
      log(`Wrote replayShots (${kept.length}), then replayRecordings/${matchId}.`);
      // Only now, and never before: until the line above ran, the old recording was still the one
      // being read, and sweeping first would have deleted the pictures it was pointing at. After
      // it, nothing in the app can reach a picture this recording does not name.
      //
      // A failure here never fails the run. The recording is written and correct by this point, and
      // the cost of leaving an orphan is a fraction of a cent a month — where throwing would lose a
      // ten-minute run over housekeeping.
      // NEVER when this run kept nothing (12 Sep 2026, after it destroyed a good recording).
      //
      // A run whose renders all failed writes an index naming no pictures, and sweeping against
      // that index deletes every picture the LAST run wrote — fifty-two of them, in the case that
      // taught this. The reasoning behind the sweep was that a picture the current index does not
      // name is unreachable; that is true, but it is unreachable BECAUSE this index replaced the
      // one that named it, which is an argument for keeping it until a run actually replaces it.
      // A recording with no pictures is the one case where the old ones are strictly better than
      // what we have, so it is the one case that must not sweep.
      if (!kept.length) {
        log('No pictures were kept, so nothing was swept: whatever an earlier recording left is now the only picture of this game there is.');
      } else {
        try {
          const swept = await firestore.sweepShots(matchId, referencedShotIds(recording));
          if (swept) log(`Swept ${swept} picture${swept === 1 ? '' : 's'} an earlier recording of this game left behind.`);
        } catch (err) {
          log(`Could not sweep the pictures of an earlier recording (${messageOf(err)}). The recording itself is written and correct.`);
        }
        // And the clips, under the same rule and for the same reason: a re-record picks its own
        // seconds, so yesterday's clips are named after moments this index does not have and
        // nothing can reach them again. Guarded the same way — a run that rendered no clip at all
        // leaves the old ones alone, because they are then the only video of this game there is.
        if (clipBySec.size && firestore.clips) {
          try {
            const swept = await firestore.clips.sweep(matchId, new Set(clipBySec.values()));
            if (swept) log(`Swept ${swept} clip${swept === 1 ? '' : 's'} an earlier recording of this game left behind.`);
          } catch (err) {
            log(`Could not sweep the clips of an earlier recording (${messageOf(err)}). The recording itself is written and correct.`);
          }
        }
      }
    }
  } finally {
    await restoreRender({ call });
  }

  // The summary says what was NOT read as well as what was: a minute the
  // client never landed on is a gap in the samples, and a run whose pictures
  // were refused wrote none at all. The two ways a frame is lost are counted
  // apart, because they are not the same loss: a moment dropped is a second
  // nobody will ever see, and a run-up frame dropped is only a shorter strip.
  const lost = [
    dropped ? `${dropped} moment${dropped === 1 ? '' : 's'} dropped` : '',
    runUpDropped ? `${runUpDropped} run-up frame${runUpDropped === 1 ? '' : 's'} dropped` : ''
  ]
    .filter(Boolean)
    .join(', ');
  log(
    `Recorded ${matchId}: ${samples.length} minutes sampled${unread ? ` (${unread} not read)` : ''}, ${read.events.length} events, the board at ${deathStates.length} of our deaths, ${kept.length} pictures kept${lost ? ` (${lost})` : ''}${framesOff ? ' (none taken: the client would not hide the panels that name players)' : ''}, ${Math.round(recording.bytes / 1024)} KB.`
  );
  log('Next: press Re-review on the game to write a review that reads the frames.');
  return { recording, shots: kept, dropped, runUpDropped, unread, framesOff };
}

/**
 * What the frame may show, asked of the client once before the first picture
 * (11 Sep 2026). Returns `{ refused, warn }`: `refused` is the sentence that
 * stops the pictures when a panel printing Riot ids is not confirmed off, and
 * `warn` is the softer half — a minimap the client would not turn on, or fog
 * it would not lift, which costs the review its usefulness but breaks no rule.
 *
 * The flags differ across client versions, so the answer is read back rather
 * than assumed: a key the client does not carry counts as not confirmed, which
 * for a naming panel is the same as refused. A frame that might carry their
 * Riot ids must not be stored, and this pass cannot grant an exception to
 * that — CLAUDE.md is where such a decision would have to sit.
 */
/** What the client's interface was before a run touched it, so `restoreRender` can put it back. */
let beforeRender = null;

/**
 * Give the client back the interface the lead was watching with (11 Sep 2026). A run turns panels
 * off, the fog off and the camera onto whoever died; without this the replay is left that way,
 * which is exactly what the lead saw on the first live run. Best effort: a client that has closed
 * is not an error worth a line.
 */
export async function restoreRender({ call }) {
  if (!beforeRender) return;
  const flags = {};
  for (const key of [...NAMING_FLAGS, 'interfaceAll', 'interfaceMinimap', 'healthBarChampions', 'fogOfWar', 'cameraAttached']) {
    if (typeof beforeRender[key] === 'boolean') flags[key] = beforeRender[key];
  }
  // The camera as well as the panels: the run moves the selection at every picture, and a string
  // left behind is the lead coming back to a replay following whoever died last (11 Sep 2026).
  // `cameraMode` is NOT put back, because it is never changed — sending it at all is what took a
  // client down mid-probe, and a key this run does not touch needs no restoring.
  if (typeof beforeRender.selectionName === 'string') flags.selectionName = beforeRender.selectionName;
  beforeRender = null;
  try {
    await call('/replay/render', { method: 'POST', body: flags });
  } catch {
    /* the client closed, or will not take them back: the lead can toggle the panels themselves */
  }
}

export async function setRenderFlags({ call, log, noHealthBars = false, streamerMode = true }) {
  let answer = null;
  try {
    let wanted = noHealthBars ? { ...RENDER_FLAGS, healthBarChampions: false } : RENDER_FLAGS;
    // In streamer mode the panels print champions, not people, so they stay: a frame with the
    // scoreboard, the team frames and the event bar carries the gold, the items and the kills, which
    // is the whole reason a picture goes to the review at all.
    if (streamerMode) {
      wanted = { ...wanted, interfaceScoreboard: true, interfaceFrames: true, interfaceTimeline: true, interfaceScore: true, interfaceAnnounce: true, interfaceKillCallouts: true };
    }
    // The client's own object first: its keys differ by version, and one it does not know answers
    // 400 for the whole POST — on 11 Sep 2026 `selectionName: false` (a string on this client, the
    // followed champion's name) cost a whole run its pictures.
    const current = await call('/replay/render');
    if (current && typeof current === 'object') beforeRender = current;
    const flags = {};
    for (const [key, value] of Object.entries(wanted)) {
      if (current && typeof current === 'object' && typeof current[key] === typeof value) flags[key] = value;
    }
    answer = await call('/replay/render', { method: 'POST', body: flags, help: 'The client would not take the replay interface settings.' });
    // Read it back rather than trusting the POST's echo: some versions answer
    // the request rather than the state.
    answer = (await call('/replay/render')) ?? answer;
  } catch (err) {
    return { refused: `the client would not answer /replay/render (${messageOf(err)}), so a frame could still be showing the panels that print their Riot ids.`, warn: '', shape: null };
  }
  const said = (key) => (answer && typeof answer === 'object' && key in answer ? answer[key] : undefined);
  // A panel this client does not carry at all cannot print a name either, so only the ones it knows are judged.
  // Streamer mode is the lead saying the client itself hides the ids; the panels are then judged by nothing.
  const notOff = streamerMode ? [] : NAMING_FLAGS.filter((key) => said(key) !== undefined && said(key) !== false);
  const missed = ['interfaceAll', 'interfaceMinimap'].filter((key) => said(key) !== true);
  const fog = said('fogOfWar') !== false;
  log(
    streamerMode
      ? `  the replay interface is set: the panels stay up (streamer mode prints champions, not Riot ids), minimap ${said('interfaceMinimap') === true ? 'on' : 'not confirmed'}, fog ${fog ? 'not confirmed off' : 'off'}.`
      : `  the replay interface is set: ${NAMING_FLAGS.length - notOff.length} of ${NAMING_FLAGS.length} naming panels off, minimap ${said('interfaceMinimap') === true ? 'on' : 'not confirmed'}, fog ${fog ? 'not confirmed off' : 'off'}.`
  );
  if (notOff.length) {
    return {
      refused: `the client did not confirm ${notOff.join(', ')} off, and those panels print the other team's Riot ids. The samples and the events are still written; the pictures are not.`,
      warn: '',
      shape: beforeRender
    };
  }
  const soft = [...missed, ...(fog ? ['fogOfWar'] : [])];
  // The object the client reported travels back, so the camera is built out of the keys it carries.
  return { refused: '', warn: soft.length ? `the client did not take ${soft.join(', ')}; the frames may be missing the minimap or half the map, which is most of what the review reads them for.` : '', shape: beforeRender };
}

/**
 * Every frame an earlier run left under this stem, gone before the client is
 * asked for a new one (11 Sep 2026). Without it a re-run could upload the last
 * run's pictures and count them as freshly kept — the exact case a numbered
 * file (`stem.000001.jpg`) used to hit, because the exact path did not exist
 * and so nothing was newer than it. Returns the paths it could NOT remove, so
 * a file the client still holds open is not mistaken for the new frame either.
 */
/**
 * How many seconds of the game a clip covers before the moment it is of.
 *
 * Forty-five, not the eight the strip used, because a fight is not eight seconds long — the lead
 * watched the first clips and said so: "some fights are 45+ longer". The window is the whole
 * approach and the fight, not the instant before the death.
 */
export const CLIP_LEAD_SEC = 45;

/**
 * Frames a second in a clip. Fifteen halves the bytes against thirty and a replay is not a
 * broadcast; `--clip-fps` raises it if a fight reads as choppy.
 */
export const CLIP_FPS = 15;

/**
 * `enforceFrameRate` is NEVER sent true, and that is the whole reason the first clips were wrong
 * (12 Sep 2026).
 *
 * With it true the client drops frames to hit the rate asked for and then tags the container at
 * that rate anyway, so nine seconds of game came back as a 3.5-second video playing three times too
 * fast. Measured, on the same moment: `fps 30 + enforce` gave 2.28 MB and 3.48s; `fps 30, no
 * enforce` gave 5.25 MB and 9.14s; `fps 15, no enforce` gave 3.07 MB and 9.00s. Small AND honest is
 * the last of those, so that is what the run asks for — and it is why the size and the duration
 * have to be checked together, since the cheapest setting was the broken one.
 */
const CLIP_ENFORCE_FRAME_RATE = false;

/**
 * Render one moment as a video and answer where it landed, or '' if nothing did.
 *
 * The same window the strip covered — the run-up and the moment — so a clip and the picture beside
 * it are the same seconds. The director is already warm when this is called: the png render just
 * before it left playback where it wanted, so this asks for no seek of its own.
 */
export async function renderClip({ call, sleep, fs, dir, matchId, sec, from, to, fps = CLIP_FPS, tries = 240, waitMs = 1500 }) {
  const file = path.join(dir, `${shotDocId(matchId, sec)}.webm`);
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Nothing there, which is the usual case.
  }
  await call('/replay/recording', {
    method: 'POST',
    body: { codec: 'webm', startTime: from, endTime: to, path: file, recording: true, replaySpeed: 1, lossless: false, framesPerSecond: fps, enforceFrameRate: CLIP_ENFORCE_FRAME_RATE },
    help: 'The client refused to render a clip.'
  });
  // A webm GROWS while the render runs, so its size has to stop moving before it is uploaded — the
  // same rule the png sequence follows, and for the same reason.
  let last = -1;
  for (let i = 0; i < tries; i += 1) {
    await sleep(waitMs);
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size > 0 && size === last) return file;
    last = size;
  }
  return '';
}

function clearShotFiles({ fs, dir, stem }) {
  const stuck = [];
  for (const full of shotFilesFor({ fs, dir, stem })) {
    try {
      fs.unlinkSync(full);
    } catch {
      stuck.push(full);
    }
  }
  return stuck;
}

/** How many frames the client has written into the sequence folder so far, or -1 when it is not writing one. */
function countShotFrames({ fs, file }) {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isDirectory()) return -1;
    return fs.readdirSync(file).filter((name) => /\.(png|jpe?g)$/i.test(name)).length;
  } catch {
    return -1;
  }
}

/** Every file in the out dir that could be this shot's frame: the exact name and anything the client numbered beside it. */
function shotFilesFor({ fs, dir, stem }) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const flat = names.filter((name) => name.startsWith(stem) && /\.(jpe?g|png)$/i.test(name)).map((name) => path.join(dir, name));
  // And the frames inside the sequence folder the client fills for a png range. They are this
  // shot's too, and clearing only the flat names left a previous run's sequence in place — which
  // matters now that the frame kept is the LAST one, since a shorter range would leave a stale
  // frame sitting past the end of the new one (11 Sep 2026).
  const folder = path.join(dir, stem);
  let inside = [];
  try {
    if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
      inside = fs
        .readdirSync(folder)
        .filter((name) => /\.(jpe?g|png)$/i.test(name))
        .map((name) => path.join(folder, name));
    }
  } catch {
    /* not a folder, or gone under us: the flat names are all there is */
  }
  return [...flat, ...inside];
}

/**
 * The rendered frames, off the disk, oldest first and the moment last. The client writes the files
 * itself and older ones number them or put them beside the path we asked for, so the exact name is
 * tried first and the directory searched second; a file is only read once its size has stopped
 * moving, or half a picture comes back. A file that vanishes or is still locked by the client is a
 * missing picture, never an exception — the whole run used to die on one.
 *
 * `frames` is how many of the sequence to keep; one is what every run did before 12 Sep 2026 and
 * is all a client writing a single flat file can ever give.
 */
async function waitForShot({ fs, file, dir, stem, skip = [], tries, waitMs, sleep, sequenceStill = 8, onPoll = null, frames = 1, rangeSec = 0 }) {
  let lastSize = -1;
  let lastCount = -1;
  let still = 0;
  for (let i = 0; i < tries; i += 1) {
    // The render is playing while this loop turns, and that is the ONLY window in which the
    // replay's camera can be moved, so whoever wants it pointed gets a turn here (11 Sep 2026).
    if (onPoll) await onPoll(i);
    // A sequence GROWS for as long as the render runs, and the frame wanted is its last one, so the
    // count has to stop moving before anything is read — a poll that catches it half way through
    // keeps a frame from the run-up instead of the moment (11 Sep 2026). A client writing a single
    // flat file answers -1 here and is judged on size alone, the way it always was.
    const count = countShotFrames({ fs, file });
    still = count === lastCount ? still + 1 : 0;
    lastCount = count;
    const found = count < 0 || still >= sequenceStill ? findShotFile({ fs, file, dir, stem, skip, frames, rangeSec }) : [];
    if (found.length) {
      // The moment is the last file the client writes, so its size settling is what says the whole
      // sequence is finished — the frames before it were done seconds ago.
      const moment = found[found.length - 1];
      const size = sizeOf(fs, moment);
      if (size > 0 && size === lastSize) {
        try {
          const picture = fs.readFileSync(moment);
          const runUp = [];
          for (const earlier of found.slice(0, -1)) {
            try {
              runUp.push(fs.readFileSync(earlier));
            } catch {
              // A run-up frame the client still has a handle on is one frame off the strip, never a
              // reason to spend the moment's own picture waiting for it.
            }
          }
          return [...runUp, picture];
        } catch {
          // EBUSY/EPERM: the client still has the handle. Wait and try again.
        }
      }
      lastSize = size;
    }
    await sleep(waitMs);
  }
  return null;
}

/**
 * The client renders png (its only still codec), and a 1280x720 png is about 2 MB — a Firestore
 * document holds 1 MiB, and base64 adds a third on top. `sharp` (a dev dependency of the repo root,
 * installed 11 Sep 2026 for exactly this) turns it into a jpeg of a couple of hundred KB with the
 * minimap still readable. Without sharp the png is returned as it is, and the size ceiling drops it
 * with the message that says so.
 */
async function toJpeg(png, log) {
  try {
    const { default: sharp } = await import('sharp');
    return await sharp(png).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  } catch (err) {
    log(`  could not turn the frame into a jpeg (${messageOf(err)}); run npm install at the repo root. Storing the png as it is.`);
    return png;
  }
}

/** A file's size, or -1 for one that is gone or unreadable. */
function sizeOf(fs, full) {
  try {
    return number(fs.statSync(full).size);
  } catch {
    return -1;
  }
}

/** A file's modification time, or -1 for one that is gone under us. */
function mtimeOf(fs, full) {
  try {
    return number(fs.statSync(full).mtimeMs);
  } catch {
    return -1;
  }
}

/**
 * A second's worth of the client's frames, in the frames it actually wrote (12 Sep 2026). The step
 * is MEASURED and never assumed: the run asks for `SHOT_FPS` but only when the client reports both
 * `framesPerSecond` and `enforceFrameRate`, and a client carrying neither writes at sixty, where
 * "the frame before" is a sixtieth of a second earlier and a strip of three would be three frames
 * of one heartbeat. Count over the range the render was given is what the client did, whatever it
 * said it would do.
 *
 * The floor of one is for the client that writes FEWER than a frame a second: a second back is not
 * on disk at all there, so the strip takes the frame before instead, which is the closest honest
 * thing the run has.
 */
function shotFrameStep(count, rangeSec) {
  const frames = number(count);
  const seconds = number(rangeSec);
  if (frames <= 0 || seconds <= 0) return 1;
  return Math.max(1, Math.round(frames / seconds));
}

/**
 * How many SECONDS apart the kept frames are (12 Sep 2026). The render covers `SHOT_LEAD_SEC`
 * seconds of run-up and then the moment, and the strip is spread across the whole of it rather than
 * taken off the end: the seconds that explain a death are the ones where the fight starts, not the
 * three pictures of the death itself that a one-second step gives.
 *
 * The same number names the frames, since a run-up frame's document id is how many seconds before
 * the moment it is — so the picker and the naming cannot disagree about what a strip is.
 */
export function shotFrameSpread(rangeSec, want) {
  // The range is the run-up plus the moment's own second, so the run-up itself is one shorter.
  const runUp = Math.max(0, Math.floor(number(rangeSec)) - 1);
  const frames = Math.max(1, Math.floor(number(want)));
  if (frames <= 1 || runUp <= 0) return 1;
  return Math.max(1, Math.round(runUp / (frames - 1)));
}

/**
 * The frames to keep for one moment, oldest first and the moment last. `frames` is how many are
 * wanted; a sequence too short to reach back that far gives what it has, because a two-frame or
 * one-frame strip is honest and a moment is never worth losing over its run-up.
 */
function findShotFile({ fs, file, dir, stem, skip = [], frames = 1, rangeSec = 0 }) {
  const want = Math.max(1, Math.floor(number(frames) || 1));
  // A png sequence: the client makes `file` a folder and numbers the frames inside it. The LAST is
  // the moment (11 Sep 2026): the range starts `SHOT_LEAD_SEC` before it so the replay's own
  // director has time to swing onto the fight, and the final frame is the moment itself. Taking the
  // first, as this did until the run-up existed, keeps the run-up and nothing else.
  try {
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      const inside = fs
        .readdirSync(file)
        .filter((name) => /\.(png|jpe?g)$/i.test(name))
        .sort();
      if (!inside.length) return [];
      const step = shotFrameStep(inside.length, rangeSec);
      // Seconds between kept frames, so the strip covers the run-up instead of the last two seconds.
      const spread = shotFrameSpread(rangeSec, want);
      const picked = [];
      for (let back = 0; back < want; back += 1) {
        const at = inside.length - 1 - back * spread * step;
        if (at < 0) break;
        // Unshifted, so the list comes back oldest first and ends on the moment.
        picked.unshift(path.join(file, inside[at]));
      }
      return picked;
    }
  } catch {
    /* not a folder, or gone: fall through to the flat names below */
  }
  // Everything matching the stem was deleted before the render, so anything
  // matching now is the frame the client was just asked for — except a file
  // the delete could not remove, which is passed in and left alone. One flat
  // file is one frame: there is no run-up to be had from a client that writes
  // the moment and nothing else.
  const left = new Set(skip);
  if (!left.has(file) && fs.existsSync(file)) return [file];
  const candidates = shotFilesFor({ fs, dir, stem }).filter((full) => !left.has(full));
  const newest = candidates.sort((a, b) => mtimeOf(fs, b) - mtimeOf(fs, a))[0];
  return newest ? [newest] : [];
}

/** Firestore through firebase-admin, which lives in api/node_modules — the same account the e2e runner uses. */
function openFirestore(raw, fs = fsDefault) {
  const requireApi = createRequire(path.join(root, 'api', 'package.json'));
  const { cert, deleteApp, getApps, initializeApp } = requireApi('firebase-admin/app');
  const { getFirestore } = requireApi('firebase-admin/firestore');
  const { getStorage } = requireApi('firebase-admin/storage');
  const account = parseServiceAccount(raw, fs);
  const app = getApps().find((a) => a.name === 'replay-recorder') ?? initializeApp({ credential: cert(account) }, 'replay-recorder');
  const db = getFirestore(app);
  return {
    players: async () => (await db.collection('players').get()).docs.map((d) => ({ ...d.data(), id: d.id })),
    /** The analysis's own row for this id, for the "is the right replay open?" check. Null when the analysis has never seen it. */
    game: async (matchId) => {
      const analysis = (await db.doc('meta/compAnalysis').get()).data();
      const games = Array.isArray(analysis?.games) ? analysis.games : [];
      return games.find((g) => String(g?.matchId ?? '').toUpperCase() === matchId) ?? null;
    },
    set: async (collection, id, data) => {
      await db.collection(collection).doc(id).set(data);
    },
    /**
     * The clips bucket, `{project}-clips` (12 Sep 2026).
     *
     * A bucket of its own rather than the project's default, and in **us-central1** rather than
     * beside the functions: Google's free allowance for Cloud Storage — 5 GB stored and 100 GB a
     * month downloaded — exists ONLY in us-central1, us-west1 and us-east1, and a season of
     * recordings is under a gigabyte, so the whole feature is free there and about thirty cents a
     * season anywhere else. The clips are frames of our own games with streamer mode on, so there
     * is no personal data and no reason to keep them in Europe.
     */
    clips: {
      put: async (file, matchId, sec) => {
        const bucket = getStorage(app).bucket(`${account.project_id}-clips`);
        const name = `clips/${shotDocId(matchId, sec)}.webm`;
        await bucket.upload(file, {
          destination: name,
          metadata: {
            contentType: 'video/webm',
            // A clip never changes once written — its name carries the match and the second — so it
            // is cached for a year and the browser fetches it once however often the film is opened.
            cacheControl: 'public, max-age=31536000, immutable'
          }
        });
        await bucket.file(name).makePublic();
        return `https://storage.googleapis.com/${bucket.name}/${name}`;
      },
      /**
       * Delete every clip of this game the new recording does not name — the sweep that
       * `replayShots` gets, for the bucket. Without it a re-record leaves the old clips paid for
       * forever, which is the same leak the pictures had.
       */
      sweep: async (matchId, keep) => {
        const bucket = getStorage(app).bucket(`${account.project_id}-clips`);
        const [files] = await bucket.getFiles({ prefix: `clips/${matchId}__` });
        const doomed = files.filter((f) => !keep.has(`https://storage.googleapis.com/${bucket.name}/${f.name}`));
        for (const f of doomed) await f.delete().catch(() => undefined);
        return doomed.length;
      }
    },
    /**
     * Delete every picture of this game the new recording does not name, and answer how many went.
     *
     * Found by the `matchId` field, which every shot document carries, and then guarded by the id's
     * own `{matchId}__` prefix so a field that ever disagreed with its id could not reach another
     * game's pictures. `.select()` asks for no fields at all: a picture is up to 700 KB of base64
     * and none of it needs to cross the wire to learn its id.
     */
    sweepShots: async (matchId, keep) => {
      const snap = await db.collection('replayShots').where('matchId', '==', matchId).select().get();
      const doomed = snap.docs.filter((d) => !keep.has(d.id) && d.id.startsWith(`${matchId}__`));
      // Firestore takes 500 writes to a batch; 400 leaves room and the loop costs nothing.
      for (let i = 0; i < doomed.length; i += 400) {
        const batch = db.batch();
        for (const doc of doomed.slice(i, i + 400)) batch.delete(doc.ref);
        await batch.commit();
      }
      return doomed.length;
    },
    // Firestore holds an open gRPC channel, so without this the shell never
    // comes back after the last line and a hang looks exactly like a success.
    // The house pattern, from scripts/dev-timeline.mjs.
    close: async () => {
      await db.terminate();
      await deleteApp(app);
    }
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(messageOf(err));
    process.exitCode = 1;
    return;
  }
  if (!args.matchId) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  // Said here as well as in run(), so a typo is answered before anything asks
  // for a service account it does not need yet.
  if (!isReplayId(args.matchId)) {
    console.error(badIdMessage(args.typed));
    process.exitCode = 1;
    return;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
  if (!raw && !args.dryRun) {
    console.error('FIREBASE_SERVICE_ACCOUNT is not set. Put the service account JSON in it, or a path to the file, or run with --dry-run.');
    process.exitCode = 1;
    return;
  }
  let roster = null;
  if (args.roster) {
    // Named and trimmed: a roster written in PowerShell carries a UTF-8 BOM,
    // which JSON.parse refuses, and the raw SyntaxError said neither which
    // file nor why (11 Sep 2026).
    const file = path.resolve(args.roster);
    try {
      roster = JSON.parse(fsDefault.readFileSync(file, 'utf8').trim());
    } catch (err) {
      console.error(`${file} did not read as JSON: ${messageOf(err)}`);
      process.exitCode = 1;
      return;
    }
  }
  if (!raw && !roster) {
    console.error('A dry run with no service account has no roster to match our five against. Set FIREBASE_SERVICE_ACCOUNT, or pass --roster <file.json> holding [{ "name": "...", "role": "Mid", "profile": { "riotTag": "EUW" } }].');
    process.exitCode = 1;
    return;
  }
  // Ctrl-C, or a shell closing under it (11 Sep 2026, the lead: "the board is not showing any more,
  // I had to tick the scoreboard check box"). A run that dies half way used to leave the replay with
  // the fog off and the panels wherever it had put them — and the NEXT run then reads that as "what
  // the lead had" and faithfully restores it, so one interrupted run degrades every run after it.
  // `beforeRender` is module state, so this reaches the very object the run captured.
  const signalCall = makeCall({ fetchImpl: clientFetch() });
  const onSignal = () => {
    console.log('\nInterrupted. Giving the client its interface back before going.');
    restoreRender({ call: signalCall })
      .catch(() => undefined)
      .finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const firestore = raw ? openFirestore(raw) : null;
  try {
    await run({
      matchId: args.matchId,
      shots: args.shots,
      frames: args.frames,
      clipSeconds: args.clipSeconds,
      clipFps: args.clipFps,
      outDir: args.outDir || path.join(process.cwd(), 'replay-shots'),
      dryRun: args.dryRun,
      noHealthBars: args.noHealthBars,
      streamerMode: args.streamerMode,
      follow: args.follow,
      followChampion: args.followChampion,
      roster,
      firestore,
      fetchImpl: clientFetch()
    });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    // Closed whichever way the run ended, so the shell comes back.
    await firestore?.close?.();
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
const same = process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
if (same) {
  main().catch((err) => {
    console.error(messageOf(err));
    process.exitCode = 1;
  });
}
