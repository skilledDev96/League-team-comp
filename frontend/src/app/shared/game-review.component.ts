import { DatePipe, Location, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AnalysisGame, DeathCould, DeathVerdict, GameReview, ReviewPoint, ReviewTheme } from '../models/team.models';
import { COULD_LABELS, evidenceChips, HOW_LABELS, playerStatLine, reviewAsText, scoreline, ZONE_LABELS } from '../core/review-view';
import { MatchTimelineService } from '../services/match-timeline.service';
import { ToastService } from '../services/toast.service';
import { UiService } from '../services/ui.service';
import { InfoTipComponent } from './info-tip.component';
import { PlayerMarkComponent } from './player-mark.component';
import { TooltipDirective } from './tooltip.directive';

/**
 * A written review of one game (9 Sep 2026): the headline on how it was
 * decided over the scoreline every point refers to, the game in moments,
 * the first thing to fix next game as a callout, the other points in two
 * content-sized columns, a row per player with their stat line beside the
 * notes and the further points behind a fold, and the death ledger — every
 * death of ours with what would have stopped it, read off the timeline the
 * drawer reads, so the notes can be checked against it. Read-only, apart
 * from copying itself as text for the team chat; the button that writes a
 * review lives on the row.
 */
@Component({
  selector: 'app-game-review',
  imports: [DatePipe, NgTemplateOutlet, TooltipDirective, InfoTipComponent, PlayerMarkComponent],
  template: `
    @if (review(); as r) {
      <details class="intel-collapse game-review" [open]="open() || fresh()" aria-label="Game review">
        <summary class="game-review-toggle">
          <span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
          <strong>Review</strong>
          <span class="game-review-headline">{{ r.team.headline || 'Read the review' }}</span>
          <span class="tag" [appTip]="r.tier === 'timeline' ? 'Read from Riot\\'s minute-by-minute timeline' : 'A replay carries end-of-game totals only; nothing here is timed'">
            {{ r.tier === 'timeline' ? 'From the timeline' : 'Totals only' }}
          </span>
          <span class="material-symbols-rounded intel-collapse-chevron" aria-hidden="true">chevron_right</span>
        </summary>
        <div class="game-review-body">
        <div class="game-review-head">
          <span class="game-review-verdict" [class.is-good]="r.team.compVerdict === 'as drafted'" [class.is-bad]="r.team.compVerdict === 'off plan'"
                [appTip]="r.team.compWhy || 'Whether the comp did what its four axes and game plan expected'">
            {{ r.compName ? r.compName + ': ' : 'Comp: ' }}{{ r.team.compVerdict }}
          </span>
          <button type="button" class="view-btn game-review-copy" (click)="copy()" appTip="Copies a short version for the team chat: the headline and scoreline, the first thing next game, one Keep doing, and one ask per player. The figures stay here.">
            <span class="material-symbols-rounded" aria-hidden="true">content_copy</span> Copy for Discord
          </button>
        </div>

        @if (score().length) {
          <ul class="list-clean game-review-scoreline" aria-label="Scoreline">
            @for (c of score(); track c.label) {
              <li class="score-chip" [class.is-good]="c.good === true" [class.is-bad]="c.good === false">
                @if (c.ours) { <small>{{ c.label }}</small><b>{{ c.ours }}</b>@if (c.theirs) { <em>–{{ c.theirs }}</em> } } @else { <b>{{ c.label }}</b> }
              </li>
            }
          </ul>
        }
        @if (r.team.summary) { <p class="game-review-summary">{{ r.team.summary }}</p> }
        @if (r.team.compWhy) { <p class="muted game-review-why">{{ r.team.compWhy }}</p> }

        @if (moments().length) {
          <ol class="list-clean game-review-moments" [class.is-untimed]="!timed()" aria-label="The game in moments">
            @for (m of moments(); track $index) {
              <li class="game-review-moment" [class.is-us]="m.swing === 'us'" [class.is-them]="m.swing === 'them'">
                @if (timed()) { <span class="moment-minute">{{ m.minute }}<small>min</small></span> } @else { <span class="moment-dot" aria-hidden="true"></span> }
                <span class="moment-text">{{ m.text }}</span>
              </li>
            }
          </ol>
        }

        @if (first(); as f) {
          <div class="game-review-first">
            <p class="advice-head is-warn">First thing next game</p>
            <ng-container *ngTemplateOutlet="pointTpl; context: { $implicit: f }" />
          </div>
        }
        @if (rest().length || r.team.keepDoing.length) {
          <div class="game-review-grid" [class.is-single]="!rest().length">
            @if (rest().length) {
              <div class="game-review-col is-warn">
                <p class="advice-head is-warn">Also work on</p>
                <ul class="game-review-points">
                  @for (w of rest(); track $index) { <li class="game-review-point"><ng-container *ngTemplateOutlet="pointTpl; context: { $implicit: w }" /></li> }
                </ul>
              </div>
            }
            @if (r.team.keepDoing.length) {
              <div class="game-review-col is-ok">
                <p class="advice-head is-ok">Keep doing</p>
                <ul class="game-review-points">
                  @for (k of r.team.keepDoing; track $index) { <li class="game-review-point"><ng-container *ngTemplateOutlet="pointTpl; context: { $implicit: k }" /></li> }
                </ul>
              </div>
            }
          </div>
        }

        @if (r.players.length) {
          <div class="game-review-people" role="table" aria-label="Player notes">
            @for (p of r.players; track p.name) {
              <div class="game-review-person" role="row">
                <div class="person-head" role="cell">
                  <span class="person-avatar">
                    <app-player-mark [name]="p.name" />
                    <img class="champ-badge" [src]="ui.championIconUrl(p.champion)" [alt]="p.champion" loading="lazy" />
                  </span>
                  <span class="person-text">
                    <b>{{ p.name }}</b>
                    <small>{{ p.seat }} · {{ p.champion }}</small>
                    @if (stats(p.name); as line) { <span class="person-stats">{{ line }}</span> }
                  </span>
                </div>
                <div class="game-review-line is-ok" role="cell">
                  <b>Strength</b>
                  @if (p.strength.text) { <span>{{ p.strength.text }}</span> <ng-container *ngTemplateOutlet="chipsTpl; context: { $implicit: p.strength.evidence }" /> } @else { <span class="muted">—</span> }
                </div>
                <div class="game-review-line is-warn" role="cell">
                  <b>Work on</b>
                  @if (p.workOn.text) {
                    <span>@if (p.workOn.minute !== null && timed()) { <span class="review-minute">{{ p.workOn.minute }} min</span> }{{ p.workOn.text }}</span>
                    <ng-container *ngTemplateOutlet="chipsTpl; context: { $implicit: p.workOn.evidence }" />
                  } @else { <span class="muted">—</span> }
                </div>
                @if (p.more?.length) {
                  <details class="game-review-more" role="cell">
                    <summary><span class="material-symbols-rounded" aria-hidden="true">expand_more</span>More to work on <small>{{ p.more!.length }}</small></summary>
                    <ul class="game-review-points">
                      @for (m of p.more; track $index) { <li class="game-review-point"><ng-container *ngTemplateOutlet="pointTpl; context: { $implicit: m }" /></li> }
                    </ul>
                  </details>
                }
              </div>
            }
          </div>
        }

        @if (r.tier === 'timeline') {
          <div class="game-review-ledger" aria-label="Deaths, and what would have stopped them">
            <div class="game-review-ledger-head">
              <p class="advice-head">Deaths, and what would have stopped them</p>
              @if (ledger()?.length) {
                <div class="view-segment" role="group" aria-label="Show deaths">
                  <button type="button" [class.active]="ledgerFilter() === 'all'" (click)="ledgerFilter.set('all')">All <small>{{ ledger()!.length }}</small></button>
                  @for (c of coulds; track c.key) {
                    @if (count(c.key); as n) { <button type="button" [class.active]="ledgerFilter() === c.key" (click)="ledgerFilter.set(c.key)">{{ c.label }} <small>{{ n }}</small></button> }
                  }
                </div>
              }
            </div>
            @switch (timelineState()) {
              @case ('loading') { <p class="muted">Reading the timeline…</p> }
              @case ('none') { <p class="muted">No timeline for this game yet. Twenty are fetched each morning, and Re-review fetches one now.</p> }
              @case ('old') { <p class="muted">This timeline predates the death ledger. Re-review fetches a new one.</p> }
              @default {
                @if (!ledger()!.length) {
                  <p class="muted">Nobody died. Keep doing that.</p>
                } @else {
                  <div class="games-scroll">
                    <table class="game-review-ledger-table">
                      <thead>
                        <tr><th scope="col" class="num">Min</th><th scope="col">Who</th><th scope="col">Where</th><th scope="col">How</th><th scope="col">Could have been stopped by</th></tr>
                      </thead>
                      <tbody>
                        @for (d of ledgerRows(); track d.minute + d.seat) {
                          <tr [appTip]="d.line">
                            <td class="num">{{ d.minute }}</td>
                            <td>@if (d.name) { <app-player-mark [name]="d.name" />{{ d.name }} <small class="muted">{{ d.seat }}</small> } @else { {{ d.seat }} }</td>
                            <td>{{ zone(d.zone) }}</td>
                            <td>{{ how(d.how) }}</td>
                            <td>
                              @if (d.could.length) {
                                @for (c of d.could; track c) {
                                  <span class="could-chip" [class]="'could-chip is-' + c"><span class="material-symbols-rounded" aria-hidden="true">{{ couldIcon(c) }}</span>{{ couldLabel(c) }}</span>
                                }
                              } @else { <span class="muted">—</span> }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  <p class="muted game-story-caveat">Approximate by a minute <app-info-tip text="Frames are a minute apart. Jungle pathing means our jungler was within about a screen at the nearest frame and not on an objective; a ward means two or more came in with no ward of ours nearby; a call means their jungler was already on that side a minute before; position means alone on their side of the map." /></p>
                }
              }
            }
          </div>
        }

        <p class="muted game-review-foot">
          Written {{ r.reviewedAt | date: 'd MMM, HH:mm' }} by {{ models() }} for about {{ cost() }}{{ r.trigger === 'auto' ? ', by the morning run' : '' }}.
          <app-info-tip text="Every point should match a fact in How the game went; if one does not, the review is wrong, not the game." label="How to read the review" />
        </p>
        </div>
      </details>

      <ng-template #pointTpl let-p>
        @if (p.theme || (p.minute !== null && timed())) {
          <span class="game-review-point-tags">
            @if (p.theme) { <span class="review-theme"><span class="material-symbols-rounded" aria-hidden="true">{{ icon(p.theme) }}</span>{{ p.theme }}</span> }
            @if (p.minute !== null && timed()) { <span class="review-minute">{{ p.minute }} min</span> }
          </span>
        }
        <span class="game-review-point-text">{{ p.text }}</span>
        <ng-container *ngTemplateOutlet="chipsTpl; context: { $implicit: p.evidence }" />
      </ng-template>

      <ng-template #chipsTpl let-evidence>
        @if (chips(evidence); as list) {
          @if (list.length) {
            <span class="evidence-chips">
              @for (c of list; track $index) { <span class="evidence-chip">{{ c }}</span> }
            </span>
          }
        }
      </ng-template>
    }
  `
})
export class GameReviewComponent {
  readonly review = input<GameReview | undefined>(undefined);
  /** The game the review is about, for the scoreline and each player's stat line. */
  readonly game = input<AnalysisGame | undefined>(undefined);
  readonly opponent = input<string | undefined>(undefined);
  /** Start open: the row the page was asked to show. A review written in the last few minutes opens itself too. */
  readonly open = input<boolean>(false);

