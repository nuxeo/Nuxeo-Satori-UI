import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import axe from 'axe-core';
import { Subject, of, throwError, type Observable } from 'rxjs';

import {
  CaptureFilingService,
  type CaptureProgress,
  type CaptureSent,
} from '../capture-filing.service';
import { CAPTURE_OBJECT_URLS, type ObjectUrls } from '../capture-photos';
import {
  CaptureRecordsService,
  type CaptureChoice,
  type CaptureRecord,
} from '../capture-records.service';
import { PHOTO_CODEC, type PhotoCodec } from '../photo-codec';
import { jfifSegment, jpeg, phoneExif } from '../photo-fixtures.testing';
import { CapturePageComponent } from './capture-page';

const UID = '6f0c5c84-3c39-4a5e-9d7c-5c1a8e0d3003';
const OTHER = '6f0c5c84-3c39-4a5e-9d7c-5c1a8e0d3005';

const claim = (overrides: Partial<CaptureRecord> = {}): CaptureRecord => ({
  uid: UID,
  title: 'Dresser top scratched in transit',
  type: 'DamageClaim',
  number: 'DC-3003',
  capture: {
    property: 'files:files',
    findBy: ['dmg:number', 'dmg:moveNumber'],
    keepLocation: false,
  },
  writable: true,
  ...overrides,
});

const codec: PhotoCodec = {
  measure: async () => {
    throw new Error('not a picture');
  },
  draw: async (_source, drawing) =>
    new Blob([jpeg(drawing.width, drawing.height, [jfifSegment()])]),
};

const photo = (name = 'image.jpg') =>
  new File([jpeg(1200, 900, [phoneExif(1)])], name, { type: 'image/jpeg' });

/** One send the page asked for: what it sent, and the subject that answers it. */
interface Sent {
  readonly uid: string;
  readonly property: string;
  readonly file: File;
  readonly sentBefore: boolean;
  readonly progress: CaptureProgress;
  readonly answer: Subject<CaptureSent>;
}

