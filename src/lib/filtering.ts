import type { Company } from '../types/company.js';
import type { Filters, SizeRange, SortKey } from '../types/filters.js';
import { sizeRangeOfBand } from '../types/filters.js';
import { searchCompanies, type ScoredCompany } from './scoring.js';

/**
 * Filtering and sorting, shared by the UI and the public API.
 *
 * Imports are relative rather than `@/`-aliased because the serverless API
 * imports this at runtime and Vercel's Node runtime does not resolve tsconfig
 * path mappings.
 *
 * The rule this module exists to keep in one place: applying a filter to a
 * dimension a company has no data for EXCLUDES it — claiming an unknown-size
 * company sits in the 11–50 band would be a lie — but the exclusion is counted
 * and reported, because a large share of this dataset is unverified and
 * silently hiding most of the index behind one click is the failure to avoid.
 * Both consumers surface those counts; only their parameter shapes differ.
 */

export type FilterVerdict = 'pass' | 'mismatch' | 'unknownSize' | 'unknownCountry' | 'unknownRemote';

export interface CompanyFilter {
  readonly remote: Company['remotePolicy'];
  readonly country: string | null;
  readonly size: SizeRange | null;
}

/**
 * A company's headcount is a range and so is the request, so the test is
 * overlap, not containment. A null bound on either side is unbounded.
 */
export function overlapsSizeRange(company: Company, wanted: SizeRange): boolean {
  const companyMin = company.sizeMin ?? 0;
  const companyMax = company.sizeMax ?? Number.MAX_SAFE_INTEGER;
  const wantedMin = wanted.min ?? 0;
  const wantedMax = wanted.max ?? Number.MAX_SAFE_INTEGER;
  return companyMin <= wantedMax && companyMax >= wantedMin;
}

/** Evaluate one company against one filter set. The single source of truth. */
export function evaluateFilter(company: Company, filter: CompanyFilter): FilterVerdict {
  if (filter.remote !== null) {
    if (company.remotePolicy === null) return 'unknownRemote';
    if (company.remotePolicy !== filter.remote) return 'mismatch';
  }

  if (filter.country !== null) {
    if (company.country === null) return 'unknownCountry';
    // Case-insensitive so `?country=estonia` works from a URL bar or an agent.
    if (company.country.toLowerCase() !== filter.country.toLowerCase()) return 'mismatch';
  }

  if (filter.size !== null) {
    if (company.sizeMin === null && company.sizeMax === null) return 'unknownSize';
    if (!overlapsSizeRange(company, filter.size)) return 'mismatch';
  }

  return 'pass';
}

export interface ExclusionCounts {
  readonly unknownSize: number;
  readonly unknownCountry: number;
  readonly unknownRemote: number;
}

export interface FilterOutcome {
  readonly results: readonly ScoredCompany[];
  readonly excluded: ExclusionCounts;
}

/**
 * Partition an already-scored list, tallying why rows were dropped.
 * Sorting is the caller's concern — the API pages over relevance order, while
 * the UI offers four orders.
 */
export function partition(
  scored: readonly ScoredCompany[],
  filter: CompanyFilter,
): FilterOutcome {
  const results: ScoredCompany[] = [];
  let unknownSize = 0;
  let unknownCountry = 0;
  let unknownRemote = 0;

  for (const entry of scored) {
    switch (evaluateFilter(entry.company, filter)) {
      case 'pass':
        results.push(entry);
        break;
      case 'unknownSize':
        unknownSize += 1;
        break;
      case 'unknownCountry':
        unknownCountry += 1;
        break;
      case 'unknownRemote':
        unknownRemote += 1;
        break;
      case 'mismatch':
        break;
    }
  }

  return { results, excluded: { unknownSize, unknownCountry, unknownRemote } };
}

export const SORTERS: Record<SortKey, (a: ScoredCompany, b: ScoredCompany) => number> = {
  relevance: (a, b) =>
    (b.match?.score ?? 0) - (a.match?.score ?? 0) ||
    b.company.currentOpenings.length - a.company.currentOpenings.length ||
    // Name last so ties are stable across requests — `offset` paging is only
    // correct over a total order.
    a.company.name.localeCompare(b.company.name),
  openings: (a, b) =>
    b.company.currentOpenings.length - a.company.currentOpenings.length ||
    a.company.name.localeCompare(b.company.name),
  // Unverified companies sort last rather than first — null is not "recent".
  verified: (a, b) => {
    const at = a.company.lastVerified === null ? -Infinity : Date.parse(a.company.lastVerified);
    const bt = b.company.lastVerified === null ? -Infinity : Date.parse(b.company.lastVerified);
    return bt - at || a.company.name.localeCompare(b.company.name);
  },
  name: (a, b) => a.company.name.localeCompare(b.company.name),
};

/** The UI entry point: band-shaped size, four sort orders. */
export function applyFilters(companies: readonly Company[], filters: Filters): FilterOutcome {
  const scored = searchCompanies(companies, filters.query);
  const outcome = partition(scored, {
    remote: filters.remote,
    country: filters.country,
    size: filters.size === null ? null : sizeRangeOfBand(filters.size),
  });
  return {
    ...outcome,
    results: [...outcome.results].sort(SORTERS[filters.sort]),
  };
}

/** Countries present in the dataset, for the location filter. */
export function availableCountries(companies: readonly Company[]): string[] {
  const seen = new Set<string>();
  for (const c of companies) {
    if (c.country !== null) seen.add(c.country);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
