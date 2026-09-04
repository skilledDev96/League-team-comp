import { Injectable, computed, inject, signal } from '@angular/core';
import { OpponentPlayer, Role, ROLES, ScrimOpponent, TournamentSeries } from '../models/team.models';
import { PlayerEnrichmentService } from './player-enrichment.service';
import { TeamDataService } from './team-data.service';
import { RiotId, parseRiotIds } from '../core/riot-id';

/**
 * Reading the other team from their public Riot IDs.
 *
 * The same `enrichPlayer` call the roster already uses, pointed at five people
 * who are not ours. Nothing new is asked of Riot and nothing is scraped: the
 * IDs come from a roster the league itself publishes, pasted in by hand.
 *
 * The result is deliberately thin — what they play, what beats them in lane,
 * one line on how they play. That is what a draft can use, and collecting more
 * than a draft can use is how a scouting tool turns into a dossier.
 */
/** Measured against the live API, not guessed: about a minute a player. */
const SECONDS_PER_PLAYER = 60;

@Injectable({ providedIn: 'root' })
export class OpponentScoutService {
  private readonly enrichment = inject(PlayerEnrichmentService);
  private readonly data = inject(TeamDataService);

  /** Series id currently being scouted, so one button can show progress. */
  readonly scouting = signal<string | null>(null);
  readonly progress = signal('');
  /** Players finished and players in total, for a bar rather than a spinner. */
  readonly done = signal(0);
  readonly total = signal(0);

  /**
   * Roughly how long is left, in seconds.
   *
   * A player costs about forty-eight Riot calls — account, summoner, league,
   * match list and up to a dozen matches, across three queues — against a limit
   * of a hundred every two minutes. So a minute each is not a slow
   * implementation, it is the rate limit, and saying so is the difference
   * between waiting and thinking it has hung.
   */
  readonly secondsLeft = computed(() => Math.max(this.total() - this.done(), 0) * SECONDS_PER_PLAYER);

  /**
   * Turn pasted text into five seats.
   *
   * Roles are assigned by position, because an op.gg multi-link carries no
   * roles and the order a team writes its roster in is almost always top to
   * support. Wrong is fixable in one dropdown; refusing to guess would mean
   * five dropdowns every time.
   */
  fromPaste(input: string, existing: readonly OpponentPlayer[] = []): OpponentPlayer[] {
    const ids = parseRiotIds(input);
    if (!ids.length) return [...existing];

    // No cap at five. Teams carry subs, and a multi-link with six or seven
    // names is the roster exactly as the league publishes it. The sixth
    // onwards cycles through the roles — a guess, fixable in one dropdown —
    // rather than being silently dropped, which is what used to happen.
    return ids.map((id: RiotId, index: number) => {
      const previous = existing[index];
      return {
        role: (previous?.role ?? ROLES[index % ROLES.length]) as Role,
        name: id.name,
        riotTag: id.tag,
        region: id.region ?? previous?.region ?? 'euw',
        // Anything scouted for a *different* Riot ID is not about this player.
        ...(previous && previous.name === id.name && previous.riotTag === id.tag
          ? { top3: previous.top3, bans: previous.bans, playstyle: previous.playstyle, rank: previous.rank, scoutedAt: previous.scoutedAt }
          : {})
      };
    });
  }

  /**
   * Scout every player on a series, one at a time.
   *
   * Sequential on purpose: each call spends a handful of Riot requests against
   * a limit the crawler is already sharing, and five in parallel is how a
   * scout turns into five 429s and no data. A player who fails keeps the error
   * on their row rather than failing the batch — four of five scouted is worth
   * having.
   */
  async scoutSeries(series: TournamentSeries): Promise<void> {
    await this.scoutRoster(series.id, series.opponentPlayers ?? [], (players) =>
      this.data.updateSeries({ ...series, opponentPlayers: players })
    );
  }

  /** The same scout, for a team we only ever meet in scrims. */
  async scoutScrimOpponent(opponent: ScrimOpponent): Promise<void> {
    await this.scoutRoster(opponent.id, opponent.opponentPlayers ?? [], (players) =>
      this.data.saveScrimOpponent({ ...opponent, opponentPlayers: players })
    );
  }

  /**
   * Scout a roster, whoever owns it.
   *
   * The scouting is the same five lookups whether the roster hangs off a
   * tournament series or a scrim opponent; only where the result is written
   * differs, so the caller passes that in. Written after each player, so a
   * scout interrupted halfway keeps what it got.
   */
  private async scoutRoster(
    id: string,
    roster: readonly OpponentPlayer[],
    save: (players: OpponentPlayer[]) => Promise<void>
  ): Promise<void> {
    if (!roster.length || this.scouting()) return;

    this.scouting.set(id);
    this.total.set(roster.length);
    this.done.set(0);
    const out: OpponentPlayer[] = [];
    try {
      for (const [index, player] of roster.entries()) {
        this.progress.set(`Scouting ${player.name || 'player'} (${index + 1} of ${roster.length})…`);
        out.push(await this.scoutOne(player));
        this.done.set(out.length);
        await save([...out, ...roster.slice(out.length)]);
      }
    } finally {
      this.scouting.set(null);
      this.progress.set('');
      this.done.set(0);
      this.total.set(0);
    }
  }

  private async scoutOne(player: OpponentPlayer): Promise<OpponentPlayer> {
    if (!player.name?.trim()) {
      return { ...player, scoutError: 'No Riot ID' };
    }
    try {
      const found = await this.enrichment.enrichPlayer({
        summonerName: player.name,
        riotTag: player.riotTag,
        region: player.region,
        role: player.role
      });

      // The template fallback is what the endpoint returns when Riot said
      // nothing useful. Storing it would put invented strengths on a real
      // person's row, which is worse than an empty one.
      if (found.source !== 'provider') {
        return { ...player, scoutError: 'No ranked history found', scoutedAt: undefined };
      }

      // Solo and flex are separate ladders and routinely differ by a tier or
      // more. A team plays flex together, so labelling matters: an unlabelled
      // number could be either, and reading one as the other misjudges them.
      const solo = found.queueStats?.solo?.rank;
      const flex = found.queueStats?.flex?.rank;
      const label = (r?: { tier: string; rank: string }) => (r ? `${r.tier} ${r.rank}` : undefined);
      const record = (r?: { wins: number; losses: number; winRate: number }) =>
        r && r.wins + r.losses > 0 ? `${r.wins}W ${r.losses}L (${r.winRate}%)` : undefined;

      return {
        ...player,
        top3: found.top3 ?? [],
        bans: found.bans ?? [],
        playstyle: found.playstyle,
        soloRank: label(solo),
        flexRank: label(flex),
        rank: label(solo) ?? label(flex),
        // Two is what a draft can act on; the rest is a long tail of one-offs.
        positions: (found.positions ?? []).slice(0, 2),
        poolByRole: found.poolByRole ?? {},
        bansByRole: found.bansByRole ?? {},
        championRecords: found.championRecords ?? [],
        recentChampions: found.recentChampions ?? [],
        // Both ranked queues, kept apart. The merged fields above are whichever
        // queue the backend preferred — flex — so without this the row shows a
        // flex pool labelled as though it were everything they play.
        byQueue: found.byQueue ?? undefined,
        // The season record was already being fetched and thrown away. It is
        // the honest scale of a rank: 425-439 is a different player from 12-6.
        soloRecord: record(solo),
        flexRecord: record(flex),
        scoutedAt: new Date().toISOString(),
        scoutError: undefined
      };
    } catch (err) {
      return { ...player, scoutError: err instanceof Error ? err.message : 'Scout failed' };
    }
  }
}
