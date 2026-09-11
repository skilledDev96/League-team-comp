/**
 * The replay recorder, driven end to end against a fake League client.
 *
 * Why it lives here (10 Sep 2026): `scripts/` is shared by both packages and
 * has no runner of its own, and this is the one suite in the repo that a node
 * spec actually runs in — `cd api && npx vitest run`, which is also the `api`
 * job in CI. The script under test is plain ESM with no dependency beyond
 * node's own modules, so nothing of the functions' build is involved.
 *
 * What it guards: the stored shape (both sides mirror it exactly), Riot's rule
 * that the other team is a champion in a seat and never a name, the shot cap,
 * the over-size drop, that the index is written last, that a silent client
 * fails with a sentence the lead can act on, and that no log line can carry the
 * service account.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  bodyAndHeaders,
  championIdOf,
  chooseShots,
  followBody,
  jpegSize,
  mmss,
  makeCameraHold,
  MAX_DEATH_STATES,
  NAMING_FLAGS,
  normaliseMatchId,
  parseArgs,
  parseServiceAccount,
  pinnedChampion,
  readEvents,
  RENDER_FLAGS,
  run,
  SHOT_FPS,
  SHOT_LEAD_SEC,
  WARMUP_SEC,
  sameChampion,
  seatPlan,
  splitRiotId,
  streamerModeOn
} from '../../scripts/replay-recorder.mjs';

const MATCH_ID = 'EUW1-7977592156';
const GAME_LENGTH = 2112; // 35:12, so thirty-five minutes are sampled.

/** Their side is written like this on purpose: any of these strings in the output is a leak. */
const THEIR_NAMES = ['ShadowFang#KR1', 'Sejuani Main#EUW', 'Orianna Otp#NA1', 'PuuidGuy#EUW', 'LastOne#EUW'];

const OUR_LIVE = [
  { riotId: 'Ruan#EUW', championName: 'Ornn', position: 'TOP', team: 'ORDER' },
  // No position: a custom often leaves this empty, and the roster's role stands in.
  { riotId: 'Tico#EUW', championName: 'Vi', position: '', team: 'ORDER' },
  // An older patch answers with summonerName and no tag at all.
  { summonerName: 'Mikey', championName: 'Ahri', position: 'MIDDLE', team: 'ORDER' },
  { riotId: 'Zed#EUW1', championName: 'Jinx', position: 'BOTTOM', team: 'ORDER' },
  { riotId: 'Kip#EUW', championName: 'Leona', position: 'UTILITY', team: 'ORDER' }
];

const THEIR_LIVE = [
  { riotId: THEIR_NAMES[0], championName: 'Gragas', position: 'TOP', team: 'CHAOS' },
  { riotId: THEIR_NAMES[1], championName: 'Sejuani', position: 'JUNGLE', team: 'CHAOS' },
  { riotId: THEIR_NAMES[2], championName: 'Orianna', position: 'MIDDLE', team: 'CHAOS' },
  { riotId: THEIR_NAMES[3], championName: 'Ezreal', position: '', team: 'CHAOS' },
  { riotId: THEIR_NAMES[4], championName: 'Nautilus', position: 'UTILITY', team: 'CHAOS' }
];

const ROSTER = [
  { id: 'p1', name: 'Ruan', role: 'Top', profile: { riotTag: 'EUW' } },
  { id: 'p2', name: 'Tico', role: 'Jungle', profile: { riotTag: 'EUW' } },
  { id: 'p3', name: 'Mikey', role: 'Mid', profile: { riotTag: 'EUW' } },
  { id: 'p4', name: 'Zed', role: 'ADC', profile: { riotTag: 'EUW1' } },
  { id: 'p5', name: 'Kip', role: 'Support', profile: { riotTag: 'EUW' } },
  // On the bench and not in this replay: reported, and the run carries on.
  { id: 'p6', name: 'Benchy', role: 'Mid', profile: { riotTag: 'EUW' } }
];

const OUR_DEATH_SECONDS = [180, 322, 455, 610, 744, 898, 1020, 1180, 1305, 1466, 1620, 1799];
const OBJECTIVE_SECONDS = { dragonA: 400, herald: 560, dragonB: 900, baron: 1500 };

function livePlayers(minute) {
  const all = [...OUR_LIVE, ...THEIR_LIVE];
  return all.map((player, i) => ({
    ...player,
    // Their jungler is dead through the middle of the game, which is the thing a death of ours most
    // wants to say: who was already down, and for how long.
    isDead: i === 6 && minute > 5 && minute < 20,
    respawnTimer: i === 6 && minute > 5 && minute < 20 ? 14.8125 : 0,
    level: Math.min(18, 1 + Math.floor(minute / 2)),
    // Out of slot order on purpose: the recorder sorts them, and a trinket in slot 6 is a ward.
    items: [
      { displayName: 'Boots', slot: 1, itemID: 1001 },
      { displayName: 'Stealth Ward', slot: 6, itemID: 3340 },
      { displayName: i % 2 ? "Doran's Shield" : "Doran's Blade", slot: 0, itemID: 1054 }
    ],
    runes: { keystone: { displayName: i === 1 ? 'Conqueror' : 'Electrocute' } },
    scores: {
      kills: Math.floor(minute / 7) + (i % 3),
      deaths: Math.floor(minute / 9) + (i % 2),
      assists: Math.floor(minute / 5),
      creepScore: minute * 7 + i,
      wardScore: Math.round(minute * 1.25 * 10) / 10
    },
    summonerSpells: {
      summonerSpellOne: { displayName: 'Flash' },
      summonerSpellTwo: { displayName: i === 1 || i === 6 ? 'Smite' : 'Teleport' }
    },
    team: player.team
  }));
}

function rawEvents() {
  const events = [{ EventID: 0, EventName: 'GameStart', EventTime: 0 }];
  let id = 1;
  for (const [i, sec] of OUR_DEATH_SECONDS.entries()) {
    events.push({
      EventID: id++,
      EventName: 'ChampionKill',
      EventTime: sec,
      KillerName: THEIR_NAMES[i % THEIR_NAMES.length],
      VictimName: (OUR_LIVE[i % OUR_LIVE.length].riotId ?? OUR_LIVE[i % OUR_LIVE.length].summonerName),
      Assisters: []
    });
  }
  // Three of theirs fall too, so a kill of ours is written from our side.
  for (const [i, sec] of [260, 700, 1400].entries()) {
    events.push({
      EventID: id++,
      EventName: 'ChampionKill',
      EventTime: sec,
      KillerName: 'Ruan#EUW',
      VictimName: THEIR_NAMES[i],
      Assisters: []
    });
  }
  // One of ours executed by a turret: the killer is not a player, and its name is not stored.
  events.push({ EventID: id++, EventName: 'ChampionKill', EventTime: 1900, KillerName: 'Turret_T2_L_03_A', VictimName: 'Kip#EUW', Assisters: [] });
  events.push({ EventID: id++, EventName: 'FirstBlood', EventTime: 180, Recipient: THEIR_NAMES[0] });
  events.push({ EventID: id++, EventName: 'FirstBrick', EventTime: 640, KillerName: 'Ruan#EUW' });
  events.push({ EventID: id++, EventName: 'DragonKill', EventTime: OBJECTIVE_SECONDS.dragonA, KillerName: 'Tico#EUW', DragonType: 'Fire', Stolen: 'False' });
  events.push({ EventID: id++, EventName: 'HeraldKill', EventTime: OBJECTIVE_SECONDS.herald, KillerName: THEIR_NAMES[1], Stolen: 'False' });
  events.push({ EventID: id++, EventName: 'DragonKill', EventTime: OBJECTIVE_SECONDS.dragonB, KillerName: THEIR_NAMES[1], DragonType: 'Ocean', Stolen: 'True' });
  events.push({ EventID: id++, EventName: 'BaronKill', EventTime: OBJECTIVE_SECONDS.baron, KillerName: 'Tico#EUW', Stolen: 'False' });
  // Grubs come in threes and would eat the shot budget; they are an event, never a picture.
  events.push({ EventID: id++, EventName: 'HordeKill', EventTime: 500, KillerName: 'Tico#EUW' });
  events.push({ EventID: id++, EventName: 'TurretKilled', EventTime: 640, KillerName: 'Ruan#EUW', TurretKilled: 'Turret_T2_L_03_A' });
  // Minions finish a tower often enough to matter, and the client names no player for it.
  events.push({ EventID: id++, EventName: 'TurretKilled', EventTime: 1750, KillerName: 'Minion_T1_L_Melee', TurretKilled: 'Turret_T2_C_07_A' });
  events.push({ EventID: id++, EventName: 'InhibKilled', EventTime: 1700, KillerName: 'Zed#EUW1', InhibKilled: 'Barracks_T2_L1' });
  events.push({ EventID: id++, EventName: 'Ace', EventTime: 1550, Acer: 'Ruan#EUW', AcingTeam: 'ORDER' });
  events.push({ EventID: id++, EventName: 'GameEnd', EventTime: GAME_LENGTH, Result: 'Win' });
  return events;
}

