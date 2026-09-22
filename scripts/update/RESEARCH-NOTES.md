# Research Notes — Stack Radar company data

Compiled after researching the 36 companies in `tasks/research-brief.tsv` on 2026-09-17.
Findings are in `tasks/research-results.json`. This file is the playbook for next time —
read section 1 before starting, then check the table in section 2 before re-researching
any of these 36 so you don't repeat dead ends.

## 1. How to research a company here

**URL patterns, in the order worth trying:**

1. Fetch the homepage first and ask explicitly for a **verbatim list of every nav and
   footer link** (href + text), not a summary. A summarized "is there a careers link"
   prompt sometimes misses it — e.g. Multilogin's careers link is a small footer icon
   row item that only showed up once the full link dump was requested.
2. Try `/careers`, `/careers/`, `/jobs`, `/career` on the main domain.
3. Try a **branded subdomain**: `careers.<domain>` or `careers.<parentbrand>.com`. This
   hit for Montonio, Blackwall, DefSecIntel, and Milrem (whose careers subdomain uses
   the parent brand `milrem.com`, not `milremrobotics.com`, the domain in our records).
   Worth trying before giving up on any "no careers link in nav" case.
4. If the site's own `website` field fails outright (DNS error), don't assume the
   company is dead — WebSearch the company name for its real domain first. Ampler's
   listed domain `ampler.bike` doesn't resolve at all; the real, live site is
   `amplerbikes.com`.
5. One WebSearch for `"<company>" careers jobs` can surface a real own-domain URL that
   isn't linked from the homepage nav (DefSecIntel's Estonia-search style, Tab's
   `jobs.tab.travel`, Wefunder's `/jobs`). Always re-fetch the URL directly to verify
   before trusting the search snippet — search summaries paraphrase and occasionally
   hallucinate specifics.

**Telling a real careers page from a soft-404 / redirect:**

- A hard `HTTP 404` from WebFetch is a clean, reliable negative — trust it.
- Watch for **redirects to a different domain** — that's an automatic reject per the
  brief, even when the destination is clearly a sibling/parent company:
  - `betterpic.io/careers` → 301 → `runflow.io/careers` (Runflow is a spin-out of
    BetterPic's own infra, same founders, different domain — still rejected).
  - Multilogin's footer "Careers" link points straight to a LinkedIn page.
  - `careers.multilogin.com` → 301 → `careers.eyesofwonder.dev` (their recruiting
    brand, apparently) — but this one also has a **TLS certificate mismatch**, so it's
    doubly unusable.
- Watch for **thin placeholder pages** that return 200 OK but have essentially no
  content: Ampler's `/en/jobs` (and its alias `/pages/jobs`) is just a one-line tagline
  and a newsletter signup form — no job list, no "why work here" copy. MyDello's
  `/career/` is similar (one sentence + an email address). These technically load but
  don't meet "lists jobs or describes hiring" — read the *full* page text before
  accepting a 200 as a pass.
- A real careers page with **zero current openings is still valid** if it's a genuine,
  functioning ATS/portal (Montonio: "No matching jobs" on a live branded ATS subdomain;
  Zentail: explicitly says "not actively hiring" but describes a talent-pool process).
  The bar is "real page describing hiring," not "currently has openings."
- **JS-rendered / SPA sites**: Funderbeam's `/careers` returned only a client-side
  investment-risk disclaimer banner on every fetch attempt (twice, with different
  prompts) — the real content is presumably rendered by JS that WebFetch's
  HTML→markdown conversion never sees. No workaround found with this toolset; treat as
  a dead end and flag for a headless-browser follow-up rather than guessing from the
  fragment you get.
- **Whole-domain 403s** (not just `/careers` — the homepage itself) mean bot/WAF
  protection (Tuum, Wefunder both 403'd on every path tried, including the bare
  homepage). WebSearch can sometimes surface the real URL and even a content snippet
  via Google's index, but that's not "verified by fetching" per the brief's bar —
  record it as unverified rather than trusting the search summary.

**Work model — what's a real signal vs. what looks convincing but isn't:**

- **Trust**: one explicit, general, company-wide sentence — "we have a remote-first
  setup for the majority of our team" (Xolo), "work from the office, remotely, or a mix
  of both" (Scoro), "we have no physical headquarter" (Cal.com, relevant for country
  too).
