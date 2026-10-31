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

/**
 * A per-id `overrides` entry the read refused, and why.
 *
 * ## Why this is not a {@link RefusedExtensionEntry}
 *
 * The two refusals are the same kind of news and travel the same two channels, so reusing the
 * type was the first thing tried. It does not fit, in both directions:
 *
 * - `RefusedExtensionEntry.slot` is **required**, and an override has no slot — `overrides` is
 *   keyed by descriptor id precisely so that a slot invented after Beta ships needs no schema
 *   change (`ExtensionOverride`). Widening it to `ExtensionSlotId | null` would put a field on
 *   every slot refusal that is sometimes a lie, and make the template's "Manifest slot {{slot}}"
 *   render `null`;
 * - `id` is the mirror image. It is nullable there, because an entry refused for having no
 *   usable `id` has none to report. Here it is the **object key**, so it is always known and
 *   always the thing to point at.
 *
 * A type whose only two shared fields disagree on nullability is two types. Reporting this on a
 * signal of its own also keeps `refusedSlotEntries()` exactly as published — §2a of
 * `docs/extension-reference.md` is a customer contract — which makes the whole change additive
 * (NXSAT-759).
 */
export interface RefusedExtensionOverride {
  /** The descriptor id it was filed under, which is how an override is addressed at all. */
  readonly id: string;
  /** Human-readable cause, quoting what was found and what became of the override. */
  readonly reason: string;
  /** Which contribution wrote it, named as {@link RefusedExtensionEntry.source} explains. */
  readonly source: string;
}

/**
 * The configuration keys of a layer a {@link RefusedExtensionSection} can name.
 *
 * Closed, and deliberately only these two. The `$`-prefixed keys have silences of their own — a
 * `$references` that is not a list reads as `[]`, a `$layers` body that is not an object is
 * skipped — but those are about layer *resolution*, which `ResolvedExtensionConfig.missing`
 * already reports on. Widening this union before anything fills the new member would ship a
 * value no read can produce; §2a of `docs/extension-reference.md` states them as still silent
 * instead of claiming coverage that is not here.
 */
export type ExtensionSectionKey = 'slots' | 'overrides';

/**
 * A whole `slots` or `overrides` map the read refused, and why.
 *
 * ## Why this is neither of the two types above
 *
 * A map of the wrong shape loses **every** entry in that contribution, and the refusal has
 * nothing smaller than the key to point at. That is what rules out both existing types, in the
 * one way each of them cannot bend:
 *
 * - `RefusedExtensionEntry.slot` is required and `ExtensionSlotId`-typed. An `overrides` map has
 *   no slot in any sense, and a refused `slots` map is not *about* a slot either — it is about
 *   the key. Widening it to `ExtensionSlotId | null` would also narrow the field for every
 *   existing reader of a **published** signal (§2a is a customer contract) to carry rows that
 *   are not slot entries, and the template's `Manifest slot {{ entry.slot }}` would render
 *   `Manifest slot null`;
 * - `RefusedExtensionOverride.id` is non-null by design — that is the whole argument for it
 *   existing separately — and a whole-map refusal has no id to give it. Making it nullable would
 *   also reach only half the problem, leaving `slots` unreported and the two keys inconsistent,
 *   which is the trade NXSAT-759 declined to make.
 *
 * One list over both keys rather than one per key: it is a single fact — this contribution's
 * `<key>` was not an object, so all of it is gone — distinguished by a field, not two facts. Two
 * signals would double the console channels, the `lastNoted` keys and the §2a tables for no
 * extra information, and leave the consistency between the keys as a convention rather than a
 * property of the shape (NXSAT-761).
 */
export interface RefusedExtensionSection {
  /** Which key of the layer went. Always the literal key that was read, never a placeholder. */
  readonly key: ExtensionSectionKey;
  /** Human-readable cause, quoting the key, the shape found and what became of the map. */
  readonly reason: string;
  /** Which contribution wrote it, named as {@link RefusedExtensionEntry.source} explains. */
  readonly source: string;
}

/** {@link resolveExtensionLayers}'s result: a {@link ResolvedExtensionConfig} that also reports. */
export interface ResolvedExtensionLayers extends ResolvedExtensionConfig {
  /** Slot entries refused while reading the layers — see {@link RefusedExtensionEntry}. */
  readonly refused: readonly RefusedExtensionEntry[];
  /** Per-id overrides refused while reading them — see {@link RefusedExtensionOverride}. */
  readonly refusedOverrides: readonly RefusedExtensionOverride[];
  /** Whole `slots` or `overrides` maps refused — see {@link RefusedExtensionSection}. */
  readonly refusedSections: readonly RefusedExtensionSection[];
}

