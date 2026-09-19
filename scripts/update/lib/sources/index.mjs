/**
 * Discovery source registry.
 *
 * Adding a source is one import and one line in `sources`. Every source exports
 * `id` and `discover(http, config)` returning { candidates, diagnostics }; the
 * caller picks which ones to run from `config.discovery.sources`.
 */
import * as ycombinator from './ycombinator.mjs';
import * as seeds from './seeds.mjs';
import * as workatastartup from './workatastartup.mjs';
import * as weworkremotely from './weworkremotely.mjs';
import * as remoteok from './remoteok.mjs';
import * as hnhiring from './hnhiring.mjs';

export const sources = {
  [ycombinator.id]: ycombinator,
  [seeds.id]: seeds,
  [workatastartup.id]: workatastartup,
  [weworkremotely.id]: weworkremotely,
  [remoteok.id]: remoteok,
  [hnhiring.id]: hnhiring,
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
