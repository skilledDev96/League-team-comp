/**
 * What a comp is expected to do, on four axes, and whether a game did it.
 *
 * The Comps page revamp planned a matchup simulator on four axes — early
 * game, scaling, objectives, teamfight — and never built it. This is the
 * part of it that a post-game review needs (8 Sep 2026): a reading of the
 * five champions, low / mid / high per axis, that an editor can overrule on
 * the Comps page. The review then compares the game's gold curve against it,
 * so "this comp expected a strong early and was down 1.2k at ten" is a
 * sentence the app can say on its own.
 *
 * Rule-based like `comp-identity.ts`, and for the same reason: the traits say
 * what a comp is built to do, and no data licence is needed to read them.
 * The thresholds are a first cut, pinned by the spec so a re-tune is a
 * visible diff rather than a drift.
 *
 * `compareCurve` is mirrored in `api/src/game-facts.ts` on purpose, the way
 * `comp-alias.ts` mirrors `comp-attribution.ts`: the browser re-renders it
 * the moment an expectation is edited, and the review function reads it
 * without a browser.
 */
import { ChampionTraits, CompExpectation, ExpectLevel } from '../models/team.models';
import { classifyComp } from './comp-identity';

export const EXPECT_AXES = ['early', 'scaling', 'objectives', 'teamfight'] as const;
export type ExpectAxis = (typeof EXPECT_AXES)[number];

export const EXPECT_LABEL: Record<ExpectAxis, string> = {
  early: 'Early game',
  scaling: 'Scaling',
  objectives: 'Objective control',
  teamfight: 'Teamfight'
};

export const LEVEL_LABEL: Record<ExpectLevel, string> = { low: 'Low', mid: 'Mid', high: 'High' };
export const LEVELS: readonly ExpectLevel[] = ['low', 'mid', 'high'];

/** A team gold gap that means something at ten minutes or later. */
export const CURVE_EDGE = 1000;

function level(sum: number, lo: number, hi: number): ExpectLevel {
  return sum < lo ? 'low' : sum >= hi ? 'high' : 'mid';
}

const atLeast = (a: ExpectLevel, floor: ExpectLevel): ExpectLevel => (LEVELS.indexOf(a) < LEVELS.indexOf(floor) ? floor : a);
const atMost = (a: ExpectLevel, cap: ExpectLevel): ExpectLevel => (LEVELS.indexOf(a) > LEVELS.indexOf(cap) ? cap : a);

/**
 * The four axes from the five champions. Null on a partial comp, like the
 * identity: a reading of three champions would be taken as a finding.
 *
 * Per champion: early counts burst, mobility and a ranged support, with the
 * jungler double because the jungler sets the tempo; scaling counts
 * marksmen and mages and takes a point off assassins; objectives counts
 * bodies, utility, ranged damage and crowd control; teamfight counts crowd
 * control above all. The identity nudges a floor or a cap where the traits
 * alone would misread a comp.
 */
export function deriveExpectation(traits: ChampionTraits[], opts: { junglerId?: string; name?: string } = {}): CompExpectation | null {
  if (traits.length < 5) return null;
  let early = 0;
  let scaling = 0;
  let objectives = 0;
  let teamfight = 0;
  for (const t of traits) {
    const has = (role: string) => t.roles.includes(role);
    const weight = opts.junglerId && t.id === opts.junglerId ? 2 : 1;
    let e = 0;
    if (has('assassin')) e += 2;
    if (has('fighter')) e += 1;
    if (t.mobility >= 2) e += 1;
    if (has('support') && t.attack === 'ranged') e += 1;
    early += e * weight;

    if (has('marksman')) scaling += 2;
    if (has('mage')) scaling += 1;
    if (has('tank') && t.durability >= 2) scaling += 1;
    if (has('assassin')) scaling -= 1;

    if (t.durability >= 2) objectives += 1;
    if (t.utility >= 2) objectives += 1;
    if (has('marksman') && t.attack === 'ranged') objectives += 1;
    if (t.cc >= 2) objectives += 1;

    teamfight += t.cc;
    if (has('mage')) teamfight += 1;
    if (t.durability >= 2) teamfight += 1;
  }
  const expect: CompExpectation = {
    early: level(early, 5, 9),
    scaling: level(scaling, 3, 6),
    objectives: level(objectives, 6, 10),
    teamfight: level(teamfight, 8, 13)
  };
  const identity = classifyComp(traits);
  if (identity === 'dive' || identity === 'pick') expect.early = atLeast(expect.early, 'mid');
  if (identity === 'teamfight' || identity === 'protect') expect.teamfight = atLeast(expect.teamfight, 'mid');
  if (identity === 'split') expect.teamfight = atMost(expect.teamfight, 'mid');
  if ((opts.name ?? '').toLowerCase().includes('scal')) expect.scaling = atLeast(expect.scaling, 'mid');
  return expect;
}

/** What an editor wrote, else what the champions say. */
export function expectationFor(
  comp: { name: string; expect?: CompExpectation; expectSource?: 'derived' | 'edited' },
  traits: ChampionTraits[],
  junglerId?: string
): { expect: CompExpectation; source: 'derived' | 'edited' } | null {
  if (comp.expectSource === 'edited' && comp.expect) return { expect: comp.expect, source: 'edited' };
  const derived = deriveExpectation(traits, { junglerId, name: comp.name });
  if (derived) return { expect: derived, source: 'derived' };
  return comp.expect ? { expect: comp.expect, source: comp.expectSource ?? 'derived' } : null;
}

function k(gold: number): string {
  const abs = Math.abs(gold);
  return abs >= 1000 ? `${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(abs);
}

/**
 * The game's curve against the comp's expectation, in sentences. Only the
 * marks that say something: an even game says nothing on either axis.
 * Mirrored in `api/src/game-facts.ts`; keep the two identical.
 */
export function compareCurve(expect: CompExpectation | null, curve: { at10?: number; at15?: number; at25?: number }): string[] {
  if (!expect) return [];
  const lines: string[] = [];
  const at10 = curve.at10;
  if (at10 !== undefined && Math.abs(at10) >= CURVE_EDGE) {
    const up = at10 > 0;
    if (expect.early === 'high') lines.push(up ? `The strong early game came: up ${k(at10)} at ten.` : `Expected a strong early game, but was down ${k(at10)} at ten.`);
    else if (expect.early === 'low') lines.push(up ? `Expected a slow start and was up ${k(at10)} at ten anyway.` : `Down ${k(at10)} at ten, which a slow-starting comp expects; the question is what came after.`);
  }
  const at25 = curve.at25;
  if (at25 !== undefined && Math.abs(at25) >= CURVE_EDGE) {
    const up = at25 > 0;
    if (expect.scaling === 'high') lines.push(up ? `The scaling paid: up ${k(at25)} at twenty-five.` : `Expected to scale, but was down ${k(at25)} at twenty-five.`);
    else if (expect.scaling === 'low') lines.push(up ? `Up ${k(at25)} at twenty-five on a comp that does not scale: the lead was kept.` : `Down ${k(at25)} at twenty-five on a comp that does not scale: the game went too long.`);
  }
  return lines;
}
