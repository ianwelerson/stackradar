/**
 * Lever — https://api.lever.co/v0/postings/{token}?mode=json
 *
 * Verified live against the `pipedrive` board. The response is a bare array;
 * an unknown token returns 404 with {"ok":false}, so slug probing is safe.
 */
import { absoluteUrl, cleanString, countryFromCode, isoDay, joinText, normalizeWorkplace, readJson } from './util.mjs';

export const platform = 'lever';

export const boardUrl = (token) => `https://jobs.lever.co/${encodeURIComponent(token)}`;

const apiUrl = (token) =>
  `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;

export async function fetchJobs(http, token) {
  const body = readJson(await http.get(apiUrl(token)));
  if (!Array.isArray(body)) return null;

  const jobs = [];

  for (const posting of body) {
    if (posting === null || typeof posting !== 'object') continue;

    // Lever calls the title `text`.
    const title = cleanString(posting.text);
    if (title === null) continue;

    const categories = posting.categories ?? {};

    jobs.push({
      title,
      url: absoluteUrl(posting.hostedUrl) ?? absoluteUrl(posting.applyUrl),
      // createdAt is epoch milliseconds.
      postedDate: isoDay(posting.createdAt),
      location: cleanString(categories.location),
      countryHint: countryFromCode(posting.country),
      remoteHint: normalizeWorkplace(posting.workplaceType),
      text: joinText(
        posting.descriptionPlain,
        posting.additionalPlain,
        categories.department,
        categories.team,
        categories.location,
      ),
    });
  }

  return { jobs, skipped: 0, companyName: null };
}
