import { TestBed } from '@angular/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { TeamDataService } from './team-data.service';

// environment.ts is committed with a real Firebase config, so the service would
// otherwise start in Firebase mode and open live listeners. isFirebaseConfigured()
// reads the apiKey, so blanking it is enough — and it is the local half that can
// be exercised without a backend anyway.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const LOCAL_KEY = 'bom-team-data';

function makeService(): TeamDataService {
  localStorage.clear();
  TestBed.resetTestingModule();
  return TestBed.inject(TeamDataService);
}

/** What actually reached localStorage, which is local mode's source of truth. */
function stored(): Record<string, { id: string; order: number }[]> {
  return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}');
}

describe('TeamDataService in local mode', () => {
  let data: TeamDataService;

  beforeEach(() => {
    data = makeService();
  });

  it('tags a game as practice, writes it through, and takes the tag off again', async () => {
    await data.setPractice('EUW1_1', true);
    expect(data.isPractice('EUW1_1')).toBe(true);
    expect(stored()['practiceGames'].map((p) => p.id)).toEqual(['EUW1_1']);
    await data.setPractice('EUW1_1', true); // already on: nothing to do
    expect(data.practiceGames()).toHaveLength(1);
    await data.setPractice('EUW1_1', false);
    expect(data.isPractice('EUW1_1')).toBe(false);
    expect(stored()['practiceGames']).toEqual([]);
  });

  it('keeps a trophy entered by hand: writes it through, edits it in place, survives a reload, and deletes it', async () => {
    const id = await data.createTrophy({ title: 'Split 1 champions', placement: 1, date: '2026-06-28' });
    expect(stored()['trophies'].map((t) => t.id)).toEqual([id]);
    await data.updateTrophy({ ...data.trophies()[0], note: 'Won the final 3–1' });
    expect(data.trophies()).toHaveLength(1);
    TestBed.resetTestingModule();
    const reloaded = TestBed.inject(TeamDataService);
    expect(reloaded.trophies()[0]).toMatchObject({ id, title: 'Split 1 champions', placement: 1, note: 'Won the final 3–1' });
    await reloaded.deleteTrophy(id);
    expect(stored()['trophies']).toEqual([]);
  });

  describe('undoing a delete (15 Sep 2026)', () => {
    const board = { ourChampions: ['Sion', '', 'Ahri', '', ''], theirChampions: [], bans: ['Zed'] };

    it('puts a deleted series and its games back as they were', async () => {
      const seriesId = await data.createSeries({ tournamentId: 't1', opponent: '5s', bestOf: 0 });
      const g1 = await data.createSeriesGame({ seriesId, gameNumber: 1, ...board });
      const series = data.tournamentSeries().find((s) => s.id === seriesId)!;
      const games = data.seriesGames().filter((g) => g.seriesId === seriesId);
      await data.deleteSeriesGame(g1);
      await data.deleteSeries(seriesId);
      expect(await data.restoreSeries(series, games)).toEqual([]);
      expect(data.tournamentSeries().some((s) => s.id === seriesId)).toBe(true);
      expect(data.seriesGames().find((g) => g.id === g1)).toMatchObject({ gameNumber: 1, ourChampions: ['Sion', '', 'Ahri', '', ''] });
    });

    it('will not put a game back where game 3 has been added again, into a full best-of, or under a deleted series', async () => {
      const seriesId = await data.createSeries({ tournamentId: 't1', opponent: 'MAD', bestOf: 3 });
      for (const n of [1, 2]) await data.createSeriesGame({ seriesId, gameNumber: n, ...board });
      const g3 = await data.createSeriesGame({ seriesId, gameNumber: 3, ...board });
      const gone = data.seriesGames().find((g) => g.id === g3)!;
      await data.deleteSeriesGame(g3);
      await data.createSeriesGame({ seriesId, gameNumber: 3, ourChampions: [], theirChampions: [] });
      expect(await data.restoreSeriesGame(gone)).toBe('game 3 has been added again since');
      expect(data.seriesGames().filter((g) => g.seriesId === seriesId)).toHaveLength(3);

      await data.deleteSeries(seriesId);
      expect(await data.restoreSeriesGame(gone)).toBe('its series has been deleted');
    });

    it('will not give a replay to two games, and leaves a replay record saved since in place', async () => {
      const seriesId = await data.createSeries({ tournamentId: 't1', opponent: '5s', bestOf: 0 });
      const linked = await data.createSeriesGame({ seriesId, gameNumber: 1, matchId: 'EUW1_9', ...board });
      const gone = data.seriesGames().find((g) => g.id === linked)!;
      await data.deleteSeriesGame(linked);
      await data.createSeriesGame({ seriesId, gameNumber: 2, matchId: 'EUW1_9', ourChampions: [], theirChampions: [] });
      expect(await data.restoreSeriesGame(gone)).toBe('its replay is linked to another game now');
    });
  });

  describe('Download team data (17 Sep 2026)', () => {
    it('stamps what it is and when, and carries every hand-entered collection and singleton doc', async () => {
      const seriesId = await data.createSeries({ tournamentId: 't1', opponent: 'Paradox Requiem', bestOf: 3 });
      await data.createSeriesGame({ seriesId, gameNumber: 1, matchId: 'EUW1-7979450974', ourChampions: [], theirChampions: [] });
      await data.saveScrim({ id: 'EUW1-7979450974', playedOn: '2026-09-10T20:18:12.686Z', durationSec: 2201, blueWon: true, gameVersion: '16.18.815.9717', players: [], order: 0 });
      await data.saveMatchNote('EUW1-7979450974', 'Their jungler starts bot');
      await data.saveFilmNote('EUW1-7979450974', 'd:4:ADC', 'Hold the wave.');
      const trophyId = await data.createTrophy({ title: 'Split 1 champions', placement: 1 });

      const exported = data.exportTeamData();
      expect(exported.app).toBe('bom-squad');
      expect(exported.version).toBe(1);
      expect(Number.isNaN(Date.parse(exported.exportedAt))).toBe(false);
      expect(Object.keys(exported).sort()).toEqual(
        [
          'app', 'version', 'exportedAt', 'settings', 'teamIdentity', 'resourceLinks', 'players', 'fillIns', 'comps',
          'compResults', 'compOverrides', 'practiceGames', 'tournaments', 'tournamentSeries', 'seriesGames', 'scrims',
          'scrimOpponents', 'matchNotes', 'filmNotes', 'filmCommitments', 'plays', 'painPoints', 'learnEntries',
          'trophies', 'gameReviews', 'accessEntries'
        ].sort()
      );
      expect(exported.players).toEqual(data.players());
      expect(exported.tournamentSeries.map((s) => s.id)).toContain(seriesId);
      expect(exported.scrims[0].gameVersion).toBe('16.18.815.9717');
      expect(exported.matchNotes.map((n) => n.text)).toEqual(['Their jungler starts bot']);
      expect(exported.filmNotes[0].notes['d:4:ADC'].text).toBe('Hold the wave.');
      expect(exported.trophies.map((t) => t.id)).toEqual([trophyId]);
      expect(exported.settings).toEqual(data.settings());
    });

    it('leaves out what a refresh writes again: the analysis and the self-scout', () => {
      data.compAnalysis.set({ games: [] } as never);
      data.selfScout.set({ players: [] } as never);
      const exported = data.exportTeamData() as unknown as Record<string, unknown>;
      expect(exported).not.toHaveProperty('compAnalysis');
      expect(exported).not.toHaveProperty('selfScout');
      expect(exported).not.toHaveProperty('championTraits');
      expect(exported).not.toHaveProperty('refreshLog');
    });

    it('is plain data: it reads back from JSON as it went in', () => {
      const exported = data.exportTeamData();
      expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
    });

    it('writes no Riot id of the other side: a replay carries all ten, and the file keeps ours and their champions', async () => {
      // Their names, as a .rofl carries them; the app prints none of them, so the file must not either.
      const THEIRS = ['RivalTopLaner', 'RivalJungler', 'RivalMid', 'RivalMarksman', 'RivalSupport'];
      const OURS = ['Rulukuku', 'Go10x', 'DrunkenBannana', 'SkilledScarecrow', 'DaWhiteHammer'];
      const TAGS = ['EUW', 'EUW', 'EUW', '42096', 'EUW'];
      const seat = (name: string, tag: string, champion: string, team: number) =>
        ({ name, tag, champion, team, win: team === 200, position: 'TOP', kills: 1, deaths: 1, assists: 1, gold: 9000, damage: 9000, damageToBuildings: 0, damageTaken: 9000, visionScore: 10, cs: 150 });
      const ten = (oursOn: number) => [
        ...OURS.map((n, i) => seat(n, TAGS[i], `Ours${i}`, oursOn)),
        ...THEIRS.map((n, i) => seat(n, 'RVL9', `Theirs${i}`, oursOn === 100 ? 200 : 100))
      ];
      // Our five on red, told by their names alone.
      await data.saveScrim({ id: 'EUW1-7979450974', playedOn: '2026-09-10T20:18:12.686Z', durationSec: 2201, blueWon: false, players: ten(200), order: 0 });
      // A file the roster cannot place: two of ours on each side (a fill-in took the fifth seat) and no side stored.
      const unplacedPlayers = [
        seat(OURS[0], TAGS[0], 'Ours0', 100), seat(OURS[1], TAGS[1], 'Ours1', 100), seat(THEIRS[0], 'RVL9', 'Theirs0', 100), seat(THEIRS[1], 'RVL9', 'Theirs1', 100), seat(THEIRS[2], 'RVL9', 'Theirs2', 100),
        seat(OURS[2], TAGS[2], 'Ours2', 200), seat(OURS[3], TAGS[3], 'Ours3', 200), seat(THEIRS[3], 'RVL9', 'Theirs3', 200), seat(THEIRS[4], 'RVL9', 'Theirs4', 200), seat('FillInFriend', 'EUW', 'Ours4', 200)
      ];
      await data.saveScrim({ id: 'EUW1-7979537790', playedOn: '2026-09-10T21:02:00.000Z', durationSec: 1900, blueWon: true, players: unplacedPlayers, order: 1 });

      const exported = data.exportTeamData();
      const file = JSON.stringify(exported);
      for (const name of [...THEIRS, 'RVL9']) expect(file).not.toContain(name);

      const red = exported.scrims.find((s) => s.id === 'EUW1-7979450974')!;
      expect(red.players.filter((p) => p.team === 100).map((p) => [p.name, p.tag, p.champion])).toEqual(THEIRS.map((_, i) => ['', '', `Theirs${i}`]));
      expect(red.players.filter((p) => p.team === 200).map((p) => `${p.name}#${p.tag}`)).toEqual(OURS.map((n, i) => `${n}#${TAGS[i]}`));
      // Which five are theirs is unknown there, so only the roster's names stay, and every champion does.
      const unplaced = exported.scrims.find((s) => s.id === 'EUW1-7979537790')!;
      expect(unplaced.players.map((p) => p.name)).toEqual([OURS[0], OURS[1], '', '', '', OURS[2], OURS[3], '', '', '']);
      expect(unplaced.players.map((p) => p.champion)).toEqual(unplacedPlayers.map((p) => p.champion));

      // The export is a copy: the replays in the app keep every name.
      expect(data.scrims().find((s) => s.id === 'EUW1-7979450974')!.players.map((p) => p.name)).toContain('RivalMid');
    });
  });

  it('starts in local mode and seeds itself', () => {
    expect(data.mode).toBe('local');
    expect(data.players().length).toBeGreaterThan(0);
    expect(data.ready()).toBe(true);
  });

  it('keeps a film note, and with a drawing from the position lab carries it as lab under the second\'s key; a plain note has no lab key', async () => {
    const drawing = { sec: 840, moved: [{ seat: 'ADC' as const, x: 60.5, y: 80 }], wards: [{ type: 'control' as const, x: 70, y: 72 }], arrows: [] };
    await data.saveFilmNote('EUW1_1', 'lab:840', 'From here the river would have been in sight', drawing);
    const lab = data.notesFor('EUW1_1')?.notes['lab:840'];
    expect(lab?.text).toBe('From here the river would have been in sight');
    expect(lab?.lab).toEqual(drawing);
    await data.saveFilmNote('EUW1_1', 'd:4:ADC', 'Hold the wave.');
    const plain = data.notesFor('EUW1_1')?.notes['d:4:ADC'];
    expect(plain?.text).toBe('Hold the wave.');
    expect(plain && 'lab' in plain).toBe(false);
    // Both stand on the same film; an empty text takes a note down, drawing or not.
    expect(Object.keys(data.notesFor('EUW1_1')?.notes ?? {}).sort()).toEqual(['d:4:ADC', 'lab:840']);
    await data.saveFilmNote('EUW1_1', 'lab:840', '', drawing);
    expect(data.notesFor('EUW1_1')?.notes['lab:840']).toBeUndefined();
  });

  it('starters leaves out whoever is marked as a sub, in roster order', () => {
    const [first, ...rest] = data.players();
    data.players.set([{ ...first, sub: true }, ...rest]);

    expect(data.starters().map((p) => p.id)).toEqual(rest.map((p) => p.id));
    expect(data.starters().some((p) => p.sub)).toBe(false);
  });

  describe('creating', () => {
    it('adds an entity and writes it through to storage', async () => {
      const before = data.comps().length;
      await data.createComp({
        name: 'Test Comp',
        picks: { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' }
      });

      expect(data.comps()).toHaveLength(before + 1);
      expect(stored()['comps']).toHaveLength(before + 1);
    });

    it('gives each new entity its own id', async () => {
      const picks = { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' };
      await data.createComp({ name: 'One', picks });
      await data.createComp({ name: 'Two', picks });

      const ids = data.comps().map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('puts a new entity at the end of the order', async () => {
      const highest = Math.max(...data.comps().map((c) => c.order));
      await data.createComp({
        name: 'Last',
        picks: { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' }
      });

      expect(data.comps().at(-1)!.name).toBe('Last');
      expect(data.comps().at(-1)!.order).toBe(highest + 1);
    });
  });

  describe('updating', () => {
    it('replaces the entity in place rather than adding another', async () => {
      const before = data.comps().length;
      const comp = data.comps()[0];
      await data.updateComp({ ...comp, name: 'Renamed' });

      expect(data.comps()).toHaveLength(before);
      expect(data.comps().find((c) => c.id === comp.id)!.name).toBe('Renamed');
    });

    it('leaves the other entities untouched', async () => {
      const others = data.comps().slice(1).map((c) => c.name);
      const comp = data.comps()[0];
      await data.updateComp({ ...comp, name: 'Renamed' });

      expect(data.comps().slice(1).map((c) => c.name)).toEqual(others);
    });

    it('keeps the list ordered by order, not by write time', async () => {
      const comp = data.comps().at(-1)!;
      await data.updateComp({ ...comp, order: -1 });

      expect(data.comps()[0].id).toBe(comp.id);
    });
  });

  describe('removing', () => {
    it('drops only the entity asked for', async () => {
      const [first, second] = data.comps();
      await data.deleteComp(first.id);

      expect(data.comps().some((c) => c.id === first.id)).toBe(false);
      expect(data.comps().some((c) => c.id === second.id)).toBe(true);
    });

    it('writes the removal through to storage', async () => {
      const first = data.comps()[0];
      await data.deleteComp(first.id);

      expect(stored()['comps'].some((c) => c.id === first.id)).toBe(false);
    });

    it('ignores an id that is not there', async () => {
      const before = data.comps().length;
      await data.deleteComp('no-such-id');

      expect(data.comps()).toHaveLength(before);
    });
  });

  describe('match notes', () => {
    it('keys a note by its match, so one match has one note', async () => {
      await data.saveMatchNote('EUW1_1', 'First take');
      await data.saveMatchNote('EUW1_1', 'Second take');

      expect(data.matchNotes()).toHaveLength(1);
      expect(data.matchNote('EUW1_1')).toBe('Second take');
    });

    it('trims what it stores', async () => {
      await data.saveMatchNote('EUW1_2', '   spaced out   ');
      expect(data.matchNote('EUW1_2')).toBe('spaced out');
    });

    it('deletes the note when the text is emptied', async () => {
      await data.saveMatchNote('EUW1_3', 'Something');
      await data.saveMatchNote('EUW1_3', '   ');

      expect(data.matchNotes().some((n) => n.matchId === 'EUW1_3')).toBe(false);
      expect(data.matchNote('EUW1_3')).toBe('');
    });

    it('returns an empty string for a match with no note', () => {
      expect(data.matchNote('EUW1_never')).toBe('');
    });
  });

  describe('reloading', () => {
    it('reads back what a previous session wrote', async () => {
      await data.createComp({
        name: 'Survives',
        picks: { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' }
      });

      TestBed.resetTestingModule();
      const reloaded = TestBed.inject(TeamDataService);

      expect(reloaded.comps().some((c) => c.name === 'Survives')).toBe(true);
    });

    it('falls back to the seed when storage holds nonsense', () => {
      localStorage.setItem(LOCAL_KEY, 'not json');
      TestBed.resetTestingModule();
      const recovered = TestBed.inject(TeamDataService);

      expect(recovered.players().length).toBeGreaterThan(0);
    });
  });
});
