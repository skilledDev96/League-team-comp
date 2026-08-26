import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UiService } from './ui.service';

describe('UiService', () => {
  let ui: UiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    ui = TestBed.inject(UiService);
  });

  describe('parseCompLine', () => {
    it('splits champion and note on " - "', () => {
      expect(ui.parseCompLine('Maokai - hard engage frontline')).toEqual({
        champion: 'Maokai',
        note: 'hard engage frontline'
      });
    });

    it('returns just the champion when there is no note', () => {
      expect(ui.parseCompLine('Maokai')).toEqual({ champion: 'Maokai', note: '' });
    });

    it('only splits on the first separator', () => {
      expect(ui.parseCompLine('Vi - dive - flank')).toEqual({ champion: 'Vi', note: 'dive - flank' });
    });

    it('trims surrounding whitespace', () => {
      expect(ui.parseCompLine('  Ahri  -  roam mid ')).toEqual({ champion: 'Ahri', note: 'roam mid' });
    });
  });

  describe('championDDragonName', () => {
    it('maps known irregular names via the static map', () => {
      expect(ui.championDDragonName('Miss Fortune')).toBe('MissFortune');
      expect(ui.championDDragonName('Wukong')).toBe('MonkeyKing');
      expect(ui.championDDragonName("Kai'Sa")).toBe('Kaisa');
    });

    it('strips punctuation for names not in the map', () => {
      expect(ui.championDDragonName('Aatrox')).toBe('Aatrox');
      expect(ui.championDDragonName("Bel'Veth")).toBe('Belveth');
    });
  });

  describe('championSlug', () => {
    it('lowercases and strips punctuation', () => {
      expect(ui.championSlug('Miss Fortune')).toBe('missfortune');
      expect(ui.championSlug("Bel'Veth")).toBe('belveth');
    });
  });

  describe('championIconUrl', () => {
    it('builds a Data Dragon url from the resolved name', () => {
      expect(ui.championIconUrl('Miss Fortune')).toContain('/img/champion/MissFortune.png');
      expect(ui.championIconUrl('Miss Fortune')).toMatch(/^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/[\d.]+\//);
    });
  });

  describe('playerAnchorId', () => {
    it('slugs the player name', () => {
      expect(ui.playerAnchorId('Miss Fortune')).toBe('player-miss-fortune');
      expect(ui.playerAnchorId('Go10x!!')).toBe('player-go10x');
    });
  });

  describe('roleBadgeText', () => {
    it('maps roles to short badges', () => {
      expect(ui.roleBadgeText('Jungle')).toBe('JG');
      expect(ui.roleBadgeText('Support')).toBe('SUP');
    });

    it('falls back to the role text when unknown', () => {
      expect(ui.roleBadgeText('Fill')).toBe('Fill');
      expect(ui.roleBadgeText(undefined)).toBe('');
    });
  });

  describe('avatarInitial', () => {
    it('returns the uppercased first letter', () => {
      expect(ui.avatarInitial('rulukuku')).toBe('R');
      expect(ui.avatarInitial('')).toBe('?');
      expect(ui.avatarInitial(undefined)).toBe('?');
    });
  });

  describe('summonerSearchUrl', () => {
    it('uses the opgg slug when a profile is provided', () => {
      expect(ui.summonerSearchUrl('Some Name', { region: 'euw', opggSlug: 'ruan-euw' })).toBe(
        'https://op.gg/lol/summoners/euw/ruan-euw'
      );
    });

    it('builds a name-tag url when no slug exists', () => {
      expect(ui.summonerSearchUrl('Go10x', { region: 'na', riotTag: 'NA1' })).toBe(
        'https://op.gg/lol/summoners/na/Go10x-NA1'
      );
    });
  });
});
