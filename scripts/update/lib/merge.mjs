/**
 * Merge rules. Every write to the dataset goes through here.
 *
 * The invariants this file exists to hold:
 *
 * 1. A failed or empty fetch NEVER empties `currentOpenings`. A 404, a timeout
 *    or an ATS returning nothing is indistinguishable at the HTTP layer from
 *    "they stopped hiring", and guessing wrong silently destroys real data. A
 *    company's openings are replaced only on a confirmed successful read.
 * 2. `history` is append-only and keyed on `weekOf`. Re-running in the same week
 *    updates that week's entry in place rather than appending a duplicate, so
 *    the script is safe to run repeatedly.
 * 3. `lastVerified` only moves forward, and only on a successful verification.
 * 4. Human-curated fields are not clobbered by weaker automated guesses —
 *    a value that was verified against a primary source outranks one inferred
 *    from a directory listing.
 */

import { normalizeCountry } from './countries.mjs';
import { cleanDescription } from './description.mjs';

import { mondayOf } from './dataset.mjs';

/** Fields the updater may fill when empty but must not overwrite when present
 *  and human-sourced. */
const SOFT_FIELDS = ['description', 'sizeRange', 'sizeMin', 'sizeMax', 'hqLocation', 'country', 'remotePolicy'];

export function emptyCompany(id, name) {
  return {
    id,
    name,
    logoUrl: null,
    description: '',
    website: null,
    careersUrl: null,
    linkedinUrl: null,
    sizeRange: null,
    sizeMin: null,
    sizeMax: null,
    hqLocation: null,
    country: null,
    remotePolicy: null,
    remoteRegions: [],
    keywords: [],
    currentOpenings: [],
    openingsTotal: null,
    history: [],
    lastVerified: null,
    dataNotes: null,
  };
}

/**
 * Apply a successful position scan to a company.
 * `openings` must come from a confirmed read; pass null for a failed scan.
 */
export function applyScan(company, { openings, scannedAt = new Date(), note = null, totalListed = null }) {
  if (openings === null) {
    // Failed scan: touch nothing. lastVerified deliberately stays where it was,
    // so the UI keeps showing the record ageing rather than implying a check.
    return { company, changed: false, reason: 'scan failed — record left untouched' };
  }

  const next = { ...company };
  const before = company.currentOpenings.length;

  next.currentOpenings = openings;
  // Null when the board's own total is unknown; otherwise the count before
  // de-duplication and capping, so a truncated list is visibly truncated.
  next.openingsTotal = Number.isInteger(totalListed) ? totalListed : openings.length;
  next.lastVerified = scannedAt.toISOString();
  if (note !== null) next.dataNotes = note;

  next.history = upsertWeek(company.history, {
    weekOf: mondayOf(scannedAt),
    openCount: openings.length,
    keywordCounts: countKeywords(openings),
  });

  return {
    company: next,
    changed: true,
    reason: `${before} → ${openings.length} openings`,
  };
}

/** Append or update this week's history entry; keeps the log chronological. */
export function upsertWeek(history, entry) {
  const existing = history.findIndex((h) => h.weekOf === entry.weekOf);
  const next = existing >= 0
    ? history.map((h, i) => (i === existing ? entry : h))
    : [...history, entry];
  return next.sort((a, b) => a.weekOf.localeCompare(b.weekOf));
}

function countKeywords(openings) {
  const counts = {};
  for (const opening of openings) {
    for (const keyword of opening.detectedKeywords ?? []) {
      counts[keyword] = (counts[keyword] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Merge discovered/enriched facts into a company.
 * `trust` is 'primary' (read from the company itself) or 'directory'
 * (a third-party listing). Directory data fills blanks but never overwrites.
 */
export function mergeFacts(company, facts, trust = 'directory') {
  const next = { ...company };
  const filled = [];
  // Fields a directory-trust merge declined to touch because the company
  // already has a value. Returned rather than dropped: "nothing changed" and
  // "nothing changed *because you are not allowed to overwrite this*" are very
  // different messages to the person who just researched the company.
  const blocked = [];

  for (const [key, rawValue] of Object.entries(facts)) {
    if (rawValue === null || rawValue === undefined || rawValue === '') continue;
    if (!(key in next)) continue;

    // Country is the location filter's vocabulary, so one country must have
    // exactly one spelling. Five sources write this field and each spells it
    // differently; normalizing here catches all of them instead of relying on
    // every current and future source to remember. A value that names no
    // country ("EMEA", a city, a parsing accident) is dropped rather than
    // stored, because it would appear in the filter as though it were real.
    // Descriptions arrive with feed and thread furniture attached and at
    // whatever length the source felt like; the card gives them two lines.
    // Cleaning here covers every source at once — see description.mjs.
    let value = rawValue;
    if (key === 'country') value = normalizeCountry(rawValue);
    else if (key === 'description') value = cleanDescription(rawValue, next.name) || null;
    if (value === null) continue;

    const current = next[key];
    const isEmpty =
      current === null || current === '' || (Array.isArray(current) && current.length === 0);

    if (SOFT_FIELDS.includes(key)) {
      if (isEmpty || trust === 'primary') {
        if (current !== value) {
          next[key] = value;
          filled.push(key);
        }
      } else if (current !== value) {
        blocked.push(key);
      }
      continue;
    }

    if (key === 'keywords') {
      const merged = [...new Set([...current, ...value])].slice(0, 10);
      if (merged.length !== current.length) {
        next.keywords = merged;
        filled.push('keywords');
      }
      continue;
    }

    if (key === 'remoteRegions') {
      const merged = [...new Set([...current, ...value])];
      if (merged.length !== current.length) {
        next.remoteRegions = merged;
        filled.push('remoteRegions');
      }
      continue;
    }

    if (isEmpty && current !== value) {
      next[key] = value;
      filled.push(key);
    } else if (!isEmpty && current !== value) {
      blocked.push(key);
    }
  }

  return { company: next, filled, blocked };
}

/** Insert or replace a company in the dataset, keyed on id. */
export function upsertCompany(companies, company) {
  const index = companies.findIndex((c) => c.id === company.id);
  if (index < 0) return [...companies, company];
  return companies.map((c, i) => (i === index ? company : c));
}