describe('CapturePageComponent', () => {
  let harness: RouterTestingHarness;
  let sends: Sent[];
  let made: string[];
  let revoked: string[];
  const records = {
    load: vi.fn((uid: string): Observable<CaptureRecord> => of(claim({ uid }))),
    find: vi.fn((): Observable<readonly CaptureChoice[]> =>
      of([{ uid: UID, title: 'Dresser', number: 'DC-3003' }]),
    ),
  };
  const dialog = { open: vi.fn(() => ({ afterClosed: () => of(true) })) };

  beforeEach(async () => {
    sends = [];
    made = [];
    revoked = [];
    records.load.mockClear();
    records.find.mockClear();
    dialog.open.mockClear();
    let next = 0;
    const urls: ObjectUrls = {
      create: () => {
        const url = `blob:capture/${++next}`;
        made.push(url);
        return url;
      },
      revoke: (url) => revoked.push(url),
    };
    const filing = {
      send: (
        uid: string,
        property: string,
        file: File,
        sentBefore: boolean,
        progress: CaptureProgress,
      ) => {
        const answer = new Subject<CaptureSent>();
        sends.push({ uid, property, file, sentBefore, progress, answer });
        return answer.asObservable();
      },
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'capture', component: CapturePageComponent },
          { path: 'doc/:uid', children: [] },
        ]),
        { provide: CaptureRecordsService, useValue: records },
        { provide: CaptureFilingService, useValue: filing },
        { provide: PHOTO_CODEC, useValue: codec },
        { provide: CAPTURE_OBJECT_URLS, useValue: urls },
        { provide: MatDialog, useValue: dialog },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  const page = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const component = (): CapturePageComponent =>
    harness.routeDebugElement?.componentInstance as CapturePageComponent;
  const text = (selector: string): string =>
    page().querySelector(selector)?.textContent?.trim() ?? '';
  const buttons = (): HTMLButtonElement[] => [
    ...page().querySelectorAll<HTMLButtonElement>('button'),
  ];
  const button = (name: string): HTMLButtonElement | undefined =>
    buttons().find(
      (each) => (each.getAttribute('aria-label') ?? each.textContent?.trim()) === name,
    );

  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      await harness.fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
      harness.detectChanges();
    }
  }

  async function open(url = `/capture?record=${UID}`): Promise<void> {
    await harness.navigateByUrl(url);
    await settle();
  }

  async function find(code: string): Promise<void> {
    const input = page().querySelector<HTMLInputElement>('form[role="search"] input');
    if (!input) throw new Error('no find field');
    input.value = code;
    input.dispatchEvent(new Event('input'));
    page()
      .querySelector('form[role="search"]')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  }

  async function addPhotos(which: 'camera' | 'gallery', files: File[]): Promise<void> {
    const input = page().querySelector<HTMLInputElement>(`[data-capture-input="${which}"]`);
    if (!input) throw new Error(`no ${which} input`);
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
    await settle();
  }

  async function wcag22(): Promise<axe.Result[]> {
    const results = await axe.run(page(), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      // jsdom lays nothing out, so contrast cannot be measured here: the Playwright run's axe,
      // in a browser, holds it (scripts/beta-harness/steps/capture-phone.mjs).
      rules: { 'color-contrast': { enabled: false } },
    });
    return results.violations;
  }

  describe('choosing the record', () => {
    it('opens on the find form, labelled, which axe passes', async () => {
      await open('/capture');
      expect(page().querySelector('h1')?.textContent).toContain('Photograph and file');
      expect(page().querySelector('form[role="search"] label')?.textContent).toContain(
        'Number, barcode or link',
      );
      expect(records.load).not.toHaveBeenCalled();
      expect(await wcag22()).toEqual([]);
    });

    it('finds a record by a number and opens it, the address naming it', async () => {
      await open('/capture');
      await find('mv-2003');
      expect(records.find).toHaveBeenCalledWith('mv-2003');
      expect(records.load).toHaveBeenCalledWith(UID);
      expect(TestBed.inject(Router).url).toBe(`/capture?record=${UID}`);
      expect(text('[data-capture-record]')).toContain('DC-3003');
      expect(document.activeElement?.hasAttribute('data-capture-record-heading')).toBe(true);
    });

    it('opens a record from its id or a link to it, without a search', async () => {
      await open('/capture');
      await find(`https://example.test/#/doc/${OTHER}`);
      expect(records.find).not.toHaveBeenCalled();
      expect(records.load).toHaveBeenCalledWith(OTHER);
    });

    it('lists the records a number names, each chosen by a named button', async () => {
      records.find.mockReturnValueOnce(
        of([
          { uid: UID, title: 'Dresser', number: 'DC-3003' },
          { uid: OTHER, title: 'Mirror', number: 'DC-3005' },
        ]),
      );
      await open('/capture');
      await find('MV-2003');
      expect(
        page().querySelector('ul[aria-label="Records with the number MV-2003"]'),
      ).not.toBeNull();
      expect(await wcag22()).toEqual([]);
      button('Choose DC-3005')?.click();
      await settle();
      expect(records.load).toHaveBeenCalledWith(OTHER);
    });

    it('says when no record has the number, when there is none, and when it is too long', async () => {
      records.find.mockReturnValueOnce(of([]));
      await open('/capture');
      await find('XX-1');
      expect(text('[data-capture-find="none"]')).toBe('No record has the number XX-1.');
      await find('   ');
      expect(page().querySelector('[data-capture-find="empty"]')?.getAttribute('role')).toBe(
        'alert',
      );
      await find('x'.repeat(65));
      expect(page().querySelector('[data-capture-find="too-long"]')).not.toBeNull();
      expect(records.find).toHaveBeenCalledTimes(1);
    });

    it('refuses, before any photo, a record the person may not write', async () => {
      records.load.mockReturnValueOnce(of(claim({ writable: false })));
      await open();
      expect(text('[data-capture-refusal="read-only"]')).toContain(
        'You may not add files to DC-3003',
      );
      expect(page().querySelector('[data-capture-input]')).toBeNull();
      expect(button('Take a photo')).toBeUndefined();
      expect(button('File the photos')).toBeUndefined();
      expect(await wcag22()).toEqual([]);
    });

    it('refuses a record whose type takes no photos', async () => {
      records.load.mockReturnValueOnce(of(claim({ capture: null, number: null })));
      await open();
      expect(page().querySelector('[data-capture-refusal="no-capture"]')).not.toBeNull();
      expect(button('Take a photo')).toBeUndefined();
    });

    it('opens the record the address names, leaving the focus where the page put it', async () => {
      await open();
      expect(records.load).toHaveBeenCalledWith(UID);
      expect(document.activeElement?.hasAttribute('data-capture-record-heading')).toBe(false);
    });

    it('reads nothing for an address that names no record by its id', async () => {
      await open('/capture?record=..%2Fautomation%2FDocument.Delete');
      expect(records.load).not.toHaveBeenCalled();
      expect(page().querySelector('nxs-error-state')).not.toBeNull();
    });

    it('says when the record cannot be opened', async () => {
      records.load.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
      await open();
      expect(page().querySelector('nxs-error-state')).not.toBeNull();
    });
  });

  describe('the photos', () => {
    it('opens the camera through a file input that asks for it, and the gallery through another', async () => {
      await open();
      const camera = page().querySelector<HTMLInputElement>('[data-capture-input="camera"]');
      const gallery = page().querySelector<HTMLInputElement>('[data-capture-input="gallery"]');
      expect(camera?.getAttribute('capture')).toBe('environment');
      expect(camera?.accept).toBe('image/*');
      expect(camera?.multiple).toBe(false);
      expect(gallery?.multiple).toBe(true);
      expect(gallery?.hasAttribute('capture')).toBe(false);
      const clicked = vi.spyOn(camera as HTMLInputElement, 'click');
      button('Take a photo')?.click();
      expect(clicked).toHaveBeenCalled();
    });

    it('shows each photo from its own object URL, named, and removes one, revoking its URL', async () => {
      await open();
      await addPhotos('camera', [photo()]);
      await addPhotos('gallery', [
        photo('IMG_1.jpg'),
        new File(['x'], 'notes.txt', { type: 'text/plain' }),
      ]);
      const images = [...page().querySelectorAll<HTMLImageElement>('[data-capture-photo] img')];
      expect(images.map((image) => [image.alt, image.getAttribute('src')])).toEqual([
        ['Photo 1', made[0]],
        ['Photo 2', made[1]],
      ]);
      expect(text('[role="status"]')).toContain('Only pictures');
      expect(await wcag22()).toEqual([]);
      button('Remove photo 1')?.click();
      await settle();
      expect(revoked).toEqual([made[0]]);
      expect(page().querySelectorAll('[data-capture-photo]')).toHaveLength(1);
      expect(text('[role="status"]')).toBe('Photo 1 removed.');
    });

    it('revokes every object URL when the page is left', async () => {
      await open();
      await addPhotos('gallery', [photo(), photo()]);
      expect(made).toHaveLength(2);
      harness.fixture.destroy();
      expect([...revoked].sort()).toEqual([...made].sort());
    });
  });

  describe('the filing', () => {
    async function ready(count = 2): Promise<void> {
      await open();
      await addPhotos(
        'gallery',
        Array.from({ length: count }, () => photo()),
      );
    }

    it('files each photo in turn into the capture property, with its progress, then the note', async () => {
      await ready();
      component()['note'].set('Deep scratch across the top.');
      button('File the photos')?.click();
      await settle();
      expect(sends).toHaveLength(1);
      expect(sends[0]).toMatchObject({ uid: UID, property: 'files:files', sentBefore: false });
      expect(sends[0].file.name).toMatch(/^DC-3003-photo-\d{8}-\d{6}-1\.jpg$/);
      sends[0].progress.onPercent(40);
      harness.detectChanges();
      expect(text('[data-capture-photo][data-state="uploading"] [data-capture-photo-state]')).toBe(
        'Sending, 40%',
      );
      const bar = page().querySelector('mat-progress-bar');
      expect(bar?.getAttribute('aria-label')).toBe('Sending photo 1');
      expect(bar?.getAttribute('aria-valuenow')).toBe('40');
      expect(await wcag22()).toEqual([]);
      sends[0].answer.next('sent');
      sends[0].answer.complete();
      await settle();
      expect(sends).toHaveLength(2);
      sends[1].answer.next('found');
      sends[1].answer.complete();
      await settle();
      // The note goes last, as a text file naming the photos filed.
      expect(sends).toHaveLength(3);
      expect(sends[2].file.name).toMatch(/^DC-3003-note-\d{8}-\d{6}\.txt$/);
      const body = await sends[2].file.text();
      expect(body.startsWith('Deep scratch across the top.')).toBe(true);
      expect(body).toContain(sends[0].file.name);
      expect(body).toContain(sends[1].file.name);
      sends[2].answer.next('sent');
      sends[2].answer.complete();
      await settle();
      expect(text('[data-capture-done] .nxs-banner__message')).toBe(
        'Photos filed on the record: 2, with the note.',
      );
      expect(document.activeElement?.hasAttribute('data-capture-result')).toBe(true);
      expect(await wcag22()).toEqual([]);
    });

    it('shows a photo trying again, and stops on a dropped connection, offering Try again', async () => {
      await ready();
      button('File the photos')?.click();
      await settle();
      sends[0].progress.onRetry(1);
      harness.detectChanges();
      expect(text('[data-capture-photo][data-state="retrying"] [data-capture-photo-state]')).toBe(
        'The connection dropped. Trying again',
      );
      expect(button('Remove photo 1')).toBeUndefined();
      sends[0].answer.error(new HttpErrorResponse({ status: 0 }));
      await settle();
      expect(sends).toHaveLength(1);
      expect(page().querySelector('[data-capture-stopped="connection"]')).not.toBeNull();
      // The second photo never had its turn: ready again, not failed.
      expect(
        [...page().querySelectorAll('[data-capture-photo]')].map((each) =>
          each.getAttribute('data-state'),
        ),
      ).toEqual(['failed', 'ready']);
      button('Try again')?.click();
      await settle();
      expect(sends).toHaveLength(2);
      // A request carried the first one: the service asks the record before it sends it again.
      expect(sends[1].sentBefore).toBe(true);
      expect(sends[1].file).toBe(sends[0].file);
    });

    it('stops on a 403, saying the person may not add files, and sends nothing more', async () => {
      await ready();
      button('File the photos')?.click();
      await settle();
      sends[0].answer.error(new HttpErrorResponse({ status: 403 }));
      await settle();
      expect(sends).toHaveLength(1);
      expect(text('[data-capture-stopped="forbidden"]')).toContain(
        'You may not add files to this record',
      );
      expect(text('[data-capture-photo][data-state="failed"] [data-capture-photo-state]')).toBe(
        'Not filed: you may not add files to this record.',
      );
      expect(button('Try again')).toBeUndefined();
      expect(await wcag22()).toEqual([]);
    });

    it('goes on past a photo the server refuses, and says which were not filed', async () => {
      await ready();
      button('File the photos')?.click();
      await settle();
      sends[0].answer.error(new HttpErrorResponse({ status: 413 }));
      await settle();
      expect(sends).toHaveLength(2);
      sends[1].answer.next('sent');
      sends[1].answer.complete();
      await settle();
      expect(text('[data-capture-partly]')).toContain('Photos not filed: 1.');
      expect(text('[data-capture-photo][data-state="failed"] [data-capture-photo-state]')).toBe(
        'Not filed: the server does not take a file this large.',
      );
      // Refused for its size: not filed again by another press.
      expect(button('File the photos')?.disabled).toBe(true);
    });

    it('asks before leaving with photos not filed, and not otherwise', async () => {
      await open();
      let left: boolean | undefined;
      component()
        .leave()
        .subscribe((answer) => (left = answer));
      expect(left).toBe(true);
      expect(dialog.open).not.toHaveBeenCalled();
      await addPhotos('gallery', [photo()]);
      component()
        .leave()
        .subscribe((answer) => (left = answer));
      expect(dialog.open).toHaveBeenCalledTimes(1);
    });
  });
});
