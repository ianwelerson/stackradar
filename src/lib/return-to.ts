/**
 * Remembering the directory view a reader came from.
 *
 * Filter state already lives in the query string, so the browser's own Back
 * button restores it. What it did not survive was the "← all companies" link on
 * a company page, which pointed at a bare `/` and silently threw away a search
 * the reader had just built.
 *
 * sessionStorage rather than link state: it is per-tab, so it cannot leak one
 * reader's filters into another context, and unlike router state it still holds
 * after a reload on the company page itself — which is exactly when someone is
 * most likely to reach for the back link rather than the Back button.
 *
 * Every accessor is guarded the same way `local-storage.ts` guards its own:
 * private windows and blocked site data throw on access, and losing a
 * convenience must never break the page.
 */

const KEY = 'stackradar.directory-search';

/** Longer than any filter combination the UI can produce; a pathological
 *  stored value should not come back as a giant href. */
const MAX_SEARCH_LENGTH = 400;

/**
 * Record the directory's current query string. Called as the directory
 * renders, so the stored value always reflects the last view actually seen.
 */
export function rememberDirectorySearch(search: string): void {
  try {
    if (search === '') window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, search.slice(0, MAX_SEARCH_LENGTH));
  } catch {
    /* storage disabled — the link just falls back to an unfiltered directory */
  }
}

/**
 * Href for a link back to the directory, carrying the remembered filters.
 * Falls back to `/` whenever nothing is stored or storage is unavailable, so a
 * reader arriving from outside gets the plain index rather than an error.
 */
export function directoryHref(): string {
  try {
    const stored = window.sessionStorage.getItem(KEY);
    if (stored === null || stored === '') return '/';
    // Only ever a query string. A stored value that is not one is discarded
    // rather than concatenated, so this can never build a path — let alone an
    // absolute or cross-origin URL — out of storage contents.
    if (!stored.startsWith('?') || stored.includes('/') || stored.includes('\\')) return '/';
    return `/${stored.slice(0, MAX_SEARCH_LENGTH)}`;
  } catch {
    return '/';
  }
}
