---
description: Refresh the company directory — scan careers pages, discover new companies, research gaps, record weekly history
---

Refresh `data/companies.json`. You are the judgement layer on top of a deterministic
toolkit; the scripts do the fetching, merging and validating, and you do the research
that needs reading and reasoning.

**Ground rule for this whole workflow: a missing value is fine, a wrong value is not.**
`null` is a first-class value in this dataset and the UI shows it honestly. Never fill a
field to make the data look more complete. If you cannot confirm something, leave it out.

Every command is a dry run until `--write` is passed. Show the user what a step will do
before writing, unless they have already said to just go.

## 1. Where things stand

```bash
node scripts/update/cli.mjs status
```

Report the gaps briefly. If the user passed arguments ($ARGUMENTS), let them narrow the
run — e.g. "just refresh", "discover from YC", "only Estonian companies".

## 2. Refresh positions

```bash
node scripts/update/cli.mjs refresh --limit 25
```

This scans each company's job board and updates `currentOpenings` — including the direct
link and posted date per role — then records this week's history point.

Read the report. Companies under `failed` were **left untouched on purpose**: an
unreadable careers page is not evidence that hiring stopped. If several failed the same
way, that is a bug worth investigating, not a data problem to paper over.

Re-run with `--write` once it looks right.

Companies whose careers page is not on a supported job board show as `no ATS detected`.
For a handful of those, it is worth fetching the careers page yourself and reading it —
if you find real listings, add them via step 4 with `trust: "primary"`. Only record a
position when you have its **direct URL**; a link to the generic careers page is not good
enough and should be `null`.

## 3. Discover new companies

```bash
node scripts/update/cli.mjs discover                      # every source in config
node scripts/update/cli.mjs discover --source hnhiring    # or one at a time
```

**Read `scripts/update/SOURCES.md` first.** It records every source's verified endpoint
and record shape, the parsing traps that have already bitten, the sources that were
evaluated and rejected, and the ones that are permanently blocked. Checking it before
adding a source will usually save the probing.

The configured sources and what each is for:

| source | what it finds |
|---|---|
| `workatastartup` | YC startups **currently hiring engineers**, with their own website, team size and a public per-posting link |
| `ycombinator` | the YC directory — companies that exist, hiring or not |
| `hnhiring` | non-YC remote startups, from the monthly "Who is hiring?" thread |
| `weworkremotely` | remote-first companies, from the RSS category feeds |
| `seeds` | anything added by hand, including all Estonian coverage |

New records are created unverified, with no history and no positions — step 2 fills those
on the next run. Existing companies only get their blanks filled; a directory listing
never overrides something confirmed from the company itself.

To widen beyond these, add the company to `discovery.seeds.companies` in
`research.config.json` — but **check the domain resolves first**, with
`curl -sS -o /dev/null -L -w "%{http_code}|%{url_effective}\n" <url>`. Six of the first 46
seed candidates were dead, parked, or redirected to an acquirer, and each would have become
a record nothing could ever fill in.

Do not spend time on `ecosystem.startupestonia.ee`: it is a Dealroom portal that returns a
Cloudflare challenge on every path including its own `robots.txt`. That is why Estonian
coverage is curated in `seeds`.

## 4. Research the gaps

**Read `scripts/update/RESEARCH-NOTES.md` first.** It records what previous rounds already
established for each company — the careers URL that worked, which job-board platform they
use, whether they publish openings at all, and which sites are dead ends that 403, are
JS-only, or redirect to a homepage. It also records which work-model signals proved
reliable and which look convincing but are not. Starting there avoids re-doing lookups
that have already been done and failed.

```bash
node scripts/update/cli.mjs enrich --limit 20
```

This writes a task file under `scripts/update/tasks/`. Read it, then research each company
— prefer its own site over any directory. Write results to a new JSON file:

```json
{
  "results": [
    {
      "id": "creem",
      "facts": {
        "careersUrl": "https://creem.io/careers",
        "country": "Estonia",
        "sizeMin": 8,
        "sizeMax": 8,
        "remotePolicy": "remote"
      },
      "trust": "primary",
      "note": "Headcount from their own about page, Sept 2026."
    }
  ]
}
```

- `trust: "primary"` **only** when the fact came from the company's own site. Primary facts
  may overwrite existing values; `"directory"` facts only fill blanks. **This is the single
  most common reason an apply appears to do nothing**: a correct fact at directory trust,
  against a field that already has a value, is silently declined. `apply` now names the
  blocked fields when that happens. Both values are case-sensitive — `"Primary"` is
  rejected rather than quietly downgraded.
- Allowed fields are listed in the task file's `instructions`. Anything else is rejected.
- **The `missing` list names gaps, not fields.** Two of its labels have no matching field:
  a headcount goes in `sizeMin`/`sizeMax` (not `size`), and `neverVerified` cannot be
  supplied at all — it means no job-board scan has confirmed the company yet, which only
  step 2 can change.
- Omit a field rather than guessing at it.
- `apply` is a dry run without `--write`, and prints `DRY RUN - nothing written` when it is.

Then:

```bash
node scripts/update/cli.mjs apply --file <your-results.json>
```

Anything rejected is printed with the reason. Fix and re-run; nothing partial is written.
Add `--write` when clean.

**Then update `scripts/update/RESEARCH-NOTES.md`** with what this round learned — including
the failures. A company you checked and found has no careers page is worth recording, so
the next round does not spend a lookup rediscovering it.

Researching a batch this size is a good use of a subagent on a cheaper model: the work is
mechanical lookups with a strict output contract. Give it the honesty rule explicitly —
omit rather than guess — since that is the thing most likely to go wrong.

## 5. Record history

```bash
node scripts/update/cli.mjs history --write
```

Only needed if you skipped step 2 — `refresh` already records a history point. Safe to run
repeatedly: it upserts on the ISO Monday of the current week rather than appending.

## 6. Verify, then hand back

```bash
pnpm validate:data && pnpm build
```

`validate:data` enforces the honesty invariants — an unverified company cannot claim
openings, history cannot exist without a verification date, weeks must be unique and
chronological. If it fails, the dataset is wrong: fix it rather than relaxing the check.

Finish with a short summary: how many companies were scanned, how many positions were
added or removed, how many new companies were discovered, what failed and why, and what
still has gaps. Then tell the user the changes are staged in `data/companies.json` and
that a commit and push will redeploy.

Do not commit unless the user asks.
