/** The Roster page's three views (13 Sep 2026: Table and Scouting became one Players view). */
export type RosterView = 'cards' | 'players' | 'report';

export const ROSTER_VIEWS: readonly RosterView[] = ['cards', 'players', 'report'];

/**
 * A view named in a link or a route, old names included: `table` and `scouting` were merged into `players`, and a
 * bookmark or the sheet's old link still lands there. Anything else is not a view.
 */
export function rosterViewOf(raw: string | null | undefined): RosterView | null {
  switch (raw) {
    case 'cards':
    case 'players':
    case 'report':
      return raw;
    case 'table':
    case 'scouting':
      return 'players';
    default:
      return null;
  }
}
