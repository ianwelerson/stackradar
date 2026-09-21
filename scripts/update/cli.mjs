#!/usr/bin/env node
/**
 * Stack Radar dataset updater.
 *
 * Deliberately split into small, separately-runnable commands rather than one
 * do-everything job. Each is incremental — re-running never starts from scratch
 * and never duplicates — and each is DRY RUN by default: nothing touches
 * data/companies.json until `--write` is passed, and even then the previous
 * copy is backed up first.
 *
 *   refresh    re-scan careers pages, update positions, record this week's history
 *   discover   find new companies from configured sources
 *   enrich     emit the gaps that need research, for a model to fill
 *   apply      validate a model's findings and merge them
 *   history    record this week's open counts without re-scanning
 *   status     dataset health report
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHttp } from './lib/http.mjs';
import { loadDataset, loadConfig, saveDataset, mondayOf, ROOT } from './lib/dataset.mjs';
import { applyScan, mergeFacts, upsertCompany, emptyCompany, upsertWeek } from './lib/merge.mjs';
import { findExisting, allocateId } from './lib/slug.mjs';
import { buildTasks, validateResults, gapsFor } from './lib/enrich.mjs';
import { createReport, ok, warn, bad, dim } from './lib/report.mjs';

const TASKS_DIR = resolve(ROOT, 'scripts/update/tasks');

/**
 * Import a module that may legitimately be absent (adapters are optional
 * plugins), turning a raw ERR_MODULE_NOT_FOUND stack into something actionable.
 */
async function importOptional(specifier, what) {
  try {
    return await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes(specifier.replace('./', ''))) {
      console.log(bad(`\n${what} are not installed (${specifier} is missing).`));
      console.log(dim('  This command needs them; `status` and `enrich` work without.\n'));
      return null;
    }
    throw error;
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {
    write: false, verbose: false, force: false,
    limit: null, only: null, source: null, file: null,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--write') flags.write = true;
    else if (arg === '--verbose') flags.verbose = true;
    else if (arg === '--force') flags.force = true;
    else if (arg === '--limit') flags.limit = Number.parseInt(rest[++i] ?? '', 10);
    else if (arg === '--only') flags.only = (rest[++i] ?? '').split(',').filter(Boolean);
    else if (arg === '--source') flags.source = rest[++i] ?? null;
    else if (arg === '--file') flags.file = rest[++i] ?? null;
  }
  return { command, flags };
}

function commit(dataset, flags, report, title) {
  if (flags.write && report.counts.changed > 0) {
    dataset.generatedAt = new Date().toISOString();
    saveDataset(dataset);
  }
  report.print({ dryRun: !flags.write, verbose: flags.verbose });
  if (flags.write && report.counts.changed > 0) {
    console.log(dim(`  next: pnpm validate:data${title ? ` (${title})` : ''}\n`));
  }
}

/** Which companies are worth re-scanning this run. */
function refreshQueue(companies, config, flags) {
  const { refreshVerifiedWithinDays, maxCompaniesPerRun } = config.refresh;
  const now = Date.now();

  const due = companies.filter((c) => {
    if (flags.only !== null) return flags.only.includes(c.id);
    if (c.lastVerified === null) return true;
    const ageDays = (now - Date.parse(c.lastVerified)) / 86_400_000;
    return ageDays >= refreshVerifiedWithinDays;
  });

  // Oldest first, so repeated runs sweep the whole dataset rather than
  // re-checking the same head of the list every time.
  due.sort((a, b) => {
    const at = a.lastVerified === null ? 0 : Date.parse(a.lastVerified);
    const bt = b.lastVerified === null ? 0 : Date.parse(b.lastVerified);
    return at - bt;
  });

  return due.slice(0, flags.limit ?? maxCompaniesPerRun);
}

