/**
 * Company logos — fetched once, here, and committed to the repo.
 *
 * The visitor's browser must never be made to ask a company's CDN for its
 * logo. Doing that would fire ~58 cross-origin requests on the directory page
 * and hand every listed company the IP address of everyone browsing, which is
 * irreconcilable with a tool that promises it cannot see what you look at.
 * That treatment was removed once already, deliberately. So the logo is
 * downloaded at update time, written into `public/logos/`, and `logoUrl`
 * becomes a root-relative path like `/logos/resend.png`. `img-src 'self'`
 * stays intact and the README's privacy claim stays true.
 *
 * Everything downloaded here is untrusted bytes from a third party, so the
 * validation is deliberately paranoid: the declared content type must be one
 * we accept, the leading bytes must actually agree with it, the body is capped
 * before it is buffered, tracking pixels are dropped, and the extension is
 * derived from what the bytes are — never from the URL.
 *
 * SVG is rejected outright. See SVG_POLICY below for why.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './dataset.mjs';

const LOGO_DIR = resolve(ROOT, 'public/logos');

/** The public path prefix. Must match the one allowed by safeImageSrc in the app. */
const PUBLIC_PREFIX = '/logos/';

/** Ids are slug-checked upstream; re-checked here because this one builds a path. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const DEFAULT_MAX_BYTES = 512_000;

/**
 * SVG is not saved, even though step 2 of discovery prefers it when a site
 * offers one.
 *
 * An SVG is XML, and a hostile one can carry `<script>`, `on*` handlers,
 * `<foreignObject>` with embedded HTML, `<use>`/`xlink:href` into other
 * documents and `javascript:` hrefs. Sanitising XML by pattern-matching is
 * exactly the class of defence that keeps being bypassed.
 *
 * Rendering one in `<img>` would in fact be safe — `<img>` does not execute
 * script. The problem is that saving it makes it reachable at
 * `/logos/<id>.svg` as a *top-level document* on this site's own origin, where
 * `script-src 'self'` permits it to run and where localStorage holds the
 * user's Upstash credentials. That is a concrete escalation path, not a
 * theoretical one, and the cost of avoiding it is nil: every site checked
 * offers a raster icon too. Raster formats carry no script.
 */
const SVG_POLICY = 'reject';

