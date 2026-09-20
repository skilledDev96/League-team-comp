import { describe, expect, it } from 'vitest';
import {
  BAN_TEAMS,
  bansForTeam,
  banTeamAt,
  DRAFT_LENGTH,
  DRAFT_SEQUENCE,
  describeStep,
  draftProgress,
  isComplete,
  seatFor,
  stepAt,
  lastPickOfPhase,
  picksLeftInPhase
} from './draft-sequence';

/** Compact reading of the whole order, for asserting it in one go. */
const shape = DRAFT_SEQUENCE.map((s) => `${s.team[0]}${s.action[0]}`).join(' ');

describe('DRAFT_SEQUENCE', () => {
  it('is the competitive order: 3 bans each, 6 picks, 2 bans each, 4 picks', () => {
    expect(DRAFT_LENGTH).toBe(20);
    expect(shape).toBe(
      // bans 1        picks 1              bans 2        picks 2
      'bb rb bb rb bb rb ' + 'bp rp rp bp bp rp ' + 'rb bb rb bb ' + 'rp bp bp rp'
    );
  });

  it('gives each side ten actions — five bans and five picks', () => {
    for (const team of ['blue', 'red'] as const) {
      const mine = DRAFT_SEQUENCE.filter((s) => s.team === team);
      expect(mine.filter((s) => s.action === 'ban')).toHaveLength(5);
      expect(mine.filter((s) => s.action === 'pick')).toHaveLength(5);
    }
  });

  it('numbers each team\'s bans and picks from one, counting separately', () => {
    const bluePicks = DRAFT_SEQUENCE.filter((s) => s.team === 'blue' && s.action === 'pick');
    expect(bluePicks.map((s) => s.ordinal)).toEqual([1, 2, 3, 4, 5]);
    const redBans = DRAFT_SEQUENCE.filter((s) => s.team === 'red' && s.action === 'ban');
    expect(redBans.map((s) => s.ordinal)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives blue first pick and red last', () => {
    const picks = DRAFT_SEQUENCE.filter((s) => s.action === 'pick');
    expect(picks[0].team).toBe('blue');
    expect(picks.at(-1)!.team).toBe('red');
  });
});

describe('stepAt / isComplete', () => {
  it('reads the step at a position', () => {
    expect(stepAt(0)).toEqual({ team: 'blue', action: 'ban', ordinal: 1 });
    expect(stepAt(6)).toEqual({ team: 'blue', action: 'pick', ordinal: 1 });
    expect(stepAt(19)).toEqual({ team: 'red', action: 'pick', ordinal: 5 });
  });

  it('is over past the last step', () => {
    expect(stepAt(20)).toBeNull();
    expect(isComplete(20)).toBe(true);
    expect(isComplete(19)).toBe(false);
  });

  it('treats a game saved before the sequence existed as not yet started', () => {
    // Older games carry no position at all; they must open on step one rather
    // than crash or appear finished.
    expect(stepAt(undefined as unknown as number)).toEqual(DRAFT_SEQUENCE[0]);
    expect(stepAt(-3)).toEqual(DRAFT_SEQUENCE[0]);
  });
});

describe('draftProgress', () => {
  it('runs nought to a hundred across the draft', () => {
    expect(draftProgress(0)).toBe(0);
    expect(draftProgress(10)).toBe(50);
    expect(draftProgress(20)).toBe(100);
  });

  it('clamps rather than reporting past the end', () => {
    expect(draftProgress(99)).toBe(100);
    expect(draftProgress(-5)).toBe(0);
  });
});

describe('seatFor', () => {
  const empty = ['', '', '', '', ''];

  it('sends a pick to the lane it is actually played in', () => {
    expect(seatFor('Leona', empty)).toBe('Support');
    expect(seatFor('Vi', empty)).toBe('Jungle');
  });

  it('falls back to the first free seat when that lane is taken', () => {
    // Jungle already filled, so Vi has to go somewhere — Top is the first gap.
    const seats = ['', 'Sejuani', '', '', ''];
    expect(seatFor('Vi', seats)).toBe('Top');
  });

  it('uses the first free seat for a champion with no lane data', () => {
    expect(seatFor('Evelynn', empty)).toBe('Top');
  });

  it('gives nothing when every seat is full', () => {
    expect(seatFor('Vi', ['a', 'b', 'c', 'd', 'e'])).toBeNull();
  });

  it('prefers the real lane over the first gap', () => {
    // Top is free, but Leona is a support and belongs in the support seat.
    expect(seatFor('Leona', empty)).toBe('Support');
  });
});

describe('describeStep', () => {
  it('names the team, because sides swap between games', () => {
    expect(describeStep(DRAFT_SEQUENCE[0], 'Bom Squad', 'Noname')).toBe('Bom Squad ban 1');
    expect(describeStep(DRAFT_SEQUENCE[7], 'Bom Squad', 'Noname')).toBe('Noname pick 1');
  });
});

describe('BAN_TEAMS / banTeamAt', () => {
  it('gives each side five bans', () => {
    expect(BAN_TEAMS).toHaveLength(10);
    expect(BAN_TEAMS.filter((t) => t === 'blue')).toHaveLength(5);
    expect(BAN_TEAMS.filter((t) => t === 'red')).toHaveLength(5);
  });

  it('alternates in phase one and swaps who leads in phase two', () => {
    // Blue leads the first six; red leads the last four.
    expect(BAN_TEAMS.join(' ')).toBe('blue red blue red blue red red blue red blue');
  });

  it('reads the team for a stored ban position', () => {
    expect(banTeamAt(0)).toBe('blue');
    expect(banTeamAt(1)).toBe('red');
    expect(banTeamAt(6)).toBe('red');
    expect(banTeamAt(9)).toBe('blue');
  });

  it('gives nothing past the tenth ban rather than guessing', () => {
    expect(banTeamAt(10)).toBeNull();
  });
});

describe('bansForTeam', () => {
  // Ban order is blue red blue red blue red | red blue red blue.
  const ten = ['b1', 'r1', 'b2', 'r2', 'b3', 'r3', 'r4', 'b4', 'r5', 'b5'];

  it('splits a full ban list down the two sides', () => {
    expect(bansForTeam(ten, 'our', 'blue')).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    expect(bansForTeam(ten, 'their', 'blue')).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
  });

  it('swaps with the side, since blue is not always us', () => {
    expect(bansForTeam(ten, 'our', 'red')).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
    expect(bansForTeam(ten, 'their', 'red')).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
  });

  it('pads to five with gaps, so the count reads without counting', () => {
    // Three bans in: blue has two, red has one.
    expect(bansForTeam(['b1', 'r1', 'b2'], 'our', 'blue')).toEqual(['b1', 'b2', null, null, null]);
    expect(bansForTeam(['b1', 'r1', 'b2'], 'their', 'blue')).toEqual(['r1', null, null, null, null]);
  });

  it('gives five empty slots before anything is banned', () => {
    expect(bansForTeam([], 'our', 'blue')).toEqual([null, null, null, null, null]);
  });

  it('keeps everything on one side when the game was filled in freely', () => {
    // No side chosen means no ban order to read, so it must not be split on a
    // guess — half the bans would be attributed to the wrong team.
    expect(bansForTeam(['x', 'y'], 'our', undefined)).toEqual(['x', 'y', null, null, null]);
    expect(bansForTeam(['x', 'y'], 'their', undefined)).toEqual([null, null, null, null, null]);
  });

  it('grows past five for a free-form game that collected more', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(bansForTeam(many, 'our', undefined)).toHaveLength(7);
  });

  it('ignores blank entries rather than counting them as bans', () => {
    expect(bansForTeam(['b1', '', 'r1'], 'our', 'blue')).toEqual(['b1', null, null, null, null]);
  });

  it('keeps a ban nobody saw in its place, so every ban after it stays on the right side (17 Sep 2026)', () => {
    // Blue red blue red blue red: red's first and blue's third were not seen.
    const bans = ['b1', '-', 'b2', 'r2', '-', 'r3'];
    expect(bansForTeam(bans, 'our', 'blue')).toEqual(['b1', 'b2', '-', null, null]);
    expect(bansForTeam(bans, 'their', 'blue')).toEqual(['-', 'r2', 'r3', null, null]);
    expect(bansForTeam(bans, 'our', 'red')).toEqual(['-', 'r2', 'r3', null, null]);
  });
});

