import { Component, computed, inject, input, output } from '@angular/core';
import { MvpBannerComponent } from '../../../shared/mvp-banner.component';
import { Router, RouterLink } from '@angular/router';
import { playedAgo } from '../../../core/team-season';
import { RosterCard } from '../../../core/roster-model';
import { Player, Role, ROLES } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { PlayerEditorService } from '../../../services/player-editor.service';
import { UiService } from '../../../services/ui.service';
import { PlayerAvatarComponent } from '../../../shared/player-avatar.component';
import { RankSparklineComponent } from '../../../shared/rank-sparkline.component';
import { RateRingComponent } from '../../../shared/rate-ring.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';

/** How much of each list the sheet shows at Starter; Full shows everything. */
const STARTER_POOL = 6;
const STARTER_WORKING = 3;

/**
 * A player's sheet, under the poster (13 Sep 2026): what the team plays them on and how it goes, what
 * they are good at and what they are working on, where their rank is heading, and the doors to their
 * profile. One sheet at a time; the panel that opened it closes it, as do Escape and the close button.
 *
 * In edit mode the controls that used to crowd every card live here: the A team, the main seat and the
 * second seats, plus the editor drawer. They write through `PlayerEditorService.patch` as before.
 */
@Component({
  selector: 'app-roster-sheet',
  imports: [MvpBannerComponent, PlayerAvatarComponent, RankSparklineComponent, RateRingComponent, RouterLink, TooltipDirective],
  template: `
    @for (c of [card()]; track c.id) {
      <section class="gold-frame roster-sheet" id="roster-sheet" data-tour="roster-sheet" role="region" aria-labelledby="roster-sheet-title" (keydown.escape)="close.emit()">
        <div class="roster-sheet-art">
          @if (c.champion) {
            <img class="splash-art" [src]="ui.championArtUrl(c.champion)" (error)="ui.artFallback($event, c.champion)" alt="" />
          }
          <span class="splash-shade" aria-hidden="true"></span>
          <div class="roster-sheet-art-top">
            <span class="role-pill">{{ c.role }}</span>
            <app-rate-ring class="is-big" [rate]="c.ranked?.winRate ?? null" [games]="c.ranked?.games ?? 0" [wins]="c.ranked?.wins ?? 0" [label]="(c.ranked?.queue ?? 'ranked') + ' win rate'" [scope]="c.ranked?.queue === 'Flex' ? 'in ranked flex' : 'in ranked solo/duo'" [countUp]="true" />
          </div>
          <div class="roster-sheet-art-foot">
            @if (c.titles) {
              <span class="splash-chip" [appTip]="titleTip()"><span class="material-symbols-rounded" aria-hidden="true">workspace_premium</span>{{ c.titles }} MVP {{ c.titles === 1 ? 'title' : 'titles' }}</span>
            }
            @if (c.form.length) {
              <ol class="form-pips is-big" aria-label="Last results, newest first">
                @for (r of c.form; track $index) {
                  <li class="form-pip" [class.is-win]="r === 'W'" [class.is-loss]="r === 'L'"><span class="visually-hidden">{{ r === 'W' ? 'Win' : 'Loss' }}</span></li>
                }
              </ol>
            }
            <small>{{ c.games ? c.games + ' team ' + (c.games === 1 ? 'game' : 'games') + ', all time' : 'No team games yet' }}@if (lastPlayed(); as a) { · last played {{ a }} }</small>
          </div>
        </div>

        <div class="roster-sheet-main">
          <header class="roster-sheet-head">
            <app-player-avatar [name]="c.name" [icon]="c.icon" [role]="c.role" />
            <div class="roster-sheet-id">
              <p class="home-kicker">{{ c.group === 'fillIns' ? 'Fill-in' : c.group === 'bench' ? 'On the bench' : 'Player sheet' }}</p>
              <h2 id="roster-sheet-title" tabindex="-1">{{ c.name }}</h2>
              <p class="roster-sheet-sub">
                <app-mvp-banner [playerId]="c.playerId" [name]="c.name" />
                <span>{{ c.role }}@if (c.secondaryRoles.length) {, also {{ c.secondaryRoles.join(', ') }}}</span>
                <span>@if (c.rank; as r) { {{ r.label }} {{ r.queue }} } @else { Unranked }</span>
                @if (c.playstyle) { <span>{{ c.playstyle }}</span> }
                @if (c.fillInStatus) { <span>{{ c.fillInStatus }}</span> }
              </p>
            </div>
            <div class="roster-sheet-actions">
              @if (siblings().length > 1) {
                <button type="button" class="view-btn icon-pill" (click)="go.emit(step(-1))" [attr.aria-label]="'Previous: ' + neighbour(-1)?.name" [appTip]="'Previous: ' + neighbour(-1)?.name">
                  <span class="material-symbols-rounded" aria-hidden="true">chevron_left</span>
                </button>
                <button type="button" class="view-btn icon-pill" (click)="go.emit(step(1))" [attr.aria-label]="'Next: ' + neighbour(1)?.name" [appTip]="'Next: ' + neighbour(1)?.name">
                  <span class="material-symbols-rounded" aria-hidden="true">chevron_right</span>
                </button>
              }
              @if (c.playerId) {
                <a class="view-btn home-pill" [routerLink]="['/player', c.playerId]"><span class="material-symbols-rounded" aria-hidden="true">person</span> Profile</a>
              }
              <a class="view-btn home-pill" [href]="ui.summonerSearchUrl(c.name, c.profile)" target="_blank" rel="noopener noreferrer">op.gg <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span></a>
              @if (auth.editing() && c.playerId) {
                <button type="button" class="view-btn home-pill" (click)="editor.open(c.playerId)" appTip="Name, tag, pool, bans, playstyle and links, in a drawer">
                  <span class="material-symbols-rounded" aria-hidden="true">edit</span> Edit player
                </button>
              } @else if (auth.editing() && c.fillInId) {
                <a class="view-btn home-pill" [routerLink]="['/admin']" [queryParams]="{ tab: 'fillins' }" appTip="Fill-ins are edited on Admin › Fill-ins, where Fill from Riot lives">
                  <span class="material-symbols-rounded" aria-hidden="true">edit</span> Edit on Admin
                </a>
              }
              <button type="button" class="view-btn icon-pill" (click)="close.emit()" aria-label="Close the sheet" appTip="Close (Esc)">
                <span class="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            </div>
          </header>

          @if (auth.editing() && player(); as p) {
            <!-- The controls every card used to carry (8 Sep 2026), moved into the sheet: the poster is for looking. -->
            <div class="roster-edit">
              <span class="roster-edit-field">
                <span class="roster-edit-label" appTip="The A team is the five Patterns counts by default and the five the draft room follows. Same flag Admin sets.">A team for Patterns</span>
                <button data-tour="roster-ateam" type="button" class="ateam-toggle" [class.is-bench]="!!p.sub" [attr.aria-pressed]="!!p.sub"
                        [appTip]="p.sub ? 'On the bench — click to put them in the A team' : 'In the A team — click to bench them'"
                        (click)="setBench(p, !p.sub)">{{ p.sub ? 'Bench' : 'A team' }}</button>
              </span>
              <span class="roster-edit-field">
                <span data-tour="roster-main-seat" class="roster-edit-label" appTip="The seat in their title: Patterns’ Main counts them here and the draft room seats them here">Main seat</span>
                @for (r of roles; track r) {
                  <button type="button" class="role-flex-toggle" [class.on]="r === p.role" [attr.aria-pressed]="r === p.role"
                          [appTip]="r === p.role ? 'Their main seat' : 'Make ' + r + ' their main seat'" (click)="setMain(p, r)">{{ r }}</button>
                }
              </span>
              <span class="roster-edit-field">
                <span data-tour="roster-second-seat" class="roster-edit-label" appTip="The seats they also cover; Patterns’ Roles filter and the draft room read these">2nd seat</span>
                @for (r of roles; track r) {
                  @if (r !== p.role) {
                    <button type="button" class="role-flex-toggle" [class.on]="(p.secondaryRoles ?? []).includes(r)" [attr.aria-pressed]="(p.secondaryRoles ?? []).includes(r)"
                            (click)="toggleSecondary(p, r)">{{ r }}</button>
                  }
                }
              </span>
            </div>
          }

          <div class="roster-sheet-grid">
            <section class="roster-sheet-block" style="--block-i: 0" aria-labelledby="roster-sheet-pool">
              <h3 id="roster-sheet-pool">Pool <small>{{ c.group === 'fillIns' ? 'from Riot' : 'win rates in team games' }}</small></h3>
              @if (pool().length) {
                <ul class="roster-pool">
                  @for (e of pool(); track e.champion) {
                    <li class="roster-pool-item" [class.is-unplayed]="!e.games">
                      <img [src]="ui.championIconUrl(e.champion)" alt="" loading="lazy" />
                      <span class="roster-pool-text">
                        <span class="roster-pool-name">{{ ui.championName(e.champion) }}</span>
                        @if (e.games) {
                          <span><b [class]="e.band">{{ e.winRate }}%</b> <small>{{ e.games }} {{ e.games === 1 ? 'game' : 'games' }}</small></span>
                        } @else {
                          <small>{{ c.group === 'fillIns' ? 'plays it' : 'not played for the team yet' }}</small>
                        }
                      </span>
                    </li>
                  }
                </ul>
                @if (hiddenPool()) { <p class="roster-sheet-more">{{ hiddenPool() }} more at Full</p> }
              } @else {
                <p class="roster-sheet-empty">No champions yet: the pool fills from their team games and the morning refresh.</p>
              }
            </section>

            <section class="roster-sheet-block" style="--block-i: 1" aria-labelledby="roster-sheet-play">
              <h3 id="roster-sheet-play">How they play</h3>
              @if (strengths().length || weaknesses().length) {
                <div class="tag-row">
                  @for (s of strengths(); track s) { <span class="tag good">{{ s }}</span> }
                  @for (w of weaknesses(); track w) { <span class="tag bad">{{ w }}</span> }
                </div>
              } @else {
                <p class="roster-sheet-empty">Strengths and weaknesses come in with the next refresh from Riot.</p>
              }
              @if (full() && c.bans.length) {
                <p class="roster-sheet-line"><span class="roster-sheet-label">Suggested bans</span>
                  @for (b of c.bans; track b) { <img class="roster-sheet-icon" [src]="ui.championIconUrl(b)" [alt]="ui.championName(b)" [appTip]="ui.championName(b)" loading="lazy" /> }
                </p>
              }
              @if (full() && c.stats; as s) {
                <p class="roster-sheet-line roster-sheet-stats">
                  <span><b>{{ s.kda.toFixed(1) }}</b> KDA</span>
                  @if (s.csPerMin !== undefined) { <span><b>{{ s.csPerMin.toFixed(1) }}</b> CS/min</span> }
                  @if (s.killParticipation !== undefined) { <span><b>{{ (s.killParticipation * 100).toFixed(0) }}%</b> kill part.</span> }
                  @if (s.visionPerGame !== undefined) { <span><b>{{ s.visionPerGame.toFixed(0) }}</b> vision</span> }
                  <small>over {{ s.statGames }} {{ s.statGames === 1 ? 'game' : 'games' }} with figures</small>
                </p>
              }
            </section>

            <section class="roster-sheet-block" style="--block-i: 2" aria-labelledby="roster-sheet-rank">
              <h3 id="roster-sheet-rank">Rank climb</h3>
              @if (c.playerId) {
                <app-rank-sparkline [playerId]="c.playerId" [name]="c.name" [now]="c.rank ? c.rank.label + ' ' + c.rank.queue : ''" />
              } @else {
                <p class="roster-sheet-empty">@if (c.rank) { <b>{{ c.rank.label }} {{ c.rank.queue }}</b>. } The morning refresh follows the roster, not fill-ins.</p>
              }
            </section>

            <section class="roster-sheet-block" style="--block-i: 3" aria-labelledby="roster-sheet-work">
              <h3 id="roster-sheet-work">Working on @if (c.resolved && full()) { <small>{{ c.resolved }} resolved</small> }</h3>
              @if (working().length) {
                <ul class="roster-work">
                  @for (w of working(); track w.id) { <li>{{ w.text }}</li> }
                </ul>
              } @else if (c.playerId) {
                <p class="roster-sheet-empty">Nothing open. Add what they are working on in Players.</p>
              }
              @if (c.playerId) {
                <p class="roster-sheet-more">
                  @if (hiddenWorking()) { <span class="muted">{{ hiddenWorking() }} more</span> }
                  <button type="button" class="view-btn home-pill" (click)="openInPlayers()">
                    <span class="material-symbols-rounded" aria-hidden="true">table_rows</span>Open in Players
                  </button>
                </p>
              }
              @if (full() && c.learning.length) {
                <p class="roster-sheet-line"><span class="roster-sheet-label">Learning</span>
                  @for (l of c.learning; track l.id) {
                    <img class="roster-sheet-icon" [class.is-ready]="l.ready" [src]="ui.championIconUrl(l.champion)" [alt]="ui.championName(l.champion)"
                         [appTip]="ui.championName(l.champion) + ' · ' + (l.ready ? 'ready' : l.priority + ' priority')" loading="lazy" />
                  }
                </p>
              }
            </section>
          </div>
        </div>
      </section>
    }
  `
})
export class RosterSheetComponent {
  readonly card = input.required<RosterCard>();
  /** "2 days ago": when they last played a serious game with the team. */
  protected readonly lastPlayed = computed(() => {
    const at = this.card().lastPlayed;
    return at ? playedAgo(at, Date.now()) : '';
  });
  /** The stored player, for the edit controls; absent for a fill-in. */
  readonly player = input<Player | undefined>(undefined);
  readonly full = input(false);
  /** The group the card sits in, for previous and next. */
  readonly siblings = input<readonly RosterCard[]>([]);
  readonly close = output<void>();
  readonly go = output<string>();

  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly editor = inject(PlayerEditorService);
  private readonly router = inject(Router);
  protected readonly roles: readonly Role[] = ROLES;

