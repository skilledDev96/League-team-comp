import { Injectable, computed, inject, signal } from '@angular/core';
import { Player } from '../models/team.models';
import { ActivityService } from './activity.service';
import { CompAnalysisService } from './comp-analysis.service';
import { PlayerEnrichmentService } from './player-enrichment.service';
import { TeamDataService } from './team-data.service';
import { ToastService } from './toast.service';

/**
 * The Riot refreshes that rewrite stored data, owned by a root service so a
 * run survives the page that started it.
 *
 * Two jobs and a chain. `refreshPlayers` re-reads every roster member through
 * `enrichPlayer` and writes the result on their player doc. `refreshAnalysis`
 * re-runs the comp analysis. `refreshAll` runs the first, then the second —
 * sequentially, never together, because both spend the same hundred Riot
 * calls per two minutes and running them side by side halves each.
 *
 * The bulk player refresh used to live on the roster table, so navigating
 * away lost the progress line and coming back showed an idle button over a
 * run that was still writing. It lives here now and every page reads it.
 */
@Injectable({ providedIn: 'root' })
export class RefreshService {
  private readonly data = inject(TeamDataService);
  private readonly enrichment = inject(PlayerEnrichmentService);
  private readonly analysis = inject(CompAnalysisService);
  private readonly activity = inject(ActivityService);
  private readonly toast = inject(ToastService);

  readonly playersRunning = signal(false);
  readonly playersProgress = signal('');
  readonly allRunning = signal(false);

  /** Any refresh that rewrites team data. Buttons that start one read this. */
  readonly anyRunning = computed(
    () => this.playersRunning() || this.allRunning() || this.analysis.running()
  );

  /** Re-read one roster member from Riot and write what came back. */
  async refreshPlayer(p: Player): Promise<'updated' | 'no-data'> {
    const enriched = await this.enrichment.enrichPlayer({
      summonerName: p.name,
      riotTag: p.profile?.riotTag,
      region: p.profile?.region,
      role: p.role,
      mobalyticsSlug: p.profile?.mobalyticsSlug
    });
    if (enriched.source !== 'provider') return 'no-data';
    await this.data.updatePlayer({
      ...p,
      role: enriched.role ?? p.role,
      icon: enriched.iconUrl ?? p.icon,
      playstyle: enriched.playstyle || p.playstyle,
      strengths: enriched.strengths.length ? enriched.strengths : p.strengths,
      weaknesses: enriched.weaknesses.length ? enriched.weaknesses : p.weaknesses,
      top3: this.enrichment.mergeChampionPool(p.top3, enriched.top3),
      bans: enriched.bans?.length ? enriched.bans : p.bans,
      queueStats: enriched.queueStats ?? p.queueStats
    });
    return 'updated';
  }

  /**
   * Every player, one at a time. A player who fails is counted and skipped
   * rather than failing the batch — four of five refreshed is worth having.
   */
  async refreshPlayers(): Promise<{ done: number; failed: number }> {
    if (this.playersRunning()) return { done: 0, failed: 0 };
    const players = this.data.players();
    this.playersRunning.set(true);
    let done = 0;
    let failed = 0;
    try {
      await this.activity.run('Refreshing player data', async (job) => {
        for (const [i, p] of players.entries()) {
          const line = `${p.name} (${i + 1}/${players.length})`;
          this.playersProgress.set(line);
          job.progress(line);
          try {
            if ((await this.refreshPlayer(p)) === 'updated') done += 1;
            else failed += 1;
          } catch {
            failed += 1;
          }
        }
      });
    } finally {
      this.playersProgress.set('');
      this.playersRunning.set(false);
    }
    this.toast.show(
      failed ? `Updated ${done} players, ${failed} failed` : `Updated all ${done} players from Riot`,
      {
        kind: failed ? 'warn' : 'ok',
        icon: failed ? 'warning' : 'check_circle',
        text: failed ? "Check the Riot key and each player's Riot ID." : undefined
      }
    );
    return { done, failed };
  }

  /** Re-run the comp analysis over the stored roster, comps and overrides. */
  async refreshAnalysis(): Promise<void> {
    if (this.analysis.running()) return;
    const result = await this.analysis.refresh(
      this.data.players(),
      this.data.comps(),
      this.data.compOverrideMap()
    );
    // Firebase mode updates over the snapshot listener; set it directly as
    // well so the page reflects the fresh result at once.
    this.data.compAnalysis.set(result);
  }

  /**
   * Players first, then the analysis. Player enrichment warms the shared match
   * cache, so the analysis that follows spends fewer of its own Riot calls.
   */
  async refreshAll(): Promise<void> {
    if (this.allRunning()) return;
    this.allRunning.set(true);
    try {
      await this.refreshPlayers();
      await this.refreshAnalysis();
    } catch {
      // Each step reports its own failure; the chain simply stops.
    } finally {
      this.allRunning.set(false);
    }
  }
}
