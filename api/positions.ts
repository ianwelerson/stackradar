import { generatedAt } from './_lib/dataset.js';
import { createGetHandler, jsonResponse } from './_lib/http.js';
import { readPaging } from './_lib/params.js';
import { describeQuery, filterCompanies, parseCompanyQuery } from './_lib/query.js';
import { flattenPositions } from './_lib/shape.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * GET /api/positions
 *
 * Every open role across the whole dataset, flattened and annotated with its
 * company's id, name, website, country and remote policy — so "what React
 * roles are open right now" is one request, not 58.
 *
 * Accepts the same filters as /api/companies. The `keyword` is applied at the
 * company level by the shared scorer and then refined per role; see
 * `matchedVia` on each row for which of the two produced the hit.
 */
export default createGetHandler((url) => {
  const query = parseCompanyQuery(url);
  const { limit, offset } = readPaging(url, DEFAULT_LIMIT, MAX_LIMIT);
  const { results, excluded } = filterCompanies(query);

  const positions = flattenPositions(results, query.keyword);
  const page = positions.slice(offset, offset + limit);

  return jsonResponse({
    generatedAt,
    total: positions.length,
    count: page.length,
    limit,
    offset,
    companiesMatched: results.length,
    filters: describeQuery(query),
    excluded,
    positions: page,
  });
});