describe('lastPickOfPhase', () => {
  it('says nothing during a ban phase', () => {
    // There is nothing to counter with a ban; the question does not apply.
    expect(lastPickOfPhase(0)).toBeNull();
    expect(lastPickOfPhase(12)).toBeNull();
  });

  it('names the side that closes the first pick phase', () => {
    // bp rp rp bp bp rp — red closes it.
    expect(lastPickOfPhase(6)).toBe('red');
  });

  it('names the side that closes the second pick phase', () => {
    // rp bp bp rp — red again, which is what last pick means in this format.
    expect(lastPickOfPhase(16)).toBe('red');
  });

  it('gives the same answer from anywhere inside a phase', () => {
    for (const at of [6, 7, 8, 9, 10, 11]) expect(lastPickOfPhase(at)).toBe('red');
  });

  it('does not read across the bans into the next phase', () => {
    // Position 11 is the last pick of phase one; bans follow, not more picks.
    expect(picksLeftInPhase(11)).toBe(1);
  });
});

describe('picksLeftInPhase', () => {
  it('counts the pick on the clock as one of them', () => {
    expect(picksLeftInPhase(6)).toBe(6);
    expect(picksLeftInPhase(16)).toBe(4);
  });

  it('is zero where the phase is bans', () => {
    expect(picksLeftInPhase(0)).toBe(0);
  });
});

