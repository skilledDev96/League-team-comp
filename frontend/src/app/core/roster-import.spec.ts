import { describe, expect, it } from 'vitest';
import { Player, Role, ROLES } from '../models/team.models';
import { EnrichResponse } from '../services/player-enrichment.service';
import { parseRiotIds, RiotId } from './riot-id';
import { applyEnrichment, failureReason, MAX_ROSTER, planRosterImport, seatSuggestion, seatsFromDetected } from './roster-import';

const LINK = 'https://www.op.gg/multisearch/euw?summoners=Alpha%23EUW,Bravo%23123,Charlie%23EUW,Delta%23EUW,Echo%23EUW';
const FIVE = parseRiotIds(LINK);

const id = (name: string, tag = 'EUW'): RiotId => ({ name, tag });

const stored = (name: string, role: Role, over: Partial<Player> = {}): Player => ({
  id: name.toLowerCase(),
  name,
  role,
  strengths: [],
  weaknesses: [],
  top3: [],
  bans: [],
  order: 0,
  ...over
});

const provider = (over: Partial<EnrichResponse> = {}): EnrichResponse => ({
  playstyle: 'Tempo jungler',
  strengths: ['Pathing'],
  weaknesses: ['Vision'],
  source: 'provider',
  provider: 'riot',
  generatedAt: '2026-09-27T10:00:00Z',
  ...over
});

describe('planRosterImport', () => {
  it('seats five in paste order, top to support, none on the bench', () => {
    const plan = planRosterImport({ ids: FIVE, existing: [] });
    expect(plan.refused).toBeUndefined();
    expect(plan.skips).toEqual([]);
    expect(plan.creates.map((c) => [c.index, c.player.name, c.player.role, c.player.sub])).toEqual([
      [0, 'Alpha', 'Top', undefined],
      [1, 'Bravo', 'Jungle', undefined],
      [2, 'Charlie', 'Mid', undefined],
      [3, 'Delta', 'ADC', undefined],
      [4, 'Echo', 'Support', undefined]
    ]);
  });

  it('puts the sixth and seventh on the bench, cycling the seats until Riot is read', () => {
    const plan = planRosterImport({ ids: [...FIVE, id('Foxtrot'), id('Golf')], existing: [] });
    expect(plan.creates.slice(5).map((c) => [c.player.name, c.player.role, c.player.sub])).toEqual([
      ['Foxtrot', 'Top', true],
      ['Golf', 'Jungle', true]
    ]);
    expect(plan.creates.slice(0, 5).every((c) => !c.player.sub)).toBe(true);
  });

  it('writes a skeleton the morning job may fill: empty lists, no hand-edited stamp, the tag and the region', () => {
    const { player } = planRosterImport({ ids: FIVE, existing: [] }).creates[1];
    expect(player).toEqual({
      name: 'Bravo',
      role: 'Jungle',
      strengths: [],
      weaknesses: [],
      top3: [],
      bans: [],
      profile: { region: 'euw', riotTag: '123', opggSlug: 'Bravo-123', mobalyticsSlug: 'bravo-123' }
    });
    expect('curated' in player).toBe(false);
    expect('sub' in player).toBe(false);
  });

  it('plans nothing when the same link is pasted again', () => {
    const first = planRosterImport({ ids: FIVE, existing: [] });
    const existing = first.creates.map((c, i) => ({ ...c.player, id: `p${i}`, order: i }));
    const again = planRosterImport({ ids: FIVE, existing });
    expect(again.creates).toEqual([]);
    expect(again.skips.map((s) => [s.id.name, s.reason])).toEqual(FIVE.map((i) => [i.name, 'already-on-roster']));
    expect(again.refused).toBeUndefined();
  });

  it('skips a player already on the roster whatever the case, and by name alone when the stored player has no tag', () => {
    const existing = [
      stored('alpha', 'Top', { profile: { region: 'euw', riotTag: 'euw' } }),
      stored('Bravo', 'Jungle'),
      stored('Charlie', 'Mid', { profile: { region: 'euw', riotTag: '999' } })
    ];
    const plan = planRosterImport({ ids: FIVE, existing });
    expect(plan.skips.map((s) => s.id.name)).toEqual(['Alpha', 'Bravo']);
    // Charlie#EUW is not Charlie#999: a different tag is a different person.
    expect(plan.creates.map((c) => [c.player.name, c.index])).toEqual([['Charlie', 2], ['Delta', 3], ['Echo', 4]]);
  });

  it('benches a newcomer whose seat a starter already holds, so an import never steals a seat', () => {
    const taken = planRosterImport({ ids: [id('Newcomer')], existing: [stored('Rulukuku', 'Top')] });
    expect(taken.creates[0].player).toMatchObject({ role: 'Top', sub: true });
    const open = planRosterImport({ ids: [id('Newcomer')], existing: [stored('Bench', 'Top', { sub: true })] });
    expect(open.creates[0].player.sub).toBeUndefined();
  });

  it('refuses past the cap, counting the players already on the roster', () => {
    const six = Array.from({ length: 6 }, (_, i) => stored(`Old${i}`, 'Top'));
    const over = planRosterImport({ ids: FIVE, existing: six });
    expect(over.refused).toContain(String(MAX_ROSTER));
    expect(over.creates).toHaveLength(5);
    expect(planRosterImport({ ids: FIVE, existing: six.slice(0, 5) }).refused).toBeUndefined();
    // A skipped player is already counted among the existing, never twice.
    const alreadyThere = FIVE.map((r, i) => stored(r.name, ROLES[i], { profile: { region: 'euw', riotTag: r.tag } }));
    expect(planRosterImport({ ids: FIVE, existing: [...alreadyThere, ...six.slice(0, 5)] }).refused).toBeUndefined();
  });

  it('refuses when nothing parsed', () => {
    const plan = planRosterImport({ ids: parseRiotIds('just a name with no tag'), existing: [] });
    expect(plan.refused).toMatch(/No Riot ID/);
    expect(plan.creates).toEqual([]);
  });

  it('takes the region from the link and defaults to euw for a typed list', () => {
    const fromLink = planRosterImport({ ids: parseRiotIds('https://www.op.gg/multisearch/kr?summoners=Faker%23KR1'), existing: [] });
    expect(fromLink.creates[0].player.profile?.region).toBe('kr');
    const typed = planRosterImport({ ids: parseRiotIds('Faker#KR1'), existing: [] });
    expect(typed.creates[0].player.profile?.region).toBe('euw');
  });

  it("fills both profile slugs by the editor's own rule", () => {
    const { player } = planRosterImport({ ids: [id('Big Bad Wolf')], existing: [] }).creates[0];
    expect(player.profile).toMatchObject({ opggSlug: 'Big Bad Wolf-EUW', mobalyticsSlug: 'big-bad-wolf-euw' });
  });
});

