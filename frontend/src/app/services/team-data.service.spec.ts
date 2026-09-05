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

  it('starts in local mode and seeds itself', () => {
    expect(data.mode).toBe('local');
    expect(data.players().length).toBeGreaterThan(0);
    expect(data.ready()).toBe(true);
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
