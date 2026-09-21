# Stack Radar

A public, searchable directory of tech companies and their open engineering roles.
Search by stack, filter by location, size and work model, and see what each company
has been hiring for over time.

Dark-only, mobile and desktop equally, no accounts, no tracking, no backend.

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

```bash
pnpm verify        # validate data → typecheck → lint → build. Run this before pushing.
pnpm build         # validate → typecheck → bundle → prerender 58 company pages
pnpm validate:data # schema + data-honesty invariants
pnpm typecheck     # app and API
pnpm lint
```

## How it is put together

There is **no server and no database**. The dataset is a JSON file committed to the
repo; the React app is a read-only consumer of it, bundled at build time. Updating
the data is a normal git push, which redeploys.

```
data/companies.json        the dataset — single source of truth
data/companies.schema.json JSON Schema describing it
src/lib/scoring.ts         relevance scoring — shared by UI, API and MCP server
src/lib/filtering.ts       filter + sort logic
src/lib/upstash.ts         bring-your-own-storage client
api/                       Vercel serverless functions (public read-only JSON API)
mcp/                       MCP server, so agents can query the directory as a tool
design-reference/          the original Claude Design handoff, kept for reference
```

`src/lib/scoring.ts` is deliberately the only implementation of relevance ranking.
The UI, the `/api/search` endpoint and the MCP server all import it, so a query
ranks identically wherever it is asked.

## Data honesty

This is the part of the design that matters most, and it shapes the whole UI.

