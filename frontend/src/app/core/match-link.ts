/**
 * An outside page for one Riot match, so a figure here can be checked
 * against someone else's read of the same game.
 *
 * League of Graphs serves a match by platform region and the numeric game
 * id, which is the tail of Riot's match id. Match ids reach this app in two
 * spellings: `EUW1_7975325765` from the Riot API and `EUW1-7975325765` from
 * replay filenames; both are the same game. A replay that never went
 * through Riot (a synthetic `scrim:` id) has no page anywhere.
 */
const REGION_BY_PLATFORM: Record<string, string> = {
  EUW1: 'euw',
  EUN1: 'eune',
  NA1: 'na',
  KR: 'kr',
  TR1: 'tr',
  BR1: 'br',
  LA1: 'lan',
  LA2: 'las',
  OC1: 'oce',
  JP1: 'jp',
  RU: 'ru'
};

export function matchLink(matchId: string | undefined | null): string | null {
  if (!matchId) return null;
  const m = /^([A-Za-z]+\d*)[_-](\d+)$/.exec(matchId.trim());
  if (!m) return null;
  const region = REGION_BY_PLATFORM[m[1].toUpperCase()];
  if (!region) return null;
  return `https://www.leagueofgraphs.com/match/${region}/${m[2]}`;
}
