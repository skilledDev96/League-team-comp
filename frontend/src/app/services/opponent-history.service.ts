import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';
import { OpponentPlayer, OpponentTeamHistory } from '../models/team.models';
import { ActivityService } from './activity.service';

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
  private readonly activity = inject(ActivityService);

  /**
   * The series or scrim opponent whose history is being read, so the button
   * that started it reads busy from any page and cannot be started twice.
   */
  readonly busy = signal('');

  /**
   * Read their games together, on the board while it runs.
   *
   * `key` names the record the result is for and `label` the team, for the
   * topbar; the read itself is unchanged.
   */
  async load(
    players: OpponentPlayer[],
    options: { key?: string; label?: string; days?: number } = {}
  ): Promise<OpponentTeamHistory> {
    const key = options.key ?? '';
    if (key && this.busy() === key) throw new Error('Already reading their history.');
    this.busy.set(key);
    try {
      return await this.activity.run(
        `Reading ${options.label || 'their'} team history`,
        () => this.fetch(players, options.days ?? 30),
        { detail: 'last 30 days of flex, Clash and draft' }
      );
    } finally {
      if (this.busy() === key) this.busy.set('');
    }
  }

  private async fetch(players: OpponentPlayer[], days: number): Promise<OpponentTeamHistory> {
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
