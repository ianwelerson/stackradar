import { companies, generatedAt } from './_lib/dataset.js';
import { createGetHandler, htmlResponse } from './_lib/http.js';

/**
 * GET /api — human-readable documentation for the public JSON API.
 *
 * Everything rendered here is either a literal or a number derived from the
 * dataset; no request input reaches the HTML, so there is nothing to escape.
 * Styles are inline and fonts fall back to system stacks — the page must make
 * no external request, so it stays useful when a CDN is blocked or the site is
 * being read by something that does not execute or fetch anything.
 */

interface Param {
  readonly name: string;
  readonly type: string;
  readonly detail: string;
}

interface Endpoint {
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly params: readonly Param[];
  readonly example: string;
  readonly sample: string;
}

const KEYWORD_PARAM: Param = {
  name: 'keyword',
  type: 'string, ≤120 chars',
  detail:
    'Free-text relevance query, scored with the same logic the site uses. Tokens are split on whitespace and commas; at most 12 are considered.',
};

const FILTER_PARAMS: readonly Param[] = [
  KEYWORD_PARAM,
  {
    name: 'country',
    type: 'string, ≤80 chars',
    detail:
      'Exact country match, case-insensitive. <code>location</code> is accepted as an alias. Companies with no recorded country are excluded and counted under <code>excluded.unknownCountry</code>.',
  },
  {
    name: 'remote',
    type: 'remote | hybrid | onsite',
    detail: 'Anything else is a 400. Companies with no recorded policy are excluded and counted.',
  },
  {
    name: 'minSize',
    type: 'integer ≥ 0',
    detail:
      'Lower bound on headcount. A company matches when its own size range overlaps the requested range. Non-numeric values are a 400, never a silent no-op.',
  },
  {
    name: 'maxSize',
    type: 'integer ≥ 0',
    detail: 'Upper bound on headcount. Same overlap and validation rules as <code>minSize</code>.',
  },
];

const PAGING_PARAMS: readonly Param[] = [
  {
    name: 'limit',
    type: 'integer',
    detail: 'Default 100, maximum 500. Out-of-range or unparseable values are clamped, not rejected.',
  },
  {
    name: 'offset',
    type: 'integer ≥ 0',
    detail:
      'Rows to skip. Ordering is stable (score, then open-role count, then name), so paging is consistent between requests.',
  },
];

