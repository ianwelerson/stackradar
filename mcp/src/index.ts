#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { compactCompany, compactPosition, detailedCompany, freshnessNote } from './compact.js';
import {
  baseUrl,
  getCompany,
  listCompanies,
  listPositions,
  searchCompanies,
  type DirectoryFilters,
} from './directory.js';

/**
 * Stack Radar MCP server (stdio).
 *
 * Tool descriptions are the entire interface a model sees, so they state what
 * the tool is for, when to reach for it over the other two, and — every time —
 * that the data is community-researched and may never have been verified.
 */

const SERVER_NAME = 'stack-radar';
const SERVER_VERSION = '1.0.0';

/** Mirrors the HTTP API's own cap; a longer query is a malformed one. */
const MAX_QUERY_LENGTH = 120;
const MAX_COUNTRY_LENGTH = 80;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const FRESHNESS_CAVEAT =
  'Data is community-researched, not an official feed: every record carries a `lastVerified` timestamp and for many records it is null, meaning that company has never been checked against its own careers page. Treat results as leads to confirm at `careersUrl`, and say so when reporting them.';

const filtersSchema = z
  .object({
    country: z
      .string()
      .max(MAX_COUNTRY_LENGTH)
      .optional()
      .describe(
        'Where the candidate can work from, as an exact country name, case-insensitive (e.g. "Estonia", "United States"). A company matches when one of its roles is open to that country — directly, through a region containing it, or worldwide. Pass "worldwide" instead of a country to keep only roles open with no country restriction; that is a narrowing, not the same as omitting this. Companies whose roles do not say who may apply are excluded, not assumed to match.',
      ),
    remote: z
      .enum(['remote', 'hybrid', 'onsite'])
      .optional()
      .describe(
        'Working model. Companies with no recorded policy are excluded rather than guessed at.',
      ),
    minSize: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Minimum headcount. A company matches when its own size range overlaps the requested range; companies with unknown headcount are excluded.',
      ),
    maxSize: z.number().int().min(0).optional().describe('Maximum headcount.'),
  })
  .describe('Optional filters. Omit any field to leave that dimension unfiltered.');

const limitSchema = z
  .number()
  .int()
  .optional()
  .describe(`How many rows to return. Default ${DEFAULT_LIMIT}, clamped to ${MAX_LIMIT}.`);

type FilterInput = z.infer<typeof filtersSchema>;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function toDirectoryFilters(input: FilterInput | undefined, keyword?: string): DirectoryFilters {
  const trimmedKeyword = keyword?.trim();
  return {
    keyword: trimmedKeyword !== undefined && trimmedKeyword.length > 0 ? trimmedKeyword : null,
    country: input?.country?.trim() ?? null,
    remote: input?.remote ?? null,
    minSize: input?.minSize ?? null,
    maxSize: input?.maxSize ?? null,
  };
}

/**
 * Echo back only the structural filters. `search_companies` reports its free
 * text as `query`, so repeating a null `keyword` next to it would read as if
 * the search had no term.
 */
function echoStructuralFilters(filters: DirectoryFilters): Record<string, unknown> {
  return {
    country: filters.country,
    remote: filters.remote,
    minSize: filters.minSize,
    maxSize: filters.maxSize,
  };
}

function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Turn any thrown value into a message without leaking a stack trace. */
function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function countUnverified(rows: readonly { readonly lastVerified: string | null }[]): number {
  return rows.filter((row) => row.lastVerified === null).length;
}

const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    instructions:
      'Stack Radar is a public directory of tech companies and the engineering roles they have open. ' +
      'Use `search_companies` to find companies by technology, product area or location; `get_company` ' +
      'for one company in full; `list_open_positions` to see actual roles across the whole dataset. ' +
      FRESHNESS_CAVEAT,
  },
);

