import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import {
  DocumentDetailService,
  type AssetRightsExplanation,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, throwError, type Observable } from 'rxjs';

import {
  RecordPictureViewsComponent,
  firstPictureView,
  readPictureViews,
  rightsRefusal,
} from './record-picture-views';

/** A view as Nuxeo 2025 writes one in `picture:views`, its file's `data` the server's address. */
function view(title: string, width: number, height: number, digest = `${title}-1`) {
  return {
    title,
    width,
    height,
    description: `${title} size`,
    content: {
      name: `${title}_jacket.jpg`,
      'mime-type': 'image/jpeg',
      digest,
      length: '12345',
      data: `http://localhost:8080/nuxeo/nxfile/default/p1/picture:views/0/content/${title}_jacket.jpg`,
    },
  };
}

function picture(views: unknown, uid = 'p1'): NuxeoDocument {
  return {
    uid,
    title: 'Trail jacket, front',
    type: 'Picture',
    path: `/assets/${uid}`,
    lastModified: '2026-11-24T00:00:00.000Z',
    properties: { 'picture:views': views },
  };
}

const VIEWS = [
  view('Thumbnail', 150, 100),
  view('Small', 280, 187),
  view('Medium', 1000, 667),
  view('FullHD', 1920, 1280),
];

describe('readPictureViews', () => {
  it('reads each view with its place, title, size and format, in the order Nuxeo lists them', () => {
    expect(readPictureViews(picture(VIEWS.slice(0, 2)))).toEqual([
      {
        index: 0,
        title: 'Thumbnail',
        width: 150,
        height: 100,
        format: 'JPEG',
        key: 'p1/0/Thumbnail-1',
      },
      { index: 1, title: 'Small', width: 280, height: 187, format: 'JPEG', key: 'p1/1/Small-1' },
    ]);
  });

  it('leaves out a view with no file, and keeps the place of the others', () => {
    const pending = { title: 'FullHD', width: 1920, height: 1280, content: null };
    expect(readPictureViews(picture([pending, VIEWS[2]])).map((each) => each.index)).toEqual([1]);
  });

  it('names a view with no title by its place, and shows no size or format Nuxeo does not give', () => {
    const odd = { width: '0', height: 'tall', content: { 'mime-type': 'text/html' } };
    expect(readPictureViews(picture([odd]))).toEqual([
      { index: 0, title: 'View 1', width: null, height: null, format: null, key: 'p1/0/' },
    ]);
  });

  it('reads no views from a record without them', () => {
    expect(readPictureViews(picture(undefined))).toEqual([]);
    expect(readPictureViews(picture({ title: 'Medium' }))).toEqual([]);
  });

  it('shows Medium first, then Small, FullHD and OriginalJpeg, and else the first view', () => {
    const first = (titles: string[]) =>
      firstPictureView(readPictureViews(picture(titles.map((title) => view(title, 10, 10)))))
        ?.title;
    expect(first(['Thumbnail', 'Small', 'Medium', 'FullHD'])).toBe('Medium');
    expect(first(['Thumbnail', 'FullHD', 'Small'])).toBe('Small');
    expect(first(['Thumbnail', 'OriginalJpeg'])).toBe('OriginalJpeg');
    expect(first(['Thumbnail', 'Square'])).toBe('Thumbnail');
    expect(first([])).toBeUndefined();
  });
});

/** What the server's `assetRights` enricher says of asset 503: no Print channel among its rights. */
function noPrintRights(): AssetRightsExplanation {
  const refused = {
    allowed: false,
    reason: 'channel-not-covered',
    channel: 'Print',
    rightsEnd: null,
  } as const;
  return {
    type: 'AcmeAsset',
    today: '2026-11-24',
    rightsEnd: '2026-12-14',
    channels: ['E-commerce', 'Social'],
    uses: [
      { kind: 'original', name: null, ...refused },
      {
        kind: 'view',
        name: 'Medium',
        allowed: true,
        reason: 'preview',
        channel: null,
        rightsEnd: null,
      },
      {
        kind: 'view',
        name: 'FullHD',
        allowed: true,
        reason: 'cleared',
        channel: 'E-commerce',
        rightsEnd: null,
      },
      { kind: 'view', name: 'OriginalJpeg', ...refused },
    ],
    otherwise: { allowed: false, reason: 'not-cleared', channel: null, rightsEnd: null },
  };
}

