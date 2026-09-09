import { computed, inject, Injectable, signal } from '@angular/core';
import { migrationDone, MigrationWrite, planScrimsMigration } from '../core/scrims-migration';
import { slugOpponent } from '../core/opponent-slug';
import { rosterIds } from '../pages/games/game-rows';
import { TeamDataService } from './team-data.service';
import { ToastService } from './toast.service';

/**
 * Runs the one-time move from the old Scrims page, write by write, through
 * TeamDataService. The banner on Prep & Draft shows while there is anything
 * to move and goes once there is not.
 */
@Injectable({ providedIn: 'root' })
export class ScrimsMigrationService {
  private readonly data = inject(TeamDataService);
  private readonly toast = inject(ToastService);

  readonly running = signal(false);
  readonly progress = signal('');

  readonly plan = computed(() =>
    planScrimsMigration({
      scrims: this.data.scrims(),
      scrimOpponents: this.data.scrimOpponents(),
      tournaments: this.data.tournaments(),
      series: this.data.tournamentSeries(),
      games: this.data.seriesGames(),
      rosterIds: rosterIds(this.data.players())
    })
  );

  /** Something to move: an opponent record, or a replay that is nobody's game yet. */
  readonly pending = computed(() => !migrationDone(this.plan()));

  async run(): Promise<void> {
    if (this.running()) return;
    this.running.set(true);
    try {
      const plan = this.plan();
      let groupId = plan.group?.id ?? '';
      const seriesIds = new Map<string, string>();
      for (const s of this.data.tournamentSeries()) if (groupId && s.tournamentId === groupId) seriesIds.set(slugOpponent(s.opponent), s.id);
      let done = 0;
      for (const w of plan.writes) {
        done += 1;
        this.progress.set(`${done} of ${plan.writes.length}`);
        await this.apply(w, groupId, seriesIds, (id) => (groupId = id));
      }
      this.toast.show('Moved from the old Scrims page', {
        kind: 'ok',
        text: `${plan.opponents} ${plan.opponents === 1 ? 'opponent' : 'opponents'} and ${plan.replays} ${plan.replays === 1 ? 'replay' : 'replays'} are now series and games here.`,
        timeout: 7000
      });
    } catch (error) {
      this.toast.show('The move stopped', { kind: 'warn', text: error instanceof Error ? error.message : 'Press Move them again; what landed stays.' });
    } finally {
      this.running.set(false);
      this.progress.set('');
    }
  }

  private async apply(w: MigrationWrite, groupId: string, seriesIds: Map<string, string>, setGroup: (id: string) => void): Promise<void> {
    switch (w.kind) {
      case 'group-create':
        setGroup(await this.data.createTournament(w.tournament));
        return;
      case 'group-mark':
        await this.data.updateTournament(w.tournament);
        return;
      case 'series': {
        const id = await this.data.createSeries({ ...w.series, tournamentId: groupId });
        seriesIds.set(w.slug, id);
        return;
      }
      case 'scrim-side': {
        const scrim = this.data.scrims().find((s) => s.id === w.scrimId);
        if (scrim) await this.data.saveScrim({ ...scrim, ourSide: w.ourSide });
        return;
      }
      case 'game': {
        const seriesId = seriesIds.get(w.slug);
        if (!seriesId) throw new Error(`No series for ${w.slug}`);
        await this.data.createSeriesGame({ ...w.game, seriesId });
        return;
      }
      case 'delete-opponent':
        await this.data.deleteScrimOpponent(w.id);
        return;
    }
  }
}

