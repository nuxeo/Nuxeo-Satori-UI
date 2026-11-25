import { LiveAnnouncer } from '@angular/cdk/a11y';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import {
  DocumentDetailService,
  type NuxeoAnnotation,
  type NuxeoAnnotationDraft,
  type NuxeoAnnotationList,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, type Observable } from 'rxjs';

import { REVIEW_ORIGIN, REVIEW_XPATH, pinPayload, roundClosedPayload } from './picture-review';
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

let made = 0;
function stored(entity: string, overrides: Partial<NuxeoAnnotation> = {}): NuxeoAnnotation {
  made++;
  return {
    id: `a${made}`,
    parentId: 'p1',
    author: 'reviewer1',
    text: `Note ${made}`,
    creationDate: `2026-11-25T10:00:${String(made).padStart(2, '0')}.000Z`,
    xpath: REVIEW_XPATH,
    origin: REVIEW_ORIGIN,
    entity,
    ...overrides,
  };
}

describe('RecordPictureReviewComponent', () => {
  let fixture: ComponentFixture<RecordPictureReviewComponent> | null;
  let reads: { uid: string; xpath: string; answer: Subject<NuxeoAnnotationList> }[];
  let writes: { uid: string; draft: NuxeoAnnotationDraft; answer: Subject<NuxeoAnnotation> }[];
  let announced: string[];

  beforeEach(() => {
    fixture = null;
    made = 0;
    reads = [];
    writes = [];
    announced = [];
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
            fetchBlobByXpath: (): Observable<Blob> =>
              of(new Blob(['jpeg'], { type: 'image/jpeg' })),
            getAnnotations: (uid: string, xpath: string): Observable<NuxeoAnnotationList> => {
              const answer = new Subject<NuxeoAnnotationList>();
              reads.push({ uid, xpath, answer });
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
    reads[index].answer.next({ entries });
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
    expect(reads.map((read) => [read.uid, read.xpath])).toEqual([['p1', 'picture:views']]);
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

  it('places a pin by keyboard alone: Add a pin, how far across and down, a note', async () => {
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
    // A value out of range is held to the picture; an empty one moves nothing.
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

  it('offers no Close round while the open round has no pin', async () => {
    const root = await render(picture(LEAD));
    await answerRead([]);
    expect(button(root, 'Add a pin')).not.toBeNull();
    expect(button(root, 'Close round 1')).toBeNull();
  });

  it('closes the round for a holder of Write: the next opens, and the earlier pins stay, marked as past', async () => {
    const again = await render(picture(LEAD));
    await answerRead([stored(pinPayload(1, 0.4, 0.4), { text: 'Crop tighter' })]);
    button(again, 'Close round 1')?.click();
    await settle();
    expect(writes[0].draft).toEqual({
      xpath: 'picture:views',
      text: 'Round 1 closed',
      origin: 'nuxeo-satori.review',
      entity: roundClosedPayload(1),
    });
    await answerWrite(stored(roundClosedPayload(1), { author: 'lead1', text: 'Round 1 closed' }));
    expect(announced).toEqual(['Round 1 closed. Round 2 is open.']);
    expect(again.querySelector('.record-review__status')?.textContent?.trim()).toBe(
      'Round 2 is open',
    );
    expect(
      Array.from(again.querySelectorAll('.record-review__round-heading')).map((heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual(['Round 2, open', 'Round 1, past']);
    expect(again.querySelector('.record-review__closed-by')?.textContent).toContain(
      'Closed by lead1',
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

  it('offers a holder of Comment a pin, but not Close round', async () => {
    const root = await render(picture(REVIEWER));
    await answerRead([stored(pinPayload(1, 0.4, 0.4))]);
    expect(button(root, 'Add a pin')).not.toBeNull();
    expect(button(root, 'Close round 1')).toBeNull();
  });

  it('shows a reader who may not comment the pins, and no way to add one: the server still decides', async () => {
    const root = await render(picture(READER));
    await answerRead([stored(pinPayload(1, 0.4, 0.4))]);
    expect(marks(root)).toHaveLength(1);
    expect(entries(root)).toHaveLength(1);
    expect(button(root, 'Add a pin')).toBeNull();
    expect(button(root, 'Close round 1')).toBeNull();
    expect(root.querySelector('.record-review__read-only')?.textContent?.trim()).toBe(
      'You can see the pins, but not add one.',
    );
    // Nothing on the picture to click: the pointer's shortcut is not drawn for a reader.
    expect(surface(root)).toBeNull();
    expect(root.querySelector('.record-review__form')).toBeNull();
  });

  it('offers nothing on a read-only page, as the designer previews it', async () => {
    const root = await render(picture(['Everything']), true);
    await answerRead([stored(pinPayload(1, 0.4, 0.4))]);
    expect(button(root, 'Add a pin')).toBeNull();
    expect(button(root, 'Close round 1')).toBeNull();
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

  it('asks nothing again when the same record is reloaded, as after an edit', async () => {
    await render(picture(REVIEWER));
    await answerRead([]);
    await render({ ...picture(REVIEWER), lastModified: '2026-11-25T11:00:00.000Z' });
    expect(reads).toHaveLength(1);
  });
});
