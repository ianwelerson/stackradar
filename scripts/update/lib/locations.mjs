/**
 * Reading a country out of a job posting's location string.
 *
 * This is the one place allowed to guess a country from free text, and it is
 * deliberately grudging about it. The strings come from job boards and look
 * like "Tallinn, Estonia", "San Francisco, CA, US", "Berlin · London" or
 * "Paris, IDF, FR / Paris, Île-de-France, FR" — rich enough to be worth mining,
 * ambiguous enough to produce confident nonsense if mined carelessly.
 *
 * The failure it exists to prevent, measured on this dataset before the rule
 * below was in place: "San Francisco, CA" filed under **Canada**, "Durham, NC"
 * under **New Caledonia**, "McLean, VA" under **Vatican City**. A bare
 * two-letter token after a city is overwhelmingly a US state, not an ISO
 * country code, and the two namespaces collide badly.
 */

import { normalizeCountry, fromCode } from './countries.mjs';

/** Adapters join multi-site postings with " · "; some boards use " / ". */
const PLACE_SEPARATOR = /\s*[·|/]\s*/;

/** Guard against a pathological string driving unbounded work. */
const MAX_LOCATION_LENGTH = 400;
const MAX_PLACES = 20;

/** The share of a company's located postings that must agree before we call it
 *  a home country. Two thirds says "this is where they are" rather than "this
 *  is one of several places they hire". */
const AGREEMENT = 0.66;

/** Below this many located postings a ratio means nothing: two roles in one
 *  city is not evidence of where a company lives. */
const MIN_PLACES = 5;

/**
 * The country named by a single place string, or null.
 *
 * A full country name anywhere in the comma-separated parts counts. A bare
 * two-letter code counts **only** as the final part of three or more — the
 * "City, Region, Country" shape — because that is the only position where it is
 * reliably a country rather than a state or province.
 */
export function countryFromPlace(place) {
  if (typeof place !== 'string') return null;
  const parts = place
    .slice(0, MAX_LOCATION_LENGTH)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (parts.length === 0) return null;

  // Full names first, scanning from the right: the country is conventionally
  // last, and a leading token is far more likely to be a city that happens to
  // share a name with a country (Mexico, Luxembourg, Singapore, Monaco).
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const named = normalizeCountry(parts[i]);
    if (named !== null) return named;
  }

  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    if (/^[A-Za-z]{2}$/.test(last)) return fromCode(last);
  }

  return null;
}

/** Every place a single stored location string refers to. */
export function placesIn(location) {
  if (typeof location !== 'string' || location.trim() === '') return [];
  return location
    .slice(0, MAX_LOCATION_LENGTH)
    .split(PLACE_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .slice(0, MAX_PLACES);
}

/**
 * The country a company's postings agree on, or null.
 *
 * Null is the right answer far more often than it looks. A company hiring
 * across four countries has no single home to report, and saying "United
 * States" because seven of eighteen roles are there would be a claim its own
 * postings do not support.
 *
 * @param {readonly {location: string|null}[]} openings
 * @returns {{ country: string|null, agreement: number, tally: Record<string, number> }}
 */
export function countryFromOpenings(openings) {
  const tally = {};
  // EVERY place examined, including the ones that named no country. Dividing by
  // the resolved ones instead is a selection bias that manufactures certainty:
  // Astronomer posts eighteen roles, seventeen of them bare city names and one
  // saying "Ireland", and scoring 1/1 called that a 100% Irish company. Supabase
  // advertises "Remote, Global / AMER / EMEA / APAC" and four roles that happen
  // to name Canada — 4/4 made a distributed company Canadian. Counting the
  // silent majority is what stops both.
  let places = 0;

  for (const opening of openings ?? []) {
    for (const place of placesIn(opening?.location)) {
      places += 1;
      const country = countryFromPlace(place);
      if (country === null) continue;
      tally[country] = (tally[country] ?? 0) + 1;
    }
  }

  if (places < MIN_PLACES) return { country: null, agreement: 0, places, tally };

  const [top] = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (top === undefined) return { country: null, agreement: 0, places, tally };

  const agreement = top[1] / places;
  return { country: agreement >= AGREEMENT ? top[0] : null, agreement, places, tally };
}
