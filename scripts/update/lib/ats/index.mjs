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
import { workplaceOfMany } from '../workplace.mjs';
import * as ashby from './ashby.mjs';
import * as greenhouse from './greenhouse.mjs';
import * as lever from './lever.mjs';
import * as workable from './workable.mjs';
import * as recruitee from './recruitee.mjs';
import * as smartrecruiters from './smartrecruiters.mjs';
import * as personio from './personio.mjs';
import * as bamboohr from './bamboohr.mjs';
import * as teamtailor from './teamtailor.mjs';
import * as workatastartup from './workatastartup.mjs';

export const adapters = {
  ashby,
  greenhouse,
  lever,
  workable,
  recruitee,
  smartrecruiters,
  personio,
  bamboohr,
  teamtailor,
  workatastartup,
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

/**
 * Boards that mirror someone else's postings rather than being the employer's
 * own. Detected like any other platform, but only used once every route to a
 * first-party board has been tried — see step 4 of `fetchPositions`.
 */
const FALLBACK_PLATFORMS = new Set(['workatastartup']);

/** At most this many guessed-token requests per company. */
const MAX_PROBES = 8;

/** Path segments that are part of an ATS's own routing, never a board token. */
const RESERVED_TOKENS = new Set([
  'embed', 'js', 'jobs', 'job', 'api', 'assets', 'static', 'search', 'apply',
  'application', 'www', 'careers', 'board', 'boards', 'j', 'o', 'c', 'widget',
  'postings', 'company', 'companies', 'null', 'undefined',
  // Section labels. A company whose site lives at career.example.com or
  // blog.example.com hands `domainLabel` the section, not the brand, and the
  // probe then guesses a board under that generic word. `lever/career` really
  // exists — it is somebody's test account, one posting titled "Test Job" dated
  // 2024 — and Operations1 (career.operations1.com) was recorded as hiring for
  // it. These are never a real board token, so they are never guessed.
  'career', 'blog', 'learn', 'trust', 'docs', 'documentation', 'help',
  'support', 'news', 'press', 'media', 'status', 'community', 'academy',
  'resources', 'events', 'hire', 'hiring', 'join', 'work', 'about',
  // Vendors' own infrastructure hosts. `app.teamtailor.com` is where a
  // Teamtailor board's assets are served from, so it appears dozens of times in
  // the markup of a board running on a custom domain — enough to outvote the
  // single "powered by" utm_content link that names the real host. scanMarkup
  // picks the most-referenced token, so without this the board at
  // jobs.thorgate.eu resolved to the token "app" and the scan found nothing.
  'app', 'cdn',
  // Aggregators that repost other companies' jobs on a board of their own.
  // remote.com links Jobgether's Lever board from its jobs marketplace, and the
  // scan recorded sixty strangers' roles — "Academic and Athletic Compliance
  // Coordinator" — as Remote's own.
  'jobgether',
]);

const TOKEN_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Ashby org names may contain spaces — Flock Safety's board is
 * jobs.ashbyhq.com/Flock%20Safety. A token cut off at the "%20" is not a
 * shorter spelling of the same board, it is a different company: "Flock" is an
 * insurer, and reading it put "Senior Motor Fleet Underwriter" on Flock
 * Safety's page. So Ashby tokens are decoded and may carry inner spaces, and
 * the patterns below capture the encoded form whole instead of stopping at %.
 */
const ASHBY_TOKEN_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;

/**
 * Direct host rules. `path` takes the first path segment as the token,
 * `subdomain` takes the leading hostname label, and `path2` takes the second
 * path segment — for boards that namespace under a fixed prefix, such as Work
 * at a Startup's /companies/{slug}, whose first segment is the literal word
 * "companies" and is rejected by RESERVED_TOKENS.
 */
const HOST_RULES = [
  { platform: 'ashby', host: /^jobs\.ashbyhq\.com$/i, from: 'path' },
  { platform: 'greenhouse', host: /^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/i, from: 'path' },
  { platform: 'lever', host: /^jobs\.(?:eu\.)?lever\.co$/i, from: 'path' },
  { platform: 'workable', host: /^apply\.workable\.com$/i, from: 'path' },
  { platform: 'smartrecruiters', host: /^(?:careers|jobs)\.smartrecruiters\.com$/i, from: 'path' },
  { platform: 'recruitee', host: /^([A-Za-z0-9-]+)\.recruitee\.com$/i, from: 'subdomain' },
  { platform: 'personio', host: /^([A-Za-z0-9-]+)\.jobs\.personio\.(?:de|com)$/i, from: 'subdomain' },
  { platform: 'bamboohr', host: /^([A-Za-z0-9-]+)\.bamboohr\.com$/i, from: 'subdomain' },
  { platform: 'teamtailor', host: /^([A-Za-z0-9-]+)\.teamtailor\.com$/i, from: 'subdomain' },
  // Last on purpose: a company's own board always outranks its YC listing.
  {
    platform: 'workatastartup',
    host: /^(?:www\.)?workatastartup\.com$/i,
    from: 'path2',
    prefix: 'companies',
  },
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
  { platform: 'ashby', regex: /jobs\.ashbyhq\.com\/embed\?org=([A-Za-z0-9][A-Za-z0-9._%-]{0,90})/gi },
  { platform: 'ashby', regex: /jobs\.ashbyhq\.com\/([A-Za-z0-9][A-Za-z0-9._%-]{0,90})/gi },
  { platform: 'lever', regex: /jobs\.(?:eu\.)?lever\.co\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gi },
  { platform: 'workable', regex: /apply\.workable\.com\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gi },
  { platform: 'recruitee', regex: /([A-Za-z0-9-]+)\.recruitee\.com/gi },
  { platform: 'smartrecruiters', regex: /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gi },
  { platform: 'personio', regex: /([A-Za-z0-9-]+)\.jobs\.personio\.(?:de|com)/gi },
  { platform: 'bamboohr', regex: /([A-Za-z0-9-]+)\.bamboohr\.com/gi },
  { platform: 'teamtailor', regex: /([A-Za-z0-9-]+)\.teamtailor\.com/gi },
  // A Teamtailor board moved to a custom domain has no {token}.teamtailor.com
  // subdomain left to find (pactum.com/careers is careers.pactum.com, and every
  // pactum*.teamtailor.com 404s). The only thing naming it is Teamtailor's own
  // "powered by" link, which carries the live host in utm_content. The capture
  // is a hostname shape and nothing else — labels plus a letters-only TLD, so
  // no bare words, ports, paths or addresses — and teamtailor.mjs still has to
  // find a real JSON Feed there before any of it counts.
  {
    platform: 'teamtailor',
    regex: /teamtailor\.com\/\?[^"'\s<>]{0,120}utm_content=([A-Za-z0-9](?:[A-Za-z0-9-]*\.)+[A-Za-z]{2,24})/gi,
  },
];

/** Careers pages routinely run to a megabyte of inlined app state. */
const MAX_SCAN_BYTES = 1500000;

function validToken(token, platform) {
  if (typeof token !== 'string') return null;
  let trimmed = token.trim().replace(/\/+$/, '');
  if (platform === 'ashby' && trimmed.includes('%')) {
    try {
      trimmed = decodeURIComponent(trimmed).trim();
    } catch {
      return null;
    }
  }
  if (!(platform === 'ashby' ? ASHBY_TOKEN_SHAPE : TOKEN_SHAPE).test(trimmed)) return null;
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

    const segments = url.pathname.split('/').filter(Boolean);
    const raw =
      rule.from === 'subdomain'
        ? hostMatch[1]
        : rule.from === 'path2'
          // `prefix` is required, not cosmetic: without it /jobs/13302 would
          // yield the token "13302" and send the adapter hunting for a company
          // board under a posting id.
          ? (segments[0] === rule.prefix ? (segments[1] ?? null) : null)
          : (segments[0] ?? null);

    // Greenhouse's embed route puts the token in the query string instead.
    const token =
      rule.platform === 'greenhouse' && (raw === 'embed' || raw === null)
        ? validToken(url.searchParams.get('for'))
        : validToken(raw, rule.platform);

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
      const token = validToken(match[1], platform);
      if (token === null) continue;
      // Not a space: an Ashby token may contain one.
      const key = `${platform}\u0000${token}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  if (counts.size === 0) return null;

  const [best] = [...counts].sort((a, b) => b[1] - a[1]);
  const [platform, token] = best[0].split('\u0000');
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
  const seen = new Map();
  let excluded = 0;
  let duplicates = 0;

  for (const job of jobs) {
    if (excludedBy(job.title, patterns)) {
      excluded += 1;
      continue;
    }

    // The same role is very often posted once per location — Flexport listed 7
    // roles as 28, Pipedrive 2 as 8 — each with its own URL, so deduplicating
    // on URL alone does not catch it. Collapse on the title instead and gather
    // the locations, which is both an honest count and a shorter list to read.
    const key = job.title.trim().toLowerCase();
    const existing = seen.get(key);
    if (existing !== undefined) {
      duplicates += 1;
      if (typeof job.location === 'string' && job.location !== '') {
        existing.locations.add(job.location);
      }
      existing.postings.push({ location: job.location ?? null, hint: job.remoteHint ?? null });
      // Keep the earliest posting date; a role re-listed per city should read
      // as old as it actually is.
      if (job.postedDate !== null && (existing.postedDate === null || job.postedDate < existing.postedDate)) {
        existing.postedDate = job.postedDate;
      }
      continue;
    }

    const entry = {
      title: job.title,
      url: job.url ?? null,
      locations: new Set(typeof job.location === 'string' && job.location !== '' ? [job.location] : []),
      postedDate: job.postedDate ?? null,
      detectedKeywords: extractFromPosition({ title: job.title, description: job.text }, vocabulary),
      postings: [{ location: job.location ?? null, hint: job.remoteHint ?? null }],
    };
    seen.set(key, entry);
    openings.push(entry);
  }

  // Flatten the gathered locations into the stored shape. The workplace is
  // derived from every posting first — the display string below keeps only
  // three places, and a role's remote scope often lives in the fourth.
  for (const opening of openings) {
    opening.workplace = workplaceOfMany(opening.postings);
    delete opening.postings;

    const list = [...opening.locations];
    opening.location = list.length === 0 ? null : list.length <= 3 ? list.join(' · ') : `${list.slice(0, 3).join(' · ')} +${list.length - 3} more`;
    delete opening.locations;
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

  // The denominator is every job scanned, NOT just those that carried a country
  // hint. Dividing by the hints alone is a selection bias that manufactures
  // certainty: a board of eighteen roles where seventeen say only "London" and
  // one says "Ireland" scores 1/1 and declares the company Irish. Counting the
  // silent majority is what stops that. Same rule, and the same reasoning, as
  // countryFromOpenings in ../locations.mjs.
  const countryTotal = jobs.length;
  const topCountry = Object.entries(countries).sort((a, b) => b[1] - a[1])[0] ?? null;
  // Two thirds is the bar for "this is where they are" rather than "this is one
  // of several places they hire".
  const country =
    topCountry !== null && countryTotal >= 5 && topCountry[1] / countryTotal >= 0.66
      ? topCountry[0]
      : null;

  // Same reasoning for the work model: a single remote-tagged role among thirty
  // office roles is not a remote company.
  const workplaceTotal = jobs.length;
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
    // What the board actually listed, before exclusions, de-duplication and the
    // per-company cap. Stored so the UI can say "60 of 656" rather than
    // presenting a truncated count as the whole truth.
    totalListed: raw.jobs.length,
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
  if (direct !== null && !FALLBACK_PLATFORMS.has(direct.platform)) {
    // An explicit, unambiguous board that fails to load is a failure, not an
    // invitation to start guessing other tokens at other vendors.
    return runAdapter(http, direct, company, config);
  }

  // A mirror is held back rather than used here. Discovery writes the company's
  // Work at a Startup profile into `careersUrl` because for many YC startups it
  // is the only public board they have — but when a company also runs its own
  // Ashby or Greenhouse board, that board is strictly better: real posted dates,
  // the full description per role, and an apply link that is not behind YC's
  // login. Taking the mirror here would mean never looking.
  const fallback = direct;

  // 2. The careers page (or, failing that, the site) embeds someone's board.
  //    One page fetch per company, whichever URL we have.
  // Pages worth reading, best first. The conventional /careers and /jobs paths
  // matter more than they look: most records carry no careersUrl, and a
  // company's homepage rarely embeds its job board even when /careers does.
  // Six companies already on platforms we support — Apollo and Ironclad on
  // Ashby, Razorpay on Greenhouse, Xolo on Workable, Salv and eAgronom on
  // Personio — were being missed purely because only the homepage was read.
  const site = typeof company.website === 'string' && company.website !== ''
    ? company.website.replace(/\/$/, '')
    : null;

  const pages = [];
  if (typeof company.careersUrl === 'string' && company.careersUrl !== '') {
    pages.push([company.careersUrl, 'careers-page']);
  }
  if (site !== null) {
    pages.push([`${site}/careers`, 'careers-path']);
    pages.push([`${site}/jobs`, 'jobs-path']);
    pages.push([site, 'website']);
  }

  for (const [url, source] of pages) {
    const embedded = await detectFromPage(http, url, source);
    if (embedded === null) continue;
    // `pages` starts with careersUrl, which for a YC-discovered company is the
    // mirror itself — and detectFromPage's redirect check matches it, which
    // would hand back the mirror before /careers was ever read. Same rule as
    // step 1: note it and keep looking for something first-party.
    if (FALLBACK_PLATFORMS.has(embedded.platform)) continue;

    // A board named on the bare homepage is the weakest of these four signals,
    // and the one most likely to belong to somebody else: bymason.com links
    // masonamerica.bamboohr.com, an unrelated company whose board loads fine and
    // is empty. Trusting that would publish "Mason has no openings" on the
    // strength of a name collision. A homepage embed therefore has to produce
    // at least one posting to count; failing that we learn nothing and the
    // record is left alone, which is the honest answer. A board linked from the
    // company's own /careers page keeps the stronger reading, so a genuinely
    // empty one still registers as confirmed-empty.
    const requireJobs = source === 'website';
    const result = await runAdapter(http, embedded, company, config, { requireJobs });
    if (result !== null) return result;
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

  // 4. Nothing of the company's own turned up, so the mirror is the best link
  //    we have to the actual postings.
  if (fallback !== null) return runAdapter(http, fallback, company, config);

  return null;
}
