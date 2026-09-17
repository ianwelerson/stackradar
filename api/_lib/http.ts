/**
 * HTTP plumbing shared by every endpoint: CORS, caching, JSON error envelopes
 * and the GET/OPTIONS method gate.
 *
 * Endpoints are written against the Web Handler signature (`export default
 * { fetch }`) rather than method exports so that this module — not Vercel's
 * default routing — decides what an unsupported method returns. That keeps the
 * 405 body in the same JSON error shape as every other failure.
 */

export type ErrorCode =
  | 'INVALID_PARAM'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL_ERROR';

/** Public read-only data: cross-origin access is the point, not an oversight. */
const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

/**
 * One hour fresh at the edge, a day of stale-while-revalidate behind it. The
 * dataset only changes when the update script commits new JSON and triggers a
 * redeploy, which busts the cache anyway.
 */
const CACHE_CONTROL = 'public, s-maxage=3600, stale-while-revalidate=86400';

/** An error the endpoint raised on purpose, with a client-safe message. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, 'INVALID_PARAM', message);
}

export function notFound(message: string): ApiError {
  return new ApiError(404, 'NOT_FOUND', message);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
      ...CORS_HEADERS,
    },
  });
}

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
      ...CORS_HEADERS,
    },
  });
}

export function errorResponse(status: number, code: ErrorCode, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function preflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': CACHE_CONTROL, ...CORS_HEADERS },
  });
}

/** A Vercel Node function in Web Handler (`fetch`) form. */
export interface FetchHandler {
  fetch(request: Request): Response;
}

/**
 * Wrap a GET implementation with the method gate and the error boundary.
 *
 * The catch-all deliberately discards the thrown value's own message unless it
 * is an `ApiError`: anything else is an internal fault, and its text could name
 * a file path or a dependency version. Consumers get a fixed string; the real
 * error goes to the function log.
 */
export function createGetHandler(
  handle: (url: URL, request: Request) => Response,
): FetchHandler {
  return {
    fetch(request: Request): Response {
      if (request.method === 'OPTIONS') return preflightResponse();

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return errorResponse(
          405,
          'METHOD_NOT_ALLOWED',
          'This endpoint is read-only. Use GET or OPTIONS.',
        );
      }

      try {
        return handle(new URL(request.url), request);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          return errorResponse(error.status, error.code, error.message);
        }
        console.error('Unhandled API error', error);
        return errorResponse(
          500,
          'INTERNAL_ERROR',
          'The request could not be completed.',
        );
      }
    },
  };
}
