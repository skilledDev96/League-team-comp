/**
 * Guided tours: what they are, which one is due, and the copy.
 *
 * A tour is data — a list of steps, each naming a `data-tour` anchor on the
 * page and the state the page has to be in (route, query, edit mode). The
 * engine (`services/tour.service.ts`) walks the page to the anchor; nothing
 * here touches the DOM, so which tour fires for whom is testable.
 *
 * Seen state is a version per tour: bumping a tour's `version` shows it
 * once more to everyone, which is how "What's new" works (8 Sep 2026).
 */

export type TourRole = 'viewer' | 'editor' | 'admin';
export type Placement = 'auto' | 'top' | 'bottom' | 'left' | 'right';
export type TourNeed = 'players' | 'comps' | 'series' | 'analysis' | 'scrims';

export interface TourStep {
  /** `data-tour` id(s); the first one on the page wins. */
  anchor: string | string[];
  title: string;
  text: string;
  /** The page the step lives on, when it differs from the tour's own. */
  route?: string;
  query?: Record<string, string>;
  /** Only makes sense with the editing controls showing. Dropped for viewers. */
  editMode?: boolean;
  /** Dropped below this role. */
  role?: TourRole;
  placement?: Placement;
  /** A named action the engine runs before looking for the anchor. */
  before?: string;
}

export interface Tour {
  id: string;
  title: string;
  blurb: string;
  version: number;
  /** Where it starts by itself, and where the "Show me around" pill shows. */
  match: { path: string; query?: Record<string, string> };
  role?: TourRole;
  /** Something the page has to have before the tour is worth running. */
  needs?: TourNeed;
  /** Default true. */
  autoStart?: boolean;
  steps: TourStep[];
}

/** Tour id → the version seen. */
export type SeenMap = Record<string, number>;

const RANK: Record<TourRole, number> = { viewer: 0, editor: 1, admin: 2 };

export function roleOf(auth: { canEdit: boolean; canManageUsers: boolean }): TourRole {
  return auth.canManageUsers ? 'admin' : auth.canEdit ? 'editor' : 'viewer';
}

export function canRun(tour: Tour, role: TourRole): boolean {
  return RANK[role] >= RANK[tour.role ?? 'viewer'];
}

/** The steps this role can see: editor-only steps drop for a viewer. */
export function stepsFor(tour: Tour, role: TourRole): TourStep[] {
  return tour.steps.filter((s) => RANK[role] >= RANK[s.role ?? (s.editMode ? 'editor' : 'viewer')]);
}

export function isSeen(seen: SeenMap, tour: Tour): boolean {
  return (seen[tour.id] ?? 0) >= tour.version;
}

/**
 * Whether a URL is the tour's page: the path exactly (a path ending in `/`
 * matches by prefix, for `/player/:id`), and every declared query key.
 */
export function routeMatches(match: Tour['match'], url: string): boolean {
  const [path, search = ''] = url.split('?');
  const clean = path.replace(/\/+$/, '') || '/';
  const wanted = match.path.replace(/\/+$/, '') || '/';
  const pathOk = match.path.endsWith('/') ? clean.startsWith(match.path) : clean === wanted;
  if (!pathOk) return false;
  const params = new URLSearchParams(search);
  return Object.entries(match.query ?? {}).every(([k, v]) => params.get(k) === v);
}

/** Which tours should start by themselves here, welcome first and alone. */
export function dueTours(tours: readonly Tour[], seen: SeenMap, role: TourRole, url: string, have: Partial<Record<TourNeed, boolean>>): Tour[] {
  const due = tours.filter(
    (t) => t.autoStart !== false && t.steps.length > 0 && canRun(t, role) && stepsFor(t, role).length > 0 && !isSeen(seen, t) && routeMatches(t.match, url) && (!t.needs || have[t.needs])
  );
  const welcome = due.find((t) => t.id === 'welcome');
  return welcome ? [welcome] : due;
}

export function anchorSelectors(step: TourStep): string[] {
  return (Array.isArray(step.anchor) ? step.anchor : [step.anchor]).map((a) => `[data-tour="${a}"]`);
}

/** The next step index in a direction, skipping the ones known to be missing; null at the end. */
export function stepAfterSkip(count: number, from: number, dir: 1 | -1, missing: ReadonlySet<number>): number | null {
  for (let i = from + dir; i >= 0 && i < count; i += dir) if (!missing.has(i)) return i;
  return null;
}

// ---- The tours -------------------------------------------------------------------

export const TOURS: readonly Tour[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    blurb: 'The five pages, edit mode and the quick actions.',
    version: 1,
    match: { path: '/roster' },
    steps: [
      {
        anchor: 'nav',
        title: 'Five pages',
        text: 'Roster is the team. Comps are the drafts we play. Games is every game and what keeps happening in them. Scrims holds the replays. Tournaments is the series and the live draft.'
      },
      {
        anchor: 'roster-views',
        title: 'One roster, three depths',
        text: 'Cards for who plays what, Table for rank and form, Scouting for pools, matchups and the practice board.'
      },
      {
        anchor: 'quick-actions',
        title: 'The things you do most',
        text: 'One press each: refresh after practice, open the draft room, add a comp, scout the next opponent, import a replay.'
      },
      {
        anchor: 'edit-toggle',
        title: 'Edit mode',
        text: 'Every editing control lives behind this switch, and everything saves the moment you change it. There is no Save button.',
        editMode: false,
        role: 'editor'
      },
      {
        anchor: 'user-menu',
        title: 'Admin, refresh and help',
        text: 'Admin holds settings, roles and diagnostics. Refresh everything from Riot re-reads the players and the matches. Help and tours brings any of these tours back.',
        before: 'openUserMenu'
      }
    ]
  },
  {
    id: 'whats-new',
    title: "What's new",
    blurb: 'What changed since you last looked.',
    version: 0,
    match: { path: '/roster' },
    autoStart: false,
    steps: []
  }
];

export function tourById(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}
