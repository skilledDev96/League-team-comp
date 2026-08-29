/**
 * What a champion *is*, and what a set of five adds up to.
 *
 * Riot's own champion list carries class tags but no damage type, and the file
 * that does carry it is one request per champion — fine on a schedule, absurd
 * in a browser. So the traits are assembled here, stored once, and read as a
 * single small document.
 *
 * The comp classifier is rule-based on purpose. Aggregate win-rate data would
 * tell you *whether* a comp wins; it cannot tell you the comp is a poke comp,
 * or that it has no frontline. That reading is the thing a coach gives you and
 * the stats tools openly leave out, and it needs no data licence to compute.
 */

/** As published by CommunityDragon: kPhysical, kMagic, kMixed. */
export type DamageType = 'physical' | 'magic' | 'mixed' | 'unknown';

export interface ChampionTraits {
  /** Data Dragon id, e.g. "MonkeyKing" — the key everything else joins on. */
  id: string;
  name: string;
  damage: DamageType;
  /** melee or ranged; drives poke and dive reads. */
  attack: 'melee' | 'ranged' | 'unknown';
  /** Modern class list, e.g. ["fighter","tank"]. */
  roles: string[];
  /** 0-3 each, straight from playstyleInfo. */
  cc: number;
  mobility: number;
  durability: number;
  utility: number;
}

const DAMAGE_BY_KEY: Record<string, DamageType> = {
  kPhysical: 'physical',
  kMagic: 'magic',
  kMixed: 'mixed'
};

/** One champion's entry as CommunityDragon publishes it. */
interface RawChampion {
  id?: number;
  name?: string;
  alias?: string;
  roles?: string[];
  tacticalInfo?: { damageType?: string; attackType?: string };
  playstyleInfo?: { crowdControl?: number; mobility?: number; durability?: number; utility?: number };
}

export function toTraits(raw: RawChampion): ChampionTraits | null {
  const id = raw.alias;
  if (!id) return null;
  const play = raw.playstyleInfo ?? {};
  return {
    id,
    name: raw.name ?? id,
    damage: DAMAGE_BY_KEY[raw.tacticalInfo?.damageType ?? ''] ?? 'unknown',
    attack:
      raw.tacticalInfo?.attackType === 'melee'
        ? 'melee'
        : raw.tacticalInfo?.attackType === 'ranged'
          ? 'ranged'
          : 'unknown',
    roles: raw.roles ?? [],
    cc: play.crowdControl ?? 0,
    mobility: play.mobility ?? 0,
    durability: play.durability ?? 0,
    utility: play.utility ?? 0
  };
}
