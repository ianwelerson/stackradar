# Project Handoff Spec — Dev Company Directory

Hand this whole document to Claude Code as the starting prompt/context for building v1.

---

## 1. What this project is

A public, searchable directory of tech companies and their open engineering positions.
It is a **generic, general-purpose research tool** — the dataset is not curated around
any one person's job search criteria, and no filter, field, or piece of UI copy should
assume a particular user's preferences (remote-only, a specific region, a specific
seniority level, a specific tech stack, visa/work-authorization status, etc.). Every
one of those is a **filter the user applies themselves** at browse time, not a
pre-baked constraint on the dataset. The dataset should include companies of every
size, remote policy, and location — onsite-only and enterprise-scale companies belong
in the data just as much as small remote-first startups; it's the user's filters that
narrow the view, not the data itself.

Anyone should be able to search/filter by keyword, tech stack, location, remote policy,
and company size, and see both current open positions and a lightweight history of what
roles a company has posted over recent months.

**This is a portfolio-quality public tool**, not a private script — it should be built
with the same care/polish bar as the companies it's cataloguing.

## 2. Architecture — read this before writing any code

- **No traditional backend/database for v1.** Company data lives in a JSON file (or a
  small set of JSON files) committed to the repo. The React app reads this data
  directly (bundled at build time or fetched from a static file) — no API server needed
  for the core browsing/search experience.
- **The React app and the data-update script are two separate things.** The app is a
  read-only consumer of the JSON. A standalone Node.js script (run manually via CLI for
  now) does the research/scraping and writes back to the JSON file. The person running
  it commits the updated JSON and pushes — normal git workflow, which then triggers a
  Vercel redeploy since the app just reads whatever JSON is in the repo at build time.
- **Design this update script so it could later run unattended in a GitHub Actions
  workflow** (cron schedule, opens a PR or commits the JSON update automatically) — but
  do **not** build the GitHub Actions workflow itself in v1. Just don't paint the script
  into a corner (e.g., avoid requiring interactive prompts) so that automation is a
  straightforward addition later.
- **Deployment target is Vercel.** Recommend a Vite + React SPA for simplicity, since
  there's no server-rendering need and no backend — keep the build simple. (Next.js is
  an acceptable alternative if it genuinely simplifies something, but default to the
  simpler option unless there's a clear reason not to.)
- **Dark mode only** — no theme toggle needed.
- **Design equally for mobile and desktop** — not a desktop layout with a squeezed
  mobile afterthought.
- Claude Design has already produced the visual design/layout for this — that hand-off
  file/reference should be treated as the source of truth for visual style, spacing,
  and component look; this document defines data, behavior, and functionality on top of
  that design.
- The data should also be consumable by other AI agents/assistants, not just human
  visitors in a browser — see Section 10 for the API/MCP layer that makes this
  possible.

## 3. Data model

Two kinds of data: the current/static record per company, and an append-only weekly
history log used to compute trends and charts.

### `companies.json`

```jsonc
{
  "companies": [
    {
      "id": "resend",                     // stable slug, used as the merge key for updates
      "name": "Resend",
      "logoUrl": "",                       // favicon or logo, can be derived from domain
      "description": "Developer-first email API platform — sending, deliverability, webhooks, audiences.",
      "website": "https://resend.com",
      "careersUrl": "https://resend.com/careers",
      "sizeRange": "45",                   // free text or a bucket like "11-50"
      "hqLocation": "United States",
      "remotePolicy": "remote",            // "remote" | "hybrid" | "onsite"
      "remoteRegions": ["Americas", "Europe"],
      "keywords": ["email", "developer-tools", "typescript", "react", "webhooks"],
      "currentOpenings": [
        {
          "title": "Product Engineer",
          "url": "https://resend.com/careers/...",
          "postedDate": "2026-08-20",       // best-effort, may be unknown
          "detectedKeywords": ["typescript", "react", "nextjs"]
        }
      ],
      "history": [
        {
          "weekOf": "2026-09-08",           // ISO date, Monday of that week
          "openCount": 1,
          "keywordCounts": { "react": 1, "typescript": 1, "go": 0 }
        }
      ],
      "lastVerified": "2026-09-16T00:00:00Z"
    }
  ]
}
```

