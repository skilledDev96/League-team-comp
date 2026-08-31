import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Scrim, ScrimPlayer } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { looksLikeFiveOnFive, matchIdFromFilename, parseReplay } from '../../core/replay-parse';

/**
 * Scrims, imported from replay files.
 *
 * Custom games never enter the Riot API — queueId 0 never appears in a match
 * list and `matches/{id}` answers 404 even when the id is known — so before
 * this, every scrim the team played was invisible to the app. Scrims are where
 * they actually practise for the tournament, which made it the largest hole in
 * the data.
 *
 * A page of its own rather than a corner of Tournaments: a scrim has no
 * bracket, no best-of and no fearless burn, and filing one as a series meant
 * inventing all three. Using the tournament screens as a scrim harness is what
 * this replaces.
 *
 * Everything is parsed in the browser. The file never leaves the machine, and
 * only the scoreboard is stored — a twenty-megabyte replay reduces to about a
 * kilobyte of counters.
 */
@Component({
  selector: 'app-scrims',
  imports: [FormsModule, TooltipDirective],
  templateUrl: './scrims.component.html'
})
export class ScrimsComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);

  protected readonly importing = signal(false);
  protected readonly importNote = signal('');
  /** Files that produced nothing, so a silent skip is still reported. */
  protected readonly skipped = signal<string[]>([]);

  protected readonly openId = signal<string>('');

  /** Newest first: a scrim is read the evening it was played, not in order. */
  protected readonly scrims = computed(() =>
    [...this.data.scrims()].sort((a, b) => (b.playedOn ?? '').localeCompare(a.playedOn ?? ''))
  );

  protected toggle(id: string): void {
    this.openId.set(this.openId() === id ? '' : id);
  }

  /**
   * Our roster, by Riot ID, for spotting which side is ours.
   *
   * Matching on the Riot ID rather than the champion, because both teams pick
   * from the same pool and a scrim against a team that mirrors a pick would put
   * us on both sides.
   */
  private readonly ourIds = computed(() => {
    const ids = new Set<string>();
    for (const player of this.data.players()) {
      const tag = player.profile?.riotTag?.replace(/^#/, '') ?? '';
      if (player.name) ids.add(`${player.name}#${tag}`.toLowerCase());
    }
    return ids;
  });

  /** Which side we were on: stored if someone said, else read off the roster. */
  protected ourSide(scrim: Scrim): 'blue' | 'red' | null {
    if (scrim.ourSide) return scrim.ourSide;

    const ours = this.ourIds();
    const mine = (team: number) =>
      scrim.players.filter((p) => p.team === team && ours.has(`${p.name}#${p.tag}`.toLowerCase())).length;

    const blue = mine(100);
    const red = mine(200);
    if (blue === red) return null; // A tie is not an answer; leave it unsaid.
    return blue > red ? 'blue' : 'red';
  }

  protected won(scrim: Scrim): boolean | null {
    const side = this.ourSide(scrim);
    if (!side) return null;
    return side === 'blue' ? scrim.blueWon : !scrim.blueWon;
  }

  protected side(scrim: Scrim, team: 100 | 200): ScrimPlayer[] {
    return scrim.players.filter((p) => p.team === team);
  }

  protected isOurs(player: ScrimPlayer): boolean {
    return this.ourIds().has(`${player.name}#${player.tag}`.toLowerCase());
  }

  protected duration(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  protected kda(p: ScrimPlayer): string {
    return `${p.kills}/${p.deaths}/${p.assists}`;
  }

  /** Thousands, since raw damage numbers are five digits and unreadable. */
  protected k(value: number): string {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
  }

  protected setOpponent(scrim: Scrim, opponent: string): void {
    void this.data.saveScrim({ ...scrim, opponent });
  }

  protected setNote(scrim: Scrim, note: string): void {
    void this.data.saveScrim({ ...scrim, note });
  }

  protected async remove(scrim: Scrim): Promise<void> {
    if (!confirm(`Remove the scrim ${scrim.id}?`)) return;
    await this.data.deleteScrim(scrim.id);
  }

  /**
   * Read dropped or chosen replay files.
   *
   * Sequential and awaited rather than fired in parallel: each file is twenty
   * megabytes, and reading ten at once is how a browser tab runs out of memory
   * on a laptop. Anything unreadable is named rather than dropped in silence,
   * because a folder always has a stray file in it and "nothing happened" is
   * the worst possible answer to a drag-and-drop.
   */
  protected async importFiles(files: FileList | null): Promise<void> {
    if (!files?.length || this.importing()) return;

    this.importing.set(true);
    this.skipped.set([]);
    const failed: string[] = [];
    let saved = 0;

    try {
      for (const file of Array.from(files)) {
        this.importNote.set(`Reading ${file.name}…`);

        const id = matchIdFromFilename(file.name);
        if (!id) {
          failed.push(`${file.name} — no match id in the filename`);
          continue;
        }

        const game = parseReplay(await file.arrayBuffer());
        if (!game) {
          failed.push(`${file.name} — not a readable replay`);
          continue;
        }
        if (!looksLikeFiveOnFive(game)) {
          failed.push(`${file.name} — not a full 5v5`);
          continue;
        }

        await this.data.saveScrim({
          id,
          // The replay knows how long the game ran but never when it started,
          // so the file's own timestamp is the closest thing to a date. It is
          // a few minutes late, which matters to nobody.
          playedOn: new Date(file.lastModified).toISOString(),
          durationSec: game.durationSec,
          blueWon: game.blueWon,
          surrendered: game.surrendered,
          players: game.players.map((p) => ({ ...p })),
          order: this.data.scrims().length + saved
        });
        saved += 1;
      }
    } finally {
      this.importing.set(false);
      this.importNote.set(
        saved ? `Imported ${saved} ${saved === 1 ? 'scrim' : 'scrims'}.` : 'Nothing imported.'
      );
      this.skipped.set(failed);
    }
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    void this.importFiles(event.dataTransfer?.files ?? null);
  }

  protected readonly dragging = signal(false);

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }
}
