/**
 * Upstash Redis REST client — bring-your-own storage.
 *
 * Security model, and the reasoning behind it:
 *
 * - Credentials live only in this browser's localStorage. They are never sent
 *   to any origin except the user's own Upstash host, never logged, and never
 *   included in error messages or telemetry. This app has no server that could
 *   receive them.
 * - The REST URL is constrained to https and to an `*.upstash.io` host. A REST
 *   token is a bearer credential with full read/write access to that database,
 *   so the destination must not be arbitrary: without this check a mistyped or
 *   socially-engineered URL would send the token to whatever host was pasted.
 * - Keys are namespaced and the user-supplied portion is strictly validated,
 *   so a crafted company id cannot traverse into unrelated keys.
 * - Values are written as JSON and parsed defensively on read; anything that
 *   fails to parse is discarded rather than trusted.
 */

export interface UpstashCredentials {
  readonly url: string;
  readonly token: string;
}

export class UpstashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstashError';
  }
}

const KEY_NAMESPACE = 'stackradar';
const SAFE_KEY_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Validate a pasted REST URL. Returns a normalized origin, or throws. */
export function normalizeRestUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') throw new UpstashError('Enter your REST URL.');

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UpstashError(
      'That does not look like a URL. Copy the full UPSTASH_REDIS_REST_URL from the Upstash console.',
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new UpstashError('The REST URL must start with https://');
  }

  if (parsed.hostname !== 'upstash.io' && !parsed.hostname.endsWith('.upstash.io')) {
    throw new UpstashError(
      'That host is not an Upstash endpoint. The REST URL should end in .upstash.io — check you copied the REST URL and not something else.',
    );
  }

  return parsed.origin;
}

export function validateToken(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 20) {
    throw new UpstashError(
      'That token looks too short. Copy the full REST token from the Upstash console.',
    );
  }
  if (!/^[A-Za-z0-9_\-=]+$/.test(trimmed)) {
    throw new UpstashError('That token contains unexpected characters — copy it again.');
  }
  return trimmed;
}

function buildKey(segments: readonly string[]): string {
  for (const segment of segments) {
    if (!SAFE_KEY_SEGMENT.test(segment)) {
      throw new UpstashError('Invalid storage key.');
    }
  }
  return [KEY_NAMESPACE, ...segments].join(':');
}

async function request(
  creds: UpstashCredentials,
  path: readonly string[],
  init?: RequestInit,
): Promise<unknown> {
  const url = `${creds.url}/${path.map(encodeURIComponent).join('/')}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${creds.token}`,
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      // Never attach ambient cookies to a cross-origin credentialed request.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch {
    // Deliberately opaque: the underlying error can embed the request URL.
    throw new UpstashError('Could not reach your database. Check your connection and the REST URL.');
  }

  if (response.status === 401 || response.status === 403) {
    throw new UpstashError('Your database rejected those credentials. Check the REST token.');
  }
  if (!response.ok) {
    throw new UpstashError(`Your database returned an error (${response.status}).`);
  }

  try {
    return await response.json();
  } catch {
    throw new UpstashError('Your database returned an unexpected response.');
  }
}

/** Verify credentials work before storing them. */
export async function verifyCredentials(creds: UpstashCredentials): Promise<void> {
  const body = await request(creds, ['get', buildKey(['probe'])]);
  if (typeof body !== 'object' || body === null || !('result' in body)) {
    throw new UpstashError('That endpoint did not respond like an Upstash database.');
  }
}

export async function readJson<T>(
  creds: UpstashCredentials,
  segments: readonly string[],
): Promise<T | null> {
  const body = await request(creds, ['get', buildKey(segments)]);
  if (typeof body !== 'object' || body === null || !('result' in body)) return null;

  const { result } = body;
  if (typeof result !== 'string' || result === '') return null;

  try {
    return JSON.parse(result) as T;
  } catch {
    // Corrupt or foreign value — discard rather than trust it.
    return null;
  }
}

export async function writeJson(
  creds: UpstashCredentials,
  segments: readonly string[],
  value: unknown,
): Promise<void> {
  await request(creds, ['set', buildKey(segments)], {
    method: 'POST',
    body: JSON.stringify(value),
  });
}

export async function deleteKey(
  creds: UpstashCredentials,
  segments: readonly string[],
): Promise<void> {
  await request(creds, ['del', buildKey(segments)], { method: 'POST' });
}

/** Mask a URL for display — never render the token. */
export function maskCredentials(creds: UpstashCredentials): string {
  let host: string;
  try {
    host = new URL(creds.url).hostname;
  } catch {
    host = 'your database';
  }
  const tail = creds.token.slice(-4);
  return `${host} · token ••••${tail}`;
}
