/**
 * Host normalisation shared by the discovery sources.
 *
 * Sources that mine a company's domain out of free text — an RSS description, a
 * Hacker News comment — routinely find it on a subdomain rather than the root:
 * a posting links `careers.toasttab.com`, `blog.gohighlevel.com`,
 * `trust.huntress.com` or `learn.datadoghq.com` because that is the page the
 * author was pointing at, not because that is where the company lives.
 *
 * Storing the subdomain does real damage downstream. `website` is what the
 * refresh scan probes for `/careers` and `/jobs`, and `domainLabel` in the ATS
 * detector takes the *leading* hostname label as the slug to guess a board
 * token from. Left alone, those four become probes for boards literally named
 * "careers", "blog", "trust" and "learn" — wasted requests against every
 * probeable platform, and a small but real chance of matching some unrelated
 * company's board under a generic name.
 */

/**
 * Leading labels that are a section of a site rather than the site. Kept
 * deliberately narrow: ambiguous ones like `app`, `go`, `get`, `try`, `portal`
 * and `developer` are left alone, because for some companies that subdomain
 * genuinely is the primary site and stripping it would break a good record to
 * tidy a cosmetic one.
 */
const SECTION_LABELS = new Set([
  'www', 'blog', 'careers', 'career', 'jobs', 'job', 'learn', 'trust',
  'docs', 'documentation', 'help', 'support', 'news', 'press', 'media',
  'status', 'community', 'academy', 'resources', 'events',
  'hire', 'hiring', 'apply', 'join', 'work',
]);

/**
 * The company's root host, with one leading section label removed.
 *
 * Only one label is stripped, and only when at least two remain — so
 * `careers.example.com` becomes `example.com` while `careers.com` and a bare
 * `example.com` are both returned untouched. A host we are unsure about comes
 * back exactly as it went in; this never invents a domain.
 *
 * @param {string} host a hostname, with or without a port
 * @returns {string} the normalised hostname, lowercased
 */
export function rootHost(host) {
  if (typeof host !== 'string') return '';
  const lower = host.trim().toLowerCase();
  if (lower === '') return '';

  const labels = lower.split('.');
  if (labels.length < 3) return lower;
  if (!SECTION_LABELS.has(labels[0])) return lower;

  return labels.slice(1).join('.');
}

/**
 * `https://<root host>` for a URL, or null when the input is not an http(s)
 * URL. Origin only: a path mined out of prose is the one page the author linked,
 * never the company's home, and carrying it forward would corrupt every
 * `/careers` probe built from this field.
 *
 * @param {string|URL} value
 * @returns {string|null}
 */
export function rootOrigin(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(String(value));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = rootHost(url.hostname);
  if (host === '') return null;
  return `https://${host}`;
}
