# Discovery sources — what works, what doesn't, and why

Companion to `RESEARCH-NOTES.md`. That file is about researching *one company*;
this one is about finding companies in the first place. Everything below was
probed live on 2026-09-17 — the HTTP codes and record shapes are measured, not
assumed. Re-probe before trusting any of it a year from now.

## The shape of the pipeline, and why it matters

Discovery and position scanning are deliberately separate jobs:

```
source → candidate {name, website, …} → refresh scan of the company's OWN site → openings
```

A discovery source's job is to hand over **a company name and its own domain**.
It is not to hand over jobs. The refresh scan then finds that company's real job
board (Ashby, Greenhouse, Lever, …) and takes the per-posting links from there.

This is why almost every rule below ends in "skip the candidate if you can't get
the company's own domain". An aggregator's link to a job is a link into the
aggregator — it rots when the listing expires, it hides the real employer, and
it defeats the one promise this directory makes, which is a direct link to the
posting. A candidate without a domain is a record nothing can ever fill in.

The single exception is Work at a Startup; see its section.

---

## Working sources

### `ycombinator` — the YC company directory

`https://yc-oss.github.io/api/companies/all.json`

One ~10MB document, every batch, one request per run. Community mirror of YC's
public list. Gives `team_size` as a real integer, `regions` containing
`Fully Remote` / `Partly Remote` (a cleaner remote signal than parsing the
location string), and `isHiring`.

Covers companies that *exist*. For companies that are *currently hiring*, see
Work at a Startup below — the two overlap but neither contains the other.

### `workatastartup` — YC's job board (companies AND positions)

`https://www.workatastartup.com` — an Inertia.js Rails app. **`robots.txt` is
`User-Agent: *` / `Disallow:` with an empty value: everything is allowed.**

This is the one source that is both a discovery source *and* an ATS adapter,
because for many YC startups the WAAS profile is the only public board they have.

Three endpoints, all public, no auth:

| what | request | gives |
|---|---|---|
| role feed | `GET /jobs?role=eng` as **HTML** | 30 jobs + `totalJobsCount` (2,844 for eng) in the `data-page` attribute |
| query search | `GET /jobs/search?q=<term>`, `Accept: application/json` | `{"jobs":[…]}`, 30 records |
| company profile | `GET /companies/{slug}` as **HTML** | `url` (website), `location`, `teamSize`, `industries`, `techDescriptionHtml`, and the company's `jobs` array |
| job permalink | `GET /jobs/{id}` as **HTML** | `descriptionHtml` and an explicit `skills` array |

Things that cost real time to work out:

- **A job's `applyUrl` is a YC login wall** (`account.ycombinator.com/authenticate?…`).
  It must never be stored as an opening's URL. The public permalink is
  `/jobs/{id}`, which carries the full description and a `skills` array.
- **`?page=N` does not work — on either form of the request.** Not on the
  server-rendered HTML, and not on an Inertia XHR carrying `X-Inertia: true` plus
  a matching `X-Inertia-Version`. Page 2 comes back with byte-identical job ids
  both ways. Do not spend time on it again.
- **Coverage comes from queries, not pages.** `/jobs/search?q=` is hard-capped at
  30 records (`&page=`, `&limit=`, `&hitsPerPage=` are all ignored), but different
  terms return largely disjoint companies — measured, `rust`/`python`/`frontend`/
  `devops` returned **93 distinct companies from 4 requests**. A vocabulary of
  search terms is the pagination substitute.
- **`/jobs` returns HTTP 406 for `Accept: application/json`**, including the http
  client's own default. It needs `text/html, application/xhtml+xml`. A 406 looks
  exactly like a dead board at the call site, so this is easy to lose. The
  `/jobs/search` endpoint is the opposite and wants JSON.
- **`profile.industry` is a hierarchy path, not a label** — Hive's reads
  `"B2B -> Marketing"`, which kebab-cases into an invented `b2b-marketing` tag.
  Use `industries` (the array) for keywords; `industry` is only haystack text.
- **US companies legitimately end up with `country: null`.** WAAS writes American
  offices as `"Seattle, WA"`, and a bare two-letter final segment after a city is
  a US state, not an ISO code — resolving it files Seattle under Western Australia.
  A fallback to posting locations was tried and removed: it answers where a company
  *hires*, not where it *is* (a New York company came out as India because all its
  eng roles are in Pune).

### `hnhiring` — "Ask HN: Who is hiring?"

The free, no-auth Algolia HN API. Two requests: find the threads, then read one.

```
GET https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring
GET https://hn.algolia.com/api/v1/items/<objectID>
```

This is the best source of **non-YC startups that hire remotely**, which no
directory covers. A live run over the September 2026 thread returned **60
candidates from 139 top-level comments** — 45 remote, 15 hybrid, all with the
company's own domain.

