/**
 * Discovery from We Work Remotely's public RSS category feeds.
 *
 * Source: `https://weworkremotely.com/categories/<category>.rss` - one feed
 * per job category, ~10-50 `<item>` elements each, no auth, no pagination.
 * robots.txt (checked live) allows everything except account/admin paths, so
 * the feeds themselves are fair game; the shared http client's per-host delay
 * is the only politeness this needs.
 *
 * This is parsed with fixed string/regex extraction of `<item>` blocks and
 * their `<title>`/`<link>`/`<region>`/`<description>` tags, CDATA-unwrapped
 * where present - no XML parser, per house rules (no new dependencies). Every
 * pattern below is a fixed literal; nothing is ever built from feed content.
 *
 * TWO STRUCTURAL PROBLEMS THIS SOURCE HAS TO WORK AROUND, both load-bearing
 * for what discover() below actually returns:
 *
 * 1. The company name is not a field - it is the text before the first colon
 *    in `<title>` ("Company: Role"). A title with no colon, an empty or
 *    implausibly long company part, or a company part that is itself a URL
 *    is not trustworthy as a name and is skipped rather than guessed at.
 *
 * 2. `<link>` and `<guid>` always point back to weworkremotely.com, never to
 *    the company - identical problem to Remote OK. Unlike Remote OK, though,
 *    the `<description>` HTML *sometimes* embeds a real link to the
 *    employer's own site (an "apply", "benefits" or "about" link). This
 *    module mines for that, conservatively: it looks at every non-mailto
 *    link in the description, drops anything on a known aggregator/ATS/
 *    social/forms host (none of those are "the company's own domain"), and
 *    accepts what is left only when the link's domain name plausibly matches
 *    the company name text-wise. A live check across the three default feeds
 *    (52 items, 2026-09-17) found this fires for well under half of listings
 *    - most WWR postings simply never link back to the employer inside the
 *    RSS description, full stop, no amount of cleverness recovers that. See
 *    discover()'s doc comment for the exact numbers and the reasoning for not
 *    trying to close that gap by guessing.
 */
import { cleanString, absoluteUrl, stripHtml, decodeEntities } from '../ats/util.mjs';
import { rootOrigin } from './host.mjs';

export const id = 'weworkremotely';
export const label = 'We Work Remotely';

const DEFAULT_FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
  'https://weworkremotely.com/categories/remote-design-jobs.rss',
];

// Defensive ceilings on a feed that has never come close to them (each
// default feed runs 10-50 items today). A pathological or hostile response
// must not be able to blow up memory or run these regexes forever.
const MAX_FEED_BYTES = 5_000_000;
const MAX_ITEMS_PER_FEED = 300;
const MAX_ITEM_BLOCK = 200_000;
const MAX_DESCRIPTION_HTML = 100_000;
const MAX_HREFS_SCANNED = 60;

const MAX_COMPANY_LEN = 60;
const DESCRIPTION_EXCERPT_MAX = 200;

/** Comparison form for names; deliberately exact-after-normalizing, not fuzzy. */
const normalizeToken = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Patterns are built from the config file, never from the fetched feed. */
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
 * Hosts that show up inside job descriptions but are never the employer's own
 * domain: the board itself, ATS/job-board platforms (the posting lives there,
 * the company does not), social/video platforms, generic forms/docs/
 * scheduling tools, a redirect-tracking wrapper seen in real feed data, and
 * listing/aggregator/compliance sites. Matched by exact host or subdomain.
 */
const BLOCKED_HOST_SUFFIXES = [
  'weworkremotely.com',
  'greenhouse.io', 'lever.co', 'workable.com', 'ashbyhq.com', 'bamboohr.com',
  'breezy.hr', 'recruitee.com', 'smartrecruiters.com', 'personio.de', 'personio.com',
  'jobvite.com', 'icims.com', 'taleo.net', 'workday.com', 'myworkdayjobs.com',
  'applytojob.com', 'cultureindex.com',
  'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'linkedin.com', 'facebook.com', 'instagram.com',
  'docs.google.com', 'forms.gle', 'typeform.com', 'notion.site', 'calendly.com', 'medium.com',
  // Outlook's link-safety wrapper - following it would record microsoft.com
  // as "the company", which is a different flavour of wrong than remoteok.com.
  'safelinks.protection.outlook.com',
  'glassdoor.com', 'indeed.com', 'angel.co', 'wellfound.com', 'crunchbase.com',
  'eeoc.gov',
];