  protected readonly ui = inject(UiService);
  private readonly timelines = inject(MatchTimelineService);
  private readonly toast = inject(ToastService);

  /** The ledger's filter pills, in the order the tags are argued. */
  protected readonly coulds: { key: DeathCould; label: string }[] = (Object.keys(COULD_LABELS) as DeathCould[]).map((key) => ({ key, label: COULD_LABELS[key].label }));
  protected readonly ledgerFilter = signal<'all' | DeathCould>('all');

  /** The timeline the drawer reads too; read once a timeline-tier review is shown. */
  private readonly timeline = computed(() => {
    const id = this.review()?.matchId;
    return id ? (this.timelines.known().get(id) ?? null) : null;
  });
  protected readonly timelineState = computed<'loading' | 'none' | 'old' | 'have'>(() => {
    const id = this.review()?.matchId;
    if (!id) return 'none';
    const map = this.timelines.known();
    if (!map.has(id)) return 'loading';
    const t = map.get(id);
    if (!t) return 'none';
    return t.facts?.ledger ? 'have' : 'old';
  });
  protected readonly ledger = computed<DeathVerdict[] | undefined>(() => this.timeline()?.facts?.ledger);
  protected readonly ledgerRows = computed(() => {
    const all = this.ledger() ?? [];
    const f = this.ledgerFilter();
    return f === 'all' ? all : all.filter((d) => d.could.includes(f));
  });
  protected readonly moments = computed(() => this.review()?.team.moments ?? []);
  /** A replay review has no minutes behind it, so no minute pills. */
  protected readonly timed = computed(() => this.review()?.tier === 'timeline');
  protected readonly fresh = computed(() => {
    const at = Date.parse(this.review()?.reviewedAt ?? '');
    return Number.isFinite(at) && Date.now() - at < 5 * 60_000;
  });

