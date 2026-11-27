import type { NuxeoDocument } from '../models/document.model';

/**
 * The document enricher `nuxeo-agentic-assets` 0.5.0 adds, `org.nuxeo.agentic.assets.review.AssetReviewJsonEnricher`:
 * whether the reader may decide the document's review, send a round back, approve or reject it.
 *
 * Ask for it in `enrichers.document`. A server without the add-on ignores the name, as Nuxeo does
 * for any enricher it does not know, and the document then reads as offering no decision.
 *
 * **It decides what the page offers; it is not the control.** The server's review listener refuses
 * a decision from anyone its review policy and the add-on's `ReviewAsset` permission do not let
 * decide, with 403, whatever this says or whether it was asked for.
 */
export const ASSET_REVIEW_ENRICHER = 'assetReview';

/** Why the reader may not decide the review: the enricher's codes. */
export type AssetReviewRefusal = 'not-reviewable' | 'not-a-reviewer' | 'not-live';

const REFUSALS: ReadonlySet<string> = new Set<AssetReviewRefusal>([
  'not-reviewable',
  'not-a-reviewer',
  'not-live',
]);

/** The enricher's answer for one document. */
export interface AssetReviewAnswer {
  /** The document type whose review policy decided. */
  readonly type: string;
  /** Whether the reader may send a round back, approve or reject the review. */
  readonly mayDecide: boolean;
  /** Why not, when they may not; `null` when they may. */
  readonly reason: AssetReviewRefusal | null;
  /** The permission the server holds a decision to: `ReviewAsset`. */
  readonly permission: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The `assetReview` enricher's answer on `document`, or `null` when there is none: the document
 * was fetched without it, no review policy covers its type, the server has no such enricher, or
 * the answer is not as the enricher writes one. Read defensively, as anything from the server is:
 * `mayDecide` is true only with no reason, and a reason is one of the enricher's codes.
 */
export function assetReview(document: NuxeoDocument | null | undefined): AssetReviewAnswer | null {
  const value = document?.contextParameters?.[ASSET_REVIEW_ENRICHER];
  if (!isObject(value)) return null;
  const { type, mayDecide, reason, permission } = value;
  if (typeof type !== 'string' || type === '') return null;
  if (typeof permission !== 'string' || permission === '') return null;
  if (mayDecide === true && reason === null) {
    return { type, mayDecide: true, reason: null, permission };
  }
  if (mayDecide === false && typeof reason === 'string' && REFUSALS.has(reason)) {
    return { type, mayDecide: false, reason: reason as AssetReviewRefusal, permission };
  }
  return null;
}
