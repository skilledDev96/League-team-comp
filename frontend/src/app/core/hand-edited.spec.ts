import { describe, expect, it } from 'vitest';
import { Player } from '../models/team.models';
import { handEdited } from './hand-edited';

const stored: Player = {
  id: 'p1',
  name: 'Go10x',
  role: 'Top',
  strengths: ['Lane pressure'],
  weaknesses: ['Vision'],
  top3: ['Aatrox', 'Camille', 'Jax'],
  bans: ['Darius'],
  playstyle: 'Splits and shoves.',
  icon: 'https://example.test/icon.png',
  order: 1
};

describe('handEdited', () => {
  it('is not set by a seat change alone', () => {
    expect(handEdited(stored, { ...stored, role: 'Jungle' })).toBe(false);
  });

  it('is not set by the bench flag or a second seat', () => {
    expect(handEdited(stored, { ...stored, sub: true })).toBe(false);
    expect(handEdited(stored, { ...stored, secondaryRoles: ['Mid'] })).toBe(false);
  });

  it('is set when the text, the pool, the bans or the icon change by hand', () => {
    expect(handEdited(stored, { ...stored, playstyle: 'Farms and scales.' })).toBe(true);
    expect(handEdited(stored, { ...stored, strengths: ['Lane pressure', 'Teleport plays'] })).toBe(true);
    expect(handEdited(stored, { ...stored, top3: ['Camille', 'Aatrox', 'Jax'] })).toBe(true);
    expect(handEdited(stored, { ...stored, bans: [] })).toBe(true);
    expect(handEdited(stored, { ...stored, icon: 'https://example.test/other.png' })).toBe(true);
  });

  it('ignores whitespace and untouched fields', () => {
    expect(handEdited(stored, { ...stored, playstyle: '  Splits and shoves. ', top3: ['Aatrox ', ' Camille', 'Jax'] })).toBe(false);
    expect(handEdited(stored, { role: 'Mid' })).toBe(false);
  });

  it('stays set once a player is hand-edited, whatever the save touches', () => {
    expect(handEdited({ ...stored, curated: true }, { ...stored, role: 'Support' })).toBe(true);
  });

  it('treats a new player from the editor as hand-edited, as before', () => {
    expect(handEdited(undefined, { name: 'New', role: 'Mid' })).toBe(true);
  });
});
