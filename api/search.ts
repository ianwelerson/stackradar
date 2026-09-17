import { generatedAt } from './_lib/dataset.js';
import { badRequest, createGetHandler, jsonResponse } from './_lib/http.js';
import { readKeyword, readPaging } from './_lib/params.js';
import { describeQuery, filterCompanies, parseCompanyQuery } from './_lib/query.js';
import { toScoredSummary } from './_lib/shape.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

/**
 * GET /api/search?q=...
 *
 * Ranked keyword search over the directory, using the same confidence scoring
 * (spec §5) the UI uses — `src/lib/scoring.ts`, imported, not reimplemented.
 * Every result carries its 0–100 `score` and the `reasons` behind it.
 *
 * The filter params of /api/companies are accepted here too, so an agent can
 * ask one question ("React roles at remote companies in Estonia") in one call.
 */
export default createGetHandler((url) => {
  // `q` is the documented name; `query` is accepted because it is the obvious
  // guess and a 400 for a synonym is a bad experience for a calling model.
  const q = readKeyword(url, ['q', 'query']);
  if (q === null) {
    throw badRequest('"q" is required, e.g. /api/search?q=react.');
  }

  const { limit } = readPaging(url, DEFAULT_LIMIT, MAX_LIMIT);
  const query = { ...parseCompanyQuery(url), keyword: q };
  const { results, excluded } = filterCompanies(query);

  const page = results.slice(0, limit);

  return jsonResponse({
    generatedAt,
    query: q,
    total: results.length,
    count: page.length,
    limit,
    filters: describeQuery(query),
    excluded,
    results: page.map(toScoredSummary),
  });
});
