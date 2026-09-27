import { Injectable, Signal, computed, effect, inject, untracked } from '@angular/core';
import { firstTeam } from '../core/access';
import { DEFAULT_TEAM_ID, isTeamId } from '../core/team-scope';
import { AuthService } from './auth.service';
import { TeamChoiceStore } from './team-choice.store';

/**
 * Which team this person is looking at (27 Sep 2026, release 2 of the multi-team work).
 *
 * One signal, `activeTeamId`, that every Firestore path in TeamDataService is built over through
 * `core/team-scope.ts`. The default is Bom Squad on the flat root paths. Three callers choose
 * another team, all through `choose` (Stage 3, the same day): the account menu's Team group, Admin ›
 * Teams (Switch to, a team just created, and the default once the active team is deleted), and
 * UserPrefsService when the person's document names a team. What this service settles is where the
 * choice lives and when it is read, so the listeners open on the right prefix from the first tick.
 *
 * The choice is remembered per person per device, in localStorage under `bom-team:<email>`
 * (TeamChoiceStore), and read the moment AuthService sets `userEmail`: the id is part of the signal's
 * own computation, so the first listeners a sign-in opens land on the stored team, never on the
 * default first and the stored team a tick later. Signed out, the team is the default, so the login
 * page belongs to no team. Local mode has one team and is always the default.
 *
 * Since release 3 (the same day) a person may see only some teams, and the team to open is decided by
 * one rule, `firstTeam` in `core/access.ts`: the wanted team (the session's choice, else the stored
 * one) when they may see it, else the root when they are a root member, else their first team. So a
 * stored key naming a team that has since taken them off its list is passed over, and a person on
 * other teams alone never lands on the root. `choose` refuses a team they may not see; the default is
 * always accepted, as "no choice", and the rule answers for it. AuthService computes the same id from
 * the same store, for its `role()`, `canEdit()` and `canManageUsers()`, since it cannot inject this
 * service (this one injects it); the store is what keeps the two in step.
 *
 * This service injects AuthService and the store and nothing else. TeamDataService reads it and calls
 * `choose` when the active team vanishes from the teams list; UserPrefsService calls `choose` when a
 * person's document names a team; the two switchers call it on a click. All point this way, never
 * back, so there is no cycle, and a job that finds the scope moved under it (`teamChangedNotice`
 * below) was moved by one of them.
 */
@Injectable({ providedIn: 'root' })
export class TeamScopeService {
  private readonly auth = inject(AuthService);
  private readonly choice = inject(TeamChoiceStore);

  /** The active team id: `DEFAULT_TEAM_ID` for Bom Squad on the root paths, a team id otherwise. */
  readonly activeTeamId: Signal<string> = computed(() => {
    if (this.auth.mode !== 'firebase') return DEFAULT_TEAM_ID;
    return firstTeam(this.choice.wantedTeam(this.auth.userEmail()), this.auth.rootRole(), this.auth.teamRoles());
  });

  /**
   * Make a team the active one and remember it for this account on this device. The default clears
   * the key, so a device that has never chosen keeps no key at all. Throws on a value that is neither
   * the default nor a team id, so a bad id can never build a path, and on a team this person may not
   * see (release 3), so no caller can open a prefix the rules would refuse. Signed out there is nobody
   * to remember it for, and in local mode there is one team, so both are left alone.
   */
  choose(teamId: string): void {
    if (teamId !== DEFAULT_TEAM_ID && !isTeamId(teamId)) {
      throw new Error(`Not a team id: ${JSON.stringify(teamId)}`);
    }
    if (this.auth.mode !== 'firebase') return;
    const email = this.auth.userEmail();
    if (!email) return;
    if (teamId !== DEFAULT_TEAM_ID && !this.auth.maySee(teamId)) {
      throw new Error(`You are not a member of the team ${teamId}.`);
    }
    this.choice.choose(email, teamId);
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

/**
 * The notice a job shows when it stops because the active team changed under it (27 Sep 2026, Stage 3c).
 *
 * The roster import, the player and analysis refreshes and the scout each capture `activeTeamId` when they
 * start and check it before every write: TeamDataService builds each path over the team that is active at the
 * moment of the write, so a switch mid-run would land the rest of a job on whichever team is now showing, the
 * root included. The switcher refuses while a job is on the Activity board, but the scope can still move under
 * a run (the person's document naming another team, the teams list falling back), so the jobs guard themselves
 * too. `job` is a phrase for the title, "the roster import"; the text is the same for all of them.
 */
export function teamChangedNotice(job: string): { title: string; text: string } {
  return {
    title: `Stopped: the team changed during ${job}`,
    text: 'What had already landed stays on the team it was written to; nothing was written to the new one.'
  };
}
