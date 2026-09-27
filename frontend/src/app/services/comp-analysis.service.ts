import { inject, Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { compSeats } from '../core/comp-alias';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';
import { assertTeamEcho, teamIdForRequest } from '../core/team-echo';
import { CompAnalysis, Comp, Player, ROLES } from '../models/team.models';
import { UiService } from './ui.service';
import { ActivityService } from './activity.service';
import { TeamScopeService } from './team-scope.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class CompAnalysisService {
  private readonly ui = inject(UiService);
  private readonly activity = inject(ActivityService);
  private readonly scope = inject(TeamScopeService);
  private readonly toast = inject(ToastService);

  /**
   * Whether a run is in flight, held here rather than on the Analysis page.
   *
   * A run is not tied to the page that started it: the function writes
   * `meta/compAnalysis` itself, so the result arrives over the snapshot
   * listener whether or not anyone is looking. Keeping this on the component
   * meant navigating away destroyed the only sign it was still going, and it
   * read as a cancelled refresh. It is not cancelled — nothing aborts the
   * fetch, and the write lands regardless.
   */
  readonly running = signal(false);

  /**
   * Trigger a fresh analysis on the backend. Returns the computed result.
   *
   * `running` is managed here rather than by the caller, so every page that can
   * start a run reports it the same way and none can forget to clear it.
   *
   * The run is for the active team (release 2, 27 Sep 2026). The team is read once, here: the body
   * names it and the answer's echo is checked against the same id, whatever the scope does while
   * the function runs. An answer computed for another team is refused with `BackendBehindError`
   * rather than returned, so it is neither announced as refreshed nor applied; the caller says what
   * to do about it (`core/team-echo.ts`).
   */
  async refresh(
    players: Player[],
    comps: Comp[],
    overrides: Record<string, string> = {}
  ): Promise<CompAnalysis> {
    this.running.set(true);
    try {
      const teamId = this.scope.activeTeamId();
      const answer = await this.activity.run(
        'Refreshing match analysis',
        () => this.run(players, comps, overrides, teamId),
        { detail: 'reading recent 5-stack games' }
      );
      // After the job and before the "refreshed" toast. The activity board reports a job that threw
      // as the job failing, and this is not that: the job ran, its answer is another team's. So the
      // refusal is thrown here, and the one toast that says so is the applier's.
      assertTeamEcho(teamId, answer);
      this.toast.show('Match analysis refreshed', { kind: 'ok', icon: 'check_circle' });
      return answer;
    } finally {
      this.running.set(false);
    }
  }

  /** The POST itself. The answer carries the `teamId` the function computed for; `refresh` checks it. */
  private async run(
    players: Player[],
    comps: Comp[],
    overrides: Record<string, string>,
    teamId: string
  ): Promise<CompAnalysis & { teamId?: unknown }> {
    const idToken = await this.idToken();
    const response = await fetch(this.functionUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        players: players.map((player) => ({
          id: player.id,
          name: player.name,
          riotTag: player.profile?.riotTag,
          region: player.profile?.region
        })),
        comps: comps.map((comp) => {
          // Each seat's champions, the priority first then its fallbacks (20 Sep 2026). Undefined for
          // a comp holding no fallback — which the matcher reads as "score this comp the way it was
          // scored yesterday" — so the day this shipped every comp's record is unchanged. The rule is
          // `compSeats`, mirroring `seatsOfComp` in `api/src/daily-refresh.ts`, because the morning
          // run and this Refresh must hand the one matcher the same comps or they would attribute the
          // same game two ways.
          const seats = compSeats(comp);
          return {
            id: comp.id,
            name: comp.name,
            countsUnder: comp.countsUnder ?? null,
            // Pull the champion out of each "Champion - note" pick line. Still the PRIORITY five, and
            // still what a comp with no seats is matched on.
            champions: ROLES.map((role) => this.ui.parseCompLine(comp.picks[role] ?? '').champion).filter(Boolean),
            // Conditional spread, not `seats: seats ?? undefined`: absent is a meaningful value here
            // and `JSON.stringify` drops an undefined key anyway, so say it once and plainly.
            ...(seats && { seats })
          };
        }),
        // Games placed by hand. The backend applies these over its own champion
        // matching, so the win rates it returns already account for them.
        overrides,
        // The team the analysis is for (release 2): no key at all for the default, so Bom Squad's
        // body is the body it always was; the id for any other team.
        ...teamIdForRequest(teamId)
      })
    });
    const data = (await response.json()) as CompAnalysis & { error?: string; teamId?: unknown };
    if (!response.ok) {
      throw new Error(data.error || 'Match analysis request failed.');
    }
    return data;
  }

  /**
   * The signed-in person's ID token, or the reason there is none. Its own method so a spec can stand
   * in for the Firebase session and drive the POST itself, body and echo check included.
   */
  private async idToken(): Promise<string> {
    if (!isFirebaseConfigured()) {
      throw new Error('Match analysis runs on the deployed app — sign in there to refresh.');
    }
    const auth = getAuthInstance();
    const user = auth?.currentUser;
    if (!auth || !user) {
      throw new Error('Sign in first to run match analysis.');
    }
    return user.getIdToken();
  }

  private functionUrl(): string {
    const projectId = environment.firebase.projectId;
    const region = environment.functions?.region || 'europe-west1';
    return `https://${region}-${projectId}.cloudfunctions.net/getCompAnalysis`;
  }
}
