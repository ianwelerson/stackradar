/**
 * The boundary between deterministic code and model judgement.
 *
 * `buildTasks` emits the gaps a model should research. `validateResults` is the
 * gate everything coming back must pass before it reaches the dataset — the
 * model's output is treated as untrusted input, because it is: it is generated
 * text, and a hallucinated headcount written straight into companies.json is
 * indistinguishable from a real one once it lands.
 *
 * The rules are therefore narrow on purpose. Only a fixed set of fields may be
 * filled, each is type- and range-checked, unknown ids are rejected rather than
 * silently creating records, and anything that fails is reported rather than
 * dropped quietly.
 */

/** Fields a model may fill. Nothing outside this list is ever accepted. */
export const ENRICHABLE_FIELDS = [
  'description',
  'website',
  'careersUrl',
  'linkedinUrl',
  'sizeRange',
  'sizeMin',
  'sizeMax',
  'hqLocation',
  'country',
  'remotePolicy',
  'remoteRegions',
  'keywords',
  'dataNotes',
];

const REMOTE_POLICIES = new Set(['remote', 'hybrid', 'onsite']);

/** Which fields are missing and worth asking about. */
export function gapsFor(company) {
  const gaps = [];
  if (company.country === null) gaps.push('country');
  if (company.sizeMin === null && company.sizeMax === null) gaps.push('size');
  if (company.remotePolicy === null) gaps.push('remotePolicy');
  if (company.careersUrl === null) gaps.push('careersUrl');
  if (company.keywords.length === 0) gaps.push('keywords');
  if (company.lastVerified === null) gaps.push('neverVerified');
  return gaps;
}

export function buildTasks(companies, { limit = 20, only = null } = {}) {
  const candidates = companies
    .map((c) => ({ company: c, gaps: gapsFor(c) }))
    .filter(({ gaps }) => gaps.length > 0)
    .filter(({ company }) => (only === null ? true : only.includes(company.id)))
    // Most-incomplete first: those are where a single lookup buys the most.
    .sort((a, b) => b.gaps.length - a.gaps.length)
    .slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    instructions:
      'Research each company below and return { "results": [ { "id", "facts", "trust", "note" } ] }. ' +
      'Only include facts you actually confirmed — omit a field rather than guessing, since null is a ' +
      'first-class value in this dataset and a wrong value is worse than a missing one. ' +
      'Set "trust" to "primary" only when the fact came from the company\'s own site; use "directory" otherwise. ' +
      'Both values are case-sensitive and nothing else is accepted. This matters: "directory" only fills ' +
      'fields that are currently empty, so a correct fact submitted at directory trust against a field that ' +
      'already has a value changes nothing. If you read it on the company\'s own site, say "primary". ' +
      `Allowed fact fields, spelled exactly: ${ENRICHABLE_FIELDS.join(', ')}. ` +
      'The "missing" list on each task names gaps, not field names — two of its labels have no matching ' +
      'field: report a headcount as "sizeMin" and "sizeMax" (plus "sizeRange" for display) rather than ' +
      '"size", and "neverVerified" is not something you can supply at all — it means no job-board scan has ' +
      'confirmed this company yet, which only a refresh run can change.',
    tasks: candidates.map(({ company, gaps }) => ({
      id: company.id,
      name: company.name,
      website: company.website,
      careersUrl: company.careersUrl,
      description: company.description,
      known: {
        country: company.country,
        sizeRange: company.sizeRange,
        remotePolicy: company.remotePolicy,
        keywords: company.keywords,
      },
      missing: gaps,
    })),
  };
}

