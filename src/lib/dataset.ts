import rawDataset from '../../data/companies.json';
import type { Company, CompanyDataset } from '@/types/company';

/**
 * The dataset is a build-time import: it is static, committed to the repo, and
 * small enough that bundling it beats an extra network round-trip. The update
 * script rewrites the JSON and a normal git push redeploys.
 */
const dataset = rawDataset as unknown as CompanyDataset;

export const companies: readonly Company[] = dataset.companies;
export const generatedAt: string = dataset.generatedAt;

const byId = new Map<string, Company>(companies.map((c) => [c.id, c]));

export function getCompany(id: string): Company | undefined {
  return byId.get(id);
}

export const totalOpenings: number = companies.reduce(
  (sum, c) => sum + c.currentOpenings.length,
  0,
);

export const verifiedCount: number = companies.filter((c) => c.lastVerified !== null).length;
