import { Injectable, computed, signal } from '@angular/core';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { isBootstrapAdminEmail, normalizeEmail } from '../core/access';
import { getAuthInstance, getDb, isFirebaseConfigured } from '../core/firebase';
import { AccessRole } from '../models/team.models';

const LOCAL_FLAG = 'bom-local-auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly mode: 'firebase' | 'local' = isFirebaseConfigured() ? 'firebase' : 'local';

  readonly userEmail = signal<string | null>(null);
  readonly role = signal<AccessRole | null>(null);
  readonly isAuthed = computed(() => this.userEmail() !== null);

  // Editing requires admin or contributor access in firebase mode; local mode is unrestricted.
  readonly canEdit = computed(() => {
    const role = this.role();
    return this.mode === 'local' || role === 'admin' || role === 'contributor';
  });

  readonly canManageUsers = computed(() => this.mode === 'local' || this.role() === 'admin');

  // Resolves once the initial auth state has been determined (prevents guard redirect races on refresh).
  readonly ready = signal(false);
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    if (this.mode === 'firebase') {
      const auth = getAuthInstance();
      if (auth) {
        onAuthStateChanged(auth, async (user) => {
          await this.resolveRole(auth, user);
          this.markReady();
        });
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

  private async resolveRole(auth: NonNullable<ReturnType<typeof getAuthInstance>>, user: User | null): Promise<void> {
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

    const db = getDb();
    if (!db) {
      this.userEmail.set(null);
      this.role.set(null);
      await signOut(auth!);
      return;
    }

    const accessSnap = await getDoc(doc(db, 'access', email));
    const access = accessSnap.exists() ? (accessSnap.data() as { role?: AccessRole; active?: boolean }) : null;
    if (!access || !access.active || !access.role) {
      // Not authorized: never expose an authed session — sign straight back out.
      this.userEmail.set(null);
      this.role.set(null);
      await signOut(auth!);
      return;
    }

    this.role.set(access.role);
    this.userEmail.set(email);
  }

  async login(email: string, password: string): Promise<void> {
    if (this.mode === 'firebase') {
      const auth = getAuthInstance();
      if (!auth) {
        throw new Error('Firebase auth unavailable.');
      }
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await this.enforceAccess(credential.user.email);
      return;
    }
    // Local mode: no backend; any non-empty credentials unlock editing for this session.
    if (!email || !password) {
      throw new Error('Enter an email and password.');
    }
    sessionStorage.setItem(LOCAL_FLAG, email);
    this.userEmail.set(email);
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

    const db = getDb();
    if (!db) {
      await this.logout();
      throw new Error('This account is not authorized. Ask an admin to add your email.');
    }

    const accessSnap = await getDoc(doc(db, 'access', normalized));
    const access = accessSnap.exists() ? (accessSnap.data() as { role?: AccessRole; active?: boolean }) : null;
    if (!access || !access.active || !access.role) {
      await this.logout();
      throw new Error('This account is not authorized. Ask an admin to add your email.');
    }

    this.role.set(access.role);
    this.userEmail.set(normalized);
  }

  async logout(): Promise<void> {
    if (this.mode === 'firebase') {
      const auth = getAuthInstance();
      if (auth) {
        await signOut(auth);
      }
      return;
    }
    sessionStorage.removeItem(LOCAL_FLAG);
    this.userEmail.set(null);
    this.role.set(null);
  }

  /** Whether the current user has already seen the welcome tour (stored per-account in Firestore). */
  async hasSeenTour(): Promise<boolean> {
    const email = this.userEmail();
    if (!email) {
      return true;
    }
    const localFlag = () => Boolean(localStorage.getItem(this.tourKey(email)));
    if (this.mode !== 'firebase') {
      return localFlag();
    }
    const db = getDb();
    if (!db) {
      return localFlag();
    }
    try {
      const snap = await getDoc(doc(db, 'userPrefs', email));
      return snap.exists() && (snap.data() as { tourSeen?: boolean }).tourSeen === true;
    } catch {
      return localFlag();
    }
  }

  async markTourSeen(): Promise<void> {
    const email = this.userEmail();
    if (!email) {
      return;
    }
    localStorage.setItem(this.tourKey(email), '1');
    if (this.mode !== 'firebase') {
      return;
    }
    const db = getDb();
    if (!db) {
      return;
    }
    try {
      await setDoc(doc(db, 'userPrefs', email), { tourSeen: true }, { merge: true });
    } catch {
      // localStorage fallback already set above.
    }
  }

  private tourKey(email: string): string {
    return `bom-tour:${email}`;
  }
}
