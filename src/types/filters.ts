import type { RemotePolicy } from './company.js';
import type { Discipline } from '../lib/discipline.js';

/**
 * Imports here are relative, not `@/`-aliased, on purpose: this module is
 * imported at runtime by the serverless API, and Vercel's Node runtime does not
 * resolve tsconfig path mappings. Keeping it alias-free is what lets the filter
 * rules below be genuinely shared rather than reimplemented per consumer.
 */

/** Size bands reconciled toward the dataset's natural buckets. */
export const SIZE_BANDS = {
  '1-10': { label: '1–10 people', min: 1, max: 10 },
  '11-50': { label: '11–50 people', min: 11, max: 50 },
  '51-200': { label: '51–200 people', min: 51, max: 200 },
  '200+': { label: '200+ people', min: 201, max: null },
} as const;

export type SizeBandKey = keyof typeof SIZE_BANDS;

export const SORT_OPTIONS = {
  relevance: 'Best match',
  openings: 'Most open roles',
  verified: 'Recently verified',
  name: 'Company name',
} as const;

export type SortKey = keyof typeof SORT_OPTIONS;

/**
 * The one location choice that is not a place.
 *
 * `countries` answers "where can you work from", and every other entry in it is
 * somewhere you could live. This entry is the reader saying they are not tied
 * to anywhere — so it keeps only the roles the employer opened to the whole
 * world, and drops the ones open to a country or a region.
 *
 * It is deliberately the same token postings are parsed into (`workplace.where`
 * holds `'worldwide'` for "Anywhere in the world"), which is what lets the
 * ordinary country match answer it with no special case: `covers` already
 * treats `worldwide` as covering everyone, and no country or region covers
 * `worldwide` in return. An empty `countries` list remains "no location
 * filter", which is the opposite of this and used to share its name.
 */
export const ANYWHERE = 'worldwide';

/**
 * One search. Plural on every dimension because a reader's real preference
 * usually is — remote or hybrid, 11–50 or 51–200 — and because a saved profile
 * (types/profile.ts) feeds straight into this shape.
 */
export interface Filters {
  readonly query: string;
  readonly remote: readonly RemotePolicy[];
  /** Places the reader could work from. Empty means no location filter; the
   *  single entry `ANYWHERE` means only roles open with no country restriction. */
  readonly countries: readonly string[];
  readonly sizes: readonly SizeBandKey[];
  /** Role disciplines to keep. Empty means every kind of role. Only bites in
   *  the roles view, where a row is a job rather than a company. */
  readonly disciplines: readonly Discipline[];
  readonly sort: SortKey;
  /** Keep companies whose value was never confirmed. See CompanyFilter. */
  readonly includeUnknown: boolean;
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  remote: [],
  countries: [],
  sizes: [],
  disciplines: [],
  sort: 'relevance',
  includeUnknown: false,
};

/** A requested headcount window. Either bound may be open. */
export interface SizeRange {
  readonly min: number | null;
  readonly max: number | null;
}

export function sizeRangeOfBand(band: SizeBandKey): SizeRange {
  return { min: SIZE_BANDS[band].min, max: SIZE_BANDS[band].max };
}
