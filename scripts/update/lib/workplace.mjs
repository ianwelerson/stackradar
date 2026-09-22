/**
 * Where, and how, a role can actually be done.
 *
 * A posting's `location` is free text written for humans: "Remote - US",
 * "NY, SF or Remote (US)", "Canada - Remote (ON, AB, BC, or NS Only)",
 * "Home based - Worldwide", "Tallinn". The directory used to read only the
 * company's overall work model, so a search for remote roles from Estonia
 * returned US-only remote jobs by the hundred — of 1,081 postings mentioning
 * remote, just 70 were open worldwide.
 *
 * This turns each location into one or more *slots*, each a mode plus the
 * places it applies to:
 *
 *   "Remote - US"            → [{ mode: 'remote',  where: ['United States'] }]
 *   "Remote, Global"         → [{ mode: 'remote',  where: ['worldwide'] }]
 *   "NY, SF or Remote (US)"  → [{ mode: 'unknown', where: ['United States'] },
 *                               { mode: 'remote',  where: ['United States'] }]
 *   "Europe"                 → [{ mode: 'remote',  where: ['europe'] }]
 *   "Tallinn"                → [{ mode: 'unknown', where: ['Estonia'] }]
 *   "Remote"                 → [{ mode: 'remote',  where: [] }]
 *
 * Two rules keep this honest:
 *
 * - **A mode is only asserted when the posting states it.** "Tallinn" names a
 *   place, not a work model; its mode is `unknown`, and the filter resolves it
 *   from the company's own policy at read time. The one inference allowed is
 *   that a place which is *only* a region or "worldwide" means remote — nobody
 *   works in an office called "Europe".
 * - **`where: []` means not stated**, never "anywhere". Plain "Remote" says
 *   nothing about which countries may apply, and treating it as worldwide is
 *   exactly the bug this exists to fix.
 *
 * `where` holds canonical country names (see countries.mjs) and region keys
 * from REGION_KEYS; src/lib/regions.ts expands the keys at filter time.
 */

import { normalizeCountry, fromCode } from './countries.mjs';

export const REGION_KEYS = [
  'worldwide',
  'europe',
  'emea',
  'americas',
  'north-america',
  'latin-america',
  'south-america',
  'apac',
];

const MAX_LOCATION = 400;

/** Words that make a place remote. */
const REMOTE_WORD =
  /\b(remote|remotely|anywhere|worldwide|home[\s-]?based|distributed|work from home|wfh|telecommute)\b/i;
const HYBRID_WORD = /\bhybrid\b/i;
const ONSITE_WORD = /\b(on[\s-]?site|in[\s-]office|office[\s-]based|in[\s-]person)\b/i;
const WORLDWIDE_WORD = /\b(global|globally|worldwide|anywhere|international|any location)\b/i;

/** Region phrases. Order matters only where one contains another. */
const REGION_PHRASES = [
  [/\bnorth america\b/i, 'north-america'],
  [/\b(latin america|latam)\b/i, 'latin-america'],
  [/\bsouth america\b/i, 'south-america'],
  [/\b(the americas|americas|amer)\b/i, 'americas'],
  [/\bemea\b/i, 'emea'],
  [/\b(europe|european union|eu)\b/i, 'europe'],
  // A timezone band is how many European companies write "Europe" — "Remote
  // (CET ±2h)". It is a region in practice, if not in name.
  [/\b(cet|cest|central european time)\b/i, 'europe'],
  [/\b(apac|asia[\s-]pacific|asia)\b/i, 'apac'],
];

/** Named groups that are sets of countries rather than a region key. */
const COUNTRY_GROUPS = [
  [/\bdach\b/i, ['DE', 'AT', 'CH']],
  [/\bnordics?\b/i, ['DK', 'FI', 'IS', 'NO', 'SE']],
  [/\bbenelux\b/i, ['BE', 'NL', 'LU']],
  [/\bbaltics?\b/i, ['EE', 'LV', 'LT']],
  [/\buk\s*(?:&|and)\s*i(?:reland)?\b|\buki\b/i, ['GB', 'IE']],
];

