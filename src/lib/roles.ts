import type { Company, Opening } from '../types/company.js';
import type { ScoreResult } from './scoring.js';
import { WEIGHTS, containsTerm as contains } from './scoring.js';

/**
 * Searching open roles rather than companies.
 *
 * The directory's other view answers "which companies suit me"; this one
 * answers "which jobs suit me", which is a different question with a different
 * unit. A company that matches your stack across twenty roles is one row over
 * there and twenty rows here, and only one of those is useful when you are
 * actually applying.
 *
 * Scoring deliberately mirrors `scoreCompany` — the same weights, the same
 * 0–100 normalisation, the same "null means no match" contract — so a 60% here
 * means what a 60% means there. What changes is where a term may be found: the
 * role's own title and detected stack rank above anything about its employer,
 * because you are picking the role.
 */

export interface ScoredRole {
  readonly company: Company;
  readonly opening: Opening;
  readonly match: ScoreResult | null;
}

/**
 * Score one opening against pre-tokenized terms.
 *
 * Returns null when nothing matched, so an unmatched role can be dropped rather
 * than shown at zero — and, as with companies, so that an empty query yields
 * every role unranked instead of no roles at all.
 */
export function scoreRole(
  company: Company,
  opening: Opening,
  tokens: readonly string[],
): ScoreResult | null {
  if (tokens.length === 0) return null;

  let total = 0;
  const reasons: string[] = [];

  for (const token of tokens) {
    let best = 0;

    // The structured stack outranks the title here, which is the one place this
    // deliberately differs from scoreCompany. A term in `detectedKeywords` was
    // extracted from the posting's own text against a controlled vocabulary; the
    // same term in a title may be an unrelated word that happens to collide —
    // "Go-to-Market Engineer" contains "go" and always will. Ranking the
    // structured signal higher puts real Go roles above it, which is the part
    // that actually matters to someone scanning the list.
    if (opening.detectedKeywords.some((keyword) => keyword.toLowerCase() === token)) {
      best = Math.max(best, WEIGHTS.name);
      reasons.push(`${token} — in this role's stack`);
    } else if (contains(opening.title, token)) {
      best = Math.max(best, WEIGHTS.openingKeyword);
      reasons.push(`${token} — in the role title`);
    } else if (company.keywords.some((keyword) => keyword.toLowerCase() === token)) {
      best = Math.max(best, WEIGHTS.keyword);
      reasons.push(`${token} — in ${company.name}'s stack`);
    } else if (contains(company.name, token)) {
      best = Math.max(best, WEIGHTS.name);
      reasons.push(`${token} — the company name`);
    } else if (contains(opening.location, token) || contains(company.country, token)) {
      best = Math.max(best, WEIGHTS.location);
      reasons.push(`${token} — location`);
    } else if (contains(company.description, token)) {
      best = Math.max(best, WEIGHTS.description);
      reasons.push(`${token} — in the company description`);
    }

    total += best;
  }

  if (total === 0) return null;

  // Normalised against a perfect score for this many terms, so the number means
  // "how much of what you asked for does this role have".
  const score = Math.round((total / (tokens.length * WEIGHTS.name)) * 100);
  return { score: Math.min(score, 100), reasons };
}

/**
 * Flatten companies into their open roles, scored.
 *
 * With no tokens every role comes back unscored — the honest unfiltered list —
 * rather than an empty one.
 */
export function searchRoles(
  companies: readonly Company[],
  tokens: readonly string[],
): ScoredRole[] {
  const out: ScoredRole[] = [];

  for (const company of companies) {
    for (const opening of company.currentOpenings) {
      if (tokens.length === 0) {
        out.push({ company, opening, match: null });
        continue;
      }
      const match = scoreRole(company, opening, tokens);
      if (match !== null) out.push({ company, opening, match });
    }
  }

  return out;
}

export const ROLE_SORTERS: Record<string, (a: ScoredRole, b: ScoredRole) => number> = {
  relevance: (a, b) =>
    (b.match?.score ?? 0) - (a.match?.score ?? 0) ||
    postedTime(b) - postedTime(a) ||
    a.opening.title.localeCompare(b.opening.title),
  // Roles with no posted date sort last: null is not "today".
  openings: (a, b) => postedTime(b) - postedTime(a) || a.opening.title.localeCompare(b.opening.title),
  verified: (a, b) => postedTime(b) - postedTime(a) || a.opening.title.localeCompare(b.opening.title),
  name: (a, b) =>
    a.company.name.localeCompare(b.company.name) || a.opening.title.localeCompare(b.opening.title),
};

function postedTime(entry: ScoredRole): number {
  return entry.opening.postedDate === null ? -Infinity : Date.parse(entry.opening.postedDate);
}