- **Don't trust**:
  - A single job posting's location/work-type tag. Multiple postings with the *same*
    tag is still job-level data, not a policy statement — Blackwall has 5/5 open roles
    tagged remote, but there's no "we are a remote company" sentence anywhere, so it was
    left unset.
  - A *spread* of different per-role numbers is actually good evidence there's no
    single policy: Bolt's own job postings each specify a different office-day quota
    (12 days/month up to 4 days/week depending on role) — that's clearly hybrid in
    practice but not one confirmable value, and forcing "hybrid" would be a guess about
    which number represents "the policy."
  - An **employer-brand award badge** whose title contains the word "remote" — Cleveron
    displays a "Remote Work Pioneer" badge alongside "Equal Pay Employer" and similar
    accolades. That's a certification/award, not a description of how employees
    actually work today. Always read the sentence *around* a badge before accepting it.
  - Governing-law clauses in a Terms of Service. Cal.com's ToS says "governed by the
    laws of the United Kingdom," and the entity name "Cal.com, Inc." suggests a US
    corporation — neither is the company's HQ; their own About page says outright they
    have none. Legal boilerplate is a bad proxy for where a company is based.
  - General "flexible working" / "work-life balance" language (Lingvist, Milrem) that
    never actually commits to remote, hybrid, or onsite as a word.

**Country / size signals:**

- Best source found: a **registered legal address in the Terms of Service / Privacy
  Policy** (Raycast: exact street address in Altrincham, Cheshire, UK). Much more
  reliable than homepage marketing copy.
- Manufacturing/production claims ("every Ampler is handcrafted in Estonia") describe
  where the *product* is made, not necessarily an HQ — don't conflate the two.
  (Ampler's country was already on file and wasn't in scope this round, but worth
  remembering for next time.)
  - Team-size figures are hard to find: most "About"/"team" pages name leadership
  individuals or describe departments qualitatively (Cleveron, Giveffect) without ever
  giving a total headcount number. An explicit "we're a team of X" sentence is rare —
  don't count leadership headshots or department lists as a headcount signal.

## 2. Per-company table

