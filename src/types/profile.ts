import type { RemotePolicy } from './company.js';
import { SIZE_BANDS, type SizeBandKey } from './filters.js';
import { DISCIPLINE_LABELS, type Discipline } from '../lib/discipline.js';

/**
 * What a reader is looking for, saved rather than retyped.
 *
 * The directory's filters describe one search; a profile describes a standing
 * intent — "I write Go and Rust, I want remote, 11–200 people" — and the
 * directory opens already narrowed to it. Every field is plural because the
 * honest answer usually is: people will take remote *or* hybrid, and will look
 * at a 40-person company and a 150-person one in the same afternoon.
 *
 * It rides the same storage as tracking (see types/tracking.ts), so it is kept
 * in the browser and, when a database is connected, synced with everything
 * else. Nothing here is sent anywhere otherwise.
 */

/** Unbounded rather than an opinion: a term someone actually typed. */
export const MAX_TERMS = 24;
export const MAX_TERM_LENGTH = 40;
export const MAX_COUNTRIES = 20;

export interface Profile {
  /** Stack and role words — the same vocabulary the search box takes. */
  readonly terms: readonly string[];
  /** Acceptable work models. Empty means no preference. */
  readonly remote: readonly RemotePolicy[];
  /** Acceptable countries. Empty means anywhere. */
  readonly countries: readonly string[];
  /** Acceptable headcount bands. Empty means any size. */
  readonly sizes: readonly SizeBandKey[];
  /**
   * Kinds of role worth seeing. Empty means all of them.
   *
   * Separate from `terms` because they answer different questions: terms are
   * what you work with, this is what job you want. A directory that indexes
   * every open role at a company will otherwise offer an engineer the account
   * executive job alongside the backend one.
   */
  readonly disciplines: readonly Discipline[];
  /**
   * Whether companies whose value was never confirmed still count as a match.
   *
   * Defaults to true, and that default matters: a third of this directory has
   * no confirmed work model, so a strict reading of "remote only" would hide
   * dozens of companies that may well be remote. Opting into strictness is a
   * choice the reader makes, not one made for them.
   */
  readonly includeUnknown: boolean;
}

export const EMPTY_PROFILE: Profile = {
  terms: [],
  remote: [],
  countries: [],
  sizes: [],
  disciplines: [],
  includeUnknown: true,
};

const REMOTE_VALUES: readonly RemotePolicy[] = ['remote', 'hybrid', 'onsite'];

/** True when the profile expresses no preference at all. */
export function isProfileEmpty(profile: Profile): boolean {
  return (
    profile.terms.length === 0 &&
    profile.remote.length === 0 &&
    profile.countries.length === 0 &&
    profile.sizes.length === 0 &&
    profile.disciplines.length === 0
  );
}

/** The dimensions profileStrength counts. Kept beside it so the two cannot drift. */
export const PROFILE_DIMENSIONS = 5;

/** How many dimensions the profile constrains — for a badge on the nav. */
export function profileStrength(profile: Profile): number {
  return (
    (profile.terms.length > 0 ? 1 : 0) +
    (profile.remote.length > 0 ? 1 : 0) +
    (profile.countries.length > 0 ? 1 : 0) +
    (profile.sizes.length > 0 ? 1 : 0) +
    (profile.disciplines.length > 0 ? 1 : 0)
  );
}

function uniqueStrings(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.replace(/\s+/g, ' ').trim().slice(0, maxLength);
    if (trimmed === '') continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Parse a stored profile. Never trusts the stored shape — this comes back from
 * localStorage and, when connected, from a database the reader controls, so it
 * is untrusted input in exactly the way model output is.
 */
export function parseProfile(raw: unknown): Profile {
  if (typeof raw !== 'object' || raw === null) return EMPTY_PROFILE;
  const source = raw as Record<string, unknown>;

  const remote = Array.isArray(source['remote'])
    ? REMOTE_VALUES.filter((value) => (source['remote'] as unknown[]).includes(value))
    : [];
  const sizes = Array.isArray(source['sizes'])
    ? (Object.keys(SIZE_BANDS) as SizeBandKey[]).filter((band) =>
        (source['sizes'] as unknown[]).includes(band),
      )
    : [];

  const disciplines = Array.isArray(source['disciplines'])
    ? (Object.keys(DISCIPLINE_LABELS) as Discipline[]).filter((key) =>
        (source['disciplines'] as unknown[]).includes(key),
      )
    : [];

  return {
    terms: uniqueStrings(source['terms'], MAX_TERMS, MAX_TERM_LENGTH),
    remote,
    countries: uniqueStrings(source['countries'], MAX_COUNTRIES, 80),
    sizes,
    disciplines,
    // Absent means the stored profile predates the field; the safe reading of a
    // missing preference is the permissive one.
    includeUnknown: source['includeUnknown'] !== false,
  };
}
