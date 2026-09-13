import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { HomeRecords } from '../../../core/home-model';
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
 * Records to beat (13 Sep 2026): the most kills and the most vision one of ours put up in a game, the
 * fastest win and the longest run of wins, all ours, over the season the page is reading. A record
 * nobody has set is an invitation, not a zero.
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
              <button type="button" class="view-btn home-pill home-records-open" [attr.aria-label]="'Open the game: ' + l.label" (click)="openGame(l.matchId)">
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
    return [
      {
        key: 'kills',
        icon: 'swords',
        label: 'Most kills',
        value: r.mostKills ? String(r.mostKills.value) : '',
        who: r.mostKills ? [on(r.mostKills.player, r.mostKills.champion), vs(r.mostKills.opponent)].filter(Boolean).join(' ') : '',
        when: r.mostKills ? DAY(r.mostKills.date) : '',
        ...(r.mostKills?.matchId ? { matchId: r.mostKills.matchId } : {})
      },
      {
        key: 'fastest',
        icon: 'timer',
        label: 'Fastest win',
        value: r.fastestWin ? clock(r.fastestWin.value) : '',
        who: r.fastestWin ? vs(r.fastestWin.opponent) || r.fastestWin.label : '',
        when: r.fastestWin ? DAY(r.fastestWin.date) : '',
        ...(r.fastestWin?.matchId ? { matchId: r.fastestWin.matchId } : {})
      },
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
      {
        key: 'vision',
        icon: 'visibility',
        label: 'Most vision',
        value: r.mostVision ? String(r.mostVision.value) : '',
        who: r.mostVision ? [on(r.mostVision.player, r.mostVision.champion), vs(r.mostVision.opponent)].filter(Boolean).join(' ') : '',
        when: r.mostVision ? DAY(r.mostVision.date) : '',
        ...(r.mostVision?.matchId ? { matchId: r.mostVision.matchId } : {})
      }
    ];
  });
}

const MULTIKILL_WORDS: Record<number, string> = { 2: 'Double', 3: 'Triple', 4: 'Quadra', 5: 'Penta' };

function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
