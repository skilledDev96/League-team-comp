import { effect, inject, Injectable, signal } from '@angular/core';
import { deleteField, doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '../core/firebase';
import { FilmProgress, Role, UserPrefs } from '../models/team.models';
import { AuthService } from './auth.service';

/**
 * What one account has seen: the tours, by version, and since 9 Sep 2026
 * where they are in each film. One document per signed-in email at
 * `userPrefs/{email}` (the rules let a person write only their own), with
 * localStorage as the fallback when there is no backend or the write fails.
 * The old `tourSeen` flag still gets written when the welcome tour finishes,
 * so the e2e setup and older builds keep working.
 */
@Injectable({ providedIn: 'root' })
export class UserPrefsService {
  private readonly auth = inject(AuthService);

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
    const db = isFirebaseConfigured() ? getDb() : null;
    if (!db) return;
    try {
      await setDoc(doc(db, 'userPrefs', email), { toursSeen: { [tourId]: version }, ...(tourId === 'welcome' && { tourSeen: true }) }, { merge: true });
    } catch {
      // The local copy already says so.
    }
  }

  async resetTours(): Promise<void> {
    const email = this.auth.userEmail();
    const film = this.prefs().film;
    const next: UserPrefs = { ...this.prefs(), toursSeen: {}, tourSeen: false };
    this.prefs.set(next);
    if (!email) return;
    this.writeLocal(email, next);
    try {
      localStorage.removeItem(`bom-tour:${email}`);
    } catch {
      /* ignore */
    }
    const db = isFirebaseConfigured() ? getDb() : null;
    if (!db) return;
    try {
      // No merge: a merged empty map keeps every old key, which is the
      // opposite of a reset. So the whole document is written back, and the
      // film progress rides along; a tour reset is not a film reset.
      await setDoc(doc(db, 'userPrefs', email), { toursSeen: {}, tourSeen: false, ...(film && { film }) });
    } catch {
      /* the local copy already says so */
    }
  }

  // ---- The film room ----------------------------------------------------

  /** Where this person is in one film; undefined before they open it. */
  filmProgress(matchId: string): FilmProgress | undefined {
    return this.prefs().film?.films?.[matchId];
  }

  /** The seat "Your seat" opens on, once they have said which is theirs. */
  filmSeat(): Role | undefined {
    return this.prefs().film?.seat;
  }

  /**
   * Merge a step of progress into one film: a call made, the card reached,
   * the reminder moved. A field set to undefined in the patch is cleared,
   * here and in the document (Firestore refuses undefined, so it goes as a
   * deleteField).
   */
  async saveFilmProgress(matchId: string, patch: Partial<FilmProgress>): Promise<void> {
    const film = this.prefs().film ?? {};
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
    const next: UserPrefs = { ...this.prefs(), film: { ...film, films } };
    await this.commit(next, { film: { films: { [matchId]: fields } } });
  }

  async setFilmSeat(seat: Role): Promise<void> {
    const film = this.prefs().film ?? {};
    const next: UserPrefs = { ...this.prefs(), film: { ...film, seat } };
    await this.commit(next, { film: { seat } });
  }

  /** The pattern every write follows: the signal first, then the local copy, then a merge into the document. */
  private async commit(next: UserPrefs, fields: Record<string, unknown>): Promise<void> {
    const email = this.auth.userEmail();
    this.prefs.set(next);
    if (!email) return;
    this.writeLocal(email, next);
    const db = isFirebaseConfigured() ? getDb() : null;
    if (!db) return;
    try {
      await setDoc(doc(db, 'userPrefs', email), fields, { merge: true });
    } catch {
      // The local copy already says so.
    }
  }

  private async load(email: string): Promise<void> {
    let prefs = this.readLocal(email);
    const db = isFirebaseConfigured() ? getDb() : null;
    if (db) {
      try {
        const snap = await getDoc(doc(db, 'userPrefs', email));
        if (snap.exists()) prefs = { ...prefs, ...(snap.data() as UserPrefs) };
      } catch {
        // offline or refused: the local copy stands
      }
    }
    this.prefs.set(prefs);
    this.loaded.set(true);
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
