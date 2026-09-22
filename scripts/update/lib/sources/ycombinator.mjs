/**
 * Discovery from the Y Combinator directory.
 *
 * Source: https://yc-oss.github.io/api/companies/all.json - a community mirror
 * of YC's public company list, one ~10MB document covering every batch. One
 * request per run, and the whole filter runs in memory afterwards.
 *
 * What this source can and cannot tell us matters for the merge. It is a
 * directory listing, so everything it produces is `trust: 'directory'` - it
 * fills blanks and never overwrites a human-verified field. In particular YC
 * `tags` are market/domain labels ("Developer Tools", "Fintech"), never a
 * technology stack, so nothing here may end up claiming a company writes Go.
 */

const DIRECTORY_URL = 'https://yc-oss.github.io/api/companies/all.json';

export const id = 'ycombinator';
export const label = 'Y Combinator';

/** YC writes country names the way Americans say them. */
const COUNTRY_ALIASES = {
  usa: 'United States',
  us: 'United States',
  'u.s.': 'United States',
  'u.s.a.': 'United States',
  'united states of america': 'United States',
  uk: 'United Kingdom',
  'u.k.': 'United Kingdom',
  uae: 'United Arab Emirates',
};

/** Comparison form for names; deliberately exact-after-normalizing, not fuzzy. */
const normalizeName = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const kebab = (value) =>
  String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Company keywords are capped well below the dataset's own limit of 10. */
const MAX_KEYWORDS = 8;

/** Patterns are built from the config file, never from the fetched directory. */
const matcherCache = new Map();

function wordMatcher(term) {
  const key = String(term);
  let regex = matcherCache.get(key);
  if (regex === undefined) {
    const escaped = key.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Whole-word so a filter of "data" does not sweep in every company whose
    // one-liner mentions "metadata".
    regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
    matcherCache.set(key, regex);
  }
  return regex;
}

function matchesAny(terms, haystack) {
  return terms.some((term) => wordMatcher(term).test(haystack));
}

/** Semicolon-separated, e.g. "San Francisco, CA, USA; Remote". */
function locationSegments(record) {
  return String(record.all_locations ?? '')
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
}

function normalizeCountry(segment) {
  const parts = segment.split(',').map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (last === undefined || last === '') return null;
  if (/^remote$/i.test(last)) return null;
  return COUNTRY_ALIASES[last.toLowerCase()] ?? last;
}

/**
 * YC's `regions` distinguishes "Fully Remote" from "Partly Remote", which is a
 * cleaner signal than reading the location string. Absence of either is left as
 * null: a company with an office and no remote tag has told us nothing about
 * whether it allows remote work, and "onsite" would be our guess, not its word.
 */
function remotePolicy(record, segments) {
  const regions = Array.isArray(record.regions) ? record.regions.map(String) : [];
  const hasRemoteSegment = segments.some((segment) => /^remote$/i.test(segment));
  const physical = segments.filter((segment) => !/^remote$/i.test(segment));

  // YC's own label wins over the location string: plenty of companies tagged
  // "Fully Remote" still list a head office, and their tag is the better
  // authority on how they actually work than our reading of their address.
  if (regions.includes('Fully Remote')) return 'remote';
  if (regions.includes('Partly Remote')) return 'hybrid';
  if (hasRemoteSegment) return physical.length > 0 ? 'hybrid' : 'remote';
  return null;
}

/**
 * Domain labels only. Anything that collides with the technology vocabulary is
 * dropped: YC tagging a company "Kubernetes" means it sells Kubernetes tooling,
 * and letting that land in the same field the job scanner writes to would read
 * as "this company's engineers use Kubernetes", which we did not establish.
 */
function deriveKeywords(record, technologyTags) {
  const labels = [
    ...(Array.isArray(record.tags) ? record.tags : []),
    ...(Array.isArray(record.industries) ? record.industries : []),
  ];

  const keywords = [];
  for (const label of labels) {
    const tag = kebab(label);
    if (tag === '' || tag.length > 40) continue;
    if (technologyTags.has(tag)) continue;
    if (!keywords.includes(tag)) keywords.push(tag);
  }
  return keywords.slice(0, MAX_KEYWORDS);
}

