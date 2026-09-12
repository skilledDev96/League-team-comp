import { Component, computed, inject, input, signal } from '@angular/core';
import { OpponentPlayer } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ChampionFilterService } from '../../services/champion-filter.service';
import { OpponentScoutService } from '../../services/opponent-scout.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { InfoTipComponent } from '../../shared/info-tip.component';
import { playedElsewhere } from '../../core/opponent-roles';
import {
  banCandidates,
  bench,
  bestRank,
  masteryLabel,
  masteryOf,
  poolIsForSeat,
  queueRows,
  rateBand,
  rateOf,
  recentForSeat,
  recentHidden,
  scoutedAgo,
  starters,
  topPlays
} from '../../core/opponent-view';

/**
 * Our own five, read the way we read an opponent (9 Sep 2026): the same
 * scout over Name#TAG, the same table — rank per queue with the sample
 * behind it, what each of us plays in the seat, what beats us, what we have
 * touched lately — and the ban board an opponent would draw against us.
 * The result lives at `meta/selfScout`, one document, rewritten per scout.
 *
 * Starter is the ban board and our five on a line each — the line Prep & Draft draws for an
 * opponent (12 Sep 2026). The table under Full says the same across six columns and two queues a
 * player: measured at about five hundred marks in one card, with no fold and no switch, the densest
 * surface in the app, and all of it for checking.
 */
@Component({
  selector: 'app-scout-report',
  imports: [TooltipDirective, InfoTipComponent],
  templateUrl: './scout-report.component.html'
})
export class ScoutReportComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  protected readonly filter = inject(ChampionFilterService);
  protected readonly scout = inject(OpponentScoutService);

  protected readonly SELF_ID = 'us';
  /** Set by the Roster shell's one switch. */
  readonly full = input(false);

  protected readonly report = this.data.selfScout;
  protected readonly players = computed<OpponentPlayer[]>(() => this.report()?.players ?? []);
  protected readonly five = computed(() => starters(this.players()));
  protected readonly subs = computed(() => bench(this.players()));
  protected readonly board = computed(() => banCandidates(this.players()));
  protected readonly when = computed(() => (this.players().length ? scoutedAgo(this.players()) : ''));
  protected readonly busy = computed(() => this.scout.scouting() === this.SELF_ID);
  /** Players on the roster with no Riot tag: the scout has nothing to look up for them. */
  protected readonly untagged = computed(() => this.data.players().filter((p) => !p.profile?.riotTag?.trim()).map((p) => p.name));

  protected async scoutUs(): Promise<void> {
    await this.scout.scoutOurselves(this.data.players(), this.data.settings().teamName || 'us');
  }

  private readonly recentOpen = signal<ReadonlySet<string>>(new Set());

  protected isRecentOpen(opp: OpponentPlayer): boolean {
    return this.recentOpen().has(opp.name);
  }

  protected toggleRecent(opp: OpponentPlayer): void {
    this.recentOpen.update((set) => {
      const next = new Set(set);
      if (next.has(opp.name)) next.delete(opp.name);
      else next.add(opp.name);
      return next;
    });
  }

  protected recentShown(opp: OpponentPlayer): string[] {
    return this.isRecentOpen(opp) ? (opp.recentChampions ?? []) : recentForSeat(opp);
  }

  protected readonly queueRows = queueRows;
  protected readonly topPlays = topPlays;
  protected readonly bestRank = bestRank;
  protected readonly masteryOf = masteryOf;
  protected readonly masteryLabel = masteryLabel;
  protected readonly rateOf = rateOf;
  protected readonly rateBand = rateBand;
  protected readonly recentForSeat = recentForSeat;
  protected readonly recentHidden = recentHidden;
  protected readonly poolIsForSeat = poolIsForSeat;
  protected readonly playedElsewhere = playedElsewhere;
}
