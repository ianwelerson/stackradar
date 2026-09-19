/**
 * Discovery from Work at a Startup, Y Combinator's job board.
 *
 * Sources, both first-party and both public:
 *   GET /jobs?role=eng        Inertia HTML; props ride in a `data-page` attribute
 *   GET /jobs/search?q=<term> plain JSON, {"jobs":[...]}, same record shape
 * robots.txt is `Disallow:` with an empty value, i.e. everything is allowed.
 *
 * Why this exists alongside the YC directory source, which covers the same
 * companies: the directory lists every company YC ever funded and says whether
 * it is hiring; this reads the roles themselves. A company appearing here is
 * hiring engineers *today*, which is the population this catalogue is about.
 *
 * Coverage comes from a query sweep, not a page counter. Nothing on WAAS
 * paginates for us: `?page=N` is ignored by the Inertia HTML, by the Inertia
 * XHR *with* both headers set, and by the search endpoint, which also ignores
 * `limit` and `hitsPerPage`. Every one of them answers with the same 30
 * records. What does vary is the query — `rust`, `python`, `frontend` and
 * `devops` returned 93 distinct companies between them in four requests — so
 * this walks a vocabulary of terms and unions the results.
 *
 * Two consequences of that, both load-bearing for how the output reads:
 *
 * 1. Thirty per query is a server cap, not a count of what exists. A company
 *    missing from the union may simply not have ranked for any term we asked.
 *    Absence here is never evidence that a company stopped hiring — only the
 *    ATS adapter's confirmed read of a board may say that.
 * 2. The endpoint ranks rather than filters. `q=zzqqxnonsense` still returns a
 *    full 30 records, so a query is a way to sample a different slice of the
 *    board, not an assertion about the roles that come back. Nothing here reads
 *    a technology into a company because a technology term retrieved it.
 *
 * Everything produced is `trust: 'directory'`: it fills blanks and never
 * overwrites a human-verified field. In particular WAAS `industries` are market
 * labels ("B2B Software and Services"), never a technology stack, so nothing
 * here may end up claiming a company writes Go.
 *
 * The profile reader and the Inertia parser are imported from the matching ATS
 * adapter rather than copied. Both halves read the same payload from the same
 * app, and a second private copy of either would drift from it the first time
 * WAAS renames a field. Direction matters: sources may lean on ats/, nothing in
 * ats/ imports a source, so there is no cycle.
 */
import {
  HTML_ACCEPT,
  boardUrl,
  countryFromLocation,
  fetchCompanyProfile,
  parseInertiaPage,
} from '../ats/workatastartup.mjs';

export const id = 'workatastartup';
export const label = 'Work at a Startup (Y Combinator)';

const JOBS_URL = 'https://www.workatastartup.com/jobs';
const SEARCH_URL = 'https://www.workatastartup.com/jobs/search';

/** Unlike /jobs, which 406s on anything but HTML, the search endpoint speaks
 *  JSON and wants to be asked for it. */
const JSON_ACCEPT = 'application/json';

/** WAAS role facets, from the feed's own `roles` prop. The role is read from
 *  config and goes into a URL, so it is checked against the real list rather
 *  than merely escaped. */
const ROLES = new Set([
  'eng', 'design', 'product', 'science', 'sales',
  'marketing', 'support', 'operations', 'recruiting', 'finance', 'legal',
]);

const DEFAULT_ROLE = 'eng';

/**
 * The default sweep: one axis of intent, one of discipline, one of stack.
 *
 * These are retrieval terms, not a taxonomy — their job is to make the thirty
 * records each query returns overlap as little as possible, so the union is
 * wide. That is why the list mixes registers ("remote" alongside "typescript")
 * instead of being a tidy list of languages: a term that pulls a slice nothing
 * else pulls earns its request, however unlike its neighbours it looks.
 *
 * Override with `discovery.workatastartup.queries` when a run should lean
 * somewhere specific.
 */
const DEFAULT_QUERIES = [
  'remote',
  'backend engineer',
  'frontend engineer',
  'full stack',
  'infrastructure',
  'devops',
  'machine learning',
  'data engineer',
  'security',
  'mobile',
  'rust',
  'go',
  'python',
  'typescript',
  'react',
];

