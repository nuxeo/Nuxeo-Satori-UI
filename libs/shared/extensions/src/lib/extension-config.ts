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

/**
 * A slot entry the read refused, and why.
 *
 * Reported rather than dropped for the same reason `ResolvedExtensionConfig.missing` and
 * `RejectedExtensionRoute` are: an entry that disappears without a word is a manifest you
 * debug by bisection. Before NXSAT-755 a customer whose slot was an object instead of a
 * list, or whose entry had a typo in `id`, saw no effect and was given no reason.
 */
export interface RefusedExtensionEntry {
  /** Slot it was written into, so the reader knows which list is short of a row. */
  readonly slot: ExtensionSlotId;
  /**
   * Its `id`, or `null` when it had no usable one — which is itself most of the reason, and
   * leaves the position in the array as the only thing there is to point at.
   */
  readonly id: string | null;
  /** Human-readable cause, quoting what was found and what became of the entry. */
  readonly reason: string;
  /**
   * Which contribution wrote it: the layer's own `$name`, the `$layers` entry it sits in, or
   * its position in contribution order when it declares no `$name`.
   *
   * Deliberately **not** called `fragment`. The Marketplace component behind a fragment is
   * known to `AppConfigService.diagnostics().manifestFragments` and is not carried into
   * `AppRuntimeManifest.extensionLayers`, which holds the layer bodies alone — and the two
   * lists cannot be joined by position, because only a fragment with an `extensions` key
   * contributes a layer at all. `$name` is the field `docs/extension-reference.md` already
   * tells a customer to write for diagnostics, so it is what can be named here without
   * inventing a provenance this library cannot see.
   */
  readonly source: string;
}

/** {@link resolveExtensionLayers}'s result: a {@link ResolvedExtensionConfig} that also reports. */
export interface ResolvedExtensionLayers extends ResolvedExtensionConfig {
  /** Slot entries refused while reading the layers — see {@link RefusedExtensionEntry}. */
  readonly refused: readonly RefusedExtensionEntry[];
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
export function resolveExtensionLayers(layers: readonly unknown[]): ResolvedExtensionLayers {
  const refused: RefusedExtensionEntry[] = [];
  const resolved = layers.map((layer, index) =>
    resolveExtensionConfig(readConfig(layer, layerSource(layer, index), refused)),
  );
  return {
    config: mergeExtensionConfigs(...resolved.map((entry) => entry.config)),
    applied: resolved.flatMap((entry) => entry.applied),
    missing: resolved.flatMap((entry) => entry.missing),
    refused,
  };
}

/**
 * Read an untrusted value into an {@link ExtensionConfig}.
 *
 * Tolerant in the same way as the Phase 1 loaders: a customer who saves
 * something malformed must get the packaged application back, not a blank
 * screen. Slot entries without a string `id` are dropped, because an entry with
 * no id cannot be addressed, overridden or reasoned about.
 *
 * Tolerant, but no longer silent. Every drop is recorded as a
 * {@link RefusedExtensionEntry} and reaches the customer through
 * `AppExtensionsService.refusedSlotEntries()` and the console. This function discards those
 * records, keeping the signature callers that only want the configuration already have;
 * {@link resolveExtensionLayers} is the one that keeps them, because it alone knows a layer's
 * position in contribution order and so can say where a refused entry was written.
 */
export function readExtensionConfig(raw: unknown): ExtensionConfig {
  return readConfig(raw, layerSource(raw, 0), []);
}

/**
 * How to name a contributed layer in a diagnostic.
 *
 * `$name` is documented as free-form metadata for diagnostics and the reference doc's own
 * example writes one, so it is preferred. Contribution order is the fallback because it is
 * the only other thing true of a layer the server served: `extensionLayers` holds bodies in
 * contribution order and nothing else.
 */
function layerSource(raw: unknown, index: number): string {
  const declared = isRecord(raw) ? raw['$name'] : undefined;
  const name = typeof declared === 'string' ? declared.trim() : '';
  return name === '' ? `contribution ${index + 1}` : name;
}

/** Same, for a named `$layers` body, which is findable by the name it is filed under. */
function sublayerSource(parent: string, name: string, raw: unknown): string {
  const own = layerSource(raw, 0);
  return own.startsWith('contribution ') ? `$layers.${name} of ${parent}` : own;
}

/** What a malformed value is, so the message says what to look for rather than what to expect. */
function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (isRecord(value)) return 'an object';
  return `a ${typeof value}`;
}

