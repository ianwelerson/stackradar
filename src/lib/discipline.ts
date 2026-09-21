/**
 * What kind of work a role actually is.
 *
 * `categorize.ts` groups a single company's roles for display and is happy to
 * leave things in "Other"; on the whole dataset that bucket is 47% of titles,
 * which makes it useless as a filter — "Account Executive" and "Customer
 * Success Manager" land there and show up in a search for engineering work.
 *
 * This module answers one narrower question well: is this a role somebody who
 * writes software would apply for? Two design rules follow from that:
 *
 * 1. **Non-engineering signals are tested first.** "Sales Engineer",
 *    "Customer Success Engineer" and "Solutions Engineer" all contain the word
 *    "engineer" and none of them are development jobs. A title's strongest
 *    signal is whatever names the function, not whichever word appears.
 * 2. **`other` means unsure, and is never quietly treated as engineering.** A
 *    filter that guesses wrong in the inclusive direction reproduces the bug it
 *    was built to fix.
 *
 * Patterns run against dataset titles, never user input.
 */

export type Discipline =
  | 'engineering'
  | 'data-ml'
  | 'design'
  | 'product'
  | 'devrel'
  | 'go-to-market'
  | 'support'
  | 'people-finance'
  | 'other';

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  engineering: 'Engineering',
  'data-ml': 'Data & ML',
  design: 'Design',
  product: 'Product',
  devrel: 'DevRel & Docs',
  'go-to-market': 'Sales & Marketing',
  support: 'Support & Success',
  'people-finance': 'People & Finance',
  other: 'Other',
};

/** Disciplines a software engineer is plausibly looking for. */
export const TECHNICAL: readonly Discipline[] = ['engineering', 'data-ml'];

/**
 * Ordered: the first match wins, so the most specific and most misleading
 * cases are listed before the broad "engineer" catch.
 */
const RULES: readonly { pattern: RegExp; discipline: Discipline }[] = [
  // Customer-facing and commercial roles that borrow engineering job titles.
  {
    pattern:
      /\b(account (executive|manager|director)|sales|seller|quota|business development|partnerships?|revenue|growth marketer|demand generation|gtm|go.to.market)\b/i,
    discipline: 'go-to-market',
  },
  {
    pattern: /\b(customer success|customer experience|solutions? (engineer|architect|consultant)|implementation|onboarding specialist|technical account)\b/i,
    discipline: 'support',
  },
  {
    pattern:
      /\b(marketing|marketer|brand|communications?|content (strategist|writer)|seo|social media|community manager|events?|growth lead|market manager|deal desk)\b/i,
    discipline: 'go-to-market',
  },
  {
    // `recruit\w*` rather than `\brecruit\b`: the actual titles are "Recruiter"
    // and "Technical Recruiter", which a closing word boundary never matches.
    pattern:
      /\b(recruit\w*|talent|people ops|people partner|head of people|employee programs?|human resources|\bhr\b|compensation|finance|fp&a|accountant|accounting|controller|payroll|legal|counsel|compliance officer|office manager|executive assistant|chief of staff)\b/i,
    discipline: 'people-finance',
  },
  {
    pattern:
      /\b(support (engineer|specialist|associate)|technical support|product support|helpdesk|help desk|service desk)\b/i,
    discipline: 'support',
  },
  // Adjacent technical work, before the generic engineering catch.
  {
    pattern:
      /\b(developer relations|devrel|developer advocate|technical writer|technical writing|documentation|docs engineer)\b/i,
    discipline: 'devrel',
  },
  {
    pattern:
      /\b(data (scientist|engineer|analyst|platform)|machine learning|\bml\b|\bai\b|research (scientist|engineer)|analytics engineer|applied scientist|nlp|computer vision)\b/i,
    discipline: 'data-ml',
  },
  {
    pattern:
      /\b(product design|ux|user experience|visual design|brand design|graphic design|head of design|\bdesigner\b)\b/i,
    discipline: 'design',
  },
  {
    pattern:
      /\b(product (manager|owner|lead|operations)|group product|\bpm\b|technical program manager|program manager|project manager)\b/i,
    discipline: 'product',
  },
  // The broad engineering catch, reached only once the above have had a look.
  {
    pattern:
      /\b(engineer|engineering|developer|programmer|architect|\bsre\b|devops|infrastructure|platform|backend|back.end|frontend|front.end|full.?stack|mobile|ios|android|security|qa|quality assurance|test automation|cto|technical lead|tech lead|staff software|principal software)\b/i,
    discipline: 'engineering',
  },
];

/** The discipline a role title belongs to. `other` when nothing matched. */
export function disciplineOf(title: string): Discipline {
  if (typeof title !== 'string') return 'other';
  for (const rule of RULES) {
    if (rule.pattern.test(title)) return rule.discipline;
  }
  return 'other';
}

/** True when the role is one a software engineer would plausibly apply for. */
export function isTechnical(title: string): boolean {
  return (TECHNICAL as readonly string[]).includes(disciplineOf(title));
}
