/**
 * Discovery from Hacker News "Ask HN: Who is hiring?" threads.
 *
 * Source: the free, documented, no-auth Algolia HN search API
 * (https://hn.algolia.com/api). Once a month someone posts "Ask HN: Who is
 * hiring?" and companies reply in a loose but consistent convention:
 *
 *   Company | Role | Location | REMOTE/HYBRID/ONSITE | salary | url
 *
 * This is the best public source of non-YC startups that hire remotely -
 * exactly the gap the YC source can't fill, since YC only covers companies
 * that went through YC. The same monthly author also posts "Ask HN: Who
 * wants to be hired?" (job seekers, not companies) and occasionally a
 * freelancer thread; only "Who is hiring?" titles are read.
 *
 * Comment text is untrusted HTML from anonymous strangers, so parsing here
 * is deliberately conservative: a wrong company is worse than a missed one.
 * Every field that cannot be read with confidence comes back null rather
 * than guessed. In particular a candidate with no discoverable company
 * website is dropped outright - the rest of the pipeline keys off it.
 */

import { rootOrigin } from './host.mjs';

const SEARCH_URL = 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=';
const ITEM_URL = 'https://hn.algolia.com/api/v1/items/';

export const id = 'hnhiring';
export const label = 'Hacker News "Who is hiring?"';

// A monthly-cadence source has no business reading a year of threads just
// because a config typo asked for one. This bounds worst-case run cost
// (thread bodies run ~500KB each) independent of what config says.
const MAX_THREADS = 12;

// HN autolinks pretty much everything, so comments are full of URLs that are
// not the company's own site: one specific job posting on an ATS, a LinkedIn
// profile, a Google Form. We want the company's own domain so the existing
// ATS scanner can find its real board - an ATS link here almost always points
// at one job, not the company. Matched by suffix so subdomains count too
// (boards.greenhouse.io, jobs.lever.co, ...).
const EXCLUDED_HOSTS = [
  'news.ycombinator.com',
  'ycombinator.com',
  'greenhouse.io',
  // Greenhouse's own link shortener - same company, different domain.
  'grnh.se',
  'lever.co',
  'ashbyhq.com',
  'workable.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'notion.so',
  'docs.google.com',
  'github.com',
  'gist.github.com',
  'bit.ly',
  'forms.gle',
  // Not in the original ATS/aggregator list, but added after a live run
  // turned up two candidates whose "website" was a press writeup
  // (techcrunch.com, mercurynews.com) because the poster mentioned their
  // own domain as bare text ("try it at foo.com", no scheme, so never
  // matched by findWebsite) and the first scheme'd URL in the comment was
  // a funding-announcement article instead. These outlets are never a
  // startup's own site, so excluding them is safe and closes that gap.
  'techcrunch.com',
  'mercurynews.com',
  'businessinsider.com',
  'forbes.com',
  'bloomberg.com',
  'theverge.com',
  'wired.com',
  'nytimes.com',
  'wsj.com',
  'axios.com',
  'venturebeat.com',
  'reuters.com',
  'cnbc.com',
  'prnewswire.com',
  'businesswire.com',
  // Also not in the original list, also added after a live run: these are
  // single-purpose ATS/HR platforms exactly like greenhouse.io and lever.co,
  // just less common ones that happened to show up (a company's careers page
  // living at "company.bamboohr.com" is that company's ATS tenant, not its
  // own domain).
  'recruitee.com',
  'applytojob.com',
  'bamboohr.com',
  'trinethire.com',
  'join.com',
];

/**
 * Real country names, in English, plus the American-centric abbreviations
 * ycombinator.mjs already normalizes (USA/UK/UAE). This is the only source
 * of truth for `country`: a location string is scanned for the first
 * whole-word/whole-phrase hit against this table (see `findCountryName`),
 * never inferred from capitalization or field position. That is a
 * deliberate trade: a US state ("VA", "Denver", "NYC") or a bare city
 * ("Utrecht") will never appear here and so never gets mislabeled as a
 * country, at the cost of missing countries this table doesn't carry.
 * Known false-positive risk: "Georgia" is both a country and a US state,
 * and nothing here disambiguates them - accepted because the country
 * reading is the more common one in a "hiring" context and the collision
 * is rare.
 */
