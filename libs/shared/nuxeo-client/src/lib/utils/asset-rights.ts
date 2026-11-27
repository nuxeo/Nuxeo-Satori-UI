import type { NuxeoDocument } from '../models/document.model';

/**
 * The document enricher `nuxeo-agentic-assets` adds, `org.nuxeo.agentic.assets.rights.AssetRightsJsonEnricher`:
 * what an asset's rights policy decides for each use of it, with a reason code to translate.
 *
 * Ask for it in `enrichers.document`. A server without the add-on ignores the name, as Nuxeo does
 * for any enricher it does not know, and the document then reads as explaining nothing.
 *
 * **It explains a refusal; it is not the control.** The server refuses a download its rights do not
 * cover, with 403, whatever this says or whether it was asked for. A client never hides or offers
 * an action from it: it asks it why, once the server has refused.
 */
export const ASSET_RIGHTS_ENRICHER = 'assetRights';

/**
 * Why the server serves or refuses a use: the enricher's codes. Since `nuxeo-agentic-assets` 0.5.0,
 * two more refuse: `watermark-required`, a use the rights allow and the policy's watermark marks for
 * this reader, which the download endpoints refuse unmarked and `Asset.GetWatermarked` serves
 * marked; and `watermark-unavailable`, one that must be marked and cannot be.
 */
export type AssetRightsReason =
  | 'cleared'
  | 'preview'
  | 'rights-ended'
  | 'channel-not-covered'
  | 'not-cleared'
  | 'policy-error'
  | 'watermark-required'
  | 'watermark-unavailable';

const REASONS: ReadonlySet<string> = new Set<AssetRightsReason>([
  'cleared',
  'preview',
  'rights-ended',
  'channel-not-covered',
  'not-cleared',
  'policy-error',
  'watermark-required',
  'watermark-unavailable',
]);

/** What a use of an asset is: its original, a picture view, a rendition or another blob. */
export type AssetUseKind = 'original' | 'view' | 'rendition' | 'blob';

/** One use, as the enricher names it: a view by its title, a rendition by its name, a blob by its xpath. */
export interface AssetUse {
  readonly kind: AssetUseKind;
  /** `null` for the original. */
  readonly name: string | null;
}

/** What the rights decide for one use. */
export interface AssetRightsDecision {
  readonly allowed: boolean;
  readonly reason: AssetRightsReason;
  /** The channel that covers the use, when the policy names one. */
  readonly channel: string | null;
  /** The last day the rights covered, `YYYY-MM-DD` in UTC, when the reason is that it has passed. */
  readonly rightsEnd: string | null;
}

/** The enricher's answer for one asset. */
export interface AssetRightsExplanation {
  /** The document type whose policy decided. */
  readonly type: string;
  /** The server's day, `YYYY-MM-DD` in UTC, that the rights were read on. */
  readonly today: string | null;
  /** The last day the rights cover, or `null` for none or when the rights could not be read. */
  readonly rightsEnd: string | null;
  /** The channels the asset's rights cover, or `null` when they could not be read. */
  readonly channels: readonly string[] | null;
  /** The decision for each use the enricher lists, in its order. */
  readonly uses: readonly (AssetUse & AssetRightsDecision)[];
  /** The decision for any use not among {@link uses}. */
  readonly otherwise: AssetRightsDecision;
}

const KINDS: ReadonlySet<string> = new Set<AssetUseKind>(['original', 'view', 'rendition', 'blob']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** A decision as the enricher writes one, or `null` for anything it would not write. */
function decision(value: unknown): AssetRightsDecision | null {
  if (!isObject(value)) return null;
  const { allowed, reason, channel, rightsEnd } = value;
  if (typeof allowed !== 'boolean' || typeof reason !== 'string' || !REASONS.has(reason))
    return null;
  // A reason that serves cannot come with `allowed: false`, nor one that refuses with `true`.
  if (allowed !== (reason === 'cleared' || reason === 'preview')) return null;
  return {
    allowed,
    reason: reason as AssetRightsReason,
    channel: text(channel),
    rightsEnd: text(rightsEnd),
  };
}

/**
 * The `assetRights` enricher's answer on `document`, or `null` when there is none: the document
 * was fetched without it, no rights policy covers its type, or the server has no such enricher.
 *
 * Read defensively, as anything from the server is: a use that is not as the enricher writes one
 * is left out, so it falls to `otherwise`, and an answer with no readable `otherwise` is none.
 */
export function assetRights(
  document: NuxeoDocument | null | undefined,
): AssetRightsExplanation | null {
  const value = document?.contextParameters?.[ASSET_RIGHTS_ENRICHER];
  if (!isObject(value)) return null;
  const type = text(value['type']);
  const otherwise = decision(value['otherwise']);
  if (type === null || otherwise === null) return null;
  const uses: (AssetUse & AssetRightsDecision)[] = [];
  if (Array.isArray(value['uses'])) {
    for (const entry of value['uses'] as unknown[]) {
      if (!isObject(entry)) continue;
      const kind = entry['use'];
      const decided = decision(entry);
      if (typeof kind !== 'string' || !KINDS.has(kind) || decided === null) continue;
      const name = text(entry['name']);
      if ((kind === 'original') !== (name === null)) continue;
      uses.push({ kind: kind as AssetUseKind, name, ...decided });
    }
  }
  const channels = Array.isArray(value['channels'])
    ? (value['channels'] as unknown[]).filter((each): each is string => typeof each === 'string')
    : null;
  return {
    type,
    today: text(value['today']),
    rightsEnd: text(value['rightsEnd']),
    channels,
    uses,
    otherwise,
  };
}

/** What the explanation says of `use`: its own decision, or `otherwise` when it does not list it. */
export function assetRightsDecision(
  rights: AssetRightsExplanation,
  use: AssetUse,
): AssetRightsDecision {
  const listed = rights.uses.find((each) => each.kind === use.kind && each.name === use.name);
  if (!listed) return rights.otherwise;
  const { allowed, reason, channel, rightsEnd } = listed;
  return { allowed, reason, channel, rightsEnd };
}
