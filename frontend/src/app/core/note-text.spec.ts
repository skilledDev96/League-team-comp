import { describe, expect, it } from 'vitest';
import { noteLines, noteParts } from './note-text';

describe('noteParts', () => {
  it('turns an http URL into a link and leaves the words around it as text', () => {
    expect(noteParts('see https://example.com/x for the vod')).toEqual([
      { text: 'see ', href: null },
      { text: 'https://example.com/x', href: 'https://example.com/x' },
      { text: ' for the vod', href: null }
    ]);
  });

  it('leaves trailing punctuation outside the link', () => {
    const parts = noteParts('(https://example.com/a).');
    expect(parts.map((p) => p.href)).toEqual([null, 'https://example.com/a', null]);
    expect(parts[2].text).toBe(').');
  });

  it('never links anything but http and https', () => {
    // A javascript: string must stay inert text.
    expect(noteParts('javascript:alert(1)').every((p) => p.href === null)).toBe(true);
  });

  it('is empty for nothing', () => {
    expect(noteParts(undefined)).toEqual([]);
    expect(noteParts('')).toEqual([]);
  });
});

describe('noteLines', () => {
  it('keeps typed newlines as separate lines', () => {
    expect(noteLines('one\ntwo').map((l) => l.parts[0].text)).toEqual(['one', 'two']);
  });

  it('reads "- " and "* " as bullets and strips the marker', () => {
    const lines = noteLines('- bans first\n* then picks\nplain');
    expect(lines.map((l) => l.bullet)).toEqual([true, true, false]);
    expect(lines[0].parts[0].text).toBe('bans first');
  });

  it('survives Windows line endings', () => {
    expect(noteLines('a\r\nb')).toHaveLength(2);
  });
});