  constructor() {
    effect(() => {
      const r = this.review();
      if (!r || r.tier !== 'timeline') return;
      if (this.timelines.known().has(r.matchId)) return;
      void this.timelines.load(r.matchId);
    });
  }

  protected count(could: DeathCould): number {
    return (this.ledger() ?? []).filter((d) => d.could.includes(could)).length;
  }

  protected couldLabel(c: DeathCould): string {
    return COULD_LABELS[c].label;
  }

  protected couldIcon(c: DeathCould): string {
    return COULD_LABELS[c].icon;
  }

  protected how(h: DeathVerdict['how']): string {
    return HOW_LABELS[h];
  }

  protected zone(z: DeathVerdict['zone']): string {
    return ZONE_LABELS[z];
  }
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** The game on the Games page, as a link a teammate can open from the chat. */
  private gameLink(matchId: string): string {
    const path = this.router.serializeUrl(this.router.createUrlTree(['/games'], { queryParams: { match: matchId, tab: 'games' } }));
    return `${window.location.origin}${this.location.prepareExternalUrl(path)}`;
  }

  private static readonly ICONS: Record<ReviewTheme, string> = {
    draft: 'swords',
    lanes: 'alt_route',
    fights: 'local_fire_department',
    objectives: 'flag',
    vision: 'visibility',
    tempo: 'schedule',
    macro: 'map'
  };

