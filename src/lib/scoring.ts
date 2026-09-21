import type { Company } from '../types/company.js';

/**
 * Keyword relevance scoring — the single implementation, shared by the UI, the
 * public JSON API and (later) the MCP server. Do not reimplement it anywhere.
 *
 * Weighting follows spec §5: a name match ranks highest, then curated keywords
 * and keywords detected on open roles, then substring hits in the description
 * or a role title. Location is scored below all of those; it is primarily a
 * filter dimension, but matching it in free text makes queries like "estonia"
 * behave the way people expect.
 *
 * Signature takes an already-tokenized array rather than a raw string so that
 * callers with structured input — an MCP tool handed a list of skills, say —
 * can use it without round-tripping through query syntax.
 */

export const WEIGHTS = {
  name: 1.0,
  keyword: 0.8,
  openingKeyword: 0.8,
  openingTitle: 0.5,
  description: 0.5,
  location: 0.4,
} as const;

export interface ScoreResult {
  /** 0–100, normalized against the number of query tokens. */
  readonly score: number;
  /** Human-readable reasons, shown as a tooltip on the match bar. */
  readonly reasons: readonly string[];
}

/**
 * Split free text into lowercase search terms.
 *
 * Terms are separated by commas (or semicolons), NOT by spaces, so a
 * multi-word term stays intact: "Go, Postgres, design engineer" is three terms,
 * and the last one only matches an actual design-engineering role rather than
 * every company with the word "engineer" somewhere. Splitting on whitespace
 * made that query match nearly the whole index, which is the opposite of what
 * someone typing a specific role wants.
 *
 * Deliberately uses split-on-separator rather than building a RegExp from user
 * input — user-supplied patterns are never compiled anywhere in this codebase,
 * which keeps ReDoS off the table entirely.
 *
 * `splitTerms` keeps the user's original casing, for rendering each term back
 * as its own removable filter pill; `tokenize` lowercases the same terms for
 * matching. Both share one definition of where a term ends, so what the UI
 * shows can never drift from what actually gets searched.
 */
export function splitTerms(input: string): string[] {
  return input
    .split(/[,;]+/)
    // Collapse internal runs of whitespace so "design   engineer" still matches.
    .map((term) => term.trim().replace(/\s+/g, ' '))
    .filter((term) => term.length > 0)
    .slice(0, 12); // bound the work per query
}

export function tokenize(input: string): string[] {
  return splitTerms(input).map((term) => term.toLowerCase());
}

/**
 * Characters that continue a word. `+` and `#` are included so "c++" and "c#"
 * are single terms; `.` is not, so "node.js" is reachable by "node" and by
 * "js" — both of which people type.
 */
function isWordChar(char: string): boolean {
  return char !== '' && /[a-z0-9+#]/.test(char);
}

/**
 * Whole-term containment.
 *
 * Plain substring matching looked fine on company names and fell apart the
 * moment roles were searchable: the term "r" appeared in 2,955 of 3,126 role
 * titles — every "Engineer" — and "go" matched Ridango, Algolia and
 * "Go-to-Market". A 90% match on a term the role does not use is worse than no
 * score at all, because the number is what the reader trusts.
 *
 * Deliberately scanned by hand rather than with a RegExp: nothing in this
 * codebase compiles a pattern from user input, which is what keeps ReDoS off
 * the table entirely. The fixed single-character test above is not user input.
 *
 * Synonyms are not this function's job and do not need to be — "golang" is
 * normalised to the `go` keyword by the update script, so a Go role matches the
 * term through its structured keywords rather than through a lucky substring.
 */
export function containsTerm(haystack: string | null | undefined, needle: string): boolean {
  if (typeof haystack !== 'string' || needle === '') return false;
  const hay = haystack.toLowerCase();

  let index = hay.indexOf(needle);
  while (index !== -1) {
    const before = index === 0 ? '' : hay[index - 1] ?? '';
    const afterIndex = index + needle.length;
    const after = afterIndex >= hay.length ? '' : hay[afterIndex] ?? '';
    if (!isWordChar(before) && !isWordChar(after)) return true;
    index = hay.indexOf(needle, index + 1);
  }
  return false;
}

/**
 * Score one company against pre-tokenized query terms.
 * Returns null when nothing matched, so callers can filter non-matches out.
 */
const contains = containsTerm;

export function scoreCompany(company: Company, tokens: readonly string[]): ScoreResult | null {
  if (tokens.length === 0) return null;

  let total = 0;
  const reasons: string[] = [];

  for (const token of tokens) {
    // Highest signal first; each token contributes at most once.
    if (contains(company.name, token)) {
      total += WEIGHTS.name;
      reasons.push('name match');
      continue;
    }

    const keyword = company.keywords.find((k) => k.toLowerCase().includes(token));
    if (keyword !== undefined) {
      total += WEIGHTS.keyword;
      reasons.push(`${keyword} listed`);
      continue;
    }

    const byOpeningKeyword = company.currentOpenings.find((o) =>
      o.detectedKeywords.some((k) => k.toLowerCase().includes(token)),
    );
    if (byOpeningKeyword !== undefined) {
      total += WEIGHTS.openingKeyword;
      reasons.push(`open role: ${byOpeningKeyword.title}`);
      continue;
    }

    const byOpeningTitle = company.currentOpenings.find((o) => contains(o.title, token));
    if (byOpeningTitle !== undefined) {
      total += WEIGHTS.openingTitle;
      reasons.push(`open role: ${byOpeningTitle.title}`);
      continue;
    }

    if (contains(company.description, token)) {
      total += WEIGHTS.description;
      reasons.push('description match');
      continue;
    }

    const location = [company.country, company.hqLocation, ...company.remoteRegions]
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
    if (contains(location, token)) {
      total += WEIGHTS.location;
      reasons.push('location match');
    }
  }

  if (total === 0) return null;

  return {
    score: Math.min(100, Math.round((total / tokens.length) * 100)),
    // De-duplicate while preserving order, then cap for display.
    reasons: [...new Set(reasons)].slice(0, 4),
  };
}

export interface ScoredCompany {
  readonly company: Company;
  readonly match: ScoreResult | null;
}

/**
 * Score a dataset against a raw query string.
 * With an empty query every company is returned unscored; with a query,
 * non-matching companies are dropped.
 */
export function searchCompanies(
  companies: readonly Company[],
  query: string,
): ScoredCompany[] {
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    return companies.map((company) => ({ company, match: null }));
  }

  const results: ScoredCompany[] = [];
  for (const company of companies) {
    const match = scoreCompany(company, tokens);
    if (match !== null) results.push({ company, match });
  }
  return results;
}
