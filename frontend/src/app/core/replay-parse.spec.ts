import { describe, expect, it } from 'vitest';
import { looksLikeFiveOnFive, matchIdFromFilename, parseReplay } from './replay-parse';

/**
 * A replay file in miniature: the "RIOT" magic, some padding standing in for
 * the replay payload, and the metadata object at the end where the real one
 * puts it.
 */
function fakeReplay(rows: Record<string, unknown>[], gameLengthMs = 1_800_000): ArrayBuffer {
  const meta = JSON.stringify({
    gameLength: gameLengthMs,
    lastGameChunkId: 12,
    lastKeyFrameId: 9,
    statsJson: JSON.stringify(rows)
  });
  const head = new TextEncoder().encode('RIOT');
  const filler = new Uint8Array(2048); // stands in for the replay payload
  const tail = new TextEncoder().encode(meta);

  const out = new Uint8Array(head.length + filler.length + tail.length);
  out.set(head, 0);
  out.set(filler, head.length);
  out.set(tail, head.length + filler.length);
  return out.buffer;
}

/** Riot writes every value in statsJson as a string, numbers included. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    RIOT_ID_GAME_NAME: 'Someone',
    RIOT_ID_TAG_LINE: 'EUW',
    SKIN: 'Ahri',
    TEAM: '100',
    WIN: 'Win',
    TEAM_POSITION: 'MIDDLE',
    CHAMPIONS_KILLED: '7',
    NUM_DEATHS: '2',
    ASSISTS: '9',
    GOLD_EARNED: '14200',
    TOTAL_DAMAGE_DEALT_TO_CHAMPIONS: '28400',
    TOTAL_DAMAGE_DEALT_TO_BUILDINGS: '3100',
    TOTAL_DAMAGE_TAKEN: '19000',
    VISION_SCORE: '31',
    MINIONS_KILLED: '180',
    NEUTRAL_MINIONS_KILLED: '12',
    GAME_ENDED_IN_SURRENDER: '0',
    ...over
  };
}

const tenPlayers = () => [
  ...Array.from({ length: 5 }, (_, i) => row({ SKIN: `Blue${i}`, TEAM: '100', WIN: 'Win' })),
  ...Array.from({ length: 5 }, (_, i) => row({ SKIN: `Red${i}`, TEAM: '200', WIN: 'Fail' }))
];

describe('parseReplay', () => {
  it('reads the scoreboard out of a replay', () => {
    const game = parseReplay(fakeReplay(tenPlayers()))!;
    expect(game.players).toHaveLength(10);
    expect(game.durationSec).toBe(1800);
    expect(game.blueWon).toBe(true);
  });

  it('turns Riot\'s stringly-typed numbers into numbers', () => {
    // Every value in statsJson is a string; a scoreboard adding "7" + "2" would
    // report 72 kills.
    const [p] = parseReplay(fakeReplay([row()]))!.players;
    expect(p.kills).toBe(7);
    expect(p.gold).toBe(14200);
    expect(p.cs).toBe(192); // lane minions plus jungle
    expect(typeof p.damage).toBe('number');
  });

  it('reads the result from "Win" / "Fail" rather than a boolean', () => {
    expect(parseReplay(fakeReplay([row({ WIN: 'Win' })]))!.players[0].win).toBe(true);
    expect(parseReplay(fakeReplay([row({ WIN: 'Fail' })]))!.players[0].win).toBe(false);
  });

  it('keeps the Riot ID, which is how a player is matched to the roster', () => {
    const [p] = parseReplay(fakeReplay([row({ RIOT_ID_GAME_NAME: 'MOSS St4mpe', RIOT_ID_TAG_LINE: 'MT7' })]))!.players;
    expect(p.name).toBe('MOSS St4mpe');
    expect(p.tag).toBe('MT7');
  });

  it('survives the braces inside statsJson', () => {
    // statsJson is an escaped string full of braces of its own; anything
    // counting characters without tracking quoting closes the object early.
    const game = parseReplay(fakeReplay([row({ SKIN: 'Ahri' }), row({ SKIN: 'Zed' })]))!;
    expect(game.players.map((p) => p.champion)).toEqual(['Ahri', 'Zed']);
  });

  it('notices a surrender', () => {
    expect(parseReplay(fakeReplay([row({ GAME_ENDED_IN_SURRENDER: '1' })]))!.surrendered).toBe(true);
    expect(parseReplay(fakeReplay([row()]))!.surrendered).toBe(false);
  });

  it('returns nothing rather than throwing for a file that is not a replay', () => {
    // Importing is a drag-and-drop, so a stray file in the folder is ordinary
    // and should skip quietly instead of failing the batch.
    expect(parseReplay(new TextEncoder().encode('not a replay at all').buffer)).toBeNull();
    expect(parseReplay(new Uint8Array(4).buffer)).toBeNull();
  });

  it('returns nothing when the magic is wrong, whatever the extension says', () => {
    const bytes = new Uint8Array(fakeReplay(tenPlayers()));
    bytes.set(new TextEncoder().encode('NOPE'), 0);
    expect(parseReplay(bytes.buffer)).toBeNull();
  });

  it('returns nothing for a replay with no stats block', () => {
    const head = new TextEncoder().encode('RIOT');
    const out = new Uint8Array(1024);
    out.set(head, 0);
    expect(parseReplay(out.buffer)).toBeNull();
  });
});

describe('matchIdFromFilename', () => {
  it('takes the id the client names the file with', () => {
    expect(matchIdFromFilename('EUW1-7967636895.rofl')).toBe('EUW1-7967636895');
  });

  it('is the only stable identity a scrim has, so a rename yields nothing', () => {
    // Without it the same file imported twice becomes two scrims.
    expect(matchIdFromFilename('scrim vs MOSS.rofl')).toBe('');
    expect(matchIdFromFilename('')).toBe('');
  });
});

describe('looksLikeFiveOnFive', () => {
  const game = (players: unknown[], durationSec = 1800) =>
    ({ players, durationSec, blueWon: true, surrendered: false }) as never;
  const p = (team: number, champion = 'Ahri') => ({ team, champion });

  it('accepts five a side', () => {
    const full = [...Array.from({ length: 5 }, () => p(100)), ...Array.from({ length: 5 }, () => p(200))];
    expect(looksLikeFiveOnFive(game(full))).toBe(true);
  });

  it('refuses a lopsided lobby', () => {
    expect(looksLikeFiveOnFive(game([p(100), p(200)]))).toBe(false);
  });

  it('refuses a remake, however full the lobby', () => {
    const full = [...Array.from({ length: 5 }, () => p(100)), ...Array.from({ length: 5 }, () => p(200))];
    expect(looksLikeFiveOnFive(game(full, 200))).toBe(false);
  });

  it('refuses a lobby with a nameless champion', () => {
    const odd = [
      ...Array.from({ length: 4 }, () => p(100)),
      p(100, ''),
      ...Array.from({ length: 5 }, () => p(200))
    ];
    expect(looksLikeFiveOnFive(game(odd))).toBe(false);
  });
});
