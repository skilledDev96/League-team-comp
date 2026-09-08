import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { RefreshService } from '../../services/refresh.service';
import { ActivityService } from '../../services/activity.service';
import { TeamDataService } from '../../services/team-data.service';
import { PlayerEditorService } from '../../services/player-editor.service';
import { UiService } from '../../services/ui.service';
import { PlayerQueueStats, QueueMatchStats, RankedQueueStats } from '../../models/team.models';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { ExternalProfilesComponent } from '../../shared/external-profiles.component';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { ColumnOption, ColumnPickerComponent } from '../../shared/column-picker.component';
import { SplitCellComponent } from '../../shared/split-cell.component';
import { SplitViewToggleComponent } from '../../shared/split-view-toggle.component';
import { TablePrefsService } from '../../services/table-prefs.service';
import { formatSide, PLAYER_METRIC_KEYS, PlayerMetric, playerSplits, PlayerSplitRow, SideStat, SplitUnit, starterCount } from '../review/win-loss-splits';
import { MIN_FOR_A_CLAIM } from '../review/loss-patterns.util';
import { InfoTipComponent } from '../../shared/info-tip.component';
import { TourPillComponent } from '../../shared/tour-pill.component';
import { digestNotes, touches } from '../../core/coaching-digest';

@Component({
  selector: 'app-player-profile',
  imports: [DatePipe, RouterLink, PlayerAvatarComponent, ChampionChipComponent, ExternalProfilesComponent, TooltipDirective, ColumnPickerComponent, SplitCellComponent, SplitViewToggleComponent, InfoTipComponent, TourPillComponent],
  templateUrl: './player-profile.component.html'
})
export class PlayerProfileComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly refresh = inject(RefreshService);
  protected readonly editor = inject(PlayerEditorService);
  private readonly activity = inject(ActivityService);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.paramMap);

  protected readonly refreshing = signal(false);
  protected readonly refreshStatus = signal('');
  protected readonly selectedQueue = signal<'flex' | 'solo' | 'clash' | 'combined'>('flex');

  protected readonly player = computed(() => {
    const id = this.params()?.get('id');
    const players = this.data.players();
    return players.find((p) => p.id === id) ?? players[0];
  });

  // ---- With the team: this player, wins against losses (8 Sep 2026) ----
  //
  // Over every five-stack game the analysis holds, whatever seat they sat
  // in, with the same figures per seat underneath. The team's own read of
  // wins against losses is on Games → Patterns; this is the one player's.

  /** Their games with the main five: the player plus the other four starters. */
  private readonly teamGames = computed(() => {
    const name = this.player()?.name;
    if (!name) return [];
    const starters = this.data.starters().map((p) => p.name);
    // The queue tabs above narrow this card too. Solo/duo is not a team
    // queue, so that tab shows every team game and the note says so.
    const queue = this.selectedQueue();
    const wanted = queue === 'flex' ? 'Flex' : queue === 'clash' ? 'Clash' : null;
    return (this.data.compAnalysis()?.games ?? []).filter((g) => {
      if (wanted && g.queue !== wanted) return false;
      if (!g.players.some((p) => p.name === name)) return false;
      if (starters.length < 5) return true;
      const others = starters.filter((s) => s !== name);
      return starterCount(g, others) >= 4;
    });
  });

  /** What the card is counting, in the queue tab's words. */
  protected readonly teamQueueLabel = computed(() => {
    switch (this.selectedQueue()) {
      case 'flex': return 'Flex';
      case 'clash': return 'Clash';
      case 'solo': return 'Every team queue';
      default: return 'Flex, Clash and scrims';
    }
  });

  /** Every champion they played in those games, most played first, for the filter. */
  protected readonly teamChampions = computed(() => {
    const name = this.player()?.name;
    const all = playerSplits(this.teamGames()).find((r) => r.name === name);
    return all?.champions ?? [];
  });

  /** One champion, or every game. Asked for on 8 Sep 2026: the main champ against the rest. */
  protected readonly teamChampion = signal('');

  protected readonly withTeam = computed<PlayerSplitRow | undefined>(() => {
    const name = this.player()?.name;
    if (!name) return undefined;
    const champ = this.teamChampion();
    const games = champ
      ? this.teamGames().filter((g) => g.players.some((p) => p.name === name && p.champion === champ))
      : this.teamGames();
    // Every seat they have sat in, however few games: the team asked to see
    // the other lanes, and a seat row carries its own count either way.
    return playerSplits(games, 1).find((r) => r.name === name);
  });

  // ---- Which columns, and how the figures read: shared with Patterns ----

  protected readonly prefs = inject(TablePrefsService);
  protected readonly playerDefaults = ['kda', 'deaths', 'kp', 'damageShare', 'vision', 'goldDiff', 'csDiff'];

  /** What the reviews said about this player, newest first, the last six. */
  protected readonly coachingNotes = computed(() => {
    const name = this.player()?.name;
    if (!name) return [];
    const games = new Map((this.data.compAnalysis()?.games ?? []).map((g) => [g.matchId, g]));
    return this.data
      .gameReviews()
      .map((review) => ({ review, note: review.players.find((p) => p.name === name), game: games.get(review.matchId) }))
      .filter((r) => r.note)
      .sort((a, b) => (b.game?.date ?? 0) - (a.game?.date ?? 0));
  });

  /** What keeps coming up across those notes: the default view. */
  protected readonly coachingDigest = computed(() =>
    digestNotes(
      this.coachingNotes().map((n) => ({
        win: n.game?.win ?? false,
        date: n.game?.date ?? 0,
        strength: [n.note!.strength.text, n.note!.strength.evidence].join(' '),
        workOn: [n.note!.workOn.text, n.note!.workOn.evidence].join(' ')
      }))
    )
  );

  /** A pill on the digest, pressed: the notes that mention that theme. */
  protected readonly pickedTheme = signal<{ side: 'workOn' | 'strength'; key: string } | null>(null);

  protected pickTheme(side: 'workOn' | 'strength', key: string): void {
    const now = this.pickedTheme();
    this.pickedTheme.set(now && now.side === side && now.key === key ? null : { side, key });
  }

  protected themeOn(side: 'workOn' | 'strength', key: string): boolean {
    const now = this.pickedTheme();
    return !!now && now.side === side && now.key === key;
  }

  protected readonly themeNotes = computed(() => {
    const picked = this.pickedTheme();
    if (!picked) return [];
    return this.coachingNotes().filter((n) => {
      const line = picked.side === 'workOn' ? n.note!.workOn : n.note!.strength;
      return touches(picked.key, [line.text, line.evidence].join(' '));
    });
  });

  protected columnOptions(metrics: readonly PlayerMetric[]): ColumnOption[] {
    return metrics.map((m) => ({ key: m.key, label: m.label }));
  }

  /** The metrics the table shows, in the fixed column order. */
  protected shown(metrics: readonly PlayerMetric[]): PlayerMetric[] {
    const on = new Set(this.prefs.visibleFor()('player', this.playerDefaults));
    return PLAYER_METRIC_KEYS.map((k) => metrics.find((m) => m.key === k)).filter((m): m is PlayerMetric => !!m && on.has(m.key));
  }
  protected readonly claimFloor = MIN_FOR_A_CLAIM;

  protected side(s: SideStat, unit: SplitUnit): string {
    return formatSide(s, unit);
  }



  protected readonly buildCount = computed(() => {
    const p = this.player();
    if (!p) return 0;
    return p.top3.length;
  });

  protected readonly selectedQueueLabel = computed(() => {
    const queue = this.selectedQueue();
    if (queue === 'flex') return 'Flex';
    if (queue === 'solo') return 'Solo/Duo';
    if (queue === 'clash') return 'Clash';
    return 'Combined ranked';
  });

  protected readonly selectedQueueStats = computed<PlayerQueueStats | undefined>(() => {
    const p = this.player();
    if (!p?.queueStats) return undefined;
    if (this.selectedQueue() === 'flex') return p.queueStats.flex;
    if (this.selectedQueue() === 'solo') return p.queueStats.solo;
    if (this.selectedQueue() === 'clash') return p.queueStats.clash;
    return { matches: this.combineMatchStats(p.queueStats.solo?.matches, p.queueStats.flex?.matches) };
  });

  protected readonly selectedRank = computed<RankedQueueStats | undefined>(() => this.selectedQueueStats()?.rank);
  protected readonly selectedMatches = computed<QueueMatchStats | undefined>(() => this.selectedQueueStats()?.matches);

  private combineMatchStats(first?: QueueMatchStats, second?: QueueMatchStats): QueueMatchStats | undefined {
    if (!first && !second) return undefined;
    if (!first) return second;
    if (!second) return first;
    const totalGames = first.games + second.games;
    const weighted = (a: number, b: number): number => (a * first.games + b * second.games) / totalGames;

    // Vision and building damage can rest on fewer games than the queue played,
    // while cache v4 backfills. Weighting them by `games` would let a queue with
    // no numbers at all pull the other one towards zero, so they are weighted by
    // their own samples and fall back to the game count when those are absent.
    const bySample = (
      a: number,
      b: number,
      firstN = first.games,
      secondN = second.games
    ): number => (firstN + secondN > 0 ? (a * firstN + b * secondN) / (firstN + secondN) : 0);
    const visionA = first.visionSamples ?? first.games;
    const visionB = second.visionSamples ?? second.games;
    const buildA = first.buildingSamples ?? first.games;
    const buildB = second.buildingSamples ?? second.games;
    return {
      games: totalGames,
      wins: first.wins + second.wins,
      losses: first.losses + second.losses,
      winRate: Math.round(((first.wins + second.wins) / totalGames) * 100),
      avgKills: weighted(first.avgKills, second.avgKills),
      avgDeaths: weighted(first.avgDeaths, second.avgDeaths),
      avgAssists: weighted(first.avgAssists, second.avgAssists),
      avgKda: weighted(first.avgKda, second.avgKda),
      avgCsPerMin: weighted(first.avgCsPerMin, second.avgCsPerMin),
      avgKillParticipation: weighted(first.avgKillParticipation, second.avgKillParticipation),
      avgDamageShare: weighted(first.avgDamageShare, second.avgDamageShare),
      avgTankShare: weighted(first.avgTankShare, second.avgTankShare),
      avgBuildingDamage: bySample(first.avgBuildingDamage, second.avgBuildingDamage, buildA, buildB),
      avgVisionScore: bySample(first.avgVisionScore, second.avgVisionScore, visionA, visionB),
      visionSamples: visionA + visionB,
      buildingSamples: buildA + buildB,
      playstyle: 'Combined ranked performance',
      strengths: [...new Set([...first.strengths, ...second.strengths])].slice(0, 3),
      weaknesses: [...new Set([...first.weaknesses, ...second.weaknesses])].slice(0, 3),
      top3: [...new Set([...first.top3, ...second.top3])].slice(0, 3),
      bans: [...new Set([...first.bans, ...second.bans])].slice(0, 3)
    };
  }

  async refreshData(): Promise<void> {
    const p = this.player();
    if (!p || this.refreshing()) {
      return;
    }
    this.refreshing.set(true);
    this.refreshStatus.set('Refreshing from Riot...');
    try {
      const outcome = await this.activity.run(
        `Refreshing ${p.name}`,
        () => this.refresh.refreshPlayer(p),
        { detail: 'ranked history from Riot' }
      );
      this.refreshStatus.set(outcome === 'updated'
        ? 'Updated from Riot.'
        : "Couldn't fetch live Riot data for this player — check the Riot ID.");
    } catch (err) {
      this.refreshStatus.set(err instanceof Error ? err.message : 'Refresh failed.');
    } finally {
      this.refreshing.set(false);
      setTimeout(() => this.refreshStatus.set(''), 3000);
    }
  }

}
