# Stack Radar — Implementation Plan

Working plan for building v1. Companion to `Company_Directory_Project_Spec.md` (the what)
and `project/Stack Radar.dc.html` (the visual source of truth).

**Status:** v1 complete — phases 1–9 built and verified. Deployment (running
`vercel`) and the update script are what remain. See the build log at the end.

---

## Context carried in from planning

Decisions made in conversation that are **not** in the spec file:

1. **Update script is deferred.** Not part of v1. We build it together in a separate
   session after the app ships. v1 runs against a hand-converted `companies.json`.
2. **Size and location can be `unknown`.** First-class nullable values, not guesses.
   LinkedIn was raised as a possible later source — note that LinkedIn blocks scraping
   and its company API needs partner access; Dealroom / Startup Estonia / Wellfound
   (spec §7) are the practical routes when we get to the script.
3. **No synthetic history.** Every company launches with `history: []`. The chart's
   empty state is the *primary* state at launch, not an edge case.
4. **Scoring module takes a token list**, not a raw query string — so the future
   `match_positions(skills[])` MCP tool is free instead of a refactor.
5. **Resume/tailoring features are post-v1.** The MCP server serves context; the calling
   model generates. No LLM, no API key, no backend on our side. See end of this file.

---

## Phase 0 — Confirm three decisions (before any code)

These change the work materially, so ask up front rather than assuming:

- **Vite SPA vs. Next.js static export.** Spec §2 says default to Vite. But spec §7a
  wants AI crawlers and research tools to find the data, and a Vite SPA ships one empty
  `index.html` with no per-company meta. Options: accept it, add a prerender step to the
  Vite build, or use Next.js static export. *Recommendation: Vite + a prerender step —
  keeps the spec's simplicity, solves the crawler problem.*
- **How filters treat unknowns.** With ~40 of ~55 companies missing size/location,
  selecting "21–60 people" could silently hide most of the dataset. Exclude them,
  or make "Unknown" a selectable option? *Recommendation: exclude, but name the
  exclusion in the result line ("12 of 55 · 31 with unknown size not shown").*
- **Size bands.** The design uses `1–20 / 21–60 / 61–200 / 200+`; the seed data's
  natural buckets are `11–50 / 51–200 / 200+`. A company marked "11–50" straddles two
  design bands. Reconcile toward the data's buckets, or store numeric midpoints.

---

## Phase 1 — Scaffold and design system

**Goal:** empty app that already looks like the design.

- Vite + React + TypeScript, React Router.
- Extract the design's OKLCH values into CSS custom properties. The design is 100%
  inline styles; production needs tokens. Surfaces ramp `0.16 → 0.195 → 0.21 → 0.26`
  at chroma ~0.008 hue 255; accent `oklch(0.78 0.14 162)`; hue 162 carries tracked /
  match / link states.
- IBM Plex Sans + IBM Plex Mono via `@fontsource` (self-hosted, no CDN dependency).
- Port the `style-hover` attribute pattern to real CSS — it's a DC-runtime invention,
  it doesn't exist in the browser.
- Port the two keyframes (`sp-in` slide-fade, `sp-fade`).
- Header (sticky, blurred) and footer shells.
- Dark mode only, no toggle.

**Verify:** dev server runs; header and footer match the design at mobile and desktop
widths.

---

## Phase 2 — Data layer

**Goal:** real seed data, validated, typed.

- TypeScript types from spec §3, with the additions identified in review:
  - `country: string | null` — separate from `hqLocation`, needed for the location filter
  - `sizeMin: number | null` / `sizeMax: number | null` — derived; the raw `sizeRange`
    strings (`"~45"`, `"Growth, $116M raised"`, `"Small, high-craft"`) don't parse
  - `lastVerified: string | null` — null for everything unverified
  - `history: HistoryEntry[]` — empty at launch for all companies
- Convert Set A (17 rows) to the schema.
- Convert Set B (~40 rows) with `lastVerified: null`, `history: []`, empty keywords,
  empty `currentOpenings`.