const COUNTRY_ALIASES = {
  usa: 'United States', us: 'United States', 'u.s.': 'United States', 'u.s.a.': 'United States',
  'united states': 'United States', 'united states of america': 'United States',
  uk: 'United Kingdom', 'u.k.': 'United Kingdom', 'united kingdom': 'United Kingdom',
  'great britain': 'United Kingdom', britain: 'United Kingdom',
  england: 'United Kingdom', scotland: 'United Kingdom', wales: 'United Kingdom', 'northern ireland': 'United Kingdom',
  uae: 'United Arab Emirates', 'united arab emirates': 'United Arab Emirates',
  afghanistan: 'Afghanistan', albania: 'Albania', algeria: 'Algeria', andorra: 'Andorra', angola: 'Angola',
  argentina: 'Argentina', armenia: 'Armenia', australia: 'Australia', austria: 'Austria', azerbaijan: 'Azerbaijan',
  bahamas: 'Bahamas', bahrain: 'Bahrain', bangladesh: 'Bangladesh', barbados: 'Barbados', belarus: 'Belarus',
  belgium: 'Belgium', belize: 'Belize', benin: 'Benin', bhutan: 'Bhutan', bolivia: 'Bolivia',
  'bosnia and herzegovina': 'Bosnia and Herzegovina', botswana: 'Botswana', brazil: 'Brazil', brunei: 'Brunei',
  bulgaria: 'Bulgaria', cambodia: 'Cambodia', cameroon: 'Cameroon', canada: 'Canada', chad: 'Chad', chile: 'Chile',
  china: 'China', colombia: 'Colombia', 'costa rica': 'Costa Rica', croatia: 'Croatia', cuba: 'Cuba',
  cyprus: 'Cyprus', 'czech republic': 'Czech Republic', czechia: 'Czechia', denmark: 'Denmark', djibouti: 'Djibouti',
  'dominican republic': 'Dominican Republic', ecuador: 'Ecuador', egypt: 'Egypt', 'el salvador': 'El Salvador',
  estonia: 'Estonia', ethiopia: 'Ethiopia', fiji: 'Fiji', finland: 'Finland', france: 'France', gabon: 'Gabon',
  georgia: 'Georgia', germany: 'Germany', ghana: 'Ghana', greece: 'Greece', guatemala: 'Guatemala', guinea: 'Guinea',
  haiti: 'Haiti', honduras: 'Honduras', hungary: 'Hungary', iceland: 'Iceland', india: 'India', indonesia: 'Indonesia',
  iran: 'Iran', iraq: 'Iraq', ireland: 'Ireland', israel: 'Israel', italy: 'Italy', jamaica: 'Jamaica', japan: 'Japan',
  jordan: 'Jordan', kazakhstan: 'Kazakhstan', kenya: 'Kenya', kuwait: 'Kuwait', kyrgyzstan: 'Kyrgyzstan', laos: 'Laos',
  latvia: 'Latvia', lebanon: 'Lebanon', liberia: 'Liberia', libya: 'Libya', liechtenstein: 'Liechtenstein',
  lithuania: 'Lithuania', luxembourg: 'Luxembourg', madagascar: 'Madagascar', malawi: 'Malawi', malaysia: 'Malaysia',
  maldives: 'Maldives', mali: 'Mali', malta: 'Malta', mauritania: 'Mauritania', mauritius: 'Mauritius',
  mexico: 'Mexico', moldova: 'Moldova', monaco: 'Monaco', mongolia: 'Mongolia', montenegro: 'Montenegro',
  morocco: 'Morocco', mozambique: 'Mozambique', myanmar: 'Myanmar', namibia: 'Namibia', nepal: 'Nepal',
  netherlands: 'Netherlands', 'the netherlands': 'Netherlands', 'new zealand': 'New Zealand', nicaragua: 'Nicaragua',
  niger: 'Niger', nigeria: 'Nigeria', 'north korea': 'North Korea', 'north macedonia': 'North Macedonia',
  norway: 'Norway', oman: 'Oman', pakistan: 'Pakistan', panama: 'Panama', 'papua new guinea': 'Papua New Guinea',
  paraguay: 'Paraguay', peru: 'Peru', philippines: 'Philippines', poland: 'Poland', portugal: 'Portugal',
  qatar: 'Qatar', romania: 'Romania', russia: 'Russia', rwanda: 'Rwanda', 'saudi arabia': 'Saudi Arabia',
  senegal: 'Senegal', serbia: 'Serbia', singapore: 'Singapore', slovakia: 'Slovakia', slovenia: 'Slovenia',
  somalia: 'Somalia', 'south africa': 'South Africa', 'south korea': 'South Korea', 'south sudan': 'South Sudan',
  spain: 'Spain', 'sri lanka': 'Sri Lanka', sudan: 'Sudan', sweden: 'Sweden', switzerland: 'Switzerland',
  syria: 'Syria', taiwan: 'Taiwan', tajikistan: 'Tajikistan', tanzania: 'Tanzania', thailand: 'Thailand',
  togo: 'Togo', 'trinidad and tobago': 'Trinidad and Tobago', tunisia: 'Tunisia', turkey: 'Turkey',
  turkmenistan: 'Turkmenistan', uganda: 'Uganda', ukraine: 'Ukraine', uruguay: 'Uruguay', uzbekistan: 'Uzbekistan',
  venezuela: 'Venezuela', vietnam: 'Vietnam', yemen: 'Yemen', zambia: 'Zambia', zimbabwe: 'Zimbabwe',
};

