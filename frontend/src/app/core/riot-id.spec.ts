import { describe, expect, it } from 'vitest';
import { formatRiotId, parseRiotId, parseRiotIds } from './riot-id';

describe('parseRiotIds', () => {
  it('reads a plain Riot ID', () => {
    expect(parseRiotIds('Faker#KR1')).toEqual([{ name: 'Faker', tag: 'KR1', region: undefined }]);
  });

  it('reads a whole op.gg multi-search link, which is how a roster arrives', () => {
    // The league rulebook requires every team to publish one of these.
    const ids = parseRiotIds('https://www.op.gg/multisearch/euw?summoners=Alpha%23EUW,Bravo%23123');
    expect(ids).toEqual([
      { name: 'Alpha', tag: 'EUW', region: 'euw' },
      { name: 'Bravo', tag: '123', region: 'euw' }
    ]);
  });

  it('reads a single op.gg summoner page, where the tag is dash-separated', () => {
    const ids = parseRiotIds('https://op.gg/summoners/euw/Some-Name-EUW');
    expect(ids).toEqual([{ name: 'Some-Name', tag: 'EUW', region: 'euw' }]);
  });

  it('reads a pasted list however it was separated', () => {
    expect(parseRiotIds('A#1, B#2\nC#3; D#4').map(formatRiotId)).toEqual(['A#1', 'B#2', 'C#3', 'D#4']);
  });

  it('survives a hash that was url-encoded on the way out of an address bar', () => {
    expect(parseRiotId('Alpha%23EUW')).toEqual({ name: 'Alpha', tag: 'EUW', region: undefined });
  });

  it('keeps a name that contains spaces', () => {
    expect(parseRiotId('Big Bad Wolf#EUW')?.name).toBe('Big Bad Wolf');
  });

  it('never lists the same player twice', () => {
    expect(parseRiotIds('A#1, A#1, a#1')).toHaveLength(1);
  });

  it('skips anything it cannot read rather than guessing', () => {
    // A wrong Riot ID scouts a stranger, which is worse than an empty row.
    expect(parseRiotIds('just a name with no tag')).toEqual([]);
    expect(parseRiotIds('#TAGONLY')).toEqual([]);
    expect(parseRiotIds('')).toEqual([]);
  });

  it('keeps the good entries when only some of them parse', () => {
    expect(parseRiotIds('A#1, nonsense, B#2').map(formatRiotId)).toEqual(['A#1', 'B#2']);
  });

  it('carries the region the link named, so scouting hits the right platform', () => {
    expect(parseRiotId('https://www.op.gg/multisearch/kr?summoners=Faker%23KR1')?.region).toBe('kr');
  });

  it('leaves the region unset when nothing said one', () => {
    expect(parseRiotId('Faker#KR1')?.region).toBeUndefined();
  });

  it('takes the last hash, so a name containing one still parses', () => {
    expect(parseRiotId('od#d#EUW')).toEqual({ name: 'od#d', tag: 'EUW', region: undefined });
  });
});

describe('formatRiotId', () => {
  it('round-trips through the form a person reads', () => {
    const id = parseRiotId('Alpha#EUW')!;
    expect(formatRiotId(id)).toBe('Alpha#EUW');
    expect(parseRiotId(formatRiotId(id))).toEqual(id);
  });
});

describe('a real op.gg multi-link', () => {
  // Pasted verbatim from the league's own roster page. Everything awkward about
  // the format is in here at once: a locale and game segment before the region,
  // "+" for spaces, %23 for the hash, %2C between players, and non-ASCII names.
  const LINK =
    'https://op.gg/sv/lol/multisearch/euw?summoners=MOSS+drakexo%23hwei%2CMOSS+Lilleman%23Mt7%2CMOSS+Träkol%23RÄKa%2CMOSS+St4mpe%23MT7%2CMOSS+Seldurin%23MT7';

  it('reads all five players', () => {
    expect(parseRiotIds(LINK)).toHaveLength(5);
  });

  it('turns "+" back into the space it stands for', () => {
    // A query string encodes a space as "+", and decodeURIComponent does not
    // undo it — so without this every scouted name is wrong and every lookup
    // misses.
    expect(parseRiotIds(LINK).map((id) => id.name)).toEqual([
      'MOSS drakexo',
      'MOSS Lilleman',
      'MOSS Träkol',
      'MOSS St4mpe',
      'MOSS Seldurin'
    ]);
  });

  it('keeps tags exactly as written, case and accents included', () => {
    expect(parseRiotIds(LINK).map((id) => id.tag)).toEqual(['hwei', 'Mt7', 'RÄKa', 'MT7', 'MT7']);
  });

  it('finds the region past the locale and game segments in the path', () => {
    expect(parseRiotIds(LINK)[0].region).toBe('euw');
  });
});

describe('parseRiotIds: tags op.gg leaves off', () => {
  it('fills in the region default for names a multi-link carries without a tag', () => {
    // The first real link pasted. Two of five carry no tag because it equals
    // the region default; read as junk, the five-stack came through as three.
    const link =
      'https://op.gg/de/lol/multisearch/euw?summoners=SGC+Snake%2CSPELLBOOKEZ%23SGC%2CTeain+Lol%2CYebi%237009%2CKastel%232308';
    const ids = parseRiotIds(link);
    expect(ids.map((i) => i.name + '#' + i.tag)).toEqual([
      'SGC Snake#EUW',
      'SPELLBOOKEZ#SGC',
      'Teain Lol#EUW',
      'Yebi#7009',
      'Kastel#2308'
    ]);
    expect(ids.every((i) => i.region === 'euw')).toBe(true);
  });

  it('uses the right default per region, not always EUW', () => {
    const ids = parseRiotIds('https://op.gg/multisearch/na?summoners=Alpha%2CBravo%23123');
    expect(ids.map((i) => i.name + '#' + i.tag)).toEqual(['Alpha#NA1', 'Bravo#123']);
  });

  it('still refuses a bare name typed by hand, where no region is known', () => {
    expect(parseRiotIds('JustAName')).toEqual([]);
    expect(parseRiotIds('JustAName#EUW')).toHaveLength(1);
  });
});