/**
 * US states and Canadian provinces, written out. A bare two-letter code is
 * never resolved — "CA" is California far more often than Canada — but the
 * full name is unambiguous with one exception, Georgia, handled below.
 */
const SUBDIVISIONS = {
  US: [
    'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
    'delaware', 'florida', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas',
    'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
    'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire',
    'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
    'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina',
    'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
    'west virginia', 'wisconsin', 'wyoming', 'district of columbia', 'washington dc',
  ],
  CA: [
    'ontario', 'quebec', 'british columbia', 'alberta', 'manitoba', 'saskatchewan',
    'nova scotia', 'new brunswick', 'newfoundland', 'prince edward island',
  ],
};

/**
 * Cities that appear in this dataset's postings, to the country they are in.
 * Measured before writing it: the 30 most common city-only locations covered
 * 75% of all such postings, and San Francisco alone 299 of them.
 *
 * Names that exist in more than one country are left out rather than guessed:
 * Cambridge (UK/US), Birmingham (UK/US), Richmond, Hamilton, Waterloo. A city
 * that is not here leaves its slot's `where` empty, which is the honest answer.
 */
const CITIES = {
  US: [
    'san francisco', 'san francisco bay area', 'bay area', 'sf', 'new york', 'new york city',
    'nyc', 'ny', 'seattle', 'chicago', 'denver', 'boston', 'austin', 'los angeles',
    'santa monica', 'palo alto', 'mountain view', 'sunnyvale', 'menlo park',
    'redwood city', 'san jose', 'san mateo', 'oakland', 'santa clara', 'atlanta', 'miami',
    'portland', 'san diego', 'salt lake city', 'lehi', 'philadelphia', 'pittsburgh',
    'dallas', 'houston', 'idaho falls', 'boulder', 'raleigh', 'nashville', 'detroit',
    'minneapolis', 'phoenix', 'baltimore', 'brooklyn', 'south san francisco', 'irvine',
  ],
  GB: ['london', 'manchester', 'edinburgh', 'bristol', 'leeds', 'glasgow'],
  IE: ['dublin', 'cork'],
  DE: ['berlin', 'munich', 'hamburg', 'cologne', 'frankfurt', 'stuttgart', 'tübingen', 'tubingen'],
  FR: ['paris', 'lyon'],
  NL: ['amsterdam', 'rotterdam', 'utrecht', 'the hague', 'eindhoven'],
  EE: ['tallinn', 'tartu'],
  LV: ['riga'],
  LT: ['vilnius', 'kaunas'],
  FI: ['helsinki', 'espoo'],
  SE: ['stockholm', 'gothenburg', 'malmö', 'malmo'],
  DK: ['copenhagen'],
  NO: ['oslo'],
  CH: ['zurich', 'zürich', 'geneva', 'lausanne'],
  AT: ['vienna'],
  ES: ['barcelona', 'madrid', 'valencia'],
  PT: ['lisbon', 'porto'],
  IT: ['milan', 'rome'],
  PL: ['warsaw', 'krakow', 'kraków', 'wroclaw', 'wrocław', 'gdansk'],
  CZ: ['prague', 'brno'],
  RO: ['bucharest', 'cluj-napoca', 'cluj'],
  RS: ['belgrade'],
  UA: ['kyiv', 'kiev', 'lviv'],
  GR: ['athens'],
  BE: ['brussels', 'antwerp'],
  IL: ['tel aviv', 'jerusalem'],
  CA: ['toronto', 'vancouver', 'montreal', 'ottawa', 'kitchener', 'calgary'],
  IN: [
    'bangalore', 'bengaluru', 'mumbai', 'pune', 'hyderabad', 'chennai', 'delhi',
    'new delhi', 'gurugram', 'gurgaon', 'noida',
  ],
  SG: ['singapore'],
  HK: ['hong kong'],
  JP: ['tokyo'],
  KR: ['seoul'],
  AU: ['sydney', 'melbourne', 'brisbane'],
  NZ: ['auckland'],
  BR: ['são paulo', 'sao paulo', 'rio de janeiro'],
  MX: ['mexico city', 'guadalajara'],
  AR: ['buenos aires'],
  CO: ['bogotá', 'bogota', 'medellín', 'medellin'],
  AE: ['dubai', 'abu dhabi'],
};

