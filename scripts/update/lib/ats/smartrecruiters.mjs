/**
 * SmartRecruiters — https://api.smartrecruiters.com/v1/companies/{token}/postings
 *
 * Verified live against the `smartrecruiters` company itself.
 *
 * Detection caveat, and the reason this platform is never slug-probed: an
 * unknown company answers 200 with {"totalFound":0,"content":[]} rather than
 * 404 (verified with `Visa` and `Bosch`). There is no way to tell that apart
 * from a real company with nothing open, so this adapter is only ever reached
 * from an explicit careers.smartrecruiters.com/{token} link.
 *
 * The list payload has no description, so keywords come from the title and the
 * posting's own department/function labels — nothing is inferred beyond that.
 *
 * Because 200/totalFound:0 is ambiguous here in a way it is not on the 404-ing
 * platforms, an empty board is reported as null ("we learned nothing") rather
 * than [] ("confirmed: nothing open"). [] would let a stale or mistyped token
 * wipe a company's real openings, and this is the one adapter that cannot rule
 * that out. The cost is that a SmartRecruiters company with genuinely nothing
 * open records no history point — a far cheaper mistake.
 */
import { cleanString, countryFromCode, isoDay, joinText, readJson } from './util.mjs';

export const platform = 'smartrecruiters';

export const boardUrl = (token) =>
  `https://careers.smartrecruiters.com/${encodeURIComponent(token)}`;

const PAGE_SIZE = 100;
/** Four pages is 400 roles — far past maxPerCompany, and a hard stop against
 *  walking a 10,000-posting enterprise board. */
const MAX_PAGES = 4;

const apiUrl = (token, offset) =>
  `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings` +
  `?limit=${PAGE_SIZE}&offset=${offset}`;

export async function fetchJobs(http, token) {
  const jobs = [];
  let companyName = null;
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = readJson(await http.get(apiUrl(token, page * PAGE_SIZE)));
    if (body === null || !Array.isArray(body.content)) return null;

    total = Number.isInteger(body.totalFound) ? body.totalFound : jobs.length + body.content.length;

    for (const posting of body.content) {
      if (posting === null || typeof posting !== 'object') continue;

      const title = cleanString(posting.name);
      if (title === null) continue;

      // Use the identifier the posting reports rather than the token we asked
      // with; they differ in case on some boards and the public URL needs the
      // canonical one.
      const identifier = cleanString(posting.company?.identifier) ?? token;
      companyName = companyName ?? cleanString(posting.company?.name);
      const id = cleanString(String(posting.id ?? ''));

      jobs.push({
        title,
        url:
          id === null
            ? null
            : `https://jobs.smartrecruiters.com/${encodeURIComponent(identifier)}/${encodeURIComponent(id)}`,
        postedDate: isoDay(posting.releasedDate),
          location: cleanString(
            [posting.location?.city, posting.location?.country].filter(Boolean).join(', '),
          ),
          countryHint: countryFromCode(posting.location?.country),
          remoteHint: posting.location?.remote === true ? 'remote' : null,
        text: joinText(
          posting.department?.label,
          posting.function?.label,
          posting.location?.fullLocation,
        ),
      });
    }

    if (body.content.length < PAGE_SIZE || jobs.length >= total) break;
  }

  // See the header note: an empty result here is ambiguous, so it is not
  // reported as a confirmed-empty board.
  if (jobs.length === 0) return null;

  return { jobs, skipped: 0, companyName };
}
