/**
 * BambooHR — https://{token}.bamboohr.com/careers/list
 *
 * Verified live against the `jobbatical` (2), `estateguru` (5), `wallester` (4)
 * and `ridango` (9) tenants.
 *
 * Per-posting URL: https://{token}.bamboohr.com/careers/{id}. Confirmed two
 * ways, not assumed — fetching https://ridango.bamboohr.com/careers/81 returns
 * that posting's own `og:title` ("Data & Analytics Engineering Lead "), byte for
 * byte the `jobOpeningName` the list gave us, and BambooHR's own embeddable
 * board (/jobs/embed2.php) links every role at exactly that path.
 *
 * Tenancy check: an unknown subdomain does not 404. It 302s to
 * https://www.bamboohr.com (verified), which the shared client follows into a
 * 200 HTML marketing page. Two things keep that from being read as a board:
 * the final URL must still be the tenant's own host — `www.bamboohr.com` also
 * ends in `.bamboohr.com`, so the check is equality, not a suffix — and the
 * body must parse as JSON with a `result` array.
 *
 * Empty boards are therefore safe to report as empty: a real tenant with
 * nothing open answers 200 with {"meta":{"totalCount":0},"result":[]} (verified
 * on `company` and `sandbox`, both live tenants), and a tenant that does not
 * exist never reaches that branch at all. Unlike SmartRecruiters, the two cases
 * are distinguishable, so [] here is a genuine "confirmed: nothing open".
 *
 * The list payload carries no posted date and no description. Both exist on
 * /careers/{id}/detail, but that is one extra request per posting — nine for
 * Ridango alone — against a small company's own server. Not worth it for a
 * field the UI treats as optional, so `postedDate` is null rather than invented
 * and keyword text comes from the title, department and location only.
 */
import {
  cleanString,
  countryFromCode,
  joinText,
  normalizeWorkplace,
  readJson,
} from './util.mjs';

export const platform = 'bamboohr';

/** A single hostname label — the token becomes a subdomain, so nothing else. */
const TOKEN_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;

const hostFor = (token) =>
  typeof token === 'string' && TOKEN_SHAPE.test(token) ? `${token.toLowerCase()}.bamboohr.com` : null;

export const boardUrl = (token) => `https://${encodeURIComponent(token)}.bamboohr.com/careers`;

/**
 * BambooHR's work model, taken from its own board rendering rather than
 * guessed: on /jobs/embed2.php a locationType of 1 renders as "Remote", 2 as
 * "Tallinn, Estonia (Hybrid)", and 0 as a bare city. Checked against all 20
 * postings across the four tenants above; every one agreed. `isRemote` was null
 * on all 20, so it is only a fallback for a value we do not recognise.
 */
const WORKPLACE_BY_LOCATION_TYPE = { 0: 'onsite', 1: 'remote', 2: 'hybrid' };

const listUrl = (host) => `https://${host}/careers/list`;

/** English country names, keyed lowercase. Built once, lazily, from Intl. */
let countryNames = null;

function englishCountryNames() {
  const names = new Map();
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first, second);
        const name = display.of(code);
        // Intl echoes unassigned codes back and answers "Unknown Region" for
        // the private-use ones; neither is a country.
        if (typeof name !== 'string' || name === code) continue;
        if (/^unknown region$/i.test(name)) continue;
        names.set(name.toLowerCase(), name);
      }
    }
  } catch {
    // No ICU data: fall back to the ISO-code path only.
  }
  return names;
}

/**
 * `atsLocation.country` is a free-text field on the employer's side and has
 * held both "Spain" and nothing at all. Accept it only when it is an ISO
 * alpha-2 code or a real English country name — never as raw text, which would
 * seed the country signal with whatever someone typed.
 */
function countryName(value) {
  const raw = cleanString(value);
  if (raw === null) return null;

  const fromCode = countryFromCode(raw);
  if (fromCode !== null) return fromCode;

  if (countryNames === null) countryNames = englishCountryNames();
  return countryNames.get(raw.toLowerCase()) ?? null;
}

/** Join location parts, dropping repeats — `atsLocation` has held
 *  {country: "Spain", province: "Spain", city: "Spain"} on a live posting. */
function joinLocation(parts) {
  const out = [];
  for (const part of parts) {
    const value = cleanString(part);
    if (value === null) continue;
    if (out.some((existing) => existing.toLowerCase() === value.toLowerCase())) continue;
    out.push(value);
  }
  return out.length === 0 ? null : out.join(', ');
}

export async function fetchJobs(http, token) {
  const host = hostFor(token);
  if (host === null) return null;

  const response = await http.get(listUrl(host), { accept: 'application/json' });
  const body = readJson(response);
  if (body === null || !Array.isArray(body.result)) return null;

  // See the header note: an unknown tenant is redirected off its own host.
  let finalHost;
  try {
    finalHost = new URL(response.url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (finalHost !== host) return null;

  const jobs = [];

  for (const job of body.result) {
    if (job === null || typeof job !== 'object') continue;

    const title = cleanString(job.jobOpeningName);
    const id = cleanString(String(job.id ?? ''));
    if (title === null || id === null || !/^\d+$/.test(id)) continue;

    const country = countryName(job.atsLocation?.country);
    const location = joinLocation([
      job.location?.city ?? job.atsLocation?.city,
      job.location?.state ?? job.atsLocation?.state ?? job.atsLocation?.province,
      country,
    ]);

    const mapped = WORKPLACE_BY_LOCATION_TYPE[String(job.locationType ?? '').trim()];

    jobs.push({
      title,
      url: `https://${host}/careers/${id}`,
      // The list payload has no date and nothing here guesses one.
      postedDate: null,
      text: joinText(title, cleanString(job.departmentLabel), location),
      location,
      countryHint: country,
      remoteHint:
        mapped ?? (job.isRemote === true ? 'remote' : normalizeWorkplace(location)),
    });
  }

  return { jobs, skipped: 0, companyName: null };
}
