import type { Company, Opening, WorkplaceSlot } from '../types/company.js';
import type { Filters, SizeRange, SortKey } from '../types/filters.js';
import { ANYWHERE, sizeRangeOfBand } from '../types/filters.js';
import { searchCompanies, type ScoredCompany } from './scoring.js';
import { disciplineOf, type Discipline } from './discipline.js';
import { COUNTRIES, covers, regionFromLabel } from './regions.js';

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

/**
 * The slot that stands in for a company with no usable posting locations.
 *
 * Company records store readable labels ("Europe", "Global") and a single
 * country, so they are translated into the same shape a posting produces.
 * A remote company with no recorded regions gets an empty `where` — its remote
 * scope was never stated, which is not the same as worldwide.
 */
function companySlot(company: Company): WorkplaceSlot {
  if (company.remotePolicy === 'remote') {
    const where = company.remoteRegions
      .map(regionFromLabel)
      .filter((value): value is string => value !== null);
    return { mode: 'remote', where };
  }
  return {
    mode: company.remotePolicy ?? 'unknown',
    where: company.country === null ? [] : [company.country],
  };
}

const COUNTRY_BY_LOWER = new Map(COUNTRIES.map((name) => [name.toLowerCase(), name]));

type Verdict = FilterVerdict;

/** pass beats an unknown, an unknown beats a mismatch. */
function better(a: Verdict, b: Verdict): Verdict {
  if (a === 'pass' || b === 'pass') return 'pass';
  if (a !== 'mismatch') return a;
  return b;
}

/**
 * One slot against the wanted work models and countries — together.
 *
 * This is the whole point of slots. Checking "is the company remote?" and "is
 * the company in Estonia?" separately answered a question nobody asked: a US
 * company with remote roles *restricted to the US* passed a search for remote
 * roles from Estonia. The two have to be true of the same place at once.
 */
function evaluateSlot(
  company: Company,
  slot: WorkplaceSlot,
  remote: CompanyFilter['remote'],
  countries: readonly string[],
): Verdict {
  let modeUnknown = false;
  if (remote.length > 0) {
    // A place named without a work model borrows the company's policy — but
    // only toward the office. "Tallinn" at a hybrid company is a hybrid role in
    // Tallinn. "London" at a remote-first company is genuinely ambiguous: such
    // companies still hire into offices, and the posting did not say remote.
    // Resolving it as remote anyway inflated remote roles from 1,161 the
    // postings state to 2,082 — the same overstatement this model exists to
    // stop — so it stays unknown and the reader's profile decides.
    const policy = company.remotePolicy;
    const mode =
      slot.mode !== 'unknown'
        ? slot.mode
        : policy === 'hybrid' || policy === 'onsite'
          ? policy
          : null;
    if (mode === null) modeUnknown = true;
    else if (!remote.includes(mode)) return 'mismatch';
  }

  let placeUnknown = false;
  if (countries.length > 0) {
    // Empty `where` is "not stated", never "anywhere" — plain "Remote" says
    // nothing about who may apply. That matters most when the reader asked for
    // ANYWHERE: that is a narrowing to roles their employer opened to the whole
    // world, so a role that never said cannot be counted as one of them.
    if (slot.where.length === 0) placeUnknown = true;
    else if (!countries.some((country) => covers(slot.where, country))) return 'mismatch';
  }

  if (modeUnknown) return 'unknownRemote';
  if (placeUnknown) return 'unknownCountry';
  return 'pass';
}

/**
 * One opening against the role-level parts of a filter: its discipline, and
 * whether any place it is offered satisfies the work model and location at
 * once. Exported for the roles view, whose rows are openings.
 */
export function evaluateOpening(
  company: Company,
  opening: Opening,
  filter: CompanyFilter,
): Verdict {
  const disciplines = filter.disciplines ?? [];
  if (disciplines.length > 0 && !disciplines.includes(disciplineOf(opening.title))) {
    return 'mismatch';
  }

  const countries = filter.countries.map(canonicalCountry);
  if (filter.remote.length === 0 && countries.length === 0) return 'pass';

  const slots = opening.workplace.length > 0 ? opening.workplace : [companySlot(company)];
  let verdict: Verdict = 'mismatch';
  for (const slot of slots) {
    verdict = better(verdict, evaluateSlot(company, slot, filter.remote, countries));
    if (verdict === 'pass') break;
  }
  return verdict;
}

/**
 * Filter countries arrive from URLs and agents in any case — `?country=estonia`.
 * `where` uses canonical names, so the wanted list is matched case-insensitively
 * against them rather than compared raw.
 *
 * `anywhere` and `global` are accepted as spellings of ANYWHERE, since a caller
 * writing the filter by hand has no reason to know which word the parser chose.
 */
function canonicalCountry(value: string): string {
  const wanted = value.trim().toLowerCase();
  if (wanted === ANYWHERE || wanted === 'anywhere' || wanted === 'global') return ANYWHERE;
  return COUNTRY_BY_LOWER.get(wanted) ?? value.trim();
}

/** Evaluate one company against one filter set. The single source of truth. */
export function evaluateFilter(company: Company, filter: CompanyFilter): FilterVerdict {
  const lenient = filter.includeUnknown === true;
  let verdict: Verdict = 'pass';

  if (filter.sizes.length > 0) {
    if (company.sizeMin === null && company.sizeMax === null) verdict = 'unknownSize';
    else if (!filter.sizes.some((range) => overlapsSizeRange(company, range))) return 'mismatch';
  }

  const roleLevel =
    filter.remote.length > 0 || filter.countries.length > 0 || (filter.disciplines ?? []).length > 0;

  if (roleLevel) {
    let roles: Verdict;
    if (company.currentOpenings.length > 0) {
      // A company matches when it has at least one role that satisfies every
      // role-level constraint at once. An engineering role that is US-only and
      // a sales role open worldwide do not add up to "remote engineering from
      // Estonia", however each looks on its own.
      roles = 'mismatch';
      for (const opening of company.currentOpenings) {
        roles = better(roles, evaluateOpening(company, opening, filter));
        if (roles === 'pass') break;
      }
    } else if ((filter.disciplines ?? []).length > 0) {
      // No readable board: there are no roles to classify.
      roles = 'unknownRoles';
    } else {
      const countries = filter.countries.map(canonicalCountry);
      roles = evaluateSlot(company, companySlot(company), filter.remote, countries);
    }

    if (roles === 'mismatch') return 'mismatch';
    if (roles !== 'pass' && verdict === 'pass') verdict = roles;
  }

  if (verdict !== 'pass' && lenient) return 'pass';
  return verdict;
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
