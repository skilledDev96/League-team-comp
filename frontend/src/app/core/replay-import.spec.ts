import { describe, expect, it } from 'vitest';
import { importReport, readReplay, SKIP_LINE } from './replay-import';

describe('readReplay', () => {
  it('names a file with no match id, and says what the name should be', () => {
    const got = readReplay('practice.rofl', new ArrayBuffer(0), { lastModified: 0, order: 1 });
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.reason).toBe('no-id');
      expect(got.line).toContain('practice.rofl');
      expect(got.line).toContain(SKIP_LINE['no-id']);
    }
  });

  it('names a file that is not a replay', () => {
    const got = readReplay('EUW1-7000000000.rofl', new ArrayBuffer(16), { lastModified: 0, order: 1 });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toBe('unreadable');
  });
});

describe('importReport', () => {
  it('counts what was saved, against whom', () => {
    expect(importReport(0)).toBe('Nothing imported.');
    expect(importReport(1, 'MOSS')).toBe('Imported 1 scrim against MOSS.');
    expect(importReport(3)).toBe('Imported 3 scrims.');
  });
});
