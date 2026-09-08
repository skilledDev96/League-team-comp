import { describe, expect, it } from 'vitest';
import { anchorSelectors, canRun, dueTours, isSeen, roleOf, routeMatches, stepAfterSkip, stepsFor, Tour, TOURS } from './tours';

const tour = (over: Partial<Tour> = {}): Tour => ({
  id: 't',
  title: 'T',
  blurb: '',
  version: 1,
  match: { path: '/games' },
  steps: [{ anchor: 'a', title: 'A', text: 'a' }],
  ...over
});

describe('roles', () => {
  it('ranks the roles and gates tours and steps by them', () => {
    expect(roleOf({ canEdit: false, canManageUsers: false })).toBe('viewer');
    expect(roleOf({ canEdit: true, canManageUsers: false })).toBe('editor');
    expect(roleOf({ canEdit: true, canManageUsers: true })).toBe('admin');
    expect(canRun(tour({ role: 'editor' }), 'viewer')).toBe(false);
    expect(canRun(tour({ role: 'editor' }), 'admin')).toBe(true);
    const t = tour({ steps: [{ anchor: 'a', title: '', text: '' }, { anchor: 'b', title: '', text: '', editMode: true }, { anchor: 'c', title: '', text: '', role: 'admin' }] });
    expect(stepsFor(t, 'viewer').map((s) => s.anchor)).toEqual(['a']);
    expect(stepsFor(t, 'editor').map((s) => s.anchor)).toEqual(['a', 'b']);
    expect(stepsFor(t, 'admin')).toHaveLength(3);
  });
});

describe('seen and routes', () => {
  it('is seen at or above the version, so a bump re-shows', () => {
    expect(isSeen({ t: 1 }, tour())).toBe(true);
    expect(isSeen({ t: 1 }, tour({ version: 2 }))).toBe(false);
    expect(isSeen({}, tour())).toBe(false);
  });

  it('matches the path exactly, a trailing slash by prefix, and only the declared query keys', () => {
    expect(routeMatches({ path: '/games' }, '/games')).toBe(true);
    expect(routeMatches({ path: '/games' }, '/games?tab=reviews&x=1')).toBe(true);
    expect(routeMatches({ path: '/games', query: { tab: 'patterns' } }, '/games?tab=patterns')).toBe(true);
    expect(routeMatches({ path: '/games', query: { tab: 'patterns' } }, '/games')).toBe(false);
    expect(routeMatches({ path: '/games' }, '/comps')).toBe(false);
    expect(routeMatches({ path: '/player/' }, '/player/go10x')).toBe(true);
  });
});

describe('dueTours', () => {
  const welcome = tour({ id: 'welcome', match: { path: '/roster' } });
  const roster = tour({ id: 'roster', match: { path: '/roster' }, needs: 'players' });
  const admin = tour({ id: 'admin', match: { path: '/admin' }, role: 'admin' });
  const quiet = tour({ id: 'quiet', match: { path: '/roster' }, autoStart: false });

  it('starts the welcome first and alone, then the others once seen', () => {
    expect(dueTours([welcome, roster, quiet], {}, 'viewer', '/roster', { players: true }).map((t) => t.id)).toEqual(['welcome']);
    expect(dueTours([welcome, roster, quiet], { welcome: 1 }, 'viewer', '/roster', { players: true }).map((t) => t.id)).toEqual(['roster']);
  });

  it('waits for the page to have something to show, and never for a role that cannot see it', () => {
    expect(dueTours([roster], { welcome: 1 }, 'viewer', '/roster', { players: false })).toEqual([]);
    expect(dueTours([admin], {}, 'editor', '/admin', {})).toEqual([]);
    expect(dueTours([admin], {}, 'admin', '/admin', {}).map((t) => t.id)).toEqual(['admin']);
  });
});

describe('anchors and skipping', () => {
  it('builds selectors in order and steps over missing anchors', () => {
    expect(anchorSelectors({ anchor: ['a', 'b'], title: '', text: '' })).toEqual(['[data-tour="a"]', '[data-tour="b"]']);
    expect(stepAfterSkip(4, 0, 1, new Set([1]))).toBe(2);
    expect(stepAfterSkip(4, 3, 1, new Set())).toBeNull();
    expect(stepAfterSkip(4, 2, -1, new Set([1, 0]))).toBeNull();
  });
});

describe('the registry', () => {
  it('has unique ids and unique anchors within a tour, and a welcome tour', () => {
    const ids = TOURS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('welcome');
    for (const t of TOURS) {
      const anchors = t.steps.map((s) => (Array.isArray(s.anchor) ? s.anchor.join('|') : s.anchor));
      expect(new Set(anchors).size, t.id).toBe(anchors.length);
      for (const s of t.steps) {
        expect(s.title.length, `${t.id}: ${s.anchor}`).toBeGreaterThan(0);
        expect(s.text.length, `${t.id}: ${s.anchor}`).toBeGreaterThan(20);
      }
    }
  });
});