The convention is `Company | Role | Location | REMOTE | salary | url`, loosely
followed, and the parsing traps are all real comments from live threads:

- **Filter the thread titles.** The same author posts *"Who wants to be hired?"*
  (job seekers) and *"Freelancer? Seeking freelancer?"* in the same series. Match
  "Who is hiring" strictly or the directory fills up with individuals.
- **Never infer `country` from capitalisation.** An early version took the last
  capitalised comma segment and produced `country: "Denver"`, `"NYC"` and —
  from a comma-separated *tech stack* — `country: "Azure"`. It now matches only
  against a closed country table.
- **The first URL in a comment is often not the company.** Two companies
  resolved to `techcrunch.com` and `mercurynews.com`, because they wrote their
  own domain as bare text while linking a funding announcement. Others resolved
  to ATS tenants (`grnh.se`, `trinethire.com`). Hence the excluded-host list.
- **The first pipe field is not always the company.** One poster led with the
  office (`Cologne, Germany | UMH | Product Engineer | …`) and another used no
  pipes at all.

`keywords` is deliberately left empty — the position scanner owns that field,
and a technology named in a recruiting post is not evidence about the stack.

### `weworkremotely` — RSS category feeds

```
GET https://weworkremotely.com/categories/remote-programming-jobs.rss
GET https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss
GET https://weworkremotely.com/categories/remote-design-jobs.rss
```

25 items per feed, `robots.txt` allows everything but account paths. Titles are
`Company: Role`; split on the first colon.

Live run: 52 listings → **17 candidates, no false positives**. Recall is the weak
point and it is inherent, not a parser bug: **30 of 52 postings never link the
employer at all**, only the WWR listing page. Those are dropped rather than
stored with an aggregator link.

Two things to know:

- **The link found is usually a section, not the site.** Real hits today were
  `careers.toasttab.com`, `blog.gohighlevel.com`, `trust.huntress.com` and
  `learn.datadoghq.com`. `sources/host.mjs` strips that leading label — without
  it, `website` poisons every `/careers` probe downstream and the ATS detector
  starts guessing board tokens named "blog" and "trust".
- **It skews large.** Datadog, Discord, Pinterest, Fastly and ZoomInfo all came
  through. They are genuine remote employers, but if the directory is meant to
  favour startups and mid-size companies, this is the source that pulls the other
  way.

### `seeds` — the curated list in `research.config.json`

No network access at all. Reads `discovery.seeds.companies`, where each entry is
`{ name, website }` plus optional `country`, `hqLocation`, `careersUrl`,
`description`, `remotePolicy`, `note`.

This exists for ecosystems with no reachable feed — see Startup Estonia under
dead ends. It is also the right place to put a company someone simply wants
tracked.

**Verify every domain before adding it.** Of 46 candidates checked for the first
seed list, six were unusable and would have entered the dataset as permanently
unfillable records:

| domain | what was actually wrong |
|---|---|
| `zelos.team` | NXDOMAIN |
| `readyplayer.me` | NXDOMAIN |
| `icefire.ee` | DNS resolves, but nothing answers on 80 or 443 |
| `netgroup.eu` | redirects to a domain-reseller parking page — the domain is for sale |
| `sixfold.com` | redirects to `transporeon.com` — absorbed into the acquirer |
| `hotjar.com` | redirects to `contentsquare.com` — same |

**Every seed needs a `description`, and it must not be invented.** The dataset
schema requires a non-empty one, so a seed without it produces a record that
fails `validate:data` on the next build — which is how this was found, 38 rows at
once. The honest source is the company's own homepage: read its
`og:description`, falling back to `<meta name="description">`, and store that
verbatim. 39 of 40 seeds had one; the holdout (Helmes) publishes only a `<title>`.

`discover` now refuses to create a company with no description rather than
writing an invalid row, so a source that cannot supply one reports a skip instead.

That sweep also turned up a **dead company that the HTTP check had passed**:
`grunfin.com` returns 200, but the page it serves now says only *"Grünfin is
closed"*. A reachable domain is not a running company — read what the homepage
actually says before seeding it.

The check that catches the six dead domains, and is worth running on any new batch:

```sh
curl -sS -o /dev/null -L --max-time 15 -w "%{http_code}|%{url_effective}\n" "$url"
```

A `000` is dead. A 200 whose `url_effective` lands on a *different company's*
domain means the company no longer independently exists — which is a real
finding, not a reason to force the entry in.

---

## Dead ends — do not spend time here again

### Startup Estonia's database — Cloudflare, no way through

