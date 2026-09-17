/**
 * Dataset load and save.
 *
 * Writes are atomic (temp file + rename) and always preceded by a backup, so an
 * interrupted or bad run cannot leave a half-written companies.json — this file
 * is the whole product, and it is the only copy.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const DATA_PATH = resolve(ROOT, 'data/companies.json');
const BACKUP_DIR = resolve(ROOT, 'scripts/update/.backups');

export function loadDataset() {
  return JSON.parse(readFileSync(DATA_PATH, 'utf8'));
}

export function loadConfig() {
  return JSON.parse(readFileSync(resolve(ROOT, 'research.config.json'), 'utf8'));
}

export function saveDataset(dataset) {
  mkdirSync(BACKUP_DIR, { recursive: true });

  if (existsSync(DATA_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(DATA_PATH, resolve(BACKUP_DIR, `companies.${stamp}.json`));
  }

  const serialized = `${JSON.stringify(dataset, null, 2)}\n`;
  const temp = `${DATA_PATH}.tmp`;
  writeFileSync(temp, serialized, 'utf8');
  renameSync(temp, DATA_PATH);
}

/** ISO date of the Monday of the week containing `date` (UTC). */
export function mondayOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day; // Sunday belongs to the week that just ended
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
