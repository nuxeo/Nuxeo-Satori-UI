import type { NuxeoAnnotation, NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import {
  REVIEW_ORIGIN,
  REVIEW_XPATH,
  percent,
  pinPayload,
  readPictureReview,
  reviewOffers,
  roundClosedPayload,
  toFraction,
} from './picture-review';

let seconds = 0;

/** An annotation as Nuxeo 2025's `@annotation` answers one, each a second after the one before. */
function annotation(entity: unknown, overrides: Partial<NuxeoAnnotation> = {}): NuxeoAnnotation {
  seconds++;
  return {
    id: `a${seconds}`,
    parentId: 'p1',
    author: 'reviewer1',
    text: `Note ${seconds}`,
    creationDate: `2026-11-25T10:00:${String(seconds).padStart(2, '0')}.000Z`,
    xpath: REVIEW_XPATH,
    entityId: null,
    origin: REVIEW_ORIGIN,
    entity: typeof entity === 'string' ? entity : JSON.stringify(entity),
    ...overrides,
  };
}

const pin = (round: number, x: number, y: number, overrides: Partial<NuxeoAnnotation> = {}) =>
  annotation(pinPayload(round, x, y), overrides);
const closed = (round: number, overrides: Partial<NuxeoAnnotation> = {}) =>
  annotation(roundClosedPayload(round), overrides);

beforeEach(() => {
  seconds = 0;
});

describe('readPictureReview', () => {
  it('reads each pin with its number, round, place and note, in the order they were placed', () => {
    const first = pin(1, 0.25, 0.4);
    const second = pin(1, 0.7, 0.1);
    // Nuxeo promises no order: the second answered first.
    const review = readPictureReview([second, first]);
    expect(review.pins).toEqual([
      {
        id: first.id,
        number: 1,
        round: 1,
        x: 0.25,
        y: 0.4,
        note: 'Note 1',
        author: 'reviewer1',
        created: first.creationDate,
      },
      {
        id: second.id,
        number: 2,
        round: 1,
        x: 0.7,
        y: 0.1,
        note: 'Note 2',
        author: 'reviewer1',
        created: second.creationDate,
      },
    ]);
    expect(review.round).toBe(1);
    expect(review.rounds).toEqual([{ number: 1, closedBy: null, closedAt: null }]);
    expect(review.unreadable).toBe(0);
  });

  it('opens the next round once the open one is closed, and says who closed it and when', () => {
    const close = closed(1, { author: 'lead1' });
    const review = readPictureReview([pin(1, 0.1, 0.1), close, pin(2, 0.5, 0.5)]);
    expect(review.round).toBe(2);
    expect(review.rounds).toEqual([
      { number: 1, closedBy: 'lead1', closedAt: close.creationDate },
      { number: 2, closedBy: null, closedAt: null },
    ]);
    expect(review.pins.map((each) => [each.number, each.round])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('moves one round at a time: a second close of a round, or a close of one not open, changes nothing', () => {
    const review = readPictureReview([closed(1), closed(1), closed(5), closed(2)]);
    expect(review.round).toBe(3);
    expect(review.rounds.map((round) => round.number)).toEqual([1, 2, 3]);
  });

  it('puts a pin that names a round not open yet into the open one', () => {
    expect(readPictureReview([pin(4, 0.5, 0.5)]).pins[0].round).toBe(1);
  });

  it("passes over another origin's annotations and another file's, without counting them", () => {
    const review = readPictureReview([
      pin(1, 0.5, 0.5, { origin: 'ARender' }),
      pin(1, 0.5, 0.5, { xpath: 'file:content' }),
      pin(1, 0.5, 0.5, { origin: null }),
    ]);
    expect(review.pins).toEqual([]);
    expect(review.unreadable).toBe(0);
  });

  it("leaves out and counts the review's own annotations that are not a pin or a close", () => {
    const shapes: unknown[] = [
      'not json',
      '[1, 2]',
      { kind: 'pin', version: 2, round: 1, x: 0.5, y: 0.5 },
      { kind: 'pin', version: 1, round: 0, x: 0.5, y: 0.5 },
      { kind: 'pin', version: 1, round: 1.5, x: 0.5, y: 0.5 },
      { kind: 'pin', version: 1, round: 1000, x: 0.5, y: 0.5 },
      { kind: 'pin', version: 1, round: 1, x: 1.2, y: 0.5 },
      { kind: 'pin', version: 1, round: 1, x: 0.5, y: -0.1 },
      { kind: 'pin', version: 1, round: 1, x: '0.5', y: 0.5 },
      { kind: 'pin', version: 1, round: 1 },
      { kind: 'arrow', version: 1, round: 1, x: 0.5, y: 0.5 },
    ];
    const review = readPictureReview([
      ...shapes.map((shape) => annotation(shape)),
      annotation(null, { entity: null }),
      pin(1, 0.5, 0.5),
    ]);
    expect(review.unreadable).toBe(shapes.length + 1);
    expect(review.pins).toHaveLength(1);
    expect(review.pins[0].number).toBe(1);
  });

  it('shows a note it was given no text for as empty, never as anything else', () => {
    const odd = pin(1, 0.5, 0.5, { text: undefined as unknown as string });
    expect(readPictureReview([odd]).pins[0].note).toBe('');
  });
});

describe('the payloads', () => {
  it('write a pin as fractions to four places, clamped to the picture', () => {
    expect(JSON.parse(pinPayload(2, 0.123456, 1.7))).toEqual({
      kind: 'pin',
      version: 1,
      round: 2,
      x: 0.1235,
      y: 1,
    });
    expect(JSON.parse(roundClosedPayload(3))).toEqual({
      kind: 'round-closed',
      version: 1,
      round: 3,
    });
  });

  it('read back what they write', () => {
    const review = readPictureReview([pin(1, 0.4213, 0.3), closed(1)]);
    expect(review.pins[0]).toMatchObject({ x: 0.4213, y: 0.3 });
    expect(review.round).toBe(2);
  });

  it('say a place as whole percentages', () => {
    expect(toFraction(Number.NaN)).toBe(0);
    expect(toFraction(-1)).toBe(0);
    expect(percent(0.4213)).toBe(42);
    expect(percent(0.996)).toBe(100);
  });
});

describe('reviewOffers', () => {
  const record = (permissions: unknown, extra: Partial<NuxeoDocument> = {}): NuxeoDocument => ({
    uid: 'p1',
    title: 'Trail jacket',
    type: 'Picture',
    path: '/p1',
    lastModified: '',
    properties: {},
    contextParameters: permissions === undefined ? {} : { permissions },
    ...extra,
  });

  it('offers a pin to a holder of Comment or Write, and closing a round to a holder of Write', () => {
    expect(reviewOffers(record(['Read', 'Comment']), false)).toEqual({ pin: true, close: false });
    expect(reviewOffers(record(['Read', 'ReadWrite', 'Write']), false)).toEqual({
      pin: true,
      close: true,
    });
    expect(reviewOffers(record(['Everything']), false)).toEqual({ pin: true, close: true });
  });

  it('offers a reader nothing, and nothing when the permissions did not come with the record', () => {
    expect(reviewOffers(record(['Read', 'Browse', 'ReadProperties']), false)).toEqual({
      pin: false,
      close: false,
    });
    expect(reviewOffers(record(undefined), false)).toEqual({ pin: false, close: false });
    expect(reviewOffers(record('Write'), false)).toEqual({ pin: false, close: false });
  });

  it('offers nothing on a read-only page, a version or a record in the trash', () => {
    const all = ['Everything', 'Write', 'Comment'];
    expect(reviewOffers(record(all), true)).toEqual({ pin: false, close: false });
    expect(reviewOffers(record(all, { isVersion: true }), false)).toEqual({
      pin: false,
      close: false,
    });
    expect(reviewOffers(record(all, { isTrashed: true }), false)).toEqual({
      pin: false,
      close: false,
    });
  });
});