/** Lookup tables built once: lowercase phrase → canonical country name. */
function buildLookup(table) {
  const out = new Map();
  for (const [code, names] of Object.entries(table)) {
    const country = fromCode(code);
    if (country === null) continue;
    for (const name of names) out.set(name, country);
  }
  return out;
}
const SUBDIVISION_LOOKUP = buildLookup(SUBDIVISIONS);
const CITY_LOOKUP = buildLookup(CITIES);
const GROUP_LOOKUP = COUNTRY_GROUPS.map(([pattern, codes]) => [
  pattern,
  codes.map((code) => fromCode(code)).filter((name) => name !== null),
]);

const UNITED_STATES = fromCode('US');

/**
 * Separators between the places in one location. `+N more` is the tail the
 * scanner adds when it collapses many cities into one line; it names nothing.
 */
function splitPlaces(location) {
  const text = location
    .slice(0, MAX_LOCATION)
    .replace(/\s*\+\d+\s+more\s*$/i, '')
    // "+/-" is a tolerance, not two places: "Remote EU +/- 2hrs".
    .replace(/\+\s*\/\s*-/g, '±');

  // Split only outside parentheses. "Canada - Remote (ON, AB, BC, or NS Only)"
  // is one place whose qualifier happens to contain the word "or"; splitting
  // there produced a phantom place called "NS Only)".
  const places = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);

    if (depth === 0) {
      if (char === '·' || char === '|' || char === ';' || char === '/') {
        places.push(current);
        current = '';
        continue;
      }
      const rest = text.slice(i);
      const or = /^\s+or\s+/i.exec(rest);
      if (or !== null && /\s/.test(char)) {
        places.push(current);
        current = '';
        i += or[0].length - 1;
        continue;
      }
    }
    current += char;
  }
  places.push(current);

  return places.map((place) => place.trim()).filter((place) => place !== '');
}