import { undoTarget } from './draft-sequence';

describe('undoTarget', () => {
  it('is nothing at the start, the last ban during the ban phase, and the last logged pick after', () => {
    expect(undoTarget({ draftStep: 0 })).toBeNull();
    expect(undoTarget({ draftStep: 2, bans: ['Ahri', 'Zed'] })).toEqual({ action: 'ban', champion: 'Zed' });
    expect(undoTarget({ draftStep: 7, bans: ['A', 'B', 'C', 'D', 'E', 'F'], pickLog: ['Ornn'] })).toEqual({ action: 'pick', champion: 'Ornn' });
    expect(undoTarget({ draftStep: 7, bans: [] })).toEqual({ action: 'pick', champion: null });
  });
});

import { positionOf } from './draft-sequence';

describe('positionOf', () => {
  it('trusts a stored step, reads a full board without one as over, and opens anything else at the start', () => {
    expect(positionOf({ draftStep: 4 })).toBe(4);
    expect(positionOf({ draftStep: 0, ourChampions: ['A', 'B', 'C', 'D', 'E'], theirChampions: ['F', 'G', 'H', 'I', 'J'] })).toBe(0);
    expect(positionOf({ ourChampions: ['A', 'B', 'C', 'D', 'E'], theirChampions: ['F', 'G', 'H', 'I', 'J'] })).toBe(DRAFT_LENGTH);
    expect(positionOf({ ourChampions: ['A', 'B', 'C', 'D', ''], theirChampions: ['F', 'G', 'H', 'I', 'J'] })).toBe(0);
    expect(positionOf({})).toBe(0);
  });
});

import { banPlaceWords, banWallClick, banWord, bansLeftInPhase, emptyEnterAction, heldLine, isNoBan, LOCK_AFTER_MS, NO_BAN, sequenceClosed } from './draft-sequence';
import { blockedSet, normalizeChampion } from './draft.util';

describe('NO_BAN', () => {
  it('is a ban step entered as not seen, and reads as words rather than a champion', () => {
    expect(isNoBan(NO_BAN)).toBe(true);
    expect(isNoBan('Akshan')).toBe(false);
    expect(isNoBan('')).toBe(false);
    expect(isNoBan(null)).toBe(false);
    expect(banWord(NO_BAN)).toBe('not seen');
    expect(banWord('Akshan')).toBe('Akshan');
  });
});

describe('bansLeftInPhase', () => {
  it('counts the ban on the clock and every ban up to the next pick', () => {
    expect(bansLeftInPhase(0)).toBe(6);
    expect(bansLeftInPhase(3)).toBe(3);
    expect(bansLeftInPhase(5)).toBe(1);
    expect(bansLeftInPhase(12)).toBe(4);
    expect(bansLeftInPhase(15)).toBe(1);
  });

  it('is zero on a pick, past the end, and for a position that is not one', () => {
    expect(bansLeftInPhase(6)).toBe(0);
    expect(bansLeftInPhase(16)).toBe(0);
    expect(bansLeftInPhase(DRAFT_LENGTH)).toBe(0);
    expect(bansLeftInPhase(-1)).toBe(0);
    expect(bansLeftInPhase(2.5)).toBe(0);
  });

  it('lands the draft on the first pick of the phase when written in one go', () => {
    for (const from of [0, 4, 12, 14]) {
      expect(stepAt(from + bansLeftInPhase(from))?.action).toBe('pick');
    }
  });
});