async function cmdRefresh(flags) {
  const ats = await importOptional('./lib/ats/index.mjs', 'Job-board adapters');
  if (ats === null) {
    process.exitCode = 1;
    return;
  }
  const { detectAts, fetchPositions } = ats;
  const config = loadConfig();
  const dataset = loadDataset();
  const http = createHttp(config.refresh);
  const report = createReport('refresh');

  const queue = refreshQueue(dataset.companies, config, flags);
  console.log(
    `scanning ${queue.length} of ${dataset.companies.length} companies ${dim('(oldest first)')}`,
  );

  for (const company of queue) {
    // Do NOT pre-skip on a missing careersUrl. Many companies are on a hosted
    // board under their own slug even when we have no careers link recorded —
    // pipedrive (Lever) and testlio (Greenhouse) both resolve that way — and
    // fetchPositions probes for it. Skipping early hid 41 of 58 companies.
    if (company.careersUrl === null && company.website === null) {
      report.skip(company.id, 'no website or careers URL');
      continue;
    }

    // Used only to tell "no board exists" apart from "a known board failed".
    const detected = detectAts(company);

    let result;
    try {
      result = await fetchPositions(http, company, config);
    } catch (error) {
      report.fail(company.id, error instanceof Error ? error.message : 'scan threw');
      continue;
    }

    if (result === null || !Array.isArray(result.openings)) {
      // Crucial either way: an unreadable careers page is NOT evidence that
      // hiring stopped, so the record is left exactly as it was. But a board we
      // positively identified and then failed to read is a fault worth seeing,
      // while no board at all is just a company we cannot automate yet.
      if (detected !== null) {
        report.fail(company.id, `${detected.platform} detected but unreadable — left untouched`);
      } else {
        report.skip(company.id, 'no job board found');
      }
      continue;
    }

    const { company: updated, changed, reason } = applyScan(company, {
      openings: result.openings,
      totalListed: result.totalListed ?? null,
      scannedAt: new Date(),
    });
    if (!changed) {
      report.skip(company.id, 'no change');
      continue;
    }

    // Location evidence derived from the postings, merged at 'directory' trust:
    // it fills blanks but never overwrites a value someone actually researched,
    // because where a role is advertised is not necessarily where the company is.
    const signals = result.signals ?? {};
    const { company: enriched, filled } = mergeFacts(
      updated,
      { country: signals.country ?? null, remotePolicy: signals.remotePolicy ?? null },
      'directory',
    );

    dataset.companies = upsertCompany(dataset.companies, enriched);
    const extra = filled.length > 0 ? ok(` +${filled.join(',')}`) : '';
    report.change(company.id, `${reason}${extra} ${dim(result.diagnostics ?? '')}`);
  }

  commit(dataset, flags, report);
}

async function cmdDiscover(flags) {
  const registry = await importOptional('./lib/sources/index.mjs', 'Discovery sources');
  if (registry === null) {
    process.exitCode = 1;
    return;
  }
  const { sources } = registry;
  const config = loadConfig();
  const dataset = loadDataset();
  const http = createHttp(config.refresh);
  const report = createReport('discover');

  const wanted = flags.source !== null ? [flags.source] : config.discovery.sources;

  for (const sourceId of wanted) {
    const source = sources[sourceId];
    if (source === undefined) {
      console.log(bad(`unknown source "${sourceId}"`));
      continue;
    }

    const { candidates, diagnostics } = await source.discover(http, config);
    console.log(`${sourceId}: ${candidates.length} candidates ${dim(diagnostics ?? '')}`);

    for (const candidate of candidates) {
      const existing = findExisting(dataset.companies, candidate);
      if (existing !== null) {
        // Known company: fill blanks only. A directory listing never overrides
        // something already confirmed against the company itself.
        const { company: merged, filled } = mergeFacts(existing.company, candidate, 'directory');
        if (filled.length === 0) {
          report.skip(existing.company.id, `already known (${existing.matchedOn})`);
          continue;
        }
        dataset.companies = upsertCompany(dataset.companies, merged);
        report.change(existing.company.id, `filled ${filled.join(', ')}`);
        continue;
      }

      // The dataset schema requires a non-empty description, and there is no
      // honest way to manufacture one — inventing a sentence about a company we
      // have not read is exactly what this pipeline refuses to do. So a
      // candidate that arrives without one is reported and skipped rather than
      // written as a record that fails validation on the next build.
      if (typeof candidate.description !== 'string' || candidate.description.trim() === '') {
        report.skip(candidate.name, 'no description from the source — not created');
        continue;
      }

      const id = allocateId(dataset.companies, candidate.name);
      const created = emptyCompany(id, candidate.name);
      const { company: filled } = mergeFacts(created, candidate, 'directory');
      filled.dataNotes = candidate.sourceNote ?? `Discovered via ${sourceId}.`;
      // New records start unverified with no history: nothing has been checked
      // against the company's own careers page yet.
      dataset.companies = upsertCompany(dataset.companies, filled);
      report.change(id, `${ok('new')} — ${candidate.name}`);
    }
  }

  commit(dataset, flags, report);
}