/** Comparison form for names; deliberately exact-after-normalizing, not fuzzy. */
const normalizeName = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A field that reads as a job title, not a place - the exact word only
 * ("Engineer", not "Engineering" or "Engineers"). Used to keep a role out of
 * the company-name slot ("Senior Python Backend Engineer | REMOTE ..." is a
 * real comment with no company name in the header at all). Deliberately not
 * stemmed here, unlike JOB_TITLE_STEM below: a one-word brand name can
 * legitimately contain a role stem ("Salesforce" contains "sales"), which is
 * a risk worth avoiding in the name slot but not in a location field, where
 * a real company essentially never puts its own name.
 */
const JOB_TITLE_WORD = /\b(engineer|developer|designer|architect|scientist|researcher|analyst|manager|director|founder|specialist|consultant|recruiter|marketer|writer|sales)\b/i;

/**
 * The same idea, stemmed, for screening pipe fields out of location
 * candidacy - "Senior Backend Engineers, Senior Frontend Engineers" and
 * "Multiple Engineering, AI/ML Data Science, and Revenue Roles" are both
 * real comma-separated role/department lists that would otherwise pass every
 * other location check. Plurals and gerunds matter here in a way they do not
 * for the name check above, so this one matches the stem plus anything.
 */
const JOB_TITLE_STEM = /\b(?:engineer|develop|design|architect|scientist|research|analy|manag|founder|founding|specialist|consult|recruit|market|writer|sales|role|position|department)\w*\b/i;

/**
 * Common technology/platform names, for the same reason: "Python,
 * TensorFlow, PyTorch, GCP, AWS, Azure" is a real stack-list comment that
 * reads exactly like a location list (short, comma-separated, capitalized)
 * with nothing about job titles in it. This list exists purely to keep such
 * a field out of the location slot - it is never written to `keywords`,
 * which stays the job of the position scanner working from real postings.
 */
const TECH_STACK_WORD = /\b(?:python|javascript|typescript|react|node\.?js|java|golang|kotlin|swift|tensorflow|pytorch|aws|gcp|azure|kubernetes|docker|sql|ios|android|macos|sre|devops|full[-\s]?stack|frontend|backend|data science|ai\s*\/\s*ml)\b/i;

const SALARY_LIKE = /[$€£]\s?\d|\b\d[\d,]*\s?[kK]\b|\bUSD\b|\bEUR\b|\bGBP\b|\bCAD\b|\/\s?(?:yr|year|hr|hour|mo|month)\b/i;

const EMPLOYMENT_TYPE_ONLY = /^(?:full[-\s]?time|part[-\s]?time|contract(?:or)?|freelance|internship)\b/i;

/** A field that is nothing but the work-model words themselves, e.g. "ONSITE/REMOTE". */
const PURE_WORK_MODEL = /^(?:remote|hybrid|onsite|on-site)(?:\s*\/\s*(?:remote|hybrid|onsite|on-site))*$/i;

