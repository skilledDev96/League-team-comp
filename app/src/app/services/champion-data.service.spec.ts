import { beforeEach, describe, expect, it } from 'vitest';
import { ChampionDataService } from './champion-data.service';

const CACHE_KEY = 'bom-ddragon-v1';

function seedCache(): void {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      version: '15.1.1',
      champions: [
        { id: 'MonkeyKing', key: '62', name: 'Wukong', title: '', tags: ['Fighter', 'Tank'] },
        { id: 'MissFortune', key: '21', name: 'Miss Fortune', title: '', tags: ['Marksman'] },
        { id: 'Aatrox', key: '266', name: 'Aatrox', title: '', tags: ['Fighter'] }
      ]
    })
  );
}

describe('ChampionDataService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('normalize', () => {
    it('reduces to lowercase alphanumerics', () => {
      const svc = new ChampionDataService();
      expect(svc.normalize('Miss Fortune')).toBe('missfortune');
      expect(svc.normalize("Kai'Sa")).toBe('kaisa');
      expect(svc.normalize('')).toBe('');
    });
  });

  describe('with a hydrated cache', () => {
    let svc: ChampionDataService;

    beforeEach(() => {
      seedCache();
      svc = new ChampionDataService();
    });

    it('marks itself ready and reports the cached version', () => {
      expect(svc.ready()).toBe(true);
      expect(svc.version()).toBe('15.1.1');
      expect(svc.champions().length).toBe(3);
    });

    it('resolves by display name and by id', () => {
      expect(svc.resolveId('Wukong')).toBe('MonkeyKing');
      expect(svc.resolveId('MonkeyKing')).toBe('MonkeyKing');
      expect(svc.resolveId('Miss Fortune')).toBe('MissFortune');
    });

    it('returns undefined for unknown champions', () => {
      expect(svc.resolveId('Not A Champ')).toBeUndefined();
    });

    it('exposes role tags', () => {
      expect(svc.tags('Wukong')).toEqual(['Fighter', 'Tank']);
      expect(svc.tags('Nobody')).toEqual([]);
    });

    it('builds an icon url at the cached version', () => {
      expect(svc.iconUrl('Miss Fortune')).toBe(
        'https://ddragon.leagueoflegends.com/cdn/15.1.1/img/champion/MissFortune.png'
      );
    });

    it('searches by name substring', () => {
      const results = svc.search('miss');
      expect(results.map((c) => c.id)).toEqual(['MissFortune']);
    });
  });

  describe('without data', () => {
    it('falls back gracefully', () => {
      const svc = new ChampionDataService();
      expect(svc.ready()).toBe(false);
      expect(svc.resolveId('Aatrox')).toBeUndefined();
      // iconUrl still returns a plausible url using the fallback version + stripped name.
      expect(svc.iconUrl('Aatrox')).toContain('/img/champion/Aatrox.png');
    });
  });
});