  /** Starter: what they play for the team, or the pool written down when they have not played yet. Full: all of it. */
  protected readonly pool = computed(() => {
    const all = this.card().pool;
    if (this.full()) return all;
    const played = all.filter((e) => e.games > 0);
    return (played.length ? played : all).slice(0, STARTER_POOL);
  });
  protected readonly hiddenPool = computed(() => (this.full() ? 0 : this.card().pool.length - this.pool().length));
  protected readonly strengths = computed(() => (this.full() ? this.card().strengths : this.card().strengths.slice(0, 3)));
  protected readonly weaknesses = computed(() => (this.full() ? this.card().weaknesses : this.card().weaknesses.slice(0, 2)));
  protected readonly working = computed(() => (this.full() ? this.card().working : this.card().working.slice(0, STARTER_WORKING)));
  protected readonly hiddenWorking = computed(() => this.card().working.length - this.working().length);

  protected readonly titleTip = computed(() => {
    const t = this.card().lastTitle;
    return t ? `Series MVP titles. The last: vs ${t.opponent} on ${this.ui.championName(t.champion)}.` : 'Series MVP titles';
  });

  protected neighbour(dir: 1 | -1): RosterCard | undefined {
    const list = this.siblings();
    const at = list.findIndex((c) => c.id === this.card().id);
    return list.length ? list[(at + dir + list.length) % list.length] : undefined;
  }

  protected step(dir: 1 | -1): string {
    return this.neighbour(dir)?.id ?? this.card().id;
  }

  /** Their row on Players, open: working on, learning and the pool, edited there. */
  protected openInPlayers(): void {
    void this.router.navigate(['/roster'], { queryParams: { view: 'players', player: this.card().id } });
  }

  // ---- The A team and the seats (moved from the cards, same writes) ------------------------------------

  protected setBench(player: Player, sub: boolean): void {
    void this.editor.patch(player, { sub: sub || undefined });
  }

  /** The seat in the title. A second seat that becomes the main stops being a second. */
  protected setMain(player: Player, role: Role): void {
    if (role === player.role) return;
    const seconds = (player.secondaryRoles ?? []).filter((r) => r !== role);
    void this.editor.patch(player, { role, secondaryRoles: seconds.length ? seconds : undefined });
  }

  protected toggleSecondary(player: Player, role: Role): void {
    if (role === player.role) return;
    const now = player.secondaryRoles ?? [];
    const next = now.includes(role) ? now.filter((r) => r !== role) : [...now, role];
    void this.editor.patch(player, { secondaryRoles: next.length ? next : undefined });
  }
}