/** A small but real JPEG head, so the width and height on a stored picture are read, not guessed. */
function fakeJpeg(bytes, width = 1280, height = 720) {
  const buffer = Buffer.alloc(Math.max(64, bytes), 0x20);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer.writeUInt16BE(17, 4);
  buffer[6] = 0x08;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

function fakeFs() {
  const files = new Map();
  const dirs = new Set();
  let clock = 1;
  return {
    files,
    existsSync: (p) => files.has(p) || dirs.has(p),
    mkdirSync: (p) => dirs.add(p),
    writeFileSync: (p, data) => files.set(p, { data: Buffer.isBuffer(data) ? data : Buffer.from(String(data)), mtimeMs: ++clock }),
    unlinkSync: (p) => {
      if (!files.delete(p)) throw new Error(`no such file ${p}`);
    },
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error(`no such file ${p}`);
      return files.get(p).data;
    },
    statSync: (p) => {
      // A png "path" is a FOLDER the client fills with a numbered sequence, so the fake has to be
      // able to say which a path is — the recorder reads the sequence's last frame.
      if (dirs.has(p) && !files.has(p)) return { size: 0, mtimeMs: 0, isDirectory: () => true };
      const file = files.get(p);
      if (!file) throw new Error(`no such file ${p}`);
      return { size: file.data.length, mtimeMs: file.mtimeMs, isDirectory: () => false };
    },
    readdirSync: (dir) =>
      [...files.keys()].filter((p) => path.dirname(p) === dir).map((p) => path.basename(p))
  };
}

/**
 * The client, as far as the recorder can tell. `plan` decides what each
 * recording request does: a normal picture, an over-size one, one the client
 * never writes, and one it numbers beside the path we asked for.
 *
 * `render` is the replay interface the client will admit to (11 Sep 2026):
 * by default it takes every flag the recorder posts, and a test can pin one
 * — `{ interfaceScoreboard: true }` is a client that will not hide the panel
 * printing their Riot ids. `stuck` is a client that never lands on a seek,
 * and `throwOn` a client that dies part way through the pictures.
 */
function fakeClient({ fs, plan = {}, fail = '', render = {}, stuck = false, throwOn = null, cameraMoves = true, repeatEvents = 1 }) {
  const state = { time: 0, seeking: false };
  // The camera keys a real client carries (11 Sep 2026): `selectionName` is the champion being
  // followed — a string, which is what the first live run got a 400 for sending as a boolean — and
  // `cameraAttached` says whether the camera rides them. A test pins `render` to play the client
  // that will not take them: `{ cameraAttached: false }` is a replay in manual camera.
  const rendered = { ...RENDER_FLAGS, selectionName: '', cameraAttached: false, cameraMode: 'top', cameraPosition: { x: 7000, y: 1800, z: 7000 } };
  const calls = [];
  const renders = [];
  // What was actually POSTed to /replay/render, as opposed to what the client reports afterwards:
  // the camera is judged on the request, since the state carries the last selection for ever.
  const renderPosts = [];
  const seeks = [];
  const asked = [];
  const fetchImpl = async (url, init = {}) => {
    const endpoint = url.replace('https://127.0.0.1:2999', '');
    const method = init.method ?? 'GET';
    calls.push(`${method} ${endpoint}`);
    if (fail && endpoint === fail) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const body = init.body ? JSON.parse(init.body) : null;
    const answer = (value) => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) });
    if (endpoint === '/replay/game') return answer({ gameLength: GAME_LENGTH, processID: 4242 });
    if (endpoint === '/replay/render') {
      if (method === 'POST') {
        renderPosts.push({ ...body });
        Object.assign(rendered, body, render);
        // A client whose camera answers: naming a champion puts the camera on them, so two
        // different champions read two different positions. `cameraMoves: false` is the client
        // measured on 11 Sep 2026 — it reports every request as done and shows the same view,
        // which is why the run judges the camera on where it is rather than on what it says.
        if (cameraMoves && body?.selectionName) {
          const seed = [...String(body.selectionName)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
          rendered.cameraPosition = { x: 1000 + seed * 7, y: 1800, z: 1000 + seed * 11 };
        }
      }
      renders.push({ ...rendered });
      return answer({ ...rendered, ...render });
    }
    if (endpoint === '/replay/playback') {
      if (method === 'POST') {
        // A playback POST that carries no `time` is the warm-up telling the client to play or to
        // stop, not a seek: it must not move the playhead, and it is not a seek to be counted.
        if (!Number.isFinite(body?.time)) {
          if (typeof body?.paused === 'boolean') state.paused = body.paused;
          return answer({ length: GAME_LENGTH, paused: state.paused !== false, seeking: false, speed: 1, time: state.time });
        }
        seeks.push(body.time);
        // A stuck client takes the request and stays parked at the end of the
        // game, where the run leaves it: the reading it then hands back for
        // minute 1 is the FINAL scoreboard under minute 1's heading.
        state.time = stuck ? GAME_LENGTH : body.time;
        state.seeking = false;
      }
      return answer({ length: GAME_LENGTH, paused: true, seeking: state.seeking, speed: 1, time: state.time });
    }
    if (endpoint === '/liveclientdata/allgamedata') {
      return answer({
        activePlayer: { riotId: 'Ruan#EUW', currentGold: 1200 },
        allPlayers: livePlayers(Math.round(state.time / 60)),
        events: { Events: rawEvents().filter((e) => e.EventTime <= state.time) },
        gameData: { gameMode: 'CLASSIC', gameTime: state.time, mapName: 'Map11', mapNumber: 11, mapTerrain: 'Default' }
      });
    }
    if (endpoint === '/liveclientdata/eventdata') {
      const list = rawEvents().filter((e) => e.EventTime <= state.time);
      return answer({ Events: Array.from({ length: repeatEvents }, () => list).flat() });
    }
    // The client's own recording object, read before the first picture the way the render object
    // is: `framesPerSecond` defaults to 60 here as it does on the real client, and the run only
    // sends a key the client has admitted to carrying.
    if (endpoint === '/replay/recording' && method === 'GET') {
      return answer({ codec: 'png', enforceFrameRate: false, framesPerSecond: 60, height: 1080, width: 1920, recording: false, replaySpeed: 1.0 });
    }
    if (endpoint === '/replay/recording' && method === 'POST') {
      // The stop the run sends after a render that produced nothing: no path,
      // no range, and nothing to write.
      if (body.recording === false) return answer({ recording: false });
      // The range ENDS a second before the moment (the frame at the death itself is a grey recap
      // screen) and starts `SHOT_LEAD_SEC` before that, so the replay's own director has time to
      // swing onto the fight. The plan — which reads as the moments the recorder chose — is looked
      // up on the moment, so it is read off the end of the range, not the start.
      const moment = body.endTime + 1;
      asked.push({
        startTime: body.startTime,
        endTime: body.endTime,
        path: body.path,
        framesPerSecond: body.framesPerSecond,
        enforceFrameRate: body.enforceFrameRate
      });
      if (throwOn === moment) throw new Error('the client went away');
      const how = plan[moment] ?? 'normal';
      if (how === 'normal') fs.writeFileSync(body.path, fakeJpeg(4096));
      if (how === 'huge') fs.writeFileSync(body.path, fakeJpeg(800 * 1024, 2560, 1440));
      // Under the ceiling as a JPEG, over it once encoded: 600 KB becomes 800 KB of base64.
      if (how === 'wide') fs.writeFileSync(body.path, fakeJpeg(600 * 1024));
      if (how === 'numbered') fs.writeFileSync(body.path.replace(/\.jpg$/, '.000001.jpg'), fakeJpeg(4096));
      // What the real client does with a png range: a folder of numbered frames, one a second. Each
      // is a different size here, so which one the run kept is visible in the stored bytes.
      if (how === 'sequence') {
        fs.mkdirSync(body.path);
        for (const [i, size] of SEQUENCE_SIZES.entries()) fs.writeFileSync(path.join(body.path, `${String(i).padStart(6, '0')}.png`), fakeJpeg(size));
      }
      // 'missing' writes nothing at all: the client swallowed the request.
      return answer({ ...body, recording: false });
    }
    return answer({});
  };
  return { fetchImpl, calls, renders, renderPosts, seeks, asked, state };
}