describe('sequenceClosed — what the test aids may not choose', () => {
  it('closes what was burned, what either side drafted and every ban made, on a ban step too', () => {
    const closed = sequenceClosed({ bans: ['Akshan', '-', ''], ourChampions: ['Ornn', ''], theirChampions: ['Sion'] }, ['Jinx']);
    expect(blockedSet(closed)).toEqual(blockedSet(['Jinx', 'Ornn', 'Sion', 'Akshan']));
  });

  it('never bans one champion twice when Skip bans runs through a phase (Paradox Requiem game 1 banned Akshan twice)', () => {
    const wall = ['Akshan', 'Draven', 'Caitlyn', 'Aurelion Sol', 'Riven', 'Ambessa', 'Yuumi'];
    const game = { bans: [] as string[], ourChampions: [] as string[], theirChampions: [] as string[] };
    for (let step = 0; step < bansLeftInPhase(0); step += 1) {
      const blocked = blockedSet(sequenceClosed(game, []));
      const choice = wall.find((c) => !blocked.has(normalizeChampion(c)));
      game.bans.push(choice!);
    }
    expect(game.bans).toEqual(['Akshan', 'Draven', 'Caitlyn', 'Aurelion Sol', 'Riven', 'Ambessa']);
    expect(new Set(game.bans).size).toBe(game.bans.length);
  });
});

describe('heldLine', () => {
  it('names their pick and their seat, in the colour of the side picking (13 Sep 2026: our Jinx into their step)', () => {
    // Step 8 is red's first pick; we are blue.
    expect(heldLine(DRAFT_SEQUENCE[7], 'blue', 'Jinx', 'ADC')).toEqual({ who: 'their', colour: 'red', step: 'pick 1', champion: 'Jinx', seat: 'their ADC' });
    // The longest line the room draws: red's fifth pick, the last step of the draft.
    expect(heldLine(DRAFT_SEQUENCE[19], 'blue', 'Aurelion Sol', 'Support')).toEqual({ who: 'their', colour: 'red', step: 'pick 5', champion: 'Aurelion Sol', seat: 'their Support' });
  });

  it('names our ban with no seat, and a ban nobody saw in words', () => {
    // Step 5 is blue's third ban.
    expect(heldLine(DRAFT_SEQUENCE[4], 'blue', 'Yuumi', null)).toEqual({ who: 'our', colour: 'blue', step: 'ban 3', champion: 'Yuumi', seat: null });
    // Step 3 is blue's second ban.
    expect(heldLine(DRAFT_SEQUENCE[2], 'blue', NO_BAN, null)).toEqual({ who: 'our', colour: 'blue', step: 'ban 2', champion: 'Ban not seen', seat: null });
    // On red, the same step is theirs.
    expect(heldLine(DRAFT_SEQUENCE[2], 'red', NO_BAN, null)?.who).toBe('their');
  });

  it('gives our seat on our pick, and nothing without a step, a side or a champion', () => {
    expect(heldLine(DRAFT_SEQUENCE[6], 'blue', 'Ornn', 'Top')?.seat).toBe('our Top');
    expect(heldLine(DRAFT_SEQUENCE[6], 'blue', 'Ornn', null)?.seat).toBeNull();
    expect(heldLine(null, 'blue', 'Ornn', 'Top')).toBeNull();
    expect(heldLine(DRAFT_SEQUENCE[6], undefined, 'Ornn', 'Top')).toBeNull();
    expect(heldLine(DRAFT_SEQUENCE[6], 'blue', '', 'Top')).toBeNull();
  });
});

describe('banPlaceWords', () => {
  it('says whose ban a place in the list is, read off the sequence', () => {
    expect(banPlaceWords(0, 'blue')).toBe('our ban 1');
    expect(banPlaceWords(1, 'blue')).toBe('their ban 1');
    // Ban 13 of the draft opens the second phase, and red bans first there.
    expect(banPlaceWords(6, 'blue')).toBe('their ban 4');
    expect(banPlaceWords(7, 'red')).toBe('their ban 4');
    expect(banPlaceWords(9, 'blue')).toBe('our ban 5');
  });

  it('says nothing past the tenth ban or without a side', () => {
    expect(banPlaceWords(10, 'blue')).toBeNull();
    expect(banPlaceWords(-1, 'blue')).toBeNull();
    expect(banPlaceWords(0, undefined)).toBeNull();
  });
});

