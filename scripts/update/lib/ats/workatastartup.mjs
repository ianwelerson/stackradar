/**
 * Work at a Startup — https://www.workatastartup.com/companies/{slug}
 *
 * YC's own job board, and for a large share of YC companies the only public
 * one: the startup's own site frequently has no careers page at all, or has a
 * page that is a mailto link. `token` is the WAAS company slug, which is the
 * last path segment of the careersUrl the discovery source writes.
 *
 * WAAS is an Inertia.js Rails app. Every public page ships its controller's
 * props as HTML-escaped JSON in a `data-page` attribute, so a single HTML GET
 * of the company profile yields the entire jobs array. That matters for
 * politeness as much as for speed: the alternative is one request per posting,
 * and a company with thirty open roles would cost thirty requests every scan.
 *
 * Two traps this file exists to avoid:
 *
 * 1. The jobs feed's `applyUrl` points at account.ycombinator.com — a login
 *    wall. Storing it would send every reader to a YC signup form instead of
 *    the role we told them about, which is the exact failure ats/index.mjs is
 *    written to prevent. Openings link to the public permalink /jobs/{id},
 *    verified to render the full posting to a signed-out visitor.
 * 2. WAAS answers 406 to any Accept header that does not offer HTML — the
 *    shared client's default `application/json, text/html;q=0.9` included. A
 *    406 is indistinguishable from a dead board at the call site, so every
 *    request here passes `accept` explicitly.
 *
 * Verified live against the `mason` profile.
 */
import { absoluteUrl, cleanString, countryFromCode, joinText, normalizeWorkplace, stripHtml } from './util.mjs';

export const platform = 'workatastartup';

const ORIGIN = 'https://www.workatastartup.com';

/** WAAS 406s without this; see the header note above. */
export const HTML_ACCEPT = 'text/html, application/xhtml+xml';

export const boardUrl = (token) => `${ORIGIN}/companies/${encodeURIComponent(token)}`;

/** The public, signed-out permalink for one posting. */
export const jobUrl = (id) => `${ORIGIN}/jobs/${encodeURIComponent(id)}`;

/** A profile page is ~50KB and a jobs index ~75KB; a megabyte is slack, not a
 *  budget, and it stops a pathological response from being scanned in full. */
const MAX_HTML = 1_000_000;

/** Postings per company. WAAS caps a profile well below this in practice. */
const MAX_JOBS = 200;

/** Detail pages fetched by the opt-in skills pass; see fetchJobs. */
const DEFAULT_MAX_DETAIL_FETCHES = 5;

/**
 * The `data-page` attribute, extracted without compiling anything from the
 * page. The value is HTML-escaped JSON, so every real quote inside it arrives
 * as `&quot;` and the first bare `"` does close the attribute — but relying on
 * that alone breaks the day Rails changes its escaping, so the match is
 * anchored on the ` id=` attribute that always follows it in Inertia's layout.
 */
const DATA_PAGE = /data-page="([\s\S]*?)"\s+id=/;

/**
 * Inertia's page object, or null.
 *
 * `&amp;` is unescaped last on purpose. Going the other way turns a literal
 * `&amp;quot;` in the page's own text into a quote character and corrupts the
 * JSON — the classic double-unescape bug, and the reason this is a fixed
 * sequence of replacements rather than a generic entity decoder.
 */
export function parseInertiaPage(html) {
  if (typeof html !== 'string' || html === '') return null;

  const match = DATA_PAGE.exec(html.slice(0, MAX_HTML));
  if (match === null) return null;

  const json = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  try {
    const page = JSON.parse(json);
    return page !== null && typeof page === 'object' ? page : null;
  } catch {
    // A truncated or re-templated page is "we learned nothing", never a throw:
    // one unreadable profile must not take a whole run down.
    return null;
  }
}

/** ISO 3166 names the updater will accept spelled out, plus the shorthands YC
 *  writes. Built once from Intl so there is no country table to maintain. */
let regionsByName = null;

