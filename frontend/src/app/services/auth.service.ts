import { Injectable, computed, inject, signal } from '@angular/core';
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
import {
  activeRoleOf,
  canEditWith,
  canManageUsersWith,
  firstTeam,
  isBootstrapAdminEmail,
  letIn,
  maySee,
  memberTeamIds,
  normalizeEmail,
  roleOnTeam,
  teamRolesOf
} from '../core/access';
import { getAuthInstance, getDb, isFirebaseConfigured } from '../core/firebase';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { AccessRole } from '../models/team.models';
import { TeamChoiceStore } from './team-choice.store';

const LOCAL_FLAG = 'bom-local-auth';

/** A person's own `access/{email}` document, as far as the gate reads it. */
type AccessDoc = { role?: AccessRole; active?: boolean };
/** A person's own `members/{email}` document, as far as the gate reads it: the `teams` map of `Members`, unchecked. */
type MembersDoc = { teams?: unknown };

/** What the two reads say about a person: their root role and the teams their index names. */
interface Roles {
  rootRole: AccessRole | null;
  teams: Record<string, AccessRole>;
}

const NO_TEAMS: Record<string, AccessRole> = {};

/** Whether two team maps say the same, so a re-read that changed nothing leaves the signal alone. */
function sameRoles(a: Record<string, AccessRole>, b: Record<string, AccessRole>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * Who is signed in and what they may do, per team (27 Sep 2026, release 3 of the multi-team work).
 *
 * Two documents say who a person is: their root entry `access/{email}`, which is Bom Squad's list and
 * gives the root role, and their index `members/{email}`, which names every other team whose own list
 * holds them and the role there. Both are read at sign-in and again by `confirmAccess`. A person is let
 * in when the root entry is active or the index names at least one team; a root admin (the bootstrap
 * email included) is an admin of every team without being on any team's list.
 *
 * `role()`, `canEdit()` and `canManageUsers()` follow the ACTIVE team, so the same person can be a
 * contributor on one team and nobody on another, and every guard, pill and admin tab follows the
 * switch without a change. The active team is computed here from the same store and the same rule
 * TeamScopeService uses (`firstTeam`), because that service injects this one and cannot be injected
 * back; `roleFor(teamId)` and `maySee(teamId)` answer for any team.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly mode: 'firebase' | 'local' = isFirebaseConfigured() ? 'firebase' : 'local';

  private readonly choice = inject(TeamChoiceStore);

  readonly userEmail = signal<string | null>(null);
  /** The root entry's role: Bom Squad's list, or admin for the bootstrap email; null for a person on other teams alone. */
  readonly rootRole = signal<AccessRole | null>(null);
  /** The role each other team's own list gives this person, from their `members/{email}` index; empty for a root admin, who needs none. */
  readonly teamRoles = signal<Record<string, AccessRole>>(NO_TEAMS);
  readonly isAuthed = computed(() => this.userEmail() !== null);
  /** A member of Bom Squad's own list: the root row in the switcher, and the root as the team to fall back to. */
  readonly isRootMember = computed(() => this.rootRole() !== null);
  /** An admin of every team: creates and deletes teams, copies Bom Squad's members, lists every team. */
  readonly isRootAdmin = computed(() => this.rootRole() === 'admin');
  /**
   * The ids the person's own index names, sorted. Not every team a root admin may see: that is every team, and
   * the list of them is TeamDataService's (`teams`), which this service cannot read without a cycle; the two
   * switchers draw `TeamDataService.visibleTeams`, every team filtered through `maySee`.
   */
  readonly teamsOf = computed(() => memberTeamIds(this.teamRoles()));

  /**
   * The active team, as TeamScopeService computes it from the same store and the same rule: the wanted team when
   * they may see it, else the root for a root member, else their first team. Private: the app asks the scope.
   */
  private readonly activeTeamId = computed(() =>
    firstTeam(this.mode === 'firebase' ? this.choice.wantedTeam(this.userEmail()) : DEFAULT_TEAM_ID, this.rootRole(), this.teamRoles())
  );

  /** The role on the active team. */
  readonly role = computed(() => roleOnTeam(this.rootRole(), this.teamRoles(), this.activeTeamId()));

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
        this.setSession(sessionStorage.getItem(LOCAL_FLAG), 'admin', NO_TEAMS);
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

  /** The role this person holds on `teamId` (`default` is the root), or null when they may not open it. */
  roleFor(teamId: string): AccessRole | null {
    return roleOnTeam(this.rootRole(), this.teamRoles(), teamId);
  }

  /** Whether this person may open `teamId` at all; the default asks whether they are a root member. */
  maySee(teamId: string): boolean {
    return maySee(this.rootRole(), this.teamRoles(), teamId);
  }

  /** The roles first, the email last: the session effects run on the email, and read the roles as they stand. */
  private setSession(email: string | null, rootRole: AccessRole | null, teams: Record<string, AccessRole>): void {
    this.rootRole.set(rootRole);
    if (!sameRoles(teams, this.teamRoles())) this.teamRoles.set(teams);
    this.userEmail.set(email);
  }

  /** Nobody signed in: the email first, so nothing reads a role for a person who has gone. */
  private clearSession(): void {
    this.userEmail.set(null);
    this.rootRole.set(null);
    if (this.teamRoles() !== NO_TEAMS) this.teamRoles.set(NO_TEAMS);
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
      this.clearSession();
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
      this.clearSession();
      return;
    }

    if (isBootstrapAdminEmail(email)) {
      this.setSession(email, 'admin', NO_TEAMS);
      return;
    }

    if (!getDb()) {
      this.clearSession();
      await this.signOutOf(auth);
      return;
    }

    const roles = await this.readRoles(email);
    if (!letIn(roles.rootRole, roles.teams)) {
      // Not authorized: never expose an authed session — sign straight back out.
      this.clearSession();
      await this.signOutOf(auth);
      return;
    }

    this.setSession(email, roles.rootRole, roles.teams);
  }

  /**
   * Ask again whether the person signed in is still let in (27 Sep 2026). TeamDataService calls it when the rules
   * start refusing a signed-in person's listens: the usual cause is an admin unticking Active, or removing the entry,
   * while they had the app open, and AuthService only read the entries at sign-in. When neither the root entry nor
   * the index lets them in any more they are signed out here — the session effects then close the listeners, empty
   * the data and leave the page — and the answer is false. The reads are their own two documents, which the rules
   * always let them read. Throws when the root read itself fails, so the caller can tell "still in" from "could not
   * ask".
   */
  async confirmAccess(): Promise<boolean> {
    const email = this.userEmail();
    if (this.mode !== 'firebase' || !email) return false;
    if (isBootstrapAdminEmail(email)) return true;
    const roles = await this.readRoles(email);
    // Someone else signed in meanwhile: this answer is not about them.
    if (this.userEmail() !== email) return false;
    if (letIn(roles.rootRole, roles.teams)) {
      // Still in, perhaps in another role, or on other teams (an admin made a contributor loses the access list the
      // same way; a person taken off a team is moved off it by the active-team rule).
      if (roles.rootRole !== this.rootRole()) this.rootRole.set(roles.rootRole);
      if (!sameRoles(roles.teams, this.teamRoles())) this.teamRoles.set(roles.teams);
      return true;
    }
    await this.logout();
    return false;
  }

  /**
   * The two reads, together. The root entry's failure is the caller's to handle, as it always was. The index is
   * different: under the rules deployed before release 3 a root member's read of `members/{email}` can be refused
   * (the collection has no block of its own yet) and under any rules the document is absent for a person on no
   * other team, so a refusal or a missing document reads as no teams, never as a refusal to sign in.
   */
  private async readRoles(email: string): Promise<Roles> {
    const [access, members] = await Promise.all([this.readAccess(email), this.readMembersOrNone(email)]);
    return { rootRole: activeRoleOf(access), teams: teamRolesOf(members) };
  }

  private async readMembersOrNone(email: string): Promise<MembersDoc | null> {
    try {
      return await this.readMembers(email);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'permission-denied') return null;
      throw error;
    }
  }

  /** The person's own access entry, or null when there is none. Throws when the read fails. */
  protected async readAccess(email: string): Promise<AccessDoc | null> {
    const db = getDb();
    if (!db) return null;
    const snap = await getDoc(doc(db, 'access', email));
    return snap.exists() ? (snap.data() as AccessDoc) : null;
  }

  /** The person's own index of teams, or null when there is none. Throws when the read fails, a refusal included. */
  protected async readMembers(email: string): Promise<MembersDoc | null> {
    const db = getDb();
    if (!db) return null;
    const snap = await getDoc(doc(db, 'members', email));
    return snap.exists() ? (snap.data() as MembersDoc) : null;
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
    this.setSession(email, 'admin', NO_TEAMS);
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
      this.setSession(normalized, 'admin', NO_TEAMS);
      return;
    }

    if (!getDb()) {
      await this.logout();
      throw new Error('Not authorized — ask an admin for access.');
    }

    const roles = await this.readRoles(normalized);
    if (!letIn(roles.rootRole, roles.teams)) {
      await this.logout();
      throw new Error('Not authorized — ask an admin for access.');
    }

    this.setSession(normalized, roles.rootRole, roles.teams);
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
    this.clearSession();
  }

}
