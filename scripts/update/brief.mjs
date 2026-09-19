/**
 * Emit the research brief: one row per company that still has no readable job
 * board, with exactly which fields it is missing.
 *
 * Deliberately TSV rather than JSON — this is read by a person or handed to a
 * model doing lookups, and a flat table is easier to scan and to diff between
 * rounds than nested objects.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { companies } = JSON.parse(readFileSync(resolve(root, 'data/companies.json'), 'utf8'));

const stuck = companies.filter((c) => c.currentOpenings.length === 0);

const rows = stuck.map((c) => {
  const missing = [
    c.country === null && 'country',
    c.sizeMin === null && 'size',
    c.remotePolicy === null && 'workModel',
    c.careersUrl === null && 'careersUrl',
    c.lastVerified === null && 'neverVerified',
  ].filter(Boolean);
  return [c.id, c.name, c.website ?? '-', c.careersUrl ?? '-', missing.join('+')].join('\t');
});

const out = resolve(root, 'scripts/update/tasks/research-brief.tsv');
writeFileSync(out, `id\tname\twebsite\tcareersUrl\tmissing\n${rows.join('\n')}\n`, 'utf8');

console.log(`${stuck.length} companies need research -> scripts/update/tasks/research-brief.tsv`);
console.log('read scripts/update/RESEARCH-NOTES.md before starting; update it after.');