describe('applyEnrichment', () => {
  const top = stored('Alpha', 'Top', { top3: ['Ornn'], bans: ['Fiora'], strengths: ['old'] });
  const riot = provider({ role: 'Jungle', iconUrl: 'riot.jpg', top3: ['Sion', 'ornn'], bans: ['Zed'], queueStats: { solo: {} } });

  it("keeps a starter's pasted seat when Riot says Jungle, writes the rest of the read, and stamps the time", () => {
    const merged = applyEnrichment(top, riot, '2026-09-27T10:00:00Z', { starter: true });
    expect(merged).toMatchObject({
      role: 'Top',
      icon: 'riot.jpg',
      playstyle: 'Tempo jungler',
      strengths: ['Pathing'],
      weaknesses: ['Vision'],
      top3: ['Ornn', 'Sion'],
      bans: ['Zed'],
      queueStats: { solo: {} },
      refreshedAt: '2026-09-27T10:00:00Z'
    });
    expect(merged.curated).toBeUndefined();
  });

  it('moves a sub to the seat Riot sees them in, and leaves them where they are when Riot named none', () => {
    expect(applyEnrichment({ ...top, sub: true }, riot, 'now', { starter: false }).role).toBe('Jungle');
    expect(applyEnrichment({ ...top, sub: true }, provider({ role: undefined }), 'now', { starter: false }).role).toBe('Top');
  });

  it('keeps what Riot did not answer', () => {
    const merged = applyEnrichment(top, provider({ playstyle: '', strengths: [], weaknesses: [] }), 'now', { starter: true });
    expect(merged.strengths).toEqual(['old']);
    expect(merged.bans).toEqual(['Fiora']);
    expect(merged.top3).toEqual(['Ornn']);
    expect(merged.playstyle).toBeUndefined();
    expect(merged.refreshedAt).toBe('now');
  });

  it('leaves a player hand-edited during the read as the editor left them: seat and text kept, stats and the stamp taken', () => {
    // A sub whose panel the editor opened while Riot was being read: Support set by hand, text typed.
    const edited: Player = { ...top, sub: true, role: 'Support', curated: true, icon: 'mine.png' };
    const merged = applyEnrichment(edited, riot, 'now', { starter: false });
    expect(merged).toMatchObject({
      role: 'Support',
      sub: true,
      curated: true,
      icon: 'mine.png',
      strengths: ['old'],
      top3: ['Ornn'],
      bans: ['Fiora'],
      queueStats: { solo: {} },
      refreshedAt: 'now'
    });
    expect(merged.playstyle).toBeUndefined();
    // The icon is the one field taken, and only when the editor set none.
    expect(applyEnrichment({ ...top, curated: true }, riot, 'now', { starter: true }).icon).toBe('riot.jpg');
  });

  it('returns the player untouched on a template, so invented text never lands on a real person', () => {
    const template = provider({ source: 'template', provider: 'template-fallback: Riot API request failed (404) on account-v1.' });
    expect(applyEnrichment(top, template, 'now', { starter: true })).toBe(top);
    expect(applyEnrichment({ ...top, sub: true }, template, 'now', { starter: false }).refreshedAt).toBeUndefined();
  });
});

