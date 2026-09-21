import type { Company } from '../types/company.js';
import type { Filters, SizeRange, SortKey } from '../types/filters.js';
import { sizeRangeOfBand } from '../types/filters.js';
import { searchCompanies, type ScoredCompany } from './scoring.js';
import { disciplineOf, type Discipline } from './discipline.js';

/**
 * Filtering and sorting, shared by the UI and the public API.
 *
 * Imports are relative rather than `@/`-aliased because the serverless API
 * imports this at runtime and Vercel's Node runtime does not resolve tsconfig
 * path mappings.
 *
 * The rule this module exists to keep in one place: a company with no data for
 * a filtered dimension is never silently counted as a match — claiming an
 * unknown-size company sits in the 11–50 band would be a lie. By default it is
 * excluded, and the exclusion is counted and reported, because a large share of
 * this dataset is unverified and hiding most of the index behind one click is
 * the failure to avoid. A caller may instead pass `includeUnknown` to keep
 * those companies in the results; what it may not do is have them quietly
 * assert a value they never had. Both consumers surface the counts; only their
 * parameter shapes differ.
 */

export type FilterVerdict =
  | 'pass'
  | 'mismatch'
  | 'unknownSize'
  | 'unknownCountry'
  | 'unknownRemote'
  | 'unknownRoles';

/**
 * A filter request. Every dimension is a list because a reader's real answer
 * usually is one — remote *or* hybrid, 11–50 *or* 51–200. An empty list means
 * "no preference", which is different from a list that happens to match
 * everything.
 *
 * `includeUnknown` decides what happens to a company whose value was never
 * confirmed. False is the strict reading and the historical behaviour: it
 * cannot be shown to match, so it is excluded and counted. True keeps it in,
 * which matters because a third of this dataset has no confirmed work model
 * and hiding all of it behind one click is its own kind of dishonesty.
 */
export interface CompanyFilter {
  readonly remote: readonly NonNullable<Company['remotePolicy']>[];
  readonly countries: readonly string[];
  readonly sizes: readonly SizeRange[];
  /**
   * Role disciplines wanted. A company passes when it has at least one open
   * role in one of them — "companies hiring engineers" rather than "companies
   * whose whole hiring is engineering".
   */
  readonly disciplines?: readonly Discipline[];
  readonly includeUnknown?: boolean;
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
  const lenient = filter.includeUnknown === true;

  if (filter.remote.length > 0) {
    if (company.remotePolicy === null) {
      if (!lenient) return 'unknownRemote';
    } else if (!filter.remote.includes(company.remotePolicy)) {
      return 'mismatch';
    }
  }

  if (filter.countries.length > 0) {
    if (company.country === null) {
      if (!lenient) return 'unknownCountry';
    } else {
      // Case-insensitive so `?country=estonia` works from a URL bar or an agent.
      const wanted = filter.countries.map((c) => c.toLowerCase());
      if (!wanted.includes(company.country.toLowerCase())) return 'mismatch';
    }
  }

  if (filter.sizes.length > 0) {
    if (company.sizeMin === null && company.sizeMax === null) {
      if (!lenient) return 'unknownSize';
    } else if (!filter.sizes.some((range) => overlapsSizeRange(company, range))) {
      return 'mismatch';
    }
  }

  const disciplines = filter.disciplines ?? [];
  if (disciplines.length > 0) {
    // A company with no readable board has no roles to judge, which is an
    // absence of evidence rather than a mismatch — the same distinction the
    // other three dimensions make, handled the same way.
    if (company.currentOpenings.length === 0) {
      if (!lenient) return 'unknownRoles';
    } else if (
      !company.currentOpenings.some((opening) => disciplines.includes(disciplineOf(opening.title)))
    ) {
      return 'mismatch';
    }
  }

  return 'pass';
}

export interface ExclusionCounts {
  readonly unknownSize: number;
  readonly unknownCountry: number;
  readonly unknownRemote: number;
  readonly unknownRoles: number;
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
  let unknownRoles = 0;

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
      case 'unknownRoles':
        unknownRoles += 1;
        break;
      case 'mismatch':
        break;
    }
  }

  return { results, excluded: { unknownSize, unknownCountry, unknownRemote, unknownRoles } };
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
    countries: filters.countries,
    sizes: filters.sizes.map(sizeRangeOfBand),
    disciplines: filters.disciplines,
    includeUnknown: filters.includeUnknown,
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