describe('rightsRefusal', () => {
  const decision = (reason: string, extra: { channel?: string; rightsEnd?: string } = {}) =>
    ({
      allowed: reason === 'cleared' || reason === 'preview',
      reason,
      channel: extra.channel ?? null,
      rightsEnd: extra.rightsEnd ?? null,
    }) as Parameters<typeof rightsRefusal>[0];

  it('says nothing of a use the rights serve: a 403 then is not theirs', () => {
    expect(rightsRefusal(decision('cleared', { channel: 'Print' }), ['Print'], 'en-US')).toBeNull();
    expect(rightsRefusal(decision('preview'), [], 'en-US')).toBeNull();
  });

  it('names the channel that covers the view and the channels the rights cover', () => {
    const print = decision('channel-not-covered', { channel: 'Print' });
    expect(rightsRefusal(print, ['E-commerce', 'Social'], 'en-US')).toEqual({
      reason: 'channel-not-covered',
      key: 'document-layouts.rights.refused.channel-not-covered',
      params: { channel: 'Print', channels: 'E-commerce and Social' },
    });
    expect(rightsRefusal(print, [], 'en-US')?.key).toBe(
      'document-layouts.rights.refused.channel-not-covered-none',
    );
    expect(rightsRefusal(print, null, 'en-US')).toEqual({
      reason: 'channel-not-covered',
      key: 'document-layouts.rights.refused.channel-not-covered-unnamed',
      params: { channel: 'Print' },
    });
  });

  it("says the day the rights ended, the server's day, in the reader's language", () => {
    expect(
      rightsRefusal(decision('rights-ended', { rightsEnd: '2026-11-14' }), [], 'en-US'),
    ).toEqual({
      reason: 'rights-ended',
      key: 'document-layouts.rights.refused.rights-ended',
      params: { end: 'November 14, 2026' },
    });
    expect(rightsRefusal(decision('rights-ended'), [], 'en-US')?.key).toBe(
      'document-layouts.rights.refused.rights-ended-undated',
    );
    expect(rightsRefusal(decision('rights-ended', { rightsEnd: 'soon' }), [], 'en-US')?.key).toBe(
      'document-layouts.rights.refused.rights-ended-undated',
    );
  });

  it("says the same reasons of a video's file in a video's words", () => {
    const print = decision('channel-not-covered', { channel: 'Print' });
    expect(rightsRefusal(print, ['Social'], 'en-US', 'video')).toEqual({
      reason: 'channel-not-covered',
      key: 'document-layouts.rights.refused-video.channel-not-covered',
      params: { channel: 'Print', channels: 'Social' },
    });
    expect(rightsRefusal(decision('rights-ended'), [], 'en-US', 'video')?.key).toBe(
      'document-layouts.rights.refused-video.rights-ended-undated',
    );
    expect(rightsRefusal(decision('cleared'), [], 'en-US', 'video')).toBeNull();
  });

  it('has its own words for a use served only watermarked, and one that cannot be marked', () => {
    expect(rightsRefusal(decision('watermark-required'), [], 'en-US')?.key).toBe(
      'document-layouts.rights.refused.watermark-required',
    );
    expect(rightsRefusal(decision('watermark-unavailable'), [], 'en-US', 'video')).toEqual({
      reason: 'watermark-unavailable',
      key: 'document-layouts.rights.refused-video.watermark-unavailable',
      params: {},
    });
  });

  it('has its own words for a use no rights clear and for rights the server could not read', () => {
    expect(rightsRefusal(decision('not-cleared'), [], 'en-US')?.key).toBe(
      'document-layouts.rights.refused.not-cleared',
    );
    expect(rightsRefusal(decision('policy-error'), [], 'en-US')?.key).toBe(
      'document-layouts.rights.refused.policy-error',
    );
  });
});

