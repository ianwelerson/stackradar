#!/usr/bin/env node
/**
 * Accuracy audit for data/companies.json.
 *
 * `validate-data.mjs` answers "is this file well-formed and self-consistent?"
 * and blocks the build when it is not. This answers a different and softer
 * question: "is anything in here likely to be WRONG?" — the kind of thing a
 * schema cannot see, because every value is individually legal.
 *
 * Nothing here fails a build. Findings are ranked by how misleading the data
 * would be to somebody deciding where to apply, because that is the only harm
 * that matters: a missing field is honest, a confidently wrong one is not.
 *
 * Usage:
 *   node scripts/audit-data.mjs             # offline checks only
 *   node scripts/audit-data.mjs --sample 40 # also probe N random posting URLs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataset = JSON.parse(readFileSync(resolve(ROOT, 'data/companies.json'), 'utf8'));
const companies = dataset.companies;

const args = process.argv.slice(2);
const sampleSize = args.includes('--sample')
  ? Number.parseInt(args[args.indexOf('--sample') + 1] ?? '0', 10) || 0
  : 0;

/** severity: 'high' misleads a reader, 'medium' is suspect, 'low' is hygiene. */
const findings = [];
const note = (severity, check, detail) => findings.push({ severity, check, detail });

// ---------------------------------------------------------------- placeholders

/**
 * Titles that are an invitation to send a CV, not a role. Counting them as
 * openings claims a company is hiring for something specific when it is not.
 * These are matched whole-ish rather than as substrings so a real "Open Source
 * Engineer" or "Application Security Engineer" is never caught.
 */
const PLACEHOLDER_TITLE = [
  /^open application$/i,
  /^spontaneous application$/i,
  /^speculative application$/i,
  /^general application$/i,
  /^unsolicited application$/i,
  /^talent (pool|community|network)$/i,
  /^future opportunities$/i,
  /^test job$/i,
  /^(sample|demo|example) (job|posting|position)$/i,
  /^dummy/i,
];

for (const c of companies) {
  for (const o of c.currentOpenings) {
    if (PLACEHOLDER_TITLE.some((re) => re.test(o.title.trim()))) {
      note('high', 'placeholder-posting', `${c.id}: "${o.title}" is a CV-drop, not a role`);
    }
  }
}

// ------------------------------------------------------------------ duplicates

const rootDomain = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const parts = host.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : host;
  } catch {
    return null;
  }
};

const byDomain = new Map();
for (const c of companies) {
  const d = rootDomain(c.website);
  if (d === null) continue;
  if (!byDomain.has(d)) byDomain.set(d, []);
  byDomain.get(d).push(c.id);
}
for (const [domain, ids] of byDomain) {
  if (ids.length > 1) {
    note('high', 'duplicate-company', `${domain} is claimed by ${ids.length}: ${ids.join(', ')}`);
  }
}

const byName = new Map();
for (const c of companies) {
  const key = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key === '') continue;
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(c.id);
}
for (const [, ids] of byName) {
  if (ids.length > 1) note('medium', 'duplicate-name', `same normalized name: ${ids.join(', ')}`);
}

// ------------------------------------------------- postings that link nowhere

// `url: null` is a supported, honest state, not a defect: when a careers page
// names a role without linking it individually, the alternative is sending the
// reader to a generic list to hunt for it, which is the failure this directory
// exists to avoid. Surfaced as medium so the count stays visible without
// implying the record is wrong.
for (const c of companies) {
  const missing = c.currentOpenings.filter((o) => o.url === null).length;
  if (missing > 0) {
    note('medium', 'posting-without-link', `${c.id}: ${missing} of ${c.currentOpenings.length} not individually linkable`);
  }
}

// --------------------------------------------- a posting that is not the role

/**
 * Every posting on a board should have its own URL. When many share one, the
 * link goes to a list and the reader has to hunt for the role we named.
 */
for (const c of companies) {
  const urls = c.currentOpenings.map((o) => o.url).filter((u) => u !== null);
  const unique = new Set(urls);
  if (urls.length > 1 && unique.size < urls.length) {
    note('high', 'shared-posting-url', `${c.id}: ${urls.length} postings share ${unique.size} URLs`);
  }
}

// ----------------------------------------------------- claims without a check

for (const c of companies) {
  if (c.currentOpenings.length > 0 && c.lastVerified === null) {
    note('high', 'unverified-openings', `${c.id} lists ${c.currentOpenings.length} openings but was never verified`);
  }
  if (c.history.length > 0 && c.lastVerified === null) {
    note('high', 'unverified-history', `${c.id} has history but was never verified`);
  }
  if (c.openingsTotal !== null && c.openingsTotal < c.currentOpenings.length) {
    note('medium', 'total-below-stored', `${c.id}: openingsTotal ${c.openingsTotal} < ${c.currentOpenings.length} stored`);
  }
}

// ---------------------------------------------------------------- size sanity

for (const c of companies) {
  if (c.sizeMin !== null && c.sizeMax !== null && c.sizeMin > c.sizeMax) {
    note('high', 'size-inverted', `${c.id}: sizeMin ${c.sizeMin} > sizeMax ${c.sizeMax}`);
  }
  if (c.sizeMin !== null && c.sizeMin < 1) {
    note('high', 'size-implausible', `${c.id}: sizeMin ${c.sizeMin}`);
  }
  if (c.sizeMax !== null && c.sizeMax > 500000) {
    note('medium', 'size-implausible', `${c.id}: sizeMax ${c.sizeMax} — plausible only for the very largest employers`);
  }
}

// ------------------------------------------------------------- country sanity