/** Queries issued per run, config or not. Each is a request to someone else's
 *  server for a fixed 30 records, so the ceiling bounds a config typo the same
 *  way MAX_PROFILE_FETCHES bounds an absent cap. */
const MAX_QUERIES = 25;

/** A query goes into a URL and is matched against nothing; this only keeps a
 *  pathological config value out of a request. */
const MAX_QUERY_LENGTH = 64;

/**
 * What an *absent* `maxNewPerRun` means here.
 *
 * The YC source reads no cap as "no cap", and that is safe there — its whole
 * directory arrives in one request. Here every candidate costs a request to
 * someone else's server, so silence has to mean a number.
 */
const DEFAULT_PROFILE_FETCHES = 50;

/**
 * Ceiling on an *explicit* `maxNewPerRun`. Deliberately far above any figure an
 * operator would type on purpose: a configured cap is a decision and is
 * honoured, and this only catches the stray zero that would otherwise walk the
 * whole board. One sweep routinely matches ~280 companies, so the cap is what
 * is actually limiting this source, not the supply.
 */
const MAX_PROFILE_FETCHES = 200;

/** Company keywords are capped well below the dataset's own limit of 10. */
const MAX_KEYWORDS = 8;

/** A WAAS slug goes into a URL and into careersUrl, so it is validated on the
 *  same shape ats/index.mjs accepts as a board token. */
const SLUG_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Comparison form for names; deliberately exact-after-normalizing, not fuzzy. */
const normalizeName = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const kebab = (value) =>
  String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Patterns are built from the config file, never from the fetched feed. */
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

/** A non-empty trimmed string within `max`, or null. */
function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed === '' || trimmed.length > max) return null;
  return trimmed;
}

/**
 * The profile's own `url` field, normalized.
 *
 * Copied from the YC directory source's rule, and for the same reason: a great
 * many of these are still `http://` (Mason's reads "http://www.bymason.com"),
 * the dataset schema requires https, and they all redirect there anyway. The
 * scheme is normalized rather than dropping the company over it.
 */
