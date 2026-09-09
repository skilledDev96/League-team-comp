import { AccessRole, CompPicks, FillIn, Player, Role, Tournament } from '../../models/team.models';

/**
 * The shapes the admin editors work on, and the conversions between them and
 * the stored entities.
 *
 * Drafts are flat and string-based because that is what the inputs bind to:
 * comma-separated lists rather than arrays, empty strings rather than absent
 * optional fields. Keeping the conversion here means it can be tested without
 * a component or a backend.
 */

export interface PlayerDraft {
  uid: string;
  id: string;
  name: string;
  role: Role;
  secondaryRoles: Role[];
  sub: boolean;
  curated: boolean;
  icon: string;
  playstyle: string;
  strengths: string;
  weaknesses: string;
  top3: string;
  bans: string;
  region: string;
  opggSlug: string;
  riotTag: string;
  mobalyticsSlug: string;
  queueStats?: Player['queueStats'];
}

export interface FillInDraft {
  id: string;
  summoner: string;
  status: string;
  preferredRoles: string;
  note: string;
  icon: string;
  region: string;
  mobalyticsSlug: string;
}

export interface CompDraft {
  id: string;
  name: string;
  picks: CompPicks;
}

export interface TournamentDraft {
  id: string;
  name: string;
  organiser: string;
  division: string;
  format: string;
  startDate: string;
  endDate: string;
  notes: string;
  active: boolean;
}

export interface AccessDraft {
  email: string;
  role: AccessRole;
  active: boolean;
  /** The email this row was loaded with; differs from `email` once a person edits it in place. */
  originalEmail?: string;
}

/**
 * What saving an access row means: an update when the email already has a
 * document, a create otherwise, and a delete of the old document when the
 * row's email was edited in place — a rename used to leave both behind.
 */
export function accessRenamePlan(draft: AccessDraft, existingEmails: readonly string[]): { exists: boolean; deleteEmail: string | null } {
  const email = draft.email.trim().toLowerCase();
  const original = (draft.originalEmail ?? '').trim().toLowerCase();
  const exists = existingEmails.includes(email);
  const renamed = original !== '' && original !== email && existingEmails.includes(original);
  return { exists, deleteEmail: renamed ? original : null };
}

export type EditorTab = 'settings' | 'players' | 'fillins' | 'comps' | 'tournaments' | 'access' | 'diagnostics';

export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeEmailValue(value: string): string {
  return value.trim().toLowerCase();
}

/** What a fill-in's status can be; the select offers these and keeps an older free-text value. */
export const FILL_IN_STATUSES = ['provisional', 'available', 'confirmed', 'unavailable'] as const;

/** The Mobalytics slug for a summoner typed as Name#TAG (a space before the # is fine). */
export function mobalyticsSlugFor(summoner: string): string {
  const [name, tag] = summoner.split('#').map((part) => part.trim());
  const base = slugifyName(name ?? '');
  if (!base) return '';
  return tag ? `${base}-${tag.toLowerCase()}` : base;
}

export function slugifyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
export function emptyPicks(): CompPicks {
  return { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' };
}

export function toPlayerDraft(p: Player): PlayerDraft {
  return {
    uid: newUid(),
    id: p.id,
    name: p.name,
    role: p.role,
    secondaryRoles: (p.secondaryRoles ?? []).filter((r) => r !== p.role),
    sub: !!p.sub,
    curated: !!p.curated,
    icon: p.icon ?? '',
    playstyle: p.playstyle ?? '',
    strengths: p.strengths.join(', '),
    weaknesses: p.weaknesses.join(', '),
    top3: p.top3.join(', '),
    bans: p.bans.join(', '),
    region: p.profile?.region ?? 'euw',
    opggSlug: p.profile?.opggSlug ?? '',
    riotTag: p.profile?.riotTag ?? '',
    mobalyticsSlug: p.profile?.mobalyticsSlug ?? '',
    queueStats: p.queueStats
  };
}

export function newUid(): string {
  return (crypto as Crypto).randomUUID?.() ?? `uid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function toTournamentDraft(t: Tournament): TournamentDraft {
  return {
    id: t.id,
    name: t.name,
    organiser: t.organiser ?? '',
    division: t.division ?? '',
    format: t.format ?? '',
    startDate: t.startDate ?? '',
    endDate: t.endDate ?? '',
    notes: t.notes ?? '',
    active: t.active ?? false
  };
}

export function toFillInDraft(f: FillIn): FillInDraft {
  return {
    id: f.id,
    summoner: f.summoner,
    status: f.status,
    preferredRoles: f.preferredRoles.join(', '),
    note: f.note ?? '',
    icon: f.icon ?? '',
    region: f.profile?.region ?? 'euw',
    mobalyticsSlug: f.profile?.mobalyticsSlug ?? ''
  };
}

