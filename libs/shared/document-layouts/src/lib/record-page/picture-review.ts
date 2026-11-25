import {
  hasDocumentPermission,
  type NuxeoAnnotation,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

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
 * - **Rounds move one at a time.** A round's close names the round it closes, and only the round
 *   open then closes: a second close of the same round, or of one not open, changes nothing. A
 *   pin is in the round it says, or in the open one if it names a later one.
 * - **What it reads is anyone's.** Whoever may comment on the record may write an annotation of
 *   this origin, with any payload, so each one is held to its form here, and one that is not a pin
 *   or a close is left out and counted.
 */

/** The file a review's annotations are on: the picture's views, whichever one is shown. */
export const REVIEW_XPATH = 'picture:views';

/** What the review writes as each annotation's origin, and what it reads back. */
export const REVIEW_ORIGIN = 'nuxeo-satori.review';

/** The version of the payload the review writes, and the only one it reads. */
const PAYLOAD_VERSION = 1;

/** The most rounds a review reads: a bound on what a payload may claim. */
export const MAX_ROUNDS = 999;

/** The longest note the form takes. A convenience: the server stores longer ones, and they show. */
export const MAX_NOTE_LENGTH = 2000;

/** A pin on the picture, with its note. */
export interface ReviewPin {
  readonly id: string;
  /** Its number on the picture: the order the pins were placed in, across rounds, 1 first. */
  readonly number: number;
  readonly round: number;
  /** Where it is, as fractions of the view's width and height from its top left: 0 to 1. */
  readonly x: number;
  readonly y: number;
  readonly note: string;
  readonly author: string;
  readonly created: string;
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
  /** Annotations of the review's origin that are neither a pin nor a round's close: left out. */
  readonly unreadable: number;
}

type Payload =
  | { readonly kind: 'pin'; readonly round: number; readonly x: number; readonly y: number }
  | { readonly kind: 'round-closed'; readonly round: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRound = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ROUNDS;

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** An annotation's payload, held to the review's form; `null` for anything else. */
function payloadOf(annotation: NuxeoAnnotation): Payload | null {
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
  return null;
}

/** When it was written, as a number to sort by; one with no date the server gave sorts first. */
function writtenAt(annotation: NuxeoAnnotation): number {
  const time = Date.parse(annotation.creationDate);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * The review the record's annotations on {@link REVIEW_XPATH} hold. Annotations of another origin,
 * someone else's on the same file, are not the review's, and are passed over without a count.
 */
export function readPictureReview(annotations: readonly NuxeoAnnotation[]): PictureReview {
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
  let round = 1;
  for (const { annotation, payload } of ours) {
    if (payload?.kind !== 'round-closed' || payload.round !== round) continue;
    rounds.push({ number: round, closedBy: annotation.author, closedAt: annotation.creationDate });
    round++;
  }
  rounds.push({ number: round, closedBy: null, closedAt: null });

  const pins: ReviewPin[] = [];
  for (const { annotation, payload } of ours) {
    if (payload?.kind !== 'pin') continue;
    pins.push({
      id: annotation.id,
      number: pins.length + 1,
      round: Math.min(payload.round, round),
      x: payload.x,
      y: payload.y,
      note: typeof annotation.text === 'string' ? annotation.text : '',
      author: annotation.author,
      created: annotation.creationDate,
    });
  }
  const unreadable = ours.filter(({ payload }) => payload === null).length;
  return { pins, round, rounds, unreadable };
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

/** A round's close, as `createAnnotation` writes it in `entity`. */
export function roundClosedPayload(round: number): string {
  return JSON.stringify({ kind: 'round-closed', version: PAYLOAD_VERSION, round });
}

/** A fraction as the whole percentage the page says it in: `0.4213` is 42. */
export function percent(fraction: number): number {
  return Math.round(fraction * 100);
}

/**
 * What the page offers the signed-in user, from the record's `permissions` enricher. Hiding a
 * control is not a security control: Nuxeo 2025's comment service accepts an annotation from
 * anyone who may read the record, through the REST API, whatever this page offers.
 *
 * - **A pin** to a holder of Nuxeo's `Comment` permission, or of `Write`, on the record.
 * - **Closing a round** to a holder of `Write`: whoever may change the asset decides a round is over.
 * - **Nothing** on a version or a record in the trash, when the page is read-only, as the layout
 *   designer's preview is, or when the record came without its permissions.
 */
export function reviewOffers(
  document: NuxeoDocument,
  readOnly: boolean,
): { readonly pin: boolean; readonly close: boolean } {
  if (readOnly || document.isVersion === true || document.isTrashed === true)
    return { pin: false, close: false };
  const may = (permission: string): boolean => hasDocumentPermission(document, permission);
  const write = may('Write') || may('Everything');
  return { pin: write || may('Comment'), close: write };
}