function fakeFirestore(players = ROSTER, game = { matchId: MATCH_ID, durationSec: GAME_LENGTH, win: true }) {
  const writes = [];
  return {
    writes,
    players: async () => players,
    // The analysis's row for the id, which is how the run tells "the right
    // replay is open" from "some other scrim from the same evening is".
    game: async (id) => (game && game.matchId === id ? game : null),
    set: async (collection, id, data) => {
      writes.push({ collection, id, data });
    }
  };
}

const OUT_DIR = path.join('C:', 'tmp', 'replay-shots');

/** A rendered sequence, run-up first and the moment last; the sizes differ so the kept frame is identifiable. */
const SEQUENCE_SIZES = [2048, 2560, 3072, 3584, 4096, 4608, 5120, 5632, 6144, 6656];

async function record(options = {}) {
  const fs = options.fs ?? fakeFs();
  const client = fakeClient({
    fs,
    plan: options.plan,
    fail: options.fail,
    render: options.render,
    stuck: options.stuck,
    throwOn: options.throwOn,
    cameraMoves: options.cameraMoves ?? true,
    repeatEvents: options.repeatEvents ?? 1
  });
  const firestore = options.firestore ?? fakeFirestore(options.players, 'game' in options ? options.game : undefined);
  const log = [];
  const result = await run({
    matchId: options.matchId ?? MATCH_ID,
    shots: options.shots ?? 20,
    outDir: OUT_DIR,
    dryRun: options.dryRun ?? false,
    ...(options.run ?? {}),
    fetchImpl: client.fetchImpl,
    fs,
    firestore,
    now: () => new Date('2026-09-10T21:00:00.000Z'),
    log: (line) => log.push(String(line)),
    sleep: async () => {},
    settleTries: 3,
    settleWaitMs: 0,
    shotTries: 8,
    shotWaitMs: 0,
    // A fake client writes its whole sequence at once, so one still poll is a finished render here;
    // the real default is eight, because the client writes for as long as the range is long.
    sequenceStill: 1,
    // The fake writes its frame at once, so the wait turns twice; the real check poll is four.
    cameraCheckAt: 1,
    ...(options.roster ? { roster: options.roster } : {})
  });
  return { ...result, fs, firestore, log, calls: client.calls, renders: client.renders, renderPosts: client.renderPosts, seeks: client.seeks, asked: client.asked };
}

const RECORDING_KEYS = [
  'matchId',
  'recordedAt',
  'recorderVersion',
  'durationSec',
  'ourSide',
  'seats',
  'samples',
  'events',
  // What all ten were holding at each death of ours; absent rather than empty when none was read.
  'deaths',
  'shots',
  'bytes'
];