function isBlockedHost(host) {
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** The registrable-ish label before the TLD: "careers.toasttab.com" -> "toasttab". */
function sldLabel(host) {
  const parts = host.split('.').filter((part) => part !== '');
  if (parts.length < 2) return parts[0] ?? '';
  return parts[parts.length - 2];
}

// Below this length a substring match is more likely coincidence than
// signal ("io", "co", "app" turn up inside all sorts of unrelated domains
// and company names) - short names/domains are skipped rather than risking
// a wrong match, in keeping with "never guess."
const MIN_MATCH_TOKEN_LEN = 4;

function extractHrefs(html) {
  const hrefs = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]{1,500})"|'([^']{1,500})')[^>]*>/gi)) {
    if (hrefs.length >= MAX_HREFS_SCANNED) break;
    const href = match[1] ?? match[2];
    if (href) hrefs.push(href);
  }
  return hrefs;
}

/**
 * The employer's own domain mined out of the item's description HTML, or
 * null. Walks the links in document order and accepts the first one that (a)
 * is not on the aggregator/ATS/social blocklist above and (b) has a
 * TLD-stripped domain label that plausibly names the company - either is a
 * substring of the other, after normalizing both to bare alphanumerics. That
 * second test is what keeps a random sponsor mention or a "learn more" video
 * link from being recorded as the employer's site (both do turn up in real
 * WWR descriptions).
 */
function ownDomainFromDescriptionHtml(html, companyName) {
  const cn = normalizeToken(companyName);
  if (cn.length < MIN_MATCH_TOKEN_LEN) return null;

  for (const href of extractHrefs(html)) {
    if (/^mailto:/i.test(href)) continue;

    // No base to resolve a relative href against - and guessing one (the
    // feed's own origin, say) would just manufacture a weworkremotely.com
    // link, which the blocklist would reject anyway. Absolute links only.
    const abs = absoluteUrl(href);
    if (abs === null) continue;

    let url;
    try {
      url = new URL(abs);
    } catch {
      continue;
    }

    const host = url.host.toLowerCase();
    if (host === '' || isBlockedHost(host)) continue;

    const label = normalizeToken(sldLabel(host));
    if (label.length < MIN_MATCH_TOKEN_LEN) continue;

    if (label.includes(cn) || cn.includes(label)) {
      // The matched link is whichever page the posting pointed at, so the host
      // is routinely a section of the site rather than the site — real hits
      // today included careers.toasttab.com, blog.gohighlevel.com and
      // trust.huntress.com. rootOrigin drops that leading label; see host.mjs
      // for why storing it would poison the careers probes downstream.
      return rootOrigin(url);
    }
  }

  return null;
}

/** "Company: Role" -> { company, role }, or null when the title does not
 *  trustworthily name a company. */
