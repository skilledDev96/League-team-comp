import { TestBed } from '@angular/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { Comp } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { CompWritesService } from './comp-writes.service';

// Local mode, the way the page's own spec does it: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

describe.skipIf(typeof localStorage === 'undefined')('CompWritesService', () => {
  let data: TeamDataService;
  let writes: CompWritesService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [CompWritesService] });
    data = TestBed.inject(TeamDataService);
    writes = TestBed.inject(CompWritesService);
  });

  const find = (id: string): Comp => data.comps().find((c) => c.id === id)!;

  it('adds a blank comp named after its place in the list and hands back its id', async () => {
    const n = data.comps().length;
    const id = await writes.add();
    expect(find(id)).toMatchObject({ name: `New comp ${n + 1}`, picks: { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' } });
  });

  it('renames on a real change only, and refuses an empty name so the field can revert', async () => {
    const id = await writes.add();
    expect(await writes.rename(find(id), '   ')).toBe('empty');
    expect(await writes.rename(find(id), find(id).name)).toBe('unchanged');
    expect(await writes.rename(find(id), '  Dive  ')).toBe('saved');
    expect(find(id).name).toBe('Dive');
  });

  it('writes the words trimmed, only when something changed', async () => {
    const id = await writes.add();
    const words = { category: ' Meta ', notes: 'Group at 14 ', early: 'Trade', mid: '', late: '', bans: ['Zed', ' '] };
    expect(await writes.saveWords(find(id), words)).toBe(true);
    expect(find(id)).toMatchObject({ category: 'Meta', notes: 'Group at 14', gamePlan: { early: 'Trade' }, bans: ['Zed'] });
    expect(find(id).gamePlan).not.toHaveProperty('mid');
    expect(await writes.saveWords(find(id), words)).toBe(false);
  });

  it('removes a comp with its results and plays, and a comp that counted under it stands on its own', async () => {
    const id = await writes.add();
    const other = await writes.add();
    await writes.setCountsUnder(find(other), id);
    expect(find(other).countsUnder).toBe(id);
    await writes.logResult(find(id), { outcome: 'win', opponent: 'Tidal Wolves', note: '', playedOn: '2026-09-13' });
    await data.createPlay({ compId: id, title: 'Dragon dive', phase: 'mid', tokens: [] } as never);
    const results = data.compResults().filter((r) => r.compId === id);
    const plays = data.plays().filter((p) => p.compId === id);
    expect(results).toHaveLength(1);
    expect(plays).toHaveLength(1);
    await writes.remove(find(id), { results, plays, variants: [find(other)] });
    expect(data.comps().some((c) => c.id === id)).toBe(false);
    expect(data.compResults().some((r) => r.compId === id)).toBe(false);
    expect(data.plays().some((p) => p.compId === id)).toBe(false);
    expect(find(other).countsUnder).toBeNull();
  });
});
