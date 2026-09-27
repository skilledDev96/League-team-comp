import { Injectable, computed, inject, signal } from '@angular/core';
import { BACKEND_BEHIND, BACKEND_BEHIND_TOAST, isBackendBehind } from '../core/team-echo';
import { CompAnalysis, Player } from '../models/team.models';
import { ActivityService } from './activity.service';
import { CompAnalysisService } from './comp-analysis.service';
import { PlayerEnrichmentService } from './player-enrichment.service';
import { TeamDataService } from './team-data.service';
import { TeamScopeService, teamChangedNotice } from './team-scope.service';
import { ToastService } from './toast.service';

/** What one player's refresh came to; `stopped` is the team changing under it, with nothing written. */
export type RefreshOutcome = 'updated' | 'no-data' | 'stopped';

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
 *
 * Every job is pinned to the team it started on (27 Sep 2026, Stage 3c):
 * the active team is captured at the start and checked before each write,
 * and a run the team moved under stops there and says so, leaving what
 * already landed. TeamDataService builds each path over the team active at
 * the moment of the write, so without this a switch mid-run would put the
 * rest of a refresh on whichever team is now showing.
 */
@Injectable({ providedIn: 'root' })
export class RefreshService {
  private readonly data = inject(TeamDataService);
  private readonly enrichment = inject(PlayerEnrichmentService);
  private readonly analysis = inject(CompAnalysisService);
  private readonly activity = inject(ActivityService);
  private readonly toast = inject(ToastService);
  private readonly scope = inject(TeamScopeService);

  readonly playersRunning = signal(false);
  readonly playersProgress = signal('');
  readonly allRunning = signal(false);

  /**
   * Any refresh that rewrites team data. Buttons that start one read this.
   * A roster import counts too (27 Sep 2026): it writes the same player
   * documents, and `has()` reads the jobs signal, so this stays reactive.
   */
  readonly anyRunning = computed(
    () => this.playersRunning() || this.allRunning() || this.analysis.running() || this.activity.has('Importing roster')
  );

  /**
   * Re-read one roster member from Riot and write what came back. 'stopped' when
   * the team changed while Riot was being read: the answer is thrown away rather
   * than written on the team now showing.
   */
  async refreshPlayer(p: Player): Promise<RefreshOutcome> {
    const team = this.scope.activeTeamId();
    const enriched = await this.enrichment.enrichPlayer({
      summonerName: p.name,
      riotTag: p.profile?.riotTag,
      region: p.profile?.region,
      role: p.role,
      mobalyticsSlug: p.profile?.mobalyticsSlug
    });
    if (enriched.source !== 'provider') return 'no-data';
    if (this.teamChanged(team)) return 'stopped';
    await this.data.updatePlayer({
      ...p,
      // A refresh fills an empty seat and never moves a set one (27 Sep 2026, for
      // the roster importer, whose seats are the paste order). A browser Player
      // always has a seat, so it is simply kept; the morning job's mergePlayer
      // applies the same rule. Riot's detected role stays a suggestion.
      role: p.role,
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
   * `stopped` is the team changing under the run: the players still waiting
   * are not read, and the notice says so instead of the count.
   */
  async refreshPlayers(): Promise<{ done: number; failed: number; stopped: boolean }> {
    if (this.playersRunning()) return { done: 0, failed: 0, stopped: false };
    const team = this.scope.activeTeamId();
    const players = this.data.players();
    this.playersRunning.set(true);
    let done = 0;
    let failed = 0;
    let stopped = false;
    try {
      await this.activity.run('Refreshing player data', async (job) => {
        for (const [i, p] of players.entries()) {
          // Before the read as well as before the write (inside refreshPlayer): a
          // read whose answer would be thrown away is a minute of Riot calls for nothing.
          if (this.teamChanged(team)) {
            stopped = true;
            return;
          }
          const line = `${p.name} (${i + 1}/${players.length})`;
          this.playersProgress.set(line);
          job.progress(line);
          try {
            const outcome = await this.refreshPlayer(p);
            if (outcome === 'stopped') {
              stopped = true;
              return;
            }
            if (outcome === 'updated') done += 1;
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
    if (stopped) {
      this.stoppedForTeam('the player refresh', done ? `${done} of ${players.length} were updated before it stopped.` : undefined);
      return { done, failed, stopped };
    }
    this.toast.show(
      failed ? `Updated ${done} players, ${failed} failed` : `Updated all ${done} players from Riot`,
      {
        kind: failed ? 'warn' : 'ok',
        icon: failed ? 'warning' : 'check_circle',
        text: failed ? "Check the Riot key and each player's Riot ID." : undefined
      }
    );
    return { done, failed, stopped };
  }

  /**
   * Re-run the comp analysis over the stored roster, comps and overrides. An
   * answer the backend computed for another team (a deployment older than
   * release 2 ignoring `teamId`) is refused by the service and never applied;
   * this says why, once. An answer that arrives after the team changed is not
   * applied either: the signal it would land in is the other team's now, and
   * its own listener brings that team's document. Any other failure is the
   * activity board's to report.
   */
  async refreshAnalysis(): Promise<void> {
    if (this.analysis.running()) return;
    const team = this.scope.activeTeamId();
    let result: CompAnalysis;
    try {
      result = await this.analysis.refresh(
        this.data.players(),
        this.data.comps(),
        this.data.compOverrideMap()
      );
    } catch (error) {
      if (!isBackendBehind(error)) throw error;
      this.toast.show(BACKEND_BEHIND, BACKEND_BEHIND_TOAST);
      return;
    }
    if (this.teamChanged(team)) {
      this.stoppedForTeam('the analysis refresh');
      return;
    }
    // Firebase mode updates over the snapshot listener; set it directly as
    // well so the page reflects the fresh result at once.
    this.data.compAnalysis.set(result);
  }

  /**
   * Players first, then the analysis. Player enrichment warms the shared match
   * cache, so the analysis that follows spends fewer of its own Riot calls.
   * The chain stops between the two when the team changed: the analysis would
   * be asked for the team now showing, with the players just refreshed on another.
   */
  async refreshAll(): Promise<void> {
    if (this.allRunning()) return;
    const team = this.scope.activeTeamId();
    this.allRunning.set(true);
    try {
      const players = await this.refreshPlayers();
      if (players.stopped) return;
      if (this.teamChanged(team)) {
        this.stoppedForTeam('the refresh');
        return;
      }
      await this.refreshAnalysis();
    } catch {
      // Each step reports its own failure; the chain simply stops.
    } finally {
      this.allRunning.set(false);
    }
  }

  /** True once the scope has left the team a run started on; every write asks first. */
  private teamChanged(team: string): boolean {
    return this.scope.activeTeamId() !== team;
  }

  /** The one notice for a run the team moved under. */
  private stoppedForTeam(job: string, detail?: string): void {
    const notice = teamChangedNotice(job);
    this.toast.show(notice.title, { kind: 'warn', icon: 'warning', text: detail ? `${detail} ${notice.text}` : notice.text, timeout: 10000 });
  }
}
