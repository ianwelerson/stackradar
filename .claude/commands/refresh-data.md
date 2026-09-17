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
node scripts/update/cli.mjs discover --source ycombinator
```

New records are created unverified, with no history and no positions — step 2 fills those
on the next run. Existing companies only get their blanks filled; a directory listing
never overrides something confirmed from the company itself.

To widen discovery beyond the configured sources, search the web for relevant hubs
(Estonian startup directories, regional accelerators, "who's hiring" threads) and add what
you find through step 4. `ecosystem.startupestonia.ee` is behind Cloudflare and
`startupestonia.ee/startup-database` loads its data client-side, so those need searching
rather than fetching.

## 4. Research the gaps

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
  may overwrite existing values; `"directory"` facts only fill blanks.
- Allowed fields are listed in the task file's `instructions`. Anything else is rejected.
- Omit a field rather than guessing at it.

Then:

```bash
node scripts/update/cli.mjs apply --file <your-results.json>
```

Anything rejected is printed with the reason. Fix and re-run; nothing partial is written.
Add `--write` when clean.

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