function website(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.protocol = 'https:';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * Domain labels only. Anything that collides with the technology vocabulary is
 * dropped: WAAS tagging a company "Kubernetes" means it sells Kubernetes
 * tooling, and letting that land in the same field the job scanner writes to
 * would read as "this company's engineers use Kubernetes", which we did not
 * establish.
 */
function deriveKeywords(profile, technologyTags) {
  // `industries` only. The sibling `industry` field is the hierarchy path the
  // label sits on — Hive's reads "B2B -> Marketing" — and kebab-casing that
  // invents a tag ("b2b-marketing") no company was ever labelled with, on top
  // of the two real ones already in `industries`.
  const labels = Array.isArray(profile.industries) ? profile.industries : [];

  const keywords = [];
  for (const label of labels) {
    const tag = kebab(label);
    if (tag === '' || tag.length > 40) continue;
    if (technologyTags.has(tag)) continue;
    if (!keywords.includes(tag)) keywords.push(tag);
  }
  return keywords.slice(0, MAX_KEYWORDS);
}

/**
 * Remote policy from the company's engineering postings.
 *
 * Only the locations WAAS printed count. Every role saying remote is a remote
 * company; a mix is hybrid; and *none* of them saying it stays null rather than
 * becoming 'onsite' — a company that listed an office has told us nothing about
 * whether it allows remote work, and 'onsite' would be our guess, not its word.
 * That nullability is load-bearing across this codebase: 'onsite' is a claim,
 * and every claim here has to trace back to something the source said.
 */
function remotePolicy(locations) {
  if (locations.length === 0) return null;
  const remote = locations.filter((location) => /\bremote\b/i.test(location)).length;
  if (remote === 0) return null;
  return remote === locations.length ? 'remote' : 'hybrid';
}

/** The job records out of one Inertia page, defensively. */
function jobsOf(page) {
  const jobs = page?.props?.jobs;
  return Array.isArray(jobs) ? jobs : [];
}

/** The terms to sweep: config's list if it has one, otherwise the default. */
function readQueries(raw) {
  // An explicit empty array means "sweep nothing, role feed only" — a deliberate
  // setting, not a missing one, so it is not backfilled with the defaults.
  const terms = Array.isArray(raw) ? raw : DEFAULT_QUERIES;
  const queries = [];
  for (const term of terms) {
    if (typeof term !== 'string') continue;
    const trimmed = term.trim().replace(/\s+/g, ' ');
    if (trimmed === '' || trimmed.length > MAX_QUERY_LENGTH) continue;
    // Two spellings of the same term would spend a request to re-read the same
    // thirty records, and the whole point of the sweep is disjoint slices.
    if (!queries.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      queries.push(trimmed);
    }
  }
  return queries.slice(0, MAX_QUERIES);
}

/**
 * The role feed, read as server-rendered HTML.
 *
 * Query zero of the sweep. It costs the same one request as a search term and
 * is the only slice with no query bias in it at all — WAAS chose these thirty,
 * not a relevance ranking against a word we picked — so it goes in first and
 * everything else unions on top.
 */
async function readRoleFeed(http, role) {
  const response = await http.get(`${JOBS_URL}?role=${encodeURIComponent(role)}`, { accept: HTML_ACCEPT });
  if (!response.ok) return null;

  const page = parseInertiaPage(response.body);
  return page === null ? null : jobsOf(page);
}

/**
 * One search term. Returns null for anything we did not positively read, which
 * the caller counts separately from a term that legitimately matched nothing:
 * a failed request is not evidence about the board.
 */
async function readSearch(http, term) {
  const response = await http.get(`${SEARCH_URL}?q=${encodeURIComponent(term)}`, { accept: JSON_ACCEPT });
  if (!response.ok) return null;

  const body = response.json();
  return Array.isArray(body?.jobs) ? body.jobs : null;
}

/**
 * Sweep the board and union what comes back.
 *
 * Deduplication is on the job id, and first-seen order is preserved: the role
 * feed first, then the queries in config order. That ordering is what makes two
 * runs over an unchanged board select the same companies when the cap bites —
 * without it, the selection would shuffle with whatever the search ranked
 * highest that morning.
 */
async function collectJobs(http, role, queries) {
  const jobs = [];
  const seen = new Set();
  let queriesIssued = 0;
  let queriesFailed = 0;

  const absorb = (records) => {
    for (const job of records) {
      if (job === null || typeof job !== 'object') continue;
      const key = job.id;
      // A record with no id cannot be deduplicated against the other queries,
      // and the same posting retrieved by four terms would be counted four
      // times. Grouping is by company slug anyway, so it loses nothing real.
      if (key === null || key === undefined || seen.has(key)) continue;
      seen.add(key);
      jobs.push(job);
    }
  };

  const roleJobs = await readRoleFeed(http, role);
  if (roleJobs !== null) absorb(roleJobs);

  for (const term of queries) {
    const records = await readSearch(http, term);
    queriesIssued += 1;
    if (records === null) {
      queriesFailed += 1;
      continue;
    }
    absorb(records);
  }

  return {
    jobs,
    roleFeedRead: roleJobs !== null,
    queriesIssued,
    queriesFailed,
  };
}

/**
 * One entry per company, in the order the feed first mentioned them.
 *
 * Grouping is the whole point of reading a job feed for company discovery: 30
 * postings on page 1 came from 18 companies, and a candidate per posting would
 * produce eighteen companies and twelve duplicates. Feed order is preserved so
 * two runs over an unchanged feed select the same companies.
 */
function groupBySlug(jobs) {
  const companies = new Map();

  for (const job of jobs) {
    if (job === null || typeof job !== 'object') continue;

    const slug = cleanText(job.companySlug, 64);
    const name = cleanText(job.companyName, 120);
    if (slug === null || name === null || !SLUG_SHAPE.test(slug)) continue;

    let company = companies.get(slug);
    if (company === undefined) {
      company = {
        slug,
        name,
        batch: cleanText(job.companyBatch, 12),
        oneLiner: cleanText(job.companyOneLiner, 400),
        titles: [],
        locations: [],
      };
      companies.set(slug, company);
    }

    const title = cleanText(job.title, 200);
    if (title !== null && company.titles.length < 40) company.titles.push(title);
    const location = cleanText(job.location, 200);
    if (location !== null && company.locations.length < 40) company.locations.push(location);
  }

  return [...companies.values()];
}

/**
 * The head-office country, from the profile's own location string and nothing
 * else.
 *
 * Falling back to the posting locations was tried and removed: they say where a
 * company hires, not where it is. Intelligence Factory is in New York and every
 * engineering role it lists is in Pune, so the fallback filed it under India;
 * Ooak Data is in San Francisco with a Paris team and came out French. And this
 * source reads a role-filtered feed, so the postings it sees are a slice of a
 * slice. ats/index.mjs already treats posting countries as evidence needing a
 * two-thirds majority before it will so much as suggest one; writing them
 * straight into `country` would be a guess wearing a fact's clothes.
 *
 * The cost is real. WAAS writes American head offices as "San Francisco" or
 * "Seattle, WA", and a bare state code cannot be told from an ISO country code,
 * so most US companies land here with country null. Null is the honest answer —
 * the profile genuinely never names a country — and the refresh scan against
 * the company's own site can still fill it in later.
 */
function country(profile) {
  return countryFromLocation(cleanText(profile.location, 200));
}

function toCandidate(company, profile, technologyTags) {
  const size = Number.isInteger(profile.teamSize) && profile.teamSize > 0 ? profile.teamSize : null;
  const hqLocation = cleanText(profile.location, 200);
  const batch = cleanText(profile.batch, 12) ?? company.batch;

  return {
    name: cleanText(profile.name, 120) ?? company.name,
    website: website(profile.url),
    description: cleanText(profile.description, 400) ?? company.oneLiner ?? '',
    sizeMin: size,
    sizeMax: size,
    sizeRange: size === null ? null : String(size),
    hqLocation,
    country: country(profile),
    keywords: deriveKeywords(profile, technologyTags),
    remotePolicy: remotePolicy(company.locations),
    // Deliberately the WAAS profile, not the company's own site. For a large
    // share of these startups it is the only public job board they have, and
    // it is also what lets the matching ATS adapter recognise them later:
    // ats/index.mjs reads careersUrl first, and a HOST_RULE on this URL turns
    // it straight back into the slug the adapter needs.
    careersUrl: boardUrl(company.slug),
    sourceNote: batch === null
      ? "Discovered via Y Combinator's Work at a Startup."
      : `Discovered via Y Combinator's Work at a Startup (${batch} batch).`,
  };
}

/**
 * @param {{ get: Function }} http the shared polite client
 * @param {object} config parsed research.config.json
 * @returns {Promise<{ candidates: object[], diagnostics: string }>}
 *   An empty candidate list on failure. Discovery adding nothing is harmless —
 *   unlike a position scan, it can never erase anything — so this reports the
 *   failure in `diagnostics` rather than signalling it out of band.
 */
export async function discover(http, config) {
  const discovery = config?.discovery ?? {};
  const options = discovery.workatastartup ?? {};

  const role = typeof options.role === 'string' && ROLES.has(options.role) ? options.role : DEFAULT_ROLE;
  const queries = readQueries(options.queries);

  const sweep = await collectJobs(http, role, queries);
  if (sweep.jobs.length === 0) {
    const why = sweep.queriesIssued === 0
      ? 'no usable queries and the role feed was unreadable'
      : `nothing readable across ${sweep.queriesIssued} quer(ies) and the role feed`;
    return { candidates: [], diagnostics: `${id} — ${why}` };
  }

  const includeTerms = (discovery.keywords ?? []).filter((term) => typeof term === 'string' && term.trim() !== '');
  const excludeTerms = (discovery.excludeKeywords ?? []).filter((term) => typeof term === 'string' && term.trim() !== '');
  const regionTerms = (discovery.regions ?? []).filter((term) => typeof term === 'string' && term.trim() !== '');
  // Entities that are not companies we want to catalogue. Matched on the exact
  // normalized name, so a real company with a similar name is never caught.
  const excludeNames = new Set(
    (discovery.excludeNames ?? [])
      .filter((name) => typeof name === 'string')
      .map((name) => normalizeName(name))
      .filter((name) => name !== ''),
  );
  const minSize = Number.isInteger(discovery.minEmployeeCount) ? discovery.minEmployeeCount : null;
  const maxSize = Number.isInteger(discovery.maxEmployeeCount) ? discovery.maxEmployeeCount : null;
  const cap = Number.isInteger(discovery.maxNewPerRun) && discovery.maxNewPerRun > 0
    ? Math.min(discovery.maxNewPerRun, MAX_PROFILE_FETCHES)
    : DEFAULT_PROFILE_FETCHES;

  // Tags the position scanner owns; see deriveKeywords.
  const technologyTags = new Set(Object.keys(config?.keywordVocabulary ?? {}));

  const grouped = groupBySlug(sweep.jobs);
  const matched = [];
  const rejected = { byName: 0, excluded: 0, keywords: 0, region: 0, noWebsite: 0, size: 0, unread: 0 };

  // Everything cheap runs first, on what the feed already told us. The profile
  // fetch below is the expensive part — one request per company — so a company
  // the config would reject must never cost one.
  for (const company of grouped) {
    if (excludeNames.has(normalizeName(company.name))) {
      rejected.byName += 1;
      continue;
    }

    const titles = company.titles.join(' ');
    const locations = company.locations.join(' ');
    const text = `${company.name} ${company.oneLiner ?? ''} ${titles}`;

    if (excludeTerms.length > 0 && matchesAny(excludeTerms, `${text} ${locations}`)) {
      rejected.excluded += 1;
      continue;
    }

    // Weaker than the same filter on the YC directory, and knowingly so: the
    // directory matches against a company's market tags, which this feed does
    // not carry until the profile is fetched — and fetching it first is exactly
    // what the cap exists to prevent. A term that only appears in a company's
    // industry labels will not match here.
    if (includeTerms.length > 0 && !matchesAny(includeTerms, text)) {
      rejected.keywords += 1;
      continue;
    }

    if (regionTerms.length > 0 && !matchesAny(regionTerms, locations)) {
      rejected.region += 1;
      continue;
    }

    matched.push(company);
  }

  const selected = matched.slice(0, cap);
  const candidates = [];

  for (const company of selected) {
    const profile = await fetchCompanyProfile(http, company.slug);
    if (profile === null) {
      // A profile we could not read is a company we know nothing about beyond
      // its name. Storing that would create a record no later run can fill in.
      rejected.unread += 1;
      continue;
    }

    const site = website(profile.url);
    if (discovery.requireWebsite !== false && site === null) {
      rejected.noWebsite += 1;
      continue;
    }

    const size = Number.isInteger(profile.teamSize) ? profile.teamSize : null;
    if (minSize !== null || maxSize !== null) {
      // An unknown headcount cannot satisfy a headcount filter.
      if (size === null || (minSize !== null && size < minSize) || (maxSize !== null && size > maxSize)) {
        rejected.size += 1;
        continue;
      }
    }

    // The exclusion list is the one filter worth re-running now that the
    // profile is in hand: it exists to keep categories out of the catalogue
    // altogether, and the industry labels and long description are where a
    // company's actual business shows up. A wasted fetch is the cheaper error.
    if (excludeTerms.length > 0) {
      const profileText = [
        ...(Array.isArray(profile.industries) ? profile.industries : []),
        typeof profile.industry === 'string' ? profile.industry : '',
        typeof profile.description === 'string' ? profile.description : '',
      ].join(' ');
      if (matchesAny(excludeTerms, profileText)) {
        rejected.excluded += 1;
        continue;
      }
    }

    candidates.push(toCandidate(company, profile, technologyTags));
  }

  const parts = [
    `${sweep.queriesIssued} quer(ies)${sweep.roleFeedRead ? ` + role=${role} feed` : ' (role feed unreadable)'}`,
    `${sweep.jobs.length} distinct jobs`,
    `${grouped.length} companies`,
    `${matched.length} matched`,
    `${candidates.length} returned`,
  ];
  if (sweep.queriesFailed > 0) parts.push(`${sweep.queriesFailed} quer(ies) failed`);
  if (matched.length > selected.length) parts.push(`capped at ${cap}`);
  if (rejected.unread > 0) parts.push(`${rejected.unread} profiles unreadable`);
  // Said every run, not only when something went wrong. Each query returns a
  // fixed 30 records however many match, so this is a sample of the board and
  // never a census of it — a company absent from the union may simply not have
  // ranked for any term, which is not the same as not hiring.
  parts.push('30/query server cap — coverage is a sample, not a census');

  return { candidates, diagnostics: `${id} — ${parts.join(', ')}` };
}