const HAS_URL = /https?:\/\//i;

/**
 * Patterns are matched against COUNTRY_ALIASES keys, which come from this
 * file, not from fetched content - same non-negotiable as everywhere else
 * in the codebase, just applied to a table instead of config.
 */
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

/**
 * The first (leftmost) country name or alias appearing as a whole word or
 * phrase in `text`, or null. Used both to read a country out of a location
 * field and, in reverse, to catch a poster who put the location first and
 * skipped the company name entirely ("Cologne, Germany | UMH | ..." is a
 * real comment - see the name-slot guard in `parseCompanyName`).
 */
function findCountryName(text) {
  let bestIndex = Infinity;
  let bestValue = null;
  for (const [key, value] of Object.entries(COUNTRY_ALIASES)) {
    const match = wordMatcher(key).exec(text);
    if (match !== null && match.index < bestIndex) {
      bestIndex = match.index;
      bestValue = value;
    }
  }
  return bestValue;
}

/** Comment bodies can run to hundreds of KB; nothing past this is examined. */
const RAW_TEXT_CAP = 4000;
const MAX_NAME_LENGTH = 60;
const MAX_NAME_WORDS = 6;
const MAX_LOCATION_LENGTH = 80;
const MAX_LOCATION_WORDS = 8;
const MAX_DESCRIPTION_LENGTH = 200;

/** Only "Ask HN: Who is hiring?" - not "who wants to be hired" or "freelancer" posts in the same series. */
function isHiringThreadTitle(title) {
  return /^ask hn:\s*who is hiring\?/i.test(String(title ?? '').trim());
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]{1,6});/gi, (match, hex) => codePoint(parseInt(hex, 16), match))
    .replace(/&#(\d{1,7});/g, (match, dec) => codePoint(Number(dec), match))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (match, name) => {
      const table = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      return table[name.toLowerCase()] ?? match;
    });
}

