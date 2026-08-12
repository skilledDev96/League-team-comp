import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

type AccessRole = 'admin' | 'contributor' | 'viewer';
type KnownRole = 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support';

interface EnrichRequest {
  summonerName: string;
  riotTag?: string;
  region?: string;
  role?: KnownRole;
  mobalyticsSlug?: string;
}

interface EnrichResponse {
  playstyle: string;
  strengths: string[];
  weaknesses: string[];
  source: 'template' | 'provider';
  provider: string;
  generatedAt: string;
}

const BOOTSTRAP_ADMIN_EMAILS = new Set(['ruanhart7@gmail.com']);

const ROLE_TEMPLATES: Record<KnownRole, Omit<EnrichResponse, 'generatedAt'>> = {
  Top: {
    playstyle: 'Lane-priority bruiser with side-lane threat and TP timing focus.',
    strengths: ['Strong wave control', 'Reliable flank setups', 'Objective setup discipline'],
    weaknesses: ['Can overextend in side lane', 'Needs cleaner herald-to-drake transitions', 'Vulnerable to early camp pressure'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  Jungle: {
    playstyle: 'Tempo-oriented pathing with objective-first decision making.',
    strengths: ['Good route efficiency', 'Consistent objective tracking', 'High impact early skirmishes'],
    weaknesses: ['Can force low-percentage invades', 'Needs cleaner lane-cover timing', 'Occasional vision debt before objectives'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  Mid: {
    playstyle: 'Wave-control mid with roam windows around jungle pressure.',
    strengths: ['Wave management under pressure', 'Strong river skirmish setups', 'Reliable teamfight positioning'],
    weaknesses: ['Roam timing can be late', 'Can overhold flash for picks', 'Needs tighter side-lane reset timing'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  ADC: {
    playstyle: 'Teamfight carry with spacing-first mindset and objective DPS focus.',
    strengths: ['Consistent damage output', 'Good lane trading patterns', 'Strong late-game positioning'],
    weaknesses: ['Can greed one extra wave', 'Needs cleaner trap around fog', 'Relies heavily on front-to-back setup'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  Support: {
    playstyle: 'Vision-control support enabling engage or peel by draft context.',
    strengths: ['Objective vision discipline', 'Strong engage timing reads', 'Good lane matchup adaptation'],
    weaknesses: ['Can overcommit engage without cooldown checks', 'Roam windows occasionally too early', 'Needs faster ward reset cadence'],
    source: 'template',
    provider: 'built-in-role-template'
  }
};

function normalizeEmail(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function parseRequest(body: unknown): EnrichRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid payload. Expected a JSON object.');
  }

  const candidate = body as Record<string, unknown>;
  const summonerName = typeof candidate.summonerName === 'string' ? candidate.summonerName.trim() : '';
  if (!summonerName) {
    throw new Error('summonerName is required.');
  }

  const role = typeof candidate.role === 'string' ? candidate.role.trim() : '';
  if (role && !Object.keys(ROLE_TEMPLATES).includes(role)) {
    throw new Error('role must be one of Top, Jungle, Mid, ADC, Support.');
  }

  return {
    summonerName,
    riotTag: typeof candidate.riotTag === 'string' ? candidate.riotTag.trim() : undefined,
    region: typeof candidate.region === 'string' ? candidate.region.trim().toLowerCase() : undefined,
    role: role ? (role as KnownRole) : undefined,
    mobalyticsSlug: typeof candidate.mobalyticsSlug === 'string' ? candidate.mobalyticsSlug.trim() : undefined
  };
}

async function getAccessRoleByEmail(email: string): Promise<AccessRole | null> {
  if (BOOTSTRAP_ADMIN_EMAILS.has(email)) {
    return 'admin';
  }

  const db = getFirestore();
  const snap = await db.doc(`access/${email}`).get();
  if (!snap.exists) {
    return null;
  }

  const data = snap.data() as { role?: AccessRole; active?: boolean } | undefined;
  if (!data?.active || !data.role) {
    return null;
  }

  return data.role;
}

async function enrichPlayerProfile(payload: EnrichRequest): Promise<EnrichResponse> {
  const role = payload.role ?? 'Mid';
  const template = ROLE_TEMPLATES[role];

  // Placeholder adapter. Replace with a licensed provider or your own dataset.
  return {
    playstyle: template.playstyle,
    strengths: template.strengths,
    weaknesses: template.weaknesses,
    source: template.source,
    provider: template.provider,
    generatedAt: new Date().toISOString()
  };
}

export const enrichPlayer = onRequest({ cors: true }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const idToken = parseBearerToken(req.headers.authorization);
    if (!idToken) {
      res.status(401).json({ error: 'Missing Authorization: Bearer <ID_TOKEN> header.' });
      return;
    }

    const auth = getAuth();
    const decoded = await auth.verifyIdToken(idToken);
    const email = normalizeEmail(decoded.email);
    if (!email) {
      res.status(401).json({ error: 'Authenticated user has no email claim.' });
      return;
    }

    const role = await getAccessRoleByEmail(email);
    if (role !== 'admin' && role !== 'contributor') {
      res.status(403).json({ error: 'Insufficient role. Admin or contributor required.' });
      return;
    }

    const payload = parseRequest(req.body);
    const enriched = await enrichPlayerProfile(payload);
    res.status(200).json(enriched);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    res.status(400).json({ error: message });
  }
});
