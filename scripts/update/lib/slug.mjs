/**
 * Stable ids, and matching an incoming company against ones already held.
 *
 * `id` is the merge key for the whole dataset, so it must be derived
 * deterministically and must not change once assigned. Duplicate detection is
 * deliberately conservative: a wrong match silently merges two real companies
 * into one, which is far worse than briefly holding a duplicate a human can spot.
 */

export function toSlug(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function rootDomain(url) {
  if (typeof url !== 'string' || url === '') return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const parts = host.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : host;
  } catch {
    return null;
  }
}

const normalizeName = (name) =>
  name.toLowerCase().replace(/\b(inc|ltd|oü|as|gmbh|bv|llc|labs|technologies|group)\b/g, '').replace(/[^a-z0-9]/g, '');

/**
 * Find an existing company that the candidate almost certainly already is.
 * Domain match is authoritative; name match only counts on an exact
 * normalized equality, never a fuzzy one.
 */
export function findExisting(companies, candidate) {
  const domain = rootDomain(candidate.website);
  if (domain !== null) {
    const byDomain = companies.find((c) => rootDomain(c.website) === domain);
    if (byDomain !== undefined) return { company: byDomain, matchedOn: 'domain' };
  }

  const slug = toSlug(candidate.name);
  const bySlug = companies.find((c) => c.id === slug);
  if (bySlug !== undefined) return { company: bySlug, matchedOn: 'id' };

  const norm = normalizeName(candidate.name);
  if (norm.length >= 4) {
    const byName = companies.find((c) => normalizeName(c.name) === norm);
    if (byName !== undefined) return { company: byName, matchedOn: 'name' };
  }

  return null;
}

/** Allocate an id that is not already taken. */
export function allocateId(companies, name) {
  const base = toSlug(name) || 'company';
  if (!companies.some((c) => c.id === base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!companies.some((c) => c.id === candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