describe('the replay recorder, over a whole game', () => {
  it('writes the stored shape and nothing else', async () => {
    const { recording, shots } = await record({ plan: {} });

    expect(Object.keys(recording).sort()).toEqual([...RECORDING_KEYS].sort());
    expect(recording.matchId).toBe(MATCH_ID);
    expect(recording.recorderVersion).toBe(2);
    expect(recording.recordedAt).toBe('2026-09-10T21:00:00.000Z');
    expect(recording.durationSec).toBe(GAME_LENGTH);
    expect(recording.ourSide).toBe('blue');
    expect(recording.bytes).toBeGreaterThan(0);

    // Ten seats, ours by seat with a name, theirs a champion in a seat.
    expect(recording.seats).toHaveLength(10);
    const ours = recording.seats.filter((s) => s.ours);
    expect(ours.map((s) => s.seat)).toEqual(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    expect(ours.map((s) => s.champion)).toEqual(['Ornn', 'Vi', 'Ahri', 'Jinx', 'Leona']);
    expect(ours.map((s) => s.name)).toEqual(['Ruan', 'Tico', 'Mikey', 'Zed', 'Kip']);
    const theirs = recording.seats.filter((s) => !s.ours);
    expect(theirs.map((s) => s.seat)).toEqual(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    expect(theirs.every((s) => s.name === undefined)).toBe(true);
    for (const seat of recording.seats) {
      // `spells` and `keystone` are fixed for a whole game, so they live here rather than on every
      // death of that seat. Neither is a name.
      expect(Object.keys(seat).every((k) => ['seat', 'champion', 'ours', 'name', 'spells', 'keystone'].includes(k))).toBe(true);
    }

    // One sample a minute, five a side, no name anywhere on them.
    expect(recording.samples).toHaveLength(35);
    expect(recording.samples[0].minute).toBe(1);
    expect(recording.samples.at(-1).minute).toBe(35);
    for (const sample of recording.samples) {
      expect(Object.keys(sample).sort()).toEqual(['minute', 'ours', 'theirs']);
      expect(sample.ours).toHaveLength(5);
      expect(sample.theirs).toHaveLength(5);
      for (const row of [...sample.ours, ...sample.theirs]) {
        expect(Object.keys(row).sort()).toEqual(['assists', 'cs', 'deaths', 'kills', 'level', 'seat', 'wardScore']);
        expect(typeof row.cs).toBe('number');
      }
    }
    // The figures move with the game rather than being copied from one read.
    expect(recording.samples[0].ours[0].cs).toBeLessThan(recording.samples.at(-1).ours[0].cs);

    // The events, in our own words and in time order.
    const kinds = new Set(recording.events.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(['ace', 'end', 'first', 'inhibitor', 'kill', 'objective', 'tower']);
    expect(recording.events.map((e) => e.sec)).toEqual([...recording.events.map((e) => e.sec)].sort((a, b) => a - b));
    for (const event of recording.events) {
      expect(['us', 'them']).toContain(event.side);
      expect(Object.keys(event).every((k) => ['sec', 'kind', 'side', 'text', 'seat', 'victimSeat', 'subType'].includes(k))).toBe(true);
    }
    const end = recording.events.find((e) => e.kind === 'end');
    expect(end).toEqual({ sec: GAME_LENGTH, kind: 'end', side: 'us', text: 'We won' });
    const firstDeath = recording.events.find((e) => e.kind === 'kill' && e.sec === 180);
    expect(firstDeath).toMatchObject({ side: 'them', text: 'Gragas kills Ornn', seat: 'Top', victimSeat: 'Top' });
    // A turret execution keeps the turret's own string out of the document.
    expect(recording.events.find((e) => e.sec === 1900)).toMatchObject({ text: 'Leona falls to a turret', victimSeat: 'Support' });
    // A tower minions finished still knows whose it was, off the structure's own name.
    expect(recording.events.find((e) => e.sec === 1750)).toEqual({ sec: 1750, kind: 'tower', side: 'us', text: 'Tower down' });

    // The index points at the pictures, and every picture is a document.
    expect(recording.shots).toHaveLength(shots.length);
    expect(recording.shots.map((s) => s.docId)).toEqual(shots.map((s) => `${s.matchId}__${s.sec}`));
    for (const shot of recording.shots) {
      expect(Object.keys(shot).every((k) => ['sec', 'kind', 'label', 'seat', 'docId'].includes(k))).toBe(true);
      expect(['death', 'objective', 'end']).toContain(shot.kind);
    }
    // A death names our own player and the champion; an objective names neither side's people.
    expect(recording.shots[0]).toMatchObject({ sec: 180, kind: 'death', seat: 'Top', label: 'Ruan (Ornn) falls at 3:00' });
    expect(recording.shots.find((s) => s.kind === 'objective').label).toBe('Fire dragon (ours) at 6:40');
    for (const shot of shots) {
      expect(Object.keys(shot).sort()).toEqual(['bytes', 'data', 'height', 'kind', 'label', 'matchId', 'mediaType', 'sec', 'width'].sort());
      expect(shot.mediaType).toBe('image/jpeg');
      expect(shot.width).toBe(1280);
      expect(shot.height).toBe(720);
      expect(shot.data.startsWith('data:')).toBe(false);
      expect(Buffer.from(shot.data, 'base64').length).toBe(shot.bytes);
    }
    // Thirteen deaths of ours (twelve to a champion, one to a turret), four
    // objectives and the end, all inside the default cap.
    expect(shots.filter((s) => s.kind === 'death')).toHaveLength(13);
    expect(shots.filter((s) => s.kind === 'objective')).toHaveLength(4);
    expect(shots.filter((s) => s.kind === 'end')).toHaveLength(1);
  });

  it('keeps every name, Riot id and puuid of theirs out of both documents', async () => {
    const { recording, shots } = await record({});
    const json = JSON.stringify({ recording, shots });
    for (const name of THEIR_NAMES) {
      expect(json.includes(name)).toBe(false);
      expect(json.toLowerCase().includes(name.split('#')[0].toLowerCase())).toBe(false);
    }
    expect(json.includes('#')).toBe(false);
    expect(json.toLowerCase().includes('puuid')).toBe(false);
    // Ours are named, which is the whole point of matching the roster.
    expect(json.includes('Ruan')).toBe(true);
  });

  it('reports a roster player who is not in the replay and carries on', async () => {
    const { log } = await record({});
    expect(log.some((line) => line.includes('Benchy') && line.includes('carrying on'))).toBe(true);
  });

  it('holds the shot cap, deaths first', async () => {
    const { recording, shots } = await record({ shots: 6 });
    expect(shots).toHaveLength(6);
    expect(shots.every((s) => s.kind === 'death')).toBe(true);
    expect(shots.map((s) => s.sec)).toEqual(OUR_DEATH_SECONDS.slice(0, 6));
    expect(recording.shots).toHaveLength(6);
  });

  it('drops a picture over the size a document can hold, and says what to do', async () => {
    const over = OUR_DEATH_SECONDS[2];
    const { recording, shots, log } = await record({ plan: { [over]: 'huge' } });
    expect(shots.some((s) => s.sec === over)).toBe(false);
    expect(recording.shots.some((s) => s.sec === over)).toBe(false);
    expect(shots).toHaveLength(17);
    expect(log.some((line) => line.includes('1920x1080'))).toBe(true);
  });

  // The ceiling is on the base64, because base64 is what the document holds and
  // what the review measures before reading a frame. A picture under it as a
  // JPEG but over it encoded used to be stored and counted as kept here, then
  // silently skipped by the review — nothing on screen said why.
  it('drops a picture that only goes over the ceiling once it is base64', async () => {
    const wide = OUR_DEATH_SECONDS[2];
    const { recording, shots, log } = await record({ plan: { [wide]: 'wide' } });
    expect(shots.some((s) => s.sec === wide)).toBe(false);
    expect(recording.shots.some((s) => s.sec === wide)).toBe(false);
    expect(log.some((line) => line.includes('encoded'))).toBe(true);
  });

  // The figure the summary prints is the Firestore bill, so it counts the
  // pictures as stored (base64), not as JPEGs.
  it('counts the recording bytes as the pictures are stored', async () => {
    const { recording, shots } = await record({ plan: {} });
    const encoded = shots.reduce((sum, shot) => sum + shot.data.length, 0);
    expect(recording.bytes).toBe(JSON.stringify({ ...recording, bytes: 0 }).length + encoded);
    expect(encoded).toBeGreaterThan(shots.reduce((sum, shot) => sum + shot.bytes, 0));
  });

  // Riot's rule is about the pixels too (11 Sep 2026). A replay's own
  // interface normally shows the ten-player scoreboard and the kill callouts,
  // which print the other team's Riot ids, and those pixels used to go
  // straight to Anthropic with the review.
  it('sets the replay interface before the first picture: the naming panels off, the minimap on', async () => {
    const { renders, renderPosts, calls } = await record({});
    // Before any render request, so no frame is ever taken with the panels up.
    expect(calls.indexOf('POST /replay/render')).toBeLessThan(calls.indexOf('POST /replay/recording'));
    // And by default the camera is nobody's business but the replay's own (11 Sep 2026): a run that
    // holds a selection keeps the client's Directed Camera countdown reset, so the director never
    // engages and every picture comes back as the same parked view. `--follow` opts back in.
    expect(renderPosts.filter((r) => r.selectionName)).toHaveLength(0);
    // What was POSTED, not what the fake happened to start as — reading the client's own seed
    // object here made this assertion true before the run had done anything at all.
    const set = renderPosts.find((r) => 'interfaceMinimap' in r);
    for (const flag of NAMING_FLAGS) expect(set[flag]).toBe(false);
    expect(set.interfaceMinimap).toBe(true);
    expect(set.interfaceAll).toBe(true);
    expect(set.fogOfWar).toBe(false);
    expect(renders.length).toBeGreaterThan(0);
  });

  // The panels are left up on the strength of streamer mode, and until 11 Sep 2026 nothing checked
  // it — the run announced "streamer mode prints champions, not Riot ids" without ever asking. A
  // client with streamer mode off would have uploaded twenty frames carrying both teams' Riot ids
  // while saying that it had not.
  // The client appends to its event list every time the playhead crosses an event, and a run
  // crosses the same seconds again at every picture. A real 36-minute game came back with 266
  // events of which 108 were distinct — one kill sixteen times over (11 Sep 2026, measured).
  it('takes each event once, however many times the playhead crossed it', async () => {
    // Each pass carries the client's own clock drift: the same kill came back a second later on
    // the next crossing, which an exact-second key let straight through (26 pairs on a real game).
    const drifted = (shift) => rawEvents().map((e) => ({ ...e, EventTime: e.EventTime + shift }));
    const doubled = [...rawEvents(), ...drifted(1), ...drifted(-1)];
    const plan = seatPlan([...OUR_LIVE, ...THEIR_LIVE], ROSTER);
    const once = readEvents(rawEvents(), plan, 'Ruan#EUW');
    const thrice = readEvents(doubled, plan, 'Ruan#EUW');
    expect(thrice.events).toEqual(once.events);
    expect(thrice.ourDeaths).toEqual(once.ourDeaths);
    expect(thrice.objectives).toEqual(once.objectives);
    // And the run itself, whose client repeats its list, stores it once.
    const { recording } = await record({ shots: 1, repeatEvents: 3 });
    const seen = new Set(recording.events.map((e) => `${e.sec}|${e.kind}|${e.text}|${e.side}`));
    expect(seen.size).toBe(recording.events.length);
  });

  // The lead asked whether to run the recorder once per seat to get each champion's HUD. Ability
  // cooldowns are pixels only — /liveclientdata/activeplayer answers 400 in a replay, there being
  // no active player to ask — but the items, the levels, the farm and who was already down are in
  // the per-player list for all ten at once. So one run reads the board at every death instead.
  it('reads what all ten were holding at each death of ours', async () => {
    const { recording } = await record({ shots: 1 });
    // Every death of ours, not just the ones a picture was taken of.
    expect(recording.deaths.length).toBe(Math.min(MAX_DEATH_STATES, OUR_DEATH_SECONDS.length + 1));
    expect(recording.deaths.map((d) => d.sec)).toEqual([...OUR_DEATH_SECONDS, 1900]);

    const first = recording.deaths[0];
    expect(first.seat).toBe('Top');
    expect(first.players).toHaveLength(10);
    // Ours first, then theirs, each in lane order, so the prompt reads like a scoreboard.
    expect(first.players.slice(0, 5).every((p) => p.ours)).toBe(true);
    expect(first.players.slice(5).every((p) => !p.ours)).toBe(true);
    expect(first.players.slice(0, 5).map((p) => p.seat)).toEqual(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    // Items in slot order, by their readable names, the trinket included.
    expect(first.players[0].items).toEqual(["Doran's Blade", 'Boots', 'Stealth Ward']);
    expect(first.players[0].level).toBeGreaterThan(0);

    // Who was already down when we fell, and for how long: their jungler, through the middle game.
    const middle = recording.deaths.find((d) => d.sec > 400 && d.sec < 1100);
    const down = middle.players.filter((p) => p.dead);
    expect(down).toHaveLength(1);
    expect(down[0].ours).toBe(false);
    expect(down[0].respawn).toBeCloseTo(14.8, 1);
    // Absent, never false: an alive player is not a measurement of deadness.
    expect('dead' in middle.players.find((p) => p.ours && p.seat === 'Top')).toBe(false);

    // Riot's rule holds here as everywhere: a seat and a champion, never a name.
    const blob = JSON.stringify(recording.deaths);
    for (const name of THEIR_NAMES) expect(blob).not.toContain(name);
    expect(blob).not.toContain('#');
    expect(blob).not.toContain('Ruan');
  });

  it('keeps the summoners and the keystone on the seat, since neither changes in a game', async () => {
    const { recording } = await record({ shots: 1 });
    const jungle = recording.seats.find((s) => s.ours && s.seat === 'Jungle');
    expect(jungle.spells).toEqual(['Flash', 'Smite']);
    expect(jungle.keystone).toBe('Conqueror');
    const top = recording.seats.find((s) => s.ours && s.seat === 'Top');
    expect(top.spells).toEqual(['Flash', 'Teleport']);
    // Theirs carry them too — a keystone is not a name — and still no name.
    const theirs = recording.seats.filter((s) => !s.ours);
    expect(theirs.every((s) => Array.isArray(s.spells) && s.spells.length === 2)).toBe(true);
    expect(theirs.some((s) => 'name' in s)).toBe(false);
  });

  it('reads streamer mode off the event list, and turns the panels off when it is not on', async () => {
    const players = [
      { riotId: 'Ruan#EUW', championName: 'Ornn' },
      { riotId: 'ShadowFang#KR1', championName: 'Gragas' }
    ];
    // With streamer mode on the client names the champion; without it, the Riot id.
    expect(streamerModeOn([{ EventName: 'ChampionKill', VictimName: 'Ornn' }], players)).toBe(true);
    expect(streamerModeOn([{ EventName: 'ChampionKill', VictimName: 'ShadowFang#KR1' }], players)).toBe(false);
    // A name with a tag is a Riot id whether or not the ten happen to hold it.
    expect(streamerModeOn([{ EventName: 'ChampionKill', VictimName: 'Someone#EUW' }], players)).toBe(false);
    // Nobody named either way is not a yes.
    expect(streamerModeOn([{ EventName: 'DragonKill', KillerName: 'Ornn' }], players)).toBe(null);
    expect(streamerModeOn([], players)).toBe(null);

    // And end to end: this fixture's client names Riot ids, so the run does NOT leave the panels up
    // even though streamerMode is the default, and every naming panel is posted off.
    const { renderPosts, log } = await record({ shots: 1 });
    const set = renderPosts.find((r) => 'interfaceMinimap' in r);
    for (const flag of NAMING_FLAGS) expect(set[flag]).toBe(false);
    expect(log.some((line) => line.includes('NOT in streamer mode'))).toBe(true);
  });

  // The lead: "look into if we can attach the camera to each of our champions like Vi, Akali".
  // It can be done, but only through the render: a seek clears the selection and starting a render
  // clears it again, so a camera pointed BEFORE the render is pointed at nothing. Measured against
  // the real client — re-asserting it while the render played walked the camera onto Nautilus and
  // the frame came back centred on him mid-fight.
  it('holds the camera on the victim through the render, which is the only window it moves in', async () => {
    const { calls, renderPosts, log } = await record({ shots: 3, run: { follow: true } });
    const asking = calls.indexOf('POST /replay/recording');
    const seek = calls.lastIndexOf('POST /replay/playback', asking);
    expect(seek).toBeGreaterThan(-1);
    expect(seek).toBeLessThan(asking);
    // The camera is asked for AFTER the render starts, not before it: every selection POST for the
    // first picture falls between that render request and the one for the next picture.
    const nextAsking = calls.indexOf('POST /replay/recording', asking + 1);
    const held = calls.map((c, i) => [c, i]).filter(([c, i]) => c === 'POST /replay/render' && i > asking && i < nextAsking);
    expect(held.length).toBeGreaterThan(0);
    // Ornn falls first, Vi second, Ahri third, and each picture asks for its own victim.
    const follows = renderPosts.filter((r) => r.selectionName);
    expect(follows[0]).toEqual({ selectionName: 'Ornn', cameraAttached: true });
    expect([...new Set(follows.map((r) => r.selectionName))]).toEqual(['Ornn', 'Vi', 'Ahri']);
    // Said once for the whole run, not at every picture.
    expect(log.filter((line) => line.includes('the camera is following'))).toHaveLength(1);
    // And the lead gets their own camera back at the end: a selection is a string, and the first
    // version of the restore put only the booleans back, so the replay was left on whoever died last.
    const last = renderPosts.at(-1);
    expect(last.selectionName).toBe('');
    expect(last.cameraAttached).toBe(false);
    // `cameraMode` is never sent at all: it is the one key that moved the camera on its own, and it
    // took the client with it (11 Sep 2026). A run that kills the client loses everything it gathered.
    expect(renderPosts.some((r) => 'cameraMode' in r)).toBe(false);
  });

  // A client that will not hold a selection: the frames are still worth taking, they just carry
  // whatever the replay's own camera was showing. Asked once and then left alone — twenty pictures
  // of a camera that will not move is twenty pointless round trips.
  it('stops asking for the camera once the client has shown it will not hold one', async () => {
    const { shots, log, renderPosts } = await record({ shots: 3, render: { selectionName: '' }, run: { follow: true } });
    expect(shots.length).toBeGreaterThan(0);
    const said = log.filter((line) => line.includes('would not keep the camera'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('Directed Camera');
    // Only the first picture asked. Ornn is our top, so the second and third never try.
    expect([...new Set(renderPosts.filter((r) => r.selectionName).map((r) => r.selectionName))]).toEqual(['Ornn']);
  });

  // `--follow Vi`: one seat's HUD on every frame instead of each victim's own — the jungler for
  // pathing and smite, a carry for the cooldowns in the fights they died in.
  it('holds one champion for every picture when --follow names one', async () => {
    // Said as a seat, which is how a lead thinks of it: our jungler is Vi this game.
    const { shots, renderPosts, log } = await record({ shots: 3, run: { followChampion: 'jungle' } });
    expect(shots.length).toBeGreaterThan(0);
    // Every picture asks for Vi, not for Ornn, Vi, Ahri in turn.
    expect([...new Set(renderPosts.filter((r) => r.selectionName).map((r) => r.selectionName))]).toEqual(['Vi']);
    expect(log.some((line) => line.includes('holding Vi for every picture'))).toBe(true);
    // The pictures are still filed under the deaths they are of, whoever the camera is on.
    expect(shots.map((s) => s.sec)).toEqual(OUR_DEATH_SECONDS.slice(0, 3));
    expect(shots[0].label).toContain('Ornn');
  });

  it('takes a seat as readily as a champion, since the seat outlives the draft', () => {
    const ten = [...OUR_LIVE, ...THEIR_LIVE];
    const plan = seatPlan(ten, ROSTER);
    // The lead means "the jungler", and next week that is somebody else. Vi is ours this game.
    expect(pinnedChampion('jungle', ten, plan)).toEqual({ champion: 'Vi', championId: 'Vi', seat: 'Jungle' });
    expect(pinnedChampion('jungler', ten, plan)).toMatchObject({ seat: 'Jungle' });
    expect(pinnedChampion('jg', ten, plan)).toMatchObject({ seat: 'Jungle' });
    expect(pinnedChampion('SUPPORT', ten, plan)).toMatchObject({ champion: 'Leona', seat: 'Support' });
    expect(pinnedChampion('bot', ten, plan)).toMatchObject({ champion: 'Jinx', seat: 'ADC' });
    // A seat only ever resolves to one of OURS: their jungler is a champion in a seat, not a seat.
    expect(pinnedChampion('jungle', ten, plan).champion).not.toBe('Sejuani');
  });

  it('answers a --follow nobody is playing before the run spends five minutes on it', () => {
    const ten = [...OUR_LIVE, ...THEIR_LIVE];
    expect(pinnedChampion('Vi', ten)).toEqual({ champion: 'Vi', championId: 'Vi' });
    // Either spelling, and the id comes back for the client that knows only that one.
    expect(pinnedChampion('miss fortune', [{ championName: 'Miss Fortune', rawChampionName: 'game_character_displayname_MissFortune' }])).toEqual({
      champion: 'Miss Fortune',
      championId: 'MissFortune'
    });
    expect(pinnedChampion('', ten)).toBe(null);
    // The refusal names the ten, which are champions and so may be printed, and the seat words.
    expect(() => pinnedChampion('Vhi', ten)).toThrow(/no seat of ours and nobody playing that champion/);
    expect(() => pinnedChampion('Vhi', ten)).toThrow(/Ornn/);
    expect(() => pinnedChampion('Vhi', ten)).toThrow(/jungle/);
  });

  it('knows a champion by both of its spellings, and asks only for keys the client carries', () => {
    // The engine knows the unit by its id; the client prints the display name beside it.
    expect(championIdOf({ championName: 'Miss Fortune', rawChampionName: 'game_character_displayname_MissFortune' })).toBe('MissFortune');
    expect(championIdOf({ championName: "Kai'Sa" })).toBe('KaiSa');
    expect(championIdOf({})).toBe('');
    expect(sameChampion('Miss Fortune', 'MissFortune')).toBe(true);
    expect(sameChampion('missfortune', 'Miss Fortune')).toBe(true);
    expect(sameChampion('Vi', 'Vex')).toBe(false);
    // Nobody is not a match for nobody: an empty selection is what a client that ignored us reports.
    expect(sameChampion('', '')).toBe(false);
    // A key the client does not carry answers 400 for the whole request, so it is never sent; a
    // client with no selectionName at all cannot be pointed and the run says so once.
    expect(followBody({ selectionName: '', cameraAttached: false }, 'Vi')).toEqual({ selectionName: 'Vi', cameraAttached: true });
    expect(followBody({ selectionName: '' }, 'Vi')).toEqual({ selectionName: 'Vi' });
    expect(followBody({ cameraAttached: false }, 'Vi')).toBe(null);
    expect(followBody({}, 'Vi')).toBe(null);
  });

  it('tries the champion id when the client will not take the printed name', async () => {
    const posts = [];
    // This client knows the unit by its id alone, which is how Riot names it internally.
    const call = async (endpoint, init = {}) => {
      if (init.method === 'POST') {
        posts.push(init.body.selectionName);
        return {};
      }
      return { selectionName: posts.at(-1) === 'MissFortune' ? 'MissFortune' : '' };
    };
    const hold = makeCameraHold({
      call,
      shape: { selectionName: '', cameraAttached: false },
      champion: 'Miss Fortune',
      championId: 'MissFortune',
      checkAt: 0
    });
    // The printed name is asked for and read back as not taken, so the next poll tries the id.
    await hold.poll(0);
    expect(hold.held).toBe(null);
    expect(hold.name).toBe('MissFortune');
    await hold.poll(1);
    expect(hold.held).toBe(true);
    expect(posts).toEqual(['Miss Fortune', 'MissFortune']);
    // Once it is held, the read-back stops: the answer is known and the polls are just re-asserting.
    await hold.poll(2);
    expect(posts).toEqual(['Miss Fortune', 'MissFortune', 'MissFortune']);
  });

  it('gives up on a champion the client will not take under either spelling', async () => {
    const posts = [];
    const call = async (endpoint, init = {}) => {
      if (init.method === 'POST') {
        posts.push(init.body.selectionName);
        return {};
      }
      return { selectionName: '' };
    };
    const hold = makeCameraHold({ call, shape: { selectionName: '' }, champion: 'Miss Fortune', championId: 'MissFortune', checkAt: 0 });
    await hold.poll(0);
    expect(hold.held).toBe(null);
    await hold.poll(1);
    expect(hold.held).toBe(false);
    expect(hold.on).toBe(false);
    // And nothing more is sent once the answer is no.
    const sent = posts.length;
    await hold.poll(2);
    expect(posts).toHaveLength(sent);
  });

  // The range starts eight seconds before the moment so the replay's own director has time to swing
  // onto the fight, which means the FIRST frame of the sequence is the run-up and the last is the
  // picture. Taking the first — which is what the code did when every range was one second long —
  // would now keep a frame of whatever the camera was parked on before the fight started.
  it('keeps the last frame of a rendered sequence, not the first', async () => {
    const first = OUR_DEATH_SECONDS[0];
    const { shots } = await record({ shots: 1, plan: { [first]: 'sequence' } });
    expect(shots).toHaveLength(1);
    expect(shots[0].bytes).toBe(SEQUENCE_SIZES[SEQUENCE_SIZES.length - 1]);
    expect(shots[0].bytes).not.toBe(SEQUENCE_SIZES[0]);
  });

  it('takes no picture at all when the client will not hide a panel that names players', async () => {
    // --hide-panels is the client that is NOT in streamer mode: there a panel that stays up prints Riot ids.
    const { recording, shots, log, calls } = await record({ render: { interfaceScoreboard: true }, run: { streamerMode: false } });
    expect(shots).toHaveLength(0);
    expect(recording.shots).toHaveLength(0);
    expect(calls.some((c) => c === 'POST /replay/recording')).toBe(false);
    expect(log.some((line) => line.includes('interfaceScoreboard') && line.includes('Riot ids'))).toBe(true);
    // The slow half of the run is still worth storing on its own.
    expect(recording.samples).toHaveLength(35);
    expect(recording.events.length).toBeGreaterThan(0);
  });

  // The frame at the death itself is the grey recap screen, which is why the
  // run seeks two seconds earlier — and the client renders the range it is
  // GIVEN, not wherever playback is parked, so the render has to name the same
  // second. The label and the document id stay on the death.
  it('renders the second the seek landed on, not the death itself', async () => {
    const { recording, shots, seeks, asked } = await record({ shots: 2 });
    const wanted = OUR_DEATH_SECONDS.slice(0, 2).map((s) => s - 2);
    // The range ENDS a second after the second the seek landed on, and the frame kept is the last
    // of the sequence — so the picture is a second before the death, never the grey recap screen.
    expect(asked.map((r) => r.endTime - 1)).toEqual(wanted);
    // The playhead is parked WARMUP_SEC before the render's own start and played into it, so the
    // client's director is awake by the time the frames are written. A render that begins with a
    // backwards seek resets that countdown, which is why every picture used to come back as the
    // same patch of map (11 Sep 2026, measured).
    for (const sec of wanted) expect(seeks).toContain(Math.max(0, sec - SHOT_LEAD_SEC - WARMUP_SEC));
    // And it STARTS `SHOT_LEAD_SEC` earlier, which is the only window the replay's own director has
    // to swing onto the fight: a one-second range stored the same parked view at every death of a
    // real run (11 Sep 2026, measured against the client).
    expect(asked.every((r) => r.startTime === Math.max(0, r.endTime - 1 - SHOT_LEAD_SEC))).toBe(true);
    // One frame a second, because the client writes at sixty unless told otherwise, and nine
    // seconds of that is 161 PNGs of 2 MB for one picture.
    expect(asked.every((r) => r.framesPerSecond === SHOT_FPS && r.enforceFrameRate === true)).toBe(true);
    // The moment itself is never sought and never the end of a range.
    for (const sec of OUR_DEATH_SECONDS.slice(0, 2)) expect(asked.some((r) => r.endTime === sec)).toBe(false);
    // The death is still what the picture is filed and labelled as.
    expect(shots[0].sec).toBe(OUR_DEATH_SECONDS[0]);
    expect(recording.shots[0].docId).toBe(`${MATCH_ID}__${OUR_DEATH_SECONDS[0]}`);
    expect(recording.shots[0].label).toContain(mmss(OUR_DEATH_SECONDS[0]));
  });

  // The reason to record a game a second time is usually that the first run's
  // frames were bad — and those were exactly the ones a re-run used to upload
  // again, because the client had numbered the file and the exact path the
  // freshness check watched never existed.
  it('never keeps a frame an earlier run left behind', async () => {
    const first = OUR_DEATH_SECONDS[0];
    const fs = fakeFs();
    fs.writeFileSync(path.join(OUT_DIR, `${MATCH_ID}__${first}.000001.jpg`), fakeJpeg(4096));
    const { shots, dropped, log } = await record({ fs, plan: { [first]: 'missing' } });
    expect(shots.some((s) => s.sec === first)).toBe(false);
    expect(dropped).toBe(1);
    expect(log.some((line) => line.includes('no picture landed'))).toBe(true);
    expect(fs.readdirSync(OUT_DIR).includes(`${MATCH_ID}__${first}.000001.jpg`)).toBe(false);
  });

  // A minute the client never landed on is no reading at all: the run parks it
  // at the end of the game first, so what a stuck client hands back for minute
  // 1 is the final scoreboard, and the review reads that as fact.
  it('stores no sample for a minute the client never landed on, and says how many', async () => {
    const { recording, log } = await record({ stuck: true });
    expect(recording.samples).toHaveLength(0);
    expect(log.some((line) => line.includes('35 not read'))).toBe(true);
    expect(log.some((line) => line.includes('minute 1 was not read'))).toBe(true);
  });

  // One picture failing must not cost the run the thirty-five minutes of
  // samples that took the longest to gather.
  it('keeps the run when the client goes away part way through the pictures', async () => {
    const gone = OUR_DEATH_SECONDS[2];
    const { recording, shots, dropped, log } = await record({ throwOn: gone });
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.some((s) => s.sec === gone)).toBe(false);
    expect(dropped).toBeGreaterThan(0);
    expect(recording.samples).toHaveLength(35);
    expect(log.some((line) => line.includes('went away') && line.includes('carrying on'))).toBe(true);
  });

  it('refuses when the replay playing is not the game it was given', async () => {
    await expect(record({ game: { matchId: MATCH_ID, durationSec: GAME_LENGTH + 600 } })).rejects.toThrow(/is the right replay open/);
  });

  it('records under the id every reader looks up, whatever case it was typed in', async () => {
    const { recording, firestore, shots } = await record({ matchId: 'euw1_7977592156' });
    expect(recording.matchId).toBe(MATCH_ID);
    expect(firestore.writes.at(-1).id).toBe(MATCH_ID);
    for (const shot of shots) expect(shot.matchId).toBe(MATCH_ID);
    for (const ref of recording.shots) expect(ref.docId.startsWith(`${MATCH_ID}__`)).toBe(true);
  });

  it('carries on when the client writes no picture, and finds one it numbered instead', async () => {
    const missing = OUR_DEATH_SECONDS[3];
    const numbered = OUR_DEATH_SECONDS[4];
    const { shots, log } = await record({ plan: { [missing]: 'missing', [numbered]: 'numbered' } });
    expect(shots.some((s) => s.sec === missing)).toBe(false);
    expect(shots.some((s) => s.sec === numbered)).toBe(true);
    expect(log.some((line) => line.includes('no picture landed'))).toBe(true);
  });

  it('writes the pictures first and the index last', async () => {
    const { firestore, shots } = await record({});
    expect(firestore.writes).toHaveLength(shots.length + 1);
    expect(firestore.writes.slice(0, -1).every((w) => w.collection === 'replayShots')).toBe(true);
    const last = firestore.writes.at(-1);
    expect(last.collection).toBe('replayRecordings');
    expect(last.id).toBe(MATCH_ID);
    // Every id the index points at was written before it.
    const written = new Set(firestore.writes.slice(0, -1).map((w) => w.id));
    for (const shot of last.data.shots) expect(written.has(shot.docId)).toBe(true);
  });

  it('touches no Firestore on a dry run and writes the JSON instead', async () => {
    const { firestore, fs, shots } = await record({ dryRun: true });
    expect(firestore.writes).toHaveLength(0);
    const names = fs.readdirSync(OUT_DIR);
    expect(names).toContain(`replay-recording-${MATCH_ID}.json`);
    expect(names.filter((n) => n.startsWith('replay-shot-'))).toHaveLength(shots.length);
    const onDisk = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `replay-recording-${MATCH_ID}.json`)).toString('utf8'));
    expect(onDisk.matchId).toBe(MATCH_ID);
  });

  it('says the summary in one line, and can never print the service account', async () => {
    const secret = '-----BEGIN PRIVATE KEY-----abc123-----END PRIVATE KEY-----';
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ private_key: secret, client_email: 'x@y.iam.gserviceaccount.com' });
    try {
      const { log } = await record({});
      expect(log.some((line) => line.startsWith(`Recorded ${MATCH_ID}: 35 minutes sampled`))).toBe(true);
      expect(log.some((line) => line.includes('Press Re-review') || line.includes('press Re-review'))).toBe(true);
      for (const line of log) {
        expect(line.includes(secret)).toBe(false);
        expect(line.includes('PRIVATE KEY')).toBe(false);
        expect(line.includes('iam.gserviceaccount.com')).toBe(false);
      }
    } finally {
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
    }
  });
});

