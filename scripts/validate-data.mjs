/**
 * Validate data/companies.json.
 *
 * Checks the structural contract, and also the project's data-honesty rules —
 * the invariants a JSON Schema cannot express, and the ones most likely to be
 * broken by a careless edit or by the update script once it exists.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), 'must be https://');

/**
 * Logos are downloaded by the update script and committed, so `logoUrl` is
 * normally a root-relative path into `public/logos/`. A remote URL would put
 * a third-party request back on the directory page — the thing this app
 * deliberately does not do — so only a local path or an https URL passes, and
 * the local form is deliberately narrow: no `//host`, no `..`, no other
 * directory, nothing but `/logos/<slug>.<ext>`.
 */
const localLogoPath = z.string().regex(/^\/logos\/[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/, 'must be /logos/<slug>.<ext>');
const logoUrl = z.union([httpsUrl, localLogoPath]);

const WorkplaceSlot = z.object({
  mode: z.enum(['remote', 'hybrid', 'onsite', 'unknown']),
  where: z.array(z.string().min(1)),
});

const Opening = z.object({
  title: z.string().min(1),
  url: httpsUrl.nullable(),
  location: z.string().nullable(),
  postedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  detectedKeywords: z.array(z.string()),
  workplace: z.array(WorkplaceSlot),
});

const HistoryEntry = z.object({
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openCount: z.number().int().min(0),
  keywordCounts: z.record(z.string(), z.number().int().min(0)),
});

const Company = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be a kebab-case slug'),
  name: z.string().min(1),
  logoUrl: logoUrl.nullable(),
  description: z.string().min(1),
  website: httpsUrl.nullable(),
  careersUrl: httpsUrl.nullable(),
  // Constrained to a LinkedIn company page: this field is a link out, and a
  // stray URL here would send readers somewhere we never vetted.
  linkedinUrl: z
    .string()
    .regex(/^https:\/\/(www\.)?linkedin\.com\/company\//, 'must be a linkedin.com/company URL')
    .nullable(),
  sizeRange: z.string().nullable(),
  sizeMin: z.number().int().positive().nullable(),
  sizeMax: z.number().int().positive().nullable(),
  hqLocation: z.string().nullable(),
  country: z.string().nullable(),
  remotePolicy: z.enum(['remote', 'hybrid', 'onsite']).nullable(),
  remoteRegions: z.array(z.string()),
  keywords: z.array(z.string()),
  currentOpenings: z.array(Opening),
  history: z.array(HistoryEntry),
  lastVerified: z.string().datetime().nullable(),
  dataNotes: z.string().nullable(),
});

const Dataset = z.object({
  $schema: z.string().optional(),
  generatedAt: z.string().datetime(),
  companies: z.array(Company).min(1),
});

const raw = JSON.parse(readFileSync(resolve(root, 'data/companies.json'), 'utf8'));
const parsed = Dataset.safeParse(raw);

const problems = [];

if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    problems.push(`schema: ${issue.path.join('.')} — ${issue.message}`);
  }
} else {
  const { companies } = parsed.data;

  const seen = new Set();
  for (const c of companies) {
    if (seen.has(c.id)) problems.push(`duplicate id: ${c.id}`);
    seen.add(c.id);

    // Size bounds must be coherent, or the band filter silently misbehaves.
    if (c.sizeMin !== null && c.sizeMax !== null && c.sizeMin > c.sizeMax) {
      problems.push(`${c.id}: sizeMin (${c.sizeMin}) > sizeMax (${c.sizeMax})`);
    }

    // Honesty rule: a record never checked against a primary source must not
    // assert live openings.
    if (c.lastVerified === null && c.currentOpenings.length > 0) {
      problems.push(`${c.id}: unverified but claims ${c.currentOpenings.length} openings`);
    }

    // Honesty rule: history is an append-only scan log, never back-filled.
    // Any entry implies a scan happened, which implies a verification date.
    if (c.history.length > 0 && c.lastVerified === null) {
      problems.push(`${c.id}: has history but was never verified`);
    }

    // History must be chronological and free of duplicate weeks, since the
    // update script upserts by weekOf.
    const weeks = c.history.map((h) => h.weekOf);
    if (new Set(weeks).size !== weeks.length) problems.push(`${c.id}: duplicate history weeks`);
    if ([...weeks].sort().join() !== weeks.join()) {
      problems.push(`${c.id}: history is not in chronological order`);
    }
  }
}

// The UI decides whether a company's list is a truncated sample by comparing
// its stored count against a cap it holds as a constant (POSITION_CAP in
// src/lib/format.ts). That constant mirrors research.config.json, and nothing
// links the two at runtime — so if they drift, every capped company silently
// stops showing its "60+" and starts claiming a sample is the whole board.
{
  const configPath = new URL('../research.config.json', import.meta.url);
  const formatPath = new URL('../src/lib/format.ts', import.meta.url);
  try {
    const configured = JSON.parse(readFileSync(configPath, 'utf8'))?.positions?.maxPerCompany;
    const declared = readFileSync(formatPath, 'utf8').match(/POSITION_CAP\s*=\s*(\d+)/);
    if (Number.isInteger(configured) && declared !== null) {
      if (Number(declared[1]) !== configured) {
        problems.push(
          `POSITION_CAP in src/lib/format.ts is ${declared[1]} but `
          + `positions.maxPerCompany in research.config.json is ${configured}`,
        );
      }
    }
  } catch {
    /* config or source unreadable — not this check's business to fail over */
  }
}

if (problems.length > 0) {
  console.error(`✗ ${problems.length} problem(s) in data/companies.json:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const { companies } = parsed.data;
const count = (fn) => companies.filter(fn).length;
console.log(`✓ data/companies.json is valid — ${companies.length} companies`);
console.log(`  verified: ${count((c) => c.lastVerified !== null)}`);
console.log(`  with size: ${count((c) => c.sizeMin !== null)}`);
console.log(`  with country: ${count((c) => c.country !== null)}`);
console.log(`  with remote policy: ${count((c) => c.remotePolicy !== null)}`);
console.log(`  open positions: ${companies.reduce((n, c) => n + c.currentOpenings.length, 0)}`);
