import type { Opening } from '@/types/company';

export const ALL_ROLES = 'All roles';

/**
 * Bucket a role title into a coarse discipline, mirroring the prototype's
 * ordering — the sequence matters, since "Docs Engineer" must be caught by the
 * docs rule before the broad "engineer" rule claims it.
 *
 * These patterns run against dataset titles, never user input.
 */
const RULES: readonly { pattern: RegExp; category: string }[] = [
  {
    pattern: /recruit|people|talent|\bhr\b|marketing|sales|finance|operations lead/i,
    category: 'Non-engineering',
  },
  {
    pattern: /docs|technical writ|developer relations|devrel|support|content/i,
    category: 'Docs & DevRel',
  },
  {
    pattern: /frontend|front-end|design engineer|editor|console|dashboard|\bui\b|react/i,
    category: 'Frontend',
  },
  {
    pattern: /\bsre\b|infra|platform|kubernetes|reliability|network|devops|runtime|performance/i,
    category: 'Infra & SRE',
  },
  {
    pattern: /backend|back-end|systems|ledger|\bapi\b|queue|data|media|full-stack|fullstack|engineer/i,
    category: 'Backend',
  },
];

export function categorize(title: string): string {
  for (const rule of RULES) {
    if (rule.pattern.test(title)) return rule.category;
  }
  return 'Other';
}

export interface CategorizedOpening extends Opening {
  readonly category: string;
}

export function categorizeAll(openings: readonly Opening[]): CategorizedOpening[] {
  return openings.map((opening) => ({ ...opening, category: categorize(opening.title) }));
}

export function categoriesOf(openings: readonly CategorizedOpening[]): string[] {
  return [ALL_ROLES, ...new Set(openings.map((o) => o.category))];
}