| id | careersUrl found | ATS/platform | Hiring now? | Note |
|---|---|---|---|---|
| raycast | `https://raycast.com/careers` (already on file) | custom | Yes | "100% Remote," team of 40 across 17 countries. Country confirmed as UK via ToS registered address. |
| cal-com | `https://cal.com/careers` (already on file) | custom | Yes | About page: "We have no physical headquarter and don't plan to have one" — fully distributed, no country to record. |
| flowstep | `https://flowstep.ai/about#careers` | custom (embedded in About page) | Yes, 3 roles | No standalone `/careers` URL — content lives on `/about`. |
| eid-easy | none | n/a | Unknown | No careers link anywhere in nav/footer (confirmed via full link dump); `/careers`, `/jobs`, `/career` all 404. |
| fairown | none | n/a | Unclear | No careers page found anywhere (homepage, /about, /for-you, /faq all checked). About page mentions "growing our data and engineering team in Tallinn" but no link. |
| mydello | `https://mydello.com/career/` (already on file) | custom placeholder | Unclear | Page is one sentence + an email address, no real listings. |
| cachet | `https://cachet.me/en/careers` | custom | Yes, 2 roles | Tallinn-based roles, no remote/hybrid statement. |
| timbeter | none | n/a | Unknown | No careers link anywhere (confirmed via full nav/footer dump); `/careers`, `/jobs`, `/career` all 404. |
| lingvist | `https://lingvist.com/jobs/` (already on file) | custom | Passive | Real page, no open roles listed, generic "send your CV" invite. |
| multilogin | none confirmed | possibly Ashby/Greenhouse under "Eyes of Wonder" brand — unconfirmed | Appears yes (per third-party) | Footer "Careers" → LinkedIn (rejected). `careers.multilogin.com` → redirects to `careers.eyesofwonder.dev`, which has a TLS cert mismatch — unverifiable. |
| betterpic | none | n/a | No (folded into sibling co.) | `/careers` 301s to `runflow.io/careers` — different domain, rejected. Runflow = spin-out of BetterPic's own AI infra, same "Better Group" parent. |
| tuum | none confirmed | unknown (WordPress-style "Careers Archive" per search) | Yes (per search) | Entire domain 403s to WebFetch on every path (homepage included) — WAF/bot protection. Google indexes `tuum.com/careers/` and a hybrid-Tallinn job page, but couldn't verify directly. |
| montonio | `https://careers.montonio.com/` | own branded subdomain | No open roles currently | Real, live ATS; "No matching jobs" right now. |
| xolo | `https://www.xolo.io/zz-en/careers` (already on file) | custom, links out for actual applications | Unclear count | Confirmed remote-first (hybrid option for Estonia-based staff only). |
| blackwall | `https://careers.blackwall.com/` | subdomain ATS (platform not identified) | Yes, 5 roles | All roles individually remote-tagged; no company-wide statement. |
| cybexer-technologies | none | n/a | Unknown | No careers/jobs link anywhere in nav or footer (confirmed via full footer dump: About, Media/Press Kit, Contact, Partner Program — no Careers). |
| r8-technologies | `https://r8tech.io/careers/` (already on file) | custom | Yes, 4 roles | 3 Tallinn + 1 Germany-remote; mixed per-job, no company statement. |
| funderbeam | `https://www.funderbeam.com/careers` (already on file) | unknown — JS-rendered | Unknown | WebFetch only ever returns a client-side investment-risk disclaimer banner, twice, with different prompts — likely a JS/SPA page invisible to this tool. |
| erply | `https://erply.com/careers` (already on file) | custom | Unclear | Mentions Tallinn & NY offices with amenities (gym, massage room); no explicit remote/hybrid statement (third-party sources call it hybrid, but that's not admissible). |
| scoro | `https://careers.scoro.com/` | subdomain ATS | Yes | Confirmed hybrid: "work from the office, remotely, or a mix of both; UK/US colleagues work fully remotely." |
| bolt | `https://bolt.eu/en/careers/` (already on file) | custom (own paginated job board) | Yes, many roles | Individual postings each specify a *different* office-day quota (12/month up to 4/week) — clearly hybrid in practice, but no single confirmable company-wide number. |
| playtech-estonia | `https://www.playtechpeople.com/country/estonia/` | custom branded portal (playtechpeople.com) | Yes | Estonia-specific page: 700+ specialists across Tartu/Tallinn offices. |
| milrem-robotics | `https://careers.milrem.com` | own subdomain (parent brand `milrem.com`) | Yes | Only one role tagged "Hybrid"; no company-wide statement. |
| threod-systems | `https://www.threod.com/careers/` (already on file) | WordPress-style job archive | No — empty | Page loads fine but says "Nothing found - sorry, there are no posts here yet." Worth re-checking later since the infra works, it's just empty right now. |
| defsecintel | `https://careers.defsecintel.com/` | own subdomain ATS | Yes, 5 roles | Mixed hybrid/onsite/unspecified per role; no company statement. |
| cleveron | `https://cleveron.com/es/join-the-team/` (already on file) | custom | Yes (unspecified count) | "Remote Work Pioneer" is an employer-award badge, not a policy description — don't mistake it for remotePolicy. No headcount found. Alternate English URL `www.cleveron.com/careers` exists and might be worth checking for richer content next round. |
| ampler | none confirmed | n/a | Unclear | **Website on file (`ampler.bike`) doesn't resolve — real domain is `amplerbikes.com`.** Its jobs page is a thin placeholder (tagline + newsletter signup only, no listings). |
| onesignal | `https://onesignal.com/careers` | links out to external job board (unidentified) | Yes | Great Place to Work messaging; "Open roles: Remote & in-person" section. |
| streak | `https://streak.com/careers` | custom | Yes, 1 role | Staff UI Engineer, Remote North America. |
| mixrank | `https://mixrank.com/careers/` | links out to `app.dover.com/jobs/mixrank` (Dover) | Yes | Explicitly states "a fully-remote data-as-a-service company" — clean remotePolicy=remote fact, not requested this round, worth grabbing next pass. |
| zentail | `https://zentail.com/careers` | custom | No — talent pool only | Explicitly "not actively adding new team members right now." |
| etleap | `https://etleap.com/careers` | custom | Yes, 6 roles | Mixed "In person" (SF, London) and "Remote" (LatAm, US) by role; no company statement. |
| wefunder | none confirmed | unknown | Yes (per search) | Entire domain 403s to WebFetch on every path tried, including bare homepage and both `/jobs` and `www.wefunder.com/jobs` — WAF/bot protection. |
| piinpoint | none | n/a | Unclear | Homepage's only "careers" link is `angel.co/company/piinpoint/jobs` (third party, rejected); `/careers` and `/company/careers` both 404 on their own domain. |
| giveffect | `https://giveffect.com/careers` | custom | Yes, 9 roles | Salary ranges posted; restricted to NY/NJ/GA/CA candidates. No headcount found. |
| tab | none confirmed | possibly Otta/WTTJ per third-party listings — not their own domain | Yes (per search, London office) | `tab.travel` 302s to `business.tab.travel`, which has no careers link and `/careers` 404s. `jobs.tab.travel` exists per search but has a TLS cert mismatch (unverifiable). `careers.tab.travel` doesn't resolve. |

## 3. Dead ends (don't blindly retry these)

- **Whole-domain 403 (WAF/bot-blocked)**: `tuum.com` (every path, including the bare
  homepage) and `wefunder.com` (homepage, `/jobs`, `www.wefunder.com/jobs`). WebSearch
  found plausible real URLs for both (`tuum.com/careers/`, `wefunder.com/jobs`) but
  content could not be verified by direct fetch.
- **JS-rendered, invisible to WebFetch**: `funderbeam.com/careers` — returns only a
  client-side disclaimer banner, tried twice with different prompts.
- **TLS certificate mismatches**: `careers.eyesofwonder.dev` (Multilogin's redirect
  target) and `jobs.tab.travel` — both fail to load with a cert error, can't be
  verified with this toolset.
- **DNS failure on the domain in our records**: `ampler.bike` — real site is
  `amplerbikes.com`.
- **Redirects to a different company's domain (auto-reject)**: `betterpic.io/careers`
  → `runflow.io/careers`; Multilogin's footer "Careers" link → LinkedIn.
- **No careers presence found anywhere** (homepage, About, common path guesses, full
  nav/footer link dumps all checked): eID Easy, Fairown, Timbeter, CybExer
  Technologies, PiinPoint.
- **Real page, no substantive content** (200 OK but effectively empty): Ampler's
  `/en/jobs` and `/pages/jobs`, MyDello's `/career/`, Threod Systems' `/careers/`
  ("Nothing found").

## 4. Uncertain / judgment calls — flagging explicitly

- **Xolo → `remote`**: their own careers page says "remote-first setup for the majority
  of our team," but Estonia-based staff get a hybrid option at Tallinn/Tartu hubs.
  Classified as `remote` since that's the stated default, but it's genuinely a mixed
  policy and a reasonable person could argue for `hybrid` instead. Flagging so it's not
  taken as unambiguous.
- **Scoro → `hybrid`**: "work from the office, remotely, or a mix of both" reads as an
  intentionally flexible policy; `hybrid` seemed like the best single-word fit but
  `remote` is arguably also defensible given the phrasing puts remote first and calls
  out UK/US as fully remote.
- **Ampler careers page rejected**: this is a closer call than most "none found" —
  the page does exist, is titled "Careers at Ampler," and has a one-line mission
  statement. I judged a tagline + newsletter signup with zero job content as not
  meeting "lists jobs or describes hiring," but a looser standard might accept it.
- **Zentail and Montonio careers pages accepted despite no open roles**: both are real,
  functioning pages that describe the hiring process (talent pool / live ATS) even
  though nothing is open right now. Flagging in case the intended bar is stricter
  ("must have an actual open job listed").
- **Playtech-Estonia careersUrl**: used the Estonia-specific sub-page
  (`playtechpeople.com/country/estonia/`) rather than the generic global careers
  domain, since the company record is specifically "Playtech (Estonia)." This is a
  judgment call about which URL best represents "this company's" careers page when the
  parent company is huge and global.
- **MixRank's explicit "fully-remote" statement** was found but *not* submitted as a
  fact because `remotePolicy` wasn't in MixRank's `missing` list for this round —
  noted in the results file and this table instead so it isn't lost.

---

## Round 2 — 2026-09-18: discovery at scale

The dataset went 83 → 283 companies and 679 → 2,853 positions in this round, from five
discovery sources instead of one. `SOURCES.md` covers the sources themselves; what
follows is what the scale-up taught us about *verifying* what they bring back.

### False positives are the failure mode at scale, not missing data

With 83 companies, a bad detection was visible. With 283 it is not, so three guards
were added after each caught a real, live example:

1. **A board named only on the company's bare homepage must produce at least one
   posting to count.** `bymason.com` links `masonamerica.bamboohr.com` — a different
   company. That board loads and is empty, so the scan was about to record "Mason has
   no openings" and wipe four real ones. A board linked from the company's own
   `/careers` keeps the stronger reading, so a genuinely empty one (Montonio) still
   registers as confirmed-empty.
2. **Section labels are never board tokens.** Operations1's site is
   `career.operations1.com`, so the slug probe took `career` as the company's token and
   matched `lever/career` — a stranger's test account holding one posting titled
   *"Test Job"*, dated 2024. `career`, `blog`, `trust`, `learn` and friends are now in
   `RESERVED_TOKENS`, and `sources/host.mjs` strips them from a mined URL before it is
   ever stored as `website`.
3. **A mirror must never outrank a first-party board.** Discovery writes a company's
   Work at a Startup profile into `careersUrl`, which short-circuited detection at step
   1 — Hive would have been stored with YC mirror links instead of its own Ashby board.
   Work at a Startup is now a deferred fallback, used only when nothing first-party
   turns up.

When checking a suspicious detection, **fetch the board's API directly and read the
job titles**. "Test Job", a single posting, or a 2024 date on a board that should be
active are all tells. Note that "Demo" in a title is *not* — Ironclad's "Demo
Engineer", HighLevel's "Demo Specialist I" and Keeper's "Senior Demo Platform Engineer"
are all real roles.

### A domain answering 200 is not a running company

The seed list was screened with `curl -L -w "%{http_code}|%{url_effective}"`, which
correctly caught two NXDOMAINs, one host that resolves but answers on no port, one
domain sitting on a reseller parking page, and two that redirect to an acquirer.

It did **not** catch Grünfin. `grunfin.com` returns a clean 200 — and the page says
only *"Grünfin is closed"*. Read what the homepage actually says before adding a
company; the status code only tells you the DNS and the server are alive.

### Descriptions must come from the company, and the schema enforces it

38 records were written with an empty `description`, which fails `validate:data` — the
schema requires a non-empty one. There is no honest way to synthesise it, so the fix
was to read each company's own `og:description` (39 of 40 publish one; Helmes has only
a `<title>`). `discover` now refuses to create a company without a description rather
than writing a row that fails the next build.

