import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { deleteField, doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '../core/firebase';
import { DEFAULT_TEAM_ID, isTeamId } from '../core/team-scope';
import { DepthSurface, FilmPrefs, FilmProgress, Role, UserPrefs } from '../models/team.models';
import { AuthService } from './auth.service';
import { TeamScopeService } from './team-scope.service';

/**
 * What one account has seen: the tours, by version, and since 9 Sep 2026
 * where they are in each film. One document per signed-in email at
 * `userPrefs/{email}` (the rules let a person write only their own), with
 * localStorage as the fallback when there is no backend or the write fails.
 * The old `tourSeen` flag still gets written when the welcome tour finishes,
 * so the e2e setup and older builds keep working.
 *
 * The document is one person's across every team (27 Sep 2026, release 2):
 * it is not team data and does not move. What is a team's inside it is the
 * film room, a seat and a progress per film, and that lives in `film` for
 * Bom Squad, as every document written before this has it, and in
 * `teamFilm[teamId]` for any other team. `filmOf()` is the one door to
 * either, and every reader and writer of the film room goes through it. The
 * document also remembers the team this person last chose (`team`), so a
 * second device lands on it. The `bom-tours:{email}` mirror stays one key
 * per person, unscoped, because it is a copy of this one document and
 * carries `teamFilm` inside it the same way; a copy per team would be several
 * stale copies of the same thing, read once at sign-in for whichever team
 * was active then.
 */
@Injectable({ providedIn: 'root' })
export class UserPrefsService {
  private readonly auth = inject(AuthService);
  private readonly scope = inject(TeamScopeService);

  readonly prefs = signal<UserPrefs>({});
  readonly loaded = signal(false);
  private loadedFor = '';

  constructor() {
    effect(() => {
      if (!this.auth.ready()) return;
      const email = this.auth.userEmail();
      if (!email) {
        this.prefs.set({});
        this.loaded.set(false);
        this.loadedFor = '';
        return;
      }
      if (this.loadedFor === email) return;
      this.loadedFor = email;
      void this.load(email);
    });

    // The teams list sends the scope back to the default when the team the document names is gone
    // (TeamDataService's fallback, and `load` above then leaves that choice standing). Nothing else
    // would touch the document, so every later sign-in on every device would follow the dead id,
    // open every member listener under it and be sent back again. So once the document is loaded,
    // the scope on the default and the document still naming a team, the document is corrected to
    // the default: the one write this service makes without being asked (27 Sep 2026).
    effect(() => {
      if (this.auth.mode !== 'firebase' || !this.loaded()) return;
      if (this.scope.activeTeamId() !== DEFAULT_TEAM_ID) return;
      if (!isTeamId(this.prefs().team)) return;
      untracked(() => void this.setTeam(DEFAULT_TEAM_ID));
    });
  }

  seenVersion(tourId: string): number {
    return this.prefs().toursSeen?.[tourId] ?? (tourId === 'welcome' && this.prefs().tourSeen ? 1 : 0);
  }

  async markTourSeen(tourId: string, version: number): Promise<void> {
    const email = this.auth.userEmail();
    const toursSeen = { ...(this.prefs().toursSeen ?? {}), [tourId]: version };
    const next: UserPrefs = { ...this.prefs(), toursSeen, ...(tourId === 'welcome' && { tourSeen: true }) };
    this.prefs.set(next);
    if (!email) return;
    this.writeLocal(email, next);
    await this.writeDoc(email, { toursSeen: { [tourId]: version }, ...(tourId === 'welcome' && { tourSeen: true }) }, true);
  }

  async resetTours(): Promise<void> {
    const email = this.auth.userEmail();
    const { film, teamFilm, team, depth } = this.prefs();
    const next: UserPrefs = { ...this.prefs(), toursSeen: {}, tourSeen: false };
    this.prefs.set(next);
    if (!email) return;
    this.writeLocal(email, next);
    try {
      localStorage.removeItem(`bom-tour:${email}`);
    } catch {
      /* ignore */
    }
    // No merge: a merged empty map keeps every old key, which is the
    // opposite of a reset. So the whole document is written back, and
    // everything that is not a tour rides along: the film progress, every
    // team's, the chosen team and the reading depth (dropped here until
    // 27 Sep 2026, so a Reset tours put another device back on Starter).
    // A tour reset is not a film reset, not a team switch and not a
    // depth reset.
    await this.writeDoc(
      email,
      { toursSeen: {}, tourSeen: false, ...(film && { film }), ...(teamFilm && { teamFilm }), ...(team && { team }), ...(depth && { depth }) },
      false
    );
  }

  // ---- The team ---------------------------------------------------------

  /**
   * Remember the team this person chose, so another device lands on it. Choosing Bom Squad writes
   * the literal `default`, not a delete: a document with no `team` is one written before there were
   * teams to choose, and it leaves a device where it is, so an absent key could never pull a second
   * device back from another team (27 Sep 2026). The switcher calls this beside
   * `TeamScopeService.choose`; this service never chooses on its own except when the document loads.
   */
  async setTeam(teamId: string): Promise<void> {
    if (teamId !== DEFAULT_TEAM_ID && !isTeamId(teamId)) throw new Error(`Not a team id: ${JSON.stringify(teamId)}`);
    await this.commit({ ...this.prefs(), team: teamId }, { team: teamId });
  }

  /**
   * The team the document asks for: the default when it says so, a team id, or null when it says
   * nothing (a document from before release 2, or a hand edit that is not an id).
   */
  private static wantedTeam(stored: UserPrefs): string | null {
    if (stored.team === DEFAULT_TEAM_ID) return DEFAULT_TEAM_ID;
    return isTeamId(stored.team) ? stored.team : null;
  }

  // ---- The film room ----------------------------------------------------

  /**
   * The film room's preferences for the active team: `film` for Bom Squad, `teamFilm[id]` for any
   * other; undefined before this person has opened a film on it. Reads the scope, so a computed over
   * it follows a switch.
   */
  filmOf(): FilmPrefs | undefined {
    const teamId = this.scope.activeTeamId();
    return teamId === DEFAULT_TEAM_ID ? this.prefs().film : this.prefs().teamFilm?.[teamId];
  }

  /** Where this person is in one film; undefined before they open it. */
  filmProgress(matchId: string): FilmProgress | undefined {
    return this.filmOf()?.films?.[matchId];
  }

  /** The seat "Your seat" opens on, once they have said which is theirs. */
  filmSeat(): Role | undefined {
    return this.filmOf()?.seat;
  }

  /**
   * Merge a step of progress into one film: a call made, the card reached,
   * the reminder moved. A field set to undefined in the patch is cleared,
   * here and in the document (Firestore refuses undefined, so it goes as a
   * deleteField).
   */
  async saveFilmProgress(matchId: string, patch: Partial<FilmProgress>): Promise<void> {
    const film = this.filmOf() ?? {};
    const current: Record<string, unknown> = { ...(film.films?.[matchId] ?? {}) };
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        delete current[key];
        fields[key] = deleteField();
      } else {
        current[key] = value;
        fields[key] = value;
      }
    }
    const films = { ...(film.films ?? {}), [matchId]: current as FilmProgress };
    await this.commitFilm({ ...film, films }, { films: { [matchId]: fields } });
  }

  // ---- How much of a surface to draw ------------------------------------

  /**
   * Starter unless this person has asked for Full. Absent means Starter, so nothing has to be
   * written for the default and an older document needs no migration.
   */
  depthOf(surface: DepthSurface): 'starter' | 'full' {
    return this.prefs().depth?.[surface] === 'full' ? 'full' : 'starter';
  }

  async setDepth(surface: DepthSurface, full: boolean): Promise<void> {
    const depth = { ...(this.prefs().depth ?? {}) };
    if (full) depth[surface] = 'full';
    else delete depth[surface];
    // Back to the default is a delete, not a stored 'starter': the absent key IS the default, and
    // writing one would be a second way to say the same thing.
    await this.commit({ ...this.prefs(), depth }, { depth: { [surface]: full ? 'full' : deleteField() } });
  }

  async setFilmSeat(seat: Role): Promise<void> {
    const film = this.filmOf() ?? {};
    await this.commitFilm({ ...film, seat }, { seat });
  }

  /**
   * The film room's write for the active team: `film` on Bom Squad, so the document keeps the shape
   * it has always had, and `teamFilm.{id}` on any other team, merged so one team's write never
   * touches another's.
   */
  private async commitFilm(film: FilmPrefs, fields: Record<string, unknown>): Promise<void> {
    const teamId = this.scope.activeTeamId();
    if (teamId === DEFAULT_TEAM_ID) {
      await this.commit({ ...this.prefs(), film }, { film: fields });
      return;
    }
    const teamFilm = { ...(this.prefs().teamFilm ?? {}), [teamId]: film };
    await this.commit({ ...this.prefs(), teamFilm }, { teamFilm: { [teamId]: fields } });
  }

  /** The pattern every write follows: the signal first, then the local copy, then a merge into the document. */
  private async commit(next: UserPrefs, fields: Record<string, unknown>): Promise<void> {
    const email = this.auth.userEmail();
    this.prefs.set(next);
    if (!email) return;
    this.writeLocal(email, next);
    await this.writeDoc(email, fields, true);
  }

  /**
   * The local copy first, then the document over it.
   *
   * Both used to land together, after the `await` (12 Sep 2026): `prefs.set` ran once, at the end,
   * so everything read from here rendered its default for as long as Firestore took to answer and
   * then flipped. Nobody noticed while this held tours and film progress, which nothing draws on
   * first paint. A reading depth is drawn immediately, and a stored Full would have shown Starter
   * and jumped. The local read is synchronous and already correct, so it goes in first and the
   * document merges over it.
   *
   * The document's `team` wins over the device's (27 Sep 2026, release 2): when it names a team,
   * or the default, that is not the one active, and this person may see it (release 3), the scope is
   * told, and TeamDataService follows. A document with no `team` is one written before there were
   * teams to choose, and it leaves the device where it was. One direction, this service to the
   * scope, never back.
   *
   * Two things can happen while the read is in flight, and each is checked after the await. The
   * account can change: A signs out and B signs in on the same tab while A's read waits (offline, the
   * SDK holds a read for about ten seconds before it gives up), and A's document must not become B's
   * prefs nor choose B's team, since `choose` writes `bom-team:<whoever is signed in now>`. And the
   * team can change: the teams list can fall back to the default because the stored team is gone,
   * and later the switcher can be clicked. Either choice is newer than the document's, so it stands,
   * in memory as `setTeam` left it and in the scope; the document's is not applied over it.
   */
  private async load(email: string): Promise<void> {
    const local = this.readLocal(email);
    this.prefs.set(local);
    const teamAtStart = this.scope.activeTeamId();
    const stored = await this.readDoc(email);
    if (this.loadedFor !== email) return;
    if (stored) {
      const merged: UserPrefs = { ...local, ...stored };
      if (this.scope.activeTeamId() !== teamAtStart) {
        const chosen = this.prefs().team;
        if (chosen === undefined) delete merged.team;
        else merged.team = chosen;
      } else {
        // Only a team this person may see (release 3): a document naming one they were taken off, or the root
        // for someone on other teams alone, leaves the device where the active-team rule put it.
        const wanted = UserPrefsService.wantedTeam(stored);
        if (wanted && wanted !== teamAtStart && this.auth.maySee(wanted)) this.scope.choose(wanted);
      }
      this.prefs.set(merged);
    }
    this.loaded.set(true);
  }

  /** The document as stored, or null when there is none or no door to it; behind a method so a spec can stand in for Firestore. */
  protected async readDoc(email: string): Promise<UserPrefs | null> {
    const db = isFirebaseConfigured() ? getDb() : null;
    if (!db) return null;
    try {
      const snap = await getDoc(doc(db, 'userPrefs', email));
      return snap.exists() ? (snap.data() as UserPrefs) : null;
    } catch {
      // offline or refused: the local copy stands
      return null;
    }
  }

  /** One write to the document, merged or whole; behind a method so a spec can see the fields. A failure is swallowed: the local copy already says so. */
  protected async writeDoc(email: string, fields: Record<string, unknown>, merge: boolean): Promise<void> {
    const db = isFirebaseConfigured() ? getDb() : null;
    if (!db) return;
    try {
      await setDoc(doc(db, 'userPrefs', email), fields, merge ? { merge: true } : {});
    } catch {
      // The local copy already says so.
    }
  }

  private key(email: string): string {
    return `bom-tours:${email}`;
  }

  private readLocal(email: string): UserPrefs {
    try {
      const raw = localStorage.getItem(this.key(email));
      const prefs = raw ? (JSON.parse(raw) as UserPrefs) : {};
      // The flag the welcome modal wrote before tours were versioned.
      if (localStorage.getItem(`bom-tour:${email}`)) prefs.tourSeen = true;
      return prefs;
    } catch {
      return {};
    }
  }

  private writeLocal(email: string, prefs: UserPrefs): void {
    try {
      localStorage.setItem(this.key(email), JSON.stringify(prefs));
    } catch {
      /* private mode */
    }
  }
}
