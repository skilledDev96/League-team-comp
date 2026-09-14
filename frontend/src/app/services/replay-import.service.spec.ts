import { describe, expect, it } from 'vitest';
import { Player, Scrim, SeriesGame, TournamentSeries } from '../models/team.models';
import { rosterIds } from '../pages/games/game-rows';
import { DRAFT_LENGTH } from '../pages/tournaments/draft-sequence';
import {
  boardOf,
  filedUnderOtherSeries,
  linkedGame,
  replaceQuestion,
  replayClaim,
  replayFill,
  replaySide,
  rosterSideOf,
  scrimToSave,
  unlinkedGame,
  unlinkQuestion
} from './replay-import.service';

// The 13 Sep 2026 snapshot, as the audit found it.

const ROSTER = rosterIds(
  [
    ['Sir StonedAlot', 'EUW'],
    ['Go10x', 'EUW'],
    ['DrunkenBannana', 'EUW'],
    ['SkilledScarecrow', '42096'],
    ['DaWhiteHammer', 'EUW']
  ].map(([name, riotTag]) => ({ name, profile: { riotTag } }) as unknown as Player)
);

const seat = (team: number, name: string, tag: string, champion: string, position: string) =>
  ({ team, name, tag, champion, position, kills: 0, deaths: 0, assists: 0, cs: 0, damage: 0, damageTaken: 0, gold: 0, visionScore: 0 }) as unknown as Scrim['players'][number];

/** MAD Synergy game 3 (EUW1-7975412766): blue won, and all five of ours are on team 200. */
const MAD_G3_PLAYERS: Scrim['players'] = [
  seat(100, 'LSG UwUwest', 'UwU', 'Shen', 'TOP'),
  seat(100, 'LSG Di3baas', 'LSG', 'Naafiri', 'JUNGLE'),
  seat(100, 'Jett', 'LSG', 'Veigar', 'MIDDLE'),
  seat(100, 'Rëvolution', 'MAD', 'Caitlyn', 'BOTTOM'),
  seat(100, 'LSG turtle', 'LSG', 'Mel', 'UTILITY'),
  seat(200, 'Sir StonedAlot', 'EUW', 'Illaoi', 'TOP'),
  seat(200, 'Go10x', 'EUW', 'Diana', 'JUNGLE'),
  seat(200, 'DrunkenBannana', 'EUW', 'Yasuo', 'MIDDLE'),
  seat(200, 'SkilledScarecrow', '42096', 'Jhin', 'BOTTOM'),
  seat(200, 'DaWhiteHammer', 'EUW', 'Seraphine', 'UTILITY')
];

const game = (over: Partial<SeriesGame>): SeriesGame => ({
  id: 'g',
  seriesId: 's',
  gameNumber: 1,
  order: 1,
  ourChampions: [],
  theirChampions: [],
  ...over
});

const SERIES: TournamentSeries[] = [
  { id: 'series-e2c22df8', tournamentId: 'tournament-f9515444', opponent: 'MAD Synergy', bestOf: 3, status: 'scheduled', order: 0 },
  { id: 'series-1d59cb83', tournamentId: 'tournament-12c5a17f', opponent: 'MOSS 2', bestOf: 0, status: 'scheduled', order: 0 }
] as TournamentSeries[];

/** MAD Synergy game 1 as the draft log recorded it on 8 Sep 08:05, before the wrong replay. */
const MAD_G1_TYPED = game({
  id: 'game-9b32d98a',
  seriesId: 'series-e2c22df8',
  gameNumber: 1,
  ourSide: 'blue',
  draftStep: 20,
  win: true,
  bans: ['Udyr'],
  ourChampions: ['Mordekaiser', 'JarvanIV', 'Ahri', 'Tristana', 'Nautilus'],
  theirChampions: ['Garen', 'Vi', 'Taliyah', 'Sivir', 'Braum']
});

const MOSS2_G1 = game({ id: 'game-2bf19e22', seriesId: 'series-1d59cb83', gameNumber: 1, win: false, matchId: 'EUW1-7977500462', ourSide: 'blue' });