/**
 * The three refusal lists a read fills, carried together so the walk takes one parameter.
 *
 * Module-local on purpose: it is how the read accumulates, not something a caller holds.
 * {@link ResolvedExtensionLayers} is the published shape, and the two differ — `entries` is
 * `refused` there, named for what a consumer reads rather than for what fills it.
 */
interface ExtensionRefusals {
  readonly entries: RefusedExtensionEntry[];
  readonly overrides: RefusedExtensionOverride[];
  readonly sections: RefusedExtensionSection[];
}

/** A fresh set of empty lists, so the two call sites cannot disagree on the shape. */
function noRefusals(): ExtensionRefusals {
  return { entries: [], overrides: [], sections: [] };
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
  const refusals = noRefusals();
  const resolved = layers.map((layer, index) =>
    resolveExtensionConfig(readConfig(layer, layerSource(layer, index), refusals)),
  );
  return {
    config: mergeExtensionConfigs(...resolved.map((entry) => entry.config)),
    applied: resolved.flatMap((entry) => entry.applied),
    missing: resolved.flatMap((entry) => entry.missing),
    refused: refusals.entries,
    refusedOverrides: refusals.overrides,
    refusedSections: refusals.sections,
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
 * Tolerant, but no longer silent. Every drop is recorded — as a {@link RefusedExtensionEntry},
 * a {@link RefusedExtensionOverride} or a {@link RefusedExtensionSection} — and reaches the
 * customer through `AppExtensionsService.refusedSlotEntries()`, `refusedOverrides()`,
 * `refusedSections()` and the console. This function discards those records, keeping the
 * signature callers that only want the configuration already have; {@link resolveExtensionLayers}
 * is the one that keeps them, because it alone knows a layer's position in contribution order
 * and so can say where a refused entry was written.
 */
export function readExtensionConfig(raw: unknown): ExtensionConfig {
  return readConfig(raw, layerSource(raw, 0), noRefusals());
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
  return declaredName(raw) ?? `contribution ${index + 1}`;
}

/** Same, for a named `$layers` body, which is findable by the name it is filed under. */
function sublayerSource(parent: string, name: string, raw: unknown): string {
  return declaredName(raw) ?? `$layers.${name} of ${parent}`;
}

/**
 * The layer's declared `$name`, trimmed, or `null` when it declares none.
 *
 * Returned as `null` rather than as the fallback label so each caller supplies its own, which
 * is what keeps the two apart. Deriving the fallback here and having `sublayerSource` detect it
 * by `startsWith('contribution ')` read a customer's `$name: "contribution 5"` as one of our
 * generated labels and replaced it (review of PR 534) — a discriminator that works by sniffing
 * a string it does not own.
 */
function declaredName(raw: unknown): string | null {
  const declared = isRecord(raw) ? raw['$name'] : undefined;
  const name = typeof declared === 'string' ? declared.trim() : '';
  return name === '' ? null : name;
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
function readConfig(raw: unknown, source: string, refusals: ExtensionRefusals): ExtensionConfig {
  if (!isRecord(raw)) return {};

  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('$')) config[key] = value;
  }
  // Resolution iterates these, so a fragment that gets their shape wrong loses them rather than
  // throwing for every package. Assigned after the loop above, which copies them verbatim.
  for (const key of ['$references', '$ignoreReferenceList']) {
    if (raw[key] !== undefined) config[key] = readLayerNames(raw[key]);
  }
  if (raw['$layers'] !== undefined) {
    config['$layers'] = readNamedLayers(raw['$layers'], source, refusals);
  }

  // Each subtree is handed the one list it fills, not the whole set: only `readConfig` and the
  // walk into `$layers` need all three, and a leaf that cannot reach another list cannot file
  // into it. `readSection` gets `sections` because the refusal it records is its own; the reader
  // it calls closes over the list that reader fills.
  Object.assign(
    config,
    readSection(raw, 'slots', source, refusals.sections, (slots) =>
      readSlots(slots, source, refusals.entries),
    ),
    readSection(raw, 'overrides', source, refusals.sections, (overrides) =>
      readOverrides(overrides, source, refusals.overrides),
    ),
  );

  return config as ExtensionConfig;
}

/**
 * One configuration key: read when it is an object, reported when it is present and is not.
 *
 * Returns a **patch** — `{ [key]: … }` or `{}` — rather than assigning, which is what lets
 * {@link readConfig} spread both keys in one `Object.assign` and keep no branch of its own for
 * either. That matters beyond tidiness: reporting these two refusals as a pair of `if`s in
 * `readConfig` would have taken its cognitive complexity from 10 to 12 against SonarCloud's
 * limit of 15, on the reader the per-subtree functions were extracted from when it stood at 28
 * (PR 534). Routing both through here **replaced** those two `if`s rather than adding to them,
 * so it went down instead, to 8 — measured with `eslint-plugin-sonarjs` locally rather than read
 * off a SonarCloud PR summary, which attributes an issue to changed lines and so never shows one
 * whose primary location you did not touch (NXSAT-761).
 *
 * An **absent** key is not a refusal, and neither is an empty map. `{}` is a record and reads as
 * a contribution that overrides nothing, which is a thing a generated manifest legitimately
 * writes; refusing it would fire on a correct file. `null` is a refusal, because a customer who
 * wrote `"slots": null` did write the key and did lose every slot under it.
 */
function readSection<T>(
  raw: Record<string, unknown>,
  key: ExtensionSectionKey,
  source: string,
  refused: RefusedExtensionSection[],
  read: (section: Record<string, unknown>) => T,
): Record<string, T> {
  const section = raw[key];
  if (isRecord(section)) return { [key]: read(section) };
  if (section !== undefined) refused.push({ key, source, reason: whySectionRefused(key, section) });
  return {};
}

/**
 * What each configuration key is keyed by and what it holds, so one message serves both.
 *
 * The nouns are the ones §2 of `docs/extension-reference.md` uses, because the message's job is
 * to send a reader to the right table in it.
 */
const EXTENSION_SECTIONS: Readonly<
  Record<ExtensionSectionKey, { readonly keyedBy: string; readonly holds: string }>
> = {
  slots: { keyedBy: 'slot id', holds: 'slot' },
  overrides: { keyedBy: 'descriptor id', holds: 'override' },
};

/**
 * Why a whole map was refused, in the words a customer needs to fix it.
 *
 * It names what the key should have been keyed by, not only that it should have been an object,
 * because the mistake this exists for is writing `overrides` as a **list** — plausible precisely
 * because a `slots` entry is a list — and "must be an object" alone does not say what the keys
 * of that object are.
 *
 * It quotes the key even though the console line is already addressed by it, so one repetition
 * reaches the console. The alternative is a `reason` that cannot be read on its own, and a
 * reason pasted into a support ticket without its row is the form these messages actually
 * arrive in.
 */
function whySectionRefused(key: ExtensionSectionKey, section: unknown): string {
  const { keyedBy, holds } = EXTENSION_SECTIONS[key];
  return (
    `"${key}" must be an object keyed by ${keyedBy}, not ${describeShape(section)}, ` +
    `so every ${holds} in this contribution is dropped`
  );
}

/** The layer names a `$references`-shaped value lists, or none when it is the wrong shape. */
function readLayerNames(names: unknown): string[] {
  return Array.isArray(names)
    ? names.filter((name): name is string => typeof name === 'string')
    : [];
}

/** A layer's `$layers` map, each body read on its own so a refusal names the layer it is in. */
function readNamedLayers(
  layers: unknown,
  source: string,
  refusals: ExtensionRefusals,
): Record<string, ExtensionConfig> {
  if (!isRecord(layers)) return {};
  return Object.fromEntries(
    Object.entries(layers)
      .filter(([, layer]) => isRecord(layer))
      .map(([name, layer]) => [
        name,
        readConfig(layer, sublayerSource(source, name, layer), refusals),
      ]),
  );
}

/**
 * Per-id overrides, with a refusal recorded for each one dropped.
 *
 * The filter is the one that was here before and both halves of it are load-bearing. A
 * non-object cannot be an `ExtensionOverride`: `ExtensionSlotRegistry.applyOverride` reads
 * `override.order`, `.label`, `.rule` and `.visible` off it, and `visible !== false` on a
 * boolean `true` would silently mean "keep", so `{ "app.navbar.trash": true }` would read as a
 * no-op override rather than as the mistake it is. `__proto__` is refused because assigning it
 * would replace the prototype of the object being built — the thing `mergeObjects` refuses too.
 * Neither is removed; they are made to speak (NXSAT-759).
 *
 * ## What is still silent here, and why that is a decision rather than a gap
 *
 * Two adjacent cases keep an override that has no effect, and neither is a *refusal*:
 *
 * - an unknown key inside an override (`{ "visibl": false }`);
 * - an override for an id nothing ever registers (`"app.navbr.trash"`).
 *
 * Both are deliberately **not** reported, on the §1 tolerance rule: overrides are read by an
 * `APP_INITIALIZER` before any descriptor registers, and a customer may legitimately override an
 * id a library registers later or a key a newer release adds, so a warning would fire on
 * manifests that are correct for the build they were written against. §2a of
 * `docs/extension-reference.md` states both to the customer rather than leaving them to be
 * discovered.
 *
 * A third case used to sit here: an `overrides` map that is not an object at all, which loses
 * every override in the layer. That one *was* a gap, and it is now reported as a
 * {@link RefusedExtensionSection} — the refusal has no id to give this type, which is why it
 * needed a shape of its own (NXSAT-761). It is refused one level up, in {@link readSection},
 * because by the time control reaches here the map is known to be a record.
 */
function readOverrides(
  overrides: Record<string, unknown>,
  source: string,
  refused: RefusedExtensionOverride[],
): Record<string, ExtensionOverride> {
  const read: Record<string, ExtensionOverride> = {};

  for (const [id, override] of Object.entries(overrides)) {
    // Checked before the shape, so a `"__proto__": true` is reported as the key problem it is
    // rather than as a malformed value that happens to be unusable anyway. Same order as
    // {@link readSlots}, where a `__proto__` slot that is also not a list reads the same way.
    if (id === '__proto__') {
      refused.push({
        id,
        source,
        reason: 'an override may not be keyed "__proto__", so it is dropped',
      });
      continue;
    }
    if (!isRecord(override)) {
      refused.push({
        id,
        source,
        reason: `an override must be an object, not ${describeShape(override)}, so it is dropped`,
      });
      continue;
    }
    read[id] = override as ExtensionOverride;
  }

  return read;
}

/**
 * Every slot a layer contributes, with a refusal recorded for each one it loses whole.
 *
 * Its own function rather than a block inside {@link readConfig}: reporting added two branches to
 * a reader that already walked five subtrees, taking its cognitive complexity to 28 against a
 * limit of 15 (SonarCloud, PR 534). The slots subtree is also the only one of the five with a
 * nested loop, so it is the one worth naming.
 */
function readSlots(
  slots: Record<string, unknown>,
  source: string,
  refused: RefusedExtensionEntry[],
): Record<string, ExtensionElement[]> {
  const read: Record<string, ExtensionElement[]> = {};

  for (const [slot, entries] of Object.entries(slots)) {
    // Assigning it would replace the object's prototype, the thing `mergeObjects` refuses too.
    if (slot === '__proto__') {
      refused.push({
        slot,
        id: null,
        source,
        reason: 'a slot may not be named "__proto__", so the whole slot is dropped',
      });
      continue;
    }
    if (!Array.isArray(entries)) {
      refused.push({
        slot,
        id: null,
        source,
        reason:
          `a slot must be a list of entries, not ${describeShape(entries)}, ` +
          'so the whole slot is dropped',
      });
      continue;
    }
    read[slot] = readSlotEntries(slot, entries, source, refused);
  }

  return read;
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
        // It predicts nothing about which entry's fields survive, because that is not a property
        // of the duplicate: it falls out of where the layers sit, which of them set the same slot
        // and in what order, and whether the id is a packaged one.
        //
        // Four review rounds on PR 534 each falsified a different attempt to state that as a
        // rule — "the later one wins"; "except `action`, which stays as the first entry set it";
        // an explanation keyed on the number of contributions; and one keyed on whether any merge
        // of the slot's array ran, which reversing the layer order refutes. Every one was a proxy
        // for the thing it was naming. The conclusion is not a fifth attempt: it is that the
        // outcome is **unspecified**, pinned by six cases in `app-extensions.service.spec.ts` so a
        // change to it is visible, and stated nowhere as a rule a manifest could rely on.
        //
        // So this says only what is certain, and what to do about it.
        reason:
          `${at} repeats the id "${entry.id}" already used in this slot, so the two are merged ` +
          'into one and which fields survive depends on the other layers — give each entry its ' +
          'own id',
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
