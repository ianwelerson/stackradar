/**
 * localStorage access, defensively wrapped.
 *
 * Every accessor can throw — private windows, disabled site data, embedded
 * previews — so reads and writes are guarded and fall back to in-memory
 * behaviour rather than breaking the page.
 */

const PREFIX = 'stackradar.';

export function readLocal<T>(key: string, parse: (raw: unknown) => T | null): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return null;
    return parse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota exceeded or storage disabled — non-fatal */
  }
}

export function removeLocal(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* non-fatal */
  }
}
