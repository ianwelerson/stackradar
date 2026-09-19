/**
 * Discovery from the Remote OK job board API.
 *
 * Source: https://remoteok.com/api - a single JSON array covering ~100 of the
 * board's most recent listings. Element [0] is not a job: it is a metadata
 * object of the shape `{ last_updated, legal }`. Every other element is (or
 * should be treated as) a job posting; anything without a `position` field is
 * skipped rather than assumed to be a job.
 *
 * LICENSING - read before enabling this source. The API response itself
 * carries this notice, verbatim, inside that [0] metadata object:
 *
 *   "API Terms of Service: Please link back (with follow, and without
 *   nofollow!) to the URL on Remote OK and mention Remote OK as a source, so
 *   we get traffic back from your site. If you do not we'll have to suspend
 *   API access."
 *
 * Using this source therefore creates an attribution obligation on whatever
 * site renders data derived from it (a followed link back to Remote OK,
 * crediting Remote OK as the source). This module does not, and cannot,
 * discharge that obligation on the site's behalf - it is a product decision
 * for whoever owns the page that ends up displaying this data. Nothing here
 * should be wired into a live page until that's been decided.
 *
 * POLITENESS. robots.txt (checked live) sets `Crawl-delay: 1` under
 * `User-agent: *` and allows `/api` outright (it only disallows the
 * `?action=get_jobs` AJAX paths, which this module never calls). The shared
 * http client's default `perHostDelayMs` (1200ms) already clears that
 * crawl-delay, so no extra sleep is added here.
 *
 * WHAT THIS SOURCE CANNOT GIVE US. As of this writing the API does not expose
 * the employer's own domain anywhere in a job record - there is no
 * `company_url` field, and `apply_url`/`url` always point back to a
 * remoteok.com listing page, never to the company. Per the shared discovery
 * contract a candidate without its own domain is unusable (the whole
 * downstream pipeline finds a company's real job board by scanning its own
 * site), so in practice almost every record here is skipped for want of a
 * website. `website()` below still checks for a genuine company-domain field
 * defensively, in case the API ever adds one - but it refuses to fall back to
 * remoteok.com, and this module deliberately does NOT go mining the free-text
 * `description` for a plausible link. That field is exactly the sort of
 * unstructured, adversarial input the honeypot below shows Remote OK's own
 * posters are willing to weaponize, and guessing a "company site" out of it
 * would trade an honest empty source for aggregator noise. See discover()'s
 * doc comment for the resulting numbers.
 *
 * DESCRIPTION HONEYPOT. Job descriptions carry an anti-scraping trap: an
 * instruction sentence telling scrapers to insert a specific word and a
 * base64 token into any application, e.g. "Please mention the word
 * **FESTIVE** and tag RMjAwMTo1NmE6...== when applying." That sentence is
 * stripped out of anything this module stores - see `stripHoneypot` - so it
 * never ends up looking like real company copy in our dataset.
 */
import { cleanString, absoluteUrl, stripHtml } from '../ats/util.mjs';

const API_URL = 'https://remoteok.com/api';

export const id = 'remoteok';
export const label = 'Remote OK';

/** Comparison form for names; deliberately exact-after-normalizing, not fuzzy. */
const normalizeName = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Patterns are built from the config file, never from the fetched API body. */
const matcherCache = new Map();

function wordMatcher(term) {
  const key = String(term);
  let regex = matcherCache.get(key);
  if (regex === undefined) {
    const escaped = key.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
    matcherCache.set(key, regex);
  }
  return regex;
}

function matchesAny(terms, haystack) {
  return terms.some((term) => wordMatcher(term).test(haystack));
}

/**
 * The honeypot sentence varies its bolded word and its token each time, so it
 * cannot be matched as a fixed string - only the surrounding scaffold
 * ("please mention the word ... when applying") is stable enough to anchor
 * on. The `{0,240}` gap is bounded and the quantifier is lazy, so this cannot
 * run away on a hostile description; the input reaching it is already capped
 * by `stripHtml` besides.
 */
const HONEYPOT_PATTERN = /please\s+mention\s+the\s+word[\s\S]{0,240}?when\s+applying\.?/gi;

