import rawDataset from '../../data/companies.json' with { type: 'json' };
import type { Company, CompanyDataset } from '../../src/types/company.js';

/**
 * Dataset access for the serverless API.
 *
 * This deliberately does not reuse `src/lib/dataset.ts`: that module is written
 * for the Vite bundler, where a bare `import x from '*.json'` is rewritten for
 * you. A Vercel Node function may be executed as real ESM, where a JSON import
 * without an explicit `with { type: 'json' }` attribute is a runtime error. The
 * only thing duplicated here is the import itself — no domain logic.
 *
 * Module scope is the right place for this work: the JSON is inlined at build
 * time and the id index is built once per cold start, not once per request.
 */
const dataset = rawDataset as unknown as CompanyDataset;

export const companies: readonly Company[] = dataset.companies;

/** Dataset build timestamp — echoed on every response as `generatedAt`. */
export const generatedAt: string = dataset.generatedAt;

const byId: ReadonlyMap<string, Company> = new Map(companies.map((c) => [c.id, c]));

export function getCompanyById(id: string): Company | undefined {
  return byId.get(id);
}
