import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { HomeRecords } from '../../../core/home-model';
import { GameRecord } from '../../../core/team-season';
import { InViewDirective } from '../../../shared/in-view.directive';
import { UiService } from '../../../services/ui.service';

interface Line {
  key: string;
  icon: string;
  label: string;
  value: string;
  who: string;
  when: string;
  /** The match to open on the Games page. */
  matchId?: string;
  /** What an empty row says instead of "Set the first one". */
  empty?: string;
}

const DAY = (at: number) => (at > 0 ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

/**
 * Records to beat (13 Sep 2026): the most kills, assists, damage, CS a minute and vision one of ours put up in a
 * game, the perfect game, the biggest multikill and the longest run of wins, all ours, over the season the page is
 * reading. A record nobody has set is an invitation, not a zero. The fastest win went the same evening.
 */
@Component({
  selector: 'app-home-records',
  imports: [InViewDirective],
  template: `
    <section class="card home-tile home-records" appInView aria-labelledby="home-records-title">
      <header class="home-card-head">
        <h2 id="home-records-title"><span class="material-symbols-rounded" aria-hidden="true">emoji_events</span> Records to beat</h2>
        <span class="home-card-scope">{{ scopeLabel() }}</span>
      </header>
      <ul class="home-records-list">
        @for (l of lines(); track l.key) {
          <li class="home-records-row" [class.is-empty]="!l.value">
            <span class="home-records-icon material-symbols-rounded" aria-hidden="true">{{ l.icon }}</span>
            <span class="home-records-label">{{ l.label }}</span>
            <b class="home-records-value">{{ l.value || '—' }}</b>
            <span class="home-records-who">{{ l.value ? l.who : l.empty || 'Set the first one' }}@if (l.when) { <small>{{ l.when }}</small> }</span>
            @if (l.value && l.matchId) {
              <button type="button" class="view-btn home-records-open" [attr.aria-label]="'Open the game: ' + l.label" (click)="openGame(l.matchId)">
                <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span> Game
              </button>
            } @else {
              <span class="home-records-open" aria-hidden="true"></span>
            }
          </li>
        }
      </ul>
      @if (records().multikillCoverage; as c) {
        @if (c.of && c.read < c.of) {
          <p class="home-tile-note">Multikills counted over {{ c.read }} of {{ c.of }} Riot games; older games gain them as the match cache refills.</p>
        }
      }
    </section>
  `
})
export class HomeRecordsComponent {
  readonly records = input.required<HomeRecords>();
  readonly scopeLabel = input.required<string>();

  private readonly ui = inject(UiService);
  private readonly router = inject(Router);

  protected openGame(matchId: string): void {
    void this.router.navigate(['/games'], { queryParams: { match: matchId } });
  }

  protected readonly lines = computed<Line[]>(() => {
    const r = this.records();
    const on = (player?: string, champion?: string) => [player, champion ? `on ${this.ui.championName(champion)}` : ''].filter(Boolean).join(' ');
    const vs = (opponent?: string) => (opponent ? `vs ${opponent}` : '');
    /** A player's record row: the figure as given, who set it and against whom, and the game to open. */
    const line = (key: string, icon: string, label: string, rec: GameRecord | null, value: (v: GameRecord) => string): Line => ({
      key,
      icon,
      label,
      value: rec ? value(rec) : '',
      who: rec ? [on(rec.player, rec.champion), vs(rec.opponent)].filter(Boolean).join(' ') : '',
      when: rec ? DAY(rec.date) : '',
      ...(rec?.matchId ? { matchId: rec.matchId } : {})
    });
    return [
      line('kills', 'swords', 'Most kills', r.mostKills, (v) => String(v.value)),
      line('assists', 'handshake', 'Most assists', r.mostAssists, (v) => String(v.value)),
      line('damage', 'bolt', 'Most damage', r.mostDamage, (v) => thousands(v.value)),
      line('cs', 'agriculture', 'Most CS/min', r.mostCsPerMin, (v) => v.value.toFixed(1)),
      line('perfect', 'verified', 'Perfect game', r.perfectGame, (v) => v.detail ?? String(v.value)),
      {
        key: 'streak',
        icon: 'local_fire_department',
        label: 'Longest win streak',
        value: r.longestWinStreak ? String(r.longestWinStreak.length) : '',
        who: r.longestWinStreak ? `${r.longestWinStreak.length === 1 ? 'win' : 'wins'} in a row` : '',
        when: r.longestWinStreak ? [DAY(r.longestWinStreak.from), DAY(r.longestWinStreak.to)].filter(Boolean).join(' – ') : '',
        ...(r.longestWinStreak?.matchId ? { matchId: r.longestWinStreak.matchId } : {})
      },
      {
        key: 'multikill',
        // Before cache v6 reaches a game nobody can say whether it held a double, so an empty row waits rather than invites.
        ...(r.multikillCoverage.of && !r.multikillCoverage.read ? { empty: 'Waiting on the match cache' } : {}),
        icon: 'crisis_alert',
        label: 'Biggest multikill',
        value: r.biggestMultikill ? MULTIKILL_WORDS[r.biggestMultikill.value] ?? `${r.biggestMultikill.value} kills` : '',
        who: r.biggestMultikill
          ? [on(r.biggestMultikill.player, r.biggestMultikill.champion), r.biggestMultikill.pentas ? `${r.biggestMultikill.pentas} ${r.biggestMultikill.pentas === 1 ? 'pentakill' : 'pentakills'}` : ''].filter(Boolean).join(' · ')
          : '',
        when: r.biggestMultikill ? DAY(r.biggestMultikill.date) : '',
        ...(r.biggestMultikill?.matchId ? { matchId: r.biggestMultikill.matchId } : {})
      },
      line('vision', 'visibility', 'Most vision', r.mostVision, (v) => String(v.value))
    ];
  });
}

const MULTIKILL_WORDS: Record<number, string> = { 2: 'Double', 3: 'Triple', 4: 'Quadra', 5: 'Penta' };

/** 52,480 reads as 52.5k: the record is the size, not the last digit. */
function thousands(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(v);
}
