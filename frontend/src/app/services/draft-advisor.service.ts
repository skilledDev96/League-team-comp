import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';
import { teamIdForRequest } from '../core/team-echo';
import { DraftAdvice } from '../models/team.models';
import { isNoBan } from '../pages/tournaments/draft-sequence';
import { ActivityService } from './activity.service';
import { TeamScopeService } from './team-scope.service';

/**
 * The request with every ban nobody saw taken out of its bans (17 Sep 2026). `NO_BAN` marks a step, not a champion,
 * and the model would read "-" as one; filtered here as well as where the room builds the request, so no caller can
 * send one.
 */
export function withoutUnseenBans(request: Record<string, unknown>): Record<string, unknown> {
  const bans = request['bans'];
  if (!Array.isArray(bans)) return request;
  return { ...request, bans: bans.filter((b) => typeof b === 'string' && b && !isNoBan(b)) };
}

/**
 * One question to the draft advisor, answered by a model on the backend.
 *
 * The request carries everything the draft room already shows — the board,
 * both rosters, our comps and their record, the lane read, the candidate
 * champions — and nothing is fetched from Riot to answer. The reply is
 * ranked picks or bans with a sentence each; the app renders it and lets a
 * click hold the champion, the same as clicking the wall.
 */
@Injectable({ providedIn: 'root' })
export class DraftAdvisorService {
  private readonly activity = inject(ActivityService);
  /** The team the draft is for (release 3): the function's door asks who the caller is on THAT team. */
  private readonly scope = inject(TeamScopeService);

  readonly busy = signal(false);

  async ask(request: Record<string, unknown>): Promise<DraftAdvice> {
    if (!isFirebaseConfigured()) {
      throw new Error('The advisor runs on the live site — local mode has no backend.');
    }
    if (this.busy()) throw new Error('Already asking.');
    this.busy.set(true);
    try {
      // Before the job, so a signed-out ask is refused plainly and never reported as a failed job.
      const idToken = await this.idToken();
      return await this.activity.run(
        'Asking the draft advisor',
        async () => {
          const response = await fetch(this.functionUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
            // The team whose editor the caller must be (release 3, 27 Sep 2026): a body naming no team is
            // judged on Bom Squad's list, which refused a contributor on another team alone every ask. No key
            // at all for the default, so Bom Squad's body is the body it always was; the handler reads nothing
            // else by it, so no echo check is needed.
            body: JSON.stringify({ ...withoutUnseenBans(request), ...teamIdForRequest(this.scope.activeTeamId()) })
          });
          const data = (await response.json()) as Partial<DraftAdvice> & { error?: string };
          if (!response.ok) {
            throw new Error(data.error || 'The advisor could not answer.');
          }
          return {
            summary: data.summary ?? '',
            picks: data.picks ?? [],
            bans: data.bans ?? [],
            watch: data.watch ?? [],
            model: data.model,
            tookMs: data.tookMs
          };
        },
        { detail: 'weighing the board' }
      );
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * The signed-in person's ID token, or the reason there is none. Its own method so a spec can stand
   * in for the Firebase session and drive the POST itself (the CompAnalysisService pattern).
   */
  protected async idToken(): Promise<string> {
    const auth = getAuthInstance();
    const user = auth?.currentUser;
    if (!auth || !user) {
      throw new Error('Sign in first.');
    }
    return user.getIdToken();
  }

  private functionUrl(): string {
    const projectId = environment.firebase.projectId;
    const region = environment.functions?.region || 'europe-west1';
    return 'https://' + region + '-' + projectId + '.cloudfunctions.net/draftAdvice';
  }
}
