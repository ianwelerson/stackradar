import type { ApiCompanyDetail, ApiPosition, ApiScoredCompany } from './schema.js';

/**
 * Token discipline.
 *
 * A tool result is prompt text for the calling model, so these shapes carry what
 * a model needs to answer or to act — enough to name a company, judge its fit,
 * and follow a link — and drop the rest. Fields that convey *how much to trust
 * the row* (`lastVerified`, `dataNotes`) are never dropped; they are the point.
 *
 * `get_company` deliberately trims far less: a model calls it precisely because
 * the summary was not enough.
 */

const MAX_DESCRIPTION = 180;
const MAX_KEYWORDS = 10;
const MAX_ROLE_TITLES = 6;
const MAX_REGIONS = 5;
const MAX_HISTORY_WEEKS = 26;

function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

export interface CompactCompany {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly website: string | null;
  readonly careersUrl: string | null;
  readonly country: string | null;
  readonly hqLocation: string | null;
  readonly remotePolicy: string | null;
  readonly remoteRegions: readonly string[];
  readonly size: string | null;
  readonly keywords: readonly string[];
  readonly openRoles: number;
  readonly openRoleTitles: readonly string[];
  readonly score: number;
  readonly matchReasons: readonly string[];
  readonly lastVerified: string | null;
  readonly dataNotes: string | null;
}

export function compactCompany(company: ApiScoredCompany): CompactCompany {
  return {
    id: company.id,
    name: company.name,
    description: truncate(company.description, MAX_DESCRIPTION),
    website: company.website,
    careersUrl: company.careersUrl,
    country: company.country,
    hqLocation: company.hqLocation,
    remotePolicy: company.remotePolicy,
    remoteRegions: company.remoteRegions.slice(0, MAX_REGIONS),
    size: company.sizeRange,
    keywords: company.keywords.slice(0, MAX_KEYWORDS),
    openRoles: company.openings,
    openRoleTitles: company.currentOpenings.slice(0, MAX_ROLE_TITLES).map((o) => o.title),
    score: company.score,
    matchReasons: company.reasons,
    lastVerified: company.lastVerified,
    dataNotes: truncate(company.dataNotes, MAX_DESCRIPTION),
  };
}

export function compactPosition(position: ApiPosition): Record<string, unknown> {
  return {
    title: position.title,
    url: position.url,
    postedDate: position.postedDate,
    keywords: position.detectedKeywords.slice(0, MAX_KEYWORDS),
    companyId: position.companyId,
    company: position.companyName,
    website: position.companyWebsite,
    careersUrl: position.careersUrl,
    country: position.country,
    remotePolicy: position.remotePolicy,
    matchedVia: position.matchedVia,
  };
}

/**
 * The detail view. Only the weekly history is bounded — a long scan log would
 * otherwise dominate the response, and the recent weeks are the informative
 * ones. `historyTruncated` says so rather than letting the model assume it has
 * the whole series.
 */
export function detailedCompany(company: ApiCompanyDetail): Record<string, unknown> {
  const history = company.history.slice(-MAX_HISTORY_WEEKS);

  return {
    id: company.id,
    name: company.name,
    description: company.description,
    website: company.website,
    careersUrl: company.careersUrl,
    sizeRange: company.sizeRange,
    sizeMin: company.sizeMin,
    sizeMax: company.sizeMax,
    hqLocation: company.hqLocation,
    country: company.country,
    remotePolicy: company.remotePolicy,
    remoteRegions: company.remoteRegions,
    keywords: company.keywords,
    openRoles: company.openings,
    currentOpenings: company.currentOpenings,
    weeklyHistory: history,
    historyTruncated: history.length < company.history.length,
    lastVerified: company.lastVerified,
    dataNotes: company.dataNotes,
  };
}

/**
 * The freshness caveat, attached to every result rather than left to the tool
 * description — a model that reads only the payload still sees it.
 */
export function freshnessNote(lastVerifiedNulls: number, total: number): string {
  const base =
    'Community-researched data, not a live job board. `lastVerified: null` means that record has never been checked against the company’s own careers page — confirm at `careersUrl` before telling a user a role is open.';
  if (total === 0) return base;
  return `${base} ${lastVerifiedNulls} of ${total} returned records are unverified.`;
}