- **`lastVerified` is shown, always.** Three states, not two: *verified* (checked
  against the company's own careers page), *stale* (checked, but a while ago), and
  *not yet verified* (sourced from research, never confirmed). Most of the dataset
  is currently the third.
- **Unknown is a real value.** Size, location and work model are genuinely unknown
  for much of the index. Nothing is guessed to fill a column. Applying a filter to a
  dimension a company has no data for excludes it — and the result line says how many
  were excluded for that reason, so a filter never silently hides most of the index.
- **No synthetic history.** `history` is an append-only weekly scan log. Companies
  that have not been scanned show an explicit "no history tracked yet" state rather
  than a back-filled chart. Nothing here is estimated.
- **Keywords are not invented.** Where research recorded a company's actual stack,
  those terms are used. Where it recorded only a description, the keywords are
  domain tags — no company is tagged with a technology nobody verified it uses.

## Privacy and security

- **No analytics, no cookies, no third-party requests at all.** Fonts are
  self-hosted. Company avatars are generated initial tiles rather than favicons
  fetched from company domains — deriving those would disclose the visitor's IP to
  every company on the page. Browsing the directory talks to nobody but this site.
- **Bring-your-own storage is genuinely yours.** Notes and tracked companies work
  entirely in `localStorage` with no account. Optionally connect your own Upstash
  Redis: credentials live only in your browser, requests go straight from your
  browser to your database, and there is no server here that could see them.
  The REST URL is constrained to `https` and an `*.upstash.io` host so a mistyped
  or malicious endpoint cannot receive your token.
- **Strict CSP** (`script-src 'self'`, no inline scripts) plus `nosniff`,
  `frame-ancestors 'none'`, HSTS and a restrictive `Permissions-Policy`.
- **Every external URL is validated** before it reaches an `href` — only `http(s)`
  passes, so a `javascript:` URL in the dataset can never become an XSS vector.
  All external links carry `rel="noopener noreferrer"`.

## Updating the data

`scripts/update/` is a toolkit, driven by Claude Code locally. The scripts do the
fetching, merging and validating; the model does the research that needs reading and
judgement. Run the whole workflow with:

```
/refresh-data
```

Or drive the pieces directly:

```bash
node scripts/update/cli.mjs status              # what's missing
node scripts/update/cli.mjs refresh --limit 25  # scan job boards, update positions + history
node scripts/update/cli.mjs discover            # find new companies (all sources)
node scripts/update/cli.mjs enrich              # write out gaps needing research
node scripts/update/cli.mjs apply --file r.json # validate + merge researched findings
node scripts/update/cli.mjs history             # record this week's counts
```

**Everything is a dry run until `--write`**, and every write backs up the previous
`companies.json` to `scripts/update/.backups/` first.

### The rules it will not break

These are enforced in `scripts/update/lib/merge.mjs`, not left to the caller:

- **A failed scan changes nothing.** A 404, a timeout or an unparseable page is
  indistinguishable from "they stopped hiring", so an unreadable careers page leaves the
  record exactly as it was — including `lastVerified`, so the UI keeps showing it ageing
  rather than implying a check that never happened.
- **History is append-only, keyed on the ISO Monday.** Re-running in the same week updates
  that week's entry instead of appending a duplicate, so the script is safe to run as often
  as you like.
- **Directory data never overrides primary data.** A fact read from the company's own site
  (`trust: "primary"`) outranks one from a listing; listings only fill blanks. When a merge
  declines a field for that reason it says so by name, rather than reporting an
  indistinguishable "nothing changed".
- **Model output is untrusted input.** `apply` validates every field against a fixed
  allow-list with type and range checks, rejects unknown company ids outright (enrichment
  can never create a record), and rejects non-https URLs. Anything invalid is reported, not
  silently dropped.

### Where positions come from

Job boards with public APIs are read directly, which is how each position gets its **own
direct URL**, posted date and location rather than a link to a generic careers page.
Companies not on a supported board are surfaced for the model to read by hand.

Those same postings also carry structured location data, so a company's country and work
model are derived from its own job board rather than guessed — merged at `directory` trust
so they only ever fill blanks. A country is claimed only when two-thirds of the postings
that state one agree; a company hiring across five countries keeps `country: null`, which
is the honest answer.

**LinkedIn is deliberately not used.** Its `robots.txt` opens by prohibiting automated
access outright, and its company API needs partner approval. The job boards give better
data anyway, from the company itself, with no terms to violate.

### Client-side routes on Vercel

`vercel.json` ends with the catch-all SPA fallback:

```json
"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
```

Two things make this safe rather than a sledgehammer. Vercel resolves the
**filesystem before rewrites**, so the 297 prerendered company pages,
`/companies.json` and everything under `/assets/` are served as real files and
never reach this rule — it only catches paths with no file behind them, such as
`/my-list`. And serverless functions are resolved in that same filesystem phase,
so this stays correct if the JSON API is switched back on; it does not need an
`api/` exclusion.

That exclusion is in fact what broke it. The rule previously read
`/((?!api\/).*)`, and `source` is parsed as **path-to-regexp**, not a raw
regular expression — the `\/` escape that is a no-op in JavaScript is not one
there, so the pattern failed to match and every route without a prerendered file
fell through to Vercel's own 404 page on reload. The symptom was that the site
worked while navigating but any inner path errored when refreshed.

### Logos

`node scripts/update/cli.mjs logos --write` downloads each company's logo from its own site
(apple-touch-icon → `<link rel=icon>` → JSON-LD `Organization.logo` → `/favicon.ico`) and
stores it in `public/logos/`, setting `logoUrl` to a root-relative path.

They are stored locally rather than hot-linked on purpose: pointing `logoUrl` at company
CDNs would fire a cross-origin request per card and disclose every visitor's IP to every
company listed. Local files keep `img-src 'self'` intact and the privacy claim above true.

### Discovery sources

Which sources run is set by `discovery.sources` in `research.config.json`. Each one's
job is to produce a company **name plus its own domain** — not jobs. The refresh scan
then finds that company's real job board and takes the per-posting links from there,
which is why a candidate without a usable domain is dropped rather than stored.

`scripts/update/SOURCES.md` is the playbook: the record shape and verified endpoint for
every source that works, the ones that were evaluated and rejected and why, the sources
that are permanently blocked, and a checklist for assessing a new one. Read it before
adding a source — it will usually save the probing.

Companies can also be added by hand through the `seeds` source, which reads
`discovery.seeds.companies` and makes no network requests at all. That is how ecosystems
with no reachable directory are covered: Startup Estonia publishes its database through a
Cloudflare-protected portal that blocks every automated request, including its own
`robots.txt`. **Check each domain resolves before adding it** — of the first 46 candidates
considered, six were dead, parked, or redirected to an acquirer's site, and would have
entered the dataset as records nothing could ever fill in. SOURCES.md has the one-line
`curl` that catches all six, and notes the extra step that one of them needed: a
domain can answer 200 and still be a wound-up company, so read what the page says.

Each seed also needs a `description`. The schema requires one and the pipeline will
not invent it, so `discover` skips a candidate that arrives without one; take it from
the company's own `og:description`.

### Research notes

`scripts/update/RESEARCH-NOTES.md` is the accumulated record of what previous research
rounds found: per-company careers URLs, which job-board platform each uses, which sites are
dead ends, and which work-model signals turned out to be reliable. Read it before
researching and update it after — including the failures, which are as useful as the hits.

### Seeing what is missing

```bash
pnpm data:status   # coverage counts
pnpm data:gaps     # what is missing, grouped by why
```

`data:gaps` groups by cause rather than by field, because that is what tells you
what to do next: "45 companies have no discoverable job board" is a different
problem from "45 companies are missing a work model", even when they are the same
45 companies.

## For agents and other tools

The dataset is meant to be consumed by more than browsers.

- `GET /companies.json` — **the entire dataset**, one static file, ~6 KB gzipped
- `GET /llms.txt` — what this site is and how to use its data
- `mcp/` — an MCP server exposing `search_companies`, `get_company`, `list_open_positions`

At this size, fetching the whole file and filtering locally is the sensible approach, which is
what the site itself does — it bundles the JSON at build time and makes no API calls.

See `mcp/README.md` for client config, and `Company_Directory_Project_Spec.md` §7a for the
rationale.

## Enabling the JSON API

A filtered, ranked HTTP API lives in `api/` — `/api/companies`, `/api/companies/{id}`,
`/api/search`, `/api/positions`, plus an `/api` docs page. It is built, typechecked, linted
and verified, but **deliberately not deployed**: at 58 companies a single static file is
simpler, and unused public surface is not worth maintaining.

It stays in the repo because the MCP server bundles `api/_lib/*` at build time for its
offline path, and `pnpm typecheck` still covers it — so it cannot rot while switched off.

To switch it on:

1. Remove the `api/` line from `.vercelignore`
2. Add the API typecheck back into `build`:
   `... && tsc -b && tsc -p api/tsconfig.json --noEmit && vite build && ...`
3. Restore the endpoint list in `public/llms.txt` (it currently states the API is not deployed)
4. Optionally point the footer back at `/api`, and set `STACK_RADAR_API` for the MCP server
   so it prefers live data over its bundled snapshot

Serverless functions are included on Vercel's free tier and billed per invocation, so the
cost of enabling it is zero — the reason it is off is surface area, not price.

## Deploying

The app is a static build plus serverless functions; Vercel needs no extra configuration
beyond the committed `vercel.json`.

**After the first deploy**, point the absolute URLs at the real domain — llms.txt, the MCP
docs and the MCP server's default API base all ship with a placeholder:

```bash
pnpm set-site-url https://your-deployment.vercel.app
cd mcp && npm run build      # rebuild so the bundled default updates
```
