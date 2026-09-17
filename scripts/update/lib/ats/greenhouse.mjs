/**
 * Greenhouse — https://boards-api.greenhouse.io/v1/boards/{token}/jobs
 *
 * Verified live against the `gitlab`, `figma`, `discord`, `robinhood` and
 * `asana` boards. An unknown token returns 404, so slug probing is safe.
 *
 * `?content=true` is worth the extra bytes: without it there is no text at all
 * to extract keywords from, and Greenhouse has no separate per-posting feed
 * that would not cost one request per role.
 */
import { absoluteUrl, cleanString, decodeMaybeBase64, isoDay, joinText, normalizeWorkplace, readJson, stripHtml } from './util.mjs';

export const platform = 'greenhouse';

export const boardUrl = (token) => `https://job-boards.greenhouse.io/${encodeURIComponent(token)}`;

const apiUrl = (token, withContent) =>
  `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs${
    withContent ? '?content=true' : ''
  }`;

export async function fetchJobs(http, token, { withContent = true } = {}) {
  const body = readJson(await http.get(apiUrl(token, withContent)));
  if (body === null || !Array.isArray(body.jobs)) return null;

  const jobs = [];

  for (const job of body.jobs) {
    if (job === null || typeof job !== 'object') continue;

    const title = cleanString(job.title);
    if (title === null) continue;

    jobs.push({
      title,
      url: absoluteUrl(job.absolute_url),
      // first_published is when the role went live; updated_at moves whenever
      // anyone edits the posting, so it overstates freshness.
      postedDate: isoDay(job.first_published) ?? isoDay(job.updated_at),
      text: joinText(stripHtml(decodeMaybeBase64(job.content)), job.location?.name),
      location: cleanString(job.location?.name),
      // The board API exposes no structured country, only a free-text location
      // name, which is not safe to parse into one.
      countryHint: null,
      remoteHint: normalizeWorkplace(job.location?.name),
    });
  }

  // Greenhouse echoes the board owner, which is the only cheap way to catch a
  // slug probe that landed on somebody else's board.
  const companyName = cleanString(body.jobs.find((job) => job?.company_name)?.company_name);

  return { jobs, skipped: 0, companyName };
}
