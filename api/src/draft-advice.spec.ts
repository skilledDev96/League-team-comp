import { describe, expect, it } from 'vitest';
import { ADVICE_SCHEMA, ADVISOR_SYSTEM, buildDraftPrompt, parseAdvice, parseDraftAdviceRequest } from './draft-advice';

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

  it('drops a roster row without a known role and keeps only the seat and the pool of theirs', () => {
    // Since 26 Sep 2026 their records and counters are not kept at all (see the opponent tests below).
    const req = parseDraftAdviceRequest({
      ...minimal,
      theirRoster: [
        { name: 'A', role: 'Top', pool: ['Aatrox'], records: [{ champion: 'Aatrox', games: '12', wins: 7 }, { champion: '' }], counters: ['Fiora'] },
        { name: 'B', role: 'Coach' }
      ]
    });
    expect(req.theirRoster).toEqual([{ role: 'Top', pool: ['Aatrox'] }]);
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
    expect(prompt).toContain('SERIES: Bom Squad vs the other team. We are on blue side.');
    expect(prompt).toContain('OUR PICKS: Top: —, Jungle: Jarvan IV');
    expect(prompt.trim().endsWith('CANDIDATES (the only champions you may name): Ornn, Sion')).toBe(true);
  });

  it('says what a broken comp is missing, what their seat plays and how the lane reads', () => {
    // Until 26 Sep 2026 this line read "- Top A: plays Aatrox; loses to Fiora", and the lane reason was
    // "Aatrox is a main for them": both came from one opponent player's own games, and neither is sent now.
    const prompt = buildDraftPrompt(
      parseDraftAdviceRequest({
        ...minimal,
        action: 'ban',
        comps: [{ name: 'Engage', champions: ['Ornn', 'Jarvan IV'], winRate: 60, games: 5, playable: false, blocked: ['Ornn'] }],
        theirRoster: [{ name: 'A', role: 'Top', pool: ['Aatrox'], counters: ['Fiora'] }],
        lanes: [{ lane: 'Top', verdict: 'weak', score: -9, reasons: ['Ornn into Aatrox wins 45% over 1,200 games'] }],
        lanesWithoutTheirComfort: true
      })
    );
    expect(prompt).toContain('QUESTION: We are banning (ban 1).');
    expect(prompt).toContain('- Engage: Ornn, Jarvan IV — 60% over 5; BROKEN, a seat has nothing left (Ornn gone)');
    expect(prompt).toContain('- Top: plays Aatrox');
    expect(prompt).not.toContain('loses to');
    expect(prompt).toContain('- Top: weak (-9) — Ornn into Aatrox wins 45% over 1,200 games');
  });

  it('says a comp is running a fallback rather than reading as a contradiction', () => {
    // A seat can hold fallbacks since 20 Sep 2026: Dive keeps Leona behind Nautilus, so it is still playable
    // with Nautilus gone. The old wording (playable = every champion available) made that line read as a
    // contradiction — playable, with a champion listed as blocked.
    const prompt = buildDraftPrompt(
      parseDraftAdviceRequest({
        ...minimal,
        action: 'pick',
        comps: [{ name: 'Dive', champions: ['Camille', 'Vi', 'Ahri', 'Kaisa', 'Leona'], winRate: 70, games: 10, playable: true, blocked: ['Nautilus'] }]
      })
    );
    expect(prompt).toContain('- Dive: Camille, Vi, Ahri, Kaisa, Leona — 70% over 10; on a fallback, Nautilus gone');
    expect(prompt).toContain('playable = every seat can still field one of its champions');
  });
});

