import { describe, expect, it } from 'vitest';
import { OpponentPlayer } from '../../models/team.models';
import {
  ADVISOR_NOTES_MAX,
  advisorLanes,
  advisorRequestParts,
  advisorTheirRoster,
  opponentBanPool,
  OTHER_TEAM,
  redactOpponentNames,
  scrubTeamText,
  stripLinks,
  stripRanks,
  theirSeatLabel
} from './advisor-request';
import { readLanes, SeatInput } from './lane-read';

const roster: Pick<OpponentPlayer, 'name' | 'riotTag' | 'role'>[] = [
  { name: 'Zzqopponent', riotTag: 'EUW1', role: 'Top' },
  { name: 'Hide on bush', riotTag: 'KR1', role: 'Mid' },
  { name: 'Ren', riotTag: 'EUW', role: 'Support' },
  { name: 'Björnström', role: 'Jungle' }
];

// The fixtures of core/riot-id.spec.ts: a roster arrives as an op.gg multi-search link, because the league
// rulebook requires one — "+" for a space, %23 for the hash, %2C between players, non-ASCII percent-encoded.
const MOSS_LINK =
  'https://op.gg/sv/lol/multisearch/euw?summoners=MOSS+drakexo%23hwei%2CMOSS+Lilleman%23Mt7%2CMOSS+Tr%C3%A4kol%23R%C3%84Ka%2CMOSS+St4mpe%23MT7%2CMOSS+Seldurin%23MT7';
const SGC_LINK = 'https://op.gg/de/lol/multisearch/euw?summoners=SGC+Snake%2CSPELLBOOKEZ%23SGC%2CTeain+Lol%2CYebi%237009%2CKastel%232308';
const SINGLE_LINK = 'https://op.gg/summoners/kr/Hide%20on%20bush-KR1';
const MOSS: Pick<OpponentPlayer, 'name' | 'riotTag' | 'role'>[] = [
  { name: 'MOSS drakexo', riotTag: 'hwei', role: 'Top' },
  { name: 'MOSS Lilleman', riotTag: 'Mt7', role: 'Jungle' },
  { name: 'MOSS Träkol', riotTag: 'RÄKa', role: 'Mid' },
  { name: 'MOSS St4mpe', riotTag: 'MT7', role: 'ADC' },
  { name: 'MOSS Seldurin', riotTag: 'MT7', role: 'Support' }
];

describe('redactOpponentNames', () => {
  it('replaces a name, its Riot ID and the team name, whatever the case', () => {
    const out = redactOpponentNames(
      'Zzqopponent#EUW1 mains Aatrox; zzqOPPONENT roams early. MAD Synergy take the first dragon.',
      roster,
      'MAD Synergy'
    );
    expect(out).toBe('their Top mains Aatrox; their Top roams early. the other team take the first dragon.');
  });

  it('takes a Riot ID written with a space before the tag, and a name written without its spaces', () => {
    expect(redactOpponentNames('Watch Hide on bush #KR1 and hideonbush on Ahri.', roster)).toBe(
      'Watch their Mid and their Mid on Ahri.'
    );
  });

  it('matches whole words only, so a champion that starts with a name is left alone', () => {
    expect(redactOpponentNames('Ren is loud; Renekton is fine; Ren, again.', roster)).toBe(
      'their Support is loud; Renekton is fine; their Support, again.'
    );
  });

  it('bounds names in any script, not only Latin letters, and finds one written into a handle', () => {
    expect(redactOpponentNames('Björnström paths top side. björnströmx is someone else.', roster)).toBe(
      'their Jungle paths top side. björnströmx is someone else.'
    );
    expect(redactOpponentNames('Zzqopponent_smurf is the same player.', roster)).toBe('their Top_smurf is the same player.');
  });

  it('takes the game name alone when a hand-typed row holds the whole Riot ID in its name', () => {
    expect(redactOpponentNames('Qqzhand#EUW mains Vi; qqzhand invades.', [{ name: 'Qqzhand#EUW', role: 'Jungle' }])).toBe(
      'their Jungle mains Vi; their Jungle invades.'
    );
  });

  it('counts the bench, and names a row with no seat plainly', () => {
    const out = redactOpponentNames('Qqzsub subs in for game 2.', [{ name: 'Qqzsub', role: '' as never }]);
    expect(out).toBe('one of their players subs in for game 2.');
  });

  it('never matches the label it wrote, even when another player is named like a seat', () => {
    // One pass: "Zzq" becomes "their Jungle", and the player called Jungle does not then turn that into "their their Top".
    const players = [
      { name: 'Zzq', role: 'Jungle' as const },
      { name: 'Jungle', role: 'Top' as const }
    ];
    expect(redactOpponentNames('Zzq ganks early.', players)).toBe('their Jungle ganks early.');
  });

  it('skips a name too short to be a Riot name, and leaves notes with no names untouched', () => {
    expect(redactOpponentNames('a plan for a Top lane', [{ name: 'a', role: 'Top' }])).toBe('a plan for a Top lane');
    expect(redactOpponentNames('Ban Aatrox first.', roster)).toBe('Ban Aatrox first.');
    expect(redactOpponentNames('', roster, 'MAD Synergy')).toBe('');
  });

  it('escapes a name that carries regex characters', () => {
    expect(redactOpponentNames('x.y+ is their shotcaller', [{ name: 'x.y+', role: 'ADC' }])).toBe('their ADC is their shotcaller');
    expect(redactOpponentNames('xzy is someone else', [{ name: 'x.y', role: 'ADC' }])).toBe('xzy is someone else');
  });

  it('cannot see a Riot ID inside a link on its own, which is why the links go first', () => {
    // "+" for the space and %2C before the next name: nothing here reads as "MOSS Lilleman" to a name pattern.
    expect(redactOpponentNames(MOSS_LINK, MOSS, 'MOSS')).toContain('Lilleman%23Mt7');
  });
});