function stripHoneypot(text) {
  return text.replace(HONEYPOT_PATTERN, '').replace(/\s+/g, ' ').trim();
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

/** Conservative default: a one-line excerpt, honeypot removed, nothing else
 *  read out of the description. `descriptionScan: true` only widens the cap -
 *  it still never feeds description text into anything but this stored
 *  excerpt and (below) the exclude-keyword check. */
const SHORT_EXCERPT_MAX = 160;
const FULL_EXCERPT_MAX = 400;

function buildDescription(record, descriptionScan) {
  const plain = stripHtml(record.description);
  const cleaned = stripHoneypot(plain);
  return truncate(cleaned, descriptionScan ? FULL_EXCERPT_MAX : SHORT_EXCERPT_MAX);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/**
 * The company's own domain, https-normalized origin only - or null.
 *
 * `company_url` does not exist on any live record today (confirmed against
 * the API on 2026-09-17, across all 99 job entries in the response). This
 * checks it anyway, plus a couple of plausible alternate spellings, purely so
 * a future payload change is picked up without a code edit. Whatever the
 * field, a value that resolves back to remoteok.com is rejected - that is
 * still just the aggregator link, not the employer's site.
 */
function website(record) {
  const raw = firstNonEmptyString(record.company_url, record.companyUrl, record.website);
  if (raw === null) return null;

  const abs = absoluteUrl(raw);
  if (abs === null) return null;

  let url;
  try {
    url = new URL(abs);
  } catch {
    return null;
  }

  const host = url.host.toLowerCase();
  if (host === 'remoteok.com' || host.endsWith('.remoteok.com')) return null;

  url.protocol = 'https:';
  return url.origin;
}

/**
 * @param {{ get: Function }} http the shared polite client
 * @param {object} config parsed research.config.json
 * @returns {Promise<{ candidates: object[], diagnostics: string }>}
 *
 * Never throws - a malformed or unreachable API response degrades to an
 * empty candidate list with the reason in `diagnostics`, the same contract
 * every other source in this directory follows (see ycombinator.discover).
 *
 * Read the module doc comment before enabling: on the live API this source
 * currently returns zero or very few candidates, because Remote OK does not
 * expose a company-domain field and this module refuses to guess one out of
 * free text. That is the intended, honest behaviour, not a bug.
 */
export async function discover(http, config) {
  const response = await http.get(API_URL);
  if (!response.ok) {
    return { candidates: [], diagnostics: `${id} - API unreachable (HTTP ${response.status})` };
  }

  const records = response.json();
  if (!Array.isArray(records)) {
    return { candidates: [], diagnostics: `${id} - API response was not a list` };
  }

  const discovery = config?.discovery ?? {};
  const sourceConfig = discovery.remoteok ?? {};
  // Default false: keep the description to a short, honeypot-scrubbed excerpt
  // and out of every other decision. Opting in widens the stored excerpt and
  // lets it feed the exclude-keyword check too - still never anything more.
  const descriptionScan = sourceConfig.descriptionScan === true;

  const excludeNames = new Set(
    (discovery.excludeNames ?? [])
      .filter((name) => typeof name === 'string')
      .map((name) => normalizeName(name))
      .filter((name) => name !== ''),
  );
  const excludeTerms = (discovery.excludeKeywords ?? []).filter(
    (term) => typeof term === 'string' && term.trim() !== '',
  );
  const cap = Number.isInteger(discovery.maxNewPerRun) && discovery.maxNewPerRun > 0
    ? discovery.maxNewPerRun
    : records.length;

  const seenNames = new Set();
  const seenHosts = new Set();
  const candidates = [];
  const rejected = { notAJob: 0, byName: 0, excluded: 0, noWebsite: 0, duplicate: 0 };
  let jobRecords = 0;

  for (const record of records) {
    if (candidates.length >= cap) break;
    if (record === null || typeof record !== 'object') continue;

    // Catches element [0] (the { last_updated, legal } metadata block) along
    // with any other entry that is not actually a job posting.
    if (typeof record.position !== 'string' || record.position.trim() === '') {
      rejected.notAJob += 1;
      continue;
    }
    jobRecords += 1;

    const name = cleanString(record.company);
    if (name === null) {
      rejected.notAJob += 1;
      continue;
    }

    const normalized = normalizeName(name);
    if (excludeNames.has(normalized)) {
      rejected.byName += 1;
      continue;
    }

    const tagsText = Array.isArray(record.tags)
      ? record.tags.filter((tag) => typeof tag === 'string').slice(0, 30).join(' ')
      : '';
    const titleText = `${record.position} ${tagsText}`;
    // Off by default, per the module doc comment: the description is
    // adversarial input (see the honeypot pattern above), so it only enters
    // the exclude-keyword check when the run has opted in.
    const scanText = descriptionScan
      ? `${titleText} ${stripHoneypot(stripHtml(record.description))}`
      : titleText;
    if (excludeTerms.length > 0 && matchesAny(excludeTerms, scanText)) {
      rejected.excluded += 1;
      continue;
    }

    const site = website(record);
    if (site === null) {
      rejected.noWebsite += 1;
      continue;
    }
    const host = new URL(site).host;

    if (seenNames.has(normalized) || seenHosts.has(host)) {
      rejected.duplicate += 1;
      continue;
    }
    seenNames.add(normalized);
    seenHosts.add(host);

    candidates.push({
      name,
      website: site,
      description: buildDescription(record, descriptionScan),
      sizeMin: null,
      sizeMax: null,
      sizeRange: null,
      // The job's `location` field describes where the role may be worked
      // from (a city, a country, a visa region, or blank), not the employer's
      // HQ - using it here would misrepresent a hiring restriction as a
      // company fact, so this is left null rather than guessed.
      hqLocation: null,
      country: null,
      // Remote OK's `tags` are the job's stack/role tags, not a verified
      // fact about the company - see the shared contract. The position
      // scanner owns `keywords`; a listing tag is not evidence of it.
      keywords: [],
      // The one fact this source can state with confidence: every listing on
      // this board is remote by construction.
      remotePolicy: 'remote',
      sourceNote: `Discovered via Remote OK ("${cleanString(record.position) ?? 'listing'}" listing).`,
    });
  }

  const diagnostics =
    `${id} - ${records.length} records fetched (${jobRecords} job postings), ${candidates.length} candidates ` +
    `(${rejected.noWebsite} skipped: no company domain in the API response` +
    (rejected.excluded > 0 ? `, ${rejected.excluded} excluded by keyword` : '') +
    (rejected.byName > 0 ? `, ${rejected.byName} excluded by name` : '') +
    (rejected.duplicate > 0 ? `, ${rejected.duplicate} duplicate` : '') +
    ')';

  return { candidates, diagnostics };
}