  protected icon(theme: ReviewTheme): string {
    return GameReviewComponent.ICONS[theme] ?? 'label';
  }

  protected readonly score = computed(() => scoreline(this.game()));
  protected readonly first = computed<ReviewPoint | undefined>(() => this.review()?.team.workOn[0]);
  protected readonly rest = computed<ReviewPoint[]>(() => this.review()?.team.workOn.slice(1) ?? []);

  protected chips(evidence: string): string[] {
    return evidenceChips(evidence ?? '');
  }

  protected stats(name: string): string {
    return playerStatLine(this.game()?.players.find((p) => p.name === name));
  }

  protected async copy(): Promise<void> {
    const r = this.review();
    if (!r) return;
    try {
      await navigator.clipboard.writeText(reviewAsText(r, this.game(), this.opponent(), this.gameLink(r.matchId), this.timeline()?.facts?.ledgerSummary));
      this.toast.show('Review copied', { kind: 'ok', icon: 'content_copy', text: 'Paste it in the team chat; the headline, the points and every player’s note are in it.' });
    } catch {
      this.toast.show('Could not copy', { kind: 'warn', text: 'The browser refused the clipboard; select the text and copy it by hand.' });
    }
  }

  protected readonly models = computed(() => {
    const r = this.review();
    if (!r) return '';
    const short = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    return r.models.team === r.models.players ? short(r.models.team) : `${short(r.models.team)} and ${short(r.models.players)}`;
  });

  protected readonly cost = computed(() => {
    const usd = this.review()?.usage.costUsd ?? 0;
    return usd < 0.01 ? 'a cent' : `${Math.round(usd * 100)} cents`;
  });
}
