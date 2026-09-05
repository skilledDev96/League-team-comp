/**
 * The draft advisor: what goes to the model and what comes back.
 *
 * The draft room already knows a great deal — our comps and their record,
 * the opponent's scouted pools and the champions that beat them, the lane
 * matchup rates, the lane read — and shows each in its own panel. What it
 * could not do was weigh them against each other with the clock running.
 * That is what a model is for: read everything at once and say, in a few
 * lines, what to take and why.
 *
 * The model only ranks; it never invents. Every champion it may name is in
 * the candidate list the app sends, which is already filtered for the burn,
 * the bans and the seat, and `parseAdvice` drops anything outside it. The
 * data is the app's own — Riot-derived and stored — so nothing new is
 * fetched to answer.
 *
 * Pure here: request validation, prompt text, output schema, answer
 * validation. The call itself is in index.ts beside the other handlers.
 */

export type KnownRole = 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support';

export interface AdviceRoster {
  name: string;
  role: KnownRole;
  /** Most played first. */
  pool: string[];
}

export interface AdviceOpponent extends AdviceRoster {
  rank?: string;
  /** Games and wins per champion, when scouted. */
  records?: { champion: string; games: number; wins: number }[];
  /** Champions that have beaten them in lane. */
  counters?: string[];
  /** Their top masteries, points descending: the one-trick signal. */
  mastery?: { champion: string; level: number; points: number }[];
}

export interface AdviceComp {
  name: string;
  champions: string[];
  winRate?: number;
  games?: number;
  playable: boolean;
  /** Which of its champions are gone this game. */
  blocked: string[];
}

export interface AdviceLane {
  lane: string;
  verdict: string;
  score: number;
  reasons: string[];
}

export interface DraftAdviceRequest {
  teamName: string;
  opponent: string;
  /** What the sequence is asking for right now. */
  action: 'ban' | 'pick';
  /** Whose turn; `their` means we are advising on what to expect and ban. */
  turn: 'our' | 'their';
  stepNumber: number;
  ourSide: 'blue' | 'red' | null;
  /** The seat the next pick lands in, when it is ours. */
  seat: KnownRole | null;
  ourPicks: Partial<Record<KnownRole, string>>;
  theirPicks: Partial<Record<KnownRole, string>>;
  bans: string[];
  burned: string[];
  ourRoster: AdviceRoster[];
  theirRoster: AdviceOpponent[];
  comps: AdviceComp[];
  lanes: AdviceLane[];
  /** Champions the model may name. Already legal for this step. */
  candidates: string[];
  /** Solo queue win rate at large, where known, keyed by champion. */
  soloRates: Record<string, number>;
  /** Our candidate into their champion in the seat, where the sample allows. */
  matchups: { ours: string; theirs: string; winRate: number; games: number }[];
  /** Free text from the scouting notes, trimmed. */
  notes?: string;
}

export interface DraftAdvice {
  summary: string;
  picks: { champion: string; seat: KnownRole | null; why: string; confidence: 'high' | 'medium' | 'low' }[];
  bans: { champion: string; why: string }[];
  /** What to watch for in their next moves. */
  watch: string[];
}

const MAX_CANDIDATES = 80;
const MAX_NOTES = 1500;
const ROLES: KnownRole[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

function str(v: unknown, max = 60): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function strList(v: unknown, max = 40, each = 60): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : [];
}

function role(v: unknown): KnownRole | null {
  return typeof v === 'string' && (ROLES as string[]).includes(v) ? (v as KnownRole) : null;
}

function picks(v: unknown): Partial<Record<KnownRole, string>> {
  const out: Partial<Record<KnownRole, string>> = {};
  if (!v || typeof v !== 'object') return out;
  for (const r of ROLES) {
    const champ = str((v as Record<string, unknown>)[r]);
    if (champ) out[r] = champ;
  }
  return out;
}

