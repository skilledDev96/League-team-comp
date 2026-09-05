import { describe, expect, it } from 'vitest';
import { ADVICE_SCHEMA, buildDraftPrompt, parseAdvice, parseDraftAdviceRequest } from './draft-advice';

const minimal = {
  action: 'pick',
  candidates: ['Ornn', 'Sion'],
  ourPicks: { Jungle: 'Jarvan IV' },
  theirPicks: { Top: 'Aatrox', Bogus: 'x' }
};

describe('parseDraftAdviceRequest', () => {
  it('refuses anything without an action or candidates', () => {
    expect(() => parseDraftAdviceRequest(null)).toThrow(/JSON object/);
    expect(() => parseDraftAdviceRequest({ candidates: ['Ornn'] })).toThrow(/action/);
    expect(() => parseDraftAdviceRequest({ action: 'pick', candidates: [] })).toThrow(/candidates/);
  });

  it('keeps only the five seats in a pick map and defaults the rest', () => {
    const req = parseDraftAdviceRequest(minimal);
    expect(req.ourPicks).toEqual({ Jungle: 'Jarvan IV' });
    expect(req.theirPicks).toEqual({ Top: 'Aatrox' });
    expect(req.turn).toBe('our');
    expect(req.teamName).toBe('Us');
    expect(req.ourSide).toBeNull();
    expect(req.comps).toEqual([]);
  });

  it('drops a roster row without a known role and trims the rest', () => {
    const req = parseDraftAdviceRequest({
      ...minimal,
      theirRoster: [
        { name: 'A', role: 'Top', pool: ['Aatrox'], records: [{ champion: 'Aatrox', games: '12', wins: 7 }, { champion: '' }], counters: ['Fiora'] },
        { name: 'B', role: 'Coach' }
      ]
    });
    expect(req.theirRoster).toHaveLength(1);
    expect(req.theirRoster[0].records).toEqual([{ champion: 'Aatrox', games: 12, wins: 7 }]);
    expect(req.theirRoster[0].counters).toEqual(['Fiora']);
  });

  it('caps the candidate list and the notes', () => {
    const many = Array.from({ length: 120 }, (_, i) => `Champ${i}`);
    const req = parseDraftAdviceRequest({ ...minimal, candidates: many, notes: 'x'.repeat(5000) });
    expect(req.candidates).toHaveLength(80);
    expect(req.notes).toHaveLength(1500);
  });
});

describe('buildDraftPrompt', () => {
  it('asks the question for our pick and ends with the candidate list', () => {
    const prompt = buildDraftPrompt(
      parseDraftAdviceRequest({ ...minimal, seat: 'Top', stepNumber: 7, teamName: 'Bom Squad', opponent: 'MAD', ourSide: 'blue' })
    );
    expect(prompt.startsWith('QUESTION: We are picking for Top (step 7).')).toBe(true);
    expect(prompt).toContain('SERIES: Bom Squad vs MAD. We are on blue side.');
    expect(prompt).toContain('OUR PICKS: Top: —, Jungle: Jarvan IV');
    expect(prompt.trim().endsWith('CANDIDATES (the only champions you may name): Ornn, Sion')).toBe(true);
  });

  it('says what a broken comp is missing and what their players lose to', () => {
    const prompt = buildDraftPrompt(
      parseDraftAdviceRequest({
        ...minimal,
        action: 'ban',
        comps: [{ name: 'Engage', champions: ['Ornn', 'Jarvan IV'], winRate: 60, games: 5, playable: false, blocked: ['Ornn'] }],
        theirRoster: [{ name: 'A', role: 'Top', pool: ['Aatrox'], counters: ['Fiora'] }],
        lanes: [{ lane: 'Top', verdict: 'weak', score: -9, reasons: ['Aatrox is a main for them'] }]
      })
    );
    expect(prompt).toContain('QUESTION: We are banning (ban 1).');
    expect(prompt).toContain('- Engage: Ornn, Jarvan IV — 60% over 5; BROKEN, missing Ornn');
    expect(prompt).toContain('- Top A: plays Aatrox; loses to Fiora');
    expect(prompt).toContain('- Top: weak (-9) — Aatrox is a main for them');
  });
});

describe('parseAdvice', () => {
  it('drops a champion the drafter cannot take and keeps the candidate spelling', () => {
    const advice = parseAdvice(
      {
        summary: 'Take the tank.',
        picks: [
          { champion: 'ornn', seat: 'Top', why: 'fits Engage', confidence: 'high' },
          { champion: 'Yone', seat: 'Top', why: 'banned though', confidence: 'high' }
        ],
        bans: [{ champion: 'SION', why: 'their comfort' }, { champion: 'Aatrox', why: 'not a candidate' }],
        watch: ['They may flex Aatrox mid', 42]
      },
      ['Ornn', 'Sion']
    );
    expect(advice.picks).toEqual([{ champion: 'Ornn', seat: 'Top', why: 'fits Engage', confidence: 'high' }]);
    expect(advice.bans).toEqual([{ champion: 'Sion', why: 'their comfort' }]);
    expect(advice.watch).toEqual(['They may flex Aatrox mid']);
  });

  it('survives garbage', () => {
    expect(parseAdvice(null, ['Ornn'])).toEqual({ summary: '', picks: [], bans: [], watch: [] });
  });
});

describe('ADVICE_SCHEMA', () => {
  it('forbids extra fields at every level', () => {
    expect(ADVICE_SCHEMA.additionalProperties).toBe(false);
    expect(ADVICE_SCHEMA.properties.picks.items.additionalProperties).toBe(false);
    expect(ADVICE_SCHEMA.properties.bans.items.additionalProperties).toBe(false);
  });

  it('carries no array-size constraints, which the structured-output API rejects', () => {
    // Seen live on 5 Sep 2026: "For 'array' type, property 'maxItems' is not
    // supported" (400). The cap of three lives in parseAdvice and the prompt.
    expect(JSON.stringify(ADVICE_SCHEMA)).not.toMatch(/maxItems|minItems/);
  });
});
