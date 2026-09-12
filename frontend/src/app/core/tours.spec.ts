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

/**
 * Prep & Draft had three tours and all three were for editors, with every step behind edit mode —
 * so the viewers who say the page is unreadable had never been shown it. These two are the way in,
 * and the thing that makes them one is that a viewer keeps every step.
 */
describe('the viewer tours on Prep & Draft', () => {
  const viewerTours = TOURS.filter((t) => t.id === 'prep-read' || t.id === 'draft-watch');

  it('exists, both of them', () => {
    expect(viewerTours.map((t) => t.id).sort()).toEqual(['draft-watch', 'prep-read']);
  });

  it('runs for a viewer and keeps every step', () => {
    for (const t of viewerTours) {
      expect(canRun(t, 'viewer'), t.id).toBe(true);
      expect(stepsFor(t, 'viewer').length, t.id).toBe(t.steps.length);
      for (const s of t.steps) {
        expect(s.editMode, `${t.id}: ${s.anchor}`).toBeUndefined();
        expect(s.role, `${t.id}: ${s.anchor}`).toBeUndefined();
      }
    }
  });

  it('lands on the Prep & Draft views they are about', () => {
    expect(routeMatches(TOURS.find((t) => t.id === 'prep-read')!.match, '/tournaments?view=plan')).toBe(true);
    expect(routeMatches(TOURS.find((t) => t.id === 'draft-watch')!.match, '/tournaments?view=draft')).toBe(true);
    expect(routeMatches(TOURS.find((t) => t.id === 'prep-read')!.match, '/tournaments?view=draft')).toBe(false);
  });

  it('never opens the draft room by itself', () => {
    // A tour opening over a draft in progress is the worst moment this app has.
    expect(TOURS.find((t) => t.id === 'draft-watch')!.autoStart).toBe(false);
    expect(TOURS.find((t) => t.id === 'prep-read')!.autoStart).not.toBe(false);
  });
});

/**
 * The 12 Sep 2026 disclosure batch put half of two pages behind a Starter | Full switch, and the
 * tours kept describing the Full version. Three Patterns steps pointed at anchors that Starter
 * does not render at all, so they were skipped in silence — the failure mode this repo has a
 * memory about: a mechanism whose only symptom is nothing happening.
 */
describe('the tours on the pages the disclosure batch changed', () => {
  const byId = (id: string) => TOURS.find((t) => t.id === id)!;

  it('re-runs for everyone on the two pages whose controls moved', () => {
    // Bumping the version is the documented way to show a tour once more.
    expect(byId('games').version).toBeGreaterThan(1);
    expect(byId('patterns').version).toBeGreaterThan(1);
    // The Prep tours are new, so they run for everyone already.
    expect(byId('prep-read').version).toBe(1);
    expect(byId('draft-watch').version).toBe(1);
  });

  it('opens the depth switch before describing anything it hides', () => {
    for (const id of ['games', 'patterns']) {
      const steps = byId(id).steps;
      const depth = steps.findIndex((s) => String(s.anchor).startsWith('detail-'));
      expect(depth, `${id} names the switch`).toBeGreaterThanOrEqual(0);
      expect(depth, `${id} names it first`).toBe(0);
    }
  });

  it('raises Patterns to Full for every step whose anchor only exists there', () => {
    // These three live inside the one @if (full()) block in review.component.html.
    const fullOnly = ['patterns-prep', 'patterns-starters', 'patterns-roles'];
    for (const anchor of fullOnly) {
      const step = byId('patterns').steps.find((s) => s.anchor === anchor)!;
      expect(step, anchor).toBeDefined();
      expect(step.before, `${anchor} would skip in silence without it`).toBe('showFullPatterns');
    }
  });

  it('keeps every step a viewer can reach free of edit mode', () => {
    // A viewer at the default depth is the reader these tours were rewritten for.
    for (const id of ['patterns', 'prep-read', 'draft-watch']) {
      for (const s of stepsFor(byId(id), 'viewer')) {
        expect(s.editMode, `${id}: ${s.anchor}`).toBeUndefined();
      }
    }
  });

  it('names the three things the batch added to the Games page', () => {
    const anchors = byId('games').steps.map((s) => String(s.anchor));
    expect(anchors).toContain('detail-games');
    expect(anchors).toContain('games-next-up');
    expect(anchors).toContain('games-review-panel');
  });
});

describe('the tours on Roster and Comps (12 Sep 2026)', () => {
  const byId = (id: string) => TOURS.find((t) => t.id === id)!;

  it('re-runs the two whose pages changed, and gives a reader of Comps a tour of their own', () => {
    expect(byId('roster').version).toBeGreaterThan(1);
    expect(byId('comps').version).toBeGreaterThan(1);
    const read = byId('comps-read');
    expect(read.role).toBeUndefined();
    for (const step of stepsFor(read, 'viewer')) expect(step.editMode, String(step.anchor)).toBeUndefined();
  });

  it('opens the walked comp before any step whose anchor lives inside a panel', () => {
    // A panel builds its body only while it is open, so without the action these skip in silence.
    const inside = ['comp-board', 'comp-category', 'comp-gameplan', 'comp-expect', 'comp-bans', 'comp-slots'];
    for (const tour of [byId('comps'), byId('comps-read')]) {
      for (const step of tour.steps.filter((x) => inside.includes(String(x.anchor)))) {
        expect(step.before, tour.id + ': ' + String(step.anchor)).toBe('openTourComp');
      }
    }
    const countsUnder = byId('comps').steps.find((x) => x.anchor === 'comp-counts-under')!;
    expect(countsUnder.before).toBe('showFullComps');
  });

  it('names the Roster switch that now speaks for all four views', () => {
    expect(byId('roster').steps.some((x) => x.anchor === 'detail-roster')).toBe(true);
    expect(byId('roster').steps.some((x) => x.anchor === 'roster-detail-level')).toBe(false);
  });

  it('leaves the editor draft tour on its version, so a new step never opens it over a live draft', () => {
    expect(byId('draft').autoStart).not.toBe(false);
    expect(byId('draft').version).toBe(1);
    expect(byId('draft').steps.some((x) => x.anchor === 'draft-board')).toBe(true);
  });
});
