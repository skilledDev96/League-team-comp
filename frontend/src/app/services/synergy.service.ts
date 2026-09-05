import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';
import { Player, PremadeGroupStats, SynergyQueue } from '../models/team.models';
import { ActivityService } from './activity.service';

@Injectable({ providedIn: 'root' })
export class SynergyService {
  private readonly activity = inject(ActivityService);

  /** Whether a synergy read is in flight, wherever it was started. */
  busy(): boolean {
    return this.activity.has('Loading team synergy');
  }

  async load(players: Player[]): Promise<PremadeGroupStats[]> {
    if (!isFirebaseConfigured()) {
      return [];
    }
    return this.activity.run('Loading team synergy', () => this.fetch(players), {
      detail: 'recent ranked games together'
    });
  }

  private async fetch(players: Player[]): Promise<PremadeGroupStats[]> {
    const auth = getAuthInstance();
    const user = auth?.currentUser;
    if (!auth || !user) {
      throw new Error('Sign in first to load team synergy.');
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
        }))
      })
    });
    const data = (await response.json()) as { groups?: PremadeGroupStats[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error || 'Team synergy request failed.');
    }
    return data.groups ?? [];
  }

  private functionUrl(): string {
    const projectId = environment.firebase.projectId;
    const region = environment.functions?.region || 'europe-west1';
    return `https://${region}-${projectId}.cloudfunctions.net/getTeamSynergy`;
  }
}