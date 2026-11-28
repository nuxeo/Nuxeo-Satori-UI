import { LiveAnnouncer } from '@angular/cdk/a11y';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import {
  DocumentDetailService,
  type AssetReviewAnswer,
  type NuxeoAnnotation,
  type NuxeoAnnotationDraft,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import axe from 'axe-core';
import { Subject, of, type Observable } from 'rxjs';

import {
  MAX_ROUNDS,
  REVIEW_ORIGIN,
  REVIEW_XPATH,
  decisionPayload,
  pinPayload,
  roundClosedPayload,
} from './picture-review';
import { RecordPictureReviewComponent } from './record-picture-review';

function picture(permissions: string[] | undefined, uid = 'p1'): NuxeoDocument {
  return {
    uid,
    title: 'Trail jacket, front',
    type: 'Picture',
    path: `/assets/${uid}`,
    lastModified: '2026-11-25T00:00:00.000Z',
    properties: {
      'picture:views': [
        {
          title: 'Medium',
          width: 800,
          height: 1000,
          content: { 'mime-type': 'image/jpeg', digest: 'm1', data: 'http://x/nxfile/m' },
        },
      ],
    },
    contextParameters: permissions ? { permissions } : {},
  };
}

const REVIEWER = ['Read', 'Comment'];
const LEAD = ['Read', 'ReadWrite', 'Write'];
const READER = ['Read', 'Browse'];

/** What the server's `assetReview` enricher answers a member of a reviewer group granted ReviewAsset. */
const MAY_DECIDE: AssetReviewAnswer = {
  type: 'AcmeAsset',
  mayDecide: true,
  reason: null,
  permission: 'ReviewAsset',
};
/** And anyone else, a holder of Write included. */
const MAY_NOT: AssetReviewAnswer = { ...MAY_DECIDE, mayDecide: false, reason: 'not-a-reviewer' };

let made = 0;
function stored(entity: string, overrides: Partial<NuxeoAnnotation> = {}): NuxeoAnnotation {
  made++;
  return {
    id: `a${made}`,
    parentId: 'p1',
    author: 'reviewer1',
    text: `Note ${made}`,
    creationDate: new Date(Date.UTC(2026, 10, 25, 10) + made * 1000).toISOString(),
    xpath: REVIEW_XPATH,
    origin: REVIEW_ORIGIN,
    entity,
    ...overrides,
  };
}

/** An annotation as the repository holds it: what `getAnnotationDocuments` answers. */
function asDocument(annotation: NuxeoAnnotation): NuxeoDocument {
  return {
    uid: annotation.id,
    title: 'comment',
    type: 'Annotation',
    path: `/assets/p1/Comments/${annotation.id}`,
    lastModified: annotation.creationDate,
    properties: {
      'dc:created': annotation.creationDate,
      'comment:author': annotation.author,
      'comment:text': annotation.text,
      'annotation:xpath': annotation.xpath,
      'externalEntity:origin': annotation.origin,
      'externalEntity:entity': annotation.entity,
    },
  };
}

describe('RecordPictureReviewComponent', () => {
  let fixture: ComponentFixture<RecordPictureReviewComponent> | null;
  let reads: { uid: string; xpath: string; origin: string; answer: Subject<NuxeoDocument[]> }[];
  /** What the picture's view answers: at once, unless a test holds it back. */
  let view: () => Observable<Blob>;
  let writes: { uid: string; draft: NuxeoAnnotationDraft; answer: Subject<NuxeoAnnotation> }[];
  let announced: string[];
  /** What the server's review enricher answers: none, as a server without the add-on gives. */
  let reviewAnswer: AssetReviewAnswer | null;
  let fetchAssetReview: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fixture = null;
    made = 0;
    reads = [];
    writes = [];
    announced = [];
    reviewAnswer = null;
    fetchAssetReview = vi.fn(() => of(reviewAnswer));
    view = () => of(new Blob(['jpeg'], { type: 'image/jpeg' }));
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:view-1'),
      revokeObjectURL: vi.fn(),
    });
    TestBed.configureTestingModule({
      imports: [RecordPictureReviewComponent, MatIconTestingModule],
      providers: [
        {
          provide: DocumentDetailService,
          useValue: {
            fetchBlobByXpath: (): Observable<Blob> => view(),
            fetchAssetReview,
            getAnnotationDocuments: (
              uid: string,
              xpath: string,
              origin: string,
            ): Observable<NuxeoDocument[]> => {
              const answer = new Subject<NuxeoDocument[]>();
              reads.push({ uid, xpath, origin, answer });
              return answer;
            },
            createAnnotation: (
              uid: string,
              draft: NuxeoAnnotationDraft,
            ): Observable<NuxeoAnnotation> => {
              const answer = new Subject<NuxeoAnnotation>();
              writes.push({ uid, draft, answer });
              return answer;
            },
          },
        },
        {
          provide: LiveAnnouncer,
          useValue: { announce: (message: string) => announced.push(message) },
        },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
  });

  async function settle(): Promise<HTMLElement> {
    const shown = fixture as ComponentFixture<RecordPictureReviewComponent>;
    shown.detectChanges();
    await shown.whenStable();
    shown.detectChanges();
    return shown.nativeElement as HTMLElement;
  }

  async function render(document: NuxeoDocument, readOnly = false): Promise<HTMLElement> {
    fixture ??= TestBed.createComponent(RecordPictureReviewComponent);
    fixture.componentRef.setInput('document', document);
    fixture.componentRef.setInput('readOnly', readOnly);
    return settle();
  }

  async function answerRead(entries: NuxeoAnnotation[], index = reads.length - 1) {
    reads[index].answer.next(entries.map(asDocument));
    reads[index].answer.complete();
    return settle();
  }

  async function answerWrite(created: NuxeoAnnotation, index = writes.length - 1) {
    writes[index].answer.next(created);
    writes[index].answer.complete();
    return settle();
  }

  const marks = (root: HTMLElement) =>
    Array.from(
      root.querySelectorAll<HTMLButtonElement>('.record-review__marks .record-review__pin'),
    );
  const entries = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('.record-review__entry'));
  const button = (root: HTMLElement, text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (each) => each.textContent?.trim() === text,
    ) ?? null;
  /** The button under the pins that a click on the picture reaches. */
  const surface = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('.record-review__surface') as HTMLElement;
  /** A click of the pointer: one with a point, and a count of clicks, as a key's has not. */
  const clickAt = (element: HTMLElement, clientX: number, clientY: number) =>
    element.dispatchEvent(new MouseEvent('click', { clientX, clientY, detail: 1, bubbles: true }));
  const type = (element: HTMLInputElement | HTMLTextAreaElement | null, value: string) => {
    if (!element) throw new Error('no field');
    element.value = value;
    element.dispatchEvent(new Event('input'));
  };
  /** jsdom lays nothing out: the surface is given the box a 400 × 500 picture would have. */
  const box = (element: HTMLElement) => {
    element.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 400, height: 500, right: 500, bottom: 550 }) as DOMRect;
  };

  it("reads the record's annotations on its views, and draws each pin on the picture at its place", async () => {
    const root = await render(picture(REVIEWER));
    expect(reads.map((read) => [read.uid, read.xpath, read.origin])).toEqual([
      ['p1', 'picture:views', 'nuxeo-satori.review'],
    ]);
    expect(root.querySelector('.record-review nxs-spinner')).not.toBeNull();

    await answerRead([
      stored(pinPayload(1, 0.25, 0.4), { text: 'Logo too close to the hem' }),
      stored(pinPayload(1, 0.7, 0.1)),
    ]);
    // The picture from a blob URL, never a Nuxeo address.
    expect(root.querySelector('img')?.getAttribute('src')).toBe('blob:view-1');
    const [first, second] = marks(root);
    expect(first.style.left).toBe('25%');
    expect(first.style.top).toBe('40%');
    expect(first.textContent?.trim()).toBe('1');
    expect(first.getAttribute('aria-label')).toBe(
      'Pin 1, round 1, 25% across, 40% down: Logo too close to the hem',
    );
    expect(second.style.left).toBe('70%');
    expect(root.querySelector('.record-review__marks')?.getAttribute('aria-label')).toBe(
      'Pins on the picture',
    );
  });

  it('lists the pins beside the picture, under their round, with note, author and place', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([stored(pinPayload(1, 0.25, 0.4), { text: 'Logo too close to the hem' })]);
    expect(root.querySelector('.record-review__round-heading')?.textContent?.trim()).toBe(
      'Round 1, open',
    );
    const [entry] = entries(root);
    expect(entry.querySelector('.record-review__entry-note')?.textContent).toBe(
      'Logo too close to the hem',
    );
    expect(entry.querySelector('.record-review__entry-meta')?.textContent?.trim()).toBe(
      'reviewer1 · 25% across, 40% down',
    );
  });

  it('highlights a pin chosen on the picture in the list, and one chosen in the list on the picture', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([stored(pinPayload(1, 0.2, 0.2)), stored(pinPayload(1, 0.8, 0.8))]);
    marks(root)[1].click();
    await settle();
    expect(entries(root).map((each) => each.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
    ]);
    expect(marks(root)[1].classList).toContain('record-review__pin--chosen');

    entries(root)[0].click();
    await settle();
    expect(marks(root).map((each) => each.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    // Choosing a pin on the picture places none.
    expect(root.querySelector('.record-review__form')).toBeNull();
  });

  it('makes the pins on the picture one keyboard stop, the arrow keys moving among them', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([
      stored(pinPayload(1, 0.2, 0.2)),
      stored(pinPayload(1, 0.5, 0.5)),
      stored(pinPayload(1, 0.8, 0.8)),
    ]);
    expect(marks(root).map((each) => each.tabIndex)).toEqual([0, -1, -1]);
    marks(root)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await settle();
    expect(marks(root).map((each) => each.tabIndex)).toEqual([-1, 0, -1]);
    expect(document.activeElement).toBe(marks(root)[1]);
    expect(marks(root)[1].getAttribute('aria-pressed')).toBe('true');
    marks(root)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    await settle();
    expect(marks(root)[2].getAttribute('aria-pressed')).toBe('true');
    // Past the last, nothing moves.
    marks(root)[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    await settle();
    expect(marks(root)[2].getAttribute('aria-pressed')).toBe('true');
  });

  it('places a pin where the picture is clicked, as fractions of the view, with its note', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    expect(root.querySelector('.record-review__none')?.textContent?.trim()).toBe(
      'No pins in this round yet',
    );
    box(surface(root));
    clickAt(surface(root), 200, 300);
    await settle();
    const draft = root.querySelector<HTMLElement>('.record-review__pin--draft');
    expect(draft?.style.left).toBe('25%');
    expect(draft?.style.top).toBe('50%');
    expect(root.querySelector<HTMLInputElement>('input[id$="-across"]')?.value).toBe('25');
    expect(root.querySelector<HTMLInputElement>('input[id$="-down"]')?.value).toBe('50');

    // The note is required.
    const place = button(root, 'Place pin');
    expect(place?.getAttribute('aria-disabled')).toBe('true');
    place?.click();
    expect(writes).toEqual([]);

    type(root.querySelector('textarea'), '  The seam is crooked  ');
    await settle();
    root.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
    expect(writes.map((write) => [write.uid, write.draft])).toEqual([
      [
        'p1',
        {
          xpath: 'picture:views',
          text: 'The seam is crooked',
          origin: 'nuxeo-satori.review',
          entity: pinPayload(1, 0.25, 0.5),
        },
      ],
    ]);

    await answerWrite(stored(writes[0].draft.entity as string, { text: 'The seam is crooked' }));
    expect(marks(root)).toHaveLength(1);
    expect(marks(root)[0].getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.record-review__form')).toBeNull();
    expect(announced).toEqual(['Pin 1 placed']);
  });

  it("keeps the picture's click target out of the tab order, and starts a pointerless click at the middle", async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    expect(surface(root).tagName).toBe('BUTTON');
    expect(surface(root).getAttribute('tabindex')).toBe('-1');
    expect(surface(root).getAttribute('aria-hidden')).toBe('true');
    box(surface(root));
    surface(root).click();
    await settle();
    expect(root.querySelector<HTMLElement>('.record-review__pin--draft')?.style.left).toBe('50%');
    expect(root.querySelector<HTMLElement>('.record-review__pin--draft')?.style.top).toBe('50%');
  });

  it('places a pin with the form alone: Add a pin, how far across and down, a note', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    button(root, 'Add a pin')?.click();
    await settle();
    const across = root.querySelector<HTMLInputElement>('input[id$="-across"]');
    expect(document.activeElement).toBe(across);
    // It starts at the middle, and moves as the fields change.
    expect(root.querySelector<HTMLElement>('.record-review__pin--draft')?.style.left).toBe('50%');
    type(across, '30');
    type(root.querySelector<HTMLInputElement>('input[id$="-down"]'), '70');
    // An empty value moves nothing.
    type(root.querySelector<HTMLInputElement>('input[id$="-down"]'), '');
    type(root.querySelector('textarea'), 'Sleeve colour is off');
    await settle();
    expect(root.querySelector<HTMLElement>('.record-review__pin--draft')?.style.left).toBe('30%');
    expect(root.querySelector<HTMLElement>('.record-review__pin--draft')?.style.top).toBe('70%');
    root.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
    expect(JSON.parse(writes[0].draft.entity as string)).toEqual({
      kind: 'pin',
      version: 1,
      round: 1,
      x: 0.3,
      y: 0.7,
    });
  });

  it('holds a position typed past the edge to the edge', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    button(root, 'Add a pin')?.click();
    await settle();
    type(root.querySelector<HTMLInputElement>('input[id$="-across"]'), '140');
    type(root.querySelector<HTMLInputElement>('input[id$="-down"]'), '-5');
    await settle();
    expect(root.querySelector<HTMLElement>('.record-review__pin--draft')?.style.left).toBe('100%');
    expect(root.querySelector<HTMLElement>('.record-review__pin--draft')?.style.top).toBe('0%');
  });

  it('drops the pin being placed on Escape, and offers Add a pin again', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    button(root, 'Add a pin')?.click();
    await settle();
    root
      .querySelector('form')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(root.querySelector('.record-review__form')).toBeNull();
    expect(root.querySelector('.record-review__pin--draft')).toBeNull();
    expect(document.activeElement).toBe(button(root, 'Add a pin'));
  });

  it('asks the server what it lets the reader decide, for the record shown', async () => {
    await render(picture(LEAD));
    expect(fetchAssetReview).toHaveBeenCalledTimes(1);
    expect(fetchAssetReview).toHaveBeenCalledWith('p1');
  });

  it('offers a reviewer Approve and Reject, and no Send back while the open round has no pin', async () => {
    reviewAnswer = MAY_DECIDE;
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    expect(button(root, 'Add a pin')).not.toBeNull();
    expect(button(root, 'Send back round 1')).toBeNull();
    expect(button(root, 'Approve')).not.toBeNull();
    expect(button(root, 'Reject')).not.toBeNull();
  });

  it("offers a holder of Write no decision unless the server's review says they may decide", async () => {
    for (const answer of [null, MAY_NOT]) {
      reviewAnswer = answer;
      fixture?.destroy();
      fixture = null;
      const root = await render(picture(LEAD));
      await answerRead([stored(pinPayload(1, 0.4, 0.4))]);
      expect(button(root, 'Add a pin')).not.toBeNull();
      expect(button(root, 'Send back round 1')).toBeNull();
      expect(button(root, 'Approve')).toBeNull();
      expect(button(root, 'Reject')).toBeNull();
    }
  });

  it('sends the round back for a reviewer: the next opens, and the earlier pins stay, marked as past', async () => {
    reviewAnswer = MAY_DECIDE;
    const again = await render(picture(REVIEWER));
    await answerRead([stored(pinPayload(1, 0.4, 0.4), { text: 'Crop tighter' })]);
    button(again, 'Send back round 1')?.click();
    await settle();
    expect(writes[0].draft).toEqual({
      xpath: 'picture:views',
      text: 'Round 1 sent back',
      origin: 'nuxeo-satori.review',
      entity: roundClosedPayload(1),
    });
    await answerWrite(
      stored(roundClosedPayload(1), { author: 'lead1', text: 'Round 1 sent back' }),
    );
    expect(announced).toEqual(['Round 1 sent back. Round 2 is open.']);
    expect(again.querySelector('.record-review__status')?.textContent?.trim()).toBe(
      'Round 2 is open',
    );
    expect(
      Array.from(again.querySelectorAll('.record-review__round-heading')).map((heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual(['Round 2, open', 'Round 1, past']);
    expect(again.querySelector('.record-review__closed-by')?.textContent).toContain(
      'Sent back by lead1',
    );
    const [past] = marks(again);
    expect(past.classList).toContain('record-review__pin--past');
    expect(past.getAttribute('aria-label')).toBe(
      'Pin 1, past round 1, 40% across, 40% down: Crop tighter',
    );
    expect(entries(again)[0].querySelector('.record-review__past')?.textContent?.trim()).toBe(
      'Past',
    );
    // A new pin goes into round 2.
    button(again, 'Add a pin')?.click();
    await settle();
    type(again.querySelector('textarea'), 'Better');
    await settle();
    again.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
    expect(JSON.parse(writes[1].draft.entity as string).round).toBe(2);
  });

  it('offers a holder of Comment a pin, and no decision the server does not let them make', async () => {
    reviewAnswer = MAY_NOT;
    const root = await render(picture(REVIEWER));
    await answerRead([stored(pinPayload(1, 0.4, 0.4))]);
    expect(button(root, 'Add a pin')).not.toBeNull();
    expect(button(root, 'Send back round 1')).toBeNull();
    expect(button(root, 'Approve')).toBeNull();
  });

  it('approves for a reviewer: the review is concluded, said, and nothing more is decided', async () => {
    reviewAnswer = MAY_DECIDE;
    const root = await render(picture(REVIEWER));
    await answerRead([stored(pinPayload(1, 0.4, 0.4))]);
    button(root, 'Approve')?.click();
    await settle();
    expect(writes[0].draft).toEqual({
      xpath: 'picture:views',
      text: 'Approved in round 1',
      origin: 'nuxeo-satori.review',
      entity: decisionPayload(1, 'approved'),
    });
    await answerWrite(
      stored(decisionPayload(1, 'approved'), { author: 'lead1', text: 'Approved in round 1' }),
    );
    expect(announced).toEqual(['The review is approved.']);
    const conclusion = root.querySelector('.record-review__conclusion');
    expect(conclusion?.getAttribute('data-decision')).toBe('approved');
    expect(conclusion?.textContent).toContain('Approved by lead1');
    expect(root.querySelector('.record-review__status')).toBeNull();
    expect(button(root, 'Approve')).toBeNull();
    expect(button(root, 'Reject')).toBeNull();
    expect(button(root, 'Send back round 1')).toBeNull();
  });

  it('rejects for a reviewer, and offers nothing on a review read concluded', async () => {
    reviewAnswer = MAY_DECIDE;
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    button(root, 'Reject')?.click();
    await settle();
    expect(JSON.parse(writes[0].draft.entity as string)).toEqual({
      kind: 'decision',
      version: 1,
      round: 1,
      decision: 'rejected',
    });

    fixture?.destroy();
    fixture = null;
    const concluded = await render(picture(REVIEWER, 'p2'));
    await answerRead([
      stored(pinPayload(1, 0.4, 0.4)),
      stored(decisionPayload(1, 'rejected'), { author: 'lead2' }),
    ]);
    expect(concluded.querySelector('.record-review__conclusion')?.textContent).toContain(
      'Rejected by lead2',
    );
    expect(button(concluded, 'Approve')).toBeNull();
    expect(button(concluded, 'Reject')).toBeNull();
    expect(button(concluded, 'Send back round 1')).toBeNull();
  });

  it("says a refused decision as the server's refusal, and reads the review again", async () => {
    reviewAnswer = MAY_DECIDE;
    const root = await render(picture(REVIEWER));
    await answerRead([stored(pinPayload(1, 0.4, 0.4))]);
    expect(reads).toHaveLength(1);
    button(root, 'Approve')?.click();
    await settle();
    writes[0].answer.error(new HttpErrorResponse({ status: 403 }));
    await settle();
    expect(root.querySelector('.record-review__error')?.textContent?.trim()).toBe(
      'The server refused: you may not decide this review',
    );
    expect(reads).toHaveLength(2);

    button(root, 'Send back round 1')?.click();
    await settle();
    writes[1].answer.error(new HttpErrorResponse({ status: 409 }));
    await settle();
    expect(root.querySelector('.record-review__error')?.textContent?.trim()).toBe(
      'This review is already approved or rejected',
    );
    expect(reads).toHaveLength(3);
  });

  it('shows a reader who may not comment the pins, and no way to add one: the server still decides', async () => {
    const root = await render(picture(READER));
    await answerRead([stored(pinPayload(1, 0.4, 0.4))]);
    expect(marks(root)).toHaveLength(1);
    expect(entries(root)).toHaveLength(1);
    expect(button(root, 'Add a pin')).toBeNull();
    expect(button(root, 'Send back round 1')).toBeNull();
    expect(root.querySelector('.record-review__read-only')?.textContent?.trim()).toBe(
      'You can see the pins, but not add one.',
    );
    // Nothing on the picture to click: the pointer's shortcut is not drawn for a reader.
    expect(surface(root)).toBeNull();
    expect(root.querySelector('.record-review__form')).toBeNull();
  });

  it('offers nothing on a read-only page, as the designer previews it', async () => {
    reviewAnswer = MAY_DECIDE;
    const root = await render(picture(['Everything']), true);
    await answerRead([stored(pinPayload(1, 0.4, 0.4))]);
    expect(button(root, 'Add a pin')).toBeNull();
    expect(button(root, 'Send back round 1')).toBeNull();
    expect(button(root, 'Approve')).toBeNull();
    expect(marks(root)).toHaveLength(1);
  });

  it('says a refused pin as a refusal, and a failed one as a failure, keeping what was typed', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    button(root, 'Add a pin')?.click();
    await settle();
    type(root.querySelector('textarea'), 'Too dark');
    await settle();
    root.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
    writes[0].answer.error(new HttpErrorResponse({ status: 403 }));
    await settle();
    expect(root.querySelector('.record-review__error')?.textContent?.trim()).toBe(
      'You may not add a pin to this picture',
    );
    expect(root.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Too dark');

    root.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
    writes[1].answer.error(new HttpErrorResponse({ status: 500 }));
    await settle();
    expect(root.querySelector('.record-review__error')?.textContent?.trim()).toBe(
      'The pin could not be placed',
    );
    expect(marks(root)).toHaveLength(0);
  });

  it('says when the review cannot be loaded, and asks again on Retry', async () => {
    const root = await render(picture(REVIEWER));
    reads[0].answer.error(new HttpErrorResponse({ status: 503 }));
    await settle();
    expect(root.querySelector('.record-review nxs-error-state')).not.toBeNull();
    expect(button(root, 'Add a pin')).toBeNull();
    root.querySelector<HTMLButtonElement>('.record-review nxs-error-state button')?.click();
    await settle();
    expect(reads).toHaveLength(2);
    await answerRead([stored(pinPayload(1, 0.4, 0.4))]);
    expect(marks(root)).toHaveLength(1);
  });

  it("reads another record's review afresh, and drops a pin answered after the record changed", async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([stored(pinPayload(1, 0.4, 0.4))]);
    button(root, 'Add a pin')?.click();
    await settle();
    type(root.querySelector('textarea'), 'Late');
    await settle();
    root.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();

    await render(picture(REVIEWER, 'p2'));
    expect(reads.map((read) => read.uid)).toEqual(['p1', 'p2']);
    // The first record's pins are not shown while the second's load.
    expect(marks(root)).toHaveLength(0);
    await answerRead([]);
    await answerWrite(stored(writes[0].draft.entity as string));
    expect(marks(root)).toHaveLength(0);
    expect(root.querySelector('.record-review__form')).toBeNull();
  });

  it('reads the record again after a write, and files a pin by the round open when it was written', async () => {
    const root = await render(picture(REVIEWER));
    // This page has not seen round 1 closed by someone else.
    await answerRead([stored(pinPayload(1, 0.2, 0.2))]);
    button(root, 'Add a pin')?.click();
    await settle();
    type(root.querySelector('textarea'), 'Late');
    await settle();
    root.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
    expect(JSON.parse(writes[0].draft.entity as string).round).toBe(1);
    const late = stored(writes[0].draft.entity as string, {
      id: 'late',
      text: 'Late',
      creationDate: '2026-11-25T10:10:00.000Z',
    });
    await answerWrite(late);
    expect(reads).toHaveLength(2);
    // The server's answer: the close came first, so the pin is round 2's.
    const close = stored(roundClosedPayload(1), {
      author: 'lead1',
      creationDate: '2026-11-25T10:05:00.000Z',
    });
    await answerRead([stored(pinPayload(1, 0.2, 0.2)), close, late]);
    expect(root.querySelector('.record-review__status')?.textContent?.trim()).toBe(
      'Round 2 is open',
    );
    expect(marks(root).map((each) => each.getAttribute('data-round'))).toEqual(['1', '2']);
  });

  it('keeps what it shows when the read after a write fails', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    button(root, 'Add a pin')?.click();
    await settle();
    type(root.querySelector('textarea'), 'Kept');
    await settle();
    root.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
    await answerWrite(stored(writes[0].draft.entity as string, { text: 'Kept' }));
    reads[1].answer.error(new HttpErrorResponse({ status: 500 }));
    await settle();
    expect(marks(root)).toHaveLength(1);
    expect(root.querySelector('.record-review nxs-error-state')).toBeNull();
  });

  it('offers no pin until a view of the picture is shown', async () => {
    const held = new Subject<Blob>();
    view = () => held;
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    expect(root.querySelector('.record-review__status')).not.toBeNull();
    expect(button(root, 'Add a pin')).toBeNull();
    expect(surface(root)).toBeNull();
    held.next(new Blob(['jpeg'], { type: 'image/jpeg' }));
    held.complete();
    await settle();
    expect(button(root, 'Add a pin')).not.toBeNull();
  });

  it('says a pin the server saved but the review cannot read, and keeps what was typed', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    button(root, 'Add a pin')?.click();
    await settle();
    type(root.querySelector('textarea'), 'Odd');
    await settle();
    root.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
    await answerWrite(stored('not json', { text: 'Odd' }));
    expect(root.querySelector('.record-review__error')?.textContent?.trim()).toBe(
      'The pin could not be placed',
    );
    expect(root.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Odd');
    expect(announced).toEqual([]);
  });

  it('says a close that opened no round, as one past the last round counted', async () => {
    const closes = Array.from({ length: MAX_ROUNDS - 1 }, (_, index) =>
      stored(roundClosedPayload(index + 1)),
    );
    reviewAnswer = MAY_DECIDE;
    const root = await render(picture(LEAD));
    await answerRead([...closes, stored(pinPayload(MAX_ROUNDS, 0.5, 0.5))]);
    button(root, `Send back round ${MAX_ROUNDS}`)?.click();
    await settle();
    await answerWrite(stored(roundClosedPayload(MAX_ROUNDS)));
    expect(root.querySelector('.record-review__error')?.textContent?.trim()).toBe(
      'The round could not be sent back',
    );

    expect(announced).toEqual([]);
  });

  it('says a write the server ended the session for as a failure, not a refusal', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    button(root, 'Add a pin')?.click();
    await settle();
    type(root.querySelector('textarea'), 'Expired');
    await settle();
    root.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
    writes[0].answer.error(new HttpErrorResponse({ status: 401 }));
    await settle();
    expect(root.querySelector('.record-review__error')?.textContent?.trim()).toBe(
      'The pin could not be placed',
    );
  });

  it('chooses no pin when the chosen one is pressed again', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([stored(pinPayload(1, 0.2, 0.2))]);
    marks(root)[0].click();
    await settle();
    expect(marks(root)[0].getAttribute('aria-pressed')).toBe('true');
    marks(root)[0].click();
    await settle();
    expect(marks(root)[0].getAttribute('aria-pressed')).toBe('false');
    expect(entries(root)[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('names the pins on the picture a toolbar, and says how the arrow keys move in it', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([stored(pinPayload(1, 0.2, 0.2))]);
    const toolbar = root.querySelector('.record-review__marks');
    expect(toolbar?.getAttribute('role')).toBe('toolbar');
    const hint = root.querySelector(`[id="${toolbar?.getAttribute('aria-describedby')}"]`);
    expect(hint?.textContent?.trim()).toBe('Use the arrow keys to move between the pins.');
  });

  it('writes the place a pin will have back into a field once it is left, and leaves validation to it', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    button(root, 'Add a pin')?.click();
    await settle();
    expect(root.querySelector('form')?.hasAttribute('novalidate')).toBe(true);
    const across = root.querySelector<HTMLInputElement>('input[id$="-across"]') as HTMLInputElement;
    type(across, '140');
    across.dispatchEvent(new Event('change'));
    await settle();
    expect(across.value).toBe('100');
    type(across, '');
    across.dispatchEvent(new Event('change'));
    await settle();
    expect(across.value).toBe('100');
  });

  it('draws the form with nxs- fields: named, the place in percent from 0 to 100, the note required', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    button(root, 'Add a pin')?.click();
    await settle();
    const across = root.querySelector<HTMLInputElement>('nxs-text-field input[id$="-across"]');
    const down = root.querySelector<HTMLInputElement>('nxs-text-field input[id$="-down"]');
    const note = root.querySelector<HTMLTextAreaElement>('nxs-text-field textarea[id$="-note"]');
    for (const [control, name] of [
      [across, 'Across (%)'],
      [down, 'Down (%)'],
    ] as const) {
      expect(control?.type).toBe('number');
      expect([control?.min, control?.max, control?.step]).toEqual(['0', '100', '1']);
      expect(control?.labels?.[0]?.textContent?.trim()).toContain(name.split(' ')[0]);
    }
    expect(note?.required).toBe(true);
    expect(note?.getAttribute('maxlength')).toBe('2000');
    type(note, 'Logo');
    await settle();
    const hint = root.querySelector('.record-review__note mat-hint');
    expect(hint?.textContent?.trim()).toBe('4 / 2000');
    expect(note?.getAttribute('aria-describedby')?.split(' ')).toContain(hint?.id);
    // The tab order: across, down, the note, then Place pin and Cancel.
    expect(
      [
        ...root.querySelectorAll<HTMLElement>(
          '.record-review__form input, .record-review__form textarea, .record-review__form button',
        ),
      ].map((control) => control.id || control.textContent?.trim()),
    ).toEqual([across?.id, down?.id, note?.id, 'Place pin', 'Cancel']);
  });

  it('passes axe at WCAG 2.2 AA, its pins listed and its form open', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([stored(pinPayload(1, 0.2, 0.2))]);
    button(root, 'Add a pin')?.click();
    await settle();
    const results = await axe.run(root, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      // jsdom lays nothing out, so contrast cannot be measured here.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('leaves a clicked pin where it is when a field emptied is left: it only says the place again', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([]);
    box(surface(root));
    // 42.56% across: the field says 43, and the pin is where it was clicked.
    clickAt(surface(root), 270.24, 300);
    await settle();
    const across = root.querySelector<HTMLInputElement>('input[id$="-across"]') as HTMLInputElement;
    expect(across.value).toBe('43');
    type(across, '');
    across.dispatchEvent(new Event('change'));
    await settle();
    expect(across.value).toBe('43');
    type(root.querySelector('textarea'), 'Crooked seam');
    await settle();
    root.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
    expect(JSON.parse(writes[0].draft.entity as string).x).toBeCloseTo(0.4256, 4);
  });

  it('asks nothing again when the same record is reloaded, as after an edit', async () => {
    await render(picture(REVIEWER));
    await answerRead([]);
    await render({ ...picture(REVIEWER), lastModified: '2026-11-25T11:00:00.000Z' });
    expect(reads).toHaveLength(1);
  });
});
