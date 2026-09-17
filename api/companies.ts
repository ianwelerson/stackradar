import { generatedAt } from './_lib/dataset.js';
import { createGetHandler, jsonResponse } from './_lib/http.js';
import { readPaging } from './_lib/params.js';
import { describeQuery, filterCompanies, parseCompanyQuery } from './_lib/query.js';
import { toScoredSummary } from './_lib/shape.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * GET /api/companies
 *
 * The directory as a list, filtered the same way the UI filters it. Records are
 * summaries: everything except the weekly `history` log, which is large, rarely
 * needed in a list view, and available on /api/companies/{id}.
 */
export default createGetHandler((url) => {
  const query = parseCompanyQuery(url);
  const { limit, offset } = readPaging(url, DEFAULT_LIMIT, MAX_LIMIT);
  const { results, excluded } = filterCompanies(query);

  const page = results.slice(offset, offset + limit);

  return jsonResponse({
    generatedAt,
    total: results.length,
    count: page.length,
    limit,
    offset,
    filters: describeQuery(query),
    // Rows dropped because the data needed to judge them is missing, not
    // because they failed the filter. Most of the dataset is unverified.
    excluded,
    companies: page.map(toScoredSummary),
  });
});