function regionIndex() {
  if (regionsByName !== null) return regionsByName;
  regionsByName = new Map([
    ['usa', 'United States'],
    ['us', 'United States'],
    ['u.s.', 'United States'],
    ['u.s.a.', 'United States'],
    ['united states of america', 'United States'],
    ['uk', 'United Kingdom'],
    ['u.k.', 'United Kingdom'],
    ['uae', 'United Arab Emirates'],
  ]);
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first, second);
        let name;
        try {
          name = display.of(code);
        } catch {
          continue;
        }
        // Intl echoes an unassigned code back, or answers "Unknown Region".
        if (typeof name !== 'string' || name === code) continue;
        if (/^unknown region$/i.test(name)) continue;
        if (!regionsByName.has(name.toLowerCase())) regionsByName.set(name.toLowerCase(), name);
      }
    }
  } catch {
    // An ICU build without region data still leaves the shorthands above.
  }
  return regionsByName;
}

/** A spelled-out country name, or null. "England" and "Seattle" are neither. */
function countryFromName(segment) {
  if (segment.length > 60) return null;
  return regionIndex().get(segment.toLowerCase()) ?? null;
}

const PAREN_CODE = /\(([A-Za-z]{2})\)$/;
const TWO_LETTERS = /^[A-Za-z]{2}$/;

/**
 * One `/`-free location fragment to a country.
 *
 * The shapes WAAS actually writes, all sampled from the live feed:
 *
 *   "San Francisco, CA, US"   three segments, last is ISO   -> United States
 *   "Pune, Maharashtra, IN"   three segments, last is ISO   -> India
 *   "Remote (US)"             parenthesised ISO code        -> United States
 *   "CA"                      bare ISO code                 -> Canada
 *   "Remote, United States"   spelled out                   -> United States
 *   "Seattle, WA"             US-style city + state code    -> null
 *   "Bangalore"               a bare city                   -> null
 *
 * The "Seattle, WA" case is why a two-letter final segment is only read as a
 * country when it is alone or preceded by two or more segments. In a
 * "City, XX" pair the code is an American state abbreviation, and resolving it
 * through ISO would file Seattle under Western Australia and San Francisco
 * under Canada. There is no way to tell the two apart from the string, so the
 * field is left null: a wrong country is worse than a missing one.
 */
function countryOfFragment(fragment) {
  const segments = fragment.split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (segments.length === 0) return null;

  const last = segments[segments.length - 1];

  const parenthesised = PAREN_CODE.exec(last);
  if (parenthesised !== null) return countryFromCode(parenthesised[1]);

  if (/^remote$/i.test(last)) return null;

  if (TWO_LETTERS.test(last)) {
    return segments.length === 1 || segments.length >= 3 ? countryFromCode(last) : null;
  }

  return countryFromName(last);
}

/**
 * A country from a WAAS location string, or null.
 *
 * A role posted in two countries ("London, England, GB / New York, NY, US")
 * names no single country, and ats/index.mjs rolls these hints up into a
 * company-level claim, so an ambiguous string contributes nothing rather than
 * casting half a vote each way.
 */
