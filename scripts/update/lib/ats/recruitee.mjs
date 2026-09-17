/**
 * Recruitee — https://{token}.recruitee.com/api/offers/
 *
 * Verified live against the `channable` (14 offers) and `nmbrs` accounts.
 * An unknown subdomain answers 404 with {"error":"Not Found"}.
 *
 * `careers_url` is the per-offer public link and already points at whatever
 * custom domain the company uses (jobs.channable.com, say), so it is preferred
 * over anything reconstructed from the token.
 */
import { absoluteUrl, cleanString, countryFromCode, isoDay, joinText, normalizeWorkplace, readJson, stripHtml } from './util.mjs';

export const platform = 'recruitee';

export const boardUrl = (token) => `https://${encodeURIComponent(token)}.recruitee.com/`;

const apiUrl = (token) => `https://${encodeURIComponent(token)}.recruitee.com/api/offers/`;

export async function fetchJobs(http, token) {
  const body = readJson(await http.get(apiUrl(token)));
  if (body === null || !Array.isArray(body.offers)) return null;

  const jobs = [];
  let skipped = 0;

  for (const offer of body.offers) {
    if (offer === null || typeof offer !== 'object') continue;

    // Drafts and closed roles share the feed with live ones.
    if (typeof offer.status === 'string' && offer.status !== 'published') {
      skipped += 1;
      continue;
    }

    const title = cleanString(offer.title);
    if (title === null) continue;

    jobs.push({
      title,
      url: absoluteUrl(offer.careers_url) ?? absoluteUrl(offer.careers_apply_url),
      postedDate: isoDay(offer.published_at) ?? isoDay(offer.created_at),
      location: cleanString(offer.location),
      countryHint: cleanString(offer.country) ?? countryFromCode(offer.country_code),
      remoteHint: offer.remote === true ? 'remote' : normalizeWorkplace(offer.location),
      text: joinText(
        stripHtml(offer.description),
        stripHtml(offer.requirements),
        offer.department,
        offer.location,
      ),
    });
  }

  const companyName = cleanString(body.offers.find((offer) => offer?.company_name)?.company_name);

  return { jobs, skipped, companyName };
}
