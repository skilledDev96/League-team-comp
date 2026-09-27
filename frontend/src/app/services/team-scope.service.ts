import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { DEFAULT_TEAM_ID, isTeamId } from '../core/team-scope';
import { AuthService } from './auth.service';

/**
 * Which team this person is looking at (27 Sep 2026, release 2 of the multi-team work).
 *
 * One signal, `activeTeamId`, that every Firestore path in TeamDataService is built over through
 * `core/team-scope.ts`. The default is Bom Squad on the flat root paths, and in release 2 nothing
 * ever chooses anything else: the switcher is release 3's. What this service settles now is where
 * the choice lives and when it is read, so the listeners can be proven to open on the right prefix
 * before there is a second team to open them on.
 *
 * The choice is remembered per person per device, in localStorage under `bom-team:<email>`, and
 * read the moment AuthService sets `userEmail`: the id is part of the signal's own computation, so
 * the first listeners a sign-in opens land on the stored team, never on the default first and the
 * stored team a tick later. A value that is not a team id (an old key, a hand edit) is the default.
 * Signed out, the team is the default, so the login page belongs to no team. Local mode has one
 * team and is always the default.
 *
 * This service injects AuthService and nothing else. TeamDataService reads it and calls `choose`
 * when the active team vanishes from the teams list; later UserPrefsService will call `choose` when
 * a person's document names a team. Both point this way, never back, so there is no cycle.
 */
@Injectable({ providedIn: 'root' })
export class TeamScopeService {
  private readonly auth = inject(AuthService);

  /** The team chosen in this session, for the account that chose it; null until `choose` runs. */
  private readonly chosen = signal<{ email: string; teamId: string } | null>(null);

  /** The active team id: `DEFAULT_TEAM_ID` for Bom Squad on the root paths, a team id otherwise. */
  readonly activeTeamId: Signal<string> = computed(() => {
    if (this.auth.mode !== 'firebase') return DEFAULT_TEAM_ID;
    const email = this.auth.userEmail();
    if (!email) return DEFAULT_TEAM_ID;
    const chosen = this.chosen();
    if (chosen && chosen.email === email) return chosen.teamId;
    return this.stored(email);
  });

  /**
   * Make a team the active one and remember it for this account on this device. The default clears
   * the key, so a device that has never chosen keeps no key at all. Throws on a value that is neither
   * the default nor a team id, so a bad id can never build a path. Signed out there is nobody to
   * remember it for, and in local mode there is one team, so both are left alone.
   */
  choose(teamId: string): void {
    if (teamId !== DEFAULT_TEAM_ID && !isTeamId(teamId)) {
      throw new Error(`Not a team id: ${JSON.stringify(teamId)}`);
    }
    if (this.auth.mode !== 'firebase') return;
    const email = this.auth.userEmail();
    if (!email) return;
    this.chosen.set({ email, teamId });
    try {
      if (teamId === DEFAULT_TEAM_ID) localStorage.removeItem(this.key(email));
      else localStorage.setItem(this.key(email), teamId);
    } catch {
      /* private mode: the choice holds for this session */
    }
  }

  private stored(email: string): string {
    try {
      const raw = localStorage.getItem(this.key(email));
      return isTeamId(raw) ? raw : DEFAULT_TEAM_ID;
    } catch {
      return DEFAULT_TEAM_ID;
    }
  }

  private key(email: string): string {
    return `bom-team:${email}`;
  }
}

/**
 * Run `reset` whenever the signed-in account or the active team changes, from a service that keeps
 * one team's data for the session (27 Sep 2026, release 2).
 *
 * TeamDataService empties its own signals in `clearMemberData` when the session key changes, but the
 * three read-on-demand caches (rank history, match timelines, replay recordings) and the tournament
 * context are not its signals: it does not know the caches, and the tournament context injects it, so
 * a call from `clearMemberData` would be a cycle there and a new coupling for the rest. Each of them
 * watches the same two signals `followSession` does instead, so a switch empties them in the same
 * tick it closes the listeners. The baseline is the key at construction, not the first run of the effect: a
 * service made after sign-in keeps what it read in between (a link's wish, a first load), and only a
 * change from there resets it. Call from a constructor or a field initialiser, the way `effect` needs.
 */
export function resetOnTeamChange(reset: () => void): void {
  const auth = inject(AuthService);
  const scope = inject(TeamScopeService);
  const keyOf = () => `${auth.userEmail() ?? ''}|${scope.activeTeamId()}`;
  let seenAs = untracked(keyOf);
  effect(() => {
    const key = keyOf();
    if (key === seenAs) return;
    seenAs = key;
    untracked(reset);
  });
}
