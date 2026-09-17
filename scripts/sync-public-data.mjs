/**
 * Publish the dataset as a static file alongside the app.
 *
 * The app bundles the JSON at build time, but `/companies.json` is also served
 * verbatim so that simple consumers — scripts, agents, anything that just wants
 * the raw data — can fetch it without going through the API. Copied at build
 * time rather than committed twice, so the two can never drift.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'data/companies.json');
const target = resolve(root, 'public/companies.json');

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log('synced data/companies.json → public/companies.json');
