import { afterRenderEffect, Component, computed, effect, ElementRef, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DEATH_READS, DeathReadKind, READ_LABELS } from '../../../core/death-reads';
import { COULD_GLYPHS, FilmDeathPin, FilmModel } from '../../../core/film-model';
import { voiceOf } from '../../../core/film-style';
import { initialsOf } from '../../../core/initials';
import { COULD_LABELS, HOW_LABELS, ZONE_LABELS } from '../../../core/review-view';
import { DeathHow, FilmNote, MapZone } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { MotionService } from '../../../services/motion.service';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { DeathSceneComponent } from '../../../shared/film/death-scene.component';
import { countText } from '../../../shared/film/film-count';
import { FilmGlyphComponent } from '../../../shared/film/film-glyph.component';
import { RiftMapComponent } from '../../../shared/film/rift-map.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmFrameComponent } from '../film-frame.component';

/** A death's cost is said on the card only from this much gold either way; under it the two minutes after read as noise. */
const COST_SAYS_GOLD = 300;

/** Thousands as "1.2k", under a thousand as the number; the same shape as the facts' own lines and the tape's consequences. */
export function k(gold: number): string {
  const abs = Math.abs(gold);
  return abs >= 1000 ? `${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(abs);
}

/** A cost with its sign, for the costliest strip: "-1.2k", "+400". */
export function signedK(gold: number): string {
  return `${gold < 0 ? '-' : '+'}${k(gold)}`;
}

/** The line under a death's read on the card, when the two minutes after moved the gold enough to say so; empty otherwise. */
export function costLine(cost: number | undefined): string {
  if (typeof cost !== 'number' || Math.abs(cost) < COST_SAYS_GOLD) return '';
  return cost < 0 ? `It cost about ${k(cost)} over the next two minutes.` : `We came out ${k(cost)} up over the next two minutes.`;
}

/**
 * The map (9 Sep 2026; cut 4 on 10 Sep 2026): every death of ours on the
 * Rift where the timeline put it, theirs as dots and the fights as blobs,
 * and beside it the film's reading of each one. Nothing here asks any more:
 * the side opens on one line over the deaths (how many were avoidable,
 * traded, bought an objective, clean), a legend of the reads lights the pins
 * of one read at a time, a strip names the deaths that cost most, and the
 * card walks the deaths one at a time with the read's badge, a drawn scene
 * of what was around it (`app-death-scene`), the read in a sentence, what
 * it cost over the next two minutes, the ledger's own line when it says
 * more, and the tags as chips. A tap on a pin or a costliest card jumps to
 * it, Watch it takes the tape to twenty seconds before, As a table is the
 * ledger with a Read column, and an editor can leave one line on a death.
 * Nothing on the map drags, and every position is approximate by zone.
 */
@Component({
  selector: 'app-film-map',
  imports: [FormsModule, TooltipDirective, FilmFrameComponent, RiftMapComponent, FilmGlyphComponent, DeathSceneComponent],
  template: `
    @let map = model().map;
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      @if (map) {
        <div class="film-map is-open">
          <div class="film-map-stage">
            <app-rift-map
              [pins]="map.pins"
              [theirs]="map.theirs"
              [clusters]="map.clusters"
              [until]="null"
              [selected]="selectedKey()"
              [readFilter]="readFilter()"
              [unreadKeys]="[]"
              [dim]="false"
              (pick)="jumpTo($event)"
            >
              <span caption>Positions are approximate: one frame a minute, placed inside the zone the frame put them in.</span>
            </app-rift-map>
          </div>

          <div class="film-map-side">
            <p class="film-map-opening">
              @if (opening().count; as n) { <b #openingNum class="film-num" [attr.data-count]="n"></b> }
              <span>{{ opening().rest }}</span>
            </p>

            @if (map.pins.length) {
              <div class="film-legend" role="group" aria-label="Light the deaths by how the film reads them">
                <button type="button" class="view-btn" [class.active]="readFilter() === 'all'" [attr.aria-pressed]="readFilter() === 'all'" (click)="readFilter.set('all')">All <small>{{ map.pins.length }}</small></button>
                @for (r of readsPresent(); track r) {
                  <button type="button" [class]="'view-btn film-legend-read is-read-' + r" [class.active]="readFilter() === r" [attr.aria-pressed]="readFilter() === r" [attr.aria-label]="readLabels[r].label + ', ' + map.reads[r]" [appTip]="readLabels[r].tip" (click)="toggleRead(r)">
                    <app-film-glyph [name]="readLabels[r].icon" /><span class="film-legend-word">{{ readLabels[r].label }}</span>{{ ' ' }}<small>{{ map.reads[r] }}</small>
                  </button>
                }
                <button type="button" class="view-btn film-map-table-btn" [class.active]="table()" [attr.aria-pressed]="table()" (click)="table.set(!table())"><span class="material-symbols-rounded" aria-hidden="true">table_rows</span> As a table</button>
              </div>

              @if (costliest().length) {
                <div class="film-costliest">
                  <span class="film-costliest-label">The ones that cost most</span>
                  <div class="film-costliest-cards">
                    @for (c of costliest(); track c.key) {
                      <button type="button" class="film-costliest-card" [style.--i]="$index" [class.active]="c.key === selectedKey()" [attr.aria-pressed]="c.key === selectedKey()" [appTip]="c.readLine" (click)="jumpTo(c.key)">
                        @if (c.champion) { <img class="film-costliest-tile" [src]="ui.championIconUrl(c.champion)" alt="" loading="lazy" /> }
                        <span class="film-costliest-who">{{ c.name || c.seat }}</span>
                        <span class="film-tape-min">{{ c.minute }} min</span>
                        @if (c.cost !== undefined) { <b class="film-costliest-cost">{{ signed(c.cost) }}</b> }
                      </button>
                    }
                  </div>
                </div>
              }

              @if (table()) {
                <div class="games-scroll film-map-table">
                  <table class="game-review-ledger-table">
                    <thead>
                      <tr><th scope="col" class="num">Min</th><th scope="col">Who</th><th scope="col">Where</th><th scope="col">How</th><th scope="col">Read</th><th scope="col">Could have been stopped by</th></tr>
                    </thead>
                    <tbody>
                      @for (d of map.pins; track d.key) {
                        <tr [class.is-selected]="d.key === selectedKey()" [appTip]="d.readLine" (click)="jumpTo(d.key)">
                          <td class="num">{{ d.minute }}</td>
                          <td>@if (d.champion) { <img class="player-mark" [src]="ui.championIconUrl(d.champion)" alt="" loading="lazy" /> }{{ d.name || d.seat }} @if (d.name) { <small class="muted">{{ d.seat }}</small> }</td>
                          <td>{{ zone(d.zone) }}</td>
                          <td>{{ how(d.how) }}</td>
                          <td><span [class]="'film-read-badge is-read-' + d.read"><app-film-glyph [name]="readLabels[d.read].icon" />{{ readLabels[d.read].label }}</span></td>
                          <td>
                            @if (d.could.length) {
                              @for (c of d.could; track c) {
                                <span [class]="'could-chip is-' + c"><app-film-glyph [name]="couldGlyphs[c]" />{{ couldLabels[c].label }}</span>
                              }
                            } @else { <span class="muted">Nothing</span> }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <!-- Keyed on the death so a new one remounts the card: its drop and the scene's entrance play again for every death walked to. -->
                @for (p of shownPin(); track p.key) {
                  <article class="film-death-card" [attr.data-read]="p.read">
                    <header class="film-death-head">
                      @if (p.champion) { <img class="film-death-icon" [src]="ui.championIconUrl(p.champion)" alt="" loading="lazy" /> }
                      <span class="film-death-who">
                        <b>{{ p.name || p.seat }}</b>
                        <small>{{ p.name ? p.seat + ' · ' : '' }}{{ p.champion ? ui.championName(p.champion) : '' }}</small>
                      </span>
                      <span class="film-death-meta">
                        <span class="film-tape-min">{{ p.minute }} min</span>
                        <span class="film-death-how">{{ how(p.how) }}</span>
                        <span class="film-death-zone">{{ zone(p.zone) }}</span>
                      </span>
                      <span class="film-death-n">{{ cursor() + 1 }} / {{ map.pins.length }}</span>
                    </header>

                    <span [class]="'film-read-badge is-read-' + p.read" [appTip]="readLabels[p.read].tip"><app-film-glyph [name]="readLabels[p.read].icon" />{{ readLabels[p.read].label }}</span>

                    <app-death-scene [scene]="p.scene" [read]="p.read" [champion]="p.champion" [name]="p.name" [active]="true" [label]="p.readLine" />

                    <p class="film-death-line" [class.is-ok]="p.read === 'bought'" [class.is-warn]="p.read === 'avoidable'">{{ p.readLine }}</p>
                    @if (cost(p); as c) { <p class="film-death-cost">{{ c }}</p> }
                    @if (p.line && p.line !== p.readLine) { <p class="film-death-ledger muted">{{ p.line }}</p> }
                    @if (p.could.length) {
                      <div class="film-death-tags" aria-label="What was missing">
                        @for (c of p.could; track c) {
                          <span [class]="'could-chip is-' + c" [appTip]="couldLabels[c].tip"><app-film-glyph [name]="couldGlyphs[c]" />{{ couldLabels[c].label }}</span>
                        }
                      </div>
                    }

                    <div class="film-notes film-death-notes">
                      @if (note(); as n) {
                        <p class="film-note"><span class="film-initial">{{ initials(n.by) }}</span>{{ n.text }}</p>
                      }
                      @if (auth.canEdit()) {
                        @if (noteOpen()) {
                          <form class="film-note-form" (submit)="saveNote($event, p)">
                            <label class="visually-hidden" for="filmDeathNote">A note on this death</label>
                            <input id="filmDeathNote" type="text" maxlength="200" placeholder="One line for the team" [ngModel]="noteText()" (ngModelChange)="noteText.set($event)" name="filmDeathNote" autocomplete="off" />
                            <button type="submit" class="view-btn active" [disabled]="!noteText().trim()">Save</button>
                            <button type="button" class="view-btn" (click)="noteOpen.set(false)">Cancel</button>
                          </form>
                        } @else {
                          <button type="button" class="view-btn" (click)="openNote()"><span class="material-symbols-rounded" aria-hidden="true">edit_note</span> {{ note() ? 'Change the note' : 'Add a note' }}</button>
                        }
                      }
                    </div>

                    <div class="film-death-actions">
                      <button type="button" class="view-btn" [disabled]="cursor() === 0" (click)="step(-1)"><span class="material-symbols-rounded" aria-hidden="true">arrow_back</span> Previous</button>
                      <button type="button" class="view-btn active" [disabled]="cursor() >= map.pins.length - 1" (click)="step(1)">{{ voice().nextDeath }} <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span></button>
                      <button type="button" class="view-btn" [appTip]="'Open the tape twenty seconds before this death'" (click)="watch.emit(p.sec)"><span class="material-symbols-rounded" aria-hidden="true">play_circle</span> {{ voice().watchIt }}</button>
                    </div>
                  </article>
                }
              }
            } @else {
              <p class="film-wait">Nobody died. Keep doing that.</p>
            }
          </div>
        </div>
      } @else {
        <p class="film-wait">No death ledger for this game, so there is no map.</p>
      }
    </app-film-frame>
  `
})
export class FilmMapComponent {
  readonly model = input.required<FilmModel>();
  readonly kicker = input<string>('The map');
  readonly index = input<number>(2);
  readonly count = input<number>(1);
  /** Bumped by the page on Escape: the table and the note form fold. */
  readonly closeTick = input<number>(0);
  /** Watch it: the second of the death, for the page to hand the tape. */
  readonly watch = output<number>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  private readonly motion = inject(MotionService);
  private readonly data = inject(TeamDataService);
  private readonly openingNum = viewChild<ElementRef<HTMLElement>>('openingNum');

  protected readonly readLabels = READ_LABELS;
  protected readonly couldLabels = COULD_LABELS;
  protected readonly couldGlyphs = COULD_GLYPHS;
  /** The chrome's strings for this film: Next death, Watch it. Never the ledger's words. */
  protected readonly voice = computed(() => voiceOf(this.model().style));

  protected readonly cursor = signal(0);
  protected readonly readFilter = signal<DeathReadKind | 'all'>('all');
  protected readonly table = signal(false);
  protected readonly noteOpen = signal(false);
  protected readonly noteText = signal('');
  /** The game on the map; a string, so the walk below restarts only for another game and never for a rebuilt model of this one. */
  private readonly matchId = computed(() => this.model().matchId);

  /** The opening line split so its count can count up: "11" and " deaths: 6 avoidable, …"; "No deaths." has no count. */
  protected readonly opening = computed<{ count: string | null; rest: string }>(() => {
    const line = this.model().map?.opening ?? '';
    const m = /^(\d+)([\s\S]*)$/.exec(line);
    return m ? { count: m[1], rest: m[2] } : { count: null, rest: line };
  });
  /** The reads that have a death, in the reads' own order. */
  protected readonly readsPresent = computed<DeathReadKind[]>(() => {
    const reads = this.model().map?.reads;
    return reads ? DEATH_READS.filter((r) => reads[r] > 0) : [];
  });
  /** The pins behind `map.costliest`, in its order. */
  protected readonly costliest = computed<FilmDeathPin[]>(() => {
    const map = this.model().map;
    if (!map) return [];
    return map.costliest.map((key) => map.pins.find((p) => p.key === key)).filter((p): p is FilmDeathPin => !!p);
  });
  protected readonly pin = computed<FilmDeathPin | undefined>(() => this.model().map?.pins[this.cursor()]);
  /** The pin on the card as a one-item list, so the template can key the card on it. */
  protected readonly shownPin = computed<FilmDeathPin[]>(() => {
    const p = this.pin();
    return p ? [p] : [];
  });
  protected readonly selectedKey = computed(() => this.pin()?.key ?? null);
  protected readonly note = computed<FilmNote | undefined>(() => {
    const key = this.pin()?.key;
    return key ? this.data.notesFor(this.model().matchId)?.notes[key] : undefined;
  });

  constructor() {
    effect(() => {
      this.closeTick();
      this.table.set(false);
      this.noteOpen.set(false);
    });

    // A new death on the card starts with the note form closed.
    effect(() => {
      this.cursor();
      untracked(() => this.noteOpen.set(false));
    });

    // A new game in the same component (the title card links film to film and the page is reused): the walk starts
    // over from the first death with every read lit, rather than standing on the last film's index (10 Sep 2026).
    effect(() => {
      this.matchId();
      untracked(() => {
        this.cursor.set(0);
        this.readFilter.set('all');
        this.table.set(false);
      });
    });

    // The opening count counts up as the chapter shows.
    afterRenderEffect((onCleanup) => {
      const el = this.openingNum()?.nativeElement;
      if (!el) return;
      untracked(() => onCleanup(countText(this.motion, el, 900)));
    });
  }

  /** One read at a time on the legend; the same read again is All. */
  protected toggleRead(r: DeathReadKind): void {
    this.readFilter.set(this.readFilter() === r ? 'all' : r);
  }

  protected cost(p: FilmDeathPin): string {
    return costLine(p.cost);
  }

  protected signed(gold: number): string {
    return signedK(gold);
  }

  protected step(dir: 1 | -1): void {
    const n = this.model().map?.pins.length ?? 0;
    this.cursor.set(Math.min(Math.max(this.cursor() + dir, 0), Math.max(0, n - 1)));
  }

  /** A pin tapped on the map, a costliest card, or a row in the table: the card jumps to it. */
  protected jumpTo(key: string): void {
    const i = this.model().map?.pins.findIndex((p) => p.key === key) ?? -1;
    if (i < 0) return;
    this.cursor.set(i);
    this.table.set(false);
  }

  protected openNote(): void {
    this.noteText.set(this.note()?.text ?? '');
    this.noteOpen.set(true);
  }

  protected saveNote(event: Event, p: FilmDeathPin): void {
    event.preventDefault();
    const text = this.noteText().trim();
    if (!text) return;
    void this.data.saveFilmNote(this.model().matchId, p.key, text);
    this.noteText.set('');
    this.noteOpen.set(false);
  }

  protected initials(key: string): string {
    return initialsOf(key);
  }

  protected how(h: DeathHow): string {
    return HOW_LABELS[h] ?? h;
  }

  protected zone(z: MapZone): string {
    return ZONE_LABELS[z] ?? z;
  }
}
