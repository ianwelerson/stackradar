import { searchCompanies, type ScoredCompany } from '../../src/lib/scoring.js';
import { partition, SORTERS, type ExclusionCounts } from '../../src/lib/filtering.js';
import { companies } from './dataset.js';
import {
  readCountry,
  readKeyword,
  readRemotePolicy,
  readSizeBound,
  type RemotePolicyParam,
} from './params.js';

/**
 * Filtering for the public API.
 *
 * Relevance scoring is NOT implemented here — `searchCompanies` from
 * `src/lib/scoring.ts` is the one implementation, shared with the UI, and this
 * module only calls it. That module has no runtime imports of its own (its
 * `@/types/company` import is type-only and erased at build time), so it drops
 * into a serverless function unchanged.
 *
 * The filter rules are shared too: `partition` and `SORTERS` come from
 * `src/lib/filtering.ts`, the same module the UI uses, so the decision to
 * exclude-and-count companies whose size/country/work model is unknown cannot
 * drift between the site and the API. That module is deliberately free of `@/`
 * path aliases, which Vercel's Node runtime does not resolve, so it imports
 * cleanly into a serverless function. Only the parameter shape differs here —
 * spec §7a specifies a numeric `minSize`/`maxSize` pair where the UI offers
 * named bands — and that is converted to a `SizeRange` below.
 */

export interface CompanyQuery {
  readonly keyword: string | null;
  readonly country: string | null;
  readonly remote: RemotePolicyParam | null;
  readonly minSize: number | null;
  readonly maxSize: number | null;
}

/** Counts of rows a filter dropped for missing data rather than a mismatch. */
export type { ExclusionCounts };

export interface FilterOutcome {
  readonly results: readonly ScoredCompany[];
  readonly excluded: ExclusionCounts;
}

/** The spec calls the location param `location`; the UI calls it `country`. */
export const COUNTRY_PARAM_ALIASES = ['country', 'location'] as const;

export function parseCompanyQuery(url: URL): CompanyQuery {
  return {
    keyword: readKeyword(url, ['keyword']),
    country: readCountry(url, COUNTRY_PARAM_ALIASES),
    remote: readRemotePolicy(url),
    minSize: readSizeBound(url, 'minSize'),
    maxSize: readSizeBound(url, 'maxSize'),
  };
}


export function filterCompanies(query: CompanyQuery): FilterOutcome {
  // The keyword goes through the shared scorer; an empty keyword returns every
  // company unscored, which is exactly the unfiltered-list behaviour we want.
  const scored = searchCompanies(companies, query.keyword ?? '');

  // The HTTP surface takes one value per dimension; `partition` takes lists so
  // the UI can offer multi-select. A single value is just a list of one, and
  // the API's contract is unchanged.
  const { results, excluded } = partition(scored, {
    remote: query.remote === null ? [] : [query.remote],
    countries: query.country === null ? [] : [query.country],
    sizes:
      query.minSize === null && query.maxSize === null
        ? []
        : [{ min: query.minSize, max: query.maxSize }],
  });

  return {
    results: [...results].sort(SORTERS.relevance),
    excluded,
  };
}

/** Echo the filters back so a caller can confirm what was actually applied. */
export function describeQuery(query: CompanyQuery): Record<string, unknown> {
  return {
    keyword: query.keyword,
    country: query.country,
    remote: query.remote,
    minSize: query.minSize,
    maxSize: query.maxSize,
  };
}