export function countryFromLocation(value) {
  const raw = cleanString(value);
  if (raw === null || raw.length > 200) return null;

  const found = new Set();
  for (const fragment of raw.split('/').slice(0, 8)) {
    const country = countryOfFragment(fragment);
    if (country !== null) found.add(country);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * The `company` prop from a WAAS profile page, or null for any response we did
 * not positively read.
 *
 * Exported because the discovery source needs exactly this object — website,
 * location, teamSize, industries — and two independent readers of the same
 * Inertia payload would drift apart the first time WAAS renames a field.
 */
export async function fetchCompanyProfile(http, slug) {
  const response = await http.get(boardUrl(slug), { accept: HTML_ACCEPT });
  if (!response.ok) return null;

  const page = parseInertiaPage(response.body);
  const company = page?.props?.company;
  if (company === null || company === undefined || typeof company !== 'object') return null;
  return company;
}

/** The `job` prop from a posting's own page, or null. */
async function fetchJobDetail(http, id) {
  const response = await http.get(jobUrl(id), { accept: HTML_ACCEPT });
  if (!response.ok) return null;

  const page = parseInertiaPage(response.body);
  const job = page?.props?.job;
  if (job === null || job === undefined || typeof job !== 'object') return null;
  return job;
}

/** WAAS ids are Rails primary keys; anything else cannot address a permalink. */
function postingId(value) {
  if (Number.isInteger(value) && value > 0 && value < 1e12) return value;
  if (typeof value === 'string' && /^[1-9][0-9]{0,11}$/.test(value)) return Number(value);
  return null;
}

/** The declared skills list, cleaned. Free per posting on a detail page and a
 *  far better stack signal than regex-reading prose, but it costs a request. */
function skillText(skills) {
  if (!Array.isArray(skills)) return '';
  return skills
    .map((skill) => cleanString(skill))
    .filter((skill) => skill !== null && skill.length <= 60)
    .slice(0, 40)
    .join(', ');
}

/**
 * Read a company's public postings from its WAAS profile.
 *
 * @param {{ get: Function }} http the shared polite client
 * @param {string} token the WAAS company slug
 * @param {{ includeSkills?: boolean, maxDetailFetches?: number }} [options]
 *   `includeSkills` turns on a second pass that fetches up to
 *   `maxDetailFetches` posting pages for their declared `skills` array. It is
 *   off by default because it costs one request per posting: a normal scan
 *   reads a company in one request, and this would multiply that by the number
 *   of roles for a stack signal the company-level tech blurb already
 *   approximates. Turn it on for a targeted enrichment pass, not for a sweep.
 * @returns {{ jobs: object[], skipped: number, companyName: string|null }|null}
 *   null for every unread response — a non-2xx, an unparseable page, a payload
 *   with no jobs array. An empty `jobs` array is only ever returned for a
 *   profile that loaded and genuinely listed nothing, because the caller turns
 *   that into "this company stopped hiring" and erases its openings.
 */
export async function fetchJobs(http, token, { includeSkills = false, maxDetailFetches = DEFAULT_MAX_DETAIL_FETCHES } = {}) {
  const company = await fetchCompanyProfile(http, token);
  if (company === null) return null;

  // No array means the page rendered something other than a company profile —
  // a redirect to the directory, an error page Rails still answered 200 for.
  // Absent is "we learned nothing"; present and empty is a real, empty board.
  if (!Array.isArray(company.jobs)) return null;

  // Company-level stack prose. WAAS gives postings on a profile no description
  // of their own, so this is the only technology text available without a
  // request per role. It is the same for every opening, which is honest — it
  // describes the company's stack, not the role's — but it does mean the
  // detected keywords on a WAAS company's openings are uniform by construction.
  const techText = stripHtml(company.techDescriptionHtml);

  const jobs = [];
  // Posting ids, parallel to `jobs`. Kept separately so the optional skills
  // pass addresses the posting it actually built rather than indexing back
  // into company.jobs, which the skipped entries below have shifted out of
  // step with it.
  const ids = [];
  let skipped = 0;

  for (const entry of company.jobs.slice(0, MAX_JOBS)) {
    if (entry === null || typeof entry !== 'object') continue;

    const title = cleanString(entry.title);
    const id = postingId(entry.id);
    // Without an id there is no permalink, and the only other link WAAS offers
    // is the login wall. A posting nobody can open is not worth listing.
    if (title === null || id === null) {
      skipped += 1;
      continue;
    }

    const location = cleanString(entry.location);

    ids.push(id);
    jobs.push({
      title,
      url: absoluteUrl(jobUrl(id)),
      // WAAS publishes no posting date anywhere on the profile. The feed's
      // `companyLastActiveAt` is a relative string about the company's last
      // login, not about this role, so converting it would manufacture a date
      // the source never claimed.
      postedDate: null,
      text: joinText(title, location, cleanString(entry.jobType), techText),
      location,
      countryHint: countryFromLocation(location),
      // normalizeWorkplace already reads "Remote (US)" and "San Francisco - In
      // Office"; the word test behind it is the belt to its braces for a
      // location that says remote in a shape the vocabulary does not list.
      remoteHint: normalizeWorkplace(location) ?? (/\bremote\b/i.test(location ?? '') ? 'remote' : null),
    });
  }

  if (includeSkills && jobs.length > 0) {
    const budget = Number.isInteger(maxDetailFetches) && maxDetailFetches > 0
      ? Math.min(maxDetailFetches, jobs.length)
      : 0;
    for (let index = 0; index < budget; index += 1) {
      const detail = await fetchJobDetail(http, ids[index]);
      if (detail === null) continue;
      const skills = skillText(detail.skills);
      // A failed detail fetch leaves the posting exactly as the profile
      // described it; the pass only ever adds text, never replaces it.
      if (skills !== '') jobs[index].text = joinText(jobs[index].text, skills);
    }
  }

  return { jobs, skipped, companyName: cleanString(company.name) };
}