/** Reject anything that is not the shape the draft room sends. */
export function parseDraftAdviceRequest(body: unknown): DraftAdviceRequest {
  if (!body || typeof body !== 'object') throw new Error('Invalid payload. Expected a JSON object.');
  const b = body as Record<string, unknown>;

  const action = b.action === 'ban' || b.action === 'pick' ? b.action : null;
  if (!action) throw new Error('action must be "ban" or "pick".');
  const candidates = strList(b.candidates, MAX_CANDIDATES);
  if (!candidates.length) throw new Error('candidates must name at least one champion.');

  const roster = (v: unknown, opponent: boolean): AdviceOpponent[] =>
    Array.isArray(v)
      ? v
          .map((p) => {
            const row = (p ?? {}) as Record<string, unknown>;
            const r = role(row.role);
            if (!r) return null;
            const out: AdviceOpponent = { name: str(row.name, 40) || 'player', role: r, pool: strList(row.pool, 12) };
            if (opponent) {
              out.rank = str(row.rank, 30) || undefined;
              out.counters = strList(row.counters, 8);
              out.mastery = Array.isArray(row.mastery)
                ? row.mastery
                    .map((x) => {
                      const m = (x ?? {}) as Record<string, unknown>;
                      const champion = str(m.champion);
                      const level = Number(m.level);
                      const points = Number(m.points);
                      return champion && Number.isFinite(points)
                        ? { champion, level: Number.isFinite(level) ? Math.max(0, Math.round(level)) : 0, points: Math.max(0, Math.round(points)) }
                        : null;
                    })
                    .filter((x): x is { champion: string; level: number; points: number } => !!x)
                    .slice(0, 8)
                : [];
              out.records = Array.isArray(row.records)
                ? row.records
                    .map((x) => {
                      const rec = (x ?? {}) as Record<string, unknown>;
                      const champion = str(rec.champion);
                      const games = Number(rec.games);
                      const wins = Number(rec.wins);
                      return champion && Number.isFinite(games) && Number.isFinite(wins)
                        ? { champion, games: Math.max(0, Math.round(games)), wins: Math.max(0, Math.round(wins)) }
                        : null;
                    })
                    .filter((x): x is { champion: string; games: number; wins: number } => !!x)
                    .slice(0, 12)
                : [];
            }
            return out;
          })
          .filter((x): x is AdviceOpponent => !!x)
          .slice(0, 7)
      : [];

  const comps: AdviceComp[] = Array.isArray(b.comps)
    ? b.comps
        .map((c): AdviceComp | null => {
          const row = (c ?? {}) as Record<string, unknown>;
          const name = str(row.name, 40);
          if (!name) return null;
          const winRate = Number(row.winRate);
          const games = Number(row.games);
          return {
            name,
            champions: strList(row.champions, 5),
            winRate: Number.isFinite(winRate) ? Math.round(winRate) : undefined,
            games: Number.isFinite(games) ? Math.round(games) : undefined,
            playable: row.playable === true,
            blocked: strList(row.blocked, 5)
          };
        })
        .filter((x): x is AdviceComp => !!x)
        .slice(0, 20)
    : [];

  const lanes: AdviceLane[] = Array.isArray(b.lanes)
    ? b.lanes
        .map((l): AdviceLane | null => {
          const row = (l ?? {}) as Record<string, unknown>;
          const lane = str(row.lane, 10);
          if (!lane) return null;
          const score = Number(row.score);
          return {
            lane,
            verdict: str(row.verdict, 10) || 'unknown',
            score: Number.isFinite(score) ? Math.round(score) : 0,
            reasons: strList(row.reasons, 4, 160)
          };
        })
        .filter((x): x is AdviceLane => !!x)
        .slice(0, 4)
    : [];

  const soloRates: Record<string, number> = {};
  if (b.soloRates && typeof b.soloRates === 'object') {
    for (const [champ, rate] of Object.entries(b.soloRates as Record<string, unknown>)) {
      const n = Number(rate);
      if (champ && Number.isFinite(n)) soloRates[str(champ)] = Math.round(n);
    }
  }

  const matchups = Array.isArray(b.matchups)
    ? b.matchups
        .map((m) => {
          const row = (m ?? {}) as Record<string, unknown>;
          const ours = str(row.ours);
          const theirs = str(row.theirs);
          const winRate = Number(row.winRate);
          const games = Number(row.games);
          return ours && theirs && Number.isFinite(winRate) && Number.isFinite(games)
            ? { ours, theirs, winRate: Math.round(winRate), games: Math.round(games) }
            : null;
        })
        .filter((x): x is DraftAdviceRequest['matchups'][number] => !!x)
        .slice(0, MAX_CANDIDATES)
    : [];

  const stepNumber = Number(b.stepNumber);
  return {
    teamName: str(b.teamName, 40) || 'Us',
    opponent: str(b.opponent, 40) || 'Them',
    action,
    turn: b.turn === 'their' ? 'their' : 'our',
    stepNumber: Number.isFinite(stepNumber) ? Math.max(1, Math.round(stepNumber)) : 1,
    ourSide: b.ourSide === 'blue' || b.ourSide === 'red' ? b.ourSide : null,
    seat: role(b.seat),
    ourPicks: picks(b.ourPicks),
    theirPicks: picks(b.theirPicks),
    bans: strList(b.bans, 10),
    burned: strList(b.burned, 40),
    ourRoster: roster(b.ourRoster, false),
    theirRoster: roster(b.theirRoster, true),
    comps,
    lanes,
    candidates,
    soloRates,
    matchups,
    notes: str(b.notes, MAX_NOTES) || undefined
  };
}

