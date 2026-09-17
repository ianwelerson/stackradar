/**
 * Ashby — https://api.ashbyhq.com/posting-api/job-board/{token}
 *
 * Verified live against the `supabase` and `workos` boards.
 * An unknown token returns 404, which makes Ashby safe to probe by slug.
 */
import { absoluteUrl, cleanString, isoDay, joinText, normalizeWorkplace, readJson } from './util.mjs';

export const platform = 'ashby';

export const boardUrl = (token) => `https://jobs.ashbyhq.com/${encodeURIComponent(token)}`;

const apiUrl = (token) =>
  `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`;

export async function fetchJobs(http, token) {
  const body = readJson(await http.get(apiUrl(token)));
  if (body === null || !Array.isArray(body.jobs)) return null;

  const jobs = [];
  let skipped = 0;

  for (const job of body.jobs) {
    if (job === null || typeof job !== 'object') continue;

    // Ashby uses isListed for roles that exist in the ATS but are not public
    // (confidential searches, evergreen pipelines). Counting them would inflate
    // the opening count with roles nobody can apply to.
    if (job.isListed === false) {
      skipped += 1;
      continue;
    }

    const title = cleanString(job.title);
    if (title === null) continue;

    jobs.push({
      title,
      url: absoluteUrl(job.jobUrl) ?? absoluteUrl(job.applyUrl),
      postedDate: isoDay(job.publishedAt),
      text: joinText(job.descriptionPlain, job.department, job.team, job.location),
      location: cleanString(job.location),
      countryHint: cleanString(job.address?.postalAddress?.addressCountry),
      remoteHint: normalizeWorkplace(job.workplaceType) ?? (job.isRemote === true ? 'remote' : null),
    });
  }

  return { jobs, skipped, companyName: null };
}
