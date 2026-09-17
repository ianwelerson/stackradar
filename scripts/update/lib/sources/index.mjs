/**
 * Discovery source registry.
 *
 * Adding a source is one import and one line in `sources`. Every source exports
 * `id` and `discover(http, config)` returning { candidates, diagnostics }; the
 * caller picks which ones to run from `config.discovery.sources`.
 */
import * as ycombinator from './ycombinator.mjs';

export const sources = {
  [ycombinator.id]: ycombinator,
};

/** A single source by id, or null when the config names one we do not have. */
export function getSource(id) {
  return Object.prototype.hasOwnProperty.call(sources, id) ? sources[id] : null;
}

/**
 * The sources named in config, in config order, with unknown ids dropped.
 * Defaults to every registered source when the config names none.
 */
export function selectSources(config) {
  const ids = config?.discovery?.sources;
  if (!Array.isArray(ids) || ids.length === 0) return Object.values(sources);
  return ids.map((id) => getSource(id)).filter((source) => source !== null);
}