/**
 * Stable across calls, so it caches; nothing about this draft is in it.
 * The rules matter more than the persona: the model must stay inside the
 * candidate list, respect fearless, and say when a sample is too small.
 */
export const ADVISOR_SYSTEM = `You are the draft coach for an amateur League of Legends five-stack playing a fearless-draft best-of series. You are asked one question at a time, with the clock running, and answer in a few plain sentences a player can act on immediately.

Rules that never bend:
- Only name champions from the CANDIDATES list. Anything else is banned, burned, already picked, or does not fit the seat, and naming it wastes the turn.
- Under fearless draft, a champion used by either team earlier in the series is gone for the rest of it. Weigh a pick against what it costs later games too.
- Prefer champions the player in that seat actually plays. A strong champion nobody on the roster plays is not a pick.
- Our own comp records are tens of games; solo queue and matchup rates are thousands. Say which you are leaning on, and say when a number is too thin to trust.
- The TEAM PLAN is the team's own intent, written before the draft. Lead with it: when the plan names a pick and it is still legal, it is your first answer. Deviate only when the board has made it a bad idea, and say so in the summary.
- Rank, do not list. Give at most three picks or three bans, best first, each with one sentence of reason that names the evidence.
- No hedging boilerplate, no headings, no markdown. The team can read; be direct.

Answer length, because the draft clock is thirty seconds and every word costs time:
- Answer only what was asked. For a pick question leave "bans" empty; for a ban question leave "picks" empty.
- "summary" is one sentence. Each "why" is one clause under 20 words that names the evidence.
- "watch" has at most two items, each under 12 words. Leave it empty if there is nothing worth watching.
- When a ban or a burn matters, say it plainly: "with Renekton banned", "Udyr is burned". Never fold it into a compound word like "Renekton-less" — under the clock that reads as the opposite.`;

/** 412345 -> "412k", 1.2M for the millions; the prompt does not need the units digit. */
function masteryPoints(points: number): string {
  return points >= 1_000_000 ? `${(points / 1_000_000).toFixed(1)}M` : `${Math.round(points / 1000)}k`;
}

function pickLine(p: Partial<Record<KnownRole, string>>): string {
  return ROLES.map((r) => `${r}: ${p[r] ?? '—'}`).join(', ');
}

/** The draft as text the model reads once. */
export function buildDraftPrompt(req: DraftAdviceRequest): string {
  const lines: string[] = [];
  const asking =
    req.action === 'ban'
      ? req.turn === 'our'
        ? `We are banning (ban ${req.stepNumber}). Which champion should we ban, and why?`
        : `They are banning. What are they likely to take from us, and what should we be ready to pick after?`
      : req.turn === 'our'
        ? `We are picking${req.seat ? ` for ${req.seat}` : ''} (step ${req.stepNumber}). Which champion should we take, and why?`
        : `They are picking next. What should we expect, and what should we prepare to answer with?`;

  lines.push(`QUESTION: ${asking}`);
  if (req.action === 'pick' && req.turn === 'our' && !req.seat) {
    const open = ROLES.filter((r) => !req.ourPicks[r]);
    if (open.length) {
      lines.push(`SEATS STILL OPEN FOR US: ${open.join(', ')} — choose the seat as well as the champion, and set "seat" on each pick.`);
    }
  }
  lines.push('');
  if (req.notes) {
    lines.push('TEAM PLAN (our own notes for this series, written before the draft; may be in Afrikaans):');
    lines.push(req.notes);
    lines.push('');
  }

  lines.push(`SERIES: ${req.teamName} vs ${req.opponent}. We are on ${req.ourSide ?? 'an unknown'} side.`);
  lines.push(`OUR PICKS: ${pickLine(req.ourPicks)}`);
  lines.push(`THEIR PICKS: ${pickLine(req.theirPicks)}`);
  lines.push(`BANS THIS GAME: ${req.bans.length ? req.bans.join(', ') : 'none yet'}`);
  lines.push(`BURNED EARLIER IN THE SERIES: ${req.burned.length ? req.burned.join(', ') : 'none — first game'}`);
  lines.push('');

  lines.push('OUR ROSTER (most played first):');
  for (const p of req.ourRoster) lines.push(`- ${p.role} ${p.name}: ${p.pool.join(', ') || 'unknown pool'}`);
  lines.push('');

  lines.push('THEIR ROSTER (scouted from ranked history):');
  if (!req.theirRoster.length) lines.push('- not scouted');
  for (const p of req.theirRoster) {
    const records = (p.records ?? [])
      .map((r) => `${r.champion} ${r.wins}/${r.games}`)
      .join(', ');
    lines.push(
      `- ${p.role} ${p.name}${p.rank ? ` (${p.rank})` : ''}: plays ${records || p.pool.join(', ') || 'unknown'}` +
        (p.counters?.length ? `; loses to ${p.counters.join(', ')}` : '') +
        (p.mastery?.length
          ? `; mastery ${p.mastery.slice(0, 5).map((m) => `${m.champion} M${m.level} ${masteryPoints(m.points)}`).join(', ')}`
          : '')
    );
  }
  lines.push('');

  if (req.comps.length) {
    lines.push('OUR COMPS (record from our own games; playable = every champion still available this game):');
    for (const c of req.comps) {
      const record = c.games ? `${c.winRate}% over ${c.games}` : 'no games yet';
      lines.push(
        `- ${c.name}: ${c.champions.join(', ')} — ${record}${c.playable ? '' : `; BROKEN, missing ${c.blocked.join(', ')}`}`
      );
    }
    lines.push('');
  }

  if (req.lanes.length) {
    lines.push('LANE READ SO FAR (from matchup data, solo queue rates, pools and traits):');
    for (const l of req.lanes) {
      lines.push(`- ${l.lane}: ${l.verdict} (${l.score > 0 ? '+' : ''}${l.score})${l.reasons.length ? ` — ${l.reasons.join('; ')}` : ''}`);
    }
    lines.push('');
  }

  if (req.matchups.length) {
    lines.push('MATCHUP RATES (our candidate into their champion in that seat, solo queue, this patch):');
    for (const m of req.matchups) lines.push(`- ${m.ours} into ${m.theirs}: ${m.winRate}% over ${m.games} games`);
    lines.push('');
  }

  const rated = Object.entries(req.soloRates);
  if (rated.length) {
    lines.push('SOLO QUEUE WIN RATES (champion at large, this patch):');
    lines.push(rated.map(([c, r]) => `${c} ${r}%`).join(', '));
    lines.push('');
  }


  lines.push(`CANDIDATES (the only champions you may name): ${req.candidates.join(', ')}`);
  return lines.join('\n');
}