describe('the recorder refuses clearly', () => {
  it('when the match id is not a replay id, before it touches anything', async () => {
    const never = async () => {
      throw new Error('the client was called');
    };
    await expect(run({ matchId: 'nonsense', fetchImpl: never })).rejects.toThrow(/not a replay id/);
    await expect(run({ matchId: '', fetchImpl: never })).rejects.toThrow(/EUW1-7977592156/);
  });

  it('when an endpoint is not there, naming it and what to check', async () => {
    await expect(record({ fail: '/replay/game' })).rejects.toThrow(/GET \/replay\/game failed/);
    await expect(record({ fail: '/replay/game' })).rejects.toThrow(/Is the League client open/);
  });

  it('when the Live Client will not answer with the players', async () => {
    await expect(record({ fail: '/liveclientdata/allgamedata' })).rejects.toThrow(/GET \/liveclientdata\/allgamedata failed/);
  });

  it('when fewer than three of ours are in the replay', async () => {
    await expect(record({ players: ROSTER.slice(0, 2) })).rejects.toThrow(/probably not one of ours/);
  });

  it('when the service account is neither JSON nor a file, without printing it', () => {
    const value = 'super-secret-not-json';
    try {
      parseServiceAccount(value, { existsSync: () => false, readFileSync: () => '' });
      throw new Error('should have refused');
    } catch (err) {
      expect(err.message).toMatch(/neither JSON nor a path/);
      expect(err.message.includes(value)).toBe(false);
    }
    expect(() => parseServiceAccount('', { existsSync: () => false })).toThrow(/--dry-run/);
  });
});