function splitTitle(rawTitle) {
  const title = cleanString(rawTitle);
  if (title === null) return null;

  const idx = title.indexOf(':');
  if (idx < 0) return null;

  const company = title.slice(0, idx).trim();
  const role = title.slice(idx + 1).trim();
  if (company === '' || company.length > MAX_COMPANY_LEN) return null;
  // A URL in the "company" slot means the title was not really in
  // "Company: Role" shape - trust nothing rather than store a link as a name.
  if (/https?:\/\//i.test(company) || /\bwww\./i.test(company)) return null;

  return { company, role };
}

function unwrapCdata(raw) {
  const trimmed = raw.trim();
  const match = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(trimmed);
  return match ? match[1] : raw;
}

const TITLE_PATTERN = /<title>([\s\S]*?)<\/title>/i;
const REGION_PATTERN = /<region>([\s\S]*?)<\/region>/i;
const DESCRIPTION_PATTERN = /<description>([\s\S]*?)<\/description>/i;

function firstMatch(pattern, text) {
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

function parseItem(block) {
  const capped = block.slice(0, MAX_ITEM_BLOCK);
  const title = firstMatch(TITLE_PATTERN, capped);
  if (title === null) return null;
  return {
    title,
    region: firstMatch(REGION_PATTERN, capped),
    descriptionRaw: firstMatch(DESCRIPTION_PATTERN, capped) ?? '',
  };
}

function extractItems(xml) {
  if (typeof xml !== 'string' || xml === '') return [];
  const body = xml.slice(0, MAX_FEED_BYTES);
  const items = [];
  for (const match of body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    if (items.length >= MAX_ITEMS_PER_FEED) break;
    items.push(match[1]);
  }
  return items;
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

/**
 * @param {{ get: Function }} http the shared polite client
 * @param {object} config parsed research.config.json
 * @returns {Promise<{ candidates: object[], diagnostics: string }>}
 *
 * Never throws - a feed that 404s, times out, or comes back as something
 * other than the expected XML degrades that one feed to zero items rather
 * than aborting the run; see ycombinator.discover for the reasoning this
 * module follows.
 *
 * Read the module doc comment before enabling: `<link>` never points at the
 * company, so every candidate's website is mined out of the description body
 * and, per the shared rule, dropped when nothing usable is found there. On a
 * live run across the three default feeds this let through well under half
 * of listings - most WWR postings just do not link back to the employer in
 * the RSS description. That is the honest number, not a bug in the matcher.
 */
export async function discover(http, config) {
  const discovery = config?.discovery ?? {};
  const sourceConfig = discovery.weworkremotely ?? {};
  const feeds = Array.isArray(sourceConfig.feeds) && sourceConfig.feeds.length > 0
    ? sourceConfig.feeds.filter((feed) => typeof feed === 'string' && feed.trim() !== '')
    : DEFAULT_FEEDS;

  const excludeNames = new Set(
    (discovery.excludeNames ?? [])
      .filter((name) => typeof name === 'string')
      .map((name) => normalizeToken(name))
      .filter((name) => name !== ''),
  );
  const excludeTerms = (discovery.excludeKeywords ?? []).filter(
    (term) => typeof term === 'string' && term.trim() !== '',
  );
  const cap = Number.isInteger(discovery.maxNewPerRun) && discovery.maxNewPerRun > 0
    ? discovery.maxNewPerRun
    : Infinity;

  const seenNames = new Set();
  const seenHosts = new Set();
  const candidates = [];
  const rejected = { unparsable: 0, title: 0, byName: 0, excluded: 0, noWebsite: 0, duplicate: 0 };
  const feedNotes = [];
  let itemsSeen = 0;

  for (const feedUrl of feeds) {
    if (candidates.length >= cap) break;

    const response = await http.get(feedUrl, {
      accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
    });
    if (!response.ok) {
      feedNotes.push(`${feedUrl} unreachable (HTTP ${response.status})`);
      continue;
    }

    const items = extractItems(response.body);
    itemsSeen += items.length;
    feedNotes.push(`${feedUrl.replace('https://weworkremotely.com/categories/', '')} - ${items.length} items`);

    for (const block of items) {
      if (candidates.length >= cap) break;

      const parsed = parseItem(block);
      if (parsed === null) {
        rejected.unparsable += 1;
        continue;
      }

      const split = splitTitle(parsed.title);
      if (split === null) {
        rejected.title += 1;
        continue;
      }
      const { company, role } = split;

      const normalized = normalizeToken(company);
      if (excludeNames.has(normalized)) {
        rejected.byName += 1;
        continue;
      }

      const descriptionSource = unwrapCdata(parsed.descriptionRaw).slice(0, MAX_DESCRIPTION_HTML);
      const plainDescription = stripHtml(descriptionSource);

      if (excludeTerms.length > 0 && matchesAny(excludeTerms, `${parsed.title} ${plainDescription.slice(0, 500)}`)) {
        rejected.excluded += 1;
        continue;
      }

      // The description's markup is XML-entity-escaped in the raw feed
      // (`&lt;a href=&quot;...&quot;&gt;`) - decode once to get real `<a>`
      // tags back before hunting for links. `stripHtml` above works from the
      // same raw text independently for the plain-text excerpt.
      const descriptionHtml = decodeEntities(descriptionSource);
      const site = ownDomainFromDescriptionHtml(descriptionHtml, company);
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
        name: company,
        website: site,
        description: truncate(plainDescription, DESCRIPTION_EXCERPT_MAX),
        sizeMin: null,
        sizeMax: null,
        sizeRange: null,
        // The feed's own `<region>`, verbatim - a hiring-eligibility region
        // ("Anywhere in the World", "US Only"), not necessarily an HQ, but it
        // is the source's own word for where this role can be worked from.
        hqLocation: cleanString(parsed.region),
        // A region string ("Anywhere in the World", "Europe") is not a
        // country and is never promoted into one - see the shared contract.
        country: null,
        // We Work Remotely's category is a job classification, not a
        // verified fact about the company's stack; the position scanner
        // owns `keywords` and derives it from real postings, not this.
        keywords: [],
        // Every feed here lists remote roles by construction, but one remote
        // listing is a fact about that role, not about the company: Datadog,
        // Airbnb and Cribl all arrived this way and were labelled remote while
        // almost every role on their own boards names an office. The board
        // scan and research establish the company's policy instead.
        remotePolicy: null,
        // The description is a post written to candidates; discover asks the
        // company's own homepage first and falls back to this only when it must.
        descriptionFromPost: true,
        sourceNote: `Discovered via We Work Remotely ("${role || parsed.title}" listing).`,
      });
    }
  }

  const diagnostics =
    `${id} - ${itemsSeen} listings across ${feeds.length} feed(s), ${candidates.length} candidates ` +
    `(${rejected.noWebsite} skipped: no company domain in the description` +
    (rejected.title > 0 ? `, ${rejected.title} unparsable title` : '') +
    (rejected.excluded > 0 ? `, ${rejected.excluded} excluded by keyword` : '') +
    (rejected.byName > 0 ? `, ${rejected.byName} excluded by name` : '') +
    (rejected.duplicate > 0 ? `, ${rejected.duplicate} duplicate` : '') +
    `) ${feedNotes.join('; ')}`;

  return { candidates, diagnostics };
}
