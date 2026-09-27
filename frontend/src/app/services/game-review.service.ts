import { inject, Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';
import { assertTeamEcho, teamIdForRequest } from '../core/team-echo';
import { CompExpectation, GameReview } from '../models/team.models';
import { ActivityService } from './activity.service';
import { TeamScopeService } from './team-scope.service';

/**
 * Asks the review function to write a review for one game. The answer is
 * also returned, but the page reads the stored document through
 * `TeamDataService.gameReviews`, so a review written by the morning run
 * shows up the same way as one asked for by hand.
 *
 * The review is for the active team (release 2, 27 Sep 2026): the body names
 * it and the answer must echo it, or it is refused (`core/team-echo.ts`).
 */
@Injectable({ providedIn: 'root' })
export class GameReviewService {
  private readonly activity = inject(ActivityService);
  private readonly scope = inject(TeamScopeService);

  /** Match ids with a review in flight, so two rows can show their own state. */
  readonly busy = signal<ReadonlySet<string>>(new Set());
  /** The last error per match, for the row to show beside the button. */
  readonly errors = signal<ReadonlyMap<string, string>>(new Map());

  get available(): boolean {
    return isFirebaseConfigured();
  }

  isBusy(matchId: string): boolean {
    return this.busy().has(matchId);
  }

  errorFor(matchId: string): string | undefined {
    return this.errors().get(matchId);
  }

  async review(matchId: string, expect: CompExpectation | null): Promise<GameReview | null> {
    this.busy.update((s) => new Set(s).add(matchId));
    this.errors.update((m) => {
      const next = new Map(m);
      next.delete(matchId);
      return next;
    });
    try {
      // Read once: the body names this team and the answer's echo is checked against the same id,
      // whatever the scope does while the function runs.
      const teamId = this.scope.activeTeamId();
      return await this.activity.run('Reviewing the game', () => this.call(matchId, expect, teamId), { detail: matchId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The review failed.';
      this.errors.update((m) => new Map(m).set(matchId, message));
      return null;
    } finally {
      this.busy.update((s) => {
        const next = new Set(s);
        next.delete(matchId);
        return next;
      });
    }
  }

  private async call(matchId: string, expect: CompExpectation | null, teamId: string): Promise<GameReview | null> {
    const idToken = await this.idToken();
    const response = await fetch(this.functionUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      // No `teamId` key at all for the default, so Bom Squad's body is the body it always was.
      body: JSON.stringify({ matchId, expect, ...teamIdForRequest(teamId) })
    });
    const data = (await response.json()) as
      | (GameReview & { error?: string; declined?: boolean; teamId?: unknown })
      | { error?: string; declined?: boolean; teamId?: unknown };
    if (!response.ok) throw new Error(data.error || 'The review request failed.');
    // The echo before the verdict: a deployment older than release 2 answers for the root whatever
    // the body said, so its verdict, written or declined, is about another team's game and is
    // refused as such. Thrown inside the job on purpose: every review failure reaches the person
    // through the activity board's toast, the row's line and the takeover, all off the message
    // `review` keeps per match, and this one rides that path rather than adding a toast of its own.
    assertTeamEcho(teamId, data);
    if ('declined' in data && data.declined) throw new Error('The reviewer declined to write about this game.');
    return data as GameReview;
  }

  /**
   * The signed-in person's ID token, or the reason there is none. Its own method so a spec can stand
   * in for the Firebase session and drive the POST itself, body and echo check included.
   */
  private async idToken(): Promise<string> {
    const user = getAuthInstance()?.currentUser;
    if (!user) throw new Error('Sign in to review a game.');
    return user.getIdToken();
  }

  private functionUrl(): string {
    const projectId = environment.firebase.projectId;
    const region = environment.functions?.region || 'europe-west1';
    return `https://${region}-${projectId}.cloudfunctions.net/gameReview`;
  }
}
