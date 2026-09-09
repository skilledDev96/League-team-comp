import { describe, expect, it } from 'vitest';
import { mentionedSeat } from './champion-mention';

const players = [
  { seat: 'Top' as const, champion: 'Vi' },
  { seat: 'Mid' as const, champion: "Kai'Sa" },
  { seat: 'ADC' as const, champion: 'Miss Fortune' },
  { seat: 'Support' as const, champion: '' }
];

describe('mentionedSeat', () => {
  it('matches whole words, so Vi is not in vision', () => {
    expect(mentionedSeat('Our vision fell apart after ten', players)).toBeUndefined();
    expect(mentionedSeat('Vi carried the early game', players)).toBe('Top');
    expect(mentionedSeat("Vi's ganks landed", players)).toBe('Top');
  });

  it('joins two adjacent words for a two-word name and ignores punctuation in the champion', () => {
    expect(mentionedSeat('Miss Fortune ulted into three', players)).toBe('ADC');
    expect(mentionedSeat('KaiSa carried', players)).toBe('Mid');
    expect(mentionedSeat("Kai'Sa carried", players)).toBe('Mid');
  });

  it('takes the first seat in the order given and never an empty champion', () => {
    expect(mentionedSeat('Vi and Miss Fortune both fed', players)).toBe('Top');
    expect(mentionedSeat('', players)).toBeUndefined();
  });
});