---

## Round 3 — 2026-09-19

### A vendor's own asset host can outvote the real board

`scanMarkup` resolves an embedded board by picking the **most-referenced**
`(platform, token)` pair on the page. That is the right heuristic for a careers
page that mentions one board twenty times and another once — but it broke on
Teamtailor boards running on a **custom domain**.

A Teamtailor board serves its assets from `app.teamtailor.com`, which therefore
appears dozens of times in the markup. The only thing naming the *real* host is
the single "powered by" link carrying `utm_content=<host>`. Dozens beat one, so
the token resolved to `app`, the adapter looked for a board called "app", and
the company came back as **"no job board found"** despite having a perfectly
good JSON feed.

Fixed by adding `app` and `cdn` to `RESERVED_TOKENS`. Immediately unlocked:

| company | board | openings |
|---|---|---|
| thorgate | `teamtailor/jobs.thorgate.eu` | 1 |
| fractory | `teamtailor/careers.fractory.com` | 10 |
| blackwall | `teamtailor/careers.blackwall.com` | 12 |

Blackwall is the clearest case of the damage: round 1 recorded it as "subdomain
ATS (platform not identified), 5 roles" and left it at that. The platform was
Teamtailor all along — detection just could not name it, so a readable board sat
unread for two rounds.

**The general lesson:** when a company's careers page clearly *is* an ATS board
but the scan reports nothing, check what token detection actually picked before
assuming the adapter is broken. Fetch `https://<host>/jobs.json` directly — if
that returns a JSON Feed with items, the board is real and the problem is
detection, not the company.

