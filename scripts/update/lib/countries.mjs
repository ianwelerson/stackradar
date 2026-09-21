/**
 * One spelling per country.
 *
 * `country` is not just a stored string — it is the vocabulary of the
 * directory's location filter, which is built by collecting the distinct values
 * in the dataset. So "US", "USA" and "United States of America" do not merely
 * look untidy: each one becomes its own entry in the filter, splitting one
 * country into four and hiding companies from a reader who picks the wrong one.
 *
 * Five sources write this field and each derives it differently — YC spells
 * countries the way Americans say them, job boards send ISO codes, HN comments
 * say whatever the poster typed. Rather than fix the spelling in five places
 * and miss the sixth, every fact passes through `normalizeCountry` on its way
 * into a record.
 *
 * The canonical form is the English name Intl produces for the ISO region, so
 * "United States", "United Kingdom", "Estonia".
 */

/**
 * Spellings seen in real source data, mapped to the canonical name. Keys are
 * compared after lowercasing and stripping punctuation, so "U.S.A." and "usa"
 * both land on the same entry.
 */
const ALIASES = new Map(Object.entries({
  us: 'United States',
  usa: 'United States',
  unitedstates: 'United States',
  unitedstatesofamerica: 'United States',
  unitedstatesamerica: 'United States',
  america: 'United States',
  uk: 'United Kingdom',
  gb: 'United Kingdom',
  greatbritain: 'United Kingdom',
  unitedkingdom: 'United Kingdom',
  england: 'United Kingdom',
  scotland: 'United Kingdom',
  wales: 'United Kingdom',
  northernireland: 'United Kingdom',
  uae: 'United Arab Emirates',
  unitedarabemirates: 'United Arab Emirates',
  netherlands: 'Netherlands',
  thenetherlands: 'Netherlands',
  holland: 'Netherlands',
  czechia: 'Czechia',
  czechrepublic: 'Czechia',
  southkorea: 'South Korea',
  republicofkorea: 'South Korea',
  korea: 'South Korea',
  russia: 'Russia',
  russianfederation: 'Russia',
  turkey: 'Türkiye',
  turkiye: 'Türkiye',
  vietnam: 'Vietnam',
  viet: 'Vietnam',
  ivorycoast: 'Côte d’Ivoire',
  swiss: 'Switzerland',
  deutschland: 'Germany',
  eesti: 'Estonia',
}));

/**
 * Intl hands back regions that are not countries. "EU" becomes "European
 * Union", and the UN M49 groupings (001 "World", QO "Outlying Oceania") are
 * regions too. None of them belong in a per-country location filter.
 */
const NOT_A_COUNTRY = new Set(['EU', 'UN', 'QO', 'ZZ', 'XA', 'XB', 'EZ', 'UK']);

/** Canonical Intl names, built once, keyed by their own comparison form. */
const CANONICAL = new Map();
/** Bare ISO codes, kept SEPARATE — see the warning on `fromCode` below. */
const BY_CODE = new Map();
try {
  const display = new Intl.DisplayNames(['en'], { type: 'region' });
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      if (NOT_A_COUNTRY.has(code)) continue;
      const name = display.of(code);
      if (typeof name !== 'string' || name === code) continue;
      if (/^unknown region$/i.test(name)) continue;
      CANONICAL.set(compareForm(name), name);
      if (!ALIASES.has(code.toLowerCase())) BY_CODE.set(code.toLowerCase(), name);
    }
  }
} catch {
  /* Intl unavailable — normalization degrades to the alias table alone */
}

/** Lowercase, letters and digits only, so punctuation and spacing stop mattering. */
function compareForm(value) {
  return String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The canonical name for a country, or null when the input does not name one.
 *
 * Null rather than the original string is deliberate: an unrecognised value is
 * far more likely to be a region ("EMEA"), a city, or a parsing accident than a
 * country we simply have not heard of, and passing it through would put it in
 * the location filter as if it were real.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeCountry(value, { allowCode = false } = {}) {
  if (typeof value !== 'string') return null;
  const key = compareForm(value);
  if (key === '') return null;
  const named = ALIASES.get(key) ?? CANONICAL.get(key);
  if (named !== undefined) return named;
  return allowCode ? (BY_CODE.get(key) ?? null) : null;
}

/**
 * Resolve a bare two-letter code. **Never call this on a token lifted out of a
 * free-text location.**
 *
 * Every dangerous case is a US state: "San Francisco, CA" is California, not
 * Canada; "Durham, NC" is North Carolina, not New Caledonia; "McLean, VA" is
 * Virginia, not Vatican City. A first pass at mining stored posting locations
 * produced exactly those three, plus PostHog and Supabase — both companies with
 * no head-office country at all — filed under Canada.
 *
 * Use it only where a source states a country field explicitly, e.g. an ATS
 * sending `addressCountry: "EE"`.
 */
export function fromCode(code) {
  return normalizeCountry(code, { allowCode: true });
}

/** True when the value is already exactly the canonical spelling. */
export function isCanonicalCountry(value) {
  return typeof value === 'string' && normalizeCountry(value) === value;
}
