/**
 * Workable — https://apply.workable.com/api/v1/widget/accounts/{token}?details=true
 *
 * Verified live against the `modash` account (18 jobs) and `lingvist`.
 *
 * The account check is the subtle part. An unknown token 404s with a bare
 * "Not Found" body, but a *real* account with nothing open answers 200 with
 * `{"name":"Veriff","description":null,"jobs":[]}` — verified against both. So
 * a 200 carrying a `name` is a genuine confirmed-empty board, while a body
 * without one is treated as unreadable rather than as "nobody is hiring".
 */
import { absoluteUrl, cleanString, countryFromCode, isoDay, joinText, readJson, stripHtml } from './util.mjs';

export const platform = 'workable';

export const boardUrl = (token) => `https://apply.workable.com/${encodeURIComponent(token)}`;

const apiUrl = (token) =>
  `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`;

export async function fetchJobs(http, token) {
  const body = readJson(await http.get(apiUrl(token)));
  if (body === null || typeof body !== 'object') return null;
  if (!Array.isArray(body.jobs)) return null;

  const companyName = cleanString(body.name);
  if (companyName === null) return null;

  const jobs = [];

  for (const job of body.jobs) {
    if (job === null || typeof job !== 'object') continue;

    const title = cleanString(job.title);
    if (title === null) continue;

    jobs.push({
      title,
      url: absoluteUrl(job.url) ?? absoluteUrl(job.shortlink) ?? absoluteUrl(job.application_url),
      postedDate: isoDay(job.published_on) ?? isoDay(job.created_at),
      location: cleanString(job.location?.location_str)
        ?? cleanString([job.city, job.country].filter(Boolean).join(', ')),
      countryHint: cleanString(job.country) ?? countryFromCode(job.locations?.[0]?.countryCode),
      remoteHint: job.telecommuting === true ? 'remote' : null,
      text: joinText(
        stripHtml(job.description),
        stripHtml(job.requirements),
        job.department,
        job.function,
        job.city,
        job.country,
      ),
    });
  }

  return { jobs, skipped: 0, companyName };
}
