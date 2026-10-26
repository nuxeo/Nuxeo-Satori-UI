/**
 * Presales presets: named sets of configuration a demo package ships, so one demo server can be
 * shown to several prospects without redeploying.
 *
 * A bootstrap fragment declares them under `presales`:
 *
 * ```json
 * "presales": {
 *   "presetSwitching": true,
 *   "presets": {
 *     "acme": { "label": "Acme Insurance", "bootstrap": { ... }, "manifest": { ... } }
 *   }
 * }
 * ```
 *
 * A browser chooses one with `?preset=<name>`, which is remembered in `localStorage`;
 * `?preset=` with no name clears it. The chosen preset's `bootstrap` and `manifest` are applied
 * after every package's fragments, so it wins over all of them. **Nothing happens unless a
 * package sets `presetSwitching: true`** — a customer's server ignores the parameter and the
 * stored choice alike. Presets are package content, served anonymously like every fragment, and
 * the parameter only picks among them.
 */

export const PRESET_QUERY_PARAM = 'preset';

export const PRESET_STORAGE_KEY = 'agentic-ui.preset';

const PRESET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface AppPreset {
  readonly name: string;
  readonly label: string;
  readonly bootstrap: Readonly<Record<string, unknown>> | null;
  readonly manifest: Readonly<Record<string, unknown>> | null;
}

export interface AppPresalesConfig {
  readonly presetSwitching: boolean;
  readonly presets: Readonly<Record<string, AppPreset>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Collect `presales` across bootstrap fragments in order. A later `presetSwitching` wins, and a
 * later preset with the same name replaces the earlier one whole.
 */
export function readPresales(fragments: readonly unknown[]): AppPresalesConfig {
  let presetSwitching = false;
  // Looked up by a name from the URL, so `toString` or `__proto__` must not resolve to a builtin.
  const presets: Record<string, AppPreset> = Object.create(null);
  for (const fragment of fragments) {
    if (!isRecord(fragment) || !isRecord(fragment['presales'])) continue;
    const presales = fragment['presales'];
    if (typeof presales['presetSwitching'] === 'boolean') {
      presetSwitching = presales['presetSwitching'];
    }
    if (!isRecord(presales['presets'])) continue;
    for (const [name, entry] of Object.entries(presales['presets'])) {
      if (!PRESET_NAME.test(name) || !isRecord(entry)) continue;
      const label = entry['label'];
      presets[name] = {
        name,
        label: typeof label === 'string' && label.trim() !== '' ? label : name,
        bootstrap: isRecord(entry['bootstrap']) ? entry['bootstrap'] : null,
        manifest: isRecord(entry['manifest']) ? entry['manifest'] : null,
      };
    }
  }
  return { presetSwitching, presets };
}

/**
 * The preset the URL asks for: a name, `''` to clear the remembered one, or `undefined` when the
 * URL does not mention it. Read from the query and from the hash's query, because the app routes
 * with `withHashLocation()` and a link may put the parameter on either side of the `#`.
 */
export function requestedPreset(location: Pick<Location, 'search' | 'hash'>): string | undefined {
  const hashQuery = location.hash.includes('?')
    ? location.hash.slice(location.hash.indexOf('?'))
    : '';
  for (const query of [location.search, hashQuery]) {
    const params = new URLSearchParams(query);
    if (params.has(PRESET_QUERY_PARAM)) return (params.get(PRESET_QUERY_PARAM) ?? '').trim();
  }
  return undefined;
}