function cmdEnrich(flags) {
  const dataset = loadDataset();
  const tasks = buildTasks(dataset.companies, {
    limit: flags.limit ?? 20,
    only: flags.only,
  });

  if (tasks.tasks.length === 0) {
    console.log(ok('\nno gaps to research — every company has country, size, work model and keywords.\n'));
    return;
  }

  mkdirSync(TASKS_DIR, { recursive: true });
  const path = resolve(TASKS_DIR, `enrich-${Date.now()}.json`);
  writeFileSync(path, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');

  console.log(`\n${ok(`${tasks.tasks.length} companies need research`)}`);
  const tally = {};
  for (const t of tasks.tasks) for (const g of t.missing) tally[g] = (tally[g] ?? 0) + 1;
  for (const [gap, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${gap}`);
  }
  console.log(`\nwritten to ${dim(path.replace(ROOT + '/', ''))}`);
  console.log(`then: ${ok(`node scripts/update/cli.mjs apply --file <results.json> --write`)}\n`);
}

function cmdApply(flags) {
  if (flags.file === null) {
    console.log(bad('apply needs --file <results.json>'));
    process.exitCode = 1;
    return;
  }

  const dataset = loadDataset();
  const report = createReport('apply');

  let payload;
  try {
    payload = JSON.parse(readFileSync(resolve(process.cwd(), flags.file), 'utf8'));
  } catch (error) {
    console.log(bad(`could not read ${flags.file}: ${error instanceof Error ? error.message : ''}`));
    process.exitCode = 1;
    return;
  }

  const { accepted, errors } = validateResults(payload, dataset.companies);

  if (errors.length > 0) {
    console.log(`\n${bad(`${errors.length} rejected`)}`);
    for (const e of errors) console.log(`  - ${e}`);
  }

  for (const entry of accepted) {
    const existing = dataset.companies.find((c) => c.id === entry.id);
    const { company: merged, filled, blocked } = mergeFacts(existing, entry.facts, entry.trust);
    if (filled.length === 0) {
      // Three genuinely different outcomes, which must not share a message:
      // the record already agrees; directory trust was refused and primary
      // would work; or the field is identity (website, careersUrl) which even
      // primary trust may not rewrite, because a model silently repointing a
      // company at another domain would redirect every later scan with it.
      let reason;
      if (blocked.length === 0) {
        reason = 'nothing new — the record already holds these values';
      } else if (entry.trust !== 'primary') {
        reason = `${blocked.join(', ')} already set — directory trust only fills blanks.`
          + ' Use trust: "primary" if you read it on the company\'s own site';
      } else {
        reason = `${blocked.join(', ')} already set and not overwritable even at primary trust`
          + ' — identity fields are edited by hand, on purpose';
      }
      report.skip(entry.id, reason);
      continue;
    }
    if (entry.note !== null) merged.dataNotes = entry.note;
    dataset.companies = upsertCompany(dataset.companies, merged);
    report.change(entry.id, `${filled.join(', ')} ${dim(`(${entry.trust})`)}`);
  }

  commit(dataset, flags, report);
}

function cmdHistory(flags) {
  const dataset = loadDataset();
  const report = createReport('history');
  const weekOf = mondayOf();

  for (const company of dataset.companies) {
    // Only companies that have actually been checked get a history point;
    // a record nobody has scanned has no honest count to record.
    if (company.lastVerified === null) {
      report.skip(company.id, 'never verified');
      continue;
    }

    const counts = {};
    for (const opening of company.currentOpenings) {
      for (const k of opening.detectedKeywords ?? []) counts[k] = (counts[k] ?? 0) + 1;
    }

    const entry = { weekOf, openCount: company.currentOpenings.length, keywordCounts: counts };
    const existing = company.history.find((h) => h.weekOf === weekOf);
    if (existing !== undefined && existing.openCount === entry.openCount) {
      report.skip(company.id, 'already recorded this week');
      continue;
    }

    const updated = { ...company, history: upsertWeek(company.history, entry) };
    dataset.companies = upsertCompany(dataset.companies, updated);
    report.change(company.id, `week ${weekOf}: ${entry.openCount} open`);
  }

  commit(dataset, flags, report);
}

async function cmdLogos(flags) {
  const logos = await importOptional('./lib/logos.mjs', 'Logo fetching');
  if (logos === null) {
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const dataset = loadDataset();
  const http = createHttp(config.refresh);
  const report = createReport('logos');

  const queue = dataset.companies.filter((c) => {
    if (flags.only !== null) return flags.only.includes(c.id);
    if (c.website === null) return false;
    return true;
  });

  console.log(`fetching logos for ${queue.length} companies ${dim('(stored locally in public/logos/)')}`);

  const { results, failures } = await logos.fetchLogos(http, queue.slice(0, flags.limit ?? queue.length), {
    force: flags.force === true,
  });

  for (const r of results) {
    const company = dataset.companies.find((c) => c.id === r.id);
    if (company === undefined) continue;
    if (company.logoUrl === r.path) {
      report.skip(r.id, 'unchanged');
      continue;
    }
    dataset.companies = upsertCompany(dataset.companies, { ...company, logoUrl: r.path });
    report.change(r.id, `${r.path} ${dim(`${Math.round((r.bytes ?? 0) / 1024)}kb via ${r.source ?? '?'}`)}`);
  }

  for (const f of failures) report.skip(f.id ?? '?', f.reason ?? 'no logo found');

  commit(dataset, flags, report);
}

async function cmdStatus() {
  const dataset = loadDataset();
  const { companies } = dataset;
  const n = companies.length;
  const pct = (x) => `${String(x).padStart(3)} ${dim(`(${Math.round((x / n) * 100)}%)`)}`;
  const count = (fn) => companies.filter(fn).length;


  console.log(`\ndataset ${dim(`generated ${dataset.generatedAt}`)}`);
  console.log(`  companies         ${n}`);
  console.log(`  verified          ${pct(count((c) => c.lastVerified !== null))}`);
  console.log(`  with country      ${pct(count((c) => c.country !== null))}`);
  console.log(`  with size         ${pct(count((c) => c.sizeMin !== null))}`);
  console.log(`  with work model   ${pct(count((c) => c.remotePolicy !== null))}`);
  console.log(`  with careers URL  ${pct(count((c) => c.careersUrl !== null))}`);
  console.log(`  with positions    ${pct(count((c) => c.currentOpenings.length > 0))}`);
  console.log(`  with history      ${pct(count((c) => c.history.length > 0))}`);
  console.log(`  open positions    ${companies.reduce((s, c) => s + c.currentOpenings.length, 0)}`);

  const linked = companies.flatMap((c) => c.currentOpenings).filter((o) => o.url !== null).length;
  const total = companies.reduce((s, c) => s + c.currentOpenings.length, 0);
  console.log(`  with direct link  ${total === 0 ? '  0' : `${String(linked).padStart(3)} ${dim(`of ${total}`)}`}`);

  // Reported from the positions actually held, not from a synchronous probe of
  // the careers URL — most boards are found by probing during a refresh, so a
  // sync detect would badly under-report and read as "nothing is working".
  const byHost = {};
  for (const c of companies) {
    for (const o of c.currentOpenings) {
      if (o.url === null) continue;
      try {
        const host = new URL(o.url).hostname.replace(/^www\./, '');
        byHost[host] = (byHost[host] ?? 0) + 1;
      } catch {
        /* a malformed URL is the validator's problem, not this report's */
      }
    }
  }
  const hosts = Object.entries(byHost).sort((a, b) => b[1] - a[1]);
  if (hosts.length > 0) {
    console.log('\n  positions by job board');
    for (const [host, n] of hosts.slice(0, 8)) {
      console.log(`    ${host.padEnd(28)} ${String(n).padStart(4)}`);
    }
  }

  const gaps = companies.filter((c) => gapsFor(c).length > 0).length;
  console.log(`\n  ${gaps} companies have gaps ${dim('— node scripts/update/cli.mjs enrich')}\n`);
}

async function cmdLinkedin(flags) {
  const mod = await importOptional('./lib/linkedin.mjs', 'The LinkedIn link finder');
  if (mod === null) {
    process.exitCode = 1;
    return;
  }
  const { findLinkedin } = mod;
  const config = loadConfig();
  const dataset = loadDataset();
  const http = createHttp(config.refresh);
  const report = createReport('linkedin');

  // Only companies that have none yet: this reads someone else's server, so
  // re-reading a page whose answer we already hold is a request wasted.
  const queue = dataset.companies
    .filter((c) => (flags.only !== null ? flags.only.includes(c.id) : c.linkedinUrl === null))
    .filter((c) => typeof c.website === 'string' && c.website !== '')
    .slice(0, flags.limit ?? 150);

  console.log(
    `reading ${queue.length} company homepages ${dim('(linkedin.com is never fetched — only the link a company publishes itself)')}`,
  );

  for (const company of queue) {
    const found = await findLinkedin(http, company);
    if (found === null) {
      report.skip(company.id, 'no LinkedIn link published on their own site');
      continue;
    }
    if (company.linkedinUrl === found.url) {
      report.skip(company.id, 'unchanged');
      continue;
    }
    dataset.companies = upsertCompany(dataset.companies, { ...company, linkedinUrl: found.url });
    report.change(company.id, `${found.url} ${dim(`(${found.source})`)}`);
  }

  commit(dataset, flags, report);
}

const COMMANDS = {
  refresh: cmdRefresh,
  discover: cmdDiscover,
  enrich: cmdEnrich,
  apply: cmdApply,
  history: cmdHistory,
  logos: cmdLogos,
  linkedin: cmdLinkedin,
  status: cmdStatus,
};

const { command, flags } = parseArgs(process.argv.slice(2));

if (command === undefined || COMMANDS[command] === undefined) {
  console.log(`
${ok('stack radar updater')}

  node scripts/update/cli.mjs <command> [options]

commands
  status                 dataset health report
  refresh                re-scan careers pages, update positions + this week's history
  discover               find new companies from configured sources
  enrich                 write out the gaps that need research
  apply --file <f>       validate and merge researched findings
  history                record this week's open counts without re-scanning
  logos                  download company logos into public/logos/

options
  --write                actually save (everything is a dry run otherwise)
  --limit <n>            cap how many companies this run touches
  --only <id,id>         restrict to specific companies
  --source <id>          discover from one source only
  --force                re-fetch even when a logo is already stored
  --verbose              list every skip
`);
  process.exitCode = command === undefined ? 0 : 1;
} else {
  await COMMANDS[command](flags);
}
