import { inject, Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';
import { CompAnalysis, Comp, Player, ROLES } from '../models/team.models';
import { UiService } from './ui.service';

@Injectable({ providedIn: 'root' })
export class CompAnalysisService {
  private readonly ui = inject(UiService);

  /** Trigger a fresh analysis on the backend. Returns the computed result. */
  async refresh(
    players: Player[],
    comps: Comp[],
    overrides: Record<string, string> = {}
  ): Promise<CompAnalysis> {
    if (!isFirebaseConfigured()) {
      throw new Error('Match analysis runs on the deployed app — sign in there to refresh.');
    }
    const auth = getAuthInstance();
    const user = auth?.currentUser;
    if (!auth || !user) {
      throw new Error('Sign in first to run match analysis.');
    }
    const idToken = await user.getIdToken();
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
        comps: comps.map((comp) => ({
          id: comp.id,
          name: comp.name,
          countsUnder: comp.countsUnder ?? null,
          // Pull the champion out of each "Champion - note" pick line.
          champions: ROLES.map((role) => this.ui.parseCompLine(comp.picks[role] ?? '').champion).filter(Boolean)
        })),
        // Games placed by hand. The backend applies these over its own champion
        // matching, so the win rates it returns already account for them.
        overrides
      })
    });
    const data = (await response.json()) as CompAnalysis & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || 'Match analysis request failed.');
    }
    return data;
  }

  private functionUrl(): string {
    const projectId = environment.firebase.projectId;
    const region = environment.functions?.region || 'europe-west1';
    return `https://${region}-${projectId}.cloudfunctions.net/getCompAnalysis`;
  }
}