describe('stripLinks', () => {
  it("replaces an op.gg multi-search link whole, whatever spells the Riot IDs inside it", () => {
    expect(stripLinks(`Their op.gg: ${MOSS_LINK}. And ${SGC_LINK}`)).toBe('Their op.gg: [link]. And [link]');
  });

  it('replaces a single summoner page, a www link and a bare stat-site path, and keeps the punctuation after', () => {
    expect(
      stripLinks(`Mid: ${SINGLE_LINK}, www.op.gg/summoners/euw/Some-Name-EUW; op.gg/summoners/euw/Other-Name-EUW (u.gg/lol/profile/euw1/qqz-euw/overview).`)
    ).toBe('Mid: [link], [link]; [link] ([link]).');
  });

  it('leaves a site named without a path, and ordinary text, alone', () => {
    expect(stripLinks('Check op.gg before the game; 5.5/10 on vision, e.g. wards.')).toBe(
      'Check op.gg before the game; 5.5/10 on vision, e.g. wards.'
    );
  });
});

describe('stripRanks', () => {
  it('replaces a rank as people write one, and leaves the game words a tier shares', () => {
    expect(
      stripRanks('Their Top is Emerald II, jungle plat 4 (75 LP), mid 450LP, support Master 212 LP. Master Yi is banned; a gold lead wins; Gold 1k up.')
    ).toBe('Their Top is [rank], jungle [rank], mid [rank], support [rank]. Master Yi is banned; a gold lead wins; Gold 1k up.');
  });
});

describe('scrubTeamText', () => {
  it('takes the link first, then every name and the team name, then the ranks', () => {
    const out = scrubTeamText(
      `Their op.gg: ${MOSS_LINK}. MOSS drakexo#hwei mains Aatrox at Emerald II; MOSS take early dragons.`,
      MOSS,
      'MOSS'
    );
    expect(out).toBe('Their op.gg: [link]. their Top mains Aatrox at [rank]; the other team take early dragons.');
    for (const value of ['drakexo', 'Lilleman', 'hwei', 'Mt7', 'MOSS', 'Emerald']) expect(out, value).not.toContain(value);
  });
});

describe('theirSeatLabel and OTHER_TEAM', () => {
  it('say who without saying a name', () => {
    expect(theirSeatLabel('Jungle')).toBe('their Jungle');
    expect(theirSeatLabel(undefined)).toBe('one of their players');
    expect(OTHER_TEAM).toBe('the other team');
  });
});

const zzq: OpponentPlayer = {
  name: 'Zzqopponent',
  riotTag: 'EUW1',
  role: 'Top',
  soloRank: 'Emerald II',
  rank: 'Emerald II',
  poolByRole: { Top: [{ champion: 'Aatrox', games: 12, wins: 7 }, { champion: 'Gnar', games: 5, wins: 2 }] },
  bansByRole: { Top: [{ champion: 'Kayle', games: 3, wins: 0 }] },
  recentChampions: ['Ambessa'],
  mastery: [{ champion: 'Aatrox', level: 7, points: 412345 }]
} as OpponentPlayer;

describe('advisorTheirRoster', () => {
  it('keeps the seat and the champions, and nothing about the player', () => {
    const sent = advisorTheirRoster([zzq]);
    expect(sent).toEqual([{ role: 'Top', pool: ['Aatrox', 'Gnar'] }]);
    const json = JSON.stringify(sent);
    for (const value of ['Zzqopponent', 'EUW1', 'Emerald II', 'Kayle', '412345', '"games"', '"wins"']) {
      expect(json, value).not.toContain(value);
    }
  });
});