/** Content types we accept, mapped to the extension we save them under. */
const ACCEPTED_TYPES = new Map([
  ['image/png', 'png'],
  ['image/svg+xml', 'svg'],
  ['image/x-icon', 'ico'],
  ['image/vnd.microsoft.icon', 'ico'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

/** Reverse map, for reporting an already-downloaded file without re-reading it. */
const TYPE_BY_EXT = new Map([
  ['png', 'image/png'],
  ['svg', 'image/svg+xml'],
  ['ico', 'image/x-icon'],
  ['jpg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
]);

const SAVEABLE_EXTENSIONS = [...TYPE_BY_EXT.keys()];

// ---------------------------------------------------------------------------
// Byte inspection
// ---------------------------------------------------------------------------

/** `image/png; charset=utf-8` → `image/png`. */
function normalizeContentType(raw) {
  return String(raw ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function startsWith(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((b, i) => buffer[i] === b);
}

/**
 * What the bytes actually are, by magic number. Null when unrecognised.
 *
 * This is the authority, not the content-type header and certainly not the
 * URL: a site that serves a PNG from `/favicon.ico` labelled `image/x-icon`
 * is common, and saving those bytes as `.ico` would be a lie about the file.
 */
function sniffType(buffer) {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'; // GIF8(7|9)a
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && // RIFF
    buffer.length >= 12 &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // ICO header: reserved=0, type=1 (2 = CUR, a cursor, which is not a logo).
  if (startsWith(buffer, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';
  if (looksLikeSvg(buffer)) return 'image/svg+xml';
  return null;
}

/** SVG has no magic number, so this is the closest sanity check available. */
function looksLikeSvg(buffer) {
  // A UTF-8 BOM before the declaration is legal and common.
  const start = startsWith(buffer, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  const head = buffer.subarray(start, start + 256).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<?xml') || head.startsWith('<svg');
}

/**
 * Intrinsic pixel size, where the format makes it cheap to read.
 *
 * Only used to drop 1x1 responses — some sites answer an icon request with a
 * tracking pixel. Returning null means "could not tell", which is never
 * treated as a reason to reject.
 */
function dimensionsOf(buffer, type) {
  try {
    if (type === 'image/png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (type === 'image/gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (type === 'image/x-icon' && buffer.length >= 8) {
      // Per-entry width/height are single bytes; 0 encodes 256.
      return { width: buffer[6] || 256, height: buffer[7] || 256 };
    }
    if (type === 'image/webp' && buffer.length >= 30) {
      const fourcc = buffer.subarray(12, 16).toString('latin1');
      if (fourcc === 'VP8X') {
        return {
          width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
          height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
        };
      }
      if (fourcc === 'VP8 ') {
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      }
      if (fourcc === 'VP8L' && buffer.length >= 25) {
        const bits = buffer.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    if (type === 'image/jpeg') return jpegDimensions(buffer);
  } catch {
    return null;
  }
  return null;
}

/** Walk JPEG segment headers to the first start-of-frame marker. */
function jpegDimensions(buffer) {
  let offset = 2; // skip SOI
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0..SOF15, excluding the non-frame markers DHT (c4), JPG (c8), DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const ENTITIES = new Map([
  ['&amp;', '&'],
  ['&#38;', '&'],
  ['&#x26;', '&'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&apos;', "'"],
  ['&lt;', '<'],
  ['&gt;', '>'],
]);

function decodeEntities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#38|#x26|#39);/gi, (m) => ENTITIES.get(m.toLowerCase()) ?? m);
}

/** Attributes of a single tag, lowercased keys, entity-decoded values. */
function attributesOf(tag) {
  const attributes = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g;
  let match;
  while ((match = pattern.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** `rel="shortcut icon"` is two tokens, not one string. */
function relTokens(attributes) {
  return String(attributes.rel ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Largest edge declared in a `sizes` attribute, e.g. `16x16 32x32` → 32. */
function largestSize(raw) {
  if (typeof raw !== 'string') return null;
  const found = [...raw.toLowerCase().matchAll(/(\d+)\s*[x×]\s*(\d+)/g)].map(([, w, h]) =>
    Math.max(Number(w), Number(h)),
  );
  return found.length > 0 ? Math.max(...found) : null;
}

function isSvgCandidate(url, typeHint) {
  if (normalizeContentType(typeHint) === 'image/svg+xml') return true;
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.svg');
  } catch {
    return false;
  }
}

/**
 * Resolve a candidate against the page it was found on, and refuse anything
 * that is not plain http(s) — `javascript:`, `data:` and friends never get as
 * far as a request.
 */
function resolveCandidate(candidate, pageUrl) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return null;
  let url;
  try {
    url = new URL(candidate.trim(), pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  return url.toString();
}

/** Every `<script type="application/ld+json">` payload, parsed as JSON. */
function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const type = normalizeContentType(attributesOf(`<script ${match[1]}>`).type);
    if (type !== 'application/ld+json') continue;
    try {
      blocks.push(JSON.parse(match[2].trim()));
    } catch {
      // A malformed block is not worth a failure; the other steps still apply.
    }
  }
  return blocks;
}

const ORGANIZATION_TYPE = /organization|corporation|localbusiness|onlinebusiness/i;

/** `logo` may be a string, an ImageObject, or an array of either. */
function logoValues(value, into) {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const entry of value) logoValues(entry, into);
  else if (value !== null && typeof value === 'object') {
    if (typeof value.url === 'string') into.push(value.url);
    else if (typeof value.contentUrl === 'string') into.push(value.contentUrl);
  }
}

/** Walk a parsed JSON-LD graph collecting `logo` off Organization-ish nodes. */
function collectJsonLdLogos(node, into, depth = 0) {
  if (depth > 8 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const entry of node) collectJsonLdLogos(entry, into, depth + 1);
    return;
  }
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  if (types.some((t) => typeof t === 'string' && ORGANIZATION_TYPE.test(t)) && node.logo !== undefined) {
    logoValues(node.logo, into);
  }
  for (const value of Object.values(node)) {
    if (value !== null && typeof value === 'object') collectJsonLdLogos(value, into, depth + 1);
  }
}

/**
 * Ordered logo candidates for one page.
 *
 * 1. apple-touch-icon — usually the highest-resolution square asset a site has
 * 2. icon / shortcut icon — biggest declared `sizes` first
 * 3. schema.org Organization.logo
 * 4. /favicon.svg then /favicon.ico at the site root
 */
export function collectCandidates(html, pageUrl) {
  // A commented-out <link> is not a declaration.
  const source = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');

  // <base href> changes what a relative href resolves against.
  let base = pageUrl;
  const baseTag = /<base\b[^>]*>/i.exec(source);
  if (baseTag !== null) {
    const href = attributesOf(baseTag[0]).href;
    const resolved = resolveCandidate(href, pageUrl);
    if (resolved !== null) base = resolved;
  }

  const appleIcons = [];
  const icons = [];

  for (const [tag] of source.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = attributesOf(tag);
    const rels = relTokens(attributes);
    const href = resolveCandidate(attributes.href, base);
    if (href === null) continue;

    const entry = {
      url: href,
      size: largestSize(attributes.sizes),
      svg: isSvgCandidate(href, attributes.type),
    };

    if (rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed')) {
      appleIcons.push({ ...entry, source: 'apple-touch-icon' });
    } else if (rels.includes('icon')) {
      // `rel="shortcut icon"` tokenises to ['shortcut','icon'], so it lands here.
      // `mask-icon` is a monochrome silhouette, not a logo, and is excluded by
      // virtue of being its own token.
      icons.push({ ...entry, source: 'link-icon' });
    }
  }

  // Biggest first; an SVG outranks any raster size, and an icon that declares
  // no size sits above the 16/32 crowd but below an explicit 180/192/512.
  const score = (entry) => (entry.svg ? 1_000_000 : (entry.size ?? 64));
  appleIcons.sort((a, b) => score(b) - score(a));
  icons.sort((a, b) => score(b) - score(a));

  const jsonLd = [];
  for (const block of jsonLdBlocks(source)) collectJsonLdLogos(block, jsonLd);
  const jsonLdCandidates = jsonLd
    .map((value) => resolveCandidate(value, base))
    .filter((url) => url !== null)
    .map((url) => ({ url, size: null, svg: isSvgCandidate(url, null), source: 'json-ld' }));

  const root = [];
  for (const name of ['/favicon.svg', '/favicon.ico']) {
    const url = resolveCandidate(name, base);
    if (url !== null) root.push({ url, size: null, svg: name.endsWith('.svg'), source: 'favicon-root' });
  }

  const ordered = [...appleIcons, ...icons, ...jsonLdCandidates, ...root];

  const seen = new Set();
  const candidates = [];
  for (const entry of ordered) {
    // Skipped before the request is made, not after: refusing to save an SVG
    // and fetching it anyway would just be an impolite way to reach the same
    // outcome.
    if (entry.svg && SVG_POLICY === 'reject') continue;
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    candidates.push(entry);
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Download and validation
// ---------------------------------------------------------------------------

/**
 * Fetch one candidate and decide whether its bytes may be saved.
 * Returns `{ buffer, contentType, extension }` or `{ error }`.
 */
async function downloadImage(http, url, maxBytes) {
  const response = await http.getBinary(url, { maxBytes });

  if (!response.ok) {
    return { error: response.error ?? `HTTP ${response.status}` };
  }

  const buffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body ?? '');

  if (buffer.length === 0) return { error: 'empty body' };
  if (buffer.length > maxBytes) return { error: `body exceeds the ${maxBytes} byte cap` };

  const declared = normalizeContentType(response.contentType);
  if (!ACCEPTED_TYPES.has(declared)) {
    return { error: `content-type ${declared === '' ? '(none)' : declared} is not an accepted image type` };
  }

  const sniffed = sniffType(buffer);
  if (sniffed === null) {
    return { error: `content-type says ${declared} but the leading bytes are not a known image` };
  }

  // The bytes win. A PNG served as image/x-icon is saved as a PNG; a
  // "PNG" whose bytes are an HTML error page is thrown away.
  if (sniffed === 'image/svg+xml' && SVG_POLICY === 'reject') {
    return { error: 'SVG rejected by policy' };
  }

  const extension = ACCEPTED_TYPES.get(sniffed);
  if (extension === undefined) {
    return { error: `sniffed type ${sniffed} is not an accepted image type` };
  }

  const size = dimensionsOf(buffer, sniffed);
  if (size !== null && size.width <= 1 && size.height <= 1) {
    return { error: 'response is a 1x1 pixel' };
  }
  if (size !== null && (size.width === 0 || size.height === 0)) {
    return { error: 'response has a zero dimension' };
  }

  return { buffer, contentType: sniffed, extension, width: size?.width ?? null, height: size?.height ?? null };
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function publicPath(id, extension) {
  return `${PUBLIC_PREFIX}${id}.${extension}`;
}

/** Existing `/logos/<id>.<ext>` on disk, whatever extension it was saved under. */
function existingLogo(id) {
  for (const extension of SAVEABLE_EXTENSIONS) {
    const file = resolve(LOGO_DIR, `${id}.${extension}`);
    if (existsSync(file)) {
      return {
        path: publicPath(id, extension),
        file,
        bytes: statSync(file).size,
        contentType: TYPE_BY_EXT.get(extension) ?? null,
      };
    }
  }
  return null;
}

/**
 * Write the bytes atomically, and drop any previous file for the same id that
 * was saved under a different extension so one company can never end up with
 * two logos on disk.
 */
function saveLogo(id, extension, buffer) {
  mkdirSync(LOGO_DIR, { recursive: true });

  const file = resolve(LOGO_DIR, `${id}.${extension}`);
  const temp = `${file}.tmp`;
  writeFileSync(temp, buffer);
  renameSync(temp, file);

  for (const entry of readdirSync(LOGO_DIR)) {
    if (entry === `${id}.${extension}`) continue;
    const dot = entry.lastIndexOf('.');
    if (dot > 0 && entry.slice(0, dot) === id && SAVEABLE_EXTENSIONS.includes(entry.slice(dot + 1))) {
      try {
        unlinkSync(resolve(LOGO_DIR, entry));
      } catch {
        // A stale sibling we cannot remove is cosmetic, not a failure.
      }
    }
  }

  return publicPath(id, extension);
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Find, validate and store one company's logo.
 *
 * Returns `{ path, source, bytes, contentType, sourceUrl }` on success, where
 * `path` is the root-relative path to put in `logoUrl`, or `null` if no usable
 * logo was found. Never throws: like the rest of the updater, a failure here
 * is a value, so one awkward site cannot abort a run.
 *
 * Options:
 *   force     re-download even when a file already exists (default false)
 *   maxBytes  hard cap on the response body (default 512_000)
 *   onDetail  optional callback given a short string per attempt, for logging
 */
export async function fetchLogo(http, company, options = {}) {
  const { force = false, maxBytes = DEFAULT_MAX_BYTES, onDetail = null } = options;
  const note = (message) => {
    if (typeof onDetail === 'function') onDetail(message);
  };

  try {
    const id = company?.id;
    // Slug-checked upstream, re-checked here because this value becomes a path.
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      note('id is not a safe slug');
      return null;
    }

    if (!force) {
      const existing = existingLogo(id);
      // Only a logoUrl that actually points at a file we hold counts as done.
      if (existing !== null && typeof company.logoUrl === 'string' && company.logoUrl === existing.path) {
        return {
          path: existing.path,
          source: 'cached',
          bytes: existing.bytes,
          contentType: existing.contentType,
          sourceUrl: null,
        };
      }
    }

    const website = typeof company.website === 'string' ? company.website.trim() : '';
    if (website === '') {
      note('no website');
      return null;
    }
    const homepage = resolveCandidate(website, undefined);
    if (homepage === null) {
      note(`website is not an http(s) URL: ${website}`);
      return null;
    }

    if (typeof http?.getBinary !== 'function') {
      // Guard rather than fall back to `get`: that decodes bodies as UTF-8 and
      // would write silently corrupted images.
      note('http client has no getBinary — pass a client from lib/http.mjs');
      return null;
    }

    const page = await http.get(homepage, { accept: 'text/html,application/xhtml+xml;q=0.9' });
    if (!page.ok) {
      note(`homepage ${page.status === 0 ? page.error : `HTTP ${page.status}`}`);
      return null;
    }

    // Resolve against where we actually landed, so a redirect to www or to
    // another domain does not send every relative href to the wrong host.
    const pageUrl = page.url ?? homepage;
    const candidates = collectCandidates(page.body, pageUrl);
    if (candidates.length === 0) {
      note('no candidates found on the homepage');
      return null;
    }

    for (const candidate of candidates) {
      const result = await downloadImage(http, candidate.url, maxBytes);
      if (result.error !== undefined) {
        note(`${candidate.source} ${candidate.url} — ${result.error}`);
        continue;
      }

      const path = saveLogo(id, result.extension, result.buffer);
      return {
        path,
        source: candidate.source,
        bytes: result.buffer.length,
        contentType: result.contentType,
        sourceUrl: candidate.url,
      };
    }

    note(`all ${candidates.length} candidate(s) rejected`);
    return null;
  } catch (error) {
    note(error instanceof Error ? error.message : 'unexpected failure');
    return null;
  }
}

/**
 * Run `fetchLogo` across many companies, one at a time so the polite per-host
 * throttling in lib/http.mjs actually means something.
 *
 * Returns `{ results, failures }`:
 *   results  [{ id, name, path, source, bytes, contentType, sourceUrl, reused }]
 *   failures [{ id, name, reason }]
 *
 * Nothing here writes to the dataset — the caller decides whether to set
 * `logoUrl` from `path`.
 */
export async function fetchLogos(http, companies, options = {}) {
  const { limit = Infinity, onProgress = null, ...perCompany } = options;

  const results = [];
  const failures = [];

  let processed = 0;
  for (const company of companies ?? []) {
    if (processed >= limit) break;
    processed += 1;

    let lastDetail = null;
    const logo = await fetchLogo(http, company, {
      ...perCompany,
      onDetail: (message) => {
        lastDetail = message;
        if (typeof perCompany.onDetail === 'function') perCompany.onDetail(message);
      },
    });

    if (logo === null) {
      failures.push({ id: company?.id ?? null, name: company?.name ?? null, reason: lastDetail ?? 'no logo found' });
    } else {
      results.push({ id: company.id, name: company.name ?? null, ...logo, reused: logo.source === 'cached' });
    }

    if (typeof onProgress === 'function') {
      onProgress({ company, logo, reason: logo === null ? lastDetail : null });
    }
  }

  return { results, failures };
}

/** Where logos are written, for callers that want to report or clean the directory. */
export const LOGO_DIRECTORY = LOGO_DIR;