describe('the side a replay is filled as', () => {
  it('reads MAD Synergy game 3 as red from the five names, whatever the draft said', () => {
    const named = rosterSideOf({ players: MAD_G3_PLAYERS }, ROSTER);
    expect(named).toBe('red');
    // The game had been set to blue in the draft room; the old line kept blue and swapped the fives.
    expect(replaySide(named, 'blue')).toEqual({ side: 'red', conflict: true });
    const fill = replayFill(MAD_G3_PLAYERS, true, 'red');
    expect(fill).toEqual({
      ourChampions: ['Illaoi', 'Diana', 'Yasuo', 'Jhin', 'Seraphine'],
      theirChampions: ['Shen', 'Naafiri', 'Veigar', 'Caitlyn', 'Mel'],
      ourSide: 'red',
      win: false,
      draftStep: DRAFT_LENGTH
    });
  });

  it('ignores a side stored on the record and counts names only', () => {
    expect(rosterSideOf({ players: MAD_G3_PLAYERS, ourSide: 'blue' } as Scrim, ROSTER)).toBe('red');
  });

  it('falls back to the draft side only when the names cannot tell', () => {
    expect(replaySide(null, 'blue')).toEqual({ side: 'blue', conflict: false });
    expect(replaySide(null, undefined)).toEqual({ side: null, conflict: false });
    expect(replaySide('red', 'red')).toEqual({ side: 'red', conflict: false });
    expect(replaySide('red', undefined)).toEqual({ side: 'red', conflict: false });
  });

  it('fills nothing without a side', () => {
    expect(replayFill(MAD_G3_PLAYERS, true, null)).toEqual({ ourChampions: [], theirChampions: [] });
  });
});

describe('a replay another game already carries', () => {
  it('refuses MOSS 2’s game 1 replay on MAD Synergy game 1, naming where it is', () => {
    const claim = replayClaim('EUW1-7977500462', [MAD_G1_TYPED, MOSS2_G1], SERIES, { gameId: MAD_G1_TYPED.id });
    expect(claim?.game.id).toBe('game-2bf19e22');
    expect(claim?.line).toBe('EUW1-7977500462 is already game 1 vs MOSS 2. Unlink it there first.');
  });

  it('lets a game re-import its own replay, and a batch reuse its own series’ game', () => {
    expect(replayClaim('EUW1-7977500462', [MOSS2_G1], SERIES, { gameId: 'game-2bf19e22' })).toBeNull();
    expect(replayClaim('EUW1-7977500462', [MOSS2_G1], SERIES, { seriesId: 'series-1d59cb83' })).toBeNull();
    expect(replayClaim('EUW1-7977500462', [MOSS2_G1], SERIES, { seriesId: 'series-e2c22df8' })?.opponent).toBe('MOSS 2');
    expect(replayClaim('EUW1-1', [MOSS2_G1], SERIES, {})).toBeNull();
  });
});

describe('the replay record’s opponent', () => {
  const stored = { id: 'EUW1-7977500462', opponent: 'MOSS 2', note: 'their jungler invades', order: 7, ourSide: 'blue' } as Scrim;

  it('does not rename a replay filed under another series', () => {
    const filed = filedUnderOtherSeries(stored, SERIES[0], SERIES);
    expect(filed).toBe('MOSS 2');
    const read = { id: 'EUW1-7977500462', playedOn: '2026-09-08', durationSec: 2201, blueWon: false, players: [], order: 30, opponent: 'MAD Synergy' };
    const saved = scrimToSave(stored, read, 'MAD Synergy', filed, 'blue');
    expect(saved.opponent).toBe('MOSS 2');
    expect(saved.note).toBe('their jungler invades');
    expect(saved.order).toBe(7);
  });

  it('files a loose or new replay under the series it lands on', () => {
    expect(filedUnderOtherSeries(stored, SERIES[1], SERIES)).toBeNull();
    expect(filedUnderOtherSeries({ opponent: 'Nobody we play' }, SERIES[0], SERIES)).toBeNull();
    expect(filedUnderOtherSeries(undefined, SERIES[0], SERIES)).toBeNull();
    expect(filedUnderOtherSeries({ opponent: 'moss-2' }, SERIES[1], SERIES)).toBeNull();
  });

  it('keeps a side somebody set when the file cannot tell one', () => {
    const read = { id: 'x', playedOn: '', durationSec: 1, blueWon: true, players: [], order: 1 };
    expect(scrimToSave(stored, read, 'MOSS 2', null, null).ourSide).toBe('blue');
    expect(scrimToSave(undefined, read, 'MOSS 2', null, null).ourSide).toBeUndefined();
  });
});

