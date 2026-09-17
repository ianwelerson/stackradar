/**
 * ATS detection and position scanning.
 *
 * The contract that matters: `fetchPositions` returns null for anything we did
 * not positively read. Null means "we learned nothing" and merge.mjs leaves the
 * record alone. An empty `openings` array is the much stronger claim "this
 * board loaded and nobody is hiring", which wipes a company's openings, so it
 * is only ever produced by a board that answered 200 with a well-formed,
 * genuinely empty list, from a token we did not guess.
 *
 * The second load-bearing rule: every opening's `url` is the link to that one
 * posting. Sending a reader to a generic careers page to hunt for the role we
 * told them about is the failure mode this directory exists to avoid, so a
 * posting with no per-role link gets `url: null` instead.
 */
import { toSlug } from '../slug.mjs';
import { extractFromPosition } from '../keywords.mjs';
import * as ashby from './ashby.mjs';
import * as greenhouse from './greenhouse.mjs';
import * as lever from './lever.mjs';
import * as workable from './workable.mjs';
import * as recruitee from './recruitee.mjs';
import * as smartrecruiters from './smartrecruiters.mjs';
import * as personio from './personio.mjs';

export const adapters = {
  ashby,
  greenhouse,
  lever,
  workable,
  recruitee,
  smartrecruiters,
  personio,
};

/**
 * Platforms whose API answers 404 for an unknown token. Only these may be
 * probed with a guessed slug: a 404 is a definitive "no", so a wrong guess
 * costs one request and cannot be mistaken for a real, empty board.
 *
 * SmartRecruiters and Personio are absent because a wrong guess does not come
 * back as a clean "no": SmartRecruiters answers 200 with {"totalFound":0} for
 * companies that are not on it at all (verified with `Visa` and `Bosch`), and
 * Personio 307s an unknown tenant to a marketing page.
 *
 * Workable is absent for a different reason. It 404s cleanly and even names the
 * account owner, so it would be safe on correctness grounds - but probing it
 * costs one request per undetected company, and it starts returning 429 well
 * before that (measured, not assumed). Trading reliable reads for every
 * *known* Workable board against one extra discovery is a bad deal, so Workable
 * is only ever reached from an explicit link or an embed on a careers page.
 */
// Platforms where a wrong guess returns a clean 404, so probing cannot produce
// a false "confirmed empty". Workable is last because it is the most likely to
// rate-limit (it returned 429 during development); the shared http client backs
// off on 429, and reaching it at all means the other three already missed.
const PROBEABLE = ['ashby', 'greenhouse', 'lever', 'workable'];

/** At most this many guessed-token requests per company. */
const MAX_PROBES = 8;

/** Path segments that are part of an ATS's own routing, never a board token. */
const RESERVED_TOKENS = new Set([
  'embed', 'js', 'jobs', 'job', 'api', 'assets', 'static', 'search', 'apply',
  'application', 'www', 'careers', 'board', 'boards', 'j', 'o', 'c', 'widget',
  'postings', 'company', 'companies', 'null', 'undefined',
]);

const TOKEN_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Direct host rules. `path` takes the first path segment as the token,
 * `subdomain` takes the leading hostname label.
 */
const HOST_RULES = [
  { platform: 'ashby', host: /^jobs\.ashbyhq\.com$/i, from: 'path' },
  { platform: 'greenhouse', host: /^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/i, from: 'path' },
  { platform: 'lever', host: /^jobs\.(?:eu\.)?lever\.co$/i, from: 'path' },
  { platform: 'workable', host: /^apply\.workable\.com$/i, from: 'path' },
  { platform: 'smartrecruiters', host: /^(?:careers|jobs)\.smartrecruiters\.com$/i, from: 'path' },
  { platform: 'recruitee', host: /^([A-Za-z0-9-]+)\.recruitee\.com$/i, from: 'subdomain' },
  { platform: 'personio', host: /^([A-Za-z0-9-]+)\.jobs\.personio\.(?:de|com)$/i, from: 'subdomain' },
];

