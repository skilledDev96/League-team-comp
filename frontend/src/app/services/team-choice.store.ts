import { Injectable, signal } from '@angular/core';
import { DEFAULT_TEAM_ID, isTeamId } from '../core/team-scope';

/**
 * The team a person chose, and nothing else (27 Sep 2026, release 3 of the multi-team work).
 *
 * Two services need the active team in the same tick: TeamScopeService, which every Firestore path is
 * built over, and AuthService, whose `role()`, `canEdit()` and `canManageUsers()` follow the active
 * team since release 3. TeamScopeService injects AuthService, so AuthService cannot inject it back;
 * the choice lives here instead, in a store that injects nothing, and each of the two computes the
 * active team from it through the one rule (`firstTeam` in `core/access.ts`). Nothing else reads this
 * store: the app asks TeamScopeService.
 *
 * The choice is remembered per person per device, in localStorage under `bom-team:<email>`. A value
 * that is not a team id (an old key, a hand edit) reads as the default, and the default clears the
 * key, so a device that has never chosen keeps no key at all.
 */
@Injectable({ providedIn: 'root' })
export class TeamChoiceStore {
  /** The team chosen in this session, for the account that chose it; null until `choose` runs. */
  private readonly chosen = signal<{ email: string; teamId: string } | null>(null);

  /**
   * The team this account asked for: the session's choice when it is theirs, else the one stored on this
   * device, else the default. Reads the `chosen` signal, so a computed over it follows a choice. Whether
   * they may see it is not decided here.
   */
  wantedTeam(email: string | null): string {
    if (!email) return DEFAULT_TEAM_ID;
    const chosen = this.chosen();
    if (chosen && chosen.email === email) return chosen.teamId;
    return this.stored(email);
  }

  /** Remember `teamId` for `email`, for this session and on this device. */
  choose(email: string, teamId: string): void {
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
