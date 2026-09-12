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
  /**
   * The tour can only be taken from its own page, never walked to (11 Sep 2026).
   * A `match.path` ending in `/` is a prefix, and the engine opens such a page by
   * appending the first player's id — right for `/player/`, nonsense for
   * `/film/`, where it would land on a game with no review. Help and tours lists
   * one of these with the reason instead of a Start.
   */
  onlyHere?: boolean;
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
    // 2 on 12 Sep 2026: the page grew a Starter | Full switch and a Next up card, the row's
    // drawer was reordered around the review, and two steps described controls Starter does not
    // draw. Everyone sees it once more.
    version: 2,
    match: { path: '/games' },
    needs: 'analysis',
    steps: [
      { anchor: 'detail-games', title: 'Starter or Full', text: 'How much of this page to draw. Starter is the few things to act on; Full adds everything it knows. It is remembered for you, on every page that offers it.', query: { tab: 'games' } },
      { anchor: 'games-next-up', title: 'What to do next', text: 'One card, when there is something: a film that asked to be remembered, a game nobody has reviewed, or the next opponent. Nothing here means nothing is waiting.', query: { tab: 'games' } },
      { anchor: 'games-refresh', title: 'Refresh matches from Riot', text: 'Pulls in the flex and Clash games we played. Scrims come from replays and tournament games from the draft room.', editMode: true, query: { tab: 'games' } },
      { anchor: 'games-filters', title: 'Filters', text: 'How far back to look, and the champion box every page shares. Full adds the source, the result and the opponent.', query: { tab: 'games' } },
      { anchor: 'games-record', title: 'The record', text: 'Wins and losses over whatever is filtered, with the last games beside it as a strip of W and L. Full splits the record by source and by side.', query: { tab: 'games' } },
      { anchor: 'games-row', title: 'A game', text: 'Open a row: the review first, then the objectives, the scoreboard, the note and how the game went.', query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-review-panel', title: 'The review', text: 'What the coach wrote about this game: the one thing to work on, what went well, and a note for each seat. The Reviewed chip on the row itself opens the film room, where the same review is walked through.', query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-note', title: 'Match note', text: 'A sentence about the game. Comps collect these under Notes from its games, and the review reads them too.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-practice', title: 'Practice', text: 'Mark a game as practice and Patterns leaves it out.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-counts-as', title: 'Counts as', text: 'Which comp the game counts towards. Auto is the matcher’s read of the five champions; pick a comp to overrule it.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-story', title: 'How the game went', text: 'Minute by minute at the bottom of the row: the gold curve, the lanes, the fights, and who swung the game most. A game Riot cannot see reads from the replay recorder instead, and one with neither says so.', query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-review-btn', title: 'Review this game', text: 'Two model calls, about a dime, after you confirm. The review lands on the row, on the Reviews tab and on each player’s profile.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-tabs', title: 'Patterns and Reviews', text: 'Patterns is what keeps happening across the games. Reviews opens on the newest review in full, with the rest a line each.', query: { tab: 'games' } }
    ]
  },
  {
    id: 'patterns',
    title: 'Patterns',
    blurb: 'The filters, and what the Work on lines mean.',
    // 2 on 12 Sep 2026: three of these six steps pointed at filters that only exist in Full, so
    // at Starter — the default for everyone — they were skipped in silence. They now raise the
    // page to Full to show them, and stop() puts the reader's own depth back.
    version: 2,
    match: { path: '/games', query: { tab: 'patterns' } },
    needs: 'analysis',
    steps: [
      { anchor: 'detail-patterns', title: 'Starter or Full', text: 'Starter is the conclusion — what to work on, what to keep doing, and the record. Full adds the filters that decide what those numbers mean. The next three are Full' + "'" + 's, so this walk opens it and puts your setting back at the end.' },
      { anchor: 'patterns-source', title: 'Source', text: 'Flex, scrims and Clash, or tournaments — a replay imported against a series game counts as a tournament game. The number on each is how many games it would leave you.' },
      { anchor: 'patterns-prep', title: 'Prep', text: 'Games played to win: anything marked as practice on the Games tab drops out until you choose All. It keeps filtering at Starter, where the field is not drawn.', before: 'showFullPatterns' },
      { anchor: 'patterns-starters', title: 'Starters', text: 'A team is whoever is not on the bench on the Roster page. Custom is any set of players who all have to be on our side — tick them in the row that opens under it.', before: 'showFullPatterns' },
      { anchor: 'patterns-roles', title: 'Roles', text: 'The one most likely to look broken. Main counts a game only when all five sat in their main seat, so a single off-role game shows 0; 2nd adds the second seats; Any counts every game.', before: 'showFullPatterns' },
      { anchor: 'patterns-workon', title: 'Work on, keep doing', text: 'Each line is the biggest gap between our wins and our losses that clears the minimum on both sides. Fold it out for the games it was read from.' },
      { anchor: 'patterns-sections', title: 'More sections', text: 'Lanes, what changes when we win, the recurring problems and the game-by-game list each sit behind one of these chips. All four start closed, and whichever you open is remembered.' }
    ]
  },
  /**
   * The two viewer tours on Prep & Draft (12 Sep 2026).
   *
   * Every tour this page had — drafting, scouting, replays — is `role: 'editor'` with every step
   * `editMode: true`, so the people who complain that the page is unreadable have never been shown
   * it. These two have no role and no edit-mode step: they walk the page as it stands.
   *
   * Reading the prep starts by itself, the way the Games and Patterns tours do. Watching a draft
   * does not — the draft room is used live, and a tour opening over a draft in progress is the
   * worst moment this app has. It waits for the Show me around pill.
   */
  {
    id: 'prep-read',
    title: 'Reading the prep',
    blurb: 'What a series card holds before you play it: what is burned, who they are, and what to ban.',
    version: 1,
    match: { path: '/tournaments', query: { view: 'plan' } },
    needs: 'series',
    steps: [
      { anchor: 'prep-series', title: 'A series', text: 'One card an opponent. The page opens on the next one you have to play — the ones already played are closed.' },
      { anchor: 'prep-fearless', title: 'What is burned', text: 'Under Fearless Draft a champion played by either team is gone for the rest of the series. This is what is already spent.' },
      { anchor: 'detail-prep', title: 'How much to show', text: 'Starter is their five on a line each. Full adds both ranked queues, who beats them, what they played lately and their bench. It is remembered for you.' },
      { anchor: 'prep-roster', title: 'Their five', text: 'The seat we expect them in, their rank, and the three champions they actually play — both queues added together, most games first.' },
      { anchor: 'prep-banboard', title: 'Who to ban', text: 'The champions across their five that a ban would actually hurt, ranked by games rather than win rate: a 100% over three games is a curiosity.' },
      { anchor: 'prep-team', title: 'As a team', text: 'The games their five queued together lately, and what they pick when they do. An editor fetches it once and everyone sees it.' }
    ]
  },
  {
    id: 'draft-watch',
    title: 'Watching a draft',
    blurb: 'Following the room from the side, on the shared link.',
    version: 1,
    match: { path: '/tournaments', query: { view: 'draft' } },
    needs: 'series',
    autoStart: false,
    steps: [
      { anchor: 'draft-games', title: 'Which game', text: 'A series is several games. This picks which one the room is showing; everyone on the link sees the same one.' },
      { anchor: 'draft-step-bar', title: 'Whose turn', text: 'Ban or pick, and whose. Twenty steps, the order fixed by which side we are on. The clock here is a reminder; the real one is in the client.' },
      { anchor: 'draft-wall', title: 'What is left', text: 'Every champion, with the ones taken, banned or burned earlier in the series greyed out.' },
      { anchor: 'draft-lanes', title: 'How the lanes read', text: 'Each of our picks against theirs, seat by seat, once both are on the board.' },
      { anchor: 'draft-board', title: 'Which comps survive', text: 'Our own comps, sorted into the ones still playable and the ones a ban or a pick has broken.' }
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
    id: 'film-room',
    title: 'The map and the lab',
    blurb: 'What the reads mean, the seats, the deaths that cost most, the tape, and the position lab.',
    version: 1,
    // Only on a film (11 Sep 2026, the lead: "add a small tutorial for the map
    // and lab to see what can be done"). It never starts by itself: a film opens
    // on its title card, and the deck renders one chapter at a time, so at that
    // moment not one of the map's, the tape's or the lab's anchors is on the
    // page. The reader takes it on purpose from the film bar, and each step's
    // `before` walks the deck to the chapter it is about.
    match: { path: '/film/' },
    autoStart: false,
    // A film is a game's own page: there is no sensible film to walk to from
    // elsewhere, so the door is the "Show me around" pill in the film bar.
    onlyHere: true,
    // No `needs` and no `role`: a viewer opening a film can take the whole walk
    // but the Save step, and the film route itself is the only gate. A film
    // with no timeline has no map, no tape and no lab; those anchors are then
    // simply not on the page and the engine steps over them.
    steps: [
      {
        anchor: 'film-dots',
        title: 'The chapters',
        text: 'A film is a run of chapters, and these dots are where you are in it. This walk moves between them for you, so let it do the walking.'
      },
      {
        anchor: 'film-map-legend',
        before: 'openFilmMap',
        title: 'How the film reads a death',
        text: 'Every death of ours is read as one of four kinds: Avoidable, Traded, Bought an objective, or Clean. A button here lights that kind alone on the Rift, and the number beside it is how many the map is showing.'
      },
      {
        anchor: 'film-map-marks',
        before: 'openFilmMap',
        title: 'What every mark means',
        text: 'Every mark on this square is named here: a pin and its read, a death of theirs, a fight, and the vision heat. The tape and the lab carry the same pill for the marks they draw.'
      },
      {
        anchor: 'film-map-seats',
        before: 'openFilmMap',
        title: 'One seat at a time',
        text: 'Six tiles: All, then our five. Pick one and the Rift, the counts, the strip and the cards keep that seat alone. The tape wears the same six.'
      },
      {
        anchor: 'film-costliest',
        before: 'openFilmMap',
        title: 'The ones that cost most',
        text: 'The deaths the gold moved most after, each with the swing over the two minutes that followed. Press one and the card below walks to it.'
      },
      {
        anchor: 'film-death-card',
        before: 'openFilmMap',
        title: 'One death at a time',
        text: 'The card walks the deaths in order: who fell, the minute, the read in a sentence, what it cost, and what could have stopped it. Watch it opens the tape twenty seconds before, and Work on this second opens the lab there.'
      },
      {
        anchor: 'film-death-scene',
        before: 'openFilmMap',
        title: 'What was around them',
        text: 'The drawing is that moment: the ward that was down or slashed, our jungler a screen away, theirs already close, the objective, and who was on the kill. Positions come once a minute, so all of it is approximate.'
      },
      {
        anchor: 'film-map-full',
        before: 'openFilmMap',
        title: 'Full screen',
        text: 'The Rift takes the whole stage and the cards move into a drawer you can close and bring back. Escape closes the drawer first and leaves full screen next. The tape carries the same pill.'
      },
      {
        anchor: 'film-tape-sheet',
        before: 'openFilmTape',
        title: 'The tape',
        text: 'The tape plays the game on the Rift and stops on every beat: the moments, the objectives, the fights and every death of ours. The sheet is what it is telling you, and Pause holds a card as long as you want it.'
      },
      {
        anchor: 'film-tape-speed',
        before: 'openFilmTape',
        title: 'Your own pace',
        text: 'Half, one, two or four times. The film opens at the pace it was cut for, and whichever you pick here is remembered on this screen for every film after.'
      },
      {
        anchor: 'film-tape-layers',
        before: 'openFilmTape',
        title: 'Everyone, and our vision',
        text: 'Everyone slides all ten around the Rift between the minutes, ours ringed and theirs faded. Vision puts our wards down with the sight around each. Both are approximate: one position a minute, and a ward stands where its placer stood.'
      },
      {
        anchor: 'film-tape-marks',
        before: 'openFilmTape',
        title: 'What every mark means, here too',
        text: 'The tape draws the objectives, the wards and their sight, so the same panel hangs here and names them. It opens upward off its pill and nothing behind it is blocked.'
      },
      {
        anchor: 'film-tape-rail',
        before: 'openFilmTape',
        title: 'Every minute on the rail',
        text: 'One chip a minute, with a count on a minute that holds more than one; press any of them to jump there. Deaths only keeps the deaths and stops the tape on nothing else.'
      },
      {
        anchor: 'film-tape-lab',
        before: 'openFilmTape',
        title: 'Work on this second',
        text: 'This is the door into the lab: the tape holds where it stands and hands that second over to be worked on. Every death card on the map carries the same pill.'
      },
      {
        anchor: 'film-lab-tools',
        before: 'openFilmLab',
        title: 'Move, Ward and Path',
        text: 'Move drags one of ours to where they should have been, and a ghost stays where the minute put them. Ward and Control ward put vision down. Path draws the arrows, the way you would on a board.'
      },
      {
        anchor: 'film-lab-legend',
        before: 'openFilmLab',
        title: 'Safe, seen and dark',
        text: 'The ground is shaded three ways: in our sight and out of their reach, in our sight but inside it, and in their reach with nothing watching. Their reach is what each of theirs could cover in the next thirty seconds.'
      },
      {
        anchor: 'film-lab-reading',
        before: 'openFilmLab',
        title: 'What the ground says',
        text: 'One line under the map reads the difference: what came into sight, what left their reach, and what is still dark. It rewrites itself as you drag.'
      },
      {
        anchor: 'film-lab-save',
        before: 'openFilmLab',
        role: 'editor',
        title: 'Keep it for the team',
        text: 'Save keeps the drawing and its line on this second of the film, so the next person to open it finds the board you marked up.'
      },
      {
        anchor: 'film-lab-close',
        before: 'openFilmLab',
        title: 'Back to the tape',
        text: 'Close, or Escape, puts the lab away and leaves the tape where it stood. Escape twice over from anywhere on the film goes back to the game on Games.'
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
