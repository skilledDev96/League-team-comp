import { computed, inject, Injectable } from '@angular/core';
import { LastCrown, lastCrown } from '../core/mvp-race';
import { seriesCrowns } from '../core/series-results';
import { sameName } from '../core/team-season';
import { TeamDataService } from './team-data.service';

/**
 * Who holds the MVP banner (13 Sep 2026, the lead: "add an MVP banner everywhere the MVP's name is shown, so the
 * player feels highlighted until the crown is given to someone else"): the MVP of the newest series that crowned
 * somebody for real — the same mark Home's spotlight shows — until the next finished series crowns someone.
 *
 * One computed over the store's signals, so every page names the same holder; recomputed on every change, like the
 * crowns themselves, so a re-read of a series' figures moves the banner without anything being stored.
 */
@Injectable({ providedIn: 'root' })
export class LastMvpService {
  private readonly data = inject(TeamDataService);

  readonly holder = computed<LastCrown | null>(() => {
    const { crowns } = seriesCrowns({
      tournaments: this.data.tournaments(),
      series: this.data.tournamentSeries(),
      seriesGames: this.data.seriesGames(),
      analysis: this.data.compAnalysis()?.games ?? [],
      scrims: this.data.scrims(),
      players: this.data.players()
    });
    return lastCrown(crowns);
  });

  /** The holder's roster name, for a site that only has a name to compare. */
  readonly holderName = computed(() => {
    const h = this.holder();
    if (!h) return null;
    const player = h.playerId ? this.data.players().find((p) => p.id === h.playerId) : undefined;
    return player?.name ?? h.name ?? null;
  });

  /** Whether a site's player is the holder: by id when the site has one, else by the name the games carried. */
  isHolder(playerId?: string | null, name?: string | null): boolean {
    const h = this.holder();
    if (!h) return false;
    if (playerId && h.playerId) return playerId === h.playerId;
    if (name) return sameName(name, this.holderName()) || sameName(name, h.name);
    return false;
  }
}
