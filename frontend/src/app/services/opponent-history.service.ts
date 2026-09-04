import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';
import { OpponentPlayer, OpponentTeamHistory } from '../models/team.models';

/**
 * What their five did as a team lately — the games with three or more of them
 * on one side, read from Riot by `getOpponentHistory`.
 *
 * The result is handed back to the caller to store on the series or scrim
 * opponent, so the whole team sees it without each of them spending Riot's
 * budget; a refresh reads the next batch.
 */
@Injectable({ providedIn: 'root' })
export class OpponentHistoryService {
  async load(players: OpponentPlayer[], days = 30): Promise<OpponentTeamHistory> {
    if (!isFirebaseConfigured()) {
      throw new Error('Their match history needs the live site — local mode has no Riot access.');
    }
    if (players.length > 5) {
      throw new Error('Six on the table — mark their substitute first, so this reads the right five.');
    }
    if (players.length < 2) {
      throw new Error('Paste their roster first.');
    }
    const auth = getAuthInstance();
    const user = auth?.currentUser;
    if (!auth || !user) {
      throw new Error('Sign in first.');
    }
    const idToken = await user.getIdToken();
    const response = await fetch(this.functionUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + idToken
      },
      body: JSON.stringify({
        days,
        players: players.map((p) => ({
          id: (p.name + '#' + (p.riotTag ?? '')).toLowerCase(),
          name: p.name,
          riotTag: p.riotTag,
          region: p.region
        }))
      })
    });
    const data = (await response.json()) as Partial<OpponentTeamHistory> & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || 'Their match history could not be loaded.');
    }
    return {
      fetchedAt: new Date().toISOString(),
      days: data.days ?? days,
      games: data.games ?? [],
      summary: data.summary ?? { games: 0, wins: 0, losses: 0, fullStacks: 0, picks: [] },
      pending: data.pending ?? 0,
      unresolved: data.unresolved ?? []
    };
  }

  private functionUrl(): string {
    const projectId = environment.firebase.projectId;
    const region = environment.functions?.region || 'europe-west1';
    return 'https://' + region + '-' + projectId + '.cloudfunctions.net/getOpponentHistory';
  }
}
