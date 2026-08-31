/**
 * Reading a scrim out of a `.rofl` replay file.
 *
 * Custom games never enter the Riot API — queueId 0 never appears in a match
 * list and `matches/{id}` answers 404 even when the id is known — so every
 * scrim this team has ever played is invisible to everything else in this app.
 * Scrims are where they actually practise for the tournament, which makes that
 * the largest hole in the data.
 *
 * The replay file the client writes carries the complete end-of-game stats
 * block: ten players, Riot IDs, champions, lanes, and the same counters the
 * analysis already runs on. Reading a file Riot's own client saved to disk is
 * not fetching from a source outside their API endpoints, so the scraping rule
 * does not bite here.
 *
 * What it cannot give: there is no timeline, so nothing about how a lead was
 * built or lost, and no game-start timestamp — the file knows only how long the
 * game ran.
 */

/** One player's line in a scrim scoreboard. */
export interface ReplayPlayer {
  /** Riot game name, without the tag. Empty when the replay omitted it. */
  readonly name: string;
  readonly tag: string;
  /** Champion, by Riot's internal name — "MonkeyKing", not "Wukong". */
  readonly champion: string;
  /** 100 blue, 200 red. */
  readonly team: number;
  readonly win: boolean;
  readonly position: string;
  readonly kills: number;
  readonly deaths: number;
  readonly assists: number;
  readonly gold: number;
  readonly damage: number;
  readonly damageToBuildings: number;
  readonly damageTaken: number;
  readonly visionScore: number;
  readonly cs: number;
}

export interface ReplayGame {
  /** Seconds. The one duration the file actually knows. */
  readonly durationSec: number;
  readonly players: readonly ReplayPlayer[];
  /** Whether blue won, for a scoreboard that wants to lead with the result. */
  readonly blueWon: boolean;
  readonly surrendered: boolean;
}

/**
 * How far back from the end to look for the metadata block.
 *
 * It sits at about 99.4% of the file — the replay payload comes first and the
 * stats last — so scanning backwards finds it almost immediately, where a
 * forward scan reads twenty megabytes first. Four megabytes is generous cover
 * for a longer game without ever reading the whole file.
 */
const TAIL_BYTES = 4 * 1024 * 1024;

/** Every value in `statsJson` is a string, including the numbers. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Find the metadata object that contains a marker.
 *
 * Brace-matching rather than a regex, because the block holds `statsJson` as an
 * escaped string full of braces of its own — anything counting characters
 * without tracking quoting closes the object hundreds of fields early.
 */
function enclosingJson(text: string, markerAt: number): string | null {
  let start = markerAt;
  while (start >= 0 && text[start] !== '{') start -= 1;
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Pull the scoreboard out of a replay.
 *
 * Returns null rather than throwing for anything that is not a readable
 * replay: importing is a drag-and-drop, so a stray file in the folder is an
 * ordinary event and should skip quietly, not fail the batch.
 */
export function parseReplay(bytes: ArrayBuffer): ReplayGame | null {
  const view = new Uint8Array(bytes);
  if (view.length < 16) return null;

  // "RIOT" magic. Anything else is not a replay, whatever its extension says.
  if (String.fromCharCode(view[0], view[1], view[2], view[3]) !== 'RIOT') return null;

  const from = Math.max(0, view.length - TAIL_BYTES);
  const tail = new TextDecoder('utf-8', { fatal: false }).decode(view.subarray(from));
  const markerAt = tail.lastIndexOf('"gameLength"');
  if (markerAt < 0) return null;

  const block = enclosingJson(tail, markerAt);
  if (!block) return null;

  try {
    const meta = JSON.parse(block) as { gameLength?: number; statsJson?: string };
    const rows = JSON.parse(meta.statsJson ?? '[]') as Record<string, unknown>[];
    if (!Array.isArray(rows) || !rows.length) return null;

    const players = rows.map<ReplayPlayer>((r) => ({
      name: String(r['RIOT_ID_GAME_NAME'] ?? r['NAME'] ?? '').trim(),
      tag: String(r['RIOT_ID_TAG_LINE'] ?? '').trim(),
      champion: String(r['SKIN'] ?? ''),
      team: num(r['TEAM']),
      // Riot writes the result as "Win" / "Fail", not a boolean.
      win: String(r['WIN'] ?? '') === 'Win',
      position: String(r['TEAM_POSITION'] ?? r['INDIVIDUAL_POSITION'] ?? ''),
      kills: num(r['CHAMPIONS_KILLED']),
      deaths: num(r['NUM_DEATHS']),
      assists: num(r['ASSISTS']),
      gold: num(r['GOLD_EARNED']),
      damage: num(r['TOTAL_DAMAGE_DEALT_TO_CHAMPIONS']),
      damageToBuildings: num(r['TOTAL_DAMAGE_DEALT_TO_BUILDINGS']),
      damageTaken: num(r['TOTAL_DAMAGE_TAKEN']),
      visionScore: num(r['VISION_SCORE']),
      cs: num(r['MINIONS_KILLED']) + num(r['NEUTRAL_MINIONS_KILLED'])
    }));

    return {
      // gameLength is milliseconds; TIME_PLAYED per player is seconds and
      // agrees with it, so either would do and this is the one place it lives.
      durationSec: Math.round((meta.gameLength ?? 0) / 1000),
      players,
      blueWon: players.some((p) => p.team === 100 && p.win),
      surrendered: rows.some((r) => String(r['GAME_ENDED_IN_SURRENDER'] ?? '0') !== '0')
    };
  } catch {
    return null;
  }
}

/**
 * The match id a replay filename carries, e.g. "EUW1-7967636895".
 *
 * The stats block does not contain one, and it is the only stable identity a
 * scrim has — without it the same file imported twice becomes two games.
 */
export function matchIdFromFilename(filename: string): string {
  const stem = filename.replace(/\.rofl$/i, '').trim();
  return /^[A-Z0-9]+-\d+$/i.test(stem) ? stem.toUpperCase() : '';
}

/**
 * Whether a game looks like a scrim rather than a queued match.
 *
 * A custom game has no queue recorded anywhere in the file, so this cannot be
 * read directly. What it can do is spot the shape: five against five, both
 * sides full, everybody on a real champion. Ranked games pass this too — the
 * caller still chooses which files to import — but a bot game, a remake or an
 * ARAM does not, and those are the ones worth refusing outright.
 */
export function looksLikeFiveOnFive(game: ReplayGame): boolean {
  const blue = game.players.filter((p) => p.team === 100);
  const red = game.players.filter((p) => p.team === 200);
  return (
    blue.length === 5 &&
    red.length === 5 &&
    game.players.every((p) => !!p.champion) &&
    game.durationSec > 300
  );
}