describe('the other team as champions in seats only (26 Sep 2026)', () => {
  // What a draft room built before 26 Sep 2026 sends, and a tab left open across the deploy still does:
  // each opponent's Riot game name, rank, per-champion record, counters and mastery, and the team's name.
  // The ticket to Riot of that day says the advisor sends the other team as champions in seats only, and
  // the server is what makes that true, so every value below is distinctive enough to search the prompt for.
  const staleTab = {
    ...minimal,
    teamName: 'Bom Squad',
    opponent: 'MAD Synergy',
    ourRoster: [{ name: 'Ruan', role: 'Top', pool: ['Ornn', 'Sion'] }],
    theirRoster: [
      {
        name: 'Zzqopponent',
        role: 'Top',
        rank: 'Emerald II',
        pool: ['Aatrox', 'Renekton', 'Gnar'],
        records: [{ champion: 'Aatrox', games: 12, wins: 7 }],
        counters: ['Kayle'],
        mastery: [{ champion: 'Aatrox', level: 7, points: 412345 }]
      },
      { name: 'Qqzjungler', role: 'Jungle', rank: 'Diamond IV', pool: ['Vi', 'Sejuani'], records: [{ champion: 'Vi', games: 20, wins: 11 }] }
    ]
  };
  const leaked = ['Zzqopponent', 'Qqzjungler', 'Emerald II', 'Diamond IV', '7/12', '11/20', 'M7 412k', 'MAD Synergy', 'Kayle'];

  it('prints their roster as seats and pools and nothing about the players', () => {
    const prompt = buildDraftPrompt(parseDraftAdviceRequest(staleTab));
    for (const value of leaked) expect(prompt, value).not.toContain(value);
    expect(prompt).not.toMatch(/loses to|mastery/i);
    expect(prompt).toContain('- Top: plays Aatrox, Renekton, Gnar');
    expect(prompt).toContain('- Jungle: plays Vi, Sejuani');
    // Our own players are still named: that part is disclosed.
    expect(prompt).toContain('- Top Ruan: Ornn, Sion');
  });

  it('keeps nothing of theirs but seats and pools on the parsed request itself', () => {
    const req = parseDraftAdviceRequest(staleTab);
    expect(req.theirRoster).toEqual([
      { role: 'Top', pool: ['Aatrox', 'Renekton', 'Gnar'] },
      { role: 'Jungle', pool: ['Vi', 'Sejuani'] }
    ]);
    const json = JSON.stringify(req);
    for (const value of leaked) expect(json, value).not.toContain(value);
  });

  it('calls the other team "the other team", never by the name the request carries', () => {
    const prompt = buildDraftPrompt(parseDraftAdviceRequest({ ...staleTab, ourSide: 'red' }));
    expect(prompt).toContain('SERIES: Bom Squad vs the other team. We are on red side.');
    expect(prompt).not.toContain('MAD Synergy');
  });

  it('replaces the names a stale tab sends in the notes with their seat and the team name with a label', () => {
    const prompt = buildDraftPrompt(
      parseDraftAdviceRequest({
        ...staleTab,
        theirRoster: [...staleTab.theirRoster, { name: 'Ren', role: 'Support', riotTag: 'EUW', pool: [] }],
        notes: 'Zzqopponent#EUW1 mains Aatrox. MAD Synergy take early dragons. zzqOPPONENT roams; Ren #EUW is loud, Renekton is fine.'
      })
    );
    expect(prompt).toContain(
      'their Top mains Aatrox. the other team take early dragons. their Top roams; their Support is loud, Renekton is fine.'
    );
    expect(prompt).not.toMatch(/zzqopponent|EUW1|MAD Synergy/i);
  });

  it('takes the game name alone out of the notes when a row holds the whole Riot ID in its name', () => {
    const req = parseDraftAdviceRequest({
      ...staleTab,
      theirRoster: [{ name: 'Qqzhand#EUW', role: 'Jungle', pool: ['Vi'] }],
      notes: 'Qqzhand#EUW mains Vi; qqzhand invades.'
    });
    expect(req.notes).toBe('their Jungle mains Vi; their Jungle invades.');
  });

  it('redacts before it cuts the notes to length, so no half of a name survives the cut', () => {
    const req = parseDraftAdviceRequest({ ...staleTab, notes: `${'x'.repeat(1495)} Zzqopponent is their shotcaller` });
    expect(req.notes).toHaveLength(1500);
    expect(req.notes).not.toMatch(/zzq/i);
  });

  it("drops every lane of a request that does not say it read them without their players' comfort", () => {
    // The stale room sent the first three reasons of a lane, sorted by size, and Bot joins the ADC's reasons
    // before the Support's: here "Nautilus is a main for them (40 games, 55%)" was cut in the browser while its
    // -8 stayed in the score. Nothing in the three sentences left shows it, so the lanes go whole.
    const prompt = buildDraftPrompt(
      parseDraftAdviceRequest({
        ...staleTab,
        lanes: [
          {
            lane: 'Bot',
            verdict: 'weak',
            score: -10,
            reasons: [
              'Jinx into Caitlyn wins 46% over 3,000 games',
              'Jinx sits at 49% in solo queue against Caitlyn at 51%',
              'Jinx is a main for us'
            ]
          },
          { lane: 'Mid', verdict: 'even', score: 2, reasons: ['Ahri sits at 51% in solo queue against Syndra at 49%'] }
        ]
      })
    );
    expect(prompt).not.toContain('LANE READ');
    expect(prompt).not.toContain('- Bot: weak');
    expect(prompt).not.toContain('- Mid: even');
  });

  it("keeps a current room's lanes, and still drops one that carries their players' comfort", () => {
    const prompt = buildDraftPrompt(
      parseDraftAdviceRequest({
        ...minimal,
        lanesWithoutTheirComfort: true,
        lanes: [
          { lane: 'Top', verdict: 'weak', score: -17, reasons: ['Ornn into Aatrox wins 45% over 1,200 games', 'Aatrox is a main for them (12 games, 58%)'] },
          { lane: 'Jungle', verdict: 'strong', score: 9, reasons: ["Kindred is not in their player's recent pool"] },
          { lane: 'Mid', verdict: 'even', score: 2, reasons: ['Ahri sits at 51% in solo queue against Syndra at 49%'] }
        ]
      })
    );
    expect(prompt).not.toMatch(/main for them|their pool|recent pool|12 games/);
    expect(prompt).not.toContain('- Top: weak');
    expect(prompt).not.toContain('- Jungle: strong');
    expect(prompt).toContain('- Mid: even (+2) — Ahri sits at 51% in solo queue against Syndra at 49%');
  });

  it('replaces every link in the notes, where a Riot ID is spelled with + and %23 and no name pattern finds it', () => {
    // The fixtures of frontend/src/app/core/riot-id.spec.ts: a roster arrives as an op.gg multi-search link
    // because the league rulebook requires one. A current room sends the server no names, so this is the only
    // thing standing between that link and the model.
    const multi =
      'https://op.gg/sv/lol/multisearch/euw?summoners=MOSS+drakexo%23hwei%2CMOSS+Lilleman%23Mt7%2CMOSS+Tr%C3%A4kol%23R%C3%84Ka%2CMOSS+St4mpe%23MT7%2CMOSS+Seldurin%23MT7';
    const req = parseDraftAdviceRequest({
      ...minimal,
      notes: `Their op.gg: ${multi}. One of them: https://op.gg/summoners/kr/Hide%20on%20bush-KR1 and www.op.gg/summoners/euw/Some-Name-EUW, bare op.gg/summoners/euw/Other-Name-EUW (and u.gg/lol/profile/euw1/qqzthird-euw/overview). Ban Aatrox.`
    });
    expect(req.notes).toBe('Their op.gg: [link]. One of them: [link] and [link], bare [link] (and [link]). Ban Aatrox.');
    const prompt = buildDraftPrompt(req);
    for (const value of ['drakexo', 'Lilleman', 'Tr%C3%A4kol', 'St4mpe', 'Seldurin', 'hwei', 'Hide%20on%20bush', 'KR1', 'Some-Name', 'Other-Name', 'qqzthird']) {
      expect(prompt, value).not.toContain(value);
    }
  });

  it('replaces a rank written in the notes, and leaves the game words a tier shares', () => {
    const req = parseDraftAdviceRequest({
      ...minimal,
      notes: 'Their Top is Emerald II, jungle plat 4 (75 LP), mid 450LP, support Master 212 LP. Master Yi is banned; a gold lead wins.'
    });
    expect(req.notes).toBe('Their Top is [rank], jungle [rank], mid [rank], support [rank]. Master Yi is banned; a gold lead wins.');
  });

  it('scrubs a comp name like the notes, since a comp can be named after one of theirs', () => {
    const prompt = buildDraftPrompt(
      parseDraftAdviceRequest({
        ...staleTab,
        comps: [
          { name: 'Anti-Zzqopponent', champions: ['Ornn'], winRate: 60, games: 5, playable: true, blocked: [] },
          { name: 'vs MAD Synergy', champions: ['Sion'], playable: true, blocked: [] }
        ]
      })
    );
    expect(prompt).toContain('- Anti-their Top: Ornn — 60% over 5');
    expect(prompt).toContain('- vs the other team: Sion — no games yet');
    expect(prompt).not.toMatch(/zzqopponent|MAD Synergy/i);
  });

  it('finds a name written into a handle, since an underscore is not a letter', () => {
    const req = parseDraftAdviceRequest({ ...staleTab, notes: 'Zzqopponent_smurf is the same player.' });
    expect(req.notes).toBe('their Top_smurf is the same player.');
  });

  it('tells the model to leave their players unnamed and refer to them by seat and champion', () => {
    expect(ADVISOR_SYSTEM).toContain('Never name, rate or describe any individual player of theirs');
    expect(ADVISOR_SYSTEM).toContain('refer to them only by seat and champion');
    expect(ADVISOR_SYSTEM).toContain('Our own players may be named.');
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