describe('RecordPictureViewsComponent', () => {
  let fixture: ComponentFixture<RecordPictureViewsComponent> | null;
  let fetchBlobByXpath: ReturnType<typeof vi.fn>;
  let fetchAssetRights: ReturnType<typeof vi.fn>;
  /** `Asset.GetWatermarked`: each request's answer, in the order asked. */
  let fetchWatermarked: ReturnType<typeof vi.fn>;
  let marked: { uid: string; use: string; answer: Subject<Blob> }[];
  /** What the server says why, when asked. */
  let rightsAnswer: Observable<AssetRightsExplanation | null>;
  /** Each request's answer, by `<uid> <xpath>`, in the order asked. */
  let requests: { key: string; answer: Subject<Blob> }[];
  let created: string[];
  let revoked: string[];

  beforeEach(() => {
    fixture = null;
    requests = [];
    created = [];
    revoked = [];
    let counter = 0;
    // jsdom implements neither, so they are installed rather than spied on, and removed after.
    Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        const url = `blob:view-${++counter}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    });
    fetchBlobByXpath = vi.fn((uid: string, xpath: string): Observable<Blob> => {
      const answer = new Subject<Blob>();
      requests.push({ key: `${uid} ${xpath}`, answer });
      return answer;
    });
    rightsAnswer = of(noPrintRights());
    fetchAssetRights = vi.fn(() => rightsAnswer);
    marked = [];
    fetchWatermarked = vi.fn((uid: string, use: string): Observable<Blob> => {
      const answer = new Subject<Blob>();
      marked.push({ uid, use, answer });
      return answer;
    });
    TestBed.configureTestingModule({
      imports: [RecordPictureViewsComponent, MatIconTestingModule],
      providers: [
        {
          provide: DocumentDetailService,
          useValue: { fetchBlobByXpath, fetchAssetRights, fetchWatermarked },
        },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
  });

  async function render(document: NuxeoDocument): Promise<HTMLElement> {
    fixture ??= TestBed.createComponent(RecordPictureViewsComponent);
    fixture.componentRef.setInput('document', document);
    return settle();
  }

  async function settle(): Promise<HTMLElement> {
    const shown = fixture as ComponentFixture<RecordPictureViewsComponent>;
    shown.detectChanges();
    await shown.whenStable();
    shown.detectChanges();
    return shown.nativeElement as HTMLElement;
  }

  async function answer(index: number): Promise<void> {
    requests[index].answer.next(new Blob(['jpeg'], { type: 'image/jpeg' }));
    requests[index].answer.complete();
    await settle();
  }

  const image = (root: HTMLElement) => root.querySelector<HTMLImageElement>('img');
  const button = (root: HTMLElement, title: string) =>
    root.querySelector<HTMLButtonElement>(`.record-picture__view[data-view="${title}"]`);

  it('fetches the view shown first through the service, by its place, and shows it from a blob URL', async () => {
    const root = await render(picture(VIEWS));
    expect(fetchBlobByXpath).toHaveBeenCalledTimes(1);
    expect(fetchBlobByXpath).toHaveBeenCalledWith('p1', 'picture:views/2/content');
    expect(image(root)).toBeNull();
    expect(root.querySelector('nxs-spinner')).not.toBeNull();

    await answer(0);
    expect(image(root)?.getAttribute('src')).toBe('blob:view-1');
    expect(image(root)?.getAttribute('alt')).toBe('Trail jacket, front, Medium view');
    expect(root.querySelector('figcaption')?.textContent?.trim()).toBe(
      'Medium · 1000 × 667 · JPEG',
    );
  });

  it('never binds a Nuxeo address to the image', async () => {
    const root = await render(picture(VIEWS));
    await answer(0);
    for (const img of Array.from(root.querySelectorAll('img')))
      expect(img.getAttribute('src')).toMatch(/^blob:/);
    expect(root.innerHTML).not.toContain('nxfile');
  });

  it('offers a button per view, says which is shown, and fetches another when it is chosen', async () => {
    const root = await render(picture(VIEWS));
    await answer(0);
    expect(
      Array.from(root.querySelectorAll('.record-picture__view')).map((each) =>
        each.getAttribute('aria-pressed'),
      ),
    ).toEqual(['false', 'false', 'true', 'false']);

    button(root, 'FullHD')?.click();
    await settle();
    expect(fetchBlobByXpath).toHaveBeenLastCalledWith('p1', 'picture:views/3/content');
    expect(button(root, 'FullHD')?.getAttribute('aria-pressed')).toBe('true');
    // The Medium view is not shown while the FullHD one loads.
    expect(image(root)).toBeNull();
    await answer(1);
    expect(image(root)?.getAttribute('src')).toBe('blob:view-2');
  });

  it('shows a view fetched before from its blob URL, without asking again', async () => {
    const root = await render(picture(VIEWS));
    await answer(0);
    button(root, 'Small')?.click();
    await settle();
    await answer(1);
    button(root, 'Medium')?.click();
    await settle();
    expect(fetchBlobByXpath).toHaveBeenCalledTimes(2);
    expect(image(root)?.getAttribute('src')).toBe('blob:view-1');
    expect(revoked).toEqual([]);
  });

  it('asks nothing again when the record is reloaded with the same views', async () => {
    const root = await render(picture(VIEWS));
    await answer(0);
    await render({ ...picture(VIEWS), lastModified: '2026-11-24T10:00:00.000Z' });
    expect(fetchBlobByXpath).toHaveBeenCalledTimes(1);
    expect(image(root)?.getAttribute('src')).toBe('blob:view-1');
  });

  it("revokes the URLs of another record's views, and of a replaced picture's", async () => {
    await render(picture(VIEWS));
    await answer(0);
    // The picture replaced: its views have new files, so new digests.
    const replaced = VIEWS.map((each) => view(each.title, each.width, each.height, 'new'));
    await render(picture(replaced));
    expect(revoked).toEqual(['blob:view-1']);
    expect(fetchBlobByXpath).toHaveBeenCalledTimes(2);
    await answer(1);
    await render(picture(VIEWS, 'p2'));
    expect(revoked).toEqual(['blob:view-1', 'blob:view-2']);
    expect(fetchBlobByXpath).toHaveBeenLastCalledWith('p2', 'picture:views/2/content');
  });

  it('revokes every URL it created when it is destroyed', async () => {
    const root = await render(picture(VIEWS));
    await answer(0);
    button(root, 'Small')?.click();
    await settle();
    await answer(1);
    fixture?.destroy();
    expect(created).toEqual(['blob:view-1', 'blob:view-2']);
    expect([...revoked].sort()).toEqual(['blob:view-1', 'blob:view-2']);
  });

  it('creates no URL for a view whose answer comes after another is chosen', async () => {
    const root = await render(picture(VIEWS));
    button(root, 'Small')?.click();
    await settle();
    expect(requests[0].answer.observed).toBe(false);
    await answer(1);
    expect(created).toEqual(['blob:view-1']);
    expect(image(root)?.getAttribute('src')).toBe('blob:view-1');
  });

  it('says when a view cannot be loaded, and asks again on Retry', async () => {
    const root = await render(picture(VIEWS));
    requests[0].answer.error({ status: 503 });
    await settle();
    expect(root.querySelector('nxs-error-state')).not.toBeNull();
    expect(image(root)).toBeNull();

    root.querySelector<HTMLButtonElement>('nxs-error-state button')?.click();
    await settle();
    expect(fetchBlobByXpath).toHaveBeenCalledTimes(2);
    await answer(1);
    expect(image(root)?.getAttribute('src')).toBe('blob:view-1');
  });

  it('says the views are not ready on a picture that has none yet, and asks nothing', async () => {
    const root = await render(picture([]));
    expect(root.querySelector('nxs-empty-state')).not.toBeNull();
    expect(fetchBlobByXpath).not.toHaveBeenCalled();
  });

  it('offers no buttons for a picture with one view', async () => {
    const root = await render(picture([VIEWS[0]]));
    expect(root.querySelector('.record-picture__views')).toBeNull();
    expect(fetchBlobByXpath).toHaveBeenCalledWith('p1', 'picture:views/0/content');
  });

  describe('a view the server refuses', () => {
    const WITH_PRINT = [...VIEWS, view('OriginalJpeg', 6000, 7500)];
    const refusalOf = (root: HTMLElement) => root.querySelector('nxs-banner[data-refusal]');

    /** Render the asset, choose its print view, and have the server answer it with `error`. */
    async function refusePrintView(error: unknown): Promise<HTMLElement> {
      const root = await render(picture(WITH_PRINT));
      await answer(0);
      button(root, 'OriginalJpeg')?.click();
      await settle();
      expect(fetchBlobByXpath).toHaveBeenLastCalledWith('p1', 'picture:views/4/content');
      requests[1].answer.error(error);
      return settle();
    }

    it("says the server's own reason, asked of the server after its 403", async () => {
      const root = await refusePrintView({ status: 403 });

      expect(fetchAssetRights).toHaveBeenCalledTimes(1);
      expect(fetchAssetRights).toHaveBeenCalledWith('p1');
      expect(refusalOf(root)?.getAttribute('data-refusal')).toBe('channel-not-covered');
      expect(refusalOf(root)?.textContent).toContain(
        "The server refused this view: it is covered by the Print channel, and this asset's rights cover E-commerce and Social only.",
      );
      expect(image(root)).toBeNull();
      expect(root.querySelector('nxs-error-state')).toBeNull();
    });

    /** The refusal is the server's: every view is still offered, and each one asked for. */
    it('hides no view and disables none, and the next one chosen is asked for', async () => {
      const root = await refusePrintView({ status: 403 });

      const print = button(root, 'OriginalJpeg');
      expect(print).not.toBeNull();
      expect(print?.disabled).toBe(false);
      expect(root.querySelectorAll('.record-picture__view')).toHaveLength(WITH_PRINT.length);

      button(root, 'FullHD')?.click();
      await settle();
      expect(fetchBlobByXpath).toHaveBeenLastCalledWith('p1', 'picture:views/3/content');
      await answer(2);
      expect(image(root)?.getAttribute('src')).toBe('blob:view-2');
      expect(refusalOf(root)).toBeNull();
    });

    it('asks again, and asks why again, when the refused view is chosen again', async () => {
      const root = await refusePrintView({ status: 403 });
      button(root, 'Medium')?.click();
      await settle();
      button(root, 'OriginalJpeg')?.click();
      await settle();

      expect(fetchBlobByXpath).toHaveBeenCalledTimes(3);
      requests[2].answer.error({ status: 403 });
      await settle();
      expect(fetchAssetRights).toHaveBeenCalledTimes(2);
    });

    it('says the day the rights ended when that is the reason', async () => {
      const ended = noPrintRights();
      rightsAnswer = of({
        ...ended,
        uses: ended.uses.map((use) =>
          use.name === 'OriginalJpeg'
            ? { ...use, reason: 'rights-ended' as const, rightsEnd: '2026-11-14' }
            : use,
        ),
      });
      const root = await refusePrintView({ status: 403 });

      expect(refusalOf(root)?.textContent).toContain(
        'the rights to this asset ended on November 14, 2026',
      );
    });

    it('says the reason for any view the rights do not list', async () => {
      const unlisted = noPrintRights();
      rightsAnswer = of({
        ...unlisted,
        uses: unlisted.uses.filter((use) => use.name !== 'OriginalJpeg'),
      });
      const root = await refusePrintView({ status: 403 });

      expect(refusalOf(root)?.getAttribute('data-refusal')).toBe('not-cleared');
    });

    it('shows a 403 the rights do not explain as any 403: no add-on', async () => {
      rightsAnswer = of(null);
      const root = await refusePrintView({ status: 403 });

      expect(refusalOf(root)).toBeNull();
      expect(root.querySelector('nxs-error-state')?.getAttribute('data-status')).toBe('403');
    });

    it('shows a 403 the rights do not explain as any 403: rights that serve the view', async () => {
      const served = noPrintRights();
      rightsAnswer = of({
        ...served,
        uses: served.uses.map((use) =>
          use.name === 'OriginalJpeg' ? { ...use, allowed: true, reason: 'cleared' as const } : use,
        ),
      });
      const root = await refusePrintView({ status: 403 });

      expect(refusalOf(root)).toBeNull();
      expect(root.querySelector('nxs-error-state')?.getAttribute('data-status')).toBe('403');
    });

    it('shows the 403 as it is when the server cannot be asked why', async () => {
      rightsAnswer = throwError(() => ({ status: 500 }));
      const root = await refusePrintView({ status: 403 });

      expect(refusalOf(root)).toBeNull();
      expect(root.querySelector('nxs-error-state')?.getAttribute('data-status')).toBe('403');
    });

    it('asks why only after a 403', async () => {
      const root = await refusePrintView({ status: 503 });

      expect(fetchAssetRights).not.toHaveBeenCalled();
      expect(root.querySelector('nxs-error-state')?.getAttribute('data-status')).toBe('500');
    });

    it('asks for no marked view when the rights refuse it for another reason', async () => {
      await refusePrintView({ status: 403 });

      expect(fetchWatermarked).not.toHaveBeenCalled();
    });
  });

  describe('a view the server serves only watermarked', () => {
    const WITH_PRINT = [...VIEWS, view('OriginalJpeg', 6000, 7500)];
    const note = (root: HTMLElement) => root.querySelector('.record-picture__watermarked');

    function markedRights(): AssetRightsExplanation {
      const rights = noPrintRights();
      return {
        ...rights,
        uses: rights.uses.map((use) =>
          use.name === 'OriginalJpeg'
            ? { ...use, reason: 'watermark-required' as const, channel: 'Print' }
            : use,
        ),
      };
    }

    /** Render the asset, choose its print view, and have the server refuse it unmarked. */
    async function refuseUnmarked(): Promise<HTMLElement> {
      rightsAnswer = of(markedRights());
      const root = await render(picture(WITH_PRINT));
      await answer(0);
      button(root, 'OriginalJpeg')?.click();
      await settle();
      requests[1].answer.error({ status: 403 });
      return settle();
    }

    it('asks the server for it marked, by its title, after its 403 and its reason, and shows it so', async () => {
      const root = await refuseUnmarked();

      expect(fetchAssetRights).toHaveBeenCalledWith('p1');
      expect(fetchWatermarked).toHaveBeenCalledTimes(1);
      expect(fetchWatermarked).toHaveBeenCalledWith('p1', 'view:OriginalJpeg');
      marked[0].answer.next(new Blob(['marked'], { type: 'image/jpeg' }));
      marked[0].answer.complete();
      await settle();

      expect(image(root)?.getAttribute('src')).toBe('blob:view-2');
      expect(note(root)?.textContent?.trim()).toBe(
        "Watermarked for you: this asset's rights require it.",
      );
      expect(root.querySelector('nxs-banner[data-refusal]')).toBeNull();
      // Another view, served as it is, says nothing of a watermark.
      button(root, 'Medium')?.click();
      await settle();
      expect(note(root)).toBeNull();
      // Shown again from its blob URL, it still says so.
      button(root, 'OriginalJpeg')?.click();
      await settle();
      expect(image(root)?.getAttribute('src')).toBe('blob:view-2');
      expect(note(root)).not.toBeNull();
    });

    it('revokes the marked view when it is destroyed, as any other', async () => {
      await refuseUnmarked();
      marked[0].answer.next(new Blob(['marked'], { type: 'image/jpeg' }));
      marked[0].answer.complete();
      await settle();
      fixture?.destroy();
      fixture = null;
      expect(revoked).toEqual(expect.arrayContaining(['blob:view-1', 'blob:view-2']));
    });

    it("says a mark the server could not draw as the rights' own reason", async () => {
      const root = await refuseUnmarked();
      marked[0].answer.error({ status: 409 });
      await settle();

      expect(root.querySelector('nxs-banner[data-refusal]')?.getAttribute('data-refusal')).toBe(
        'watermark-unavailable',
      );
      expect(image(root)).toBeNull();
    });

    it('says any other refusal of the marked view as its status', async () => {
      const root = await refuseUnmarked();
      marked[0].answer.error({ status: 403 });
      await settle();

      expect(root.querySelector('nxs-banner[data-refusal]')).toBeNull();
      expect(root.querySelector('nxs-error-state')?.getAttribute('data-status')).toBe('403');
      expect(note(root)).toBeNull();
    });
  });
});
