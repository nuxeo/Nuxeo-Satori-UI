import {
  hasDocumentPermission,
  type AssetReviewAnswer,
  type NuxeoAnnotation,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

/**
 * One annotation as the review reads it: from the repository, by
 * `DocumentDetailService.getAnnotationDocuments`, or from the answer to one just written.
 */
export interface ReviewAnnotation {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  /**
   * When the repository wrote it, `dc:created`: the order the review reads in. For one just
   * written, the answer's `creationDate`, which the server fills when the request sends none, as
   * the review's never does, until the record's annotations are read again.
   */
  readonly written: string;
  readonly xpath: string | null;
  readonly origin: string | null;
  readonly entity: string | null;
}

/**
 * A picture's review, on Nuxeo's own annotations (layout-v2.md, section 2, "Review"): each pin is
 * an annotation on the record, and so is each round's close. No schema and no add-on: the record
 * needs only to be one that may be commented on, as every document is.
 *
 * - **On the views, not the original.** The review's annotations name `picture:views` as their
 *   file, so they are the same pins whichever view is shown, and they stay apart from the
 *   Annotations tab's viewer's, ARender's, which are on `file:content`.
 * - **A place survives a view of another size.** A pin is where it is as fractions of the view's
 *   width and height, from its top left: Nuxeo makes every view of a picture at its proportions.
 * - **In the order they were written.** The annotations are read oldest first, by `dc:created`,
 *   which the repository stamps when each is written and no field of the request can set. A pin is
 *   in the round open when it was written, whatever round its payload names: a page that had not
 *   yet seen a round closed writes the round before, and its pin goes into the next one all the
 *   same.
 * - **Rounds move one at a time.** Each close, a round sent back, closes the round open then, and
 *   opens the next. One that names a round already closed, as a second person closing the same
 *   round at once writes, changes nothing; one that names a later round still closes only the open
 *   one. So a close deleted from the record's comments renumbers the rounds after it, and merges
 *   none. Past {@link MAX_ROUNDS}, a close changes nothing.
 * - **A decision concludes the review.** The first approval or rejection written is the review's
 *   conclusion, in the round open then; a close or a decision written after it changes nothing,
 *   as `nuxeo-agentic-assets` 0.5.0 refuses one, 409 `concluded`. Since that version the server
 *   holds every close and decision to the add-on's `ReviewAsset` permission and the review
 *   policy's groups, and keeps each as written.
 * - **What it reads is anyone's.** Whoever may comment on the record may write an annotation of
 *   this origin, with any payload, so each one is held to its form here, and one that is not a pin
 *   or a close is left out and counted. Nuxeo 2025 makes the signed-in user its author whatever the
 *   request says, and keeps a `creationDate` the request sends, which is why the order is not read
 *   from it. A holder of `Write` on the record, which its annotations inherit, can still change an
 *   annotation's `dc:created` or its author afterwards, as they can change the record.
 */

/** The file a review's annotations are on: the picture's views, whichever one is shown. */
export const REVIEW_XPATH = 'picture:views';

/** What the review writes as each annotation's origin, and what it reads back. */
export const REVIEW_ORIGIN = 'nuxeo-satori.review';

/** The version of the payload the review writes, and the only one it reads. */
const PAYLOAD_VERSION = 1;

/** The most rounds a review counts, and the highest a payload may name. */
export const MAX_ROUNDS = 999;

/** The longest note the form takes. A convenience: the server stores longer ones, and they show. */
export const MAX_NOTE_LENGTH = 2000;

/** A pin on the picture, with its note. */
export interface ReviewPin {
  readonly id: string;
  /** Its number on the picture: the order the pins were placed in, across rounds, 1 first. */
  readonly number: number;
  /** The round open when it was written. */
  readonly round: number;
  /** Where it is, as fractions of the view's width and height from its top left: 0 to 1. */
  readonly x: number;
  readonly y: number;
  readonly note: string;
  readonly author: string;
  readonly created: string;
}

/** How a review is concluded: the payload's word, as the server reads and audits it. */
export type ReviewDecision = 'approved' | 'rejected';

/** The review's conclusion: its first approval or rejection, who wrote it, when, and in which round. */
export interface ReviewConclusion {
  readonly decision: ReviewDecision;
  readonly by: string;
  readonly at: string;
  readonly round: number;
}

/** A round of the review: the open one, or one closed, with who closed it and when. */
export interface ReviewRound {
  readonly number: number;
  readonly closedBy: string | null;
  readonly closedAt: string | null;
}

export interface PictureReview {
  /** Every pin, in the order they were placed. */
  readonly pins: readonly ReviewPin[];
  /** The round open now: one after the last closed, 1 when none has been. */
  readonly round: number;
  /** Every round, the open one last. */
  readonly rounds: readonly ReviewRound[];
  /** The first approval or rejection, which ends the review; `null` while there is none. */
  readonly conclusion: ReviewConclusion | null;
  /** Annotations of the review's origin that are neither a pin, a round's close nor a decision: left out. */
  readonly unreadable: number;
}

type Payload =
  | { readonly kind: 'pin'; readonly round: number; readonly x: number; readonly y: number }
  | { readonly kind: 'round-closed'; readonly round: number }
  | { readonly kind: 'decision'; readonly round: number; readonly decision: ReviewDecision };

const isDecision = (value: unknown): value is ReviewDecision =>
  value === 'approved' || value === 'rejected';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRound = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ROUNDS;

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** An `Annotation` document, as `getAnnotationDocuments` answers it. */
export function fromAnnotationDocument(document: NuxeoDocument): ReviewAnnotation {
  const properties = document.properties ?? {};
  return {
    id: document.uid,
    author: textOf(properties['comment:author']),
    text: textOf(properties['comment:text']),
    written: textOf(properties['dc:created']),
    xpath: textOrNull(properties['annotation:xpath']),
    origin: textOrNull(properties['externalEntity:origin']),
    entity: textOrNull(properties['externalEntity:entity']),
  };
}

/** The answer to an annotation just written, until the record's annotations are read again. */
export function fromCreatedAnnotation(annotation: NuxeoAnnotation): ReviewAnnotation {
  return {
    id: annotation.id,
    author: textOf(annotation.author),
    text: textOf(annotation.text),
    written: textOf(annotation.creationDate),
    xpath: textOrNull(annotation.xpath),
    origin: textOrNull(annotation.origin),
    entity: textOrNull(annotation.entity),
  };
}

/** An annotation's payload, held to the review's form; `null` for anything else. */
function payloadOf(annotation: ReviewAnnotation): Payload | null {
  if (typeof annotation.entity !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(annotation.entity);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['version'] !== PAYLOAD_VERSION || !isRound(parsed['round']))
    return null;
  if (parsed['kind'] === 'pin' && isFraction(parsed['x']) && isFraction(parsed['y']))
    return { kind: 'pin', round: parsed['round'], x: parsed['x'], y: parsed['y'] };
  if (parsed['kind'] === 'round-closed') return { kind: 'round-closed', round: parsed['round'] };
  if (parsed['kind'] === 'decision' && isDecision(parsed['decision']))
    return { kind: 'decision', round: parsed['round'], decision: parsed['decision'] };
  return null;
}

/** When it was written, as a number to sort by; one with no date sorts first. */
function writtenAt(annotation: ReviewAnnotation): number {
  const time = Date.parse(annotation.written);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * The review the record's annotations on {@link REVIEW_XPATH} hold. Annotations of another origin,
 * someone else's on the same file, are not the review's, and are passed over without a count.
 */
export function readPictureReview(annotations: readonly ReviewAnnotation[]): PictureReview {
  const ours = annotations
    .filter(
      (annotation) => annotation.origin === REVIEW_ORIGIN && annotation.xpath === REVIEW_XPATH,
    )
    .map((annotation) => ({ annotation, payload: payloadOf(annotation) }))
    .sort(
      (a, b) =>
        writtenAt(a.annotation) - writtenAt(b.annotation) ||
        a.annotation.id.localeCompare(b.annotation.id),
    );

  const rounds: ReviewRound[] = [];
  const pins: ReviewPin[] = [];
  let round = 1;
  let conclusion: ReviewConclusion | null = null;
  for (const { annotation, payload } of ours) {
    if (payload?.kind === 'decision') {
      // The first concludes the review; any after it changes nothing.
      conclusion ??= {
        decision: payload.decision,
        by: annotation.author,
        at: annotation.written,
        round,
      };
    } else if (payload?.kind === 'round-closed') {
      if (conclusion !== null || payload.round < round || round >= MAX_ROUNDS) continue;
      rounds.push({ number: round, closedBy: annotation.author, closedAt: annotation.written });
      round++;
    } else if (payload?.kind === 'pin') {
      pins.push({
        id: annotation.id,
        number: pins.length + 1,
        round,
        x: payload.x,
        y: payload.y,
        note: annotation.text,
        author: annotation.author,
        created: annotation.written,
      });
    }
  }
  rounds.push({ number: round, closedBy: null, closedAt: null });
  const unreadable = ours.filter(({ payload }) => payload === null).length;
  return { pins, round, rounds, conclusion, unreadable };
}

/** A fraction rounded to four places, as a pin is written: a tenth of a pixel on a 1000px view. */
export function toFraction(value: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return Math.round(clamped * 10_000) / 10_000;
}

/** A pin's payload, as `createAnnotation` writes it in `entity`. */
export function pinPayload(round: number, x: number, y: number): string {
  return JSON.stringify({
    kind: 'pin',
    version: PAYLOAD_VERSION,
    round,
    x: toFraction(x),
    y: toFraction(y),
  });
}

/** A round's close, the round sent back, as `createAnnotation` writes it in `entity`. */
export function roundClosedPayload(round: number): string {
  return JSON.stringify({ kind: 'round-closed', version: PAYLOAD_VERSION, round });
}

/** The review approved or rejected, as `createAnnotation` writes it in `entity`. */
export function decisionPayload(round: number, decision: ReviewDecision): string {
  return JSON.stringify({ kind: 'decision', version: PAYLOAD_VERSION, round, decision });
}

/** A fraction as the whole percentage the page says it in: `0.4213` is 42. */
export function percent(fraction: number): number {
  return Math.round(fraction * 100);
}

/**
 * What the page offers the signed-in user. Hiding a control is not a security control.
 *
 * - **A pin** to a holder of Nuxeo's `Comment` permission, or of `Write`, on the record, from its
 *   `permissions` enricher. Nuxeo 2025's comment service accepts a pin from anyone who may read the
 *   record, through the REST API, whatever this page offers.
 * - **A decision,** sending the round back, approving or rejecting the review, only when the
 *   server's `assetReview` enricher says the reader may decide: `nuxeo-agentic-assets` 0.5.0, which
 *   holds each decision to its `ReviewAsset` permission and the review policy's groups, and refuses
 *   anyone else, administrators included. With no answer, from a server without it, none is offered.
 *   Whether the review is concluded is the component's to add: see `readPictureReview`.
 * - **Nothing** on a version or a record in the trash, or when the page is read-only, as the layout
 *   designer's preview is.
 */
export function reviewOffers(
  document: NuxeoDocument,
  readOnly: boolean,
  review: AssetReviewAnswer | null,
): { readonly pin: boolean; readonly decide: boolean } {
  if (readOnly || document.isVersion === true || document.isTrashed === true)
    return { pin: false, decide: false };
  const may = (permission: string): boolean => hasDocumentPermission(document, permission);
  const write = may('Write') || may('Everything');
  return { pin: write || may('Comment'), decide: review?.mayDecide === true };
}