describe('the pure parts', () => {
  it('reads a Riot id with or without a tag', () => {
    expect(splitRiotId('Ruan#EUW')).toEqual({ name: 'ruan', tag: 'euw' });
    expect(splitRiotId('Mikey')).toEqual({ name: 'mikey', tag: '' });
    expect(splitRiotId(undefined)).toEqual({ name: '', tag: '' });
  });

  it('prefers a tagged match over a bare name', () => {
    const plan = seatPlan(
      [
        { riotId: 'Same#EUW', championName: 'Ornn', position: 'TOP', team: 'ORDER' },
        { riotId: 'Same#NA1', championName: 'Vi', position: 'JUNGLE', team: 'ORDER' },
        { riotId: 'Other#EUW', championName: 'Ahri', position: 'MIDDLE', team: 'ORDER' }
      ],
      [
        { name: 'Same', role: 'Jungle', profile: { riotTag: 'NA1' } },
        { name: 'Other', role: 'Mid', profile: { riotTag: 'EUW' } }
      ]
    );
    const jungle = plan.seats.find((s) => s.seat === 'Jungle');
    expect(jungle).toMatchObject({ champion: 'Vi', name: 'Same', ours: true });
    expect(plan.seats.find((s) => s.seat === 'Top').name).toBeUndefined();
  });

  it('reads our side off where the roster sits', () => {
    const plan = seatPlan(
      [...THEIR_LIVE.map((p) => ({ ...p, team: 'ORDER' })), ...OUR_LIVE.map((p) => ({ ...p, team: 'CHAOS' }))],
      ROSTER
    );
    expect(plan.ourSide).toBe('red');
    expect(plan.matchedCount).toBe(5);
  });

  it('gives a seat to a player the client left without a position', () => {
    const plan = seatPlan([...OUR_LIVE, ...THEIR_LIVE], ROSTER);
    expect(plan.seats.find((s) => s.champion === 'Vi').seat).toBe('Jungle');
    // Theirs has no roster role to fall back on, so the seat left over is the answer.
    expect(plan.seats.find((s) => s.champion === 'Ezreal').seat).toBe('ADC');
  });

  it('drops an event whose side it cannot read rather than guessing one', () => {
    const plan = seatPlan([...OUR_LIVE, ...THEIR_LIVE], ROSTER);
    const read = readEvents(
      [
        { EventName: 'DragonKill', EventTime: 300, KillerName: 'NobodyWeKnow#EUW', DragonType: 'Fire' },
        { EventName: 'Ace', EventTime: 400, Acer: 'NobodyWeKnow#EUW', AcingTeam: 'CHAOS' }
      ],
      plan
    );
    // The dragon goes; the ace stays, because the client named the team itself.
    expect(read.events).toEqual([{ sec: 400, kind: 'ace', side: 'them', text: 'Ace' }]);
    expect(read.objectives).toHaveLength(0);
  });

  it('writes no end event when the client will not say who won', () => {
    const plan = seatPlan([...OUR_LIVE, ...THEIR_LIVE], ROSTER);
    const read = readEvents([{ EventName: 'GameEnd', EventTime: 100, Result: 'Win' }], plan, 'NobodyWeKnow#EUW');
    expect(read.events).toHaveLength(0);
    expect(read.winner).toBe(null);
    expect(read.endSec).toBe(100);
  });

  it('takes one picture a second, deaths before objectives before the end', () => {
    const shots = chooseShots(
      MATCH_ID,
      {
        ourDeaths: [
          { sec: 100, seat: 'Mid', champion: 'Ahri' },
          { sec: 200, seat: 'ADC', champion: 'Jinx' }
        ],
        objectives: [{ sec: 100, text: 'Fire dragon (theirs)' }],
        endSec: 300
      },
      10
    );
    expect(shots.map((s) => s.sec)).toEqual([100, 200, 300]);
    expect(shots[0]).toMatchObject({ kind: 'death', seat: 'Mid', docId: `${MATCH_ID}__100`, label: 'Ahri falls at 1:40' });
    expect(shots.at(-1).kind).toBe('end');
  });

  it('reads a JPEG for its own size and shrugs at anything else', () => {
    expect(jpegSize(fakeJpeg(64, 1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(jpegSize(Buffer.from('not a picture'))).toBe(null);
    expect(jpegSize(null)).toBe(null);
  });

  it('parses the argument line and holds the hard cap', () => {
    expect(parseArgs([MATCH_ID])).toEqual({ matchId: MATCH_ID, typed: MATCH_ID, shots: 20, outDir: '', dryRun: false, roster: '', noHealthBars: false, streamerMode: true, follow: false, followChampion: '' });
    // The camera follows whoever each picture is about unless the lead wants their own seat's HUD on every frame.
    expect(parseArgs([MATCH_ID, '--no-follow']).follow).toBe(false);
    // The bars are on by default (11 Sep 2026); a client that prints summoner names over champions turns them off again.
    expect(parseArgs([MATCH_ID, '--no-health-bars']).noHealthBars).toBe(true);
    // Streamer mode keeps the panels: the client itself prints champions where the Riot ids would be (11 Sep 2026).
    expect(parseArgs([MATCH_ID, '--streamer-mode']).streamerMode).toBe(true);
    // A client that is not in streamer mode: the panels go, and with them the gold and the items.
    expect(parseArgs([MATCH_ID, '--hide-panels']).streamerMode).toBe(false);
    expect(parseArgs([MATCH_ID, '--shots', '8', '--out-dir', 'C:/shots', '--dry-run'])).toEqual({
      matchId: MATCH_ID,
      typed: MATCH_ID,
      shots: 8,
      outDir: 'C:/shots',
      dryRun: true,
      roster: '',
      noHealthBars: false,
      streamerMode: true,
      follow: false,
      followChampion: ''
    });
    expect(parseArgs([MATCH_ID, '--shots=99']).shots).toBe(30);
    expect(() => parseArgs([MATCH_ID, '--shts', '4'])).toThrow(/Unknown option/);
    expect(() => parseArgs([MATCH_ID, '--shots', 'lots'])).toThrow(/wants a number/);
    // An option written without its value used to swallow the next flag, so
    // `--out-dir --dry-run` wrote the frames to a directory called "--dry-run"
    // and uploaded to Firestore for real.
    expect(() => parseArgs([MATCH_ID, '--out-dir', '--dry-run'])).toThrow(/--out-dir wants a value/);
    expect(parseArgs([MATCH_ID, '--dry-run', '--out-dir', 'C:/shots'])).toMatchObject({ dryRun: true, outDir: 'C:/shots' });
  });

  // Firestore ids are case-sensitive and every reader looks this one up
  // exactly — `matchIdFromFilename` in the app ends `.toUpperCase()` — so a
  // lowercase id recorded a whole game into documents nothing would read.
  it('folds a match id to the one spelling every reader uses', () => {
    expect(normaliseMatchId('euw1-7977592156')).toBe(MATCH_ID);
    expect(normaliseMatchId(' EUW1_7977592156 ')).toBe(MATCH_ID);
    expect(parseArgs(['euw1-7977592156']).matchId).toBe(MATCH_ID);
    // A refusal still quotes what the lead actually typed.
    expect(parseArgs(['euw1-7977592156']).typed).toBe('euw1-7977592156');
  });

  // Written by hand, node streams a POST body chunked with no length, which is
  // the shape a small embedded HTTP server is likeliest to refuse — and every
  // seek and every render is a POST.
  it('sends a body with its length, and nothing extra without one', () => {
    const sent = bodyAndHeaders({ body: JSON.stringify({ time: 100, paused: true }), headers: { 'Content-Type': 'application/json' } });
    expect(sent.headers['Content-Length']).toBe(Buffer.byteLength('{"time":100,"paused":true}'));
    expect(sent.headers['Content-Type']).toBe('application/json');
    expect(bodyAndHeaders({}).body).toBe(null);
    expect(bodyAndHeaders({}).headers).toBeUndefined();
  });

  it('reads a service account written with a BOM, as PowerShell writes one', () => {
    const account = { client_email: 'x@y.iam.gserviceaccount.com', private_key: 'k' };
    const text = `\uFEFF${JSON.stringify(account)}`;
    expect(parseServiceAccount('C:/keys/sa.json', { existsSync: () => true, readFileSync: () => text })).toEqual(account);
  });

  it('says a second the way the game does', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(65)).toBe('1:05');
    expect(mmss(2112)).toBe('35:12');
  });
});