describe('banWallClick — the wall on a finished or free-form board', () => {
  // Rest of phase not seen at ban 13, then the draft ran to the end.
  const finished = ['Akshan', 'Draven', 'Caitlyn', 'Riven', 'Ambessa', 'Yuumi', NO_BAN, NO_BAN, NO_BAN, NO_BAN];

  it('fills the first ban nobody saw in place once all ten are in, in the order the client shows them', () => {
    const first = banWallClick(finished, -1, 'Rell', 'blue', 10);
    expect(first).toEqual({ bans: ['Akshan', 'Draven', 'Caitlyn', 'Riven', 'Ambessa', 'Yuumi', 'Rell', NO_BAN, NO_BAN, NO_BAN], filled: 6 });
    const second = banWallClick(first.bans, -1, 'Leona', 'blue', 10);
    expect(second.bans.slice(6)).toEqual(['Rell', 'Leona', NO_BAN, NO_BAN]);
    expect(second.filled).toBe(7);
    expect(finished[6]).toBe(NO_BAN);
  });

  it('takes a ban off a drafted board as not seen, so no later ban changes sides', () => {
    expect(banWallClick(finished, 1, 'Draven', 'blue', 10)).toEqual({
      bans: ['Akshan', NO_BAN, 'Caitlyn', 'Riven', 'Ambessa', 'Yuumi', NO_BAN, NO_BAN, NO_BAN, NO_BAN],
      filled: null
    });
    // Clicked again, the champion goes back where it was: the first ban nobody saw.
    expect(banWallClick(banWallClick(finished, 1, 'Draven', 'blue', 10).bans, -1, 'Draven', 'blue', 10).bans[1]).toBe('Draven');
  });

  it('keeps the free-form board as it was: off closes the gap, on adds at the end, and full is full', () => {
    expect(banWallClick(['Ahri', 'Zed', 'Jinx'], 1, 'Zed', undefined, 10)).toEqual({ bans: ['Ahri', 'Jinx'], filled: null });
    expect(banWallClick(['Ahri'], -1, 'Zed', undefined, 10)).toEqual({ bans: ['Ahri', 'Zed'], filled: null });
    const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    expect(banWallClick(full, -1, 'Zed', 'blue', 10)).toEqual({ bans: full, filled: null });
  });
});

describe('emptyEnterAction — Enter in the wall\'s empty search box', () => {
  it('holds a ban nobody saw on a ban step with nothing held, and confirms it once held', () => {
    expect(emptyEnterAction('ban', null, false)).toBe('hold');
    expect(emptyEnterAction('ban', '', false)).toBe('hold');
    expect(emptyEnterAction('ban', NO_BAN, false)).toBe('confirm');
  });

  it('locks a held champion on the second Enter, on a ban step and on a pick step (21 Sep 2026)', () => {
    // Typing a name and pressing Enter holds it and clears the box, so the next Enter lands here.
    expect(emptyEnterAction('ban', 'Akshan', false, 400)).toBe('confirm');
    expect(emptyEnterAction('pick', 'Jinx', false, 400)).toBe('confirm');
  });

  it('will not lock a champion held a moment ago, so one double tap cannot confirm it', () => {
    expect(emptyEnterAction('ban', 'Akshan', false, 0)).toBe('none');
    expect(emptyEnterAction('pick', 'Jinx', false, LOCK_AFTER_MS - 1)).toBe('none');
    expect(emptyEnterAction('pick', 'Jinx', false, LOCK_AFTER_MS)).toBe('confirm');
  });

  it('locks a not-seen ban at once, since its own first Enter was the empty box', () => {
    expect(emptyEnterAction('ban', NO_BAN, false, 0)).toBe('confirm');
  });

  it('does nothing with an empty hand on a pick step, with no sequence, or while a made ban or seat is aimed at', () => {
    // A pick nobody saw is not a thing: it would hide a real champion from the burn, the advisor and the lockouts.
    expect(emptyEnterAction('pick', null, false)).toBe('none');
    expect(emptyEnterAction('pick', NO_BAN, false)).toBe('none');
    expect(emptyEnterAction(undefined, null, false)).toBe('none');
    expect(emptyEnterAction(null, NO_BAN, false)).toBe('none');
    expect(emptyEnterAction('ban', null, true)).toBe('none');
    expect(emptyEnterAction('ban', NO_BAN, true)).toBe('none');
  });
});