/** Intl knows every ISO region name; anything it cannot produce is suspect. */
const KNOWN_COUNTRIES = new Set();
try {
  const display = new Intl.DisplayNames(['en'], { type: 'region' });
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      const name = display.of(code);
      if (typeof name === 'string' && name !== code && !/^unknown region$/i.test(name)) {
        KNOWN_COUNTRIES.add(name.toLowerCase());
      }
    }
  }
} catch {
  /* Intl unavailable — the country check is skipped rather than guessed */
}

if (KNOWN_COUNTRIES.size > 0) {
  for (const c of companies) {
    if (c.country === null) continue;
    if (!KNOWN_COUNTRIES.has(c.country.toLowerCase())) {
      note('high', 'country-not-a-country', `${c.id}: country "${c.country}"`);
    }
  }
}

// --------------------------------------------------------------- logo on disk

for (const c of companies) {
  if (c.logoUrl === null) continue;
  if (!c.logoUrl.startsWith('/')) {
    note('high', 'logo-remote', `${c.id}: ${c.logoUrl} is not local — breaks img-src 'self' and leaks visitor IPs`);
    continue;
  }
  if (!existsSync(resolve(ROOT, 'public', c.logoUrl.replace(/^\//, '')))) {
    note('high', 'logo-missing-file', `${c.id}: ${c.logoUrl} has no file`);
  }
}

// ------------------------------------------------------------- history sanity

for (const c of companies) {
  const weeks = c.history.map((h) => h.weekOf);
  if (new Set(weeks).size !== weeks.length) note('high', 'history-duplicate-week', c.id);
  const sorted = [...weeks].sort();
  if (weeks.join() !== sorted.join()) note('medium', 'history-unordered', c.id);
  for (const h of c.history) {
    if (new Date(h.weekOf).getUTCDay() !== 1) {
      note('medium', 'history-not-monday', `${c.id}: ${h.weekOf}`);
    }
  }
  const latest = c.history[c.history.length - 1];
  if (latest !== undefined && latest.openCount !== c.currentOpenings.length && c.openingsTotal === null) {
    note('low', 'history-count-drift', `${c.id}: latest week ${latest.openCount} vs ${c.currentOpenings.length} stored`);
  }
}

// -------------------------------------------------------------- posting dates

const today = new Date();
for (const c of companies) {
  for (const o of c.currentOpenings) {
    if (o.postedDate === null) continue;
    const d = new Date(o.postedDate);
    if (Number.isNaN(d.getTime())) {
      note('high', 'posted-date-invalid', `${c.id}: "${o.postedDate}"`);
    } else if (d > today) {
      note('high', 'posted-date-future', `${c.id}: ${o.postedDate} on "${o.title}"`);
    } else if (d < new Date('2015-01-01')) {
      note('medium', 'posted-date-ancient', `${c.id}: ${o.postedDate} on "${o.title}"`);
    }
  }
}

// ----------------------------------------------------------------- staleness

const STALE_DAYS = 30;
let stale = 0;
for (const c of companies) {
  if (c.lastVerified === null) continue;
  const age = (today - new Date(c.lastVerified)) / 86_400_000;
  if (age > STALE_DAYS) stale += 1;
}
if (stale > 0) {
  note('low', 'stale-verification', `${stale} companies last verified over ${STALE_DAYS} days ago`);
}

// ------------------------------------------------------- optional: live URLs

async function probeSample(n) {
  const all = [];
  for (const c of companies) {
    for (const o of c.currentOpenings) if (o.url !== null) all.push({ id: c.id, ...o });
  }
  if (all.length === 0) return;

  // Deterministic spread across the list rather than a random draw, so two runs
  // over an unchanged dataset check the same postings and can be compared.
  const step = Math.max(1, Math.floor(all.length / n));
  const picked = [];
  for (let i = 0; i < all.length && picked.length < n; i += step) picked.push(all[i]);

  process.stdout.write(`\nprobing ${picked.length} of ${all.length} posting URLs`);
  let dead = 0;
  for (const p of picked) {
    try {
      const res = await fetch(p.url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'stack-radar-audit/1.0' },
        signal: AbortSignal.timeout(12000),
      });
      if (res.status === 404 || res.status === 410) {
        dead += 1;
        note('high', 'posting-url-dead', `${p.id}: HTTP ${res.status} — "${p.title}"`);
      }
      process.stdout.write(res.ok ? '.' : '!');
    } catch {
      // A timeout or DNS failure is about the network, not the data.
      process.stdout.write('?');
    }
  }
  process.stdout.write(`\n${dead} confirmed dead\n`);
}

// ----------------------------------------------------------------- reporting

const RANK = { high: 0, medium: 1, low: 2 };

async function main() {
  if (sampleSize > 0) await probeSample(sampleSize);

  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.check.localeCompare(b.check));

  const ops = companies.flatMap((c) => c.currentOpenings);
  console.log(`\naudited ${companies.length} companies, ${ops.length} postings\n`);

  if (findings.length === 0) {
    console.log('no accuracy findings.\n');
    return;
  }

  const byCheck = new Map();
  for (const f of findings) {
    if (!byCheck.has(f.check)) byCheck.set(f.check, []);
    byCheck.get(f.check).push(f);
  }

  for (const [check, group] of byCheck) {
    const { severity } = group[0];
    console.log(`${severity.toUpperCase().padEnd(6)} ${check} — ${group.length}`);
    for (const f of group.slice(0, 12)) console.log(`         ${f.detail}`);
    if (group.length > 12) console.log(`         … and ${group.length - 12} more`);
    console.log('');
  }

  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  console.log(`${counts.high} high, ${counts.medium} medium, ${counts.low} low\n`);
}

await main();
