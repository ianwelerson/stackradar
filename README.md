# Stack Radar

**A searchable directory of tech companies and the engineering roles they have open — with an
open dataset behind it.**

### [stackradar.strukt.app →](https://stackradar.strukt.app)

```
297 companies · 3,126 open roles · 3,122 linked to that exact posting
18 countries · 65% checked against a company's own job board · 1 static JSON file
```

Search by stack, filter by work model, location, company size and role type, and see what each
company has been hiring for week over week. Save what you are interested in; it stays in your
browser unless you connect a database of your own.

---

## What it does

**Search that knows the difference between a stack and a sentence.** Terms are comma-separated,
so `Go, Postgres, design engineer` is three terms and the last one matches an actual
design-engineering role rather than every company with "engineer" somewhere. Matching is
whole-term, so `go` finds Go roles and not Ridango or Algolia.

**Two ways to look at the same search.** *Companies* answers "who should I know about";
*Open roles* answers "which jobs suit me". Both carry a match score against your saved profile,
computed by the same scorer so a 68% means the same thing in either view.

**Role types, classified from the title.** A "Sales Engineer" is sales, a "Salesforce
Developer" is engineering, and a title too ambiguous to place is left out of both buckets
rather than guessed into one.

**A saved profile.** Stack terms, work models, locations, company sizes and role types, stored
locally and synced to your own Upstash Redis if you connect one. The directory opens filtered
to it; changing a filter never edits it.

**Weekly hiring history.** An append-only log of open-role counts per company, so a chart shows
what was actually observed on the weeks it was observed.

## The data

The whole dataset is one static file:

```bash
curl https://stackradar.strukt.app/companies.json
```

1.3 MB, 168 KB gzipped, no key and no rate limit. Every record carries its own `lastVerified`
date and a `dataNotes` caveat, so you can see when a fact was established and what came with
it. Fields nobody confirmed are `null` — please keep them that way.