describe('link and unlink keep what was there', () => {
  const wrongReplay = replayFill(
    [
      seat(100, 'Sir StonedAlot', 'EUW', 'Kled', 'TOP'),
      seat(100, 'Go10x', 'EUW', 'MonkeyKing', 'JUNGLE'),
      seat(100, 'DrunkenBannana', 'EUW', 'Ahri', 'MIDDLE'),
      seat(100, 'SkilledScarecrow', '42096', 'Tristana', 'BOTTOM'),
      seat(100, 'DaWhiteHammer', 'EUW', 'Seraphine', 'UTILITY'),
      seat(200, 'MOSS St4mpe', 'MT7', 'Malphite', 'TOP'),
      seat(200, 'MOSS Seldurin', 'MT7', 'Nocturne', 'JUNGLE'),
      seat(200, 'MOSS Drakexo', 'Hwei', 'Syndra', 'MIDDLE'),
      seat(200, 'wisconvi', 'chad', 'Draven', 'BOTTOM'),
      seat(200, 'Håkan Bråkan', '1891', 'Pantheon', 'UTILITY')
    ],
    false,
    'blue'
  );

  it('asks before a replay replaces a typed Win and its draft', () => {
    expect(replaceQuestion(MAD_G1_TYPED, 'EUW1-7977500462.rofl')).toBe(
      'Game 1 already has a Win and its draft. Fill it from EUW1-7977500462.rofl instead? Unlinking the replay later puts back what is there now.'
    );
    expect(replaceQuestion(game({ ourSide: 'red', draftStep: 0 }), 'x.rofl')).toBeNull();
  });

  it('puts MAD Synergy game 1’s Win and board back on unlink', () => {
    const linked = linkedGame(MAD_G1_TYPED, wrongReplay, 'EUW1-7977500462');
    expect(linked.win).toBe(false);
    expect(linked.ourChampions[1]).toBe('MonkeyKing');
    expect(linked.beforeLink).toEqual(boardOf(MAD_G1_TYPED));

    expect(unlinkQuestion(linked)).toBe(
      'Unlink replay EUW1-7977500462 from game 1? The replay\'s picks and result come off, and the game goes back to a Win and its draft as it was before the link.'
    );
    const back = unlinkedGame(linked);
    expect(back).toEqual(MAD_G1_TYPED);
    expect('matchId' in back).toBe(false);
    expect('beforeLink' in back).toBe(false);
  });

  it('keeps the first board when a linked game is filled again', () => {
    const once = linkedGame(MAD_G1_TYPED, wrongReplay, 'EUW1-7977500462');
    const twice = linkedGame(once, { win: true }, 'EUW1-7977500462');
    expect(twice.beforeLink).toEqual(boardOf(MAD_G1_TYPED));
  });

  it('returns an empty slot to empty, side and step included', () => {
    const empty = game({ gameNumber: 2 });
    const back = unlinkedGame(linkedGame(empty, wrongReplay, 'EUW1-1'));
    expect(back).toEqual(empty);
    expect(unlinkQuestion(linkedGame(empty, wrongReplay, 'EUW1-1'))).toBe('Unlink replay EUW1-1 from game 2? Its picks and result will be cleared.');
  });

  it('clears a game linked before boards were kept, and asks first', () => {
    // MOSS 2 game 1 as stored: a replay, a loss, no beforeLink.
    const legacy = { ...MOSS2_G1, ourChampions: ['Kled'], theirChampions: ['Malphite'] };
    expect(unlinkQuestion(legacy)).toBe('Unlink replay EUW1-7977500462 from game 1? Its picks and result will be cleared.');
    const back = unlinkedGame(legacy);
    expect(back.ourChampions).toEqual([]);
    expect(back.theirChampions).toEqual([]);
    expect(back.win).toBeUndefined();
    expect(back.matchId).toBeUndefined();
    expect(back.ourSide).toBe('blue');
  });

  it('does not ask to unlink a replay that filled nothing', () => {
    expect(unlinkQuestion(game({ matchId: 'EUW1-1' }))).toBeNull();
    expect(unlinkQuestion(game({}))).toBeNull();
  });
});