### `careers.<domain>` is worth probing in bulk, with one guard

Sweeping `careers.<host>` and `jobs.<host>` across the no-board companies is
cheap and found four real boards out of 50. But **two of the eight 2xx hits were
wildcard DNS**: `careers.pocketsuite.io` and `jobs.yooli.co` both answer 200 and
then redirect to the company homepage. They are not careers pages.

The test that separates them is the *final* URL, not the status code:

```sh
curl -sS -o /dev/null -L --max-time 8 -w "%{http_code}|%{url_effective}" "https://careers.$host"
```

If `url_effective` has fallen back to the bare apex, reject it. If it stays on
the `careers.`/`jobs.` host, it is worth reading.

### More award badges, as predicted

Round 1 flagged Cleveron's "Remote Work Pioneer" badge as an employer award
rather than a policy. The same trap turned up again on **Doist**, whose careers
page carries "Best Remote Team Culture" and "Remote Excellence Awards" — both
prizes, neither a statement about how the company works. `careersUrl` recorded,
`remotePolicy` deliberately left null.

Confirmed the opposite way on two companies, where the firm states its own
arrangement in its own words and the fact is clean:

- **Toggl** — "Fully remote since 2014" on `toggl.com/jobs/`.
- **MixRank** — careers page titled "the best 100% remote data company"
  (the follow-up round 1 flagged; both turned out to already hold `remote`,
  independently derived from their job postings, so this only corroborated it).