const ENDPOINTS: readonly Endpoint[] = [
  {
    method: 'GET',
    path: '/api/companies',
    summary:
      'The directory as a list, with the same filters as the site. Records omit the weekly <code>history</code> log — fetch a single company for that.',
    params: [...FILTER_PARAMS, ...PAGING_PARAMS],
    example: '/api/companies?keyword=react&remote=remote&minSize=11&maxSize=200&limit=5',
    sample: `{
  "generatedAt": "2026-09-16T00:00:00Z",
  "total": 3,
  "count": 3,
  "limit": 5,
  "offset": 0,
  "filters": { "keyword": "react", "country": null, "remote": "remote", "minSize": 11, "maxSize": 200 },
  "excluded": { "unknownSize": 1, "unknownCountry": 0, "unknownRemote": 0 },
  "companies": [
    {
      "id": "spacelift",
      "name": "Spacelift",
      "description": "Infrastructure-orchestration platform (Terraform/OpenTofu/Pulumi)",
      "website": "https://spacelift.io",
      "careersUrl": "https://careers.spacelift.io",
      "sizeRange": "130+", "sizeMin": 130, "sizeMax": null,
      "hqLocation": "Remote — US/Europe", "country": null,
      "remotePolicy": "remote", "remoteRegions": ["United States", "Europe"],
      "keywords": ["infrastructure", "terraform", "react"],
      "openings": 1,
      "currentOpenings": [
        { "title": "Frontend Engineer (React)", "url": null, "postedDate": null,
          "detectedKeywords": ["frontend", "react"] }
      ],
      "historyWeeks": 0,
      "lastVerified": "2026-09-16T00:00:00Z",
      "dataNotes": null,
      "score": 80,
      "reasons": ["react listed"]
    }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/companies/{id}',
    summary:
      'One company&rsquo;s full record, including <code>currentOpenings</code> and the append-only weekly <code>history</code> log. Unknown ids return 404 with a JSON error body.',
    params: [
      {
        name: 'id',
        type: 'path segment, ≤64 chars',
        detail: 'The stable slug from any list response, e.g. <code>resend</code>.',
      },
    ],
    example: '/api/companies/attio',
    sample: `{
  "generatedAt": "2026-09-16T00:00:00Z",
  "company": {
    "id": "attio",
    "name": "Attio",
    "openings": 4,
    "currentOpenings": [ { "title": "Product Engineer", "detectedKeywords": [] } ],
    "historyWeeks": 2,
    "history": [
      { "weekOf": "2026-09-08", "openCount": 4, "keywordCounts": { "react": 1, "typescript": 1 } }
    ],
    "lastVerified": "2026-09-16T00:00:00Z",
    "dataNotes": null
  }
}`,
  },
  {
    method: 'GET',
    path: '/api/search',
    summary:
      'Ranked keyword search. Every result carries a 0&ndash;100 <code>score</code> and the <code>reasons</code> that produced it. Non-matching companies are dropped entirely.',
    params: [
      {
        name: 'q',
        type: 'string, ≤120 chars — required',
        detail: 'The query. <code>query</code> is accepted as an alias. Missing or blank is a 400.',
      },
      ...FILTER_PARAMS.filter((p) => p.name !== 'keyword'),
      {
        name: 'limit',
        type: 'integer',
        detail: 'Default 20, maximum 200. Clamped, not rejected. This endpoint does not page.',
      },
    ],
    example: '/api/search?q=typescript%20payments&country=Estonia&limit=5',
    sample: `{
  "generatedAt": "2026-09-16T00:00:00Z",
  "query": "typescript payments",
  "total": 4,
  "count": 4,
  "limit": 5,
  "filters": { "keyword": "typescript payments", "country": "Estonia", "remote": null, "minSize": null, "maxSize": null },
  "excluded": { "unknownSize": 0, "unknownCountry": 12, "unknownRemote": 0 },
  "results": [
    { "id": "montonio", "name": "Montonio", "score": 40, "reasons": ["payments listed"], "openings": 0 }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/positions',
    summary:
      'Every open role across the whole dataset, flattened and annotated with its company. Answers &ldquo;what React roles are open right now&rdquo; in one request.',
    params: [
      ...FILTER_PARAMS,
      {
        name: 'matchedVia (response field)',
        type: 'position | company | null',
        detail:
          'How the row survived <code>keyword</code>: <code>position</code> when the role&rsquo;s own title or detected keywords matched, <code>company</code> when only the company record did, <code>null</code> when no keyword was given. Direct role hits sort first.',
      },
      ...PAGING_PARAMS,
    ],
    example: '/api/positions?keyword=react&limit=5',
    sample: `{
  "generatedAt": "2026-09-16T00:00:00Z",
  "total": 8,
  "count": 5,
  "limit": 5,
  "offset": 0,
  "companiesMatched": 3,
  "filters": { "keyword": "react", "country": null, "remote": null, "minSize": null, "maxSize": null },
  "excluded": { "unknownSize": 0, "unknownCountry": 0, "unknownRemote": 0 },
  "positions": [
    {
      "title": "Frontend Engineer (React)",
      "url": null,
      "postedDate": null,
      "detectedKeywords": ["frontend", "react"],
      "companyId": "spacelift",
      "companyName": "Spacelift",
      "companyWebsite": "https://spacelift.io",
      "careersUrl": "https://careers.spacelift.io",
      "country": null,
      "remotePolicy": "remote",
      "matchedVia": "position"
    }
  ]
}`,
  },
];

const STYLES = `
:root {
  --bg: oklch(0.16 0.006 255);
  --surface: oklch(0.2 0.008 255);
  --border: oklch(0.3 0.01 255);
  --fg: oklch(0.96 0.004 255);
  --muted: oklch(0.72 0.012 255);
  --accent: oklch(0.78 0.14 162);
  --sans: 'IBM Plex Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--sans); line-height: 1.6; -webkit-font-smoothing: antialiased; }
main { max-width: 56rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; }
h1 { font-size: clamp(1.75rem, 5vw, 2.5rem); letter-spacing: -0.02em; margin: 0 0 0.5rem; }
h2 { font-size: 1.25rem; letter-spacing: -0.01em; margin: 3rem 0 0.75rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
h3 { font-size: 1rem; margin: 0 0 0.25rem; font-family: var(--mono); font-weight: 600; }
p { margin: 0 0 1rem; color: var(--muted); }
a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; }
a:hover { border-bottom-color: var(--accent); }
code { font-family: var(--mono); font-size: 0.875em; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 0.075em 0.35em; color: var(--fg); }
pre { font-family: var(--mono); font-size: 0.8125rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; overflow-x: auto; margin: 0; color: var(--fg); }
pre code { background: none; border: 0; padding: 0; font-size: inherit; }
.lede { color: var(--fg); font-size: 1.0625rem; }
.tagline { font-family: var(--mono); font-size: 0.8125rem; color: var(--accent); text-transform: uppercase; letter-spacing: 0.12em; margin: 0 0 1.5rem; }
.stats { display: flex; flex-wrap: wrap; gap: 1.5rem; padding: 1rem 1.25rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin: 1.5rem 0; }
.stat b { display: block; font-size: 1.5rem; font-family: var(--mono); font-weight: 600; color: var(--accent); }
.stat span { font-size: 0.8125rem; color: var(--muted); }
.endpoint { border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem; margin: 0 0 1.25rem; background: var(--surface); }
.route { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.6rem; margin-bottom: 0.5rem; }
.verb { font-family: var(--mono); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; color: var(--bg); background: var(--accent); border-radius: 4px; padding: 0.15rem 0.45rem; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0 0; font-size: 0.875rem; display: block; overflow-x: auto; }
th, td { text-align: left; vertical-align: top; padding: 0.5rem 0.75rem 0.5rem 0; border-bottom: 1px solid var(--border); }
th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
td:first-child { font-family: var(--mono); white-space: nowrap; color: var(--fg); }
td:nth-child(2) { font-family: var(--mono); font-size: 0.8125rem; color: var(--accent); white-space: nowrap; }
td:last-child { color: var(--muted); min-width: 22rem; }
details { margin-top: 1rem; }
summary { cursor: pointer; font-size: 0.8125rem; color: var(--muted); font-family: var(--mono); }
summary:hover { color: var(--accent); }
details[open] summary { margin-bottom: 0.75rem; }
ul { color: var(--muted); padding-left: 1.1rem; margin: 0 0 1rem; }
li { margin-bottom: 0.4rem; }
.note { border-left: 2px solid var(--accent); padding: 0.25rem 0 0.25rem 1rem; margin: 1.5rem 0; }
.note p:last-child { margin-bottom: 0; }
footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); font-size: 0.8125rem; color: var(--muted); }
`;

function renderParams(params: readonly Param[]): string {
  const rows = params
    .map(
      (p) =>
        `<tr><td>${p.name}</td><td>${p.type}</td><td>${p.detail}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Param</th><th>Type</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderEndpoint(endpoint: Endpoint): string {
  return `<div class="endpoint">
  <div class="route"><span class="verb">${endpoint.method}</span><h3>${endpoint.path}</h3></div>
  <p>${endpoint.summary}</p>
  ${renderParams(endpoint.params)}
  <details>
    <summary>Example &mdash; <code>${endpoint.example}</code></summary>
    <pre><code>${endpoint.sample}</code></pre>
  </details>
</div>`;
}

function renderPage(): string {
  const openings = companies.reduce((sum, c) => sum + c.currentOpenings.length, 0);
  const verified = companies.filter((c) => c.lastVerified !== null).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="description" content="Public read-only JSON API for Stack Radar: companies, open engineering positions and ranked keyword search.">
<title>Stack Radar API</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <p class="tagline">Stack Radar &middot; public read-only API</p>
  <h1>Query the directory directly</h1>
  <p class="lede">
    Stack Radar is a public directory of tech companies and the engineering roles they have open.
    Everything the site renders is available here as JSON &mdash; same data, same relevance scoring,
    no scraping required. Every endpoint is <code>GET</code>, unauthenticated, and CORS-open, because
    the data is public on purpose.
  </p>

  <div class="stats">
    <div class="stat"><b>${companies.length}</b><span>companies</span></div>
    <div class="stat"><b>${openings}</b><span>open roles</span></div>
    <div class="stat"><b>${verified}</b><span>verified records</span></div>
    <div class="stat"><b>${generatedAt.slice(0, 10)}</b><span>dataset generated</span></div>
  </div>

  <h2>Conventions</h2>
  <ul>
    <li>Responses are <code>application/json; charset=utf-8</code> and always include a top-level
        <code>generatedAt</code> &mdash; the dataset build time, not the request time.</li>
    <li>List responses include <code>total</code> (matches before paging) and <code>count</code>
        (rows in this response), so a consumer can page correctly.</li>
    <li>Caching: <code>public, s-maxage=3600, stale-while-revalidate=86400</code>. The dataset only
        changes on redeploy, which busts the cache.</li>
    <li>CORS: <code>Access-Control-Allow-Origin: *</code>, <code>Access-Control-Allow-Methods: GET, OPTIONS</code>.
        <code>OPTIONS</code> preflight returns 204. Any other method returns 405.</li>
    <li>Errors are JSON: <code>{ "error": { "code": "...", "message": "..." } }</code>, with codes
        <code>INVALID_PARAM</code>, <code>NOT_FOUND</code>, <code>METHOD_NOT_ALLOWED</code> and
        <code>INTERNAL_ERROR</code>.</li>
    <li>Filters that need data a record does not have exclude that record rather than guessing. The
        count of such rows is reported per filter under <code>excluded</code>.</li>
  </ul>

  <h2>Endpoints</h2>
  ${ENDPOINTS.map(renderEndpoint).join('\n')}

  <h2>How relevance is scored</h2>
  <p>
    One implementation backs the site, this API and the MCP server. A query is lowercased and split on
    whitespace and commas (never compiled into a pattern), and each token scores once against the
    highest-signal field it hits: company name (1.0), curated keywords or a keyword detected on an open
    role (0.8), an open role&rsquo;s title or the description (0.5), then location (0.4). The total is
    divided by the token count and normalised to 0&ndash;100, and the matched fields come back as
    <code>reasons</code>.
  </p>

  <h2>For AI agents</h2>
  <ul>
    <li><a href="/llms.txt">/llms.txt</a> &mdash; what this site is and how to use it, in the llms.txt convention.</li>
    <li>An MCP server wraps these endpoints as the tools <code>search_companies</code>,
        <code>get_company</code> and <code>list_open_positions</code>. See <code>mcp/README.md</code>
        in the repository for the config block.</li>
  </ul>

  <div class="note">
    <p>
      <b>About the data.</b> Stack Radar is community-researched, not an official feed. Each record
      carries a <code>lastVerified</code> timestamp, and for a large share of the dataset it is
      <code>null</code> &mdash; meaning that record has never been checked against the company&rsquo;s own
      careers page. <code>sizeMin</code>, <code>sizeMax</code>, <code>country</code> and
      <code>remotePolicy</code> are also <code>null</code> where research could not establish them.
      Treat a listing as a lead to confirm at <code>careersUrl</code>, not as a live job board.
    </p>
  </div>

  <footer>
    Dataset generated ${generatedAt}. <a href="/">Browse the directory &rarr;</a>
  </footer>
</main>
</body>
</html>`;
}

export default createGetHandler(() => htmlResponse(renderPage()));
