import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
  it('takes one letter from each of the first two parts of the local part, else the first two letters', () => {
    expect(initialsOf('ruan.hart@example.com')).toBe('RH');
    expect(initialsOf('ruan_hart')).toBe('RH');
    expect(initialsOf('rhdev96@gmail.com')).toBe('RH');
    expect(initialsOf('go10x')).toBe('GO');
  });

  it('never prints the address, and says ? for nothing', () => {
    expect(initialsOf('a.b.c@x.y')).toBe('AB');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('@x')).toBe('?');
  });
});
