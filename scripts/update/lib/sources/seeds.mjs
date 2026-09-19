/**
 * Discovery from a hand-curated list in research.config.json.
 *
 * Every other source reads a directory that publishes machine-readable data.
 * Some ecosystems do not have one we can reach: Startup Estonia's database is a
 * white-label Dealroom portal at ecosystem.startupestonia.ee that answers every
 * request — including its own robots.txt — with a Cloudflare interstitial, and
 * LinkedIn's robots.txt forbids automated access outright. Rather than pretend
 * we have a feed for those, this source takes the list a human wrote down.
 *
 * It makes no network requests at all. A seed says only "this company exists
 * and lives at this domain"; everything else — whether it is hiring, on which
 * board, in which country — is established later by the normal refresh scan
 * against the company's own site. That division is the point: a seed is a
 * pointer, never a claim about a company's data.
 *
 * Seeds carry `trust: 'directory'` like any other source, so they fill blanks
 * and can never overwrite a field confirmed against a primary source.
 */

export const id = 'seeds';
export const label = 'Curated seed list';

/** Comparison form for names; exact-after-normalizing, deliberately not fuzzy. */
const normalizeName = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Cap borrowed from the dataset schema rather than invented here. */
const MAX_KEYWORDS = 8;

const REMOTE_POLICIES = new Set(['remote', 'hybrid', 'onsite']);

/**
 * The config file is local and trusted, but a typo in it should degrade one
 * entry rather than corrupt a record — so every field is validated the same way
 * a fetched one would be.
 */
function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed === '' || trimmed.length > max) return null;
  return trimmed;
}

/** https origin, no path, no trailing slash — the shape the pipeline expects. */
function website(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.protocol = 'https:';
    return url.origin;
  } catch {
    return null;
  }
}

/** Any http(s) URL, path included — a careers link is usually a deep link. */
function careersUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function toCandidate(entry) {
  const name = cleanText(entry.name, 80);
  const site = website(entry.website);
  // A seed without a name or a resolvable-looking domain is not a pointer to
  // anything — the refresh scan has nowhere to go — so it is dropped rather
  // than stored as a record that can never be filled in.
  if (name === null || site === null) return null;

  const policy = typeof entry.remotePolicy === 'string' && REMOTE_POLICIES.has(entry.remotePolicy)
    ? entry.remotePolicy
    : null;

  const keywords = Array.isArray(entry.keywords)
    ? entry.keywords
        .map((keyword) => cleanText(keyword, 40))
        .filter((keyword) => keyword !== null)
        .slice(0, MAX_KEYWORDS)
    : [];

  return {
    name,
    website: site,
    description: cleanText(entry.description, 280) ?? '',
    // Headcount is left to research. A number typed into a config file ages
    // silently and has no source attached to it.
    sizeMin: null,
    sizeMax: null,
    sizeRange: null,
    hqLocation: cleanText(entry.hqLocation, 120),
    country: cleanText(entry.country, 80),
    keywords,
    remotePolicy: policy,
    careersUrl: careersUrl(entry.careersUrl),
    sourceNote: cleanText(entry.note, 280) ?? `Added from the curated seed list (${label}).`,
  };
}

/**
 * @param {{ get: Function }} _http unused; seeds are local by design
 * @param {object} config parsed research.config.json
 * @returns {Promise<{ candidates: object[], diagnostics: string }>}
 */
export async function discover(_http, config) {
  const discovery = config?.discovery ?? {};
  const entries = discovery.seeds?.companies;

  if (!Array.isArray(entries) || entries.length === 0) {
    return { candidates: [], diagnostics: `${id} — no seed list configured (discovery.seeds.companies)` };
  }

  const excludeNames = new Set(
    (discovery.excludeNames ?? [])
      .filter((name) => typeof name === 'string')
      .map((name) => normalizeName(name))
      .filter((name) => name !== ''),
  );

  const cap = Number.isInteger(discovery.maxNewPerRun) && discovery.maxNewPerRun > 0
    ? discovery.maxNewPerRun
    : entries.length;

  const seen = new Set();
  const candidates = [];
  let malformed = 0;
  let duplicate = 0;

  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') {
      malformed += 1;
      continue;
    }

    const candidate = toCandidate(entry);
    if (candidate === null) {
      malformed += 1;
      continue;
    }
    if (excludeNames.has(normalizeName(candidate.name))) continue;

    // The same company listed twice in the config is a maintenance slip, not a
    // second company. Deduped on host as well as name because the usual way it
    // happens is one entry per brand spelling.
    const key = `${normalizeName(candidate.name)} ${new URL(candidate.website).host}`;
    if (seen.has(key)) {
      duplicate += 1;
      continue;
    }
    seen.add(key);

    candidates.push(candidate);
    if (candidates.length >= cap) break;
  }

  const notes = [`${entries.length} seeded`, `${candidates.length} returned`];
  if (malformed > 0) notes.push(`${malformed} malformed`);
  if (duplicate > 0) notes.push(`${duplicate} duplicate`);
  if (entries.length > candidates.length + malformed + duplicate) notes.push(`capped at ${cap}`);

  return { candidates, diagnostics: `${id} — ${notes.join(', ')}` };
}