function codePoint(value, fallback) {
  if (!Number.isInteger(value) || value < 1 || value > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

function stripTags(text) {
  return decodeEntities(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** A non-empty trimmed string, or null. */
function cleanString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The company name is the first pipe field, but only when it reads like a
 * name: short, no embedded link (a link there usually means the company put
 * its URL inline instead of using the url field further along, which we
 * still find separately - see `findWebsite`), no email, not a sentence.
 *
 * Two more rejections earn their keep against real comments that break the
 * "Company | Role | ..." convention outright: "Senior Python Backend
 * Engineer | REMOTE (EMEA/APAC)" (a role, not a company, in the first slot)
 * and "Cologne, Germany | UMH | Product Engineer | ..." (the poster led with
 * the office location instead of the name). Both are rare, but both would
 * otherwise sail through - short, no URL, no @, well under the word cap.
 */
function parseCompanyName(field) {
  const name = cleanString(field);
  if (name === null) return null;
  if (name.length > MAX_NAME_LENGTH) return null;
  if (HAS_URL.test(name)) return null;
  if (name.includes('@')) return null;
  if (name.split(/\s+/).filter(Boolean).length > MAX_NAME_WORDS) return null;
  if (JOB_TITLE_WORD.test(name)) return null;
  if (name.includes(',') && findCountryName(name) !== null) return null;
  return name;
}

function hostExcluded(host) {
  const lower = host.toLowerCase();
  return EXCLUDED_HOSTS.some((excluded) => lower === excluded || lower.endsWith(`.${excluded}`));
}

/**
 * The first http(s) URL anywhere in the comment (header or prose) that is not
 * on an excluded host, reduced to its origin. Scanning the whole comment,
 * not just the header, matters: plenty of posters put the header URL as
 * "Company | Role | ..." with no inline link and mention the site only in
 * the prose below ("apply at example.com/careers" or a bare link at the end).
 */
function findWebsite(decodedText) {
  const matches = decodedText.match(/https?:\/\/[^\s"'<>)]+/gi);
  if (matches === null) return null;

  for (const raw of matches) {
    // Trailing sentence punctuation ("...at https://foo.com." or "(https://foo.com)")
    // is not part of the URL; strip it before parsing.
    const trimmed = raw.replace(/[.,;:!?)\]}'"]+$/, '');
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (hostExcluded(url.hostname)) continue;
    // People link the page they mean — careers.acme.com, blog.acme.com — and
    // storing that subdomain sends every downstream /careers probe to the wrong
    // host and hands the ATS detector a section word as the board token. One
    // real example: Operations1 posted career.operations1.com, and the probe
    // then matched lever/career, a stranger's test board. See host.mjs.
    return rootOrigin(url);
  }
  return null;
}

/**
 * Scans the header line only. A company that names a city and nothing else
 * has told us nothing about whether it allows remote work, so the default is
 * null, never 'onsite' - guessing 'onsite' would be our assumption dressed up
 * as their word.
 */
function parseRemotePolicy(headerText) {
  if (/\bhybrid\b/i.test(headerText)) return 'hybrid';
  if (/\bremote\b/i.test(headerText)) return 'remote';
  if (/\b(?:onsite|on-site|in.office)\b/i.test(headerText)) return 'onsite';
  return null;
}

function isLocationCandidate(field) {
  const t = field.trim();
  if (t === '') return false;
  if (t.length > MAX_LOCATION_LENGTH) return false;
  if (HAS_URL.test(t)) return false;
  if (SALARY_LIKE.test(t)) return false;
  if (EMPLOYMENT_TYPE_ONLY.test(t)) return false;
  if (PURE_WORK_MODEL.test(t)) return false;
  if (JOB_TITLE_STEM.test(t)) return false;
  if (TECH_STACK_WORD.test(t)) return false;
  if (t.split(/\s+/).filter(Boolean).length > MAX_LOCATION_WORDS) return false;
  // A real "City, Region" or "City, State, Country" location essentially
  // never runs past three comma segments; a stack list ("Python, TensorFlow,
  // PyTorch, GCP, AWS, Azure") or a role list that slipped past the checks
  // above usually does. This is what caught the stack-list case in practice.
  if (t.split(',').length > 3) return false;
  return true;
}

/** A field that names a work model, and says more than just the model word. */
function mentionsWorkModel(field) {
  return /\b(?:remote|hybrid|onsite|on-site)\b/i.test(field);
}

/**
 * hqLocation is whichever non-name pipe field looks like a place, verbatim.
 * There is no fixed field position to trust - "Company | Role | Location |
 * REMOTE" and "Company | Role | REMOTE (worldwide)" are both common - so
 * this does not simply take the first field that fails no negative check.
 * That was tried and broke on roles like "Fullstack SWE": no comma, no job
 * title word in the denylist, nothing about it disqualifies it, so it was
 * picked as the "location" ahead of the real one two fields later. A denylist
 * of role words can never be complete (title abbreviations are endless), so
 * this instead requires a *positive* geographic signal: a comma (the
 * overwhelming majority of real location fields are "City, Region" or
 * "City, Country") or an explicit remote/hybrid/onsite mention with more to
 * it than just that word. Comma wins when both a comma field and a
 * work-model field are present, since a comma is the stronger signal and
 * role lists ("Senior X, Senior Y") are already screened out by
 * JOB_TITLE_WORD before either pass sees them. Nothing surviving both passes
 * means null: guessing wrong is worse than not knowing.
 */
function findLocationField(restFields) {
  const withComma = restFields.find((field) => field.includes(',') && isLocationCandidate(field));
  if (withComma !== undefined) return withComma;
  const withWorkModel = restFields.find((field) => mentionsWorkModel(field) && isLocationCandidate(field));
  return withWorkModel ?? null;
}

/**
 * Country only when the location field names one from COUNTRY_ALIASES,
 * anywhere in the string - never inferred from position or capitalization.
 * An earlier version tried "last comma segment, if it looks like a proper
 * noun", which read a real comment's "Remote, PT/ET hours preferred" as
 * country "PT/ET hours preferred" and "Seattle, Portland, Denver" as country
 * "Denver": capitalization tells you a segment is a proper noun, not that it
 * is a country rather than a city, state, or department. A closed table has
 * no such failure mode - "Denver" is simply not in it - at the cost of never
 * recognizing a country this table does not carry.
 */
function parseCountry(locationField) {
  if (locationField === null) return null;
  return findCountryName(locationField);
}

/**
 * One "Company | Role | ... " comment to a candidate, or null when the
 * comment does not conservatively parse as a company. Nothing in here
 * throws - a comment this function cannot make sense of just yields null,
 * the same as a comment that was never posted.
 */
function parseComment(rawText, sourceNote, rejected) {
  if (typeof rawText !== 'string' || rawText.trim() === '') {
    rejected.noParse += 1;
    return null;
  }

  const capped = rawText.slice(0, RAW_TEXT_CAP);
  const decoded = decodeEntities(capped);

  const boundary = capped.search(/<p/i);
  const headerRaw = boundary === -1 ? capped : capped.slice(0, boundary);
  const restRaw = boundary === -1 ? '' : capped.slice(boundary);

  const headerText = stripTags(headerRaw);
  const fields = headerText.split('|').map((field) => field.trim());

  // The pipe convention is what makes any of this parseable at all. A
  // header with no pipe in it - a reply that leaked in, a personal "who
  // wants to be hired"-style post, a one-line joke - is not a company
  // listing, and letting parseCompanyName decide alone let exactly that kind
  // of noise through ("Location: Lahore, Pakistan Remote: Yes" parsed as a
  // six-word, URL-free, comma-bearing "company name" with nothing to stop
  // it).
  if (fields.length < 2) {
    rejected.noParse += 1;
    return null;
  }

  const name = parseCompanyName(fields[0]);
  if (name === null) {
    rejected.noParse += 1;
    return null;
  }

  const website = findWebsite(decoded);
  // Without a website the record is unusable - the whole pipeline keys off
  // it (dedup, the ATS scanner, the directory listing itself).
  if (website === null) {
    rejected.noWebsite += 1;
    return null;
  }

  const restFields = fields.slice(1);
  const locationField = findLocationField(restFields);

  const description = stripTags(restRaw).slice(0, MAX_DESCRIPTION_LENGTH);

  return {
    name,
    website,
    description,
    sizeMin: null,
    sizeMax: null,
    sizeRange: null,
    // HN comments do not state headcount reliably, so these stay null rather
    // than inferring anything from role count or prose.
    hqLocation: locationField,
    country: parseCountry(locationField),
    // Left empty on purpose: the position scanner derives technology
    // keywords from real job postings once a company is added. Regexing a
    // "who is hiring" comment for tech names would just duplicate that work
    // on noisier input and could plant a keyword the scanner never confirms.
    keywords: [],
    remotePolicy: parseRemotePolicy(headerText),
    sourceNote,
  };
}

function monthLabel(title) {
  const match = /\(([^)]+)\)\s*$/.exec(String(title ?? ''));
  return match ? match[1] : null;
}

// wordMatcher (config terms, matched whole-word, same idea as ycombinator.mjs
// so "data" in excludeKeywords does not sweep in every comment mentioning
// "database") is defined above, next to COUNTRY_ALIASES - it backs both.
function matchesAny(terms, haystack) {
  return terms.some((term) => wordMatcher(term).test(haystack));
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
  const discovery = config?.discovery ?? {};
  const opts = discovery.hnhiring ?? {};

  const monthsWanted = Number.isInteger(opts.months) && opts.months > 0
    ? Math.min(opts.months, MAX_THREADS)
    : 3;
  const remoteOnly = opts.remoteOnly !== false;

  // The series interleaves "Who is hiring?" with "Who wants to be hired?"
  // (and occasionally a freelancer thread) at roughly 1:1, so ask for a few
  // times the threads we actually want and filter by title.
  const hitsPerPage = Math.min(Math.max(monthsWanted * 4, 6), 60);

  const searchResponse = await http.get(`${SEARCH_URL}${hitsPerPage}`);
  if (!searchResponse.ok) {
    return { candidates: [], diagnostics: `${id} - search unreachable (HTTP ${searchResponse.status})` };
  }
  const searchResult = searchResponse.json();
  const hits = Array.isArray(searchResult?.hits) ? searchResult.hits : null;
  if (hits === null) {
    return { candidates: [], diagnostics: `${id} - search response was not a hit list` };
  }

  const threads = hits
    .filter((hit) => isHiringThreadTitle(hit?.title))
    .slice(0, monthsWanted);

  if (threads.length === 0) {
    return { candidates: [], diagnostics: `${id} - no "Who is hiring?" thread found in latest ${hitsPerPage} posts` };
  }

  // .filter() over a non-array would throw, and a hand-edited config.json is
  // exactly the kind of input that can have the wrong shape - a discovery
  // source failing to find companies is fine, crashing the whole run over a
  // config typo is not.
  const excludeKeywordsList = Array.isArray(discovery.excludeKeywords) ? discovery.excludeKeywords : [];
  const excludeTerms = excludeKeywordsList.filter((term) => typeof term === 'string' && term.trim() !== '');
  const excludeNamesList = Array.isArray(discovery.excludeNames) ? discovery.excludeNames : [];
  const excludeNames = new Set(
    excludeNamesList
      .filter((term) => typeof term === 'string')
      .map((term) => normalizeName(term))
      .filter((term) => term !== ''),
  );
  const cap = Number.isInteger(discovery.maxNewPerRun) && discovery.maxNewPerRun > 0
    ? discovery.maxNewPerRun
    : Infinity;

  let threadsRead = 0;
  let commentsSeen = 0;
  const rejected = { noParse: 0, noWebsite: 0, notRemote: 0, excludedName: 0, excludedKeyword: 0, duplicate: 0 };
  const seenNames = new Set();
  const seenHosts = new Set();
  const matched = [];

  for (const thread of threads) {
    const threadId = thread?.objectID;
    if (typeof threadId !== 'string' && typeof threadId !== 'number') continue;

    const itemResponse = await http.get(`${ITEM_URL}${threadId}`);
    if (!itemResponse.ok) continue;
    const item = itemResponse.json();
    const children = Array.isArray(item?.children) ? item.children : null;
    if (children === null) continue;

    threadsRead += 1;
    const sourceNote = `Discovered via Hacker News "Who is hiring?" (${monthLabel(thread.title) ?? threadId}).`;

    // Top-level comments only - a reply to a comment is a conversation about
    // a posting, not a posting itself.
    for (const comment of children) {
      commentsSeen += 1;
      if (comment?.dead === true || comment?.deleted === true) continue;

      const candidate = parseComment(comment?.text, sourceNote, rejected);
      if (candidate === null) continue;

      if (remoteOnly && candidate.remotePolicy !== 'remote' && candidate.remotePolicy !== 'hybrid') {
        rejected.notRemote += 1;
        continue;
      }

      if (excludeNames.has(normalizeName(candidate.name))) {
        rejected.excludedName += 1;
        continue;
      }

      const haystack = `${candidate.name} ${candidate.description}`;
      if (excludeTerms.length > 0 && matchesAny(excludeTerms, haystack)) {
        rejected.excludedKeyword += 1;
        continue;
      }

      const nameKey = normalizeName(candidate.name);
      let host = null;
      try {
        host = new URL(candidate.website).host;
      } catch {
        host = null;
      }
      // Same company posts every month; keep the first (most recent, since
      // threads are read newest-first) sighting and drop the rest.
      if (seenNames.has(nameKey) || (host !== null && seenHosts.has(host))) {
        rejected.duplicate += 1;
        continue;
      }
      seenNames.add(nameKey);
      if (host !== null) seenHosts.add(host);

      matched.push(candidate);
      if (matched.length >= cap) break;
    }
    if (matched.length >= cap) break;
  }

  const remoteCount = matched.filter((c) => c.remotePolicy === 'remote').length;
  const hybridCount = matched.filter((c) => c.remotePolicy === 'hybrid').length;
  const nullCount = matched.length - remoteCount - hybridCount;

  const diagnostics =
    `${id} - ${threadsRead}/${threads.length} threads read, ${commentsSeen} comments seen, ` +
    `${matched.length} candidates returned (${remoteCount} remote, ${hybridCount} hybrid, ${nullCount} unspecified); ` +
    `rejected: ${rejected.noParse} unparsable, ${rejected.noWebsite} no website, ${rejected.notRemote} not remote/hybrid, ` +
    `${rejected.excludedName} excluded by name, ${rejected.excludedKeyword} excluded by keyword, ${rejected.duplicate} duplicate`;

  return { candidates: matched, diagnostics };
}
