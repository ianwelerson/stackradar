/**
 * Run reporting.
 *
 * A run must be legible before it is trusted: what changed, what failed, and
 * what was deliberately left alone. Silence is the thing to avoid — a scan that
 * quietly skipped 40 companies looks identical to one that checked them all.
 */

const ESC = String.fromCharCode(27);
const CODES = {
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  red: `${ESC}[31m`,
  dim: `${ESC}[2m`,
  reset: `${ESC}[0m`,
};

const supportsColor = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
const paint = (code, text) => (supportsColor ? `${code}${text}${CODES.reset}` : text);

export const ok = (t) => paint(CODES.green, t);
export const warn = (t) => paint(CODES.yellow, t);
export const bad = (t) => paint(CODES.red, t);
export const dim = (t) => paint(CODES.dim, t);

export function createReport(title) {
  const changes = [];
  const skips = [];
  const failures = [];
  const started = Date.now();

  return {
    change(id, detail) { changes.push({ id, detail }); },
    skip(id, reason) { skips.push({ id, reason }); },
    fail(id, reason) { failures.push({ id, reason }); },
    get counts() {
      return { changed: changes.length, skipped: skips.length, failed: failures.length };
    },
    print({ dryRun, verbose = false }) {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`\n${title} ${dim(`(${seconds}s)`)}`);

      if (changes.length > 0) {
        console.log(`\n  ${ok(`changed (${changes.length})`)}`);
        for (const c of changes) console.log(`    ${c.id.padEnd(26)} ${c.detail}`);
      }

      if (failures.length > 0) {
        console.log(`\n  ${bad(`failed (${failures.length})`)} ${dim('- records left untouched')}`);
        for (const f of failures) console.log(`    ${f.id.padEnd(26)} ${f.reason}`);
      }

      if (skips.length > 0) {
        if (verbose) {
          console.log(`\n  ${warn(`skipped (${skips.length})`)}`);
          for (const s of skips) console.log(`    ${s.id.padEnd(26)} ${s.reason}`);
        } else {
          const byReason = {};
          for (const s of skips) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
          const summary = Object.entries(byReason)
            .sort((a, b) => b[1] - a[1])
            .map(([r, n]) => `${n} ${r}`)
            .join(', ');
          console.log(`\n  ${warn(`skipped (${skips.length})`)} ${dim(summary)}`);
          console.log(dim('    re-run with --verbose to list them'));
        }
      }

      if (changes.length === 0 && failures.length === 0) {
        console.log(`\n  ${dim('nothing to change')}`);
      }

      console.log(
        dryRun
          ? `\n  ${warn('DRY RUN')} - nothing written. Re-run with ${ok('--write')} to apply.\n`
          : `\n  ${ok('written')} to data/companies.json ${dim('(previous copy in scripts/update/.backups/)')}\n`,
      );
    },
  };
}
