import { inject, Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';
import { CompAnalysis, Comp, Player, ROLES } from '../models/team.models';
import { UiService } from './ui.service';

@Injectable({ providedIn: 'root' })
export class CompAnalysisService {
  private readonly ui = inject(UiService);

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
   */
  async refresh(
    players: Player[],
    comps: Comp[],
    overrides: Record<string, string> = {}
  ): Promise<CompAnalysis> {
    this.running.set(true);
    try {
      return await this.run(players, comps, overrides);
    } finally {
      this.running.set(false);
    }
  }

  private async run(
    players: Player[],
    comps: Comp[],
    overrides: Record<string, string>
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
