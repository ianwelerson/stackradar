import { tokenize, type ScoredCompany } from '../../src/lib/scoring.js';
import type { Company, Opening } from '../../src/types/company.js';

/**
 * Response shaping.
 *
 * Every field is listed explicitly rather than spreading the record, so that a
 * new internal column in `companies.json` cannot silently become part of the
 * public contract. The cost is that adding a public field is a deliberate edit
 * here, which is the point.
 */

export interface CompanySummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly website: string | null;
  readonly careersUrl: string | null;
  readonly logoUrl: string | null;
  readonly sizeRange: string | null;
  readonly sizeMin: number | null;
  readonly sizeMax: number | null;
  readonly hqLocation: string | null;
  readonly country: string | null;
  readonly remotePolicy: string | null;
  readonly remoteRegions: readonly string[];
  readonly keywords: readonly string[];
  readonly openings: number;
  readonly currentOpenings: readonly Opening[];
  /** Number of weekly scan entries; the entries themselves are on the detail route. */
  readonly historyWeeks: number;
  readonly lastVerified: string | null;
  readonly dataNotes: string | null;
}

export interface ScoredCompanySummary extends CompanySummary {
  readonly score: number;
  readonly reasons: readonly string[];
}

export function toCompanySummary(company: Company): CompanySummary {
  return {
    id: company.id,
    name: company.name,
    description: company.description,
    website: company.website,
    careersUrl: company.careersUrl,
    logoUrl: company.logoUrl,
    sizeRange: company.sizeRange,
    sizeMin: company.sizeMin,
    sizeMax: company.sizeMax,
    hqLocation: company.hqLocation,
    country: company.country,
    remotePolicy: company.remotePolicy,
    remoteRegions: company.remoteRegions,
    keywords: company.keywords,
    openings: company.currentOpenings.length,
    currentOpenings: company.currentOpenings,
    historyWeeks: company.history.length,
    lastVerified: company.lastVerified,
    dataNotes: company.dataNotes,
  };
}

/** Summary plus the shared scorer's output; score is 0 for an empty query. */
export function toScoredSummary({ company, match }: ScoredCompany): ScoredCompanySummary {
  return {
    ...toCompanySummary(company),
    score: match?.score ?? 0,
    reasons: match?.reasons ?? [],
  };
}

/** The detail route adds the append-only weekly scan log to the summary. */
export function toCompanyDetail(company: Company): CompanySummary & {
  readonly history: Company['history'];
} {
  return { ...toCompanySummary(company), history: company.history };
}

export interface FlatPosition {
  readonly title: string;
  readonly url: string | null;
  readonly postedDate: string | null;
  readonly detectedKeywords: readonly string[];
  readonly companyId: string;
  readonly companyName: string;
  readonly companyWebsite: string | null;
  readonly careersUrl: string | null;
  readonly country: string | null;
  readonly remotePolicy: string | null;
  /**
   * How this row survived a keyword filter: `position` when the role's own
   * title or detected keywords matched, `company` when only the company record
   * did (so the role is context, not a hit), null when no keyword was given.
   */
  readonly matchedVia: 'position' | 'company' | null;
}

function positionMatches(opening: Opening, tokens: readonly string[]): boolean {
  const title = opening.title.toLowerCase();
  return tokens.some(
    (token) =>
      title.includes(token) ||
      opening.detectedKeywords.some((k) => k.toLowerCase().includes(token)),
  );
}

/**
 * Flatten every open role of the already-filtered companies, annotating each
 * with the company fields an agent needs to act on it without a second call.
 *
 * Keyword handling is two-stage on purpose: the company-level filter has
 * already run through the shared scorer, so a company tagged `react` is in the
 * set even when no individual role says "react". Rather than drop those roles
 * (losing real leads) or present them as React roles (a lie), they are kept and
 * labelled, and direct role-level hits sort first.
 */
export function flattenPositions(
  scored: readonly ScoredCompany[],
  keyword: string | null,
): FlatPosition[] {
  const tokens = keyword === null ? [] : tokenize(keyword);
  const positions: FlatPosition[] = [];

  for (const { company } of scored) {
    for (const opening of company.currentOpenings) {
      positions.push({
        title: opening.title,
        url: opening.url,
        postedDate: opening.postedDate,
        detectedKeywords: opening.detectedKeywords,
        companyId: company.id,
        companyName: company.name,
        companyWebsite: company.website,
        careersUrl: company.careersUrl,
        country: company.country,
        remotePolicy: company.remotePolicy,
        matchedVia:
          tokens.length === 0 ? null : positionMatches(opening, tokens) ? 'position' : 'company',
      });
    }
  }

  // Direct role hits first; otherwise preserve the company relevance order,
  // which `flattenPositions` inherits from its already-sorted input.
  if (tokens.length > 0) {
    positions.sort((a, b) => {
      const rank = (p: FlatPosition): number => (p.matchedVia === 'position' ? 0 : 1);
      return rank(a) - rank(b);
    });
  }

  return positions;
}
