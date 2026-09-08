/**
 * One replay importer for both places a .rofl lands: the Scrims page (many
 * files against an opponent) and a series game on the Plan view (one file,
 * which also fills the draft). The reasons a file is skipped are one list,
 * so the two entry points never disagree about what "did not import" means
 * (8 Sep 2026).
 */
import { Scrim } from '../models/team.models';
import { looksLikeFiveOnFive, matchIdFromFilename, parseReplay, ReplayGame } from './replay-parse';

export type ReplaySkipReason = 'no-id' | 'unreadable' | 'not-5v5';

export const SKIP_LINE: Record<ReplaySkipReason, string> = {
  'no-id': 'no match id in the file name — keep the name Riot gave it (EUW1-1234567890.rofl)',
  unreadable: 'not a readable replay',
  'not-5v5': 'not a full 5v5'
};

export type ReplayRead =
  | { ok: true; id: string; replay: ReplayGame; scrim: Omit<Scrim, 'ourSide' | 'note'> }
  | { ok: false; reason: ReplaySkipReason; line: string };

/** Read one file's bytes into a scrim, or say why not. */
export function readReplay(
  fileName: string,
  bytes: ArrayBuffer,
  opts: { opponent?: string; lastModified: number; order: number }
): ReplayRead {
  const id = matchIdFromFilename(fileName);
  if (!id) return { ok: false, reason: 'no-id', line: `${fileName} — ${SKIP_LINE['no-id']}` };
  const replay = parseReplay(bytes);
  if (!replay) return { ok: false, reason: 'unreadable', line: `${fileName} — ${SKIP_LINE.unreadable}` };
  if (!looksLikeFiveOnFive(replay)) return { ok: false, reason: 'not-5v5', line: `${fileName} — ${SKIP_LINE['not-5v5']}` };
  return {
    ok: true,
    id,
    replay,
    scrim: {
      id,
      opponent: opts.opponent || undefined,
      // The replay knows how long the game ran but never when it started,
      // so the file's own timestamp is the closest thing to a date.
      playedOn: new Date(opts.lastModified).toISOString(),
      durationSec: replay.durationSec,
      blueWon: replay.blueWon,
      surrendered: replay.surrendered,
      players: replay.players.map((p) => ({ ...p })),
      objectives: { blue: { ...replay.objectives.blue }, red: { ...replay.objectives.red } },
      order: opts.order
    }
  };
}

/** The line to show when a batch is done. */
export function importReport(saved: number, opponent?: string): string {
  if (!saved) return 'Nothing imported.';
  return `Imported ${saved} ${saved === 1 ? 'scrim' : 'scrims'}${opponent ? ` against ${opponent}` : ''}.`;
}

/** What the drop zone says the files have to be, before anyone finds out the hard way. */
export const REPLAY_REQUIREMENTS = 'Documents › League of Legends › Replays. Keep the file name Riot gave it: the match id is read from it.';
