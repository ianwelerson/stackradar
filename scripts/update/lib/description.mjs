/**
 * Tidying a company description without inventing one.
 *
 * Descriptions arrive from five sources and two of them hand over something
 * that is not really a description at all:
 *
 *   - We Work Remotely's RSS body starts with the office line and a section
 *     heading — "Headquarters: Serbia - Remote About Smartcat Smartcat is
 *     building…" — so the useful sentence is buried a third of the way in.
 *   - Hacker News "Who is hiring?" prose is written to a reader of that thread,
 *     not to a directory: "Hiring: 2 Engineers + Director of Sales", "Please
 *     note: working proficiency in Dutch is strictly required".
 *
 * Everything here only ever *removes* text. Nothing paraphrases, and nothing is
 * generated — a description that cannot be salvaged is better handled by
 * re-reading the company's own `og:description` than by writing one for them.
 *
 * The length cap exists because the directory card gives a description two
 * lines beside the company's keyword tags; a 200-character blob pushed the tags
 * out of view and stretched every other card in its grid row to match.
 */

/** Roughly two lines on a directory card at its narrowest column. */
export const MAX_DESCRIPTION = 140;

/** Don't cut so early that the remainder says nothing. */
const MIN_USEFUL = 60;

/** Feed and thread furniture that precedes the real sentence. */
const LEADING_NOISE = [
  /^headquarters:\s*[^.]{0,60}?(?=\b(?:about\b|company overview\b|overview\b|at\s+[A-Z]|[A-Z][\w.&'-]*\s+(?:is|are|was|creates|builds|makes|helps|provides|powers)\b))/i,
  /^headquarters:\s*/i,
  /^(?:about us|company overview|overview)[:\s—-]*/i,
  /^hiring:?\s*[^.]{0,80}?(?=\b[A-Z][\w.&'-]*\s+(?:is|are|was|creates|builds|makes|helps|provides|powers)\b)/i,
  /^please note[:\s][^.]{0,200}\.\s*/i,
];

function stripLeadingNoise(text, name) {
  let t = text;

  // "About Smartcat" — the heading naming the company itself.
  const escaped = String(name ?? '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = escaped === ''
    ? LEADING_NOISE
    : [...LEADING_NOISE, new RegExp(`^about\\s+${escaped}[:\\s—-]*`, 'i')];

  // Two passes: the office line and the heading that follows it are separate
  // prefixes, and stripping the first exposes the second.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const pattern of patterns) {
      const next = t.replace(pattern, '');
      if (next !== t) t = next.trim();
    }
  }
  return t;
}

/**
 * A short, clean description, or '' when the input yields nothing usable.
 *
 * @param {unknown} text
 * @param {string} [name] the company's name, so "About <Name>" can be stripped
 * @returns {string}
 */
export function cleanDescription(text, name) {
  if (typeof text !== 'string') return '';

  let t = stripLeadingNoise(text.replace(/\s+/g, ' ').trim(), name);
  if (t === '') return '';

  if (t.length <= MAX_DESCRIPTION) return t;

  // A sentence boundary is the only cut that reads as deliberate.
  const window = t.slice(0, MAX_DESCRIPTION + 40);
  const sentenceEnd = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
  );
  if (sentenceEnd >= MIN_USEFUL) return window.slice(0, sentenceEnd + 1).trim();

  // Otherwise cut on a word boundary and mark it, so a clipped phrase never
  // reads as the company's own full sentence.
  const cut = t.slice(0, MAX_DESCRIPTION);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace >= MIN_USEFUL ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s,;:—–-]+$/, '')}…`;
}