describe('opponentBanPool', () => {
  it('gives each pool then what they touched lately, and never the champions that beat them', () => {
    expect(opponentBanPool([zzq])).toEqual(['Aatrox', 'Gnar', 'Ambessa']);
  });
});

/** Top: our Ornn into their Aatrox, a main of theirs; Bot: the ADC's three reasons before their Support's comfort. */
const seats: SeatInput[] = [
  { role: 'Top', ours: 'Ornn', theirs: 'Aatrox', matchup: { winRate: 48, games: 1200 }, theirComfort: { level: 'main', games: 40, winRate: 55 } },
  { role: 'Jungle', ours: '', theirs: '' },
  { role: 'Mid', ours: '', theirs: '' },
  {
    role: 'ADC',
    ours: 'Jinx',
    theirs: 'Caitlyn',
    matchup: { winRate: 46, games: 3000 },
    ourSolo: 49,
    theirSolo: 51,
    ourComfort: { level: 'main' }
  },
  { role: 'Support', ours: 'Leona', theirs: 'Nautilus', theirComfort: { level: 'main', games: 40, winRate: 55 } }
];

describe('advisorLanes', () => {
  it("reads each lane without their players' comfort, in the score and the verdict as well as the sentence", () => {
    // The panel's read: Top is weak at -12, of which -8 is their player's own record on Aatrox.
    const panel = readLanes(seats);
    expect(panel.find((r) => r.lane === 'Top')).toMatchObject({ verdict: 'weak', score: -12 });
    expect(panel.find((r) => r.lane === 'Bot')?.reasons).toContain('Nautilus is a main for them (40 games, 55%)');

    const sent = advisorLanes(seats);
    expect(sent).toEqual([
      { lane: 'Top', verdict: 'even', score: -4, reasons: ['Ornn into Aatrox wins 48% over 1,200 games'] },
      {
        lane: 'Bot',
        verdict: 'even',
        score: -1,
        reasons: ['Jinx into Caitlyn wins 46% over 3,000 games', 'Jinx is a main for us', 'Jinx sits at 49% in solo queue against Caitlyn at 51%']
      }
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/for them|their pool|recent pool|40 games/);
  });
});

describe('advisorRequestParts', () => {
  const sub = { name: 'Qqzsub', riotTag: 'SUB', role: 'Jungle', sub: true, poolByRole: { Jungle: [{ champion: 'Vi', games: 9, wins: 4 }] } } as OpponentPlayer;
  const series = {
    opponent: 'MAD Synergy',
    opponentPlayers: [zzq, sub],
    notes: `Scouted: ${MOSS_LINK}. Zzqopponent#EUW1 is Emerald II and mains Aatrox; Qqzsub may sub in. MAD Synergy take early dragons.`
  };
  const comps = [
    { name: 'Anti-Zzqopponent', champions: ['Ornn'], playable: true },
    { name: 'vs MAD Synergy', champions: ['Sion'], playable: false }
  ];

  it('builds every part that could carry the other team, and none of it names them', () => {
    const parts = advisorRequestParts({ series, seats, comps });
    expect(parts.theirRoster).toEqual([{ role: 'Top', pool: ['Aatrox', 'Gnar'] }]);
    expect(parts.banCandidates).toEqual(['Aatrox', 'Gnar', 'Ambessa']);
    expect(parts.notes).toBe(
      'Scouted: [link]. their Top is [rank] and mains Aatrox; their Jungle may sub in. the other team take early dragons.'
    );
    expect(parts.comps).toEqual([
      { name: 'Anti-their Top', champions: ['Ornn'], playable: true },
      { name: 'vs the other team', champions: ['Sion'], playable: false }
    ]);
    expect(parts.lanes.map((l) => l.score)).toEqual([-4, -1]);
    expect(parts.lanesWithoutTheirComfort).toBe(true);

    const json = JSON.stringify(parts);
    for (const value of ['Zzqopponent', 'Qqzsub', 'EUW1', 'MAD Synergy', 'Emerald II', 'Kayle', '412345', 'drakexo', 'Lilleman', 'for them']) {
      expect(json, value).not.toContain(value);
    }
  });

  it('scrubs the notes before cutting them, and leaves them out when nothing is left', () => {
    const long = advisorRequestParts({ series: { ...series, notes: `${'x'.repeat(1495)} Zzqopponent calls it` }, seats, comps: [] });
    expect(long.notes).toHaveLength(ADVISOR_NOTES_MAX);
    expect(long.notes).not.toMatch(/zzq/i);
    expect(advisorRequestParts({ series: { ...series, notes: '   ' }, seats, comps: [] }).notes).toBeUndefined();
    expect(advisorRequestParts({ series: null, seats: [], comps: [] })).toEqual({
      theirRoster: [],
      banCandidates: [],
      lanes: [],
      lanesWithoutTheirComfort: true,
      comps: []
    });
  });
});
