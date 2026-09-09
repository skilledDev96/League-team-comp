import { afterRenderEffect, Component, computed, effect, ElementRef, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FilmDeathPin, FilmModel } from '../../../core/film-model';
import { initialsOf } from '../../../core/initials';
import { COULD_LABELS, HOW_LABELS, ZONE_LABELS } from '../../../core/review-view';
import { DeathCould, DeathHow, FilmNote, MapZone } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { MotionService } from '../../../services/motion.service';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { countText } from '../../../shared/film/film-count';
import { RiftMapComponent } from '../../../shared/film/rift-map.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmFrameComponent } from '../film-frame.component';

/** The tags in bit order: jungle 1, ward 2, call 4, position 8. A call on a death is stored as the mask of what was picked. */
export const COULD_ORDER: readonly DeathCould[] = ['jungle', 'ward', 'call', 'position'];

export function couldMask(tags: Iterable<DeathCould>): number {
  let mask = 0;
  for (const tag of tags) {
    const i = COULD_ORDER.indexOf(tag);
    if (i >= 0) mask |= 1 << i;
  }
  return mask;
}

/** The progress key the opener's count is stored under. */
const DARK_KEY = 'map:dark';

/**
 * The map (9 Sep 2026): every death of ours on the Rift where the timeline
 * put it, theirs as dots and the fights as blobs. It opens on one count the
 * reader has to guess (how many fell with no ward nearby) before a pin is
 * shown; then the pins drop in the film's order and the chapter walks them.
 * Each death is a card beside the map with the call "What would have
 * stopped this?" over the four tags; Reveal lights the right ones, shows
 * the ledger's line, and puts the tags on the pin as badges. A tap on a
 * pin jumps to it, the filters light every pin that shares a tag, Watch it
 * takes the tape to twenty seconds before, As a table is the ledger the
 * panel used to carry, and an editor can leave one line on a death. The
 * tally in the corner counts what has been read and called right. Nothing
 * on the map drags, and every position is approximate by zone.
 */
