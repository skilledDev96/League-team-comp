import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FilmModel } from '../../../core/film-model';
import { evidenceChips } from '../../../core/review-view';
import { normalizeEmail } from '../../../core/access';
import { FilmChoice, FilmNote } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { TeamDataService } from '../../../services/team-data.service';
import { UserPrefsService } from '../../../services/user-prefs.service';
import { initialsOf } from '../../../core/initials';
import { FilmFrameComponent, themeIcon, themeLabel } from '../film-frame.component';

/**
 * The one thing (9 Sep 2026): the first work-on alone with its theme faint
 * behind it, then the commitment the team owns. Two cards when the sentence
 * offers a choice, one Commit card when it does not; an editor's tap writes
 * the team's document and a viewer's pick stays their own. The other points
 * follow as cards that open on tap, and one line of team notes sits under
 * the point, keyed "w:0" in the film's notes.
 */
@Component({
  selector: 'app-film-one-thing',
  imports: [FormsModule, FilmFrameComponent],
  template: `
    @let one = model().oneThing;
    @let p = one.point;
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      <div class="film-point" [class.is-blank]="!p.text">
        <span class="film-point-ghost material-symbols-rounded" aria-hidden="true">{{ icon(p.theme) }}</span>
        <p class="film-point-kicker">
          @if (p.theme) { <span class="material-symbols-rounded" aria-hidden="true">{{ icon(p.theme) }}</span>{{ label(p.theme) }} }
          @if (timed() && p.minute !== null) { <span class="review-minute">{{ p.minute }} min</span> }
        </p>
        <p class="film-point-text">{{ p.text || 'The review left no work-on for the team.' }}</p>
        @if (chips(p.evidence).length) {
          <span class="evidence-chips">
            @for (c of chips(p.evidence); track $index) { <span class="evidence-chip">{{ c }}</span> }
          </span>
        }
      </div>

      @if (p.text) {
        <div class="film-commit">
          <p class="film-commit-q">Which do we commit to next game?</p>
          <div class="film-commit-cards" [class.is-single]="!one.options">
            @if (one.options; as opts) {
              @for (opt of opts; track $index) {
                @let choice = $index === 0 ? 'a' : 'b';
                <button type="button" class="film-commit-card" [class.is-mine]="mine() === choice" [class.is-team]="team() === choice" [attr.aria-pressed]="mine() === choice" (click)="choose(choice)">
                  <span class="film-commit-letter">{{ $index === 0 ? 'A' : 'B' }}</span>
                  <span class="film-commit-text">{{ opt }}</span>
                  <span class="film-initials">
                    @for (ini of initialsFor(choice); track ini) { <span class="film-initial">{{ ini }}</span> }
                  </span>
                </button>
              }
            } @else {
              <button type="button" class="film-commit-card" [class.is-mine]="mine() === 'commit'" [class.is-team]="team() === 'commit'" [attr.aria-pressed]="mine() === 'commit'" (click)="choose('commit')">
                <span class="film-commit-letter"><span class="material-symbols-rounded" aria-hidden="true">handshake</span></span>
                <span class="film-commit-text">Commit</span>
                <span class="film-initials">
                  @for (ini of initialsFor('commit'); track ini) { <span class="film-initial">{{ ini }}</span> }
                </span>
              </button>
            }
          </div>
          @if (team(); as tc) {
            <p class="film-commit-line">The team committed to {{ tc === 'commit' ? 'it' : tc.toUpperCase() }}.</p>
          } @else if (mine()) {
            <p class="film-commit-line">Your pick is in; the team's stands once an editor picks.</p>
          }
        </div>

        <div class="film-notes">
          @for (n of notes(); track n.at) {
            <p class="film-note"><span class="film-initial">{{ initials(n.by) }}</span>{{ n.text }}</p>
          }
          @if (auth.canEdit()) {
            @if (noteOpen()) {
              <form class="film-note-form" (submit)="saveNote($event)">
                <label class="visually-hidden" for="filmNote">A note for the team</label>
                <input id="filmNote" type="text" maxlength="200" placeholder="One line for the team" [ngModel]="noteText()" (ngModelChange)="noteText.set($event)" name="filmNote" autocomplete="off" />
                <button type="submit" class="view-btn active" [disabled]="!noteText().trim()">Save</button>
                <button type="button" class="view-btn" (click)="noteOpen.set(false)">Cancel</button>
              </form>
            } @else {
              <button type="button" class="view-btn" (click)="noteOpen.set(true)"><span class="material-symbols-rounded" aria-hidden="true">edit_note</span> Add a note</button>
            }
          }
        </div>
      }

      @if (one.rest.length) {
        <div class="film-rest">
          <div class="film-rest-head">
            <p class="film-rest-kicker">The rest</p>
            <button type="button" class="view-btn" (click)="toggleAll()">{{ allOpen() ? 'Fold all' : 'Show all' }}</button>
          </div>
          <ul class="list-clean film-rest-cards">
            @for (r of one.rest; track $index) {
              <li>
                <button type="button" class="film-rest-card" [class.is-warn]="r.kind === 'workOn'" [class.is-ok]="r.kind === 'keepDoing'" [class.is-open]="isOpen($index)" [attr.aria-expanded]="isOpen($index)" (click)="toggle($index)">
                  <span class="film-rest-tag">
                    <span class="material-symbols-rounded" aria-hidden="true">{{ r.kind === 'workOn' ? 'build' : 'check_circle' }}</span>
                    {{ r.kind === 'workOn' ? 'Work on' : 'Keep doing' }}
                    @if (r.point.theme) { <em>· {{ label(r.point.theme) }}</em> }
                    @if (timed() && r.point.minute !== null) { <span class="review-minute">{{ r.point.minute }} min</span> }
                  </span>
                  <span class="film-rest-text">{{ r.point.text }}</span>
                  @if (isOpen($index) && chips(r.point.evidence).length) {
                    <span class="evidence-chips">
                      @for (c of chips(r.point.evidence); track $index) { <span class="evidence-chip">{{ c }}</span> }
                    </span>
                  }
                </button>
              </li>
            }
          </ul>
        </div>
      }
    </app-film-frame>
  `
})
export class FilmOneThingComponent {
  readonly model = input.required<FilmModel>();
  readonly kicker = input<string>('The one thing');
  readonly index = input<number>(1);
  readonly count = input<number>(1);
  /** Bumped by the page on Escape: every open card folds. */
  readonly closeTick = input<number>(0);
  /** A viewer's own pick, when they cannot write the team's; from their progress. */
  readonly ownChoice = input<FilmChoice | undefined>(undefined);
  /** A viewer chose: the page keeps it in their progress. */
  readonly chosen = output<FilmChoice>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly auth = inject(AuthService);
  private readonly data = inject(TeamDataService);
  private readonly prefs = inject(UserPrefsService);

