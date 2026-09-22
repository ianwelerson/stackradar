import { decodeEntities } from './ats/util.mjs';

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
  // "https://starbridge.ai/ Starbridge is building…" — an HN post opening on
  // the company's own link, with the real sentence right behind it.
  /^https?:\/\/\S+\s+/i,
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
 * Signals that a text is a job posting rather than a description of the
 * company. Measured on the dataset, not imagined: every pattern here matched a
 * real record that reached the directory — "Keeper is hiring a driven, Arabic
 * speaking Channel Account Manager…", "New York, NY URL: https://…",
 * "Developer Relations Lead (remote US): https://jobs.ashbyhq.com/…".
 *
 * Hacker News and We Work Remotely hand over the body of a post, and a post is
 * written to a candidate. Stripping furniture cannot rescue those: the whole
 * text is about one role, so it is refused and the company's own homepage is
 * asked instead (see metaDescriptionOf).
 *
 * Deliberately narrow. "Ashby … powering hiring at the world's most innovative
 * companies" and "Data-driven teacher hiring" describe what a company *does*
 * and must pass, so a bare "hiring" is never enough on its own.
 */
const JOB_AD_SIGNALS = [
  /https?:\/\//i,
  /\bURL:/,
  /\b(?:we(?:['’]re| are)|i['’]m|i am|is|are)\s+(?:currently\s+|now\s+|actively\s+)?(?:hiring|looking for|seeking|recruiting)\b/i,
  /^hiring\b/i,
  /\bhiring\s+(?:a|an|for|\d+|~\d+)\b/i,
  /\bto join (?:our|the)\b/i,
  /\b(?:compensation|salary|reports to|apply (?:at|here|now|via))\b/i,
  /\$\d{2,3}(?:,\d{3}|k)\b/i,
  /^remote\b/i,
  /\((?:remote|on-?site|hybrid)\b/i,
  // A post's own sections, and first-person prose from whoever wrote it.
  /\b(?:key requirements|requirements|responsibilities|qualifications|about the role):/i,
  /^i\s/i,
];

/** True when the text reads as a job posting rather than a company description. */
export function looksLikeJobAd(text) {
  if (typeof text !== 'string') return false;
  return JOB_AD_SIGNALS.some((pattern) => pattern.test(text));
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
  if (looksLikeJobAd(t)) return '';

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

/** Homepages inline megabytes of app state; the <head> is near the top. */
const MAX_HEAD_BYTES = 400_000;

/** Meta names in order of preference: the social card is usually written most carefully. */
const META_KEYS = ['og:description', 'description', 'twitter:description'];

/** Placeholder text some site builders ship as the description. */
const PLACEHOLDER = /^(?:home|homepage|welcome|index|untitled|description|default)\b/i;

/**
 * The company's own description of itself, read from its homepage's meta tags,
 * cleaned to directory length — or '' when the page offers nothing usable.
 *
 * This is the one honest replacement for a description a source got wrong: the
 * words are the company's own, chosen for exactly this job (a one-line summary
 * shown beside its name), and nothing is paraphrased on the way through.
 *
 * @param {string} html
 * @param {string} [name]
 * @returns {string}
 */
export function metaDescriptionOf(html, name) {
  if (typeof html !== 'string' || html === '') return '';
  const head = html.slice(0, MAX_HEAD_BYTES);

  const found = new Map();
  for (const tag of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const attr of tag[0].matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? '';
    }
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (META_KEYS.includes(key) && !found.has(key) && typeof attrs.content === 'string') {
      found.set(key, attrs.content);
    }
  }

  for (const key of META_KEYS) {
    const raw = found.get(key);
    if (raw === undefined) continue;
    const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
    if (text.length < 20 || PLACEHOLDER.test(text)) continue;
    if (name !== undefined && text.toLowerCase() === String(name).toLowerCase()) continue;
    const cleaned = cleanDescription(text, name);
    if (cleaned !== '') return cleaned;
  }
  return '';
}
