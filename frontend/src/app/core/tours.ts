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
  /**
   * One short line — what this is, in the fewest words that are still true.
   *
   * Measured on 12 Sep 2026 before the rewrite: 101 steps averaging 25 words, 98 of them over 12
   * and 14 over 35. The lead, on a three-sentence step: *"this does not make sense… keep it short.
   * Starter is basic view and full is everything expanded… no need for long sentences."* A tour
   * card is read standing up, mid-task, over the thing it is pointing at.
   *
   * **Aim for twelve words. Anything a reader might want second goes in `more`.**
   */
  text: string;
  /**
   * The rest, behind the card's ⓘ — the caveat, the exception, the thing it is easy to get wrong.
   * Absent on most steps; a step that needs no footnote should not grow one.
   */
  more?: string;
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
    // On Home since 13 Sep 2026, where sign-in lands: on /roster it never ran for anyone who did not
    // go looking. Version 2 walks everyone through the new landing once.
    id: 'welcome',
    title: 'Welcome',
    blurb: 'Home, the five pages, edit mode and where the tours live.',
    version: 2,
    match: { path: '/home' },
    steps: [
      {
        anchor: 'nav',
        title: 'Five pages',
        text: 'Home is where you land. Roster is the team, Comps the drafts, Games the history, Prep & Draft opponents.', more: 'Prep & Draft covers every opponent, scrim or tournament: scouting, replays and the live draft. Games also shows what keeps happening across them.'
      },
      {
        anchor: 'home-hero',
        title: 'The season',
        text: 'The record, the next series and a pill to scout them.', more: 'All time counts every game; This season only the running tournament. Motion turns the moving splash and the count-ups off on this screen.'
      },
      {
        anchor: 'home-spotlight',
        title: 'The last series MVP',
        text: 'Whoever carried the last finished series, and the race for the most titles beside it.', more: 'A title counts once most of the series has figures: import the replays on Prep & Draft and the crown lands.'
      },
      {
        anchor: 'home-tiles',
        title: 'The season at a glance',
        text: 'The podium, the form, the comp of the month, the records to beat and what to work on.', more: 'Further down: the five, objective control and the trophy cabinet. Every figure is read off the same games the Games page lists.'
      },
      {
        anchor: 'edit-toggle',
        title: 'Edit mode',
        text: 'Every editing control lives behind this switch.', more: 'Everything saves the moment you change it. There is no Save button.',
        editMode: false,
        role: 'editor'
      },
      {
        anchor: 'user-menu',
        title: 'Help and log out',
        text: 'Help and tours brings any of these tours back, alongside Log out.', more: 'In edit mode the menu also holds Admin (settings, roles and diagnostics) and Refresh everything from Riot, which re-reads the players and the matches.',
        before: 'openUserMenu'
      }
    ]
  },
  {
    id: 'roster',
    title: 'Roster',
    blurb: 'Cards, the A team, second seats, the table and the scouting view.',
    version: 2,
    match: { path: '/roster' },
    needs: 'players',
    steps: [
      // These two were the welcome tour's until it moved to Home (13 Sep 2026).
      { anchor: 'roster-views', title: 'One roster, four depths', text: 'Cards for who plays what, Table for rank and form.', more: 'Scouting holds pools, matchups and the practice board. Scout report shows us the way an opponent scouts us.' },
      { anchor: 'quick-actions', title: 'What you do most', text: 'One press to open the draft room or scout the next opponent.', more: 'Edit mode adds three more: refreshing after practice, adding a comp and importing a replay.' },
      { anchor: 'roster-card', title: 'A player card', text: 'Role, playstyle and main champion at a glance.', more: 'Quick look opens the pool and the links. Profile opens the full page with the stats and the coaching notes.', query: { view: 'cards' } },
      { anchor: 'roster-ateam', title: 'A team for Patterns', text: 'Patterns counts these five by default, and the draft room follows them.', more: 'Bench leaves a player out. Same flag Admin sets, so the five stay one thing everywhere.', editMode: true, query: { view: 'cards' } },
      { anchor: 'roster-main-seat', title: 'Main seat', text: 'The seat in the title, read by Patterns’ Main filter.', more: 'Patterns’ Main counts a game only when all five sat in their main seat, so set these before reading it.', editMode: true, query: { view: 'cards' } },
      { anchor: 'roster-second-seat', title: 'Second seat', text: 'Other roles this player can cover.', more: 'Patterns’ Roles filter and the draft room’s seat proposals read this.', editMode: true, query: { view: 'cards' } },
      { anchor: 'detail-roster', title: 'Starter or Full', text: 'Starter is the basics, Full is everything expanded.', more: 'One switch for all four views, remembered for you.' },
      { anchor: 'table-queue', title: 'The table', text: 'Rank and recent form per queue, one row per player.', more: 'Recent is the last games scanned, not the ladder record beside it.', query: { view: 'table' } },
      { anchor: 'scouting-card', title: 'Scouting', text: 'Each player’s pool, and what they are working on and learning.', more: 'Full opens every card and adds strengths, weaknesses and suggested bans.', query: { view: 'scouting' } },
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
      { anchor: 'player-edit', title: 'Edit this player', text: 'Opens the editor in a drawer.', more: 'It is the same form Admin uses, so nothing about a player lives anywhere else.', editMode: true },
      { anchor: 'pe-identity', title: 'Name, tag and role', text: 'Riot ID is what every refresh reads.', more: 'Change the role and the roster regroups.', editMode: true, before: 'openPlayerEditor' },
      { anchor: 'pe-bench', title: 'A team or Bench', text: 'A team or Bench, the same flag as the roster card.', more: 'The second seats are the roles they also cover.', editMode: true, before: 'openPlayerEditor' },
      { anchor: 'pe-pool', title: 'Pool and bans', text: 'Their declared pool, plus bans to take away from them in practice.', more: 'First champion in the pool is shown as the main.', editMode: true, before: 'openPlayerEditor' },
      { anchor: 'pe-refresh', title: 'Refresh from Riot', text: 'Re-reads rank, recent champions and the observed playstyle.', more: 'Anything typed by hand is kept.', editMode: true, before: 'openPlayerEditor' },
      { anchor: 'pe-hand-edited', title: 'Hand-edited', text: 'Saving anything here marks the player hand-edited.', more: 'From then on the morning refresh keeps your text, pool and bans.', editMode: true, before: 'openPlayerEditor' }
    ]
  },
  {
    id: 'comps',
    title: 'Adding a comp',
    blurb: 'The board, the plan, what the comp expects, and its record.',
    version: 2,
    match: { path: '/comps' },
    role: 'editor',
    needs: 'comps',
    steps: [
      { anchor: 'comps-add', title: 'Add a comp', text: 'Creates a blank comp and opens its board, right here.', more: 'Admin only keeps the names and picks as text.', editMode: true },
      { anchor: 'comp-board', title: 'The board', text: 'Click a seat, then a champion.', more: 'Every pick saves as it lands. A finished comp hides the champions until you press a seat or Change picks.', editMode: true, before: 'openTourComp' },
      { anchor: 'comp-category', title: 'Category', text: 'A short label to filter by: Meta, Comfort, For fun.', editMode: true, before: 'openTourComp' },
      { anchor: 'comp-gameplan', title: 'Game plan', text: 'Early, mid and late, in your own words.', more: 'The draft advisor and the post-game review both read it.', editMode: true, before: 'openTourComp' },
      { anchor: 'comp-expect', title: 'What we expect', text: 'Four axes read off the champions.', more: 'Overrule them and the review checks the game against your version instead.', editMode: true, before: 'openTourComp' },
      { anchor: 'comp-bans', title: 'Ban recommendations', text: 'Champions to take away when we run this comp.', more: 'They come up on our ban steps in the draft room.', editMode: true, before: 'openTourComp' },
      { anchor: 'comp-counts-under', title: 'Counts as part of', text: 'Fold this comp’s games into another comp’s record.', more: 'For the records only, so it lives in Full. Use it for near-duplicate drafts you keep separate to play from.', editMode: true, before: 'showFullComps' },
      { anchor: 'comp-record', title: 'Track record', text: 'Wins and losses from match history, or logged by hand.', more: 'Full adds each result and the notes from the games that count as this comp.' }
    ]
  },
  {
    // Comps' one tour was editor-only, so nobody who only reads the page had been shown it
    // (12 Sep 2026). No role and no edit-mode step, like prep-read.
    id: 'comps-read',
    title: 'Reading a comp',
    blurb: 'What a comp holds and how much of it to show.',
    version: 1,
    match: { path: '/comps' },
    needs: 'comps',
    steps: [
      { anchor: 'detail-comps', title: 'Starter or Full', text: 'Starter is the basics, Full is everything expanded.', more: 'Full opens every comp with each result and the notes from its games. Remembered for you.' },
      { anchor: 'comp-summary', title: 'A comp', text: 'Its name and record. Click it to open.' },
      { anchor: 'comp-slots', title: 'The five', text: 'Each seat’s champion, and who on our side can play it.', before: 'openTourComp' },
      { anchor: 'comp-gameplan', title: 'Game plan', text: 'How the comp wants to play, early to late.', before: 'openTourComp' },
      { anchor: 'comp-bans', title: 'Bans', text: 'What to take away when we run it.', before: 'openTourComp' }
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
      { anchor: 'detail-games', title: 'Starter or Full', text: 'Starter shows what to act on, Full adds everything else.', more: 'Your choice is remembered for you, on every page that offers the switch.', query: { tab: 'games' } },
      { anchor: 'games-next-up', title: 'What to do next', text: 'One card when something is waiting, otherwise nothing.', more: 'It shows a film that asked to be remembered, a game nobody has reviewed, or the next opponent.', query: { tab: 'games' } },
      { anchor: 'games-refresh', title: 'Refresh matches from Riot', text: 'Pulls in the flex and Clash games we played.', more: 'Scrims come from replays instead, and tournament games from the draft room.', editMode: true, query: { tab: 'games' } },
      { anchor: 'games-filters', title: 'Filters', text: 'How far back to look, plus the champion box every page shares.', more: 'Full adds the source, the result and the opponent.', query: { tab: 'games' } },
      { anchor: 'games-record', title: 'The record', text: 'Wins and losses over whatever the filters leave.', more: 'The strip beside it is the last games as W and L. Full splits the record by source and by side.', query: { tab: 'games' } },
      { anchor: 'games-row', title: 'A game', text: 'Open a row: the review first, then everything else on the game.', more: 'Then the objectives, the scoreboard, the note and how the game went.', query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-review-panel', title: 'The review', text: 'What the coach wrote about this game, seat by seat.', more: 'It holds the one thing to work on and what went well. The Reviewed chip on the row opens the film room, which walks through the same review.', query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-note', title: 'Match note', text: 'Write a sentence about this game.', more: 'Comps collect these under Notes from its games, and the review reads them too.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-practice', title: 'Practice', text: 'Mark a game as practice and Patterns leaves it out.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-counts-as', title: 'Counts as', text: 'Which comp this game counts towards.', more: 'Auto is the matcher’s read of the five champions. Pick a comp to overrule it.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-story', title: 'How the game went', text: 'Minute by minute: the gold curve, lanes, fights and who swung it.', more: 'It sits at the bottom of the row. A game Riot cannot see reads from the replay recorder instead, and one with neither says so.', query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-review-btn', title: 'Review this game', text: 'Two model calls, about a dime, after you confirm.', more: 'The review lands on the row, on the Reviews tab and on each player’s profile.', editMode: true, query: { tab: 'games' }, before: 'openGameList' },
      { anchor: 'games-tabs', title: 'Patterns and Reviews', text: 'Two more tabs: what keeps happening across games, and every review.', more: 'Reviews opens on the newest review in full, with the rest a line each.', query: { tab: 'games' } }
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
      { anchor: 'detail-patterns', title: 'Starter or Full', text: 'Starter is the conclusion, Full adds the filters behind it.', more: 'The next three steps are about filters that only Full draws, so the walk opens Full and puts your setting back at the end.' },
      { anchor: 'patterns-source', title: 'Source', text: 'Which games the numbers come from: flex, scrims and Clash, or tournaments.', more: 'The count on each is how many games it would leave you. A replay imported against a series game counts as a tournament game.' },
      { anchor: 'patterns-prep', title: 'Prep', text: 'Games played to win: practice games drop out until you choose All.', more: 'Practice is marked on the Games tab. The filter keeps working at Starter, where the field is not drawn.', before: 'showFullPatterns' },
      { anchor: 'patterns-starters', title: 'Starters', text: 'A team is whoever is not on the bench on the Roster page.', more: 'Custom is any set of players who all have to be on our side. Tick them in the row that opens under it.', before: 'showFullPatterns' },
      { anchor: 'patterns-roles', title: 'Roles', text: 'Main counts a game only when all five sat in their main seat.', more: 'The filter most likely to look broken: one off-role game shows 0. 2nd adds the second seats, Any counts every game.', before: 'showFullPatterns' },
      { anchor: 'patterns-workon', title: 'Work on, keep doing', text: 'Each line is the biggest gap between our wins and our losses.', more: 'Only gaps that clear the minimum on both sides show. Fold a line out for the games it was read from.' },
      { anchor: 'patterns-sections', title: 'More sections', text: 'Four chips: lanes, what changes when we win, recurring problems, the game list.', more: 'All four start closed, and whichever you open is remembered.' }
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
      { anchor: 'prep-series', title: 'A series', text: 'One card per opponent, opened on the next series you play.', more: 'Opponents you have already played stay closed.' },
      { anchor: 'prep-fearless', title: 'What is burned', text: 'What the series has already spent, and nobody can play again.', more: 'Under Fearless Draft, a champion played by either team is gone for the rest of the series.' },
      { anchor: 'detail-prep', title: 'How much to show', text: 'Starter is their five on a line each, Full expands everything.', more: 'Full adds both ranked queues, who beats them, what they played lately and their bench. Your choice is remembered for you.' },
      { anchor: 'prep-roster', title: 'Their five', text: 'Each player’s expected seat, their rank, and the three champions they actually play.', more: 'Both ranked queues added together, most games first.' },
      { anchor: 'prep-banboard', title: 'Who to ban', text: 'Champions across their five that a ban would actually hurt.', more: 'Ranked by games rather than win rate: a 100% over three games is a curiosity.' },
      { anchor: 'prep-team', title: 'As a team', text: 'Games their five queued together lately, and what they pick then.', more: 'An editor fetches it once, and everyone sees it after that.' }
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
      { anchor: 'draft-games', title: 'Which game', text: 'Picks which game of the series the room is showing.', more: 'Everyone on the link sees the same game.' },
      { anchor: 'draft-step-bar', title: 'Whose turn', text: 'Ban or pick, and whose, across the draft’s twenty steps.', more: 'The order is fixed by which side we are on. The clock here is a reminder: the real one is in the client.' },
      { anchor: 'draft-wall', title: 'What is left', text: 'Every champion, greyed out if taken, banned or burned this series.' },
      { anchor: 'draft-lanes', title: 'How the lanes read', text: 'Our picks against theirs, seat by seat.', more: 'A lane only reads once both picks are on the board.' },
      { anchor: 'draft-board', title: 'Which comps survive', text: 'Comps opens our comps: still playable, broken, and whose pool is thinning.', more: 'A ban or a pick is what breaks one. Escape closes it.' }
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
      { anchor: 'draft-games', title: 'Series and game', text: 'Pick which game of the series to draft, or add the next one.', more: 'The room needs a tournament, created in Admin, plus a series and a game, created on the Plan view.', editMode: true },
      { anchor: 'draft-side', title: 'Our side', text: 'Blue bans and picks first, so set our side before anything else.', more: 'Everything after depends on it: whose turn it is, which seat a pick lands in, who banned what.', editMode: true },
      { anchor: 'draft-step-bar', title: 'Whose turn', text: 'Shows whether it is a ban or a pick, and whose.', more: 'The clock here is a reminder only. The real one runs in the client.', editMode: true },
      { anchor: 'draft-wall', title: 'Hold, then confirm', text: 'Click a champion to hold it, then confirm to lock it in.', more: 'Holding shows the seat the pick would land in. Confirming locks it and moves the draft on.', editMode: true },
      { anchor: 'draft-board', title: 'Our comps', text: 'Comps opens which of our comps still work on this board.', more: 'Mid-draft, a champion clicked there is held like one clicked on the wall, and you confirm it here.', editMode: true },
      { anchor: 'draft-target-bans', title: 'Target bans', text: 'Target bans from scouting the opponent, shown on our ban steps.', more: 'One click holds one.', editMode: true },
      { anchor: 'draft-undo', title: 'Undo and Reset', text: 'Undo steps back one and Reset clears the whole game.', more: 'Both ask first: Undo before it removes a pick, Reset before it clears the game.', editMode: true },
      { anchor: 'draft-advisor', title: 'Ask what to pick', text: 'One model call, a few cents, for a pick suggestion.', more: 'The answer is saved on the game for everyone on the link, and it leads with your team plan while that is still legal.', editMode: true },
      { anchor: 'draft-done', title: 'Draft complete', text: 'Set the result here, then open the next game.', more: 'Import the replay on the Plan view to get the numbers.', editMode: true }
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
      { anchor: 'plan-scout-btn', title: 'Scout', text: 'Opens their roster, bans and notes for the series.', more: 'Scouting writes, so edit mode turns on.', editMode: true },
      { anchor: ['prep-paste', 'prep-scout-cta', 'prep-scout-again'], title: 'Paste their roster', text: 'Their op.gg multi-link, or Name#TAG one per line.', more: 'Only the text of the link is read. Nothing is looked up until you scout.', editMode: true, before: 'clickScout' },
      { anchor: ['prep-scout-cta', 'prep-scout-again'], title: 'Scout from Riot', text: 'Looks up what each of them plays.', more: 'About two minutes a player, and it keeps running if you leave the page. Scout again reads further back.', editMode: true, before: 'clickScout' },
      { anchor: 'prep-banboard', title: 'Ban board', text: 'Champions their five live on, at most two per player.', more: 'A click adds one to the target bans.', editMode: true, before: 'clickScout' },
      { anchor: 'prep-sub-toggle', title: 'Their bench', text: 'With six names, mark one as the bench.', more: 'As a team can only read the right five once someone is on the bench.', editMode: true, before: 'clickScout' },
      { anchor: 'prep-team', title: 'As a team', text: 'Games their five queued together lately.', more: 'One fetch serves the whole team.', editMode: true, before: 'clickScout' },
      { anchor: 'prep-target-bans', title: 'Target bans and notes', text: 'Bans set here reach the draft room’s ban steps.', more: 'The notes are shown to the advisor.', editMode: true, before: 'clickScout' }
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
      { anchor: 'prep-groups', title: 'Scrims and tournaments', text: 'One page for every opponent, with scrims in their own group.', more: 'Scrims have no dates, no best-of, and nothing burns. A tournament keeps its fearless pool.', editMode: true, route: '/tournaments', query: { view: 'plan', group: 'scrims' } },
      { anchor: 'prep-dropzone', title: 'Drop replays here', text: 'Drop .rofl files here and each one becomes a game.', more: 'Take them from Documents › League of Legends › Replays with the name Riot gave them, since the match id is read from it. You are asked who it was against.', editMode: true, route: '/tournaments', query: { view: 'plan', group: 'scrims' } },
      { anchor: 'prep-add-opponent', title: 'Prep an opponent first', text: 'A team can exist by name alone, so scout before any games.', more: 'Drop the replays in afterwards.', editMode: true, route: '/tournaments', query: { view: 'plan', group: 'scrims' } },
      { anchor: 'prep-series', title: 'An opponent', text: 'Their games, scouting and target bans in one panel.', more: 'Files dropped in here are named after them, and Draft opens the room on their next game.', editMode: true, route: '/tournaments', query: { view: 'plan', group: 'scrims' } },
      { anchor: 'prep-refresh', title: 'Count them', text: 'Replays only count after Refresh matches from Riot, on Games.', more: 'Matched, they reach the comp records and Patterns.', editMode: true, route: '/tournaments', query: { view: 'plan', group: 'scrims' } }
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
      { anchor: 'admin-tabs', title: 'The editors', text: 'Players, fill-ins, comps and tournaments are added here.', more: 'Series, games and scouting live on Prep & Draft. Everything else is edited in edit mode on its own page.' },
      { anchor: 'admin-setting-advisor', title: 'Saved as you go', text: 'Each line says where its setting takes effect.', more: 'The advisor’s auto-ask applies in the draft room. The morning review applies to the next run.', query: { tab: 'settings' } },
      { anchor: 'admin-access-role', title: 'Roles', text: 'Viewer reads, Contributor edits, Admin adds Settings, Access and Diagnostics.', more: 'A viewer sees everything but this Admin page. Deleting is Admin only.', query: { tab: 'access' } },
      { anchor: 'admin-diag-health', title: 'Diagnostics', text: 'What the morning run did and spent, and data health per game.', more: 'The draft log, browser errors and your tours sit here too.', query: { tab: 'diagnostics' } }
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
        text: 'These dots show which chapter of the film you are on.', more: 'A film is a run of chapters, and this walk moves between them for you, so let it do the walking.'
      },
      {
        anchor: 'film-map-legend',
        before: 'openFilmMap',
        title: 'How deaths are read',
        text: 'Every death of ours is Avoidable, Traded, Bought an objective, or Clean.', more: 'A button lights that kind alone on the Rift, and the number beside it is how many the map is showing.'
      },
      {
        anchor: 'film-map-marks',
        before: 'openFilmMap',
        title: 'What every mark means',
        text: 'Names every mark on the square: pins, their deaths, fights, vision heat.', more: 'The tape and the lab carry the same pill for the marks they draw.'
      },
      {
        anchor: 'film-map-seats',
        before: 'openFilmMap',
        title: 'Pick one seat',
        text: 'Six tiles, All plus our five, filter the Rift, counts and cards.', more: 'The costliest deaths follow the seat too, and the tape wears the same six tiles.'
      },
      {
        anchor: 'film-costliest',
        before: 'openFilmMap',
        title: 'Costliest deaths',
        text: 'Deaths the gold moved most after, with the swing over the two minutes.', more: 'Press one and the death card below walks to it.'
      },
      {
        anchor: 'film-death-card',
        before: 'openFilmMap',
        title: 'Death cards',
        text: 'Walks the deaths in order: who fell, the minute, the read, the cost.', more: 'Each card also says what could have stopped it. Watch opens the tape twenty seconds before, and Work on this second opens the lab there.'
      },
      {
        anchor: 'film-death-scene',
        before: 'openFilmMap',
        title: 'What was around them',
        text: 'A drawing of that moment: the wards, both junglers, the objective, the killers.', more: 'Positions come once a minute, so all of it is approximate.'
      },
      {
        anchor: 'film-map-full',
        before: 'openFilmMap',
        title: 'Full screen',
        text: 'The Rift takes the whole stage and the cards move into a drawer.', more: 'Escape closes the drawer first and leaves full screen next. The tape carries the same pill.'
      },
      {
        anchor: 'film-tape-sheet',
        before: 'openFilmTape',
        title: 'The tape',
        text: 'Plays the game on the Rift and stops on every beat.', more: 'Beats are the moments, objectives, fights and every death of ours. The sheet says what it stopped on, and Pause holds a card.'
      },
      {
        anchor: 'film-tape-speed',
        before: 'openFilmTape',
        title: 'Your own pace',
        text: 'Half, one, two or four times speed for the tape.', more: 'A film opens at the pace it was cut for. Whichever you pick here is remembered on this screen for every film after.'
      },
      {
        anchor: 'film-tape-layers',
        before: 'openFilmTape',
        title: 'Everyone, and our vision',
        text: 'Two layers: all ten players moving, and our wards with their sight.', more: 'Ours are ringed and theirs faded. Both are approximate: one position a minute, and a ward stands where its placer stood.'
      },
      {
        anchor: 'film-tape-marks',
        before: 'openFilmTape',
        title: 'Marks, here too',
        text: 'Same marks panel as the map, naming what the tape draws.', more: 'The tape draws the objectives, the wards and their sight. The panel opens upward off its pill and blocks nothing behind it.'
      },
      {
        anchor: 'film-tape-rail',
        before: 'openFilmTape',
        title: 'The minute rail',
        text: 'One chip a minute, and pressing any of them jumps the tape there.', more: 'A minute holding more than one shows a count. Deaths only keeps the deaths and stops the tape on nothing else.'
      },
      {
        anchor: 'film-tape-lab',
        before: 'openFilmTape',
        title: 'Work on this second',
        text: 'Door into the lab: the tape holds and hands that second over.', more: 'Every death card on the map carries the same pill.'
      },
      {
        anchor: 'film-lab-tools',
        before: 'openFilmLab',
        title: 'Move, Ward and Path',
        text: 'Move drags one of ours where they should have been, leaving a ghost.', more: 'The ghost stays where the minute put them. Ward and Control ward put vision down, and Path draws the arrows, the way you would on a board.'
      },
      {
        anchor: 'film-lab-legend',
        before: 'openFilmLab',
        title: 'Safe, seen and dark',
        text: 'The ground shades three ways: safe, seen but in reach, and dark.', more: 'Safe is in our sight and out of their reach. Their reach is what each of theirs could cover in the next thirty seconds.'
      },
      {
        anchor: 'film-lab-reading',
        before: 'openFilmLab',
        title: 'What the ground says',
        text: 'One line under the map reads the difference your changes made.', more: 'It names what came into sight, what left their reach, and what is still dark, rewriting itself as you drag.'
      },
      {
        anchor: 'film-lab-save',
        before: 'openFilmLab',
        role: 'editor',
        title: 'Save for the team',
        text: 'Save keeps the drawing and its line on this second of the film.', more: 'The next person to open it finds the board you marked up.'
      },
      {
        anchor: 'film-lab-close',
        before: 'openFilmLab',
        title: 'Back to the tape',
        text: 'Close, or Escape, puts the lab away and leaves the tape where it stood.', more: 'Escape twice over from anywhere on the film goes back to the game on Games.'
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
