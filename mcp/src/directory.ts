import { generatedAt as snapshotGeneratedAt, getCompanyById } from '../../api/_lib/dataset.js';
import { filterCompanies, type CompanyQuery } from '../../api/_lib/query.js';
import { flattenPositions, toCompanyDetail, toScoredSummary } from '../../api/_lib/shape.js';
import {
  companiesResponseSchema,
  detailResponseSchema,
  errorResponseSchema,
  positionsResponseSchema,
  searchResponseSchema,
  type ApiCompanyDetail,
  type ApiPosition,
  type ApiScoredCompany,
} from './schema.js';

/**
 * The directory, read from the deployed HTTP API with a bundled snapshot as a
 * fallback.
 *
 * The snapshot path is not a second implementation: it imports the very same
 * filtering and shaping modules the API's own functions use (`api/_lib/*`, which
 * in turn call the one shared scorer in `src/lib/scoring.ts`), so both paths
 * produce byte-identical record shapes and identical rankings. The only
 * difference is freshness, and callers are told which one answered.
 */

const DEFAULT_BASE_URL = 'https://stackradar.strukt.app';

/** Short enough that a dead host degrades to the snapshot fast, not eventually. */
const REQUEST_TIMEOUT_MS = 8000;

function resolveBaseUrl(): string {
  const configured = process.env['STACK_RADAR_API']?.trim();
  const raw = configured !== undefined && configured.length > 0 ? configured : DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

const baseUrl = resolveBaseUrl();

export type SourceLabel = 'api' | 'snapshot';

export interface Sourced<T> {
  /** `api` = live HTTP response; `snapshot` = the dataset bundled at build time. */
  readonly source: SourceLabel;
  readonly generatedAt: string;
  readonly total: number;
  readonly data: T;
}

export interface DirectoryFilters {
  readonly keyword: string | null;
  readonly country: string | null;
  readonly remote: 'remote' | 'hybrid' | 'onsite' | null;
  readonly minSize: number | null;
  readonly maxSize: number | null;
}

export const NO_FILTERS: DirectoryFilters = {
  keyword: null,
  country: null,
  remote: null,
  minSize: null,
  maxSize: null,
};

type HttpOutcome =
  | { readonly kind: 'ok'; readonly body: unknown }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * Diagnostics go to stderr. A stdio MCP server's stdout is the JSON-RPC
 * channel — anything else written there corrupts the session.
 */
function warn(message: string): void {
  console.error(`[stack-radar-mcp] ${message}`);
}

async function requestJson(path: string, params: URLSearchParams): Promise<HttpOutcome> {
  const url = `${baseUrl}${path}${params.size > 0 ? `?${params.toString()}` : ''}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 404) return { kind: 'notFound' };

    if (!response.ok) {
      // A 4xx carries a usable message; a 5xx means fall back to the snapshot.
      const parsed = errorResponseSchema.safeParse(await response.json().catch(() => null));
      const detail = parsed.success ? parsed.data.error.message : `HTTP ${response.status}`;
      return { kind: 'unavailable', reason: detail };
    }

    return { kind: 'ok', body: await response.json() };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'unknown transport error';
    return { kind: 'unavailable', reason };
  }
}

function toSearchParams(filters: DirectoryFilters, limit: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.country !== null) params.set('country', filters.country);
  if (filters.remote !== null) params.set('remote', filters.remote);
  if (filters.minSize !== null) params.set('minSize', String(filters.minSize));
  if (filters.maxSize !== null) params.set('maxSize', String(filters.maxSize));
  params.set('limit', String(limit));
  return params;
}

function toLocalQuery(filters: DirectoryFilters): CompanyQuery {
  return {
    keyword: filters.keyword,
    country: filters.country,
    remote: filters.remote,
    minSize: filters.minSize,
    maxSize: filters.maxSize,
  };
}

export async function searchCompanies(
  query: string,
  filters: DirectoryFilters,
  limit: number,
): Promise<Sourced<readonly ApiScoredCompany[]>> {
  const params = toSearchParams(filters, limit);
  params.set('q', query);

  const outcome = await requestJson('/api/search', params);
  if (outcome.kind === 'ok') {
    const parsed = searchResponseSchema.safeParse(outcome.body);
    if (parsed.success) {
      return {
        source: 'api',
        generatedAt: parsed.data.generatedAt,
        total: parsed.data.total,
        data: parsed.data.results,
      };
    }
    warn('API returned an unexpected /api/search payload; using the bundled snapshot.');
  } else if (outcome.kind === 'unavailable') {
    warn(`/api/search unavailable (${outcome.reason}); using the bundled snapshot.`);
  }

  const { results } = filterCompanies({ ...toLocalQuery(filters), keyword: query });
  return {
    source: 'snapshot',
    generatedAt: snapshotGeneratedAt,
    total: results.length,
    data: results.slice(0, limit).map(toScoredSummary),
  };
}

export async function listCompanies(
  filters: DirectoryFilters,
  limit: number,
): Promise<Sourced<readonly ApiScoredCompany[]>> {
  const params = toSearchParams(filters, limit);
  if (filters.keyword !== null) params.set('keyword', filters.keyword);

  const outcome = await requestJson('/api/companies', params);
  if (outcome.kind === 'ok') {
    const parsed = companiesResponseSchema.safeParse(outcome.body);
    if (parsed.success) {
      return {
        source: 'api',
        generatedAt: parsed.data.generatedAt,
        total: parsed.data.total,
        data: parsed.data.companies,
      };
    }
    warn('API returned an unexpected /api/companies payload; using the bundled snapshot.');
  } else if (outcome.kind === 'unavailable') {
    warn(`/api/companies unavailable (${outcome.reason}); using the bundled snapshot.`);
  }

  const { results } = filterCompanies(toLocalQuery(filters));
  return {
    source: 'snapshot',
    generatedAt: snapshotGeneratedAt,
    total: results.length,
    data: results.slice(0, limit).map(toScoredSummary),
  };
}

/** Resolves to null when the company genuinely does not exist in the dataset. */
export async function getCompany(id: string): Promise<Sourced<ApiCompanyDetail> | null> {
  const outcome = await requestJson(`/api/companies/${encodeURIComponent(id)}`, new URLSearchParams());

  if (outcome.kind === 'ok') {
    const parsed = detailResponseSchema.safeParse(outcome.body);
    if (parsed.success) {
      return {
        source: 'api',
        generatedAt: parsed.data.generatedAt,
        total: 1,
        data: parsed.data.company,
      };
    }
    warn('API returned an unexpected company payload; using the bundled snapshot.');
  } else if (outcome.kind === 'notFound') {
    // The API is reachable and authoritative: the id does not exist.
    return null;
  } else {
    warn(`/api/companies/{id} unavailable (${outcome.reason}); using the bundled snapshot.`);
  }

  const company = getCompanyById(id);
  if (company === undefined) return null;

  return {
    source: 'snapshot',
    generatedAt: snapshotGeneratedAt,
    total: 1,
    data: toCompanyDetail(company),
  };
}

export interface PositionsResult extends Sourced<readonly ApiPosition[]> {
  readonly companiesMatched: number;
}

export async function listPositions(
  filters: DirectoryFilters,
  limit: number,
): Promise<PositionsResult> {
  const params = toSearchParams(filters, limit);
  if (filters.keyword !== null) params.set('keyword', filters.keyword);

  const outcome = await requestJson('/api/positions', params);
  if (outcome.kind === 'ok') {
    const parsed = positionsResponseSchema.safeParse(outcome.body);
    if (parsed.success) {
      return {
        source: 'api',
        generatedAt: parsed.data.generatedAt,
        total: parsed.data.total,
        companiesMatched: parsed.data.companiesMatched,
        data: parsed.data.positions,
      };
    }
    warn('API returned an unexpected /api/positions payload; using the bundled snapshot.');
  } else if (outcome.kind === 'unavailable') {
    warn(`/api/positions unavailable (${outcome.reason}); using the bundled snapshot.`);
  }

  const { results } = filterCompanies(toLocalQuery(filters));
  const positions = flattenPositions(results, filters.keyword);
  return {
    source: 'snapshot',
    generatedAt: snapshotGeneratedAt,
    total: positions.length,
    companiesMatched: results.length,
    data: positions.slice(0, limit),
  };
}

export { baseUrl };