- **Dedupe before writing** — the merge key is `id`:
  - **Veriff** appears in both sets with conflicting sizes (spec flags this)
  - **Katana** appears in both — Set A "Katana MRP (Katana Cloud)" and Set B
    "Katana Cloud", same domain `katanamrp.com` (spec does *not* flag this)
  - **Tuum vs. Tuum Technologies** — spec warns they may be distinct entities. Ask.
  - Expected unique total: **55** from Sets A + B.
- **Watch list decision:** of the 16 watch-list entries, only 3 have domains
  (Creem, Cleveron, Ampler). The rest have no website, so they'd be near-empty records.
  *Recommendation: include the 3 with domains, hold the rest.* Ask.
- `careersUrl` for Set B has to be guessed (`website + /careers`) and will 404 often —
  leave null rather than guess wrong, and let the update script fill it later.
- `research.config.json` per spec §3, plus a **tech keyword vocabulary** the spec
  doesn't include but `detectedKeywords` depends on.
- Zod schema + a `validate` npm script, so the JSON can't silently rot.

**Verify:** schema validates; no duplicate ids; counts match expectations.

---

## Phase 3 — Scoring module

**Goal:** one implementation, three consumers (UI, `/api/search`, MCP).

- Pure TS module, no React import. This is the piece that must not be reimplemented.
- **Signature takes a token array**, not a query string. Tokenizing is the caller's job.
- Weighting — resolve the conflict first. Spec §5 says name highest, then keywords,
  then description/title. The design (`:566`) says stack tag 1.0, name 0.85, title 0.7,
  location 0.5, description 0.45. *For a product called "who's hiring your stack,"
  the design's ordering fits better — but the spec is the behavior authority. Ask.*
- Normalize to 0–100. Return both the score and the `why` strings — the design shows
  them as a tooltip on the match bar (`:112`).
- Companies scoring zero drop out when a query is present (design behavior).
- **Unit tests.** This is the one module that genuinely earns them.

**Verify:** tests pass, including unknown-field and empty-keyword cases.

---

## Phase 4 — Directory view

**Goal:** the main screen, working, shareable.

- Card grid per design `:86–120` — `minmax(min(100%,335px),1fr)`.
- Cards: initial tile (logo when `logoUrl` present, hue-derived initial as fallback),
  name, open-roles badge, status badge, stack chips with query hits highlighted,
  work model + country, match bar.
- Search input, work-model segmented control, location / size / sort selects.
- **Filter state lives in the querystring** so searches are shareable and linkable.
- Active filter chips, result line, clear actions.
- Empty state with reset + suggestion buttons (`:123–135`).
- **Unknown handling** — cards render country in the footer row (`:110`) and it can now
  be null. Needs a treatment that doesn't look broken.
- Copy pass: the design's search placeholder is fine; note the detail page's note
  placeholder ("Referral from Maya?") violates spec §1 and gets replaced in Phase 6.

**Verify:** every filter works; URL round-trips state; grid is correct at 375px and
1440px; unknown values render deliberately.

---

## Phase 5 — Company detail page

**Goal:** full record at a real URL.

- Route `/company/:id`. Deep-linkable — this matters for both humans and agents.
- Header, tile, description, site/careers links.
- **Verify badge now has three states**, not the design's two: fresh, stale
  (past `staleAfterDays`), and **never verified** (`lastVerified: null`, all of Set B).
  The third needs designing — it doesn't exist in the handoff.