/** What the model must return. Kept flat so a draft screen can render it as-is. */
export const ADVICE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One or two sentences: the situation and the call.' },
    picks: {
      type: 'array',
      description: 'At most three, best first.',
      items: {
        type: 'object',
        properties: {
          champion: { type: 'string' },
          seat: { anyOf: [{ type: 'string', enum: [...ROLES] }, { type: 'null' }] },
          why: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['champion', 'seat', 'why', 'confidence'],
        additionalProperties: false
      }
    },
    bans: {
      type: 'array',
      description: 'At most three, best first.',
      items: {
        type: 'object',
        properties: { champion: { type: 'string' }, why: { type: 'string' } },
        required: ['champion', 'why'],
        additionalProperties: false
      }
    },
    watch: { type: 'array', description: 'At most three.', items: { type: 'string' } }
  },
  required: ['summary', 'picks', 'bans', 'watch'],
  additionalProperties: false
} as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The answer, checked against the question.
 *
 * A champion outside the candidate list is dropped rather than shown — it is
 * banned, burned or picked, and a suggestion the drafter cannot take is
 * worse than a shorter list. The candidate's own spelling is used, so the
 * app can resolve its icon.
 */
export function parseAdvice(value: unknown, candidates: readonly string[]): DraftAdvice {
  const v = (value ?? {}) as Record<string, unknown>;
  const allowed = new Map(candidates.map((c) => [norm(c), c]));
  const resolve = (name: unknown) => (typeof name === 'string' ? allowed.get(norm(name)) : undefined);

  const picks = Array.isArray(v.picks)
    ? v.picks
        .map((p) => {
          const row = (p ?? {}) as Record<string, unknown>;
          const champion = resolve(row.champion);
          if (!champion) return null;
          const confidence = row.confidence === 'high' || row.confidence === 'low' ? row.confidence : 'medium';
          return { champion, seat: role(row.seat), why: str(row.why, 400), confidence };
        })
        .filter((x): x is DraftAdvice['picks'][number] => !!x)
        .slice(0, 3)
    : [];

  const bans = Array.isArray(v.bans)
    ? v.bans
        .map((b) => {
          const row = (b ?? {}) as Record<string, unknown>;
          const champion = resolve(row.champion);
          return champion ? { champion, why: str(row.why, 400) } : null;
        })
        .filter((x): x is DraftAdvice['bans'][number] => !!x)
        .slice(0, 3)
    : [];

  return {
    summary: str(v.summary, 600),
    picks,
    bans,
    watch: strList(v.watch, 3, 300)
  };
}
