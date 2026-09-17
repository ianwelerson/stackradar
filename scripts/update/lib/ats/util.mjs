/**
 * Shared helpers for the ATS adapters.
 *
 * Everything in here takes remote, untrusted input and returns either a clean
 * value or null. Nothing throws: a malformed date or a mangled URL on one
 * posting must degrade that one field, not abort a company's whole scan.
 */

/** Cap on the description text handed to keyword extraction. Beyond this it is
 *  benefits boilerplate, and the cost is paid once per posting per run. */
const MAX_TEXT = 20000;

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * ISO calendar day, or null when the input is not a date we can trust.
 * Accepts ISO strings, "YYYY-MM-DD HH:MM:SS UTC" (Recruitee) and epoch
 * milliseconds (Lever).
 */
export function isoDay(value) {
  if (value === null || value === undefined) return null;

  let date;
  if (typeof value === 'number') {
    // Lever sends epoch milliseconds. Seconds would land in 1970, which is a
    // better signal of a unit mix-up than a plausible-looking wrong date.
    date = new Date(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    date = new Date(trimmed.replace(/ UTC$/, 'Z').replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T'));
  } else {
    return null;
  }

  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;
  return date.toISOString().slice(0, 10);
}

/** An http(s) URL string, or null. `base` resolves relative hrefs. */
export function absoluteUrl(value, base) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]{1,6});/gi, (match, hex) => codePoint(parseInt(hex, 16), match))
    .replace(/&#(\d{1,7});/g, (match, dec) => codePoint(Number(dec), match))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function codePoint(value, fallback) {
  if (!Number.isInteger(value) || value < 1 || value > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

/**
 * Markup to plain text for keyword matching only — this output is never shown
 * to a user, so it only has to preserve token boundaries.
 *
 * Entities are decoded twice on purpose: Greenhouse returns HTML that has been
 * entity-escaped a second time ("&lt;div class=&quot;…"), so one pass yields
 * markup and the second yields the text inside it.
 */
export function stripHtml(input) {
  if (typeof input !== 'string' || input === '') return '';

  let text = input.slice(0, MAX_TEXT * 4);
  if (/&(?:amp|lt|gt|quot|#x?\d);/i.test(text.slice(0, 400))) text = decodeEntities(text);

  text = text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');

  return decodeEntities(text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

/** Greenhouse has served both base64 and escaped HTML for `content`. */
export function decodeMaybeBase64(value) {
  if (typeof value !== 'string' || value.length < 32) return value ?? '';
  if (value.includes('<') || value.includes('&')) return value;
  if (!/^[A-Za-z0-9+/\s]+={0,2}$/.test(value)) return value;
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return value;
  }
}

/** Join whatever description-ish fields an ATS gave us into one haystack. */
export function joinText(...parts) {
  return parts
    .filter((part) => typeof part === 'string' && part !== '')
    .join('\n')
    .slice(0, MAX_TEXT);
}

/** A non-empty trimmed string, or null. */
export function cleanString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Parse a successful JSON response. Returns null for anything that is not a
 * confirmed, well-formed 2xx body — the caller turns that straight into the
 * "we learned nothing" result.
 */
export function readJson(response) {
  if (response === null || response === undefined) return null;
  if (!response.ok) return null;
  return response.json();
}

/**
 * ISO 3166-1 alpha-2 to an English country name, via Intl — no lookup table to
 * maintain and no dependency. Returns null for anything that is not a plausible
 * code, including the passthrough Intl performs on unknown input.
 */
export function countryFromCode(code) {
  const raw = cleanString(code);
  if (raw === null || !/^[A-Za-z]{2}$/.test(raw)) return null;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(raw.toUpperCase());
    if (typeof name !== 'string') return null;
    // Intl either echoes the input back or answers "Unknown Region" for codes it
    // does not recognise (ZZ, XX). Neither is a country.
    if (name.toUpperCase() === raw.toUpperCase()) return null;
    if (/^unknown region$/i.test(name)) return null;
    return name;
  } catch {
    return null;
  }
}

/** Normalise the many spellings of a work model into our three values. */
export function normalizeWorkplace(value) {
  const raw = cleanString(value);
  if (raw === null) return null;
  const v = raw.toLowerCase();
  if (v.includes('remote') || v.includes('telecommut')) return 'remote';
  if (v.includes('hybrid')) return 'hybrid';
  if (v.includes('onsite') || v.includes('on-site') || v.includes('in office') || v.includes('in-office')) {
    return 'onsite';
  }
  return null;
}
