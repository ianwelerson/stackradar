/**
 * Personio — https://{token}.jobs.personio.de/xml
 *
 * Verified live against the `ottonova` (8), `clark` (4), `everphone` (5),
 * `smava` (2) and `personio` (1) tenants, and the per-posting URL format was
 * confirmed by loading https://ottonova.jobs.personio.de/job/2573573 and
 * getting that posting's title back.
 *
 * The feed is XML and the project takes no new dependencies, so this parses the
 * handful of fields it needs with static regexes. That is fine for a flat,
 * machine-generated feed and nothing here builds a pattern *from* the response.
 *
 * Tenancy check: an unknown subdomain 307s to personio.com rather than 404ing
 * (verified), so a response only counts when the final URL is still on
 * .jobs.personio.de *and* the body is a workzag-jobs document.
 */
import { cleanString, isoDay, joinText, normalizeWorkplace, stripHtml } from './util.mjs';

export const platform = 'personio';

export const boardUrl = (token) => `https://${encodeURIComponent(token)}.jobs.personio.de/`;

const feedUrl = (token) => `https://${encodeURIComponent(token)}.jobs.personio.de/xml`;

const POSITION = /<position\b[^>]*>([\s\S]*?)<\/position>/gi;
const DESCRIPTIONS = /<jobDescriptions\b[^>]*>[\s\S]*?<\/jobDescriptions>/gi;

/** First value of a top-level tag inside one <position> block. */
function tagValue(block, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (match === null) return null;
  return cleanString(stripHtml(match[1]));
}

export async function fetchJobs(http, token) {
  const response = await http.get(feedUrl(token), { accept: 'application/xml, text/xml' });
  if (!response.ok || typeof response.body !== 'string') return null;

  let host;
  try {
    host = new URL(response.url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.endsWith('.jobs.personio.de')) return null;
  if (!response.body.includes('<workzag-jobs')) return null;

  const jobs = [];

  for (const match of response.body.matchAll(POSITION)) {
    const block = match[1];

    // <name> is used both for the posting title and for each description
    // section heading, so the description blocks come out first.
    const descriptions = block.match(DESCRIPTIONS)?.join(' ') ?? '';
    const head = block.replace(DESCRIPTIONS, ' ');

    const title = tagValue(head, 'name');
    const id = tagValue(head, 'id');
    if (title === null || id === null || !/^\d+$/.test(id)) continue;

    jobs.push({
      title,
      url: `https://${encodeURIComponent(token)}.jobs.personio.de/job/${id}`,
      postedDate: isoDay(tagValue(head, 'createdAt')),
      location: cleanString(tagValue(head, 'office')),
      countryHint: null,
      remoteHint: normalizeWorkplace(tagValue(head, 'office')),
      text: joinText(
        stripHtml(descriptions),
        tagValue(head, 'department'),
        tagValue(head, 'recruitingCategory'),
        tagValue(head, 'office'),
      ),
    });
  }

  return { jobs, skipped: 0, companyName: null };
}
