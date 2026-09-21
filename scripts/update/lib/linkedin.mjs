/**
 * Finding a company's LinkedIn page — without ever touching LinkedIn.
 *
 * LinkedIn's robots.txt opens by prohibiting automated access outright, and
 * this project has declined to scrape it since the first round. That position
 * has not changed and this module does not bend it: **no request here ever goes
 * to linkedin.com.** The only thing fetched is the company's own homepage, and
 * the only thing read out of it is a link the company itself chose to publish —
 * normally the social row in its own footer.
 *
 * So the field is a link *out* for a human reader, never a data source. Nothing
 * downstream reads headcount, location or anything else from LinkedIn.
 *
 * Guessing the URL instead was considered and rejected: the slug is not
 * derivable from the company name often enough to be safe. Scoro's page is
 * /company/scoro-software and Bolt's is /company/bolt-eu, so a guessed
 * /company/scoro would have been wrong — and a wrong link here sends a reader
 * to some other organisation's page with our name on it.
 */

/**
 * Company-page links only. A personal profile (/in/…), a job posting
 * (/jobs/…) or a share link is not what this field means, and the capture is a
 * constrained character class so nothing from the page can widen it.
 */
const COMPANY_URL = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([A-Za-z0-9_%.-]{1,80})/gi;

/** Pages routinely inline a megabyte of app state; the footer is not in it. */
const MAX_SCAN_BYTES = 1_500_000;

/**
 * Slugs that belong to LinkedIn itself or to a widget, not to the company whose
 * page we are reading.
 */
const NOT_A_COMPANY = new Set(['linkedin', 'showcase', 'setup', 'admin']);

/**
 * The LinkedIn company URL a page links, or null.
 *
 * When a page links several — a partner logo wall, an employee's page — the
 * most-referenced one wins, on the same reasoning the ATS detector uses: a site
 * that names one company page six times and another once is telling you which
 * one is its own.
 *
 * @param {string} html
 * @returns {string|null}
 */
export function linkedinFromMarkup(html) {
  if (typeof html !== 'string' || html === '') return null;

  const counts = new Map();
  for (const match of html.slice(0, MAX_SCAN_BYTES).matchAll(COMPANY_URL)) {
    const slug = match[1].replace(/[/.]+$/, '').toLowerCase();
    if (slug === '' || NOT_A_COMPANY.has(slug)) continue;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const [best] = [...counts].sort((a, b) => b[1] - a[1]);
  // Canonical form, so two spellings of the same page do not read as two pages.
  return `https://www.linkedin.com/company/${best[0]}`;
}

/**
 * Read a company's own site and return the LinkedIn page it links.
 *
 * Returns null for anything not positively read — the same contract the ATS
 * adapters keep — so a failed fetch leaves the record untouched rather than
 * being mistaken for "this company has no LinkedIn".
 *
 * @param {{ get: Function }} http
 * @param {{ website?: string|null, careersUrl?: string|null }} company
 * @returns {Promise<{ url: string, source: string }|null>}
 */
export async function findLinkedin(http, company) {
  const site = typeof company?.website === 'string' && company.website !== ''
    ? company.website.replace(/\/$/, '')
    : null;
  if (site === null) return null;

  // The homepage first: the footer social row lives on every page, and this is
  // the one URL every record has. /about is a cheap second try for the sites
  // that keep their social links there instead.
  const pages = [[site, 'homepage'], [`${site}/about`, 'about-page']];

  for (const [url, source] of pages) {
    const response = await http.get(url, { accept: 'text/html,application/xhtml+xml' });
    if (!response.ok) continue;
    const found = linkedinFromMarkup(response.body);
    if (found !== null) return { url: found, source };
  }

  return null;
}
