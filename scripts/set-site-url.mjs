/**
 * Point the project at its real deployment URL.
 *
 * The API docs, llms.txt and the MCP server's default API base all need an
 * absolute URL — llms.txt in particular is meaningless with relative links,
 * since agents fetch it out of context. Until the site is deployed those carry
 * a placeholder, and this rewrites every one of them in a single step so none
 * is left stale.
 *
 *   node scripts/set-site-url.mjs https://your-deployment.vercel.app
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PLACEHOLDER = 'https://stack-radar.vercel.app';
const TARGETS = ['public/llms.txt', 'mcp/README.md', 'mcp/src/directory.ts', 'README.md'];

const input = process.argv[2];
if (input === undefined) {
  console.error('usage: node scripts/set-site-url.mjs https://your-deployment.example');
  process.exit(1);
}

let url;
try {
  url = new URL(input);
} catch {
  console.error(`✗ "${input}" is not a valid URL.`);
  process.exit(1);
}
if (url.protocol !== 'https:') {
  console.error('✗ the site URL must be https.');
  process.exit(1);
}

const next = url.origin;
let changed = 0;

for (const relative of TARGETS) {
  const path = resolve(root, relative);
  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  if (!contents.includes(PLACEHOLDER)) continue;
  const occurrences = contents.split(PLACEHOLDER).length - 1;
  writeFileSync(path, contents.replaceAll(PLACEHOLDER, next), 'utf8');
  console.log(`  ${relative} — ${occurrences} replaced`);
  changed += occurrences;
}

if (changed === 0) {
  console.log(`No occurrences of ${PLACEHOLDER} left — already pointed somewhere else?`);
} else {
  console.log(`\n✓ ${changed} reference(s) now point at ${next}`);
  console.log('  Rebuild the MCP server so its bundled default updates: cd mcp && npm run build');
}