### Re-checks that produced nothing (don't redo these next round)

- **threod-systems** — careers page still "Nothing found, there are no posts
  here yet". The infrastructure works; the board is genuinely empty. Third time
  it has been checked.
- **cleveron** — the alternate English URL `www.cleveron.com/careers` just
  redirects to `cleveron.com/es/join-the-team/`, the page already on file.

### Round 3 research batch — 40 companies, 30 with facts

Confirmed 27 careers URLs, 12 countries, 8 work models and 8 headcounts, all at
primary trust. Two headcounts were spot-checked against the source and matched
verbatim: Automattic *"We're 1,416 Automatticians in 83 countries"*, Plausible
*"Today Plausible is a team of 10."*

**One submitted fact was rejected on review — worth knowing the shape of it.**
`cyberatlas.ai/careers` 301s to the homepage, and that homepage contains the
text *"0 Jobs / Active Jobs / Clear completed / No active jobs"*, which reads
convincingly like an empty ATS board. It is not: CyberAtlas sells security
scanning, and that is the **product's own job-queue widget**. A page whose
"jobs" are the product's jobs is not a careers page. Check what the company
sells before reading a jobs widget as a hiring board.

#### Confirmed dead ends (do not re-research these)

| id | why |
|---|---|
| openalex | whole-domain HTTP 403 on every path; `ourresearch.org` 301s into the same block. Same WAF pattern as tuum and wefunder |
| quill | fully client-rendered SPA — only a bare `<title>` is reachable |
| jawa-gg | site is a Notion page (`jawagg.notion.site`), no readable content |
| proxybase | no careers link anywhere; `/careers` 404s |
| furtim-modus | one-page site, no careers link, no location |
| solution-street | "Join Us" is a nav dropdown, not a URL; `/join-us/` and `/who-we-are/` both 404 |
| trustworthy-technology | small advocacy site, no careers link, no location |
| ondeckglobal | thin/placeholder site — its own "Facts & Figures" shows literal 0s for every stat; `/about` 404s |
| sportlyzer | no careers page; `careers.sportlyzer.com` does not resolve |

#### Judgment calls where a fact was available but not good enough

These are the reason the round is trustworthy, so they are worth preserving:

- **Strapi and Prisma** both have US-registered entities (Strapi Inc., Dover DE;
  Prisma Data, Inc.) but describe themselves as fully distributed. A Delaware
  registered-agent address is an incorporation artefact, not an office — the same
  trap as reading Cal.com's governing-law clause as an HQ. Country left null.
- **Directus** *was* recorded as United States, on a stronger signal: its ToS
  gives a specific street address (New Haven, CT), which is the Raycast precedent.
- **Appwrite** — privacy policy names "Appwrite Code Ltd." and references GDPR
  transfers to Israel. Suggestive, never stated. Omitted.
- **Messente and Proekspert** — "total flexibility", "work where you like and how
  you like". Never commits to remote/hybrid/onsite. Omitted, correctly: this is
  the section-1 trap.
- **Deya** — "NYC / Hybrid / Remote" appears on all three postings, but that is
  job-level tagging, not a company HQ statement.
- **Wise** — only a "Flexible working" nav link, and postings are tied to office
  hubs. No work model recorded.
- **No keywords were submitted for any company.** Not one of the 40 stated its
  engineering stack in its own words; the only candidates were product copy
  ("rebuilt in native TypeScript", "REST + GraphQL APIs"), which describes what
  they sell, not what their engineers use. The job-board scanner fills this
  field properly from real postings.

#### URL patterns that paid off again