describe('seatSuggestion', () => {
  it('names the seat Riot sees them in only when it differs, and never off a template', () => {
    expect(seatSuggestion(stored('A', 'Top'), provider({ role: 'Jungle' }))).toBe('Jungle');
    expect(seatSuggestion(stored('A', 'Top'), provider({ role: 'Top' }))).toBeNull();
    expect(seatSuggestion(stored('A', 'Top'), provider())).toBeNull();
    expect(seatSuggestion(stored('A', 'Top'), provider({ role: 'Jungle', source: 'template' }))).toBeNull();
  });
});

describe('seatsFromDetected', () => {
  const five = (detected: (Role | null)[]) => ROLES.map((_, i) => ({ playerId: `p${i}`, detected: detected[i] }));
  const distinct: Role[] = ['Jungle', 'Top', 'Mid', 'ADC', 'Support'];

  it("gives every starter Riot's seat when the five are distinct, and ignores the bench", () => {
    expect(seatsFromDetected(five(distinct))).toEqual({ p0: 'Jungle', p1: 'Top', p2: 'Mid', p3: 'ADC', p4: 'Support' });
    expect(seatsFromDetected([...five(distinct), { playerId: 'sub', sub: true, detected: 'Top' }])).toEqual({
      p0: 'Jungle',
      p1: 'Top',
      p2: 'Mid',
      p3: 'ADC',
      p4: 'Support'
    });
  });

  it('is null on a collision, when a read failed, or without exactly five starters', () => {
    expect(seatsFromDetected(five(['Top', 'Top', 'Mid', 'ADC', 'Support']))).toBeNull();
    expect(seatsFromDetected(five(['Top', 'Jungle', 'Mid', 'ADC', null]))).toBeNull();
    expect(seatsFromDetected(five(distinct).slice(1))).toBeNull();
    expect(seatsFromDetected([])).toBeNull();
  });
});

describe('failureReason', () => {
  it('reads each reason enrichPlayer hides in the provider line', () => {
    const cases: [string, string][] = [
      ['template-fallback: Riot API request failed (404) on account-v1.', 'unknown-id'],
      ['template-fallback: No recent ranked/normal match history found for this Riot ID.', 'no-games'],
      ['template-fallback: Riot API key rejected (401) on account-v1', 'key'],
      ['template-fallback: Riot API forbidden (403) on league-v4', 'key'],
      ['template-fallback: RIOT_API_KEY not configured', 'key'],
      ['template-fallback: Riot API request failed (429) on match-v5.', 'rate'],
      ['built-in-role-template', 'local'],
      ['template-fallback: Riot API request failed (404) on summoner-v4.', 'other'],
      ['template-fallback: socket hang up', 'other'],
      ['', 'other']
    ];
    for (const [provider, kind] of cases) expect(failureReason(provider).kind, provider).toBe(kind);
  });

  it('reads the line the functions really send: the three queues\' reasons joined with "; "', () => {
    // fetchRiotEnrichment (api/src/index.ts) runs solo, flex and clash and joins every rejection.
    const unknown = 'Riot API request failed (404) on account-v1.';
    const rate = 'Riot API request failed (429) on match-v5.';
    const noGames = 'No recent ranked/normal match history found for this Riot ID.';
    const joined = (...reasons: string[]) => `template-fallback: ${reasons.join('; ')}`;
    expect(failureReason(joined(unknown, unknown, unknown)).kind).toBe('unknown-id');
    expect(failureReason(joined(rate, rate, rate)).kind).toBe('rate');
    expect(failureReason(joined(noGames, noGames, noGames)).kind).toBe('no-games');
    // A cold five-player import: solo's match list exhausted its retries while flex and
    // clash simply had nothing. The read was incomplete, so Retry is the answer, not "no games".
    expect(failureReason(joined(rate, noGames, noGames)).kind).toBe('rate');
    expect(failureReason(joined(noGames, rate, noGames)).kind).toBe('rate');
  });

  it('says the reason in words, without the template-fallback prefix', () => {
    expect(failureReason('template-fallback: Riot API request failed (404) on account-v1.').text).toMatch(/does not know/);
    expect(failureReason('template-fallback: socket hang up').text).toBe('Riot could not be read: socket hang up');
    expect(failureReason('').text).toBe('Riot returned nothing useful.');
  });
});
