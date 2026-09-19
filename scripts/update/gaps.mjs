/**
 * Gap report: what is missing, and — more usefully — what could actually be
 * done about it. Grouping by *cause* rather than by field turns "43 companies
 * have no work model" into "38 of those have no discoverable job board", which
 * is a different problem with a different fix.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { companies } = JSON.parse(readFileSync(resolve(root, 'data/companies.json'), 'utf8'));

const n = companies.length;
const pct = (x) => `${String(x).padStart(3)} ${String(Math.round((x / n) * 100)).padStart(3)}%`;
const has = (fn) => companies.filter(fn).length;

const scannable = companies.filter((c) => c.currentOpenings.length > 0 || c.history.length > 0);
const unscannable = companies.filter((c) => c.currentOpenings.length === 0 && c.history.length === 0);

console.log(`\n${n} companies\n`);

console.log('COVERAGE');
console.log(`  logo                ${pct(has((c) => c.logoUrl !== null))}`);
console.log(`  description         ${pct(has((c) => c.description !== ''))}`);
console.log(`  country             ${pct(has((c) => c.country !== null))}`);
console.log(`  size                ${pct(has((c) => c.sizeMin !== null))}`);
console.log(`  work model          ${pct(has((c) => c.remotePolicy !== null))}`);
console.log(`  careers URL         ${pct(has((c) => c.careersUrl !== null))}`);
console.log(`  keywords            ${pct(has((c) => c.keywords.length > 0))}`);
console.log(`  verified            ${pct(has((c) => c.lastVerified !== null))}`);
console.log(`  open positions      ${pct(has((c) => c.currentOpenings.length > 0))}`);
console.log(`  weekly history      ${pct(has((c) => c.history.length > 0))}`);

const all = companies.flatMap((c) => c.currentOpenings);
console.log(`\nPOSITIONS (${all.length} across ${has((c) => c.currentOpenings.length > 0)} companies)`);
console.log(`  direct link         ${String(all.filter((o) => o.url !== null).length).padStart(3)} / ${all.length}`);
console.log(`  location            ${String(all.filter((o) => o.location !== null).length).padStart(3)} / ${all.length}`);
console.log(`  posted date         ${String(all.filter((o) => o.postedDate !== null).length).padStart(3)} / ${all.length}`);
console.log(`  stack keywords      ${String(all.filter((o) => o.detectedKeywords.length > 0).length).padStart(3)} / ${all.length}`);

console.log(`\nWHY DATA IS MISSING`);
console.log(`  companies with a readable job board     ${String(scannable.length).padStart(3)}`);
console.log(`     of those, still missing country      ${String(scannable.filter((c) => !c.country).length).padStart(3)}`);
console.log(`     of those, still missing size         ${String(scannable.filter((c) => c.sizeMin === null).length).padStart(3)}`);
console.log(`  companies with NO readable job board    ${String(unscannable.length).padStart(3)}  <- the bottleneck`);
console.log(`     of those, missing country            ${String(unscannable.filter((c) => !c.country).length).padStart(3)}`);
console.log(`     of those, missing size               ${String(unscannable.filter((c) => c.sizeMin === null).length).padStart(3)}`);
console.log(`     of those, missing work model         ${String(unscannable.filter((c) => !c.remotePolicy).length).padStart(3)}`);
console.log(`     of those, have a website to research ${String(unscannable.filter((c) => c.website !== null).length).padStart(3)}`);

const worst = companies
  .map((c) => ({
    c,
    missing: [
      c.country === null && 'country',
      c.sizeMin === null && 'size',
      c.remotePolicy === null && 'work model',
      c.keywords.length === 0 && 'keywords',
      c.currentOpenings.length === 0 && 'positions',
      c.logoUrl === null && 'logo',
    ].filter(Boolean),
  }))
  .filter((x) => x.missing.length >= 3)
  .sort((a, b) => b.missing.length - a.missing.length);

console.log(`\nLEAST COMPLETE (${worst.length} companies missing 3+ fields)`);
for (const { c, missing } of worst.slice(0, 12)) {
  console.log(`  ${c.id.padEnd(24)} ${missing.join(', ')}`);
}
if (worst.length > 12) console.log(`  ... and ${worst.length - 12} more`);
console.log('');
