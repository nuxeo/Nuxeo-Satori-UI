/**
 * The configuration servlet's response, built the way `nuxeo-agentic-core` builds it, for steps
 * that answer `agentic-ui-config/bootstrap.json` or `manifest.json` with `page.route`.
 *
 * The application accepts only this envelope: a bare configuration object is refused, so a step
 * that served one would be asserting the packaged-default fallback without knowing it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const CONFIG_FORMAT = 'nuxeo-agentic-ui-config/1';

const DEFAULTS_DIR = 'nuxeo-agentic-core/src/main/resources/agentic-ui-config';

/**
 * The fragment our bundle contributes for a layer, whose values are the compiled defaults.
 *
 * @param {'bootstrap' | 'manifest'} layer
 * @returns {Record<string, unknown>}
 */
export function packagedDefaults(layer) {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), DEFAULTS_DIR, `${layer}.defaults.json`), 'utf8'),
  );
}

/**
 * The response for `layer`: our defaults first, then each customer fragment in order, as the
 * servlet orders a package that depends on ours.
 *
 * @param {'bootstrap' | 'manifest'} layer
 * @param {{ defaults?: Record<string, unknown> | null, customer?: Record<string, unknown>[] }} [options]
 *   `defaults` replaces our fragment's content (`null` omits it); `customer` adds `com.acme.config`
 *   fragments after it.
 * @returns {string}
 */
export function configResponse(layer, { defaults = packagedDefaults(layer), customer = [] } = {}) {
  const fragment = (component, name, content) => ({
    name,
    component,
    bundle: component,
    source: `agentic-ui-config/${name}.json`,
    content,
  });
  return JSON.stringify({
    format: CONFIG_FORMAT,
    layer,
    fragments: [
      ...(defaults === null
        ? []
        : [fragment('org.nuxeo.agentic.ui.config.defaults', 'defaults', defaults)]),
      ...customer.map((content, index) =>
        fragment('com.acme.config', `acme-${index + 1}`, content),
      ),
    ],
    diagnostics: [],
  });
}