server.registerTool(
  'search_companies',
  {
    title: 'Search companies',
    description:
      'Search the Stack Radar directory for companies, ranked by relevance. Use this when a user asks which companies work with a given technology, product area, or market ("companies using React", "identity verification startups"), or when they want companies matching structural criteria like country, remote policy or headcount. ' +
      'The query is matched against company names, curated technology keywords, keywords detected on currently-open roles, role titles, descriptions and locations; each result carries a 0-100 `score` and the `matchReasons` that produced it. ' +
      'Omit `query` to browse by filters alone. ' +
      'Prefer `list_open_positions` when the user wants actual job listings rather than companies, and `get_company` once you know which company they care about. ' +
      FRESHNESS_CAVEAT,
    inputSchema: {
      query: z
        .string()
        .max(MAX_QUERY_LENGTH)
        .optional()
        .describe(
          `Free-text query, at most ${MAX_QUERY_LENGTH} characters — technologies, product areas or places, e.g. "typescript payments" or "estonia fintech". Multiple words are scored independently, so more words broaden rather than narrow the search. Omit to filter without ranking by relevance.`,
        ),
      filters: filtersSchema.optional(),
      limit: limitSchema,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ query, filters, limit }) => {
    try {
      const rowLimit = clampLimit(limit);
      const trimmed = query?.trim() ?? '';
      const directoryFilters = toDirectoryFilters(filters);

      const result =
        trimmed.length > 0
          ? await searchCompanies(trimmed, directoryFilters, rowLimit)
          : await listCompanies(directoryFilters, rowLimit);

      return jsonResult({
        source: result.source,
        generatedAt: result.generatedAt,
        totalMatches: result.total,
        returned: result.data.length,
        query: trimmed.length > 0 ? trimmed : null,
        filters: echoStructuralFilters(directoryFilters),
        companies: result.data.map(compactCompany),
        note: freshnessNote(countUnverified(result.data), result.data.length),
      });
    } catch (error: unknown) {
      return errorResult(`Could not search the directory: ${describeFailure(error)}`);
    }
  },
);

server.registerTool(
  'get_company',
  {
    title: 'Get company detail',
    description:
      'Fetch one company\'s complete Stack Radar record by id: description, website, careers URL, headcount range, HQ and country, remote policy and regions, technology keywords, every currently-open role with its detected keywords, and the weekly history of how many roles it has had open. ' +
      'Use this after `search_companies` or `list_open_positions` has given you an id, or when a user names a company you have already seen in results. Ids are stable slugs such as "resend" or "pipedrive" — if you are not certain of the id, search first rather than guessing. ' +
      FRESHNESS_CAVEAT,
    inputSchema: {
      id: z
        .string()
        .min(1)
        .max(64)
        .describe(
          'The company id (a lowercase slug) exactly as returned in the `id` field of a search or positions result.',
        ),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ id }) => {
    try {
      const trimmed = id.trim();
      if (trimmed.length === 0) return errorResult('A company id is required.');

      const result = await getCompany(trimmed);
      if (result === null) {
        return errorResult(
          `No company with id "${trimmed}" is in the directory. Use search_companies to find the right id.`,
        );
      }

      return jsonResult({
        source: result.source,
        generatedAt: result.generatedAt,
        company: detailedCompany(result.data),
        note: freshnessNote(result.data.lastVerified === null ? 1 : 0, 1),
      });
    } catch (error: unknown) {
      return errorResult(`Could not load that company: ${describeFailure(error)}`);
    }
  },
);

server.registerTool(
  'list_open_positions',
  {
    title: 'List open positions',
    description:
      'List actual open engineering roles across the entire Stack Radar dataset, flattened into one list. Each row is a single role — title, link, posted date, detected technology keywords — annotated with its company\'s id, name, website, country and remote policy, so you can answer without a follow-up call. ' +
      'Use this whenever the user asks about jobs or roles rather than companies ("what React roles are open right now", "any remote backend jobs in Estonia"). Use `search_companies` instead when the user is evaluating companies rather than applying to a role. ' +
      'The `keyword` filter is applied at the company level first and then refined per role: each row\'s `matchedVia` is "position" when the role\'s own title or keywords matched, or "company" when only the company record did — treat a "company" row as related context, not as a role about that keyword. ' +
      FRESHNESS_CAVEAT,
    inputSchema: {
      filters: filtersSchema
        .extend({
          keyword: z
            .string()
            .max(MAX_QUERY_LENGTH)
            .optional()
            .describe(
              `Free-text role/technology filter, at most ${MAX_QUERY_LENGTH} characters, e.g. "react" or "rust backend". Check each row's \`matchedVia\` to see whether the role itself matched.`,
            ),
        })
        .optional(),
      limit: limitSchema,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ filters, limit }) => {
    try {
      const rowLimit = clampLimit(limit);
      const directoryFilters = toDirectoryFilters(filters, filters?.keyword);
      const result = await listPositions(directoryFilters, rowLimit);

      return jsonResult({
        source: result.source,
        generatedAt: result.generatedAt,
        totalPositions: result.total,
        returned: result.data.length,
        companiesMatched: result.companiesMatched,
        filters: directoryFilters,
        positions: result.data.map(compactPosition),
        note:
          'Community-researched data, not a live job board. A listing may already have closed; confirm at the role URL or the company’s `careersUrl` before telling a user it is open.',
      });
    } catch (error: unknown) {
      return errorResult(`Could not list open positions: ${describeFailure(error)}`);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel; every human-readable line goes to stderr.
  console.error(`[${SERVER_NAME}] ready — API base ${baseUrl}`);
}

main().catch((error: unknown) => {
  console.error(`[${SERVER_NAME}] failed to start: ${describeFailure(error)}`);
  process.exit(1);
});