/**
 * Markers for a board embedded in a company's own careers page. These run over
 * fetched HTML, which is untrusted, so they are fixed patterns that can only
 * ever yield a token from a constrained character class, and the token is
 * validated again before use. Nothing here compiles a pattern from page
 * content.
 */
const EMBED_PATTERNS = [
  // Greenhouse's iframe/script embed carries the token in ?for=.
  { platform: 'greenhouse', regex: /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gi },
  { platform: 'greenhouse', regex: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gi },
  // Ashby ships both the hosted board link and an embed script with ?org=.
  { platform: 'ashby', regex: /jobs\.ashbyhq\.com\/embed\?org=([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gi },
  { platform: 'ashby', regex: /jobs\.ashbyhq\.com\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gi },
  { platform: 'lever', regex: /jobs\.(?:eu\.)?lever\.co\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gi },
  { platform: 'workable', regex: /apply\.workable\.com\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gi },
  { platform: 'recruitee', regex: /([A-Za-z0-9-]+)\.recruitee\.com/gi },
  { platform: 'smartrecruiters', regex: /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gi },
  { platform: 'personio', regex: /([A-Za-z0-9-]+)\.jobs\.personio\.(?:de|com)/gi },
];

/** Careers pages routinely run to a megabyte of inlined app state. */
const MAX_SCAN_BYTES = 1500000;

function validToken(token) {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim().replace(/\/+$/, '');
  if (!TOKEN_SHAPE.test(trimmed)) return null;
  if (RESERVED_TOKENS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/** Match one URL string against the direct host rules. */
function matchUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }

  for (const rule of HOST_RULES) {
    const hostMatch = rule.host.exec(url.hostname);
    if (hostMatch === null) continue;

    const raw =
      rule.from === 'subdomain'
        ? hostMatch[1]
        : (url.pathname.split('/').filter(Boolean)[0] ?? null);

    // Greenhouse's embed route puts the token in the query string instead.
    const token =
      rule.platform === 'greenhouse' && (raw === 'embed' || raw === null)
        ? validToken(url.searchParams.get('for'))
        : validToken(raw);

    if (token !== null) return { platform: rule.platform, token };
  }

  return null;
}

/**
 * Identify a company's ATS from the URLs already on the record. Synchronous and
 * free; the fetching forms of detection live in `fetchPositions`.
 *
 * @param {{ careersUrl?: string|null, website?: string|null }} company
 * @returns {{ platform: string, token: string, source: string }|null}
 */
export function detectAts(company) {
  if (company === null || typeof company !== 'object') return null;

  for (const [field, value] of [
    ['careersUrl', company.careersUrl],
    ['website', company.website],
  ]) {
    if (typeof value !== 'string' || value === '') continue;
    const hit = matchUrl(value);
    if (hit !== null) return { ...hit, source: field };
  }

  return null;
}

/**
 * Look for an embedded board in a page's markup. Returns the most-referenced
 * (platform, token) pair: a careers page that links one Ashby board twenty
 * times and mentions a Greenhouse URL once is an Ashby board.
 */
function scanMarkup(html) {
  if (typeof html !== 'string' || html === '') return null;

  const body = html.slice(0, MAX_SCAN_BYTES);
  const counts = new Map();

  for (const { platform, regex } of EMBED_PATTERNS) {
    for (const match of body.matchAll(regex)) {
      const token = validToken(match[1]);
      if (token === null) continue;
      const key = `${platform} ${token}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  if (counts.size === 0) return null;

  const [best] = [...counts].sort((a, b) => b[1] - a[1]);
  const [platform, token] = best[0].split(' ');
  return { platform, token };
}

/** Fetch a company-owned page and read whatever board it embeds. */
async function detectFromPage(http, pageUrl, source) {
  const response = await http.get(pageUrl, { accept: 'text/html,application/xhtml+xml' });
  if (!response.ok) return null;

  // A careers page that 301s straight onto the ATS is the cheapest signal there
  // is, and it costs nothing extra now that we have the response.
  const redirected = matchUrl(response.url);
  if (redirected !== null) return { ...redirected, source: `${source}-redirect` };

  const embedded = scanMarkup(response.body);
  if (embedded !== null) return { ...embedded, source: `${source}-embed` };

  return null;
}

/** Hostname's leading label, e.g. https://katanamrp.com -> katanamrp. */
function domainLabel(website) {
  try {
    const host = new URL(String(website)).hostname.replace(/^www\./i, '').toLowerCase();
    return validToken(host.split('.')[0]);
  } catch {
    return null;
  }
}

const normalizeName = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Does a board that names its owner plausibly belong to this company? Used only
 * to throw out slug probes that landed on a namesake's board. A board that does
 * not report a name gets the benefit of the doubt.
 */
function ownerPlausible(reported, company) {
  if (reported === null || reported === undefined) return true;
  const board = normalizeName(reported);
  const mine = normalizeName(company?.name);
  if (board === '' || mine === '') return true;
  return board.includes(mine) || mine.includes(board);
}

/**
 * Guessed tokens, most likely first. Capped hard: this is the one place the
 * scanner talks to a host that never linked us.
 */
function candidateTokens(company) {
  const tokens = [];
  for (const candidate of [domainLabel(company?.website), validToken(toSlug(company?.name ?? ''))]) {
    if (candidate !== null && !tokens.includes(candidate)) tokens.push(candidate);
  }
  return tokens.slice(0, 2);
}

function excludedBy(title, patterns) {
  const haystack = title.toLowerCase();
  return patterns.some((pattern) => haystack.includes(pattern));
}

/**
 * Raw adapter jobs to the Opening shape merge.mjs expects.
 * @returns {{ openings: object[], excluded: number, duplicates: number, capped: boolean }}
 */
function buildOpenings(jobs, config) {
  const patterns = (config?.positions?.excludePatterns ?? [])
    .filter((pattern) => typeof pattern === 'string' && pattern.trim() !== '')
    .map((pattern) => pattern.toLowerCase());

  const rawCap = config?.positions?.maxPerCompany;
  const cap = Number.isInteger(rawCap) && rawCap > 0 ? rawCap : 100;
  const vocabulary = config?.keywordVocabulary ?? {};

  const openings = [];
  const seen = new Set();
  let excluded = 0;
  let duplicates = 0;

  for (const job of jobs) {
    if (excludedBy(job.title, patterns)) {
      excluded += 1;
      continue;
    }

    // The same role can appear once per location on some boards - Workable's
    // widget repeats each posting for all six of its locations, so 18 "jobs"
    // are three roles.
    const key = job.url ?? `title:${job.title.toLowerCase()}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    openings.push({
      title: job.title,
      url: job.url ?? null,
      location: job.location ?? null,
      postedDate: job.postedDate ?? null,
      detectedKeywords: extractFromPosition({ title: job.title, description: job.text }, vocabulary),
    });
  }

  return {
    openings: openings.slice(0, cap),
    excluded,
    duplicates,
    capped: openings.length > cap,
    signals: summariseSignals(jobs),
  };
}

/**
 * Roll per-posting location hints up into company-level evidence.
 *
 * This is evidence, not fact: where a role is advertised is not necessarily
 * where the company is headquartered, and a distributed company will post
 * across many countries. So a country is only claimed when a clear majority of
 * the postings that carry one agree, and the counts are reported either way so
 * the caller can decide. Nothing here overwrites a human-researched value.
 */
function summariseSignals(jobs) {
  const countries = {};
  const workplaces = {};

  for (const job of jobs) {
    if (typeof job.countryHint === 'string' && job.countryHint.trim() !== '') {
      const key = job.countryHint.trim();
      countries[key] = (countries[key] ?? 0) + 1;
    }
    if (typeof job.remoteHint === 'string') {
      workplaces[job.remoteHint] = (workplaces[job.remoteHint] ?? 0) + 1;
    }
  }

  const countryTotal = Object.values(countries).reduce((a, b) => a + b, 0);
  const topCountry = Object.entries(countries).sort((a, b) => b[1] - a[1])[0] ?? null;
  // Two thirds is the bar for "this is where they are" rather than "this is one
  // of several places they hire".
  const country =
    topCountry !== null && countryTotal > 0 && topCountry[1] / countryTotal >= 0.66
      ? topCountry[0]
      : null;

  const workplaceTotal = Object.values(workplaces).reduce((a, b) => a + b, 0);
  let remotePolicy = null;
  if (workplaceTotal > 0) {
    const remote = workplaces.remote ?? 0;
    const hybrid = workplaces.hybrid ?? 0;
    const onsite = workplaces.onsite ?? 0;
    // A company posting any mix of remote and on-site roles is hybrid in the
    // sense this directory means it: you can work there without relocating.
    if (remote / workplaceTotal >= 0.8) remotePolicy = 'remote';
    else if (onsite / workplaceTotal >= 0.8) remotePolicy = 'onsite';
    else if (remote + hybrid > 0) remotePolicy = 'hybrid';
  }

  return { country, remotePolicy, countries, workplaces };
}

function describe({ platform, token, source }, raw, built) {
  const parts = [`${raw.jobs.length} listed`];
  if (built.excluded > 0) parts.push(`${built.excluded} excluded`);
  if (built.duplicates > 0) parts.push(`${built.duplicates} duplicate`);
  if (raw.skipped > 0) parts.push(`${raw.skipped} unlisted`);
  if (built.capped) parts.push(`capped to ${built.openings.length}`);
  if (source !== 'careersUrl' && source !== 'website') parts.push(`via ${source}`);
  return `${platform}/${token} — ${parts.join(', ')}`;
}

async function runAdapter(http, detection, company, config, { requireJobs = false } = {}) {
  const adapter = adapters[detection.platform];
  if (adapter === undefined) return null;

  let raw;
  try {
    raw = await adapter.fetchJobs(http, detection.token);
  } catch {
    // An adapter throwing means a bug or a wildly unexpected payload; either way
    // we learned nothing, and one scan must never take the whole run down.
    return null;
  }
  if (raw === null) return null;

  // A guessed token that returns an empty board tells us nothing: we cannot
  // distinguish "their board, nobody hiring" from "not their board at all".
  if (requireJobs && raw.jobs.length === 0) return null;
  if (requireJobs && !ownerPlausible(raw.companyName, company)) return null;

  const built = buildOpenings(raw.jobs, config);

  return {
    openings: built.openings,
    platform: detection.platform,
    // Company-level location evidence derived from the postings themselves.
    signals: built.signals,
    diagnostics: describe(detection, raw, built),
  };
}

/**
 * Read a company's current openings.
 *
 * @returns {{ openings: object[], platform: string, signals: object, diagnostics: string }|null}
 *   null for every failed or ambiguous read: no ATS found, a network error, a
 *   non-2xx, an unparseable body. The caller must leave the record untouched.
 */
export async function fetchPositions(http, company, config) {
  if (company === null || typeof company !== 'object') return null;

  // 1. The URLs already on the record point straight at a board.
  const direct = detectAts(company);
  if (direct !== null) {
    // An explicit, unambiguous board that fails to load is a failure, not an
    // invitation to start guessing other tokens at other vendors.
    return runAdapter(http, direct, company, config);
  }

  // 2. The careers page (or, failing that, the site) embeds someone's board.
  //    One page fetch per company, whichever URL we have.
  const pageUrl =
    typeof company.careersUrl === 'string' && company.careersUrl !== ''
      ? company.careersUrl
      : typeof company.website === 'string' && company.website !== ''
        ? company.website
        : null;

  if (pageUrl !== null) {
    const source = pageUrl === company.careersUrl ? 'careers-page' : 'website';
    const embedded = await detectFromPage(http, pageUrl, source);
    if (embedded !== null) return runAdapter(http, embedded, company, config);
  }

  // 3. Last resort: try the company's own slug on the platforms where a wrong
  //    guess comes back as a clean 404.
  let probes = 0;
  for (const token of candidateTokens(company)) {
    for (const platform of PROBEABLE) {
      if (probes >= MAX_PROBES) return null;
      probes += 1;

      const result = await runAdapter(
        http,
        { platform, token, source: 'slug-probe' },
        company,
        config,
        { requireJobs: true },
      );
      if (result !== null) return result;
    }
  }

  return null;
}
