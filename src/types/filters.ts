import type { RemotePolicy } from './company.js';

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

export interface Filters {
  readonly query: string;
  readonly remote: RemotePolicy | null;
  readonly country: string | null;
  readonly size: SizeBandKey | null;
  readonly sort: SortKey;
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  remote: null,
  country: null,
  size: null,
  sort: 'relevance',
};

/** A requested headcount window. Either bound may be open. */
export interface SizeRange {
  readonly min: number | null;
  readonly max: number | null;
}

export function sizeRangeOfBand(band: SizeBandKey): SizeRange {
  return { min: SIZE_BANDS[band].min, max: SIZE_BANDS[band].max };
}