function website(record) {
  if (typeof record.website !== 'string') return null;
  try {
    const url = new URL(record.website.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    // ~600 Active YC records still carry an http:// URL. The dataset schema
    // requires https, and these all redirect there anyway, so the scheme is
    // normalized rather than dropping the company over it.
    url.protocol = 'https:';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function toCandidate(record, technologyTags) {
  const segments = locationSegments(record);
  const physical = segments.filter((segment) => !/^remote$/i.test(segment));
  const size = Number.isInteger(record.team_size) && record.team_size > 0 ? record.team_size : null;
  const batch = typeof record.batch === 'string' && record.batch !== '' ? record.batch : null;

  return {
    name: String(record.name ?? '').trim(),
    website: website(record),
    description: String(record.one_liner ?? '').trim(),
    sizeMin: size,
    sizeMax: size,
    sizeRange: size === null ? null : String(size),
    hqLocation: physical[0] ?? (segments.length > 0 ? segments[0] : null),
    country: physical.length > 0 ? normalizeCountry(physical[0]) : null,
    keywords: deriveKeywords(record, technologyTags),
    remotePolicy: remotePolicy(record, segments),
    sourceNote: batch === null
      ? 'Discovered via Y Combinator directory.'
      : `Discovered via Y Combinator directory (${batch} batch).`,
  };
}

/**
 * @param {{ get: Function }} http the shared polite client
 * @param {object} config parsed research.config.json
 * @returns {Promise<{ candidates: object[], diagnostics: string }>}
 *   An empty candidate list on failure. Discovery adding nothing is harmless -
 *   unlike a position scan, it can never erase anything - so this reports the
 *   failure in `diagnostics` rather than signalling it out of band.
 */
export async function discover(http, config) {
  const response = await http.get(DIRECTORY_URL);
  if (!response.ok) {
    return { candidates: [], diagnostics: `${id} - directory unreachable (HTTP ${response.status})` };
  }

  const records = response.json();
  if (!Array.isArray(records)) {
    return { candidates: [], diagnostics: `${id} - directory response was not a list` };
  }

  const discovery = config?.discovery ?? {};
  const includeTerms = (discovery.keywords ?? []).filter((term) => typeof term === 'string' && term.trim() !== '');
  const excludeTerms = (discovery.excludeKeywords ?? []).filter((term) => typeof term === 'string' && term.trim() !== '');
  const regionTerms = (discovery.regions ?? []).filter((term) => typeof term === 'string' && term.trim() !== '');
  // The directory lists entities that are not companies we want to catalogue -
  // Y Combinator itself, most obviously. Matched on the exact normalized name,
  // so a real company with a similar name is never caught by it.
  const excludeNames = new Set(
    (discovery.excludeNames ?? [])
      .filter((name) => typeof name === 'string')
      .map((name) => normalizeName(name))
      .filter((name) => name !== ''),
  );
  const minSize = Number.isInteger(discovery.minEmployeeCount) ? discovery.minEmployeeCount : null;
  const maxSize = Number.isInteger(discovery.maxEmployeeCount) ? discovery.maxEmployeeCount : null;
  const cap = Number.isInteger(discovery.maxNewPerRun) && discovery.maxNewPerRun > 0
    ? discovery.maxNewPerRun
    : records.length;

  // Tags the position scanner owns; see deriveKeywords.
  const technologyTags = new Set(Object.keys(config?.keywordVocabulary ?? {}));

  const matched = [];
  const rejected = { inactive: 0, noWebsite: 0, size: 0, keywords: 0, excluded: 0, region: 0, byName: 0 };

  for (const record of records) {
    if (record === null || typeof record !== 'object') continue;
    if (String(record.name ?? '').trim() === '') continue;

    if (excludeNames.has(normalizeName(record.name))) {
      rejected.byName += 1;
      continue;
    }

    if (discovery.requireActive !== false && record.status !== 'Active') {
      rejected.inactive += 1;
      continue;
    }

    const site = website(record);
    if (discovery.requireWebsite !== false && site === null) {
      rejected.noWebsite += 1;
      continue;
    }

    const size = Number.isInteger(record.team_size) ? record.team_size : null;
    if (minSize !== null || maxSize !== null) {
      // An unknown headcount cannot satisfy a headcount filter.
      if (size === null || (minSize !== null && size < minSize) || (maxSize !== null && size > maxSize)) {
        rejected.size += 1;
        continue;
      }
    }

    const labels = [
      ...(Array.isArray(record.tags) ? record.tags : []),
      ...(Array.isArray(record.industries) ? record.industries : []),
    ].join(' ');
    const shortText = `${labels} ${record.one_liner ?? ''}`;
    const longText = `${shortText} ${record.long_description ?? ''}`;

    if (excludeTerms.length > 0 && matchesAny(excludeTerms, longText)) {
      rejected.excluded += 1;
      continue;
    }

    if (includeTerms.length > 0 && !matchesAny(includeTerms, shortText)) {
      rejected.keywords += 1;
      continue;
    }

    if (regionTerms.length > 0) {
      const regionText = [
        ...(Array.isArray(record.regions) ? record.regions : []),
        record.all_locations ?? '',
      ].join(' ');
      if (!matchesAny(regionTerms, regionText)) {
        rejected.region += 1;
        continue;
      }
    }

    matched.push(record);
  }

  // When the cap bites, companies that say they are hiring are the ones worth
  // scanning next week. Directory order is preserved within each group so two
  // runs over an unchanged directory return the same companies.
  const hiring = matched.filter((record) => record.isHiring === true);
  const rest = matched.filter((record) => record.isHiring !== true);
  const byHiring = discovery.preferHiring === false ? matched : [...hiring, ...rest];
  // Within that, companies that say they hire remotely, then startups and
  // mid-size teams, come first — the directory is for them. A stable sort, so
  // directory order still breaks ties and repeated runs agree.
  const rank = (record) => {
    const regions = Array.isArray(record.regions) ? record.regions : [];
    const remote = regions.includes('Fully Remote') || regions.includes('Remote')
      || /\bremote\b/i.test(String(record.all_locations ?? ''));
    const size = Number.isInteger(record.team_size) ? record.team_size : null;
    return (remote ? 0 : 2) + (size === null || size <= 500 ? 0 : 1);
  };
  const ordered = byHiring
    .map((record, index) => ({ record, index, hiring: record.isHiring === true }))
    .sort((a, b) => {
      if (discovery.preferHiring !== false && a.hiring !== b.hiring) return a.hiring ? -1 : 1;
      return rank(a.record) - rank(b.record) || a.index - b.index;
    })
    .map(({ record }) => record);
  const selected = ordered.slice(0, cap);

  const candidates = selected.map((record) => toCandidate(record, technologyTags));

  const diagnostics =
    `${id} - ${records.length} in directory, ${matched.length} matched ` +
    `(${hiring.length} hiring), ${candidates.length} returned` +
    (matched.length > candidates.length ? ` (capped at ${cap})` : '');

  return { candidates, diagnostics };
}
