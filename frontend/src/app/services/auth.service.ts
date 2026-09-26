import { Injectable, computed, signal } from '@angular/core';
import {
  Auth,
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { canEditWith, canManageUsersWith, isBootstrapAdminEmail, normalizeEmail } from '../core/access';
import { getAuthInstance, getDb, isFirebaseConfigured } from '../core/firebase';
import { AccessRole } from '../models/team.models';

const LOCAL_FLAG = 'bom-local-auth';

/** A person's own `access/{email}` document, as far as the gate reads it. */
type AccessDoc = { role?: AccessRole; active?: boolean };

/**
 * The gate, in one place: an entry whose `active` and `role` are both set. firestore.rules' hasAccess() applies the
 * same JavaScript truthiness, so the app and the rules cannot disagree about who is in.
 */
function letIn(access: AccessDoc | null): access is AccessDoc & { role: AccessRole } {
  return !!access && !!access.active && !!access.role;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly mode: 'firebase' | 'local' = isFirebaseConfigured() ? 'firebase' : 'local';

  readonly userEmail = signal<string | null>(null);
  readonly role = signal<AccessRole | null>(null);
  readonly isAuthed = computed(() => this.userEmail() !== null);

  // The rules themselves live in core/access, where they can be tested without
  // standing up Firebase — and where firestore.rules can be read alongside them.
  readonly canEdit = computed(() => canEditWith(this.mode, this.role()));

  readonly canManageUsers = computed(() => canManageUsersWith(this.mode, this.role()));

  // Edit mode is an explicit opt-in so viewing stays calm; inline edit controls
  // only appear when a user who can edit has also switched editing on.
  readonly editMode = signal(false);
  readonly editing = computed(() => this.canEdit() && this.editMode());

  // Resolves once the initial auth state has been determined (prevents guard redirect races on refresh).
  readonly ready = signal(false);
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    if (this.mode === 'firebase') {
      const auth = this.authInstance();
      if (auth) {
        this.watchAuthState(auth, (user) => void this.settle(auth, user));
      } else {
        this.markReady();
      }
    } else {
      if (sessionStorage.getItem(LOCAL_FLAG)) {
        this.userEmail.set(sessionStorage.getItem(LOCAL_FLAG));
        this.role.set('admin');
      }
      this.markReady();
    }
  }

  private markReady(): void {
    if (!this.ready()) {
      this.ready.set(true);
      this.resolveReady();
    }
  }

  /** Await until the first auth-state resolution completes. */
  waitUntilReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Settle one auth state, and always let the guards go on the first (27 Sep 2026). `resolveRole` reads the person's
   * own access entry, and that read can fail: the members-only rules refuse it to a session from a door they do not
   * count (an Email/Password session kept from before 9 Sep 2026, say), and it fails offline. The failure used to
   * escape this callback as an unhandled rejection — a console error — before `markReady`, so viewerGuard and
   * authGuard waited on `waitUntilReady()` for good and a shared link opened onto an empty outlet.
   *
   * A refused read is a session the rules will never let in, so it is signed out, as the not-authorized branch does.
   * Any other failure leaves nobody signed in on this page load but keeps the session, so a reload once the network is
   * back lets them straight in rather than through the Google popup again.
   */
  private async settle(auth: Auth, user: User | null): Promise<void> {
    try {
      await this.resolveRole(auth, user);
    } catch (error) {
      this.userEmail.set(null);
      this.role.set(null);
      this.markReady();
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'permission-denied') {
        console.warn('The access check was refused for this session, so it has been signed out.');
        await this.signOutOf(auth).catch(() => undefined);
      } else {
        console.warn(`The access check could not be read (${String(code ?? error)}); nobody is signed in on this page, and a reload tries again.`);
      }
    } finally {
      this.markReady();
    }
  }

  private async resolveRole(auth: Auth, user: User | null): Promise<void> {
    const email = normalizeEmail(user?.email);

    if (!user || !email) {
      this.userEmail.set(null);
      this.role.set(null);
      return;
    }

    if (isBootstrapAdminEmail(email)) {
      this.role.set('admin');
      this.userEmail.set(email);
      return;
    }

    if (!getDb()) {
      this.userEmail.set(null);
      this.role.set(null);
      await this.signOutOf(auth);
      return;
    }

    const access = await this.readAccess(email);
    if (!letIn(access)) {
      // Not authorized: never expose an authed session — sign straight back out.
      this.userEmail.set(null);
      this.role.set(null);
      await this.signOutOf(auth);
      return;
    }

    this.role.set(access.role);
    this.userEmail.set(email);
  }

  /**
   * Ask again whether the person signed in is still let in (27 Sep 2026). TeamDataService calls it when the rules
   * start refusing a signed-in person's listens: the usual cause is an admin unticking Active, or removing the entry,
   * while they had the app open, and AuthService only read the entry at sign-in. When the entry no longer lets them
   * in they are signed out here — the session effects then close the listeners, empty the data and leave the page —
   * and the answer is false. The read is their own entry, which the rules always let them read. Throws when the read
   * itself fails, so the caller can tell "still in" from "could not ask".
   */
  async confirmAccess(): Promise<boolean> {
    const email = this.userEmail();
    if (this.mode !== 'firebase' || !email) return false;
    if (isBootstrapAdminEmail(email)) return true;
    const access = await this.readAccess(email);
    // Someone else signed in meanwhile: this answer is not about them.
    if (this.userEmail() !== email) return false;
    if (letIn(access)) {
      // Still in, perhaps in another role (an admin made a contributor loses the access list the same way).
      if (access.role !== this.role()) this.role.set(access.role);
      return true;
    }
    await this.logout();
    return false;
  }

  /** The person's own access entry, or null when there is none. Throws when the read fails. */
  protected async readAccess(email: string): Promise<AccessDoc | null> {
    const db = getDb();
    if (!db) return null;
    const snap = await getDoc(doc(db, 'access', email));
    return snap.exists() ? (snap.data() as AccessDoc) : null;
  }

  /** Firebase Auth, behind a method so a spec can stand in for it (the ReplayRecordingService pattern). */
  protected authInstance(): Auth | null {
    return getAuthInstance();
  }

  protected watchAuthState(auth: Auth, next: (user: User | null) => void): void {
    onAuthStateChanged(auth, next);
  }

  protected signOutOf(auth: Auth): Promise<void> {
    return signOut(auth);
  }

  /** Local mode: no backend; one click is an admin session for this browser tab. */
  enterLocal(): void {
    if (this.mode !== 'local') {
      throw new Error('The local preview needs Firebase to be unconfigured.');
    }
    const email = 'local@preview';
    sessionStorage.setItem(LOCAL_FLAG, email);
    this.userEmail.set(email);
    this.role.set('admin');
  }

  /**
   * The automated test user's door (9 Sep 2026): a Firebase custom token the
   * test runner minted from a service account, handed over on the login
   * route's fragment. Then the same access gate as everyone, so the token
   * alone grants nothing. No password provider, no endpoint on the internet.
   */
  async loginWithToken(token: string): Promise<void> {
    if (this.mode !== 'firebase') {
      throw new Error('A sign-in token requires Firebase configuration.');
    }
    const auth = getAuthInstance();
    if (!auth) {
      throw new Error('Firebase auth unavailable.');
    }
    const credential = await signInWithCustomToken(auth, token);
    await this.enforceAccess(credential.user.email);
  }

  async loginWithGoogle(): Promise<void> {
    if (this.mode !== 'firebase') {
      throw new Error('Google sign-in requires Firebase configuration.');
    }
    const auth = getAuthInstance();
    if (!auth) {
      throw new Error('Firebase auth unavailable.');
    }
    const credential = await signInWithPopup(auth, new GoogleAuthProvider());
    await this.enforceAccess(credential.user.email);
  }

  private async enforceAccess(email: string | null): Promise<void> {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      return;
    }

    if (isBootstrapAdminEmail(normalized)) {
      this.role.set('admin');
      this.userEmail.set(normalized);
      return;
    }

    if (!getDb()) {
      await this.logout();
      throw new Error('Not authorized — ask an admin for access.');
    }

    const access = await this.readAccess(normalized);
    if (!letIn(access)) {
      await this.logout();
      throw new Error('Not authorized — ask an admin for access.');
    }

    this.role.set(access.role);
    this.userEmail.set(normalized);
  }

  async logout(): Promise<void> {
    if (this.mode === 'firebase') {
      const auth = this.authInstance();
      if (auth) {
        await this.signOutOf(auth);
      }
      return;
    }
    sessionStorage.removeItem(LOCAL_FLAG);
    this.userEmail.set(null);
    this.role.set(null);
  }

}