- Meta grid (`:182`) — 4 cells, each of which can now be unknown.
- Positions: list, auto-categorized (design's regex at `:488`), category pills, capped
  at 5, "View all N" modal.
- **History chart — empty is the launch state.** Decide: 16 fixed slots mostly empty,
  or grow from one bar. *Recommendation: render only the weeks we have, with a
  "tracking since [date]" line, so it reads as honest rather than broken.* The design's
  `historyNote` prose ("Peaked at N, averaging X") has no data to narrate — needs
  replacement copy for the zero-history case.

**Verify:** deep link loads cold; all three verify states render; empty history looks
intentional; page works at mobile width.

---

## Phase 6 — BYO storage (real Upstash)

**Goal:** the one genuinely unbuilt feature in the handoff.

The design's `connect()` (`:863`) is a 700ms `setTimeout` with zero network. All of this
is new work.

- Modal per design `:369–451` — trust copy, numbered steps, both inputs, connected and
  disconnected states, disconnect/clear.
- Real Upstash REST calls from the browser. Credentials in `localStorage` only, never
  transmitted anywhere but Upstash.
- Key namespace design (notes, statuses, last search).
- **Resolve the design's inconsistency:** statuses persist to `localStorage`
  unconditionally (`:766`) but notes are gated behind connected storage (`:267`). Both
  should work locally and sync when connected — core browsing must not require storage
  (spec §6.4).
- **States the design lacks:** saving indicator, sync failure, reconnect, conflict.
- "My list" view (`:320–367`) with status grouping.
- Replace the persona-specific note placeholder.
- Security note for the modal copy: a full-privilege REST token in `localStorage` is
  XSS-exposed. Recommend a token scoped to a dedicated database, and never render
  untrusted HTML anywhere in the app.

**Verify:** connect a real free Upstash database; notes and statuses round-trip;
disconnect clears credentials and leaves the data in their Redis.

---

## Phase 7 — Deploy to Vercel

- Build config, prerender step if Phase 0 chose it.
- **Verify:** live URL, deep links resolve on cold load (SPA fallback configured).

---

## Phase 8 — Read-only JSON API (spec §7a)

- Vercel serverless functions — **required, not optional**: spec §7a hedges that
  serverless is only needed "if filtering has to happen server-side," and with
  `?keyword=&location=&remote=&minSize=&maxSize=` it does. Static files can't filter.
- `GET /api/companies`, `GET /api/companies/:id`, `GET /api/search?q=`.
- **Import the Phase 3 scoring module.** Do not reimplement.
- CORS open (public read-only data).
- `llms.txt` at site root + a human-readable API docs page.

**Verify:** curl each endpoint; `/api/search` ranking matches the UI's for the same query.

---

## Phase 9 — MCP server (spec §7a)

- `search_companies(query, filters)`, `get_company(id)`, `list_open_positions(filters)`.
- Wraps the Phase 8 API, reuses the Phase 3 scoring module.
- **Open decision:** local stdio package vs. remote HTTP endpoint on Vercel. §7a's
  framing ("any MCP-compatible assistant could query this live") implies remote.

**Verify:** connects from Claude Code; all three tools return correct data.

---

## After v1 — with the user, not solo

- **The update script** (spec §4). The largest and least-specified piece; everything
  else is a shell around data that goes stale in weeks. When we build it:
  - Detect the ATS and use its JSON endpoint. Several seed entries already name one
    (WorkOS → Ashby, Supabase → `jobs.ashbyhq.com`, Spacelift → `careers.spacelift.io`).
    Ashby, Greenhouse, and Lever all expose public JSON. First-party, stable, and it
    serves the spec's own "aggregators go stale" lesson better than HTML scraping.
    LLM/HTML extraction as fallback only.
  - `history` upserts by `weekOf` (ISO Monday) — re-running the same week must not
    duplicate.
  - Failure handling the spec omits: a 404 or timeout must leave `lastVerified` stale,
    **never** silently empty `currentOpenings` — a transient failure would otherwise
    look like "they stopped hiring."
  - Backfill size/location for the ~40 unknowns.
  - No interactive prompts — must stay GitHub-Actions-ready (spec §2).
- **Resume/tailoring context in MCP.** Server generates nothing; the calling model does.
  Adds `get_position_context()` (posting + company stack + hiring history) and
  `match_positions(skills[])`. Value comes from hiring history — signal no job posting
  contains. Resume stays pasted by the user; we never store it. Any shipped prompt must
  constrain to reorder/re-emphasize/reword, never invent.

---

## Sizing note

Phases 1–5 are the substance of v1 and each leaves the repo in a working state — safe
stopping points if usage runs short. Phase 6 is the biggest single chunk of net-new
work. Phases 7–9 are comparatively quick once the data layer exists.


---

## Build log — 2026-09-16

### Phase 0 decisions, as taken

- **Vite + React 19 + TypeScript + Tailwind v4.** Tailwind v4's CSS-first `@theme`
  takes OKLCH natively, which suits a design that is entirely OKLCH. **shadcn was
  not used** — the design is specific enough that a component library would have
  been fought rather than used.
- **Unknowns are excluded by an active filter, and the exclusion is named** in the
  result line ("31 with unknown size not shown"). Silently dropping ~40 unverified
  companies behind one click was the failure mode to avoid.
- **Size bands reconciled toward the data:** `1–10 / 11–50 / 51–200 / 200+`.
- **Prerendering deferred** to phase 7 as planned. The SPA currently ships one
  `index.html`; `llms.txt`, `/companies.json` and the API cover agent discovery,
  but per-company meta tags for human search engines still need the prerender step.

### Built

- **Phase 1** — scaffold, routing, and the full design-token layer extracted from
  the prototype's inline OKLCH into Tailwind `@theme` custom properties.
  Fonts self-hosted (Latin subsets only) rather than loaded from Google, since a
  CDN font request would leak every visitor's IP — inconsistent with the privacy
  claim the storage modal makes.
- **Phase 2** — `data/companies.json`, 58 companies, plus a JSON Schema.
  Veriff and Katana deduplicated. `tuum-technologies` dropped as a domain-less
  watch-list entry, with the ambiguity recorded in `tuum`'s `dataNotes`.
  Set B keywords are domain tags only — no company carries a technology nobody
  verified it uses.
- **Phase 3** — `src/lib/scoring.ts`. Spec §5 weighting (name highest). Takes a
  token array, so the future MCP `match_positions(skills[])` needs no refactor.
  Weights are an exported constant if the design-vs-spec ordering is revisited.
- **Phase 4** — directory view, filters in the query string, unknown-aware result
  line, empty state with suggestions drawn from the dataset's actual top keywords.
- **Phase 5** — company detail at `/company/:id`. Three verification states.
  History renders its empty state as the primary state. `hqLocation` often holds a
  work-model string rather than a place, so the meta grid shows normalized country
  and the raw research string appears separately as a location note.
- **Phase 6** — real Upstash REST integration, local-first: tracking and notes work
  with no database and sync when one is connected. Sync states (saving / saved /
  failed) that the prototype had no design for.

### Notable deviations from the prototype

- Native `<dialog>` for modals, so focus trapping, Escape and background inerting
  come from the platform. The prototype had no focus management at all.
- Visible `:focus-visible` rings and a skip link — the prototype had neither.
- `prefers-reduced-motion` honoured.
- Every external URL validated to http(s) before reaching an `href`.

### Phases 7–9, as built

- **Phase 7** — `vercel.json` with strict CSP, HSTS, `nosniff`, `frame-ancestors 'none'`
  and a restrictive `Permissions-Policy`; `cleanUrls` so prerendered company pages serve
  at extensionless paths. Prerendering emits 58 per-company HTML shells with real titles
  and meta descriptions. **Not yet deployed** — that needs the user's Vercel account.
- **Phase 8** — `/api/companies`, `/api/companies/{id}`, `/api/search`, `/api/positions`,
  plus a human-readable `/api` docs page and `public/llms.txt`. Written as Web Handlers so
  the shared `http.ts` decides the 405 shape rather than Vercel's router. Imports
  `src/lib/scoring.ts` directly — verified identical rankings to the UI.
- **Phase 9** — stdio MCP server in `mcp/`, SDK 1.30.x, exposing `search_companies`,
  `get_company` and `list_open_positions`. Calls the HTTP API with an 8s timeout and falls
  back to a build-time snapshot of the dataset, tagging every response `source: api` or
  `source: snapshot`.

### Verification performed

- `pnpm verify` — data validation, typecheck (app + API), lint, build: all clean.
- **API**: 29 checks against bundled handlers — filters, aliases, paging, clamping, 400 on
  bad input, 405 on POST, 204 on OPTIONS, 404 on unknown id, CORS, ranking order.
- **MCP**: 19 checks over a real stdio JSON-RPC session — initialize, tools/list, all three
  tools, input validation, and the snapshot fallback (forced by pointing at a dead port).
- **Security**: no `eval`/`Function`/`innerHTML`/`dangerouslySetInnerHTML` anywhere; no
  RegExp built from user input; no header or cookie reflection; no secrets server-side; all
  `target="_blank"` carry `rel="noopener noreferrer"`; localStorage access confined to one
  guarded wrapper; the API docs page interpolates no request input.

### Issues found in review, and resolved

Four things surfaced when checking the API/MCP work against the rest of the build:

1. **Filter rules were duplicated.** The API had reimplemented the
   exclude-and-count-unknowns rule because `src/lib/filtering.ts` imported a
   runtime value through the `@/` alias, which Vercel's Node runtime cannot
   resolve. Fixed at the root: `filtering.ts` and `types/filters.ts` are now
   alias-free, the rule lives in one `evaluateFilter`/`partition` pair, and the
   API imports it. Size stays band-shaped in the UI and numeric in the API —
   both convert to the same `SizeRange` primitive.
2. **`vercel.json` rewrite was fragile.** `/((?!api/).*)` did not exclude the
   bare `/api` path; it only worked because Vercel checks functions before
   rewrites. Now `/((?!api($|/)).*)`, verified against `/api`, `/api/x` and
   `/apiary`.
3. **Lint did not cover the new code.** `eslint.config.js` was scoped to
   `src/**`. It now has three type-checked blocks — app (browser globals),
   API and MCP (Node globals, own tsconfigs) — covering 46 files. Verified by
   planting a deliberate `any` and confirming it failed.
4. **History paths had never run.** Every `history` array is empty, so the chart,
   the API's history field and the MCP's 26-week cap were untested. Exercised
   with 30 synthetic weeks injected temporarily: API returns all 30 in order,
   the list endpoint omits them in favour of `historyWeeks`, MCP truncates to 26
   keeping the most recent, and the UI's summary reads correctly for both a
   populated and an all-zero series with bars inside the 74px container. Data
   restored afterwards.

### JSON API switched off before first deploy (user's call)

The API is built, tested and kept green, but **not deployed**. At 58 companies the
whole dataset is ~6 KB gzipped and the site never calls the API anyway — it bundles
the JSON at build time — so the endpoints were surface area without a user. Turned
off via `.vercelignore` rather than deleted:

- `api/` excluded from the Vercel upload, so no functions are created
- the API typecheck moved out of `build` (those files are not uploaded, so it would
  fail there) and into `typecheck` / `verify`, which run locally
- `api/` still typechecked and linted locally, and still bundled into the MCP
  server's offline path — so it cannot rot while switched off
- `llms.txt` no longer advertises the endpoints and says plainly they are not
  deployed; the footer points at `/companies.json` instead
- verified by removing `api/` entirely and confirming `pnpm build` still succeeds,
  which is exactly the condition on Vercel

Re-enabling is four steps, documented under "Enabling the JSON API" in the README.

While rewriting `llms.txt` I also removed a claim that the repository "includes a
standalone Node.js update script" — it does not exist yet, and telling agents
otherwise was untrue.

### Still open

- **Deploy** — `vercel`, then `pnpm set-site-url <url>` and rebuild the MCP server, since
  llms.txt and the MCP default API base ship with a placeholder domain.
- ~~**The update script**~~ — **built**, see "Updater" below.
  Constraint from the user: it runs locally, driven by Claude.
  That changes the shape from what is sketched below — no API key or LLM billing
  inside the script, because Claude Code is the runtime. The likely split is a
  slash command / skill that does the judgement work (is this a real engineering
  role, what stack does the posting imply, does this company already exist under
  another name) sitting on top of plain deterministic Node helpers for the parts
  that must be reproducible and safe: fetching, ATS detection, the merge/upsert
  by `id`, the `history` append keyed on `weekOf`, and validation. Decide that
  boundary explicitly before writing code — anything Claude decides is
  non-deterministic and must not be the thing that rewrites the dataset
  unchecked. Spec §2's "could later run unattended in CI" still holds, since
  Claude Code runs headless.
- **Only two countries** (Estonia, United States) populate the location filter,
  because research rarely stated an HQ and nothing was guessed. The update script
  backfilling size/location is what makes that filter genuinely useful.
- **`typescript` matches only 2 companies.** The dataset is currently domain-tagged,
  not stack-tagged, so stack search — the product's headline promise — is thin until
  the update script populates real stacks from careers pages.


---

## Updater — built 2026-09-16

`scripts/update/` plus `.claude/commands/refresh-data.md`. Deterministic Node
toolkit; Claude is the judgement layer on top of it.

### The split

Deterministic, in code — fetching (rate-limited, retried, timed out), job-board
detection and parsing, merge/upsert by `id`, the weekly history append, validation
of anything a model returns, atomic writes with backups.

Model judgement, via the slash command — researching gaps a scraper cannot resolve
(headcount, HQ country, work model), reading careers pages that are not on a
supported board, and deciding whether a discovered company belongs in the index.

The boundary is `lib/enrich.mjs`. Model output is treated as untrusted input: a
fixed allow-list of fields, type and range checks, https-only URLs, unknown company
ids rejected outright so enrichment can never create a record. Verified by feeding
it incoherent size bounds, a bad enum, an unknown id, an unknown field and a
`javascript:` URL — all five rejected with reasons.

### Commands

`status` · `refresh` · `discover` · `enrich` · `apply` · `history`.
Everything is a dry run until `--write`; every write backs up first.

### Invariants, verified

- A failed scan changes **nothing** — openings kept, `lastVerified` not advanced.
  This is the one that would silently destroy real data if wrong.
- History upserts on the ISO Monday: re-running in the same week updates that
  week rather than appending a duplicate; the next week appends; order is kept.
- A confirmed-empty scan **does** record `openCount: 0` — that is real signal,
  distinct from a failed read.
- `trust: primary` overrides existing values; `directory` only fills blanks.

### Sources — what actually works

Verified live: **Ashby** (`jobUrl`), **Greenhouse** (`absolute_url`), **Lever**
(`hostedUrl`) — each gives a direct per-position URL and a posted date, which is
what fills the `url` field the UI has always had but never had data for.
Workable, Recruitee, SmartRecruiters and Personio have best-effort adapters.

Discovery: the **yc-oss** YC mirror, 6,225 companies with a numeric `team_size` —
directly useful against the size gap.

Blocked, and handled by search instead of scraping: `ecosystem.startupestonia.ee`
is behind Cloudflare (403), and `startupestonia.ee/startup-database` loads its
data client-side through WordPress AJAX.

### Found during the build

Detection originally required a `careersUrl`, which meant **41 of 58 companies were
skipped outright**. But many are on a hosted board under their own slug —
pipedrive resolves on Lever (8 roles), testlio on Greenhouse (18) — so the
pre-skip was removed and the probe now runs whenever there is a website. The run
report also now separates "no job board found" (expected) from "board detected but
unreadable" (a fault worth looking at).


### Adapter review — two fixes after the agent's report

**SmartRecruiters could make a destructive claim.** It answers `200 / totalFound:0`
for a company that is not on the platform, so an empty board was indistinguishable
from a wrong token — and `[]` means "confirmed nothing open", which would wipe a
company's real openings. It now returns `null` for an empty result. The cost is that
a SmartRecruiters company with genuinely nothing open records no history point;
that is much the cheaper mistake. Verified: `careers.smartrecruiters.com/Visa`
(a real company not on the platform) now yields `null`, not `[]`.

**Workable probing had been switched off,** which silently dropped patchstack and
modash between runs. The stated reason was 429s, but the shared http client already
backs off on 429, and the agent's own analysis says Workable 404s cleanly — so it is
correctness-safe. Re-enabled, placed last in the probe order so it is only reached
after the three clean-404 platforms miss, with the probe budget raised 6 → 8 so the
second candidate token is not cut short. Both companies resolve again.

Null-vs-empty contract re-verified across four bad-token shapes (unknown domain,
bad Ashby token, bad Greenhouse token, SmartRecruiters non-member): all four return
`null`, none claims a confirmed-empty board.

### Live dataset after the first real run

269 positions (was 18), **264 with a direct link** (was 0), 22 companies with
positions, 19 accumulating history, 24 verified. Stack search works for the first
time: `typescript` 2 → 8 companies, `rust` 0 → 7, `go` → 14.

The five positions still without a link are the original hand-entered Set A roles
for companies with no findable board (framer, spacelift, loops) — preserved rather
than destroyed, which is the failed-scan rule doing its job.