/**
 * {@link readExtensionConfig}'s body, collecting what it refused.
 *
 * The refusals are gathered here, at the read, rather than reconstructed by a second walk
 * over the same JSON: a reporter that re-derives which entries were dropped is a check
 * testing a proxy for the thing in its own name, and it goes quietly wrong the first time
 * this filter changes and it does not.
 */
function readConfig(
  raw: unknown,
  source: string,
  refused: RefusedExtensionEntry[],
): ExtensionConfig {
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
            .map(([name, layer]) => [
              name,
              readConfig(layer, sublayerSource(source, name, layer), refused),
            ]),
        )
      : {};
  }

  const slots = raw['slots'];
  if (isRecord(slots)) {
    const readSlots: Record<string, ExtensionElement[]> = {};
    for (const [slotId, entries] of Object.entries(slots)) {
      // Assigning it would replace the object's prototype, the thing `mergeObjects` refuses too.
      if (slotId === '__proto__') {
        refused.push({
          slot: slotId,
          id: null,
          source,
          reason: 'a slot may not be named "__proto__", so the whole slot is dropped',
        });
        continue;
      }
      if (!Array.isArray(entries)) {
        refused.push({
          slot: slotId,
          id: null,
          source,
          reason: `a slot must be a list of entries, not ${describeShape(entries)}, so the whole slot is dropped`,
        });
        continue;
      }
      readSlots[slotId] = readSlotEntries(slotId, entries, source, refused);
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

/**
 * One slot's entries, with the unaddressable ones dropped and every refusal recorded.
 *
 * The filter is the one that was here before and is load-bearing, not merely tidy: it is
 * what stops an id-less entry reaching the registry, where `findIndex(c => c.id === entry.id)`
 * would make every id-less entry collide with every other. It is made to speak, not removed.
 *
 * ## Why a repeated `id` is reported here and nowhere else
 *
 * A same-`id` entry is reported **only when both entries are in the same contributed list**.
 * Across contributions it is the documented override mechanism and must stay silent:
 * `ExtensionSlotRegistry.register` is idempotent per id so a customer library can replace a
 * packaged entry; `resolve` patches a packaged id on purpose, which is what its `withoutAction`
 * carve-out is a security control for; and `mergeObjects` merges arrays by `id` so a
 * `$references` layer can patch one row without restating the list. A diagnostic on any of
 * those would fire on every correctly layered manifest and be worse than silence.
 *
 * Inside one list there is no override to express — you would edit the row — so two rows at
 * one address is a copy-paste typo, and this is the only boundary that can still see both of
 * them together and name the contribution they are in.
 *
 * It reports without dropping. What survives the read is unchanged; the merge and `resolve`
 * collapse the pair exactly as before, and the reason says so rather than the diagnostics
 * quietly changing which entry wins.
 */
function readSlotEntries(
  slot: ExtensionSlotId,
  entries: readonly unknown[],
  source: string,
  refused: RefusedExtensionEntry[],
): ExtensionElement[] {
  const kept: ExtensionElement[] = [];
  const ids = new Set<string>();

  entries.forEach((entry, index) => {
    const at = `entry ${index + 1}`;
    if (!isAddressableEntry(entry)) {
      refused.push({ slot, id: null, source, reason: `${at} ${whyUnaddressable(entry)}` });
      return;
    }
    if (ids.has(entry.id)) {
      refused.push({
        slot,
        id: entry.id,
        source,
        reason:
          `${at} repeats the id "${entry.id}" already used in this slot, ` +
          'so the two are merged into one and the later one wins',
      });
    }
    ids.add(entry.id);
    kept.push(entry);
  });

  return kept;
}

/**
 * The filter, as a predicate.
 *
 * One function, used both to decide what survives and — through {@link whyUnaddressable} — to
 * say what did not, so the two cannot drift apart into a report about entries the read actually
 * kept. Narrowing from `unknown` also means nothing here needs a cast.
 */
function isAddressableEntry(entry: unknown): entry is ExtensionElement {
  return isRecord(entry) && typeof entry['id'] === 'string' && entry['id'].trim() !== '';
}

/**
 * Why {@link isAddressableEntry} refused, in the words a customer needs to fix it.
 *
 * Only ever called on a value that predicate has already refused, so each branch is reachable
 * and the last one is the blank-`id` case by elimination.
 */
function whyUnaddressable(entry: unknown): string {
  if (!isRecord(entry)) return `must be an object, not ${describeShape(entry)}`;
  if (typeof entry['id'] !== 'string') return 'has no string "id", so nothing could address it';
  return 'has a blank "id", so nothing could address it';
}