`careers.<domain>` (Lightyear, DAT), `jobs.<domain>` (Channable, Wise), and an
ATS on a branded subdomain (`elcogen.jobs.personio.com`). Also: **record the
company's own `/careers` URL even when it forwards to a third-party ATS** — Deno's
`deno.com/jobs` lands on Ashby, and the own-domain URL is the one that keeps
working when they switch vendors.

#### One fix for a future pass

**mingla** — the `website` on file (`mingla.com`) 302s to `mingla.io`. Same
company, not a hijack, but the record should point at the live domain.

#### Personio: two feed shapes, and a placeholder to filter

`elcogen.jobs.personio.com` is a real, live board, but the scan reports
**"personio detected but unreadable"** and correctly leaves the record alone.
The adapter reads the XML feed; for this tenant `/xml` 404s on both the `.com`
and `.de` hosts, while `/search.json` answers 200 with well-formed JSON.

Worth adding that fallback in a future pass — but with a filter, because the one
entry Elcogen's board carries is `"Open Application"`, a speculative-application
placeholder rather than a real role. Counting it would claim Elcogen has an
opening when it has an invitation to send a CV. Ashby's `isListed` check exists
for the same reason; Personio needs the equivalent before the fallback is safe.

#### `website` and `careersUrl` cannot be changed through `apply` — by design

They are absent from `SOFT_FIELDS` in `merge.mjs`, so they fill a blank once and
are then fixed for good: **not even `trust: "primary"` overwrites them.** That is
deliberate — a model quietly repointing a company at a different domain would
redirect every later scan, logo fetch and position link with it.

The cost is that a company which genuinely changes domain has to be corrected by
hand in `data/companies.json`. This has now come up twice: Ampler
(`ampler.bike` → `amplerbikes.com`) in round 1, and Mingla
(`mingla.com` → `mingla.io`) in round 3. Both were edited directly.

`apply` used to report this as "nothing new — the record already holds these
values", which is simply false and cost a round-trip to diagnose. It now says
the field is not overwritable even at primary trust.

## Round 4 — 2026-09-22: a full refresh, and the errors it turned up

A refresh of every board plus 102 new companies. Most of the value came from
finding data that was confidently **wrong**, not from filling gaps.

### Wrong data found, and where it came from

- **Job ads as descriptions (24 records).** Hacker News and We Work Remotely
  hand over the body of a post, which is written to one role's applicants:
  *"Keeper is hiring a driven, Arabic speaking Channel Account Manager…"*,
  *"New York, NY URL: https://…"*. `description.mjs` now refuses that text
  (`looksLikeJobAd`), `describe` replaces it with the homepage's own meta
  description, and discovery reads the homepage first for those two sources.
  The audit reports any that remain as `description-job-ad` (high).
- **"Remote" stamped from one listing (68 records).** Every We Work Remotely
  item, and every HN post headed `REMOTE`, wrote `remotePolicy: "remote"` for the
  whole company. Datadog had 5 of 60 roles remote, Airbnb 0 of 60. Both sources
  now leave it null; the 68 labels were cleared and the board scan re-derived 37
  of them from the companies' own postings (22 hybrid, 13 remote, 2 on-site).
  The audit reports `remote-label-contradicted` (medium) when a remote label
  faces a board where under a third of roles say remote.
- **Another company's roles.** Two boards belonged to someone else:
  - `jobs.ashbyhq.com/Flock%20Safety` was cut at the `%20` and read the board
    `Flock` — an insurer — so Flock Safety showed "Senior Motor Fleet
    Underwriter". Ashby tokens are now decoded and may contain spaces.
  - Remote (remote.com) links Jobgether's Lever board from its own jobs
    marketplace, and sixty of Jobgether's reposts were recorded as Remote's.
    Before that it held one role from `greenhouse/remote` — which is General
    Assembly's board. Remote's is `greenhouse/remotecom` (board name "Remote").
    `jobgether` is now a reserved token.
  A one-off check read the display name of all 154 hosted boards (Greenhouse
  board metadata, Ashby and Lever page titles) against the company name. Only
  Remote was wrong; the other four mismatches were real: Creem's board is filed
  under its legal entity **Armitage Labs OÜ**, People.ai has **rebranded as
  Backstory** (people.ai redirects to backstory.ai — the record's name is now
  out of date), and Postscript and BioRender were transient fetch misses.
