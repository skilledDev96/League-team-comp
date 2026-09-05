import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';
import { DraftAdvice } from '../models/team.models';
import { ActivityService } from './activity.service';

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

  readonly busy = signal(false);

  async ask(request: Record<string, unknown>): Promise<DraftAdvice> {
    if (!isFirebaseConfigured()) {
      throw new Error('The advisor runs on the live site — local mode has no backend.');
    }
    const auth = getAuthInstance();
    const user = auth?.currentUser;
    if (!auth || !user) {
      throw new Error('Sign in first.');
    }
    if (this.busy()) throw new Error('Already asking.');
    this.busy.set(true);
    try {
      return await this.activity.run(
        'Asking the draft advisor',
        async () => {
          const idToken = await user.getIdToken();
          const response = await fetch(this.functionUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
            body: JSON.stringify(request)
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

  private functionUrl(): string {
    const projectId = environment.firebase.projectId;
    const region = environment.functions?.region || 'europe-west1';
    return 'https://' + region + '-' + projectId + '.cloudfunctions.net/draftAdvice';
  }
}