`startupestonia.ee` itself is a normal WordPress site and its REST API answers
(`/wp-json/wp/v2/types` → 200). **But the startup database is not in WordPress.**
The page at `/startup-database/` just links out to `ecosystem.startupestonia.ee`,
a white-label Dealroom portal with URLs shaped like
`/companies.startups/f/all_slug_locations/anyof_estonia/…`.

Every path on that host — including `/robots.txt` — returns **HTTP 403 with a
Cloudflare "Just a moment..." interstitial**. There is no public API behind it,
and no header combination tried got past the challenge. A headless browser might,
but that is a dependency this repo does not have and a fight with a bot-defence
system it should not pick.

**This is why the `seeds` source exists.** Estonian coverage is curated by hand,
which is honest about what we can actually reach.

### LinkedIn — forbidden by robots.txt

> "The use of robots or other automated means to access LinkedIn without the
> express permission of LinkedIn is strictly prohibited."

Settled previously; not revisited. Company location and headcount come from job
boards and company sites instead.

### `workinestonia.com` — job search is gone

`/job-search/` 301s to the apex and then 404s. The portal appears to have dropped
its job board. No robots.txt either.

---

## Evaluated, not adopted

### Remote OK — the API works, the data has no company domain

`https://remoteok.com/api` → 200, ~600KB, 100 records. Element `[0]` is a
legal/metadata object, not a job. `robots.txt` allows `/api` and asks for
`Crawl-delay: 1`, which the client's 1200ms per-host delay already satisfies.

**It returned 0 usable candidates on a live run, and that is a property of the
data, not the parser.** Every key on every record was checked: there is no
`company_url` field. `url` and `apply_url` are 100% links back to remoteok.com,
and `company_logo` was blank on every record sampled. Under the own-domain rule
that is an honest zero.

Descriptions carry an **anti-scraping honeypot** — `"Please mention the word
**FESTIVE** and tag RMjAwMTo1NmE6…== when applying"` was present in essentially
all 99 postings. Mining links out of the description was considered and rejected:
it would trade an honest empty source for guesswork.

The module is written and registered but **left out of `discovery.sources`**. It
checks for a real website field defensively, so it starts working by itself if
Remote OK ever adds one.

**It also carries an attribution duty**, quoted verbatim in the module header:
> "Please link back (with follow, and without nofollow!) to the URL on Remote OK
> and mention Remote OK as a source... If you do not we'll have to suspend API access."

That is a product decision about the site, not something a discovery module can
settle — which is a second, independent reason it is off.


### Himalayas — works, but wrong shape

`https://himalayas.app/jobs/api?limit=N` — a documented, cursor-paginated,
no-auth API returning **96,942 remote jobs**. It works, and `robots.txt` allows
`/jobs/api`.

Two reasons it is not wired in:

1. **No company website field.** A job record carries `companyName`,
   `companySlug`, `companyLogo`, and an `applicationLink` that points back to
   `himalayas.app/companies/{slug}/jobs/{slug}`. Getting the real domain means a
   second fetch per company, against a 96k-row feed.
2. **Low precision for this directory.** The first record returned was
   *"Sociology Teachers, Postsecondary"* — a contractor listing from an
   AI-training marketplace. The feed is broad employment, not engineering.

Worth revisiting if the volume is ever needed, with the category filter set hard
to engineering and dedup by `companySlug` before any profile fetch.

---

## How to evaluate a new source

In order, because each step can kill the source for free:

1. **`robots.txt` first.** `Disallow:` with an empty value means everything is
   allowed (that is Work at a Startup's). A 403 on robots.txt itself means a bot
   defence is in front of the whole host — stop.
2. **Does it give the company's own domain?** If not, it is a discovery source
   that cannot discover anything usable. Stop, unless the aggregator has public
   per-company profile pages carrying the domain, and the volume justifies the
   extra fetch.
3. **Look for machine-readable data before parsing HTML.**
   - A REST/JSON API. Check `/api`, `/wp-json/wp/v2/types`.
   - An RSS feed (We Work Remotely publishes one per category).
   - **Inertia.js**: a `data-page` attribute holding the page's whole props as
     escaped JSON. Sending `X-Inertia: true` plus `X-Inertia-Version` returns
     that JSON directly, no HTML parsing. This is how Work at a Startup works.
   - **Next.js**: `__NEXT_DATA__`, same idea.
   - An Algolia config in the page (`AlgoliaOpts`, `ALGOLIA_APP_ID`) — usually a
     scoped, *expiring* search key, so it has to be re-read each run.
4. **Send a browser-ish `Accept` header.** Work at a Startup returns **HTTP 406**
   for `Accept: application/json` and 200 for
   `Accept: text/html,application/xhtml+xml`. A 406 means the header, not the URL.
5. **Check licensing before writing the adapter, not after.** Some free APIs
   attach obligations — see the Remote OK note in its module header.
