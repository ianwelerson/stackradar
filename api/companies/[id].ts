import { generatedAt, getCompanyById } from '../_lib/dataset.js';
import { createGetHandler, jsonResponse, notFound } from '../_lib/http.js';
import { readIdFromPath } from '../_lib/params.js';
import { toCompanyDetail } from '../_lib/shape.js';

/**
 * GET /api/companies/{id}
 *
 * One company's full record, including `currentOpenings` and the append-only
 * weekly `history` log. `id` is the stable slug the update script merges on.
 */
export default createGetHandler((url) => {
  const id = readIdFromPath(url);
  const company = getCompanyById(id);

  if (company === undefined) {
    throw notFound(`No company with id "${id}".`);
  }

  return jsonResponse({ generatedAt, company: toCompanyDetail(company) });
});
