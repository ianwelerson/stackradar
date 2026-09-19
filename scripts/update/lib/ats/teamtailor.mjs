/**
 * Teamtailor — https://{token}.teamtailor.com/jobs.json
 *
 * Teamtailor's documented API needs an API key, which this project does not
 * have. It does not need one: every public Teamtailor career site serves a JSON
 * Feed 1.1 document at /jobs.json, and each item carries the platform's own
 * schema.org JobPosting under `_jobposting` — title, per-role URL, datePosted,
 * description, and a postal address with an ISO country code. That is a
 * structured, machine-generated feed, so nothing here scrapes rendered markup.
 *
 * Verified live against `starship` (4 roles), `tibber` (10), `templafy` (7),
 * `instabee` (48) and the custom domain `careers.pactum.com` (5). The per-role
 * URLs are the feed's own `url` values, e.g.
 * https://starship.teamtailor.com/jobs/8362493-finance-business-partner, which
 * loads that posting.
 *
 * Two things the feed is better at than the career site it belongs to: it is
 * not paginated (instabee's /jobs page lists 20 and the feed returns all 48),
 * and it is served on custom domains too. Companies that move their board to
 * their own domain lose the {token}.teamtailor.com subdomain entirely —
 * pactum.com/careers redirects to careers.pactum.com and
 * pactum{,-ai,ai}.teamtailor.com all 404 — so a token here may be either a bare
 * subdomain label or a full hostname.
 *
 * Tenancy check: an unknown subdomain answers a clean 404 with an empty body
 * (verified), and a real tenant with nothing open answers 200 with
 * {"items":[]} (verified on `normative` and `hemnet`). The two are
 * distinguishable, so an empty feed is reported as a confirmed-empty board. The
 * response still has to be a real JSON Feed — a `version` of
 * https://jsonfeed.org/version/… and an `items` array — before any of that
 * counts, which is what keeps a custom host that answers 200 with something
 * else from being read as a board.
 *
 * What the public feed does not carry is a work model. Teamtailor shows one on
 * the career site ("Fully Remote" / "Hybrid" / "Onsite") but does not put it in
 * `_jobposting`: across 74 live postings not one had `jobLocationType` or
 * `applicantLocationRequirements`. So `remoteHint` is usually null here, which
 * is the honest answer; the schema.org TELECOMMUTE value is still honoured for
 * the boards that do set it.
 */
import {
  absoluteUrl,
  cleanString,
  countryFromCode,
  isoDay,
  joinText,
  normalizeWorkplace,
  readJson,
  stripHtml,
} from './util.mjs';

export const platform = 'teamtailor';

/** A bare subdomain label, or a full hostname for a board on a custom domain. */
const LABEL_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;
const HOST_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*\.)+[A-Za-z]{2,24}$/;

function hostFor(token) {
  if (typeof token !== 'string') return null;
  const raw = token.trim().toLowerCase();
  if (LABEL_SHAPE.test(raw)) return `${raw}.teamtailor.com`;
  if (HOST_SHAPE.test(raw)) return raw;
  return null;
}

export const boardUrl = (token) => {
  const host = hostFor(token);
  return host === null ? null : `https://${host}/jobs`;
};

const feedUrl = (host) => `https://${host}/jobs.json`;

const JSON_FEED = /^https:\/\/jsonfeed\.org\/version\//i;

/** The places one posting names, as "City, Country" joined with " · ". */
function placesOf(posting) {
  const raw = posting.jobLocation;
  return (Array.isArray(raw) ? raw : [raw]).filter(
    (place) => place !== null && typeof place === 'object',
  );
}

function addressText(address, country) {
  const parts = [];
  for (const part of [cleanString(address.addressLocality), country ?? cleanString(address.addressRegion)]) {
    if (part === null) continue;
    if (parts.some((existing) => existing.toLowerCase() === part.toLowerCase())) continue;
    parts.push(part);
  }
  return parts.length === 0 ? null : parts.join(', ');
}

export async function fetchJobs(http, token) {
  const host = hostFor(token);
  if (host === null) return null;

  const body = readJson(await http.get(feedUrl(host), { accept: 'application/feed+json, application/json' }));
  if (body === null || typeof body !== 'object') return null;
  // Structural proof this is a Teamtailor-shaped JSON Feed and not some other
  // 200 that happened to be JSON.
  if (typeof body.version !== 'string' || !JSON_FEED.test(body.version)) return null;
  if (!Array.isArray(body.items)) return null;

  const jobs = [];

  for (const item of body.items) {
    if (item === null || typeof item !== 'object') continue;

    const posting = item._jobposting !== null && typeof item._jobposting === 'object' ? item._jobposting : {};

    const title = cleanString(item.title) ?? cleanString(posting.title);
    if (title === null) continue;

    const locations = [];
    const countries = new Set();
    for (const place of placesOf(posting)) {
      const address = place.address !== null && typeof place.address === 'object' ? place.address : {};
      const country = countryFromCode(address.addressCountry);
      if (country !== null) countries.add(country);
      const text = addressText(address, country);
      if (text !== null && !locations.includes(text)) locations.push(text);
    }
    const location = locations.length === 0 ? null : locations.join(' · ');

    jobs.push({
      title,
      url: absoluteUrl(item.url) ?? absoluteUrl(posting.url),
      postedDate: isoDay(item.date_published) ?? isoDay(posting.datePosted),
      text: joinText(
        stripHtml(item.content_html ?? posting.description ?? ''),
        cleanString(posting.occupationalCategory),
        cleanString(posting.employmentType),
        location,
      ),
      location,
      // One posting spanning several countries is genuinely ambiguous evidence,
      // so it contributes none rather than whichever address came first.
      countryHint: countries.size === 1 ? [...countries][0] : null,
      remoteHint:
        cleanString(posting.jobLocationType)?.toUpperCase() === 'TELECOMMUTE'
          ? 'remote'
          : normalizeWorkplace(location),
    });
  }

  return { jobs, skipped: 0, companyName: cleanString(body.title) };
}