**Notes on the schema, worth preserving in the build:**
- `history` only ever gets appended to, never rewritten — this is the append-only scan
  log that powers the per-company chart and the "no React roles right now, but 3 in the
  past 2 months" feature.
- The update script must merge into existing company records by `id`, never blindly
  overwrite the whole file — this matters once real users start relying on the data
  staying consistent between runs.
- `lastVerified` should be shown in the UI as a visible, honest badge — this data goes
  stale, and the UI shouldn't hide that.
- If a single `companies.json` file becomes unwieldy in size later, splitting into
  per-company files is a reasonable future refactor — not needed for v1 with the
  current company count.

### Config file for research parameters

A separate small config (e.g. `research.config.json`) should hold the parameters the
update script uses — this keeps "what counts as in-scope for discovery" adjustable
without touching code. At minimum:
```jsonc
{
  "discoveryKeywords": ["developer tools", "SaaS", "React", "TypeScript", "API platform"],
  "excludeKeywords": [],
  "minEmployeeCount": null,
  "maxEmployeeCount": null
}
```
Discovery is intentionally **fully open** — not limited to any one company category —
but this config exists so runs can be scoped/tuned without code changes.

## 4. The update script — behavior spec

Two modes:

1. **Refresh mode** — iterate existing companies in `companies.json`, visit each
   company's own `careersUrl` directly (not a job board aggregator — we've learned the
   hard way in manual research that aggregators go stale), extract current open
   positions, and:
   - Update `currentOpenings`
   - Append one new entry to `history` for the current week (upsert if an entry for
     that week already exists, so re-running the same week doesn't duplicate)
   - Update `lastVerified`
2. **Discovery mode** — search broadly (using the `research.config.json` parameters)
   for new companies not yet in the dataset, matching the same schema, and append them
   as new entries.

Both modes should be safe to re-run repeatedly without corrupting existing data —
merge/upsert semantics throughout, keyed by `id`.

## 5. Search & filtering — functional spec

Filters (per the design): **keyword/tech search, location, remote/hybrid/onsite,
company size range.** All filter dimensions come from the data itself — nothing
hardcoded to a specific list of companies or a specific person's job search criteria.
This is a general-purpose tool.

**Confidence score for keyword search** (v1, no ML needed):
- Weight a match in `name` highest
- Then `keywords` / matches in `currentOpenings[].detectedKeywords`
- Then a substring hit in `description` or a position `title`
- Sum weighted hits, normalize to a 0–100 display score
- Search should return combined results — a company can rank highly either because its
  general keywords match or because a currently-open position's detected keywords
  match; surface both signals.

## 6. Screens (per the Claude Design hand-off — recap for reference)

1. **Directory/browse view** — searchable, filterable grid/list. Each card is a
   compact summary only: logo, name, keyword/tag chips, remote/hybrid/onsite status,
   country, one-line description, and an open-positions-count badge. Full detail lives
   on the company page, not the card.
2. **Company detail page** — full record: size, HQ, remote regions, all current
   openings (linking out to the real careers page), `lastVerified` badge, and a
   weekly-granularity bar/line chart of open-position history over recent months
   (hover/tap a bar to see keyword breakdown for that week).
3. **Empty/no-results state** for search and filters.
4. **"Connect your storage" modal** (optional feature, BYO persistence):
   - Lets a user optionally connect their own **Upstash Redis** database (REST API,
     since plain Redis can't be called from a browser) to persist personal notes/
     selections across visits.
   - Credentials (REST URL + REST token) are stored **only** in the user's browser
     `localStorage` — the app itself never transmits or stores them anywhere else. All
     reads/writes to their Redis happen directly from the browser to Upstash's REST
     endpoint.
   - Modal content should include: a plain-language explanation of what it unlocks,
     an explicit trust statement ("we never see your data"), numbered setup
     instructions (create a free Upstash account → create a Redis database → copy the
     REST URL and REST token from the Upstash console → paste below), the two input
     fields, and a connected/disconnected state with a way to clear stored credentials.
   - This is optional and not required for core browsing/search to work.

## 7. Seed data for v1

Below is everything researched so far, from two separate research passes. Use this as
the initial content of `companies.json` (formatted to match the schema above) so the
app has real data from first run, not placeholders. **None of this is pre-filtered —
every company below belongs in the dataset regardless of its remote policy, location,
or visa/work-authorization terms; those are just data fields the app's filters will let
any user query however suits them.**

### Set A — verified directly on the company's own career page (high confidence)

| Company | Size | Description | Location / Remote | Website | Careers URL | Open role(s) found at verification time |
|---|---|---|---|---|---|---|
| Resend | ~45 | Developer-first email API platform | Remote, Americas/EU | resend.com | resend.com/careers | Product Engineer (role has since closed — re-verify current state) |
| Framer | Small-mid | React-based website design-and-code tool; editor, canvas, plugins, CMS | Remote-first | framer.com | framer.com/careers | Senior Product Engineer; also Staff Product Engineer, Tech Lead |
| Attio | Growth, $116M raised | AI-era CRM; React/TS frontend, Node backend | Remote — UK/US/Europe | attio.com | attio.com/careers | Product Engineer; Senior Product Engineer [Frontend]; Senior Product Engineer [Backend]; Staff Product Engineer |
| PostHog | Mid-size | Open-source product analytics; transparent public handbook | Fully remote, broad hiring (some country-specific EOR limitations noted in their own handbook) | posthog.com | posthog.com/careers | Multiple Product Engineer roles, rotates — some frontend-leaning, some backend/Rust-leaning |
| WorkOS | ~$2B valuation, $100M Series C | Enterprise-readiness infra — SSO, SCIM, Audit Logs, AuthKit, Feature Flags | Remote — US/Canada or "North American time zones" depending on listing | workos.com | workos.com/careers (Ashby-hosted) | Product Engineer – Feature Flags ($175K–$250K base); Product Engineer – Identity and Auth |
| Spacelift | 130+, $82M raised | Infrastructure-orchestration platform (Terraform/OpenTofu/Pulumi) | Remote — US/Europe | spacelift.io | careers.spacelift.io | Frontend Engineer (React) |
| Linear | Small, high-craft | Project/product development tool, used by 40,000+ companies | Remote-first — North America / Europe / Australia (varies by level) | linear.app | linear.app/careers | Product Engineer (NA, 2–5yr); Senior/Staff Product Engineer (US/Europe, 5+yr) |
| Supabase | ~400, $1B+ raised | Open-source backend-as-a-service (Postgres, auth, storage) | Fully remote, globally, no offices | supabase.com | jobs.ashbyhq.com/supabase | Frontend Engineer (Studio product) |
| Veriff | Growth, $175M raised (also appears at 600+ in a separate research pass — reconcile at verification) | AI-powered identity verification (YC, Accel-backed) | Hybrid — Estonia/Spain, relocation support offered | veriff.com | veriff.com/careers | Frontend Engineer / Senior Frontend Engineer / Senior Software Engineer |
| Loops | Small, YC-backed | Email-sending platform for SaaS products | Remote — US citizens/visa holders only | loops.so | loops.so/careers | Senior Frontend Engineer |
| Raycast | ~40, YC-backed | Productivity/launcher app with an extensions ecosystem | Fully remote | raycast.com | raycast.com/careers | None at last check (page stated no open positions) |
| Clerk | — | Auth/user-management infrastructure | Remote, global | clerk.com | clerk.com/careers | None posted at last check; page states they're opportunistically hiring Staff+ |
| Cal.com | ~40 | Open-source scheduling infrastructure | Remote, explicitly global/location-agnostic pay | cal.com | cal.com/careers | None confirmed open at last check |
| Katana MRP (Katana Cloud) | 51–200 | Cloud manufacturing/inventory management SaaS | — | katanamrp.com | katanamrp.com/careers | Frontend role found had already closed |
| Mintlify | ~65, YC-backed, $45M Series B | Developer documentation platform | Signals conflict — some sources say SF in-person, others show remote listings; needs direct confirmation | mintlify.com | mintlify.com/careers | Full-stack/frontend roles appeared on third-party boards; unconfirmed on primary source |
| Storyblok | — | Headless CMS (Vue/TypeScript/Vite stack) | Remote, international | storyblok.com | storyblok.com/careers | Senior Frontend Engineer II appeared on a Vue-specific job board; status unconfirmed on primary source |
| Svix | — | Webhook infrastructure (the tech underlying Resend's own webhook system) | Remote | svix.com | svix.com/careers | Current roles found were Rust-backend only |

### Set B — Estonia research pass (separate research session; none individually re-verified against primary sources yet)

Include with `lastVerified: null` so the UI can visually distinguish this batch from
Set A until each entry is checked against the company's own careers page.

**11–50 employees**

| Company | Approx. size | Description | Website |
|---|---|---|---|
| Flowstep | 10–20 | AI-powered design/product development platform | flowstep.ai |
| eID Easy | 2–10 | API platform for electronic identification and digital signatures | eideasy.com |
| Salv | 11–50 | RegTech platform for AML, fraud detection, transaction monitoring | salv.com |
| Fairown | 11–50 | Fintech/SaaS for product subscriptions, buyback, circular commerce | fairown.com |
| Patchstack | 11–50 | WordPress/open-source vulnerability intelligence and web security | patchstack.com |
| FleetFox | 11–50 | Fleet operations and service-management platform | fleetfox.eu |
| MyDello | 11–50 | Digital freight/logistics platform with instant shipping quotes | mydello.com |
| Cachet | 11–50 | Insurance infrastructure for gig/mobility/platform businesses | cachet.me |
| Timbeter | 11–50 | Computer-vision/cloud software for measuring and managing timber | timbeter.com |
| Lingvist | 11–50 | Adaptive language-learning software using learning analytics | lingvist.com |
| Multilogin | 11–50 / 50–200 (sources vary) | Browser-profile/anti-detect software | multilogin.com |
| BetterPic | ~10–50 | AI-generated professional imagery/headshots | betterpic.io |
| eAgronom | ~70 | Farm-management and agricultural sustainability/carbon platform | eagronom.com |

**51–200 employees**

| Company | Approx. size | Description | Website |
|---|---|---|---|
| Pactum AI | 130+ | AI-powered autonomous negotiation platform for enterprises | pactum.com |
| Modash | 51–200 | SaaS for influencer discovery, analytics, creator marketing | modash.io |
| Katana Cloud | 51–200 | Cloud manufacturing/inventory management SaaS | katanamrp.com |
| Tuum | 51–200 | Cloud-native core banking platform | tuum.com |
| Montonio | 51–200 | Payments, financing, ecommerce infrastructure | montonio.com |
| Xolo | 51–200 | Online company formation, accounting, financial platform | xolo.io |
| Jobbatical | 51–200 | Global employee relocation/immigration software | jobbatical.com |
| Blackwall | 51–200 | AI/web infrastructure, automated-threat protection | blackwall.com |
| CybExer Technologies | 51–200 | Cyber ranges, cybersecurity simulation, AI security | cybexer.com |
| R8 Technologies | 51–200 | AI/IoT building-management, energy optimization | r8tech.io |
| Estateguru | 51–200 | Property-finance/crowdlending fintech | estateguru.co |
| Bondora | 51–200 | Consumer-finance/investment fintech | bondora.group |
| Funderbeam | ~50–100 | Private-market investment/trading infrastructure | funderbeam.com |
| Erply | 100+ | Cloud retail/POS, inventory, CRM, ecommerce software | erply.com |
| Testlio | 100+ | Distributed software testing/quality platform | testlio.com |
| Scoro | 100+ | Work-management/business-management SaaS | scoro.com |

**200+ employees**

| Company | Approx. size | Description | Website |
|---|---|---|---|
| Veriff | 600+ | Identity verification and digital trust infrastructure | veriff.com |
| Pipedrive | 1,000+ | CRM and sales-management SaaS | pipedrive.com |
| Bolt | 1,000+ | Mobility, ride-hailing, delivery, micromobility | bolt.eu |
| Playtech (Estonia) | 1,000+ | Software/platform technology for the gaming industry | playtech.com |
| Wallester | 200+ | Corporate cards and payment infrastructure | wallester.com |
| Ridango | 150+ | Public-transport payment, ticketing, mobility technology | ridango.com |
| Skeleton Technologies | 200+ | Ultracapacitor energy-storage technology | skeletontech.com |
| Milrem Robotics | 200+ | Autonomous robotics and defence technology | milremrobotics.com |
| Starship Technologies | 500+ | Autonomous delivery robots and robotics infrastructure | starship.xyz |
| Threod Systems | 100+ | Autonomous unmanned systems and aerospace technology | threod.com |
| DefSecIntel | 100+ | Defence intelligence and autonomous systems | defsecintel.com |

**Watch list — smaller/early-stage, size and details less established at research time**

Creem (creem.io) — developer-focused payments/billing infrastructure ·
Avalonia — software/AI · Sera — SaaS/technology · Flashka — EdTech/AI ·
Handhold — SaaS · Leil — SaaS/technology · Wayren — SaaS/technology ·
Unicity Labs — Web3/infrastructure · Cino — fintech/software ·
Äio — biotech/food-tech · Clanbeat — EdTech ·
Tuum Technologies — decentralized identity (note: distinct from Tuum core-banking
company above; confirm this is not the same entity before adding both) ·
GScan — security/scanning technology · Cleveron (cleveron.com) —
robotics/automated retail · Kõu Mobility Group — mobility technology ·
Ampler (ampler.bike) — connected electric bikes

### Research resources — useful for discovery mode, not company data itself

These aren't companies to add, but sources the discovery mode of the update script (or
a person manually expanding the dataset) can draw from for Estonia specifically, and
as a model for building equivalent resource lists for other regions later:

- **Startup Estonia's official Startup Database** — startupestonia.ee/startup-database
  — government-run, ~1,000-1,500 companies, filterable by sector/technology/stage/size,
  sourced from Dealroom plus national tax/business registers.
- **Estonia Innovation Ecosystem** — ecosystem.startupestonia.ee/companies — a more
  advanced filterable interface over the same underlying Dealroom data.
- **Dealroom** — dealroom.co/countries/estonia — general-purpose filterable startup
  database (HQ, industry, funding stage, employee count, technology, growth, hiring).
  Reported ~613 funded Estonian startups at time of research.
- **Wellfound** — wellfound.com/startups/location/estonia — job-oriented rather than
  investment-oriented; shows company size, location, industry, and live job postings
  where available.
- **StartupBlink** — startupblink.com/top-startups/estonia — broad discovery tool
  (~1,183 companies at time of research); ranking mixes investment/employee
  count/traffic, so best used for surfacing names, not for quality signal.
- **Seedtable** — seedtable.com/best-saas-startups-in-estonia — SaaS-specific list,
  ~115 funded companies at time of research.

Worth noting for the update script's discovery mode: none of these give a definitive
"this company has an open engineering role" answer — they're good for finding
candidate companies, but every one still needs its own careers page checked directly,
same as Set A above.

## 7a. Agent/AI accessibility layer — making this data usable by other AIs

Beyond the human-facing UI, the dataset should be consumable by other AI assistants
and agents directly, so they can query it on behalf of their own users (e.g., a user
asking their own AI assistant "find me React roles at remote companies" and that
assistant pulling live data from this directory rather than guessing or scraping the
rendered page).

**A public, read-only JSON API.** Expose the same data as `companies.json` over plain,
documented HTTP endpoints:
- `GET /api/companies` — full list, supporting query params that mirror the UI's own
  filters (`?keyword=`, `?location=`, `?remote=remote|hybrid|onsite`, `?minSize=`,
  `?maxSize=`)
- `GET /api/companies/:id` — single company's full detail, including `currentOpenings`
  and `history`
- `GET /api/search?q=...` — keyword search using the same confidence-scoring logic
  described in Section 5, returning ranked results
This doesn't need a separate backend for v1 — since the underlying data is already
static JSON committed to the repo, this can be served as static files or simple
serverless functions on Vercel (serverless functions only really needed if
filtering/scoring has to happen server-side rather than being handed to the client).

**An MCP (Model Context Protocol) server.** This is the most direct way for an agent
like Claude to use the directory as a tool rather than just fetching raw JSON. A thin
MCP server wrapping the API above, exposing tools such as:
- `search_companies(query, filters)` — ranked matches
- `get_company(id)` — full company detail
- `list_open_positions(filters)` — a flattened view across all companies, useful for
  answering something like "what React roles are open right now across the whole
  dataset"
Any MCP-compatible assistant could then query this directory live as part of helping
its own user with a job search — the same kind of workflow this whole project grew out
of, just automated for anyone, not only the person maintaining the dataset.

**On AG-UI specifically.** AG-UI (the open protocol from CopilotKit) solves a
different problem than the one above — it standardizes how a *running agent's* state
and actions stream into a *live UI* in real time (e.g., an embedded chat/agent panel
inside an app, showing the agent's steps as it works). It isn't primarily a mechanism
for external AIs to pull structured data out of a site — that's what the API and MCP
server above are for. If there's ever a desire to embed an interactive "ask an agent
about this data" panel directly inside the directory app itself, AG-UI is the right
protocol to reach for then — but for the actual goal stated (letting other AIs use
this app's data to help their own users), the API + MCP server are the correct fit and
should be built first. Worth revisiting AG-UI specifically only if the project grows
toward having its own embedded agent experience later.

**Also worth considering: an `llms.txt` file.** A plain-text file at the site root,
following the emerging `llms.txt` convention, summarizing what the site is, what data
it exposes, and linking to the API/MCP endpoints. This helps general-purpose AI
browsing/research tools discover and correctly use the data even without a dedicated
MCP connector configured.

## 8. Explicit non-goals for v1

- No user accounts / auth beyond the optional BYO Redis connection
- No server-side database
- No automated scheduled runs (manual CLI only, but don't architect against it)
- No company-submission/"add a company" public form yet
- No light mode

## 9. Suggested build order

1. Scaffold the Vite + React app, wire up the Claude Design output as the base UI.
2. Load `companies.json` (seed data from Section 7 above, converted to the Section 3
   schema) and get the directory view + filters + search scoring working against
   static data.
3. Build the company detail page, including the history chart (weekly bars from the
   `history` array — seed a few synthetic history entries where we don't have real
   historical data yet, clearly, or leave `history` empty for unverified companies).
4. Build the "connect your storage" modal and Upstash integration (notes/selection
   persistence).
5. Build the standalone Node.js update script (refresh mode first, since it's better
   specified than discovery mode) as a separate, non-UI part of the repo.
6. Deploy to Vercel.
7. Add the agent/AI accessibility layer from Section 7a — the read-only JSON API first
   (it's a near-free addition once the data layer already exists), then the MCP server
   on top of it.

---

*This spec captures everything discussed and researched in the planning conversation
that preceded this build — data model, architecture decisions, screen requirements, and
all company data gathered so far, from two separate research passes (Set A and Set B in
Section 7). The dataset is intentionally broad and unfiltered — every company belongs
in it regardless of remote policy, size, or location; narrowing happens entirely
through the app's own filters at browse time, not through what gets included in
`companies.json`. Treat Section 7 as a starting dataset to refine and verify, not a
final authoritative source — several entries, especially all of Set B, still need
direct verification against the companies' own career pages. The dataset is also meant
to be consumed by more than just human visitors — Section 7a defines how other AI
agents can query it directly.*