/** Words of a place, longest phrase first, for dictionary lookups. */
function phrases(place) {
  const words = place
    .toLowerCase()
    .split(/[^a-zà-ÿ.&']+/i)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w !== '');
  const out = [];
  for (let size = Math.min(4, words.length); size >= 1; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      out.push({ text: words.slice(start, start + size).join(' '), start, size });
    }
  }
  return { words, out };
}

/**
 * Countries named in one place, by explicit name first, then state or province,
 * then city. A word used by a longer match is not reused by a shorter one, so
 * "New Mexico" is a US state and not Mexico, and "New Jersey" is not Jersey.
 */
function countriesIn(place) {
  const { words, out } = phrases(place);
  const used = new Array(words.length).fill(false);
  const found = new Set();
  let placed = false; // a city or subdivision was named — this is a real place

  const claim = ({ start, size }) => {
    for (let i = start; i < start + size; i += 1) if (used[i]) return false;
    for (let i = start; i < start + size; i += 1) used[i] = true;
    return true;
  };

  // `out` is ordered longest phrase first, and each phrase is tried against all
  // three dictionaries before any shorter one is. Running the dictionaries one
  // after another instead let the one-word country "mexico" claim its word
  // before the two-word state "new mexico" was ever looked at.
  for (const candidate of out) {
    const country = normalizeCountry(candidate.text);
    if (country !== null) {
      if (claim(candidate)) found.add(country);
      continue;
    }
    const byRegion = SUBDIVISION_LOOKUP.get(candidate.text) ?? CITY_LOOKUP.get(candidate.text);
    if (byRegion !== undefined && claim(candidate)) {
      found.add(byRegion);
      placed = true;
    }
  }

  // "Atlanta, Georgia" is the US state, not the country in the Caucasus.
  if (found.has('Georgia') && UNITED_STATES !== null && found.has(UNITED_STATES)) {
    found.delete('Georgia');
  }

  return { countries: [...found], placed };
}

/** One place → one slot. */
function slotFor(place) {
  const regions = new Set();
  let remainder = place;
  for (const [pattern, key] of REGION_PHRASES) {
    if (pattern.test(remainder)) {
      regions.add(key);
      // Removed once recognised, so its words are not looked up again as
      // countries — "america" is an alias for the United States, and without
      // this "Latin America" came out as a US role.
      remainder = remainder.replace(new RegExp(pattern.source, 'gi'), ' ');
    }
  }

  const { countries, placed } = countriesIn(remainder);
  for (const [pattern, names] of GROUP_LOOKUP) {
    if (pattern.test(place)) for (const name of names) countries.push(name);
  }

  const where = [...new Set([...countries, ...regions])];
  const remoteWord = REMOTE_WORD.test(place);
  const worldwide = WORLDWIDE_WORD.test(place) && countries.length === 0 && regions.size === 0;

  if (worldwide) return { mode: 'remote', where: ['worldwide'] };
  if (remoteWord) return { mode: 'remote', where };
  if (HYBRID_WORD.test(place)) return { mode: 'hybrid', where };
  if (ONSITE_WORD.test(place)) return { mode: 'onsite', where };

  // Only a region, no city and no country: nobody works in an office called
  // "Europe", so this is remote within it.
  if (regions.size > 0 && countries.length === 0 && !placed) {
    return { mode: 'remote', where: [...regions] };
  }

  // A named place with no stated mode. Where is known; how is left to the
  // company's own policy, resolved at read time rather than guessed here.
  return { mode: 'unknown', where };
}

/**
 * The slots for one posting. Empty when the posting has no location at all —
 * the filter then falls back to the company's own recorded policy.
 *
 * @param {string|null|undefined} location
 * @param {'remote'|'hybrid'|'onsite'|null} [remoteHint] a job board's own
 *   structured workplace field, when it has one; it outranks the text.
 * @returns {{ mode: 'remote'|'hybrid'|'onsite'|'unknown', where: string[] }[]}
 */
export function workplaceOf(location, remoteHint = null) {
  if (typeof location !== 'string' || location.trim() === '') {
    return remoteHint === null || remoteHint === undefined ? [] : [{ mode: remoteHint, where: [] }];
  }

  const slots = splitPlaces(location).map(slotFor);

  // Merge slots that ended up identical — "Remote (US) · Remote (USA)".
  const seen = new Map();
  for (const slot of slots) {
    const key = `${slot.mode}|${[...slot.where].sort().join(',')}`;
    if (!seen.has(key)) seen.set(key, slot);
  }
  let merged = [...seen.values()];

  // A fragment that says nothing — no mode, no place — only means something
  // when it is all the posting has. Next to informative slots it is noise.
  if (merged.length > 1) {
    const informative = merged.filter((s) => s.mode !== 'unknown' || s.where.length > 0);
    if (informative.length > 0) merged = informative;
  }

  // A board that says "remote" in a structured field is more reliable than
  // prose; if the text left every slot's mode open, the field decides.
  if (remoteHint !== null && remoteHint !== undefined && merged.every((s) => s.mode === 'unknown')) {
    return merged.map((slot) => ({ ...slot, mode: remoteHint }));
  }

  return merged;
}

/**
 * Slots for a role posted in several places at once.
 *
 * The scanner collapses a role listed once per city into one opening, and the
 * stored `location` string is then cut to three places plus "+N more" for
 * display. Parsing that string would lose every place past the third, so this
 * takes each posting's own location and board hint before any of that happens.
 *
 * @param {{ location: string|null, hint: 'remote'|'hybrid'|'onsite'|null }[]} postings
 */
export function workplaceOfMany(postings) {
  const seen = new Map();
  for (const { location, hint } of postings) {
    for (const slot of workplaceOf(location, hint)) {
      const key = `${slot.mode}|${[...slot.where].sort().join(',')}`;
      if (!seen.has(key)) seen.set(key, slot);
    }
  }
  const slots = [...seen.values()];
  if (slots.length > 1) {
    const informative = slots.filter((s) => s.mode !== 'unknown' || s.where.length > 0);
    if (informative.length > 0) return informative;
  }
  return slots;
}
