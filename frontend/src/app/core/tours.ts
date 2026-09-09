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
        title: 'Four pages',
        text: 'Roster is the team. Comps are the drafts we play. Games is every game and what keeps happening in them. Prep & Draft is every opponent, scrim or tournament: scouting, replays and the live draft.'
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
    id: 'roster',
    title: 'Roster',
    blurb: 'Cards, the A team, second seats, the table and the scouting view.',
    version: 1,
    match: { path: '/roster' },
    needs: 'players',
    steps: [
      { anchor: 'roster-card', title: 'A player card', text: 'Role, playstyle and main champion. Quick look opens the pool and the links; Profile opens the full page with the stats and the coaching notes.', query: { view: 'cards' } },
      { anchor: 'roster-ateam', title: 'A team for Patterns', text: 'The A team is the five Patterns counts by default and the five the draft room follows. Bench leaves a player out. Same flag Admin sets, so the five stay one thing everywhere.', editMode: true, query: { view: 'cards' } },
      { anchor: 'roster-main-seat', title: 'Main seat', text: 'The seat in the title. Patterns’ Main counts a game only when all five sat in their main seat, so set these before reading it.', editMode: true, query: { view: 'cards' } },
      { anchor: 'roster-second-seat', title: 'Second seat', text: 'The roles a player also covers. Patterns’ Roles filter and the draft room’s seat proposals read this.', editMode: true, query: { view: 'cards' } },
      { anchor: 'roster-detail-level', title: 'Starter and Full', text: 'Full adds the team identity, the fill-ins and the resource links under the cards.', query: { view: 'cards' } },
      { anchor: 'table-queue', title: 'The table', text: 'Rank and recent form per queue, one row per player. Recent is the last games scanned, not the ladder record beside it.', query: { view: 'table' } },
      { anchor: 'scouting-card', title: 'Scouting', text: 'Strengths, weaknesses, the pool, what they are learning and the suggested bans, for each of ours.', query: { view: 'scouting' } },
      { anchor: 'scouting-practice-board', title: 'Practice board', text: 'Pain points per player, open until someone resolves them.', query: { view: 'scouting' } }
    ]
  },
  {
    id: 'player-edit',
    title: 'Editing a player',
    blurb: 'One editor for everything about a player, opened from their profile.',
    version: 1,
    match: { path: '/player/' },
    role: 'editor',
    needs: 'players',
    steps: [
      { anchor: 'player-edit', title: 'Edit this player', text: 'The menu here opens the editor in a drawer. It is the same form Admin uses, so nothing about a player lives anywhere else.', editMode: true },
      { anchor: 'pe-identity', title: 'Name, tag and role', text: 'The Riot ID is what every refresh reads. Change the role and the roster regroups.', editMode: true, before: 'openPlayerEditor' },
      { anchor: 'pe-bench', title: 'A team or Bench', text: 'The same flag as the roster card. The second seats are the roles they also cover.', editMode: true, before: 'openPlayerEditor' },
      { anchor: 'pe-pool', title: 'Pool and bans', text: 'The declared pool, first champion shown as the main. Bans are what to take away from them in practice.', editMode: true, before: 'openPlayerEditor' },
      { anchor: 'pe-refresh', title: 'Refresh this player from Riot', text: 'Re-reads rank, recent champions and the observed playstyle. Anything typed by hand is kept.', editMode: true, before: 'openPlayerEditor' },
      { anchor: 'pe-hand-edited', title: 'Hand-edited', text: 'Saving anything here marks the player hand-edited: the morning refresh keeps your text, pool and bans from then on.', editMode: true, before: 'openPlayerEditor' }
    ]
  },
  {
    id: 'comps',
    title: 'Adding a comp',
    blurb: 'The board, the plan, what the comp expects, and its record.',
    version: 1,
    match: { path: '/comps' },
    role: 'editor',
    needs: 'comps',
    steps: [
      { anchor: 'comps-add', title: 'Add a comp', text: 'Creates a blank comp and opens its board, right here. Admin only keeps the names and picks as text.', editMode: true },
      { anchor: 'comp-board', title: 'The board', text: 'Click a seat, then a champion. Every pick saves as it lands, and the identity under the board reads itself off the five.', editMode: true },
      { anchor: 'comp-category', title: 'Category', text: 'A short label to filter by: Meta, Comfort, For fun.', editMode: true },
      { anchor: 'comp-gameplan', title: 'Game plan', text: 'Early, mid and late, in your own words. The draft advisor and the post-game review both read it.', editMode: true },
      { anchor: 'comp-expect', title: 'What we expect from it', text: 'Four axes read off the champions. Overrule them and the review checks the game against your version instead.', editMode: true },
      { anchor: 'comp-bans', title: 'Ban recommendations', text: 'Champions to take away when we run this comp. They come up on our ban steps in the draft room.', editMode: true },
      { anchor: 'comp-counts-under', title: 'Counts as part of', text: 'For the records only: fold this comp’s games into another, for near-duplicate drafts you keep separate to play from.', editMode: true },
      { anchor: 'comp-record', title: 'Track record', text: 'Wins and losses from match history, or logged by hand, with the notes from the games that count as this comp below.' }
    ]
  },
  {
    id: 'games',
    title: 'Games and reviews',
    blurb: 'Every game, the filters, and what a row can do.',
    version: 1,
    match: { path: '/games' },
    needs: 'analysis',
    steps: [
      { anchor: 'games-refresh', title: 'Refresh matches from Riot', text: 'Pulls in the flex and Clash games we played. Scrims come from replays and tournament games from the draft room.', editMode: true, query: { tab: 'games' } },
      { anchor: 'games-filters', title: 'Filters', text: 'Source, window, result and opponent, plus the champion box every page shares.', query: { tab: 'games' } },
      { anchor: 'games-record', title: 'The record', text: 'Wins and losses over what is filtered, by source and by side.', query: { tab: 'games' } },
      { anchor: 'games-row', title: 'A game', text: 'Open a row for the objectives, the scoreboard and everything below it.', query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-note', title: 'Match note', text: 'A sentence about the game. Comps collect these under Notes from its games, and the review reads them too.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-practice', title: 'Practice', text: 'Mark a game as practice and Patterns leaves it out.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-counts-as', title: 'Counts as', text: 'Which comp the game counts towards. Auto is the matcher’s read of the five champions; pick a comp to overrule it.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-story', title: 'How the game went', text: 'Minute by minute from Riot’s timeline, when there is one: the gold curve, the lanes, the fights and the deaths nobody was near.', query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-review-btn', title: 'Review this game', text: 'Two model calls, about a dime, after you confirm. The review lands on the row, on the Reviews tab and on each player’s profile.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-tabs', title: 'Patterns and Reviews', text: 'Patterns is what keeps happening across the games. Reviews is every written review, newest first.', query: { tab: 'games' } }
    ]
  },
  {
    id: 'patterns',
    title: 'Patterns',
    blurb: 'The filters, and what the Work on lines mean.',
    version: 1,
    match: { path: '/games', query: { tab: 'patterns' } },
    needs: 'analysis',
    steps: [
      { anchor: 'patterns-source', title: 'Source', text: 'Flex, scrims and Clash, or tournaments. A replay imported against a series game counts as a tournament game.' },
      { anchor: 'patterns-prep', title: 'Prep', text: 'Games played to win. Anything marked as practice on the Games tab is left out until you choose All.' },
      { anchor: 'patterns-starters', title: 'Starters', text: 'A team is whoever is not on the bench on the Roster page. Custom is any set of players who all have to be on our side.' },
      { anchor: 'patterns-roles', title: 'Roles', text: 'Main counts a player only in their main role; 2nd adds the second seats; Any counts every game.' },
      { anchor: 'patterns-workon', title: 'Work on, keep doing', text: 'Each line is the biggest gap between our wins and our losses that clears the minimum on both sides. Fold it out for the games it was read from.' },
      { anchor: 'patterns-sections', title: 'More sections', text: 'Lanes, the team split by result and the objective patterns sit behind these chips. Your choice is remembered.' }
    ]
  },
  {
    id: 'draft',
    title: 'Drafting',
    blurb: 'The live draft room, from the side choice to the result.',
    version: 1,
    match: { path: '/tournaments', query: { view: 'draft' } },
    role: 'editor',
    needs: 'series',
    steps: [
      { anchor: 'draft-games', title: 'Series and game', text: 'The room needs a tournament (Admin), a series and a game (the Plan view). Pick the game here or add the next one.', editMode: true },
      { anchor: 'draft-side', title: 'Our side', text: 'Blue bans and picks first. Everything after depends on it: whose turn, which seat a pick lands in, who banned what.', editMode: true },
      { anchor: 'draft-step-bar', title: 'Whose turn', text: 'Ban or pick, and whose. The clock is a reminder only; the real one is in the client.', editMode: true },
      { anchor: 'draft-wall', title: 'Hold, then confirm', text: 'Click a champion to hold it and see the seat it would land in; confirm to lock it and move the draft on.', editMode: true },
      { anchor: 'draft-target-bans', title: 'Target bans', text: 'The opponent’s target bans from scouting, on our ban steps. One click holds one.', editMode: true },
      { anchor: 'draft-undo', title: 'Undo and Reset', text: 'Undo steps back one and asks before it removes a pick. Reset clears the whole game and asks first.', editMode: true },
      { anchor: 'draft-advisor', title: 'Ask what to pick', text: 'One model call, a few cents, saved on the game for everyone on the link. It leads with your team plan while it is still legal.', editMode: true },
      { anchor: 'draft-done', title: 'Draft complete', text: 'Set the result, open the next game, and import the replay on the Plan view for the numbers.', editMode: true }
    ]
  },
  {
    id: 'scouting',
    title: 'Scouting an opponent',
    blurb: 'Their roster from a link, what they play, and the target bans.',
    version: 1,
    match: { path: '/tournaments', query: { view: 'plan' } },
    role: 'editor',
    needs: 'series',
    steps: [
      { anchor: 'plan-scout-btn', title: 'Scout', text: 'Opens their roster, bans and notes for the series. Scouting writes, so edit mode turns on.', editMode: true },
      { anchor: ['prep-paste', 'prep-scout-cta', 'prep-scout-again'], title: 'Paste their roster', text: 'Their op.gg multi-link, or Name#TAG one per line. Only the text of the link is read; nothing is looked up until you scout.', editMode: true, before: 'clickScout' },
      { anchor: ['prep-scout-cta', 'prep-scout-again'], title: 'Scout from Riot', text: 'Looks up what each of them plays. About two minutes a player, and it keeps running if you leave the page. Scout again reads further back.', editMode: true, before: 'clickScout' },
      { anchor: 'prep-banboard', title: 'Ban board', text: 'The champions their five live on, at most two per player. A click adds one to the target bans.', editMode: true, before: 'clickScout' },
      { anchor: 'prep-sub-toggle', title: 'Their bench', text: 'Six names need one on the bench before As a team can read the right five.', editMode: true, before: 'clickScout' },
      { anchor: 'prep-team', title: 'As a team', text: 'The games their five queued together lately. One fetch serves the whole team.', editMode: true, before: 'clickScout' },
      { anchor: 'prep-target-bans', title: 'Target bans and notes', text: 'These reach the draft room’s ban steps. The notes are shown to the advisor.', editMode: true, before: 'clickScout' }
    ]
  },
  {
    id: 'replays',
    title: 'Importing replays',
    blurb: 'Where the .rofl files go, and how they become games.',
    version: 1,
    match: { path: '/tournaments', query: { view: 'plan', group: 'scrims' } },
    role: 'editor',
    steps: [
      { anchor: 'prep-groups', title: 'Scrims and tournaments', text: 'One page for every opponent. Scrims is its own group: no dates, no best-of, nothing burns. A tournament keeps its fearless pool.', editMode: true, route: '/tournaments', query: { view: 'plan', group: 'scrims' } },
      { anchor: 'prep-dropzone', title: 'Drop replays here', text: '.rofl files from Documents › League of Legends › Replays, with the name Riot gave them; the match id is read from it. You are asked who it was against, and each file becomes a game.', editMode: true, route: '/tournaments', query: { view: 'plan', group: 'scrims' } },
      { anchor: 'prep-add-opponent', title: 'Prep an opponent first', text: 'A team can exist by name alone, so you can scout before the games and drop the replays in after.', editMode: true, route: '/tournaments', query: { view: 'plan', group: 'scrims' } },
      { anchor: 'prep-series', title: 'An opponent', text: 'Their games, scouting and target bans in one panel. Files dropped in here are named after them, and Draft opens the room on their next game.', editMode: true, route: '/tournaments', query: { view: 'plan', group: 'scrims' } },
      { anchor: 'prep-refresh', title: 'Count them', text: 'Replays reach the comp records and Patterns after Refresh matches from Riot on Games.', editMode: true, route: '/tournaments', query: { view: 'plan', group: 'scrims' } }
    ]
  },
  {
    id: 'admin',
    title: 'Admin and roles',
    blurb: 'The editors, the settings, who can do what, and diagnostics.',
    version: 1,
    match: { path: '/admin' },
    role: 'admin',
    steps: [
      { anchor: 'admin-tabs', title: 'The editors', text: 'Players, fill-ins, comps and tournaments are added here; series, games and scouting on Tournaments; everything else in edit mode on its own page.' },
      { anchor: 'admin-setting-advisor', title: 'Settings save as you go', text: 'The advisor’s auto-ask applies in the draft room; the morning review applies to the next run. Each line says where.', query: { tab: 'settings' } },
      { anchor: 'admin-access-role', title: 'Roles', text: 'Viewer reads everything but Admin. Contributor gets edit mode. Admin adds Settings, Access, Diagnostics and deletes.', query: { tab: 'access' } },
      { anchor: 'admin-diag-health', title: 'Diagnostics', text: 'What the morning run did and spent, data health per game, the draft log, browser errors, and your tours.', query: { tab: 'diagnostics' } }
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
