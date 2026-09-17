/**
 * URL safety.
 *
 * Company records — website, careersUrl, per-opening links — originate from
 * research and will later be written by an automated scraper. Anything that
 * reaches an `href` is therefore treated as untrusted input: a `javascript:`
 * or `data:` URL rendered into a link is a straightforward XSS vector, and
 * that risk compounds here because the app holds a user's Upstash token in
 * localStorage. Only http(s) is ever allowed through.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  return parsed.toString();
}

/**
 * Path prefix for logos stored in this repo. The update script downloads each
 * logo once and commits it, so `logoUrl` is normally `/logos/<id>.<ext>`.
 */
const LOGO_PREFIX = '/logos/';

/**
 * Source for an `<img>`, which `safeExternalUrl` cannot supply because it
 * rejects every relative path.
 *
 * Accepts a root-relative `/logos/...` path — the normal case, served from
 * this origin, so the page still makes no third-party request and `img-src
 * 'self'` still holds — or an https URL, which the data format permits but
 * the updater does not produce.
 *
 * Everything else is refused, and the refusals that matter are the ones that
 * *look* relative: `//evil.com/x.png` is protocol-relative and would fetch
 * from another origin, and any `..` segment escapes /logos/. Both are checked
 * on the raw string before parsing, because resolving them first would hide
 * exactly the property being tested.
 */
export function safeImageSrc(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '') return null;

  if (value.startsWith(LOGO_PREFIX)) {
    // `//` after the prefix, a backslash, or any `..` segment all mean this is
    // not the simple local file it is pretending to be.
    if (value.includes('..') || value.includes('\\') || value.includes('//')) return null;
    // Must be a plain path: no query, no fragment, no control characters.
    if (!/^\/logos\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) return null;
    return value;
  }

  // Not a logo path, so it has to be a fully-qualified https URL.
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

/** Hostname for display, with a leading `www.` trimmed. */
export function displayHost(raw: string | null | undefined): string | null {
  const safe = safeExternalUrl(raw);
  if (safe === null) return null;
  try {
    return new URL(safe).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