  private readonly open = signal<ReadonlySet<number>>(new Set());
  protected readonly noteOpen = signal(false);
  protected readonly noteText = signal('');

  protected readonly timed = computed(() => this.model().tier === 'timeline');
  protected readonly commitment = computed(() => this.data.commitmentFor(this.model().matchId));
  protected readonly team = computed<FilmChoice | undefined>(() => {
    const c = this.commitment();
    return c && Object.keys(c.by).length ? this.data.teamChoice(c) : undefined;
  });
  /** What I picked: the team document for an editor, my own progress for a viewer. */
  protected readonly mine = computed<FilmChoice | undefined>(() => {
    if (this.auth.canEdit()) return this.commitment()?.by[this.emailKey()];
    return this.ownChoice() ?? this.prefs.filmProgress(this.model().matchId)?.choice;
  });
  protected readonly notes = computed<FilmNote[]>(() => {
    const all = this.data.notesFor(this.model().matchId)?.notes ?? {};
    return Object.entries(all)
      .filter(([key]) => key.startsWith('w:'))
      .map(([, n]) => n)
      .sort((a, b) => a.at.localeCompare(b.at));
  });
  protected readonly allOpen = computed(() => this.open().size >= this.model().oneThing.rest.length);

  constructor() {
    effect(() => {
      this.closeTick();
      this.open.set(new Set());
      this.noteOpen.set(false);
    });
  }

  private emailKey(): string {
    return normalizeEmail(this.auth.userEmail()) || 'unknown';
  }

  protected initialsFor(choice: FilmChoice): string[] {
    const by = this.commitment()?.by ?? {};
    return Object.entries(by)
      .filter(([, c]) => c === choice)
      .map(([key]) => initialsOf(key));
  }

  protected initials(key: string): string {
    return initialsOf(key);
  }

  protected choose(choice: FilmChoice): void {
    const m = this.model();
    if (this.auth.canEdit()) {
      void this.data.commitTo(m.matchId, m.oneThing.point.text, m.oneThing.options, choice);
    } else {
      this.chosen.emit(choice);
    }
  }

  protected saveNote(event: Event): void {
    event.preventDefault();
    const text = this.noteText().trim();
    if (!text) return;
    // The note is on the first work-on, not a moment: "w:0".
    void this.data.saveFilmNote(this.model().matchId, 'w:0', text);
    this.noteText.set('');
    this.noteOpen.set(false);
  }

  protected isOpen(i: number): boolean {
    return this.open().has(i);
  }

  protected toggle(i: number): void {
    const next = new Set(this.open());
    if (next.has(i)) next.delete(i);
    else next.add(i);
    this.open.set(next);
  }

  protected toggleAll(): void {
    this.open.set(this.allOpen() ? new Set() : new Set(this.model().oneThing.rest.map((_, i) => i)));
  }

  protected chips(evidence: string): string[] {
    return evidenceChips(evidence ?? '');
  }

  protected icon(theme: string | undefined): string {
    return themeIcon(theme);
  }

  protected label(theme: string | undefined): string {
    return themeLabel(theme);
  }
}
