import { mergeObjects } from './extension-merge';
import type { ExtensionElement, ExtensionSlotId } from './extension-slots';
import type { ExtensionOverride } from './extension-slot-registry.service';

/**
 * The Layer 1 half of the runtime manifest, as a customer writes it.
 *
 * `$`-prefixed keys are **metadata and do not merge** — that is ACA's rule, and
 * `mergeObjects` reproduces it exactly (see `extension-merge.ts`). So `$references`
 * itself never leaks from a referenced layer into the merged result, and a layer
 * can carry `$name`/`$version` for diagnostics without polluting configuration.
 */
export interface ExtensionConfig {
  /** Layer names to merge over this object, in ascending `order`. Later wins. */
  readonly $references?: readonly string[];
  /** Layer names to drop even when `$references` lists them. */
  readonly $ignoreReferenceList?: readonly string[];
  /** Named layers, so a single manifest fragment can carry a whole stack. */
  readonly $layers?: Readonly<Record<string, ExtensionConfig>>;
  /** Free-form metadata for diagnostics. */
  readonly $name?: string;
  readonly $version?: string;

  /** Descriptors contributed per slot id. */
  readonly slots?: Readonly<Record<ExtensionSlotId, readonly ExtensionElement[]>>;
  /** Overrides for packaged descriptors, keyed by descriptor id. */
  readonly overrides?: Readonly<Record<string, ExtensionOverride>>;
}

/** Where a layer's body came from, so a failure to resolve one is reportable. */
export type ExtensionLayerResolver = (name: string) => ExtensionConfig | null;

export interface ResolvedExtensionConfig {
  readonly config: ExtensionConfig;
  /** Layer names merged, in the order applied. */
  readonly applied: readonly string[];
  /** Layer names listed but not resolvable, so the shell can report rather than guess. */
  readonly missing: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge configuration layers left to right, later winning.
 *
 * A thin wrapper over `mergeObjects`, which reproduces ACA's merge and is pinned to it case by
 * case in `extension-merge.spec.ts`:
 *
 * - arrays of objects merge **by `id`**, so a layer patches one toolbar entry
 *   without restating the toolbar;
 * - `"<key>.$replace"` replaces rather than merges, for the cases where a
 *   customer genuinely wants to drop our list;
 * - `$`-prefixed keys are skipped at the top level, and inside any object that
 *   two layers both set.
 */
export function mergeExtensionConfigs(...layers: readonly ExtensionConfig[]): ExtensionConfig {
  const present = layers.filter((layer) => isRecord(layer));
  if (present.length === 0) return {};
  return mergeObjects(...(present as unknown as Record<string, unknown>[])) as ExtensionConfig;
}

/**
 * Resolve `$references` against a layer lookup and merge the result.
 *
 * Layers are applied in the order `$references` lists them, so the **last file
 * wins** — a customer layer placed after ours overrides ours. Names in
 * `$ignoreReferenceList` are dropped even if referenced, which is how a
 * deployment disables a layer it cannot edit.
 *
 * References are resolved one level deep on purpose. A referenced layer's own
 * `$references` is metadata and is skipped by the merge, so nesting would be
 * silently ignored rather than half-honoured; keeping it flat means what a
 * customer reads in the JSON is what happens.
 */
export function resolveExtensionConfig(
  root: ExtensionConfig,
  resolveLayer: ExtensionLayerResolver = (name) => root.$layers?.[name] ?? null,
): ResolvedExtensionConfig {
  const ignored = new Set(root.$ignoreReferenceList ?? []);
  const names = (root.$references ?? []).filter((name) => !ignored.has(name));

  const applied: string[] = [];
  const missing: string[] = [];
  const bodies: ExtensionConfig[] = [];

  for (const name of names) {
    const layer = resolveLayer(name);
    if (!layer || !isRecord(layer)) {
      missing.push(name);
      continue;
    }
    applied.push(name);
    bodies.push(layer);
  }

  const merged = mergeExtensionConfigs(root, ...bodies);
  return { config: merged, applied, missing };
}

/**
 * Resolve each package's extension layer on its own, then merge them in contribution order, so
 * a package that depends on another wins over it.
 *
 * Each layer's `$references` resolve against that layer's own `$layers`: one package cannot
 * reach into another's named layers.
 */
export function resolveExtensionLayers(layers: readonly unknown[]): ResolvedExtensionConfig {
  const resolved = layers.map((layer) => resolveExtensionConfig(readExtensionConfig(layer)));
  return {
    config: mergeExtensionConfigs(...resolved.map((entry) => entry.config)),
    applied: resolved.flatMap((entry) => entry.applied),
    missing: resolved.flatMap((entry) => entry.missing),
  };
}

/**
 * Read an untrusted value into an {@link ExtensionConfig}.
 *
 * Tolerant in the same way as the Phase 1 loaders: a customer who saves
 * something malformed must get the packaged application back, not a blank
 * screen. Slot entries without a string `id` are dropped, because an entry with
 * no id cannot be addressed, overridden or reasoned about.
 */
export function readExtensionConfig(raw: unknown): ExtensionConfig {
  if (!isRecord(raw)) return {};

  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('$')) config[key] = value;
  }
  // Resolution iterates these, so a fragment that gets their shape wrong loses them rather than
  // throwing for every package.
  for (const key of ['$references', '$ignoreReferenceList']) {
    const names = raw[key];
    if (names === undefined) continue;
    config[key] = Array.isArray(names)
      ? names.filter((name): name is string => typeof name === 'string')
      : [];
  }
  const layers = raw['$layers'];
  if (layers !== undefined) {
    config['$layers'] = isRecord(layers)
      ? Object.fromEntries(
          Object.entries(layers)
            .filter(([, layer]) => isRecord(layer))
            .map(([name, layer]) => [name, readExtensionConfig(layer)]),
        )
      : {};
  }

  const slots = raw['slots'];
  if (isRecord(slots)) {
    const readSlots: Record<string, ExtensionElement[]> = {};
    for (const [slotId, entries] of Object.entries(slots)) {
      // Assigning it would replace the object's prototype, the thing `mergeObjects` refuses too.
      if (!Array.isArray(entries) || slotId === '__proto__') continue;
      readSlots[slotId] = entries.filter(
        (entry): entry is ExtensionElement =>
          isRecord(entry) && typeof entry['id'] === 'string' && entry['id'].trim() !== '',
      );
    }
    config['slots'] = readSlots;
  }

  const overrides = raw['overrides'];
  if (isRecord(overrides)) {
    const readOverrides: Record<string, ExtensionOverride> = {};
    for (const [id, override] of Object.entries(overrides)) {
      if (isRecord(override) && id !== '__proto__') {
        readOverrides[id] = override as ExtensionOverride;
      }
    }
    config['overrides'] = readOverrides;
  }

  return config as ExtensionConfig;
}