function validateFacts(facts, errors, id) {
  const clean = {};

  for (const [key, value] of Object.entries(facts)) {
    if (!ENRICHABLE_FIELDS.includes(key)) {
      errors.push(`${id}: field "${key}" is not enrichable`);
      continue;
    }
    if (value === null) continue;

    switch (key) {
      case 'sizeMin':
      case 'sizeMax': {
        if (!Number.isInteger(value) || value < 1 || value > 5_000_000) {
          errors.push(`${id}: ${key} must be an integer 1..5000000, got ${JSON.stringify(value)}`);
          continue;
        }
        clean[key] = value;
        break;
      }
      case 'remotePolicy': {
        if (!REMOTE_POLICIES.has(value)) {
          errors.push(`${id}: remotePolicy must be remote|hybrid|onsite, got ${JSON.stringify(value)}`);
          continue;
        }
        clean[key] = value;
        break;
      }
      case 'linkedinUrl': {
        // Constrained to a company page. Anything else — a personal profile, a
        // job post, some other site entirely — is not what this field links to,
        // and the reader would have no way to tell before clicking.
        if (typeof value !== 'string' || !/^https:\/\/(www\.)?linkedin\.com\/company\/[^\s/]+/.test(value)) {
          errors.push(`${id}: linkedinUrl must be an https linkedin.com/company URL, got ${JSON.stringify(value)}`);
          continue;
        }
        clean[key] = value;
        break;
      }
      case 'website':
      case 'careersUrl': {
        if (typeof value !== 'string' || !/^https:\/\/[^\s]+\.[^\s]+$/.test(value)) {
          errors.push(`${id}: ${key} must be an https URL, got ${JSON.stringify(value)}`);
          continue;
        }
        clean[key] = value;
        break;
      }
      case 'logoUrl': {
        // Unlike website and careersUrl, a logo is normally local: lib/logos.mjs
        // downloads it at update time and this becomes "/logos/<id>.<ext>", so
        // the visitor's browser never requests a company's CDN. A root-relative
        // path into /logos/ is therefore allowed alongside https, and nothing
        // else is — in particular not "//host" (protocol-relative, still a
        // third-party request), not a path containing "..", and not any other
        // directory. The same rule is spelled out in data/companies.schema.json
        // and scripts/validate-data.mjs; keep the three in step.
        //
        // Note: "logoUrl" is not in ENRICHABLE_FIELDS, so this case is not
        // reachable today — model output cannot set a logo, which is the right
        // default given a remote URL here would undo the privacy property.
        // The rule lives here so that it is already correct if the logo phase
        // is ever routed through apply.
        const isLocal =
          typeof value === 'string' && /^\/logos\/[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/.test(value);
        const isHttps = typeof value === 'string' && /^https:\/\/[^\s]+\.[^\s]+$/.test(value);
        if (!isLocal && !isHttps) {
          errors.push(
            `${id}: logoUrl must be an https URL or a /logos/<slug>.<ext> path, got ${JSON.stringify(value)}`,
          );
          continue;
        }
        clean[key] = value;
        break;
      }
      case 'keywords':
      case 'remoteRegions': {
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
          errors.push(`${id}: ${key} must be an array of strings`);
          continue;
        }
        clean[key] =
          key === 'keywords'
            ? value.map((v) => v.toLowerCase().trim().replace(/\s+/g, '-')).filter(Boolean).slice(0, 8)
            : value.map((v) => v.trim()).filter(Boolean);
        break;
      }
      default: {
        if (typeof value !== 'string' || value.trim() === '') {
          errors.push(`${id}: ${key} must be a non-empty string`);
          continue;
        }
        clean[key] = value.trim().slice(0, 600);
      }
    }
  }

  if (
    clean.sizeMin !== undefined &&
    clean.sizeMax !== undefined &&
    clean.sizeMin > clean.sizeMax
  ) {
    errors.push(`${id}: sizeMin ${clean.sizeMin} > sizeMax ${clean.sizeMax}`);
    delete clean.sizeMin;
    delete clean.sizeMax;
  }

  return clean;
}

export function validateResults(payload, companies) {
  const errors = [];
  const accepted = [];

  if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.results)) {
    return { accepted: [], errors: ['payload must be { "results": [ ... ] }'] };
  }

  const byId = new Map(companies.map((c) => [c.id, c]));

  for (const entry of payload.results) {
    if (typeof entry !== 'object' || entry === null) {
      errors.push('a result entry was not an object');
      continue;
    }
    const { id, facts, trust, note } = entry;

    if (typeof id !== 'string' || !byId.has(id)) {
      // Never create a record from model output — enrichment fills gaps in
      // companies that already exist, discovery is a separate, auditable path.
      errors.push(`unknown company id ${JSON.stringify(id)}`);
      continue;
    }
    if (typeof facts !== 'object' || facts === null) {
      errors.push(`${id}: "facts" must be an object`);
      continue;
    }

    // A trust level that is present but not one of the two valid values used to
    // fall through to 'directory', which then silently refused to overwrite
    // anything already set — so "Primary" instead of "primary" looked exactly
    // like a successful run that changed nothing. Say so instead of guessing.
    if (trust !== undefined && trust !== 'primary' && trust !== 'directory') {
      errors.push(
        `${id}: "trust" must be "primary" or "directory", got ${JSON.stringify(trust)}`
        + ' (it is case-sensitive)',
      );
      continue;
    }

    const clean = validateFacts(facts, errors, id);
    if (Object.keys(clean).length === 0) continue;

    accepted.push({
      id,
      facts: clean,
      trust: trust === 'primary' ? 'primary' : 'directory',
      note: typeof note === 'string' ? note.slice(0, 300) : null,
    });
  }

  return { accepted, errors };
}