There is also [`/llms.txt`](https://stackradar.strukt.app/llms.txt), a methodology page at
[`/data`](https://stackradar.strukt.app/data), and an MCP server in `mcp/` exposing
`search_companies`, `get_company` and `list_open_positions`, so an agent can query the
directory as a tool.

### `null` is a real value

This is the design decision the rest of the project hangs off. Size, location and work model
are genuinely unknown for much of the index, and the honest answer is to say so. Filtering on a
dimension a company has no data for sets it aside, **counts it, and names it**:

> *hidden by this filter: 64 whose work model we haven't confirmed*

Your profile decides whether those still count as a match. `lastVerified` has three states
rather than two — verified, stale, and never checked — and the UI shows which.

## How it is put together

**No server and no database.** The dataset is a JSON file committed to the repo; the React app
is a read-only consumer of it, bundled at build time. Updating the data is a git push, which
redeploys.

```
data/companies.json         the dataset — single source of truth
data/companies.schema.json  JSON Schema describing it
src/lib/scoring.ts          relevance scoring — shared by UI, API and MCP server
src/lib/filtering.ts        filter + sort rules — shared the same way
src/lib/discipline.ts       what kind of work a role title actually is
scripts/update/             the data pipeline
api/                        serverless JSON API, ready to switch on
mcp/                        MCP server
```

`scoring.ts` is deliberately the only implementation of relevance ranking, and `filtering.ts`
the only implementation of the filter rules. The UI, the API and the MCP server all import
them, so a query ranks identically wherever it is asked.

Term matching is whole-term and scanned by hand rather than with a regex — user input is never
compiled into a pattern anywhere in this codebase, which keeps ReDoS off the table.

**Stack:** Vite 7 · React 19 · TypeScript (strict, `exactOptionalPropertyTypes`) · Tailwind v4
with CSS-first `@theme` tokens in OKLCH · React Router · Zod. No UI framework; the design is
dark-only and deliberately dense, and began as a Claude Design handoff kept in
`design-reference/` for comparison.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:5173
pnpm verify         # validate data → typecheck → lint → build. Run before pushing.
```

| command | what it does |
|---|---|
| `pnpm validate:data` | JSON Schema + the data invariants |
| `pnpm audit:data` | looks for data that is *wrong* rather than merely malformed |
| `pnpm audit:data:live` | the same, plus probing a sample of posting URLs |
| `pnpm data:status` | coverage counts |
| `pnpm data:gaps` | what is missing, grouped by *why* |

## The data pipeline

`scripts/update/` is a toolkit driven by [Claude Code](https://claude.com/claude-code) locally.
The scripts do the fetching, merging and validating; the model does the research that needs
reading and judgement.

```bash
node scripts/update/cli.mjs status               # what's missing
node scripts/update/cli.mjs discover             # find new companies (all sources)
node scripts/update/cli.mjs refresh --limit 150  # scan job boards, update positions + history
node scripts/update/cli.mjs enrich               # write out the gaps needing research
node scripts/update/cli.mjs apply --file r.json  # validate + merge researched findings
node scripts/update/cli.mjs logos                # fetch and store logos locally
node scripts/update/cli.mjs linkedin             # find each company's own LinkedIn link
```

Everything is a dry run until `--write`, and every write backs up the previous
`companies.json` first.

### Where companies come from

| source | what it finds |
|---|---|
| `workatastartup` | YC startups hiring engineers today — website, team size, public per-posting links |
| `ycombinator` | the YC directory: every funded company, hiring or not |
| `hnhiring` | non-YC remote startups, from the monthly *"Ask HN: Who is hiring?"* thread |
| `weworkremotely` | remote-first companies, from the RSS category feeds |
| `seeds` | a curated list, for ecosystems with no machine-readable directory |

Each source produces a company **name plus its own domain** — never the jobs. The roles are
then read from that company's own board, which is what lets 3,122 of 3,126 postings carry a
link to that exact role rather than to a careers page you then have to search. Ten job-board
adapters are supported: Ashby, Greenhouse, Lever, Workable, Personio, Recruitee,
SmartRecruiters, BambooHR, Teamtailor and YC's Work at a Startup.

`scripts/update/SOURCES.md` documents every verified endpoint and the traps that have already
bitten. Worth reading before adding a source.

### Rules the merge layer enforces

These live in `scripts/update/lib/merge.mjs` rather than being left to the caller:

- **A failed scan leaves the record untouched.** A 404, a timeout or an unparseable page is
  indistinguishable from "they stopped hiring", so an unreadable careers page keeps its
  previous state — including `lastVerified`, which the UI then shows ageing rather than
  implying a check that happened.
- **History is append-only**, keyed on the ISO Monday, so re-running in the same week updates
  that week rather than appending a duplicate.
- **Primary data outranks directory data.** A fact read from a company's own site beats one
  from a listing; listings fill blanks only. When a merge declines a field it says which and
  why, rather than reporting an indistinguishable "nothing changed".
- **Model output is untrusted input.** `apply` validates every field against a fixed
  allow-list with type and range checks, rejects unknown company ids outright — enrichment can
  never create a record — and requires https URLs.
- **One country has one spelling.** `country` is the location filter's vocabulary, so every
  value passes through a normaliser that maps `US`, `USA` and `United States of America`
  together and rejects non-countries like `EMEA`.

`scripts/update/RESEARCH-NOTES.md` accumulates what each research round found, including the
dead ends — which sites 403, which are JS-only, which "careers pages" are placeholders.
Reading it first is the single biggest time-saver in this repo.

## Privacy and security

- **Everything renders from this origin.** Fonts are self-hosted and logos are downloaded
  once and committed to the repo, so reading the directory talks to nobody but this site.
- **Your data stays yours.** What you save lives in `localStorage` with no account. Connect
  your own Upstash Redis and credentials stay in your browser, with requests going straight
  from your browser to your database — there is no server here that could see them. The REST
  URL is constrained to `https` and an `*.upstash.io` host.
- **Strict CSP** (`script-src 'self'`, no inline scripts) plus `nosniff`,
  `frame-ancestors 'none'`, HSTS and a restrictive `Permissions-Policy`.
- **Every external URL is validated** before it reaches an `href` — only `http(s)` passes, so
  a `javascript:` URL in the dataset can never become an XSS vector. All external links carry
  `rel="noopener noreferrer"`.

## Deploying

A static build plus optional serverless functions; Vercel needs no configuration beyond the
committed `vercel.json`. If you fork it to another domain, repoint the absolute URLs:

```bash
pnpm set-site-url https://your-deployment.example
cd mcp && npm run build      # rebuild so the bundled default updates
```

`vercel.json` ends with the catch-all SPA fallback, `{ "source": "/(.*)" }`. Vercel resolves
the filesystem *before* rewrites, so the 297 prerendered company pages, `/companies.json` and
everything under `/assets/` are served as real files and never reach it.

<details>
<summary><strong>Switching on the JSON API</strong></summary>

A filtered, ranked HTTP API lives in `api/` — `/api/companies`, `/api/companies/{id}`,
`/api/search`, `/api/positions`, plus a docs page. It is built, typechecked and linted, but
left off: one static file is simpler at this size. It stays in the repo because the MCP server
bundles `api/_lib/*` for its offline path and `pnpm typecheck` still covers it, so it cannot
rot while switched off.

1. Remove the `api/` line from `.vercelignore`
2. Add the API typecheck back into `build`:
   `... && tsc -b && tsc -p api/tsconfig.json --noEmit && vite build && ...`
3. Restore the endpoint list in `public/llms.txt`
4. Optionally set `STACK_RADAR_API` for the MCP server so it prefers live data over its
   bundled snapshot

Serverless functions are on Vercel's free tier, so enabling it costs nothing.

</details>

## Licence

Code is [MIT](LICENSE).

The dataset is assembled from companies' own public job boards and their own websites, and
each record carries its provenance — `lastVerified`, `dataNotes`, and a `null` wherever
nothing was established. Use it freely; please keep the nulls null.
