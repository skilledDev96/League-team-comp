import { describe, expect, it } from 'vitest';
import { Scrim, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { NO_BAN } from '../pages/tournaments/draft-sequence';
import {
  auditChip,
  auditSeries,
  burnedTip,
  draftOverlap,
  importConfirm,
  importConflicts,
  importRefusal,
  importTarget,
  SeriesFinding
} from './series-audit';

const tournament = (id: string, over: Partial<Tournament> = {}) => ({ id, name: id, kind: 'tournament', order: 0, ...over }) as Tournament;
const series = (id: string, tournamentId: string, opponent: string, bestOf: number, over: Partial<TournamentSeries> = {}) =>
  ({ id, tournamentId, opponent, bestOf, status: 'scheduled', order: 0, ...over }) as TournamentSeries;
const game = (seriesId: string, gameNumber: number, over: Partial<SeriesGame> = {}): SeriesGame => ({
  id: `${seriesId}-g${gameNumber}`,
  seriesId,
  gameNumber,
  order: gameNumber,
  ourChampions: [],
  theirChampions: [],
  ...over
});
const scrim = (id: string, blue: string[], red: string[], over: Partial<Scrim> = {}) =>
  ({
    id,
    playedOn: '2026-09-07T20:10:00.000Z',
    durationSec: 2201,
    blueWon: false,
    players: [...blue.map((champion) => ({ champion, team: 100 })), ...red.map((champion) => ({ champion, team: 200 }))],
    order: 0,
    ...over
  }) as unknown as Scrim;

const kinds = (findings: SeriesFinding[], seriesId: string) => findings.filter((f) => f.seriesId === seriesId).map((f) => f.kind);

// ---- MAD Synergy's Bo3 as it stood before the repair of 14 Sep 2026 ------------------------------
//
// 0–3 over three games, MOSS 2's replay linked as game 1 (the same 36:41 game is MOSS 2 game 2), and
// the file's champions over the draft the room ran: Pantheon theirs in G1 and G2, Malphite theirs in
// G1 and ours in G2. The names are invented; only the shape is the audit's.

const CUP = tournament('cup');
const SCRIMS = tournament('scrims', { kind: 'scrims', fearless: false, order: 1 });
const MAD = series('mad', 'cup', 'MAD Synergy', 3);
const MOSS = series('moss', 'scrims', 'MOSS 2', 0);

const MOSS_REPLAY = 'EUW1-7977500462';
const MOSS_OURS = ['Gnar', 'Viego', 'Orianna', 'Jinx', 'Rell'];
const MOSS_THEIRS = ['Malphite', 'Pantheon', 'Syndra', 'Kalista', 'Alistar'];
/** What the room drafted for MAD Synergy game 1, before the wrong file filled the board. */
const MAD_G1_LOG = ['Mordekaiser', 'Garen', 'Vi', 'JarvanIV', 'Ahri', 'Taliyah', 'Sivir', 'Tristana', 'Nautilus', 'Braum'];

const MAD_GAMES = [
  game('mad', 1, { win: false, matchId: MOSS_REPLAY, ourChampions: MOSS_OURS, theirChampions: MOSS_THEIRS, pickLog: MAD_G1_LOG, ourSide: 'blue' }),
  game('mad', 2, { win: false, matchId: 'EUW1-7980000001', ourChampions: ['Malphite', 'Sejuani', 'Azir', 'Varus', 'Leona'], theirChampions: ['KSante', 'Pantheon', 'Hwei', 'Ezreal', 'Karma'] }),
  game('mad', 3, { win: false, matchId: 'EUW1-7975412766', ourChampions: ['Illaoi', 'Diana', 'Yasuo', 'Jhin', 'Seraphine'], theirChampions: ['Shen', 'Naafiri', 'Veigar', 'Caitlyn', 'Mel'] })
];
const MOSS_GAMES = [
  // Pantheon theirs again in a scrim block: not fearless, so not a repeat.
  game('moss', 1, { win: true, matchId: 'EUW1-7977400000', ourChampions: ['Sion', 'Lillia', 'Ahri', 'Kaisa', 'Lulu'], theirChampions: ['Aatrox', 'Pantheon', 'Zoe', 'Xayah', 'Rakan'] }),
  game('moss', 2, { win: false, matchId: MOSS_REPLAY, ourChampions: MOSS_OURS, theirChampions: MOSS_THEIRS, ourSide: 'blue' })
];
const MAD_SOURCES = {
  tournaments: [CUP, SCRIMS],
  series: [MAD, MOSS],
  seriesGames: [...MAD_GAMES, ...MOSS_GAMES],
  scrims: [scrim(MOSS_REPLAY, MOSS_OURS, MOSS_THEIRS)]
};

describe('auditSeries on MAD Synergy before the repair', () => {
  const findings = auditSeries(MAD_SOURCES);
  const mad = findings.filter((f) => f.seriesId === 'mad');

  it('names both repeats in the opponent and game numbers, on the canonical key', () => {
    const repeats = mad.filter((f) => f.kind === 'repeat');
    expect(repeats.map((f) => f.text)).toEqual([
      'MAD Synergy G1 and G2: Malphite on their side in G1 and ours in G2. Wrong replay?',
      'MAD Synergy G1 and G2: Pantheon on their side twice. Wrong replay?'
    ]);
    expect(repeats.map((f) => [f.champion, f.gameIds])).toEqual([
      ['Malphite', ['mad-g1', 'mad-g2']],
      ['Pantheon', ['mad-g1', 'mad-g2']]
    ]);
  });

  it('flags game 3 as a result after the Bo3 was decided at 0–2', () => {
    const after = mad.find((f) => f.kind === 'afterDecided');
    expect(after?.gameIds).toEqual(['mad-g3']);
    expect(after?.text).toBe('MAD Synergy G3: a result after the Bo3 was already decided at 0–2.');
  });

  it('says the replay is shared with the scrim block, on both series', () => {
    expect(mad.find((f) => f.kind === 'duplicate')?.text).toBe('MAD Synergy G1 and MOSS 2 G2 carry the same replay.');
    const moss = findings.filter((f) => f.seriesId === 'moss');
    expect(moss.map((f) => f.text)).toEqual(['MOSS 2 G2 and MAD Synergy G1 carry the same replay.']);
    expect(moss[0].gameIds).toEqual(['moss-g2', 'mad-g1']);
  });

  it('reads game 1 as a replay that is not the draft the room ran', () => {
    const mismatch = mad.filter((f) => f.kind === 'draftMismatch');
    expect(mismatch.map((f) => f.text)).toEqual(['MAD Synergy G1: the replay shares only 0 of the 10 champions with the draft run in the room. Wrong replay?']);
  });

  it('never names a player, and leaves a non-fearless block its repeats', () => {
    expect(kinds(findings, 'moss')).toEqual(['duplicate']);
    expect(kinds(findings, 'mad')).toEqual(['duplicate', 'draftMismatch', 'repeat', 'repeat', 'afterDecided']);
  });
});

// ---- A clean series: Paradox, won 2–0 with the draft room's logs and their replays ----------------

const PARADOX = series('paradox', 'cup', 'Paradox', 3, { scheduledAt: '2026-09-15' });
const PDX_G1 = { ours: ['Ornn', 'XinZhao', 'Taliyah', 'Ashe', 'Nautilus'], theirs: ['Gragas', 'Wukong', 'Sylas', 'Ezreal', 'Braum'] };
const PDX_G2 = { ours: ['Rumble', 'Vi', 'Orianna', 'Kaisa', 'Rell'], theirs: ['Jax', 'Nidalee', 'Ryze', 'Lucian', 'Milio'] };
const PARADOX_SOURCES = {
  tournaments: [CUP],
  series: [PARADOX],
  seriesGames: [
    game('paradox', 1, { win: true, matchId: 'EUW1-1', ourChampions: PDX_G1.ours, theirChampions: PDX_G1.theirs, pickLog: [...PDX_G1.ours, ...PDX_G1.theirs], bans: [NO_BAN, 'Ahri'] }),
    game('paradox', 2, { win: true, matchId: 'EUW1-2', ourChampions: PDX_G2.ours, theirChampions: PDX_G2.theirs, pickLog: [...PDX_G2.theirs, ...PDX_G2.ours] }),
    // A board the draft room opened for game 3 and nobody played: not a game after the decider.
    game('paradox', 3)
  ],
  scrims: [
    scrim('EUW1-1', PDX_G1.ours, PDX_G1.theirs, { playedOn: '2026-09-15T19:00:00.000Z', durationSec: 1800 }),
    // Riot's ids for the same champions the log wrote by name.
    scrim('EUW1-2', ['Rumble', 'Vi', 'Orianna', "Kai'Sa", 'Rell'], PDX_G2.theirs, { playedOn: '2026-09-15T20:00:00.000Z', durationSec: 1801 })
  ]
};

describe('auditSeries on a clean series', () => {
  it('finds nothing in Paradox', () => {
    expect(auditSeries(PARADOX_SOURCES)).toEqual([]);
  });
});

describe('auditSeries rules one at a time', () => {
  it('matches Wukong and MonkeyKing as one champion and words it through championName', () => {
    const findings = auditSeries({
      tournaments: [CUP],
      series: [series('s', 'cup', 'Team S', 3)],
      seriesGames: [game('s', 1, { theirChampions: ['MonkeyKing'] }), game('s', 2, { ourChampions: ['Wukong'] })],
      scrims: [],
      championName: (c) => (c === 'MonkeyKing' ? 'Wukong' : c)
    });
    expect(findings.map((f) => f.text)).toEqual(['Team S G1 and G2: Wukong on their side in G1 and ours in G2.']);
  });

  it('flags a champion on both sides of one game', () => {
    const findings = auditSeries({
      tournaments: [CUP],
      series: [series('s', 'cup', 'Team S', 1)],
      seriesGames: [game('s', 1, { ourChampions: ['Ahri'], theirChampions: ['Ahri'], matchId: 'EUW1-9' })],
      scrims: []
    });
    expect(findings.map((f) => f.text)).toEqual(['Team S G1: Ahri on both sides. Wrong replay?']);
  });

  it('never counts the ban nobody saw as a champion', () => {
    const findings = auditSeries({
      tournaments: [CUP],
      series: [series('s', 'cup', 'Team S', 3)],
      seriesGames: [game('s', 1, { ourChampions: [NO_BAN, 'Ahri'], theirChampions: [NO_BAN] }), game('s', 2, { ourChampions: [NO_BAN] })],
      scrims: []
    });
    expect(findings).toEqual([]);
  });

  it('flags a fourth game in a Bo3', () => {
    const findings = auditSeries({
      tournaments: [CUP],
      series: [series('s', 'cup', 'Team S', 3)],
      seriesGames: [1, 2, 3, 4].map((n) => game('s', n)),
      scrims: []
    });
    expect(findings.map((f) => [f.kind, f.gameIds, f.text])).toEqual([['overCap', ['s-g4'], 'Team S G4: 4 games in a Bo3.']]);
  });

  it('finds one game filed under two ids by its ten champions and its length', () => {
    const ten = [['Ahri', 'Vi', 'Ornn', 'Jinx', 'Lulu'], ['Zed', 'Lee Sin', 'Garen', 'Caitlyn', 'Morgana']];
    const findings = auditSeries({
      tournaments: [CUP, SCRIMS],
      series: [series('a', 'cup', 'Team A', 3), series('b', 'scrims', 'Team B', 0)],
      seriesGames: [game('a', 1, { matchId: 'EUW1-10' }), game('b', 1, { matchId: 'EUW1-11' })],
      // Sides swapped and Lee Sin spelled as Riot's id: still the same ten.
      scrims: [scrim('EUW1-10', ten[0], ten[1], { durationSec: 2201 }), scrim('EUW1-11', ['Zed', 'LeeSin', 'Garen', 'Caitlyn', 'Morgana'], ten[0], { durationSec: 2203 })]
    });
    expect(findings.map((f) => f.text)).toEqual([
      'Team A G1 and Team B G1 look like one game: the same ten champions, 36:41 long.',
      'Team B G1 and Team A G1 look like one game: the same ten champions, 36:41 long.'
    ]);
  });

  it('does not call two games alike three seconds apart', () => {
    const blue = ['Ahri', 'Vi', 'Ornn', 'Jinx', 'Lulu'];
    const red = ['Zed', 'LeeSin', 'Garen', 'Caitlyn', 'Morgana'];
    const findings = auditSeries({
      tournaments: [SCRIMS],
      series: [series('b', 'scrims', 'Team B', 0)],
      seriesGames: [game('b', 1, { matchId: 'EUW1-10' }), game('b', 2, { matchId: 'EUW1-11' })],
      scrims: [scrim('EUW1-10', blue, red, { durationSec: 2201 }), scrim('EUW1-11', red, blue, { durationSec: 2204 })]
    });
    expect(findings).toEqual([]);
  });

  it('flags a replay file dated days before the series date, only when both are known', () => {
    // playedOn is the file's timestamp: when it was downloaded, never before the game was played.
    const at = (playedOn: string, scheduledAt?: string) =>
      auditSeries({
        tournaments: [CUP],
        series: [series('s', 'cup', 'Team S', 3, scheduledAt ? { scheduledAt } : {})],
        seriesGames: [game('s', 1, { matchId: 'EUW1-5' })],
        scrims: [{ id: 'EUW1-5', playedOn, durationSec: 1800, players: [] }]
      }).map((f) => f.text);
    expect(at('2026-09-01T12:00:00.000Z', '2026-09-08')).toEqual(['Team S G1: the replay file is dated 7 days before the series date. Wrong replay?']);
    expect(at('2026-09-06T12:00:00.000Z', '2026-09-08')).toEqual([]);
    expect(at('2026-09-01T12:00:00.000Z', 'Sat 20:00')).toEqual([]);
    expect(at('2026-09-01T12:00:00.000Z')).toEqual([]);
  });

  it('leaves a correct series whose replays were downloaded days later for review', () => {
    const findings = auditSeries({
      tournaments: [CUP],
      series: [series('s', 'cup', 'Team S', 3, { scheduledAt: '2026-09-08' })],
      seriesGames: [game('s', 1, { matchId: 'EUW1-5' }), game('s', 2, { matchId: 'EUW1-6' }), game('s', 3, { matchId: 'EUW1-7' })],
      scrims: ['EUW1-5', 'EUW1-6', 'EUW1-7'].map((id) => ({ id, playedOn: '2026-09-14T12:00:00.000Z', durationSec: 1800, players: [] }))
    });
    expect(findings).toEqual([]);
  });

  it('says the span when several files are dated before the series', () => {
    const findings = auditSeries({
      tournaments: [CUP],
      series: [series('s', 'cup', 'Team S', 3, { scheduledAt: '2026-09-08' })],
      seriesGames: [game('s', 1, { matchId: 'EUW1-5' }), game('s', 2, { matchId: 'EUW1-6' })],
      scrims: [
        { id: 'EUW1-5', playedOn: '2026-09-01T12:00:00.000Z', durationSec: 1800, players: [] },
        { id: 'EUW1-6', playedOn: '2026-09-03T12:00:00.000Z', durationSec: 1800, players: [] }
      ]
    });
    expect(findings.map((f) => [f.gameIds, f.text])).toEqual([
      [['s-g1', 's-g2'], 'Team S G1 and G2: the replay files are dated 5 to 7 days before the series date. Wrong replay?']
    ]);
  });

  it('skips a sandbox series whole', () => {
    const findings = auditSeries({ ...MAD_SOURCES, series: [{ ...MAD, sandbox: true }, MOSS] });
    expect(kinds(findings, 'mad')).toEqual([]);
    expect(kinds(findings, 'moss')).toEqual([]);
  });
});

describe('draftOverlap', () => {
  it('reads nothing from a log short of a full draft', () => {
    expect(draftOverlap(MAD_G1_LOG.slice(0, 9), MAD_G1_LOG)).toBeNull();
    expect(draftOverlap(undefined, MAD_G1_LOG)).toBeNull();
    expect(draftOverlap(MAD_G1_LOG, [])).toBeNull();
  });

  it('counts the logged champions the replay carries, whatever the spelling', () => {
    expect(draftOverlap(['Jarvan IV', ...MAD_G1_LOG.filter((c) => c !== 'JarvanIV')], MAD_G1_LOG)).toBe(10);
    expect(draftOverlap(MAD_G1_LOG, [...MAD_G1_LOG.slice(0, 8), 'Zed', 'Lux'])).toBe(8);
  });
});

describe('the series head chip', () => {
  it('says the kind in two words, a count when there are several kinds, and every sentence in the tip', () => {
    const findings = auditSeries(MAD_SOURCES).filter((f) => f.seriesId === 'mad');
    expect(auditChip(findings.filter((f) => f.kind === 'repeat'))?.label).toBe('2 repeats');
    expect(auditChip(findings.filter((f) => f.kind === 'afterDecided'))?.label).toBe('Game after decided');
    expect(auditChip(findings.filter((f) => f.kind === 'draftMismatch'))?.label).toBe('Replay mismatch');
    const all = auditChip(findings);
    expect(all?.label).toBe('5 to check');
    expect(all?.tip.split('\n')).toEqual(findings.map((f) => f.text));
    expect(auditChip([])).toBeNull();
  });

  it('tells a burned chip where else its champion went', () => {
    const findings = auditSeries(MAD_SOURCES);
    expect(burnedTip(findings, MAD_GAMES, 'Pantheon')).toBe('Pantheon is also in Game 2. Wrong replay?');
    expect(burnedTip(findings, MAD_GAMES, 'Illaoi')).toBe('');
  });
});

// ---- Before an import --------------------------------------------------------------------------------

describe('importConflicts', () => {
  const base = { series: MAD, tournaments: [CUP, SCRIMS], games: MAD_GAMES };

  it('asks before a game 3 of a Bo3 already lost 0–2', () => {
    const conflicts = importConflicts({ ...base, target: MAD_GAMES[2], replayChampions: [...MAD_GAMES[2].ourChampions, ...MAD_GAMES[2].theirChampions] });
    expect(conflicts.map((c) => c.text)).toEqual(['The Bo3 was already decided at 0–2 before game 3.']);
    expect(importConfirm(conflicts, 3).title).toBe('This series was already decided before game 3');
  });

  it('names a champion an earlier game burned, and the game it burned in', () => {
    const conflicts = importConflicts({ ...base, target: { id: 'mad-g2', gameNumber: 2 }, replayChampions: ['Pantheon', 'Malphite', 'Zed'] });
    expect(conflicts.map((c) => [c.kind, c.text])).toEqual([['burned', 'Pantheon and Malphite were already burned in game 1.']]);
    expect(importRefusal(conflicts)).toBe('Pantheon and Malphite were already burned');
  });

  it('asks once, naming every conflict, when the file is not the draft the room ran', () => {
    const replay = ['Mordekaiser', 'Garen', 'Pantheon', 'Zed', 'Lux', 'Ashe', 'Thresh', 'Sion', 'Lillia', 'Zoe'];
    const target = game('mad', 2, { pickLog: MAD_G1_LOG });
    const conflicts = importConflicts({ ...base, games: [MAD_GAMES[0], target], target, replayChampions: replay });
    expect(importConfirm(conflicts, 2)).toEqual({
      title: "This replay doesn't match game 2's draft",
      body: '8 of the 10 champions differ from the draft you ran. Pantheon was already burned in game 1.',
      confirmLabel: 'Link it anyway'
    });
    expect(importRefusal(conflicts)).toBe("it does not match game 2's draft; Pantheon was already burned");
  });

  it('asks nothing of a replay that fits, a scrim block or a sandbox', () => {
    const [g1, g2] = PARADOX_SOURCES.seriesGames;
    expect(importConflicts({ series: PARADOX, tournaments: [CUP], games: [g1, g2], target: g2, replayChampions: [...PDX_G2.ours, ...PDX_G2.theirs] })).toEqual([]);
    expect(importConflicts({ series: MOSS, tournaments: [CUP, SCRIMS], games: MOSS_GAMES, target: { gameNumber: 3 }, replayChampions: MOSS_THEIRS })).toEqual([]);
    expect(importConflicts({ ...base, series: { ...MAD, sandbox: true }, target: MAD_GAMES[2], replayChampions: ['Pantheon'] })).toEqual([]);
  });
});

describe('importTarget', () => {
  const drafted = game('p', 2, { pickLog: [...PDX_G2.ours, ...PDX_G2.theirs], ourChampions: PDX_G2.ours, theirChampions: PDX_G2.theirs, win: true });
  const empty = game('p', 3);
  const replay = [...PDX_G2.ours, ...PDX_G2.theirs];

  it('lands on the game whose draft the file is, before the first empty slot', () => {
    expect(importTarget([empty, drafted], 'EUW1-2', replay)?.id).toBe('p-g2');
  });

  it('keeps a replay on the game already carrying it, so one series never holds it twice', () => {
    const linked = game('p', 1, { matchId: 'EUW1-2' });
    expect(importTarget([linked, drafted, empty], 'EUW1-2', replay)?.id).toBe('p-g1');
  });

  it('leaves a drafted game whose own replay fits its draft as well, and falls back to the first empty slot', () => {
    expect(importTarget([{ ...drafted, matchId: 'EUW1-other' }, empty], 'EUW1-2', replay)?.id).toBe('p-g3');
    expect(importTarget([drafted], 'EUW1-9', ['Zed', 'Lux'])).toBeUndefined();
  });

  it('takes the best match among the drafts, not the first to clear eight', () => {
    // A scrim block run back with two swaps: game 1's log shares 8 with game 2's file, game 2's all 10.
    const secondLog = [...MOSS_OURS, ...MOSS_THEIRS];
    const firstLog = secondLog.map((c) => (c === 'Gnar' ? 'Sion' : c === 'Syndra' ? 'Zoe' : c));
    const first = game('b', 1, { pickLog: firstLog, ourChampions: firstLog.slice(0, 5), theirChampions: firstLog.slice(5) });
    const second = game('b', 2, { pickLog: secondLog, ourChampions: secondLog.slice(0, 5), theirChampions: secondLog.slice(5) });
    expect(importTarget([first, second], 'EUW1-B2', secondLog)?.id).toBe('b-g2');
    // With game 2 linked to its file, game 1's file still lands on game 1 and not on game 2's 8 of 10.
    expect(importTarget([first, { ...second, matchId: 'EUW1-B2' }], 'EUW1-B1', firstLog)?.id).toBe('b-g1');
    // A tie goes to the lower game.
    expect(importTarget([{ ...second, gameNumber: 3, id: 'b-g3' }, second], 'EUW1-B9', secondLog)?.id).toBe('b-g2');
  });

  it("takes the drafted game holding the wrong replay, and the dialog asks before replacing it", () => {
    // MAD Synergy at 0–1: game 1's board is MOSS 2's file, and the right file is dropped on the series.
    const g1 = MAD_GAMES[0];
    const right = 'EUW1-7970000001';
    const target = importTarget([g1], right, MAD_G1_LOG);
    expect(target?.id).toBe('mad-g1');
    const conflicts = importConflicts({ series: MAD, tournaments: [CUP, SCRIMS], games: [g1], target: target!, replayChampions: MAD_G1_LOG, matchId: right });
    expect(importConfirm(conflicts, 1)).toEqual({
      title: 'Replace the replay on game 1?',
      body: `Game 1's draft matches this replay, but the game already carries ${MOSS_REPLAY}. Linking replaces it.`,
      confirmLabel: 'Replace the replay'
    });
    expect(importRefusal(conflicts)).toBe(`game 1 already carries ${MOSS_REPLAY}`);
    // At 0–3 it is still game 1, and nobody is told the series was decided before a game 4.
    expect(importTarget(MAD_GAMES, right, MAD_G1_LOG)?.id).toBe('mad-g1');
    expect(importConflicts({ series: MAD, tournaments: [CUP, SCRIMS], games: MAD_GAMES, target: MAD_GAMES[0], replayChampions: MAD_G1_LOG, matchId: right }).map((c) => c.kind)).toEqual(['replaces']);
  });
});

describe('importConflicts on a game that already carries a replay', () => {
  it('asks before replacing it on the Plan path too, even in a sandbox, and never for the same replay', () => {
    const linked = game('mad', 3, { matchId: 'EUW1-held' });
    const ask = (over: Partial<Parameters<typeof importConflicts>[0]>) =>
      importConflicts({ series: MAD, tournaments: [CUP], games: [linked], target: linked, replayChampions: ['Zed'], matchId: 'EUW1-new', ...over });
    expect(ask({}).map((c) => c.text)).toEqual(['Game 3 already carries EUW1-held. Linking replaces it.']);
    expect(ask({ series: { ...MAD, sandbox: true } }).map((c) => c.kind)).toEqual(['replaces']);
    expect(ask({ matchId: 'EUW1-held' })).toEqual([]);
    expect(ask({ matchId: undefined })).toEqual([]);
  });
});
