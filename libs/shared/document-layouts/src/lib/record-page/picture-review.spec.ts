import type { NuxeoAnnotation, NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import {
  MAX_ROUNDS,
  REVIEW_ORIGIN,
  fromAnnotationDocument,
  fromCreatedAnnotation,
  type ReviewAnnotation,
  REVIEW_XPATH,
  percent,
  pinPayload,
  readPictureReview,
  reviewOffers,
  roundClosedPayload,
  toFraction,
} from './picture-review';

let seconds = 0;

/** One of the review's annotations, as the repository dates them: each a second after the one before. */
function annotation(entity: unknown, overrides: Partial<ReviewAnnotation> = {}): ReviewAnnotation {
  seconds++;
  return {
    id: `a${seconds}`,
    author: 'reviewer1',
    text: `Note ${seconds}`,
    written: new Date(Date.UTC(2026, 10, 25, 10) + seconds * 1000).toISOString(),
    xpath: REVIEW_XPATH,
    origin: REVIEW_ORIGIN,
    entity: typeof entity === 'string' ? entity : JSON.stringify(entity),
    ...overrides,
  };
}

const pin = (round: number, x: number, y: number, overrides: Partial<ReviewAnnotation> = {}) =>
  annotation(pinPayload(round, x, y), overrides);
const closed = (round: number, overrides: Partial<ReviewAnnotation> = {}) =>
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
        created: first.written,
      },
      {
        id: second.id,
        number: 2,
        round: 1,
        x: 0.7,
        y: 0.1,
        note: 'Note 2',
        author: 'reviewer1',
        created: second.written,
      },
    ]);
    expect(review.round).toBe(1);
    expect(review.rounds).toEqual([{ number: 1, closedBy: null, closedAt: null }]);
    expect(review.unreadable).toBe(0);
  });

  it('opens the next round once the open one is closed, and says who closed it and when', () => {
    const first = pin(1, 0.1, 0.1);
    const close = closed(1, { author: 'lead1' });
    const review = readPictureReview([first, close, pin(2, 0.5, 0.5)]);
    expect(review.round).toBe(2);
    expect(review.rounds).toEqual([
      { number: 1, closedBy: 'lead1', closedAt: close.written },
      { number: 2, closedBy: null, closedAt: null },
    ]);
    expect(review.pins.map((each) => [each.number, each.round])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('moves one round at a time: a second close of a closed round changes nothing', () => {
    // Two people close round 1 at once: one round closes, not two.
    expect(readPictureReview([closed(1), closed(1)]).round).toBe(2);
    // A close naming a later round still closes only the open one.
    const review = readPictureReview([closed(1), closed(5), closed(2)]);
    expect(review.round).toBe(3);
    expect(review.rounds.map((round) => round.number)).toEqual([1, 2, 3]);
  });

  it('puts each pin in the round open when it was written, whatever round it names', () => {
    // A page that had not seen round 1 closed writes round 1; its pin goes into round 2.
    const review = readPictureReview([pin(1, 0.1, 0.1), closed(1), pin(1, 0.2, 0.2)]);
    expect(review.pins.map((each) => each.round)).toEqual([1, 2]);
    expect(readPictureReview([pin(4, 0.5, 0.5)]).pins[0].round).toBe(1);
  });

  it('renumbers the rounds after a close deleted from the comments, and merges none', () => {
    // Round 1's close is gone; round 2's still closes the round open then.
    const review = readPictureReview([pin(1, 0.1, 0.1), closed(2), pin(3, 0.2, 0.2)]);
    expect(review.round).toBe(2);
    expect(review.pins.map((each) => each.round)).toEqual([1, 2]);
  });

  it('counts no more rounds than it reads, so that a pin is always writable', () => {
    const closes = Array.from({ length: MAX_ROUNDS + 5 }, (_, index) => closed(index + 1));
    const review = readPictureReview([...closes, pin(MAX_ROUNDS, 0.5, 0.5)]);
    expect(review.round).toBe(MAX_ROUNDS);
    expect(review.pins[0].round).toBe(MAX_ROUNDS);
    expect(review.unreadable).toBe(5);
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

  it('orders by when the repository wrote each, not by the order they are answered in', () => {
    const late = pin(1, 0.9, 0.9, { written: '2026-11-25T11:00:00.000Z' });
    const early = pin(1, 0.1, 0.1, { written: '2026-11-25T09:00:00.000Z' });
    expect(readPictureReview([late, early]).pins.map((each) => each.x)).toEqual([0.1, 0.9]);
  });
});

describe('the annotations the review reads', () => {
  it("are read from an Annotation document's server date, comment and payload", () => {
    const document = {
      uid: 'a1',
      title: 'comment',
      type: 'Annotation',
      path: '/p1/Comments/comment',
      lastModified: '2026-11-25T10:00:01.000Z',
      properties: {
        'dc:created': '2026-11-25T10:00:00.500Z',
        // What a writer may send: never what the review orders by.
        'comment:creationDate': '2000-01-01T00:00:00.000Z',
        'comment:author': 'reviewer1',
        'comment:text': 'Crop tighter',
        'annotation:xpath': REVIEW_XPATH,
        'externalEntity:origin': REVIEW_ORIGIN,
        'externalEntity:entity': pinPayload(1, 0.5, 0.5),
      },
    } satisfies NuxeoDocument;
    expect(fromAnnotationDocument(document)).toEqual({
      id: 'a1',
      author: 'reviewer1',
      text: 'Crop tighter',
      written: '2026-11-25T10:00:00.500Z',
      xpath: REVIEW_XPATH,
      origin: REVIEW_ORIGIN,
      entity: pinPayload(1, 0.5, 0.5),
    });
  });

  it('read a missing text as empty and a missing payload as none, never as anything else', () => {
    const bare = {
      uid: 'a2',
      title: '',
      type: 'Annotation',
      path: '/',
      lastModified: '',
      properties: {},
    };
    expect(fromAnnotationDocument(bare)).toEqual({
      id: 'a2',
      author: '',
      text: '',
      written: '',
      xpath: null,
      origin: null,
      entity: null,
    });
    const created = {
      id: 'a3',
      parentId: 'p1',
      author: 'reviewer1',
      text: 'New',
      creationDate: '2026-11-25T10:00:00Z',
      xpath: REVIEW_XPATH,
      origin: REVIEW_ORIGIN,
      entity: '{}',
    } satisfies NuxeoAnnotation;
    expect(fromCreatedAnnotation(created).written).toBe('2026-11-25T10:00:00Z');
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