- **Records that could not be described honestly — removed.** GovStar's HN post
  linked `govstar.us`, an unrelated design studio (the real company's
  `govstar.ai` served an expired TLS certificate); Furtim Modus's entire site is
  a recruiting tagline; Track It Forward blocks every fetch. All three had no
  roles and no verified data, and are in `excludeNames`.
- **Out of scope:** St. Jude Children's Research Hospital, Miltenyi Biotec and
  Natera came in from HN / We Work Remotely and were excluded by name.

### Research agents are confidently wrong about boards

Board-finding agents were right about most boards but not all. Two of nine
"supported" boards they reported were 404s when read (`jobs.ashbyhq.com/toggl`,
`jobs.ashbyhq.com/Deno`), and three were confirmed only through search results
because Workable rate-limited them (and us — `apply.workable.com` answered 429
with a Retry-After of ~20 hours). **Never write a board URL an agent found
without the scan reading it.** Those five were reverted; Doist, Xolo and
Routable are worth a retry once Workable lets us back in.

### Boards on platforms we cannot read yet

Real, company-owned boards the scan has no adapter for — the biggest remaining
source of missing roles:

| system | companies |
|---|---|
| Rippling | vouch, just-appraised, community-phone-company |
| Workday | rappi |
| Kula | cashfree-payments (35 roles) |
| Gem | onesignal |
| Teamdash | helmes |
| RevolutPeople | aspire |
| Notion page | activeloop, keeper |
| own custom page | retool (23), automattic (15), bolt, playtech-estonia, odoo (153), serpapi (28), estuary (10), alpha-vantage, fondo, ledger-investing (0), chainsecurity, puma-tech, klarasystems-com, sudowrite, nimble, we-the-flywheel (60), nestor, first, shovels, this-dot-labs, cardog, akkio, crossref |

Their `careersUrl` now points at those pages, so a reader has the right link
even though the roles are not listed here. A Rippling adapter would cover three
at once.

### Dead ends this round (don't redo)

| company | what happened |
|---|---|
| plausible-analytics | no careers link anywhere; `/careers` and `/jobs` 404 |
| smartcat, prisma, directus, appwrite, safetywing, zenysis, drip-capital, dreamcraft-entertainment-inc, statecraft, flockjay | careers page is a client-rendered SPA with no ATS trace in the HTML; guessed slugs all 404 |
| strapi | `/careers` lists nothing; the old `jobs.lever.co/strapi` board is deactivated |
| bloom-institute-of-technology | page calls Lever for `BloomTech`, which now returns "Document not found" |
| oxygen | `getoxygen.com/careers` answers HTTP 525 (Cloudflare SSL failure) |
| joy | careers page has only mailto links |
| onefin | nav "Careers" links back to the homepage |
| mooncascade | `/career` is portfolio copy with a mailto |
| planet42 | no jobs page in the nav or the sitemap |
| bikeep | `/careers` redirects to `/contact` |
| swadesh, numero, pagelove | no careers page at all |
| toggl, deno | the Ashby boards on record in earlier notes now 404 |

### Gap research — 113 companies, 43 with a confirmed fact

Country, size and work model, researched from each company's own site (YC company
profiles at directory trust where a startup's own site says nothing). Yield was
~38%, and the misses are worth knowing:

- **Headcount is the hardest field.** Most sites quote customers, users or
  community members — never staff. glia, sift, victoriametrics, mintmcp,
  sanctuary-computer, odin and yeet all display a big number that is not a
  headcount. deepnote, checkly and lightyear have a team-size widget filled in
  by JavaScript, invisible to a fetch.
- **Companies with genuinely no HQ**: cal.com ("We have no physical headquarter
  and don't plan to have one"), buffer, remote (Netherlands B.V. + Delaware Inc.)
  and tailscale (Canada Inc. + US Inc.) — country correctly left null rather than
  picking an entity at random.
- **Whole-domain blocks**: reddit, toast, renthop and customer-io answer 403 or
  404 on every legal/about path. renthop's country came from its YC profile.
- **Wrong `website` fields found while researching** (all hand-fixed): Ashby was
  pointed at a Substack newsletter linked from its HN post, Jawa at its Notion
  page, Vistulo at its ATS subdomain, MintMCP at a landing subdomain, and 3C
  Digital Solutions at one of its products. Fixing Ashby's and MintMCP's domains
  let the next scan find their boards by slug probe.
- People.ai has **rebranded to Backstory** (people.ai → backstory.ai, and its
  Lever board is titled Backstory). Renamed, id kept so the page URL survives.
