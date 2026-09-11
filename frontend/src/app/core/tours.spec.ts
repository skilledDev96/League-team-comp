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

describe('the film room tour', () => {
  const film = TOURS.find((t) => t.id === 'film-room')!;
  const anchorsOf = (t: Tour): string[] => t.steps.flatMap((s) => (Array.isArray(s.anchor) ? s.anchor : [s.anchor]));

  it('is in the registry with a version, and every step names its own anchor', () => {
    expect(film).toBeDefined();
    expect(film.version).toBeGreaterThan(0);
    const anchors = anchorsOf(film);
    expect(anchors).toHaveLength(film.steps.length);
    expect(new Set(anchors).size).toBe(anchors.length);
    // Namespaced, so nothing on another page can answer one of these steps.
    expect(anchors.every((a) => a.startsWith('film-'))).toBe(true);
    const others = new Set(TOURS.filter((t) => t.id !== film.id).flatMap(anchorsOf));
    expect(anchors.filter((a) => others.has(a))).toEqual([]);
  });

  it('fires on a film and nowhere else, and never starts by itself', () => {
    expect(routeMatches(film.match, '/film/NA1_5203441192')).toBe(true);
    expect(routeMatches(film.match, '/film/NA1_5203441192?c=tape&t=640')).toBe(true);
    expect(routeMatches(film.match, '/games')).toBe(false);
    expect(routeMatches(film.match, '/roster')).toBe(false);
    // The film opens on its title card, where none of these anchors exist yet;
    // the walk is taken on purpose from the pill in the film bar.
    expect(film.autoStart).toBe(false);
    expect(dueTours(TOURS, {}, 'admin', '/film/NA1_5203441192', {})).toEqual([]);
  });

  it('is taken from the film and never walked to: a prefix path would open somebody else’s game', () => {
    // `TourService.start` opens a prefix page by appending the first player's id,
    // which is right for `/player/` and nonsense for `/film/` — it would land on a
    // match id that is a player id and read "No review for this game yet."
    expect(film.onlyHere).toBe(true);
    expect(TOURS.filter((t) => t.match.path.endsWith('/') && !t.onlyHere).map((t) => t.match.path)).toEqual(['/player/']);
  });

  it('is a viewer’s walk: no need, no role, no edit mode, and only Save is an editor’s', () => {
    expect(film.needs).toBeUndefined();
    expect(film.role ?? 'viewer').toBe('viewer');
    expect(film.steps.some((s) => s.editMode)).toBe(false);
    const viewer = stepsFor(film, 'viewer');
    expect(viewer.length).toBe(film.steps.length - 1);
    expect(stepsFor(film, 'editor')).toHaveLength(film.steps.length);
    expect(viewer.some((s) => s.anchor === 'film-lab-save')).toBe(false);
  });

  it('walks the deck itself: every step past the first says which chapter it needs', () => {
    expect(film.steps[0].before).toBeUndefined();
    expect(film.steps.slice(1).every((s) => !!s.before)).toBe(true);
    expect(new Set(film.steps.map((s) => s.before))).toEqual(new Set([undefined, 'openFilmMap', 'openFilmTape', 'openFilmLab']));
    // Nothing navigates: the film is one route, so a step that carried its own
    // would take the reader off the film the walk is about.
    expect(film.steps.some((s) => s.route || s.query)).toBe(false);
  });

  it('survives a film with no timeline: the map, tape and lab steps are stepped over', () => {
    // Without a timeline `buildFilm` makes neither a tape nor a map chapter, so
    // the only anchor on the page is the chapter rail. The engine marks each
    // anchor it cannot find missing and walks on, the way `stepAfterSkip` does.
    const steps = stepsFor(film, 'editor');
    const missingUnless = (onPage: (anchor: string) => boolean): Set<number> => new Set(steps.flatMap((s, i) => (onPage(String(s.anchor)) ? [] : [i])));
    const noTimeline = missingUnless((a) => a === 'film-dots');
    expect(noTimeline.has(0)).toBe(false);
    expect(stepAfterSkip(steps.length, 0, 1, noTimeline)).toBeNull();
    // A ledger but no tape (so no lab either): the walk runs the map's steps and stops.
    const mapOnly = missingUnless((a) => a.startsWith('film-map'));
    expect(stepAfterSkip(steps.length, 0, 1, mapOnly)).toBe(steps.findIndex((s) => s.anchor === 'film-map-legend'));
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
