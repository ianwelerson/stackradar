/**
 * Polite HTTP for the updater.
 *
 * Every request this tool makes hits someone else's server, usually a small
 * company's careers page. So: one request at a time per host with a delay
 * between them, a real User-Agent that says who we are, bounded retries with
 * backoff on transient failures only, and a hard timeout so a hanging host
 * cannot stall a run.
 *
 * Failures are values, not exceptions — a careers page that 404s must leave the
 * existing record untouched rather than abort the run or, worse, be read as
 * "this company stopped hiring".
 */

const lastRequestAt = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Transient enough to be worth retrying. 404/403 are answers, not failures. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class FetchResult {
  constructor({ ok, status, body, contentType, url, error }) {
    this.ok = ok;
    this.status = status;
    this.body = body;
    this.contentType = contentType;
    this.url = url;
    this.error = error ?? null;
  }
  json() {
    try {
      return JSON.parse(this.body);
    } catch {
      return null;
    }
  }
}

export function createHttp(config) {
  const {
    userAgent = 'stack-radar/1.0',
    requestTimeoutMs = 12000,
    perHostDelayMs = 1200,
    maxRetries = 2,
  } = config ?? {};

  async function throttle(host) {
    const last = lastRequestAt.get(host) ?? 0;
    const wait = perHostDelayMs - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(host, Date.now());
  }

  async function get(url, { accept = 'application/json, text/html;q=0.9' } = {}) {
    let host;
    try {
      host = new URL(url).host;
    } catch {
      return new FetchResult({ ok: false, status: 0, url, error: 'invalid URL' });
    }

    let attempt = 0;
    for (;;) {
      await throttle(host);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'User-Agent': userAgent, Accept: accept },
        });
        clearTimeout(timer);

        if (!response.ok && RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
          attempt += 1;
          await sleep(500 * 2 ** attempt);
          continue;
        }

        const body = await response.text();
        return new FetchResult({
          ok: response.ok,
          status: response.status,
          body,
          contentType: response.headers.get('content-type') ?? '',
          url: response.url,
        });
      } catch (error) {
        clearTimeout(timer);
        if (attempt < maxRetries) {
          attempt += 1;
          await sleep(500 * 2 ** attempt);
          continue;
        }
        return new FetchResult({
          ok: false,
          status: 0,
          url,
          error: error instanceof Error ? error.message : 'request failed',
        });
      }
    }
  }

  /**
   * Binary GET — identical politeness to `get`, but the body comes back as raw
   * bytes in `result.body` (a Buffer) instead of a decoded string.
   *
   * `get` reads the body with `response.text()`, which decodes as UTF-8 and
   * replaces every invalid sequence with U+FFFD. That is lossy and
   * irreversible: a PNG round-tripped through it loses its `0x89` signature
   * byte and grows by ~70%. Anything that is not text must come through here.
   *
   * The body is read incrementally and abandoned the moment it exceeds
   * `maxBytes`, so an oversized or endless response is never fully buffered.
   */
  async function getBinary(url, { accept = 'image/*,*/*;q=0.5', maxBytes = 2_000_000 } = {}) {
    let host;
    try {
      host = new URL(url).host;
    } catch {
      return new FetchResult({ ok: false, status: 0, url, error: 'invalid URL' });
    }

    let attempt = 0;
    for (;;) {
      await throttle(host);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'User-Agent': userAgent, Accept: accept },
        });

        if (!response.ok && RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
          clearTimeout(timer);
          await response.body?.cancel().catch(() => {});
          attempt += 1;
          await sleep(500 * 2 ** attempt);
          continue;
        }

        const contentType = response.headers.get('content-type') ?? '';
        const declared = Number(response.headers.get('content-length'));

        // Trust the header only to refuse early; the real check is the read below.
        if (Number.isFinite(declared) && declared > maxBytes) {
          clearTimeout(timer);
          await response.body?.cancel().catch(() => {});
          return new FetchResult({
            ok: false,
            status: response.status,
            contentType,
            url: response.url,
            error: `body is ${declared} bytes, over the ${maxBytes} byte cap`,
          });
        }

        const chunks = [];
        let total = 0;
        let oversized = false;
        const reader = response.body?.getReader();
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
              oversized = true;
              await reader.cancel().catch(() => {});
              break;
            }
            chunks.push(value);
          }
        }
        clearTimeout(timer);

        if (oversized) {
          return new FetchResult({
            ok: false,
            status: response.status,
            contentType,
            url: response.url,
            error: `body exceeds the ${maxBytes} byte cap`,
          });
        }

        return new FetchResult({
          ok: response.ok,
          status: response.status,
          body: Buffer.concat(chunks),
          contentType,
          url: response.url,
        });
      } catch (error) {
        clearTimeout(timer);
        if (attempt < maxRetries) {
          attempt += 1;
          await sleep(500 * 2 ** attempt);
          continue;
        }
        return new FetchResult({
          ok: false,
          status: 0,
          url,
          error: error instanceof Error ? error.message : 'request failed',
        });
      }
    }
  }

  return { get, getBinary };
}
