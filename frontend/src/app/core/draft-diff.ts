/**
 * What changed between two saves of a series game, in words.
 *
 * The draft room writes the whole game on every action, so the room itself
 * never has to say what it did — and when a teammate reports "something went
 * wrong in the draft" the next morning, nobody can say what happened either
 * (8 Sep 2026). Diffing the two saves at the one place every write passes
 * through records every action from every page, with no call site to forget.
 *
 * Pure. The service adds who and when and writes the result.
 */
import { SeriesGame } from '../models/team.models';

const SEATS = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as const;

export type DraftChangeKind =
  | 'side'
  | 'ban'
  | 'ban-replaced'
  | 'ban-removed'
  | 'pick'
  | 'pick-replaced'
  | 'pick-removed'
  | 'swap'
  | 'skip'
  | 'reset'
  | 'result'
  | 'advice'
  | 'step';

export interface DraftChange {
  readonly kind: DraftChangeKind;
  readonly note: string;
}

const list = (a: readonly (string | undefined)[] | undefined) => (a ?? []).map((c) => c ?? '');

function pickChanges(side: 'our' | 'their', before: string[], after: string[], undo: boolean): DraftChange[] {
  const out: DraftChange[] = [];
  const who = side === 'our' ? 'our' : 'their';
  const n = Math.max(before.length, after.length);
  const gone: number[] = [];
  const came: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const b = before[i] ?? '';
    const a = after[i] ?? '';
    if (b === a) continue;
    if (b && a) out.push({ kind: 'pick-replaced', note: `Replaced ${who} ${SEATS[i] ?? i + 1} ${b} with ${a}` });
    else if (a) came.push(i);
    else gone.push(i);
  }
  // Two seats trading champions is a swap, not a removal and a pick.
  if (gone.length === 0 && came.length === 0) {
    const swapped = out.filter((c) => c.kind === 'pick-replaced');
    if (swapped.length === 2) {
      const [x, y] = [0, 1].map((k) => swapped[k].note.match(/ (\S+) with (\S+)$/));
      if (x && y && x[1] === y[2] && x[2] === y[1]) {
        return [{ kind: 'swap', note: `Swapped ${who} ${x[1]} and ${x[2]}` }];
      }
    }
    return out;
  }
  for (const i of came) out.push({ kind: 'pick', note: `${who === 'our' ? 'Our' : 'Their'} ${SEATS[i] ?? i + 1}: ${after[i]}` });
  for (const i of gone) {
    out.push({ kind: 'pick-removed', note: `${undo ? 'Undo: removed' : 'Removed'} ${who} ${SEATS[i] ?? i + 1} ${before[i]}` });
  }
  return out;
}

export function describeGameChange(before: SeriesGame | undefined, after: SeriesGame): DraftChange[] {
  if (!before) return [{ kind: 'step', note: `Game ${after.gameNumber} created` }];
  const out: DraftChange[] = [];

  const hadBoard =
    list(before.bans).some(Boolean) || list(before.ourChampions).some(Boolean) || list(before.theirChampions).some(Boolean);
  const hasBoard =
    list(after.bans).some(Boolean) || list(after.ourChampions).some(Boolean) || list(after.theirChampions).some(Boolean);
  if (hadBoard && !hasBoard && after.draftStep === undefined) {
    out.push({ kind: 'reset', note: 'Reset: every ban and pick cleared' });
  }

  if (before.ourSide !== after.ourSide && after.ourSide) {
    out.push({ kind: 'side', note: `Side set to ${after.ourSide}` });
  }

  const stepBefore = before.draftStep ?? 0;
  const stepAfter = after.draftStep ?? 0;
  const undo = stepAfter < stepBefore;

  if (!out.some((c) => c.kind === 'reset')) {
    const b = list(before.bans);
    const a = list(after.bans);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      if (b[i] === a[i]) continue;
      if (b[i] && a[i]) out.push({ kind: 'ban-replaced', note: `Replaced ban ${i + 1} ${b[i]} with ${a[i]}` });
      else if (a[i]) out.push({ kind: 'ban', note: `Ban ${i + 1}: ${a[i]}` });
      else out.push({ kind: 'ban-removed', note: `${undo ? 'Undo: removed' : 'Removed'} ban ${i + 1} ${b[i]}` });
    }
    out.push(...pickChanges('our', list(before.ourChampions), list(after.ourChampions), undo));
    out.push(...pickChanges('their', list(before.theirChampions), list(after.theirChampions), undo));
  }

  if (before.win !== after.win) {
    out.push({ kind: 'result', note: after.win === undefined ? 'Result cleared' : `Result: ${after.win ? 'win' : 'loss'}` });
  }

  if (after.advice && after.advice.askedAt !== before.advice?.askedAt) {
    const first = after.advice.picks[0]?.champion ?? after.advice.bans[0]?.champion;
    out.push({ kind: 'advice', note: `Advisor answered at step ${after.advice.step + 1}${first ? `: ${first}` : ''}` });
  }

  const boardMoved = out.some((c) => c.kind !== 'advice' && c.kind !== 'result' && c.kind !== 'side');
  if (stepAfter !== stepBefore && !boardMoved) {
    out.push(
      stepAfter > stepBefore + 1
        ? { kind: 'skip', note: `Skipped from step ${stepBefore + 1} to ${stepAfter + 1}` }
        : { kind: 'step', note: `Step ${stepBefore + 1} → ${stepAfter + 1}` }
    );
  }
  return out;
}