@Component({
  selector: 'app-film-map',
  imports: [FormsModule, TooltipDirective, FilmFrameComponent, RiftMapComponent],
  template: `
    @let map = model().map;
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      @if (map) {
        <div class="film-map" [class.is-open]="darkRevealed()">
          <div class="film-map-stage">
            <app-rift-map
              [pins]="shownPins()"
              [theirs]="darkRevealed() ? map.theirs : []"
              [clusters]="darkRevealed() ? map.clusters : []"
              [until]="null"
              [selected]="selectedKey()"
              [filter]="filter()"
              [unreadKeys]="unreadKeys()"
              [dim]="!darkRevealed()"
              (pick)="jumpTo($event)"
            >
              <span caption>Positions are approximate: one frame a minute, placed inside the zone the frame put them in.</span>
            </app-rift-map>
            @if (darkRevealed() && map.pins.length) {
              <span class="film-map-tally" [appTip]="'Deaths you have called on this map, and how many you called right'">{{ tally().read }} of {{ map.pins.length }} read, {{ tally().right }} called right</span>
            }
          </div>

          <div class="film-map-side">
            @if (!darkRevealed()) {
              <div class="film-call film-map-opener">
                <p class="film-call-q">How many of our {{ map.darkCall.max }} {{ map.darkCall.max === 1 ? 'death' : 'deaths' }} had no ward nearby?</p>
                <label class="film-map-range">
                  <span class="visually-hidden">Your count</span>
                  <input type="range" min="0" [max]="map.darkCall.max" step="1" [value]="darkGuess()" (input)="darkGuess.set(+$any($event.target).value)" />
                  <b class="film-map-range-n">{{ darkGuess() }}</b>
                </label>
                <button type="button" class="view-btn active" (click)="lockDark()"><span class="material-symbols-rounded" aria-hidden="true">lock</span> Lock</button>
              </div>
            } @else {
              @if (darkVerdict(); as v) {
                <p class="film-map-dark" [class.is-ok]="v.close">
                  <b #darkNum class="film-num" [attr.data-count]="map.darkCall.answer"></b>
                  <span>of {{ map.darkCall.max }} with no ward nearby. {{ v.text }}</span>
                </p>
              }

              @if (map.pins.length) {
                <div class="film-map-filters" role="group" aria-label="Light the deaths by what would have stopped them">
                  <button type="button" class="view-btn" [class.active]="filter() === 'all'" [attr.aria-pressed]="filter() === 'all'" (click)="filter.set('all')">All <small>{{ map.pins.length }}</small></button>
                  @for (tag of couldOrder; track tag) {
                    <button type="button" class="view-btn" [class.active]="filter() === tag" [attr.aria-pressed]="filter() === tag" [attr.aria-label]="couldLabels[tag].label + ', ' + counts()[tag]" [appTip]="couldLabels[tag].tip" (click)="filter.set(filter() === tag ? 'all' : tag)">
                      <span class="material-symbols-rounded" aria-hidden="true">{{ couldLabels[tag].icon }}</span><span class="film-map-filter-word">{{ couldLabels[tag].label }}</span> <small>{{ counts()[tag] }}</small>
                    </button>
                  }
                  <button type="button" class="view-btn film-map-table-btn" [class.active]="table()" [attr.aria-pressed]="table()" (click)="table.set(!table())"><span class="material-symbols-rounded" aria-hidden="true">table_rows</span> As a table</button>
                </div>

                @if (table()) {
                  <div class="games-scroll film-map-table">
                    <table class="game-review-ledger-table">
                      <thead>
                        <tr><th scope="col" class="num">Min</th><th scope="col">Who</th><th scope="col">Where</th><th scope="col">How</th><th scope="col">Could have been stopped by</th></tr>
                      </thead>
                      <tbody>
                        @for (d of map.pins; track d.key) {
                          <tr [class.is-selected]="d.key === selectedKey()" [appTip]="isRead(d.key) ? d.line : 'Call it on the map first'" (click)="jumpTo(d.key)">
                            <td class="num">{{ d.minute }}</td>
                            <td>@if (d.champion) { <img class="player-mark" [src]="ui.championIconUrl(d.champion)" alt="" loading="lazy" /> }{{ d.name || d.seat }} @if (d.name) { <small class="muted">{{ d.seat }}</small> }</td>
                            <td>{{ zone(d.zone) }}</td>
                            <td>{{ how(d.how) }}</td>
                            <td>
                              @if (!isRead(d.key)) {
                                <span class="muted">Not called yet</span>
                              } @else if (d.could.length) {
                                @for (c of d.could; track c) {
                                  <span [class]="'could-chip is-' + c"><span class="material-symbols-rounded" aria-hidden="true">{{ couldLabels[c].icon }}</span>{{ couldLabels[c].label }}</span>
                                }
                              } @else { <span class="muted">Nothing</span> }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else if (pin(); as p) {
                  <article class="film-death-card" [class.is-read]="isRead(p.key)">
                    <header class="film-death-head">
                      @if (p.champion) { <img class="film-death-icon" [src]="ui.championIconUrl(p.champion)" alt="" loading="lazy" /> }
                      <span class="film-death-who">
                        <b>{{ p.name || p.seat }}</b>
                        <small>{{ p.name ? p.seat + ' · ' : '' }}{{ p.champion || '' }}</small>
                      </span>
                      <span class="film-death-meta">
                        <span class="film-tape-min">{{ p.minute }} min</span>
                        <span class="film-death-how">{{ how(p.how) }}</span>
                        <span class="film-death-zone">{{ zone(p.zone) }}</span>
                      </span>
                      <span class="film-death-n">{{ cursor() + 1 }} / {{ map.pins.length }}</span>
                    </header>

                    <div class="film-call" [class.is-done]="isRead(p.key)">
                      <p class="film-call-q film-death-q">What would have stopped this?</p>
                      <div class="film-chips" role="group" aria-label="What would have stopped this?">
                        @for (tag of couldOrder; track tag; let i = $index) {
                          <button
                            type="button"
                            class="film-chip"
                            [style.--i]="i"
                            [class.is-picked]="picks().has(tag)"
                            [class.is-right]="isRead(p.key) && p.could.includes(tag)"
                            [class.is-wrong]="isRead(p.key) && pickedMask(p.key) !== null && hasBit(pickedMask(p.key)!, tag) && !p.could.includes(tag)"
                            [class.is-missed]="isRead(p.key) && pickedMask(p.key) !== null && !hasBit(pickedMask(p.key)!, tag) && p.could.includes(tag)"
                            [disabled]="isRead(p.key)"
                            [attr.aria-pressed]="isRead(p.key) ? null : picks().has(tag)"
                            [appTip]="couldLabels[tag].tip"
                            (click)="togglePick(tag)"
                          >
                            <span class="material-symbols-rounded" aria-hidden="true">{{ couldLabels[tag].icon }}</span>{{ couldLabels[tag].label }}
                          </button>
                        }
                      </div>
                      @if (!isRead(p.key)) {
                        <p class="film-death-hint">Pick any that apply, or none, then reveal.</p>
                        <button type="button" class="view-btn active" (click)="reveal(p)"><span class="material-symbols-rounded" aria-hidden="true">visibility</span> Reveal</button>
                      } @else {
                        <p class="film-call-why film-death-line" [class.is-ok]="calledRight(p)">
                          @if (pickedMask(p.key) !== null) { <b>{{ calledRight(p) ? 'Called it. ' : '' }}</b> }
                          {{ p.could.length ? p.line : 'Nothing on the map would have stopped this one; sometimes they just play it well.' }}
                        </p>
                      }
                    </div>

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
                      <button type="button" class="view-btn" [class.active]="isRead(p.key)" [disabled]="cursor() >= map.pins.length - 1" (click)="step(1)">Next death <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span></button>
                      <button type="button" class="view-btn" [appTip]="'Open the tape twenty seconds before this death'" (click)="watch.emit(p.sec)"><span class="material-symbols-rounded" aria-hidden="true">play_circle</span> Watch it</button>
                    </div>
                  </article>
                }
              } @else {
                <p class="film-wait">Nobody died. Keep doing that.</p>
              }
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
  /** Every call made in the film: the opener's count under "map:dark", each death under "map:<key>" as the mask of tags picked. */
  readonly calls = input<Record<string, number> | undefined>(undefined);
  readonly answered = output<{ key: string; choice: number }>();
  /** Watch it: the second of the death, for the page to hand the tape. */
  readonly watch = output<number>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  private readonly motion = inject(MotionService);
  private readonly data = inject(TeamDataService);
  private readonly darkNum = viewChild<ElementRef<HTMLElement>>('darkNum');

  protected readonly couldOrder = COULD_ORDER;
  protected readonly couldLabels = COULD_LABELS;

  protected readonly darkGuess = signal(0);
  private readonly darkLocked = signal<number | null>(null);
  protected readonly cursor = signal(0);
  protected readonly picks = signal<ReadonlySet<DeathCould>>(new Set());
  /** Calls made this visit, mirrored so the card reveals before the progress comes back. */
  private readonly revealedNow = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly filter = signal<DeathCould | 'all'>('all');
  protected readonly table = signal(false);
  protected readonly noteOpen = signal(false);
  protected readonly noteText = signal('');

  private readonly darkAnswered = computed<number | null>(() => this.calls()?.[DARK_KEY] ?? this.darkLocked());
  protected readonly darkRevealed = computed(() => this.darkAnswered() !== null);
  protected readonly darkVerdict = computed(() => {
    const said = this.darkAnswered();
    const map = this.model().map;
    if (said === null || !map) return null;
    const answer = map.darkCall.answer;
    const close = Math.abs(said - answer) <= 1;
    return { close, text: said === answer ? `You said ${said}, and that is the count.` : `You said ${said}.` };
  });

  protected readonly pin = computed<FilmDeathPin | undefined>(() => this.model().map?.pins[this.cursor()]);
  protected readonly selectedKey = computed(() => (this.darkRevealed() ? (this.pin()?.key ?? null) : null));
  /** A pin not yet called carries neither its tags nor its line onto the map, so a tap or a badge cannot give the call away. */
  protected readonly shownPins = computed<FilmDeathPin[]>(() => {
    const map = this.model().map;
    if (!map || !this.darkRevealed()) return [];
    return map.pins.map((p) => (this.isRead(p.key) ? p : { ...p, could: [], line: '' }));
  });
  /** The pins not yet called, for the map to draw hollow and keep out of the filters. */
  protected readonly unreadKeys = computed<string[]>(() => (this.model().map?.pins ?? []).filter((p) => !this.isRead(p.key)).map((p) => p.key));
  protected readonly counts = computed<Record<DeathCould, number>>(() => {
    const pins = this.model().map?.pins ?? [];
    const out = { jungle: 0, ward: 0, call: 0, position: 0 };
    for (const p of pins) for (const tag of p.could) out[tag]++;
    return out;
  });
  protected readonly tally = computed(() => {
    const pins = this.model().map?.pins ?? [];
    let read = 0;
    let right = 0;
    for (const p of pins) {
      const mask = this.pickedMask(p.key);
      if (mask === null) continue;
      read++;
      if (mask === couldMask(p.could)) right++;
    }
    return { read, right };
  });
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

    // A new death on the card starts with nothing picked and the note form closed.
    effect(() => {
      this.cursor();
      untracked(() => {
        this.picks.set(new Set());
        this.noteOpen.set(false);
      });
    });

    // The answer counts up once the count is locked; the span remounts with the reveal.
    afterRenderEffect((onCleanup) => {
      const el = this.darkNum()?.nativeElement;
      if (!el) return;
      untracked(() => onCleanup(countText(this.motion, el, 900)));
    });
  }

  protected lockDark(): void {
    if (this.darkRevealed()) return;
    const n = this.darkGuess();
    this.darkLocked.set(n);
    this.answered.emit({ key: DARK_KEY, choice: n });
  }

  /** The mask stored for a death, from the progress or this visit; null until it is called. */
  protected pickedMask(key: string): number | null {
    return this.calls()?.['map:' + key] ?? this.revealedNow().get(key) ?? null;
  }

  protected isRead(key: string): boolean {
    return this.pickedMask(key) !== null;
  }

  protected hasBit(mask: number, tag: DeathCould): boolean {
    return (mask & (1 << COULD_ORDER.indexOf(tag))) !== 0;
  }

  protected calledRight(p: FilmDeathPin): boolean {
    return this.pickedMask(p.key) === couldMask(p.could);
  }

  protected togglePick(tag: DeathCould): void {
    const p = this.pin();
    if (!p || this.isRead(p.key)) return;
    const next = new Set(this.picks());
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    this.picks.set(next);
  }

  protected reveal(p: FilmDeathPin): void {
    if (this.isRead(p.key)) return;
    const mask = couldMask(this.picks());
    this.revealedNow.set(new Map([...this.revealedNow(), [p.key, mask]]));
    this.answered.emit({ key: 'map:' + p.key, choice: mask });
  }

  protected step(dir: 1 | -1): void {
    const n = this.model().map?.pins.length ?? 0;
    this.cursor.set(Math.min(Math.max(this.cursor() + dir, 0), Math.max(0, n - 1)));
  }

  /** A pin tapped on the map, or a row in the table: the card jumps to it. */
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
