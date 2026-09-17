/**
 * Technology keywords from free job text.
 *
 * Every tag this produces ends up in `detectedKeywords` and in the weekly
 * `keywordCounts` history, so a false positive is not cosmetic — it shows up as
 * a company "hiring for Go" that never mentioned Go. The matching is therefore
 * deliberately literal: only the surface forms configured in
 * `research.config.json` count, matched as whole tokens, with the handful of
 * everyday-English collisions scrubbed first.
 *
 * Nothing here is inferred. If the text does not contain a configured surface
 * form, no tag is emitted.
 */

/** Openings carry at most this many tags; more is noise in the UI. */
const MAX_KEYWORDS = 8;

/**
 * Compiled patterns are cached per vocabulary object. The vocabulary comes from
 * a config file read once per run, so this is a single compile per process
 * rather than one per job posting.
 */
const compiled = new WeakMap();

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

/**
 * Phrases where a surface form appears in its ordinary English (or Dutch, or
 * German) sense. They are blanked out space-for-space, so offsets and token
 * boundaries survive, before matching. That is far easier to reason about than
 * bolting ever-more-baroque lookarounds onto each pattern.
 *
 * Every entry here was added because a real posting produced a wrong tag, not
 * on speculation: "you'll go through the interview rounds" read as Go, and
 * "een breed scala aan functionaliteiten" read as Scala.
 */
const FALSE_FRIENDS = [
  // "go" as the English verb, guarded on both sides. The language is written
  // "Go developer", "in Go", "migrating to Go", "Go/Rust" - it is never
  // followed by a particle and never preceded by a subject or a modal. Note
  // what is deliberately absent from the preceding list: "to", because
  // "migrating to Go" is exactly the sentence we want to keep.
  /go[-\s]?to[-\s]?market/gi,
  /\b(?:we|you|they|i|it|will|would|can|could|must|should|may|might|let|lets|ready|willing|able|just|then|now|never|always|who|that|things|ll|re)\s+go\b/gi,
  /\bgo\b\s+(?:through|to|into|about|over|on|off|out|up|down|back|ahead|along|away|live|public|global|remote|beyond|deep|wrong|home|further|above|straight|directly|the|a|an)\b/gi,
  /\bguard[-\s]?rails\b/gi, // not Ruby on Rails
  /\bphoenix,\s*(?:az|arizona)\b/gi, // the city, not the Elixir framework
  /\b(?:worker|compute|control[-\s]plane|graph|leaf|edge|single)\s+nodes?\b/gi,
  /\bnodes?\s+(?:pool|group|affinity|failure)\b/gi,
  /\bswift\s?code\b/gi, // the banking identifier, not the language
  /\bjava\s+script\b/gi, // spelled apart this is JavaScript, not Java
  // Dutch "scala" means "range"; these boards are multilingual.
  /\b(?:breed|ruim|groot|volledig|heel|een)\s+scala\b/gi,
  /\bscala\s+(?:aan|van)\b/gi,
];

/**
 * Word boundaries, hand-rolled twice over.
 *
 * `\b` is wrong here for two independent reasons. Half the vocabulary is
 * punctuation - `\bc#\b` never matches, because there is no boundary after
 * "#", and `\b\.net\b` never matches inside "ASP.NET". And `\w` is
 * ASCII-only, so in a German posting `\bts\b` happily matches the tail of
 * "Qualitaets-" (observed on a live Personio board), because the umlaut before
 * it is not a word character. So the classes below are Unicode letter/number
 * classes plus "#" and "+", which are part of a token: "c++" must not match
 * inside "c+++".
 *
 * A form that *starts* with "." is the exception - it is allowed to follow a
 * letter, which is what makes ".net" findable in "ASP.NET" while a trailing "/"
 * still rules out a hostname like "example.net/jobs".
 */
const WORD_CHAR = '\\p{L}\\p{N}_#+';

function boundedPattern(form) {
  const body = form.replace(REGEX_META, '\\$&');
  const left = /^[\p{L}\p{N}]/u.test(form) ? `(?<![${WORD_CHAR}])` : '(?<![#+])';
  const right = form.startsWith('.') ? `(?![${WORD_CHAR}/])` : `(?![${WORD_CHAR}])`;
  return `${left}${body}${right}`;
}

/**
 * @param {Record<string, string[]>} vocabulary canonical tag -> surface forms
 * @returns {{ tag: string, regex: RegExp }[]} in vocabulary declaration order
 */
function patternsFor(vocabulary) {
  const cached = compiled.get(vocabulary);
  if (cached !== undefined) return cached;

  const entries = [];
  for (const [tag, forms] of Object.entries(vocabulary)) {
    // The config file carries "$comment" keys alongside the real entries.
    if (!Array.isArray(forms)) continue;

    const parts = forms
      .filter((form) => typeof form === 'string' && form.trim() !== '')
      .map((form) => form.trim().toLowerCase())
      // Longest first so "react.js" is consumed before the bare "react".
      .sort((a, b) => b.length - a.length)
      .map(boundedPattern);

    if (parts.length === 0) continue;
    entries.push({ tag, regex: new RegExp(parts.join('|'), 'iu') });
  }

  compiled.set(vocabulary, entries);
  return entries;
}

function scrub(text) {
  let out = text;
  for (const phrase of FALSE_FRIENDS) {
    out = out.replace(phrase, (match) => ' '.repeat(match.length));
  }
  return out;
}

/** Tags present in `text`, in vocabulary order so a rerun gives the same list. */
function tagsIn(text, vocabulary) {
  if (typeof text !== 'string' || text === '') return [];
  const haystack = scrub(text);
  const found = [];
  for (const { tag, regex } of patternsFor(vocabulary)) {
    if (regex.test(haystack)) found.push(tag);
  }
  return found;
}

/**
 * Canonical tags mentioned in `text`, deduped, capped at 8.
 * @param {string} text
 * @param {Record<string, string[]>} vocabulary
 * @returns {string[]}
 */
export function extractKeywords(text, vocabulary) {
  if (vocabulary === null || typeof vocabulary !== 'object') return [];
  return tagsIn(text, vocabulary).slice(0, MAX_KEYWORDS);
}

/**
 * Tags for one posting. A title is a curated summary and a description is a
 * wall of boilerplate, so title hits are kept first and survive the trim: a
 * "Senior Go Engineer" whose description name-drops eight other stacks should
 * still read as a Go role.
 *
 * @param {{ title?: string, description?: string }} position
 * @param {Record<string, string[]>} vocabulary
 * @returns {string[]}
 */
export function extractFromPosition({ title, description } = {}, vocabulary) {
  if (vocabulary === null || typeof vocabulary !== 'object') return [];

  const fromTitle = tagsIn(title ?? '', vocabulary);
  if (fromTitle.length >= MAX_KEYWORDS) return fromTitle.slice(0, MAX_KEYWORDS);

  const seen = new Set(fromTitle);
  const fromBody = tagsIn(description ?? '', vocabulary).filter((tag) => !seen.has(tag));

  return [...fromTitle, ...fromBody].slice(0, MAX_KEYWORDS);
}
