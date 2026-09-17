import { z } from 'zod';

/**
 * The boundary with the HTTP API.
 *
 * Responses from a remote service are `unknown` until proven otherwise, so every
 * payload is parsed through these schemas before any field is read. The public
 * types below are hand-written with `readonly` members rather than inferred from
 * zod: zod produces mutable arrays, which are assignable to readonly ones, so a
 * parsed payload and a locally-computed one satisfy the same interface and the
 * rest of the server never has to care which source it got.
 *
 * Unknown keys are stripped rather than rejected, so the API can add a field
 * without breaking installed copies of this server.
 */

export interface ApiOpening {
  readonly title: string;
  readonly url: string | null;
  readonly postedDate: string | null;
  readonly detectedKeywords: readonly string[];
}

export interface ApiCompany {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly website: string | null;
  readonly careersUrl: string | null;
  readonly sizeRange: string | null;
  readonly sizeMin: number | null;
  readonly sizeMax: number | null;
  readonly hqLocation: string | null;
  readonly country: string | null;
  readonly remotePolicy: string | null;
  readonly remoteRegions: readonly string[];
  readonly keywords: readonly string[];
  readonly openings: number;
  readonly currentOpenings: readonly ApiOpening[];
  readonly historyWeeks: number;
  readonly lastVerified: string | null;
  readonly dataNotes: string | null;
}

export interface ApiScoredCompany extends ApiCompany {
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface ApiHistoryEntry {
  readonly weekOf: string;
  readonly openCount: number;
  readonly keywordCounts: Readonly<Record<string, number>>;
}

export interface ApiCompanyDetail extends ApiCompany {
  readonly history: readonly ApiHistoryEntry[];
}

export interface ApiPosition {
  readonly title: string;
  readonly url: string | null;
  readonly postedDate: string | null;
  readonly detectedKeywords: readonly string[];
  readonly companyId: string;
  readonly companyName: string;
  readonly companyWebsite: string | null;
  readonly careersUrl: string | null;
  readonly country: string | null;
  readonly remotePolicy: string | null;
  readonly matchedVia: 'position' | 'company' | null;
}

const nullableString = z.string().nullable().catch(null);
const nullableNumber = z.number().nullable().catch(null);
const stringArray = z.array(z.string()).catch([]);

const openingSchema = z.object({
  title: z.string(),
  url: nullableString,
  postedDate: nullableString,
  detectedKeywords: stringArray,
});

const companySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().catch(''),
  website: nullableString,
  careersUrl: nullableString,
  sizeRange: nullableString,
  sizeMin: nullableNumber,
  sizeMax: nullableNumber,
  hqLocation: nullableString,
  country: nullableString,
  remotePolicy: nullableString,
  remoteRegions: stringArray,
  keywords: stringArray,
  openings: z.number().catch(0),
  currentOpenings: z.array(openingSchema).catch([]),
  historyWeeks: z.number().catch(0),
  lastVerified: nullableString,
  dataNotes: nullableString,
});

const scoredCompanySchema = companySchema.extend({
  score: z.number().catch(0),
  reasons: stringArray,
});

const historySchema = z.object({
  weekOf: z.string(),
  openCount: z.number().catch(0),
  keywordCounts: z.record(z.number()).catch({}),
});

const positionSchema = z.object({
  title: z.string(),
  url: nullableString,
  postedDate: nullableString,
  detectedKeywords: stringArray,
  companyId: z.string(),
  companyName: z.string(),
  companyWebsite: nullableString,
  careersUrl: nullableString,
  country: nullableString,
  remotePolicy: nullableString,
  matchedVia: z.enum(['position', 'company']).nullable().catch(null),
});

export const searchResponseSchema = z.object({
  generatedAt: z.string(),
  total: z.number(),
  results: z.array(scoredCompanySchema),
});

export const companiesResponseSchema = z.object({
  generatedAt: z.string(),
  total: z.number(),
  companies: z.array(scoredCompanySchema),
});

export const detailResponseSchema = z.object({
  generatedAt: z.string(),
  company: companySchema.extend({ history: z.array(historySchema).catch([]) }),
});

export const positionsResponseSchema = z.object({
  generatedAt: z.string(),
  total: z.number(),
  companiesMatched: z.number().catch(0),
  positions: z.array(positionSchema),
});

/** The API's error envelope, so a 4xx can be reported with its real message. */
export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
