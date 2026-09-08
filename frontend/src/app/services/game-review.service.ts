import { inject, Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';
import { CompExpectation, GameReview } from '../models/team.models';
import { ActivityService } from './activity.service';

/**
 * Asks the review function to write a review for one game. The answer is
 * also returned, but the page reads the stored document through
 * `TeamDataService.gameReviews`, so a review written by the morning run
 * shows up the same way as one asked for by hand.
 */
@Injectable({ providedIn: 'root' })
export class GameReviewService {
  private readonly activity = inject(ActivityService);

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
      return await this.activity.run('Reviewing the game', () => this.call(matchId, expect), { detail: matchId });
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

  private async call(matchId: string, expect: CompExpectation | null): Promise<GameReview | null> {
    const user = getAuthInstance()?.currentUser;
    if (!user) throw new Error('Sign in to review a game.');
    const idToken = await user.getIdToken();
    const response = await fetch(this.functionUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ matchId, expect })
    });
    const data = (await response.json()) as (GameReview & { error?: string; declined?: boolean }) | { error?: string; declined?: boolean };
    if (!response.ok) throw new Error(data.error || 'The review request failed.');
    if ('declined' in data && data.declined) throw new Error('The reviewer declined to write about this game.');
    return data as GameReview;
  }

  private functionUrl(): string {
    const projectId = environment.firebase.projectId;
    const region = environment.functions?.region || 'europe-west1';
    return `https://${region}-${projectId}.cloudfunctions.net/gameReview`;
  }
}
