import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import type { SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DocumentViewerComponent,
  type ExifData,
  type IptcData,
  type PictureInfo,
  type StoryboardItem,
  type VideoInfo,
  type VideoSource,
} from './document-viewer.component';

/**
 * The MIME dispatch table, the metadata cards and the image-toolbar state.
 *
 * `document-viewer.component.spec.ts` covers the video/storyboard path against the real template;
 * this file covers `contentType()` and the rest of the class. The template is replaced with
 * `<div></div>` here on purpose: none of these assertions read the DOM, and rendering the real
 * template drags in `<video>`/`<iframe>` elements that jsdom only partly implements — which is
 * how a test ends up passing while an unhandled `HTMLMediaElement` error is logged beside it.
 */

/**
 * `SafeResourceUrl` and `SafeHtml` are opaque marker interfaces. Angular's own DomSanitizer
 * returns objects that satisfy them, so a test-local value has to be produced somehow; these two
 * helpers are the only place it happens, rather than an `as never` at every call site.
 *
 * `bypassSecurityTrustResourceUrl` is deliberately NOT used: it needs a sanitizer instance and it
 * is the function whose misuse this repo audits for. These values are never fed to a real DOM
 * binding — the template is stubbed out — so a plain marker object is both sufficient and inert.
 */
function safeUrl(value: string): SafeResourceUrl {
  return { toString: () => value } as SafeResourceUrl;
}

function safeHtml(value: string): SafeHtml {
  return { toString: () => value } as SafeHtml;
}

function videoSource(overrides: Partial<VideoSource> = {}): VideoSource {
  // `url` is a plain string, not a `SafeResourceUrl`: it is bound to `<source [src]>`, which is
  // `SecurityContext.NONE`, where a `Safe*` value is never unwrapped and stringifies instead.
  return { url: 'blob:video', mimeType: 'video/mp4', label: 'MP4 480p', ...overrides };
}

function storyboardItem(overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return { timecode: 5, thumbnailUrl: 'blob:thumb', label: '0:05', ...overrides };
}

function pictureInfo(overrides: Partial<PictureInfo> = {}): PictureInfo {
  return {
    width: 1920,
    height: 1080,
    format: 'JPEG',
    colorSpace: 'sRGB',
    depth: 8,
    weight: '1.2 MB',
    ...overrides,
  };
}

function videoInfo(overrides: Partial<VideoInfo> = {}): VideoInfo {
  return {
    duration: 3725,
    width: 1920,
    height: 1080,
    format: 'MP4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    frameRate: 25,
    ...overrides,
  };
}

/** Entries as the card renders them: each label key resolved against the real English catalogue. */
function rendered(
  entries: { labelKey: string; value: string }[],
): { label: string; value: string }[] {
  const translate = TestBed.inject(TranslateService);
  return entries.map(({ labelKey, value }) => ({ label: translate.instant(labelKey), value }));
}

describe('DocumentViewerComponent — MIME dispatch and viewer state', () => {
  let fixture: ComponentFixture<DocumentViewerComponent>;
  let component: DocumentViewerComponent;

  /** Every input the dispatch logic reads, so each test states its whole world explicitly. */
  interface ViewerInputs {
    mimeType: string;
    fileName: string;
    blobUrl: SafeResourceUrl | null;
    rawBlobUrl: string | null;
    blobType: string;
    posterUrl: string | null;
    previewUrl: SafeResourceUrl | null;
    noteContent: string | null;
    noteHtml: SafeHtml | null;
    videoSources: VideoSource[];
    storyboard: StoryboardItem[];
    hasPdfRendition: boolean;
    annotationsTab: boolean;
    arenderUrl: SafeResourceUrl | null;
    pictureInfo: PictureInfo | null;
    videoInfo: VideoInfo | null;
    exifData: ExifData | null;
    iptcData: IptcData | null;
  }

  const defaults: ViewerInputs = {
    mimeType: '',
    fileName: '',
    blobUrl: null,
    // Defaults to PDF because most dispatch cases here exercise a blob-backed branch, and the served
    // type now gates those. Cases about the mismatch itself override it.
    blobType: 'application/pdf',
    rawBlobUrl: null,
    posterUrl: null,
    previewUrl: null,
    noteContent: null,
    noteHtml: null,
    videoSources: [],
    storyboard: [],
    hasPdfRendition: false,
    annotationsTab: false,
    arenderUrl: null,
    pictureInfo: null,
    videoInfo: null,
    exifData: null,
    iptcData: null,
  };

  /**
   * Sets every input, not only the overridden ones. Setting a subset leaves the previous test's
   * value in place for the rest, and the dispatch order means one stale `blobUrl` silently
   * changes which branch a later case takes.
   */
  function setInputs(overrides: Partial<ViewerInputs> = {}): void {
    const inputs: ViewerInputs = { ...defaults, ...overrides };
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentViewerComponent],
      providers: [provideZonelessChangeDetection()],
    })
      .overrideComponent(DocumentViewerComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DocumentViewerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  describe('note content takes priority over the blob dispatch', () => {
    it('renders markdown notes as markdown', () => {
      setInputs({ mimeType: 'text/markdown', noteContent: '# Title' });
      expect(component.contentType()).toBe('markdown');
    });

    it('renders html notes as html, from noteHtml alone', () => {
      // `noteContent` stays null: the guard is `noteContent !== null || noteHtml !== null`, and a
      // note whose only representation is sanitised HTML must still reach the html branch.
      setInputs({ mimeType: 'text/html', noteHtml: safeHtml('<p>hi</p>') });
      expect(component.contentType()).toBe('html');
    });

    it('renders xml notes as xml, for both xml MIME spellings', () => {
      setInputs({ mimeType: 'text/xml', noteContent: '<a/>' });
      expect(component.contentType()).toBe('xml');

      setInputs({ mimeType: 'application/xml', noteContent: '<a/>' });
      expect(component.contentType()).toBe('xml');
    });

    it('renders any other text/* note as plain text', () => {
      setInputs({ mimeType: 'text/csv', noteContent: 'a,b' });
      expect(component.contentType()).toBe('text');
    });

    it('falls through to the blob dispatch when a note carries a non-text MIME type', () => {
      // A note with `application/pdf` matches none of the four note branches, so control has to
      // reach the ordinary dispatch below rather than defaulting to text.
      setInputs({
        mimeType: 'application/pdf',
        noteContent: 'not really text',
        blobUrl: safeUrl('blob:doc'),
      });
      expect(component.contentType()).toBe('pdf');
    });

    it('shows a note with no blob at all as text', () => {
      // No blobUrl, no previewUrl, no videoSources: the early "nothing to show" guard is reached,
      // and a note still has content to render, so it must not fall through to 'none'.
      setInputs({ mimeType: 'application/octet-stream', noteContent: 'plain body' });
      expect(component.contentType()).toBe('text');
    });

    it('shows nothing when there is neither a note nor anything to load', () => {
      setInputs({ mimeType: 'application/pdf' });
      expect(component.contentType()).toBe('none');
    });
  });

  describe('MIME dispatch, in the documented priority order', () => {
    const blobUrl = safeUrl('blob:doc');
    const previewUrl = safeUrl('/nuxeo/preview');

    it('dispatches image, video and audio by MIME family', () => {
      setInputs({ mimeType: 'image/png', blobUrl });
      expect(component.contentType()).toBe('image');

      setInputs({ mimeType: 'video/quicktime', blobUrl });
      expect(component.contentType()).toBe('video');

      setInputs({ mimeType: 'audio/mpeg', blobUrl });
      expect(component.contentType()).toBe('audio');
    });

    it('treats the broadcast container MIME types as video', () => {
      // `application/gxf` and `application/mxf` are Web UI parity: professional video containers
      // that are not `video/*` and would otherwise land on the pdf/iframe fallback.
      setInputs({ mimeType: 'application/mxf', blobUrl });
      expect(component.contentType()).toBe('video');

      setInputs({ mimeType: 'application/gxf', blobUrl });
      expect(component.contentType()).toBe('video');
    });

    it('dispatches the text family, including json', () => {
      setInputs({ mimeType: 'text/markdown', blobUrl });
      expect(component.contentType()).toBe('markdown');

      setInputs({ mimeType: 'text/html', blobUrl });
      expect(component.contentType()).toBe('html');

      setInputs({ mimeType: 'application/xml', blobUrl });
      expect(component.contentType()).toBe('xml');

      setInputs({ mimeType: 'text/plain', blobUrl });
      expect(component.contentType()).toBe('text');

      setInputs({ mimeType: 'application/json', blobUrl });
      expect(component.contentType()).toBe('text');
    });

    it('dispatches a native pdf', () => {
      setInputs({ mimeType: 'application/pdf', blobUrl });
      expect(component.contentType()).toBe('pdf');
    });

    it('uses the server pdf rendition for an office document that has one', () => {
      setInputs({
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        blobUrl,
        hasPdfRendition: true,
      });
      expect(component.contentType()).toBe('pdfRendition');
    });

    it('prefers the pdf rendition over the preview URL when both are available', () => {
      // Order matters: the rendition is a real PDF of the document, the preview URL is a
      // server-side HTML conversion. Reversing these downgrades every office document.
      setInputs({
        mimeType: 'application/vnd.ms-excel',
        blobUrl,
        hasPdfRendition: true,
        previewUrl: safeUrl('/nuxeo/preview'),
      });
      expect(component.contentType()).toBe('pdfRendition');
    });

    it('falls back to the preview URL when there is no rendition', () => {
      setInputs({
        mimeType: 'application/vnd.ms-excel',
        previewUrl: safeUrl('/nuxeo/preview'),
        hasPdfRendition: true, // ignored: `pdfRendition` also requires a blobUrl, and there is none
      });
      expect(component.contentType()).toBe('preview');
    });

    it('guesses an image from the file extension when the MIME type is unhelpful', () => {
      // Nuxeo stores `application/octet-stream` for blobs uploaded without a detected type.
      for (const fileName of ['photo.PNG', 'scan.jpeg', 'logo.svg', 'plan.tif']) {
        setInputs({ mimeType: 'application/octet-stream', fileName, blobUrl });
        expect(component.contentType(), fileName).toBe('image');
      }
    });

    it('treats an unrecognised blob without an image extension as a pdf', () => {
      setInputs({ mimeType: 'application/octet-stream', fileName: 'archive.bin', blobUrl });
      expect(component.contentType()).toBe('pdf');
    });

    /**
     * The served-type gate on the iframe branches.
     *
     * `contentType()` chose `'pdf'`/`'pdfRendition'` from `mimeType`, `hasPdfRendition` and a
     * filename-extension fallback — all metadata. The browser parses a `blob:` document by its
     * `Content-Type`, and a blob URL inherits this origin, so a document recorded as PDF but served
     * as `text/html` executed as script in an unsandboxed same-origin iframe. Each case here is a
     * served type that must NOT reach one; the cases above are the positive controls, since they all
     * run with `blobType: 'application/pdf'`.
     */
    /**
     * The server-rendered preview is a fallback, so it has to be reachable for a document whose MIME
     * type is recognised. `loadPreviewFallback` sets only `previewUrl`; `blobUrl` and `blobType` stay
     * empty. With the branches ordered by MIME first, each recognised type reached its own branch and
     * shadowed the fallback — rendering an iframe or `<img>` bound to a null URL before the served-type
     * gate, and 'none' after it.
     */
    describe('the server preview fallback is reachable for recognised MIME types', () => {
      const recognised = [
        'application/pdf',
        'image/png',
        'video/mp4',
        'audio/mpeg',
        'text/plain',
        'text/markdown',
        'application/octet-stream',
      ];

      for (const mime of recognised) {
        it(`falls back to the preview URL for ${mime} when no blob was fetched`, () => {
          setInputs({ mimeType: mime, blobUrl: null, blobType: '', previewUrl });
          expect(component.contentType()).toBe('preview');
        });
      }

      it('still prefers a local blob over the preview URL when both exist', () => {
        // The positive control: this must not turn into "always prefer preview".
        setInputs({ mimeType: 'image/png', blobUrl, blobType: 'image/png', previewUrl });
        expect(component.contentType()).toBe('image');
      });

      it('still prefers transcoded video sources over the preview URL', () => {
        // Those are usable content, not a fallback.
        setInputs({
          mimeType: 'video/mp4',
          blobUrl: null,
          videoSources: [videoSource()],
          previewUrl,
        });
        expect(component.contentType()).toBe('video');
      });

      it('reports none when there is no blob, no source and no preview', () => {
        setInputs({ mimeType: 'application/pdf', blobUrl: null, previewUrl: null });
        expect(component.contentType()).toBe('none');
      });
    });

    describe('the iframe branches require the served type to be PDF', () => {
      it('refuses a native pdf whose served type is html', () => {
        setInputs({ mimeType: 'application/pdf', blobUrl, blobType: 'text/html' });
        expect(component.contentType()).toBe('none');
      });

      it('refuses a pdf rendition whose served type is html', () => {
        setInputs({
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          blobUrl,
          hasPdfRendition: true,
          blobType: 'text/html',
        });
        expect(component.contentType()).toBe('none');
      });

      it('refuses the unrecognised-blob fallback whose served type is html', () => {
        // The widest part of the hole: this branch used to return 'pdf' unconditionally.
        setInputs({
          mimeType: 'application/octet-stream',
          fileName: 'archive.bin',
          blobUrl,
          blobType: 'text/html',
        });
        expect(component.contentType()).toBe('none');
      });

      it('refuses an absent served type, rather than letting the browser sniff', () => {
        setInputs({ mimeType: 'application/pdf', blobUrl, blobType: '' });
        expect(component.contentType()).toBe('none');
      });

      it('accepts a served type carrying parameters or odd case', () => {
        setInputs({
          mimeType: 'application/pdf',
          blobUrl,
          blobType: 'APPLICATION/PDF; version=1.7',
        });
        expect(component.contentType()).toBe('pdf');
      });

      it('still renders an image from a blob served as an image, which is not an iframe branch', () => {
        // Images go to `img[src]`, which cannot execute script even for SVG, so the gate does not
        // and should not apply there.
        setInputs({ mimeType: 'image/png', blobUrl, blobType: 'image/png' });
        expect(component.contentType()).toBe('image');
      });
    });

    it('shows nothing when only transcoded video sources exist and the MIME type is not video', () => {
      // The early guard passes because `videoSources` is non-empty, but nothing downstream
      // matches and there is no blob or preview to fall back on: the final `return 'none'`.
      setInputs({ mimeType: 'application/zip', videoSources: [videoSource()] });
      expect(component.contentType()).toBe('none');
    });
  });

  describe('ARender and the Annotations tab', () => {
    const blobUrl = safeUrl('blob:doc');
    const arenderUrl = safeUrl('/arender/viewer');

    it('reports ARender as available whenever a URL was supplied, tab or not', () => {
      setInputs({ arenderUrl });
      expect(component.arenderAvailable()).toBe(true);

      setInputs({ arenderUrl: null });
      expect(component.arenderAvailable()).toBe(false);
    });

    it('only shows the ARender viewer on the Annotations tab', () => {
      // Availability and visibility are separate on purpose: the View tab keeps the built-in
      // preview even when ARender is configured.
      setInputs({ arenderUrl, annotationsTab: false });
      expect(component.arenderAvailable()).toBe(true);
      expect(component.showARenderViewer()).toBe(false);

      setInputs({ arenderUrl, annotationsTab: true });
      expect(component.showARenderViewer()).toBe(true);
    });

    it('does not show the ARender viewer on the Annotations tab without a URL', () => {
      setInputs({ arenderUrl: null, annotationsTab: true });
      expect(component.showARenderViewer()).toBe(false);
    });

    it('suppresses the image toolbar and the picture cards on the Annotations tab', () => {
      setInputs({ mimeType: 'image/png', blobUrl, pictureInfo: pictureInfo() });
      expect(component.showImageToolbar()).toBe(true);
      expect(component.showPictureCards()).toBe(true);

      setInputs({
        mimeType: 'image/png',
        blobUrl,
        pictureInfo: pictureInfo(),
        annotationsTab: true,
      });
      expect(component.showImageToolbar()).toBe(false);
      expect(component.showPictureCards()).toBe(false);
    });

    it('suppresses the storyboard and the video card while ARender is showing', () => {
      const videoInputs = {
        mimeType: 'video/mp4' as const,
        blobUrl,
        storyboard: [storyboardItem()],
        videoInfo: videoInfo(),
      };
      setInputs(videoInputs);
      expect(component.showVideoStoryboard()).toBe(true);
      expect(component.showVideoInfoCard()).toBe(true);

      setInputs({ ...videoInputs, annotationsTab: true, arenderUrl });
      expect(component.showVideoStoryboard()).toBe(false);
      expect(component.showVideoInfoCard()).toBe(false);
    });

    it('hides the storyboard for a video with no storyboard items', () => {
      setInputs({ mimeType: 'video/mp4', blobUrl, storyboard: [] });
      expect(component.showVideoStoryboard()).toBe(false);
    });

    // `StoryboardItem` was published with writable fields and is now derived from the storyboard
    // component's readonly `NxsStoryboardItem`. The assignments below are the test: a consumer
    // that fills a frame in after fetching its blob — what `document-detail` does — must keep
    // compiling, and the result must still satisfy the component's readonly input. Vitest strips
    // types, so this one is enforced by the `spec-types` gate rather than by the run.
    it('keeps StoryboardItem writable for consumers that fill a frame in later', () => {
      const frame: StoryboardItem = { timecode: 0, thumbnailUrl: null, label: '' };
      frame.thumbnailUrl = 'blob:fetched-later';
      frame.label = '0:00';
      frame.timecode = 12;

      setInputs({ mimeType: 'video/mp4', blobUrl, storyboard: [frame] });
      expect(component.showVideoStoryboard()).toBe(true);
      expect(component.storyboard()[0].thumbnailUrl).toBe('blob:fetched-later');
    });

    it('hides the picture cards for an image with no picture metadata', () => {
      setInputs({ mimeType: 'image/png', blobUrl, pictureInfo: null });
      expect(component.showPictureCards()).toBe(false);
    });

    it('hides the image toolbar for a document that is not an image', () => {
      setInputs({ mimeType: 'application/pdf', blobUrl });
      expect(component.showImageToolbar()).toBe(false);
    });
  });

  describe('exifEntries', () => {
    it('is empty when no EXIF data was supplied', () => {
      setInputs({ exifData: null });
      expect(rendered(component.exifEntries())).toEqual([]);
    });

    it('maps the known keys to labels, in the declared order', () => {
      setInputs({
        exifData: {
          dateTimeOriginal: '2026-05-01 10:00:00',
          orientation: 'Top-left',
          fNumber: 'f/2.8',
          exposureTime: '1/125',
          isoSpeedRatings: '200',
          focalLength: '35 mm',
        },
      });

      // The order is the order the labels map declares, not the order of the incoming object;
      // that is what makes the rendered card stable across documents.
      expect(rendered(component.exifEntries())).toEqual([
        { label: 'Date', value: '2026-05-01 10:00:00' },
        { label: 'Orientation', value: 'Top-left' },
        { label: 'Aperture', value: 'f/2.8' },
        { label: 'Exposure', value: '1/125' },
        { label: 'ISO', value: '200' },
        { label: 'Focal Length', value: '35 mm' },
      ]);
    });

    it('drops absent, empty and unknown keys', () => {
      setInputs({
        exifData: {
          fNumber: 'f/4',
          // Present but empty: `.filter(([key]) => data[key])` is truthiness, so '' is dropped
          // rather than rendering a labelled row with no value.
          orientation: '',
          // Not in the labels map: extra EXIF tags Nuxeo returns must not leak into the card
          // unlabelled, which is why the map is iterated and not the data.
          make: 'Canon',
        },
      });

      expect(rendered(component.exifEntries())).toEqual([{ label: 'Aperture', value: 'f/4' }]);
    });
  });

  describe('iptcEntries', () => {
    it('is empty when no IPTC data was supplied', () => {
      setInputs({ iptcData: null });
      expect(rendered(component.iptcEntries())).toEqual([]);
    });

    it('maps the known keys to labels, in the declared order', () => {
      setInputs({
        iptcData: {
          copyright: '(c) 2026 Acme',
          rights: 'All rights reserved',
          source: 'Acme Photo Desk',
          description: 'A photograph',
        },
      });

      expect(rendered(component.iptcEntries())).toEqual([
        { label: 'Copyright', value: '(c) 2026 Acme' },
        { label: 'Rights', value: 'All rights reserved' },
        { label: 'Source', value: 'Acme Photo Desk' },
        { label: 'Description', value: 'A photograph' },
      ]);
    });

    it('drops absent, empty and unknown keys', () => {
      setInputs({ iptcData: { source: 'Wire', description: '', credit: 'Reuters' } });
      expect(rendered(component.iptcEntries())).toEqual([{ label: 'Source', value: 'Wire' }]);
    });
  });

  describe('image zoom, rotation and fit', () => {
    beforeEach(() => {
      setInputs({ mimeType: 'image/png', blobUrl: safeUrl('blob:image') });
    });

    it('starts fitted to width at 1x with no rotation', () => {
      expect(component.zoom()).toBe(1);
      expect(component.rotation()).toBe(0);
      expect(component.fitMode()).toBe('width');
      expect(component.transform()).toBe('scale(1) rotate(0deg)');
    });

    it('zooms in and out in quarter steps, and reflects both in the transform', () => {
      component.zoomIn();
      expect(component.zoom()).toBe(1.25);
      expect(component.transform()).toBe('scale(1.25) rotate(0deg)');

      component.zoomOut();
      component.zoomOut();
      expect(component.zoom()).toBe(0.75);
    });

    it('clamps zoom at 5x and at 0.25x', () => {
      for (let i = 0; i < 40; i += 1) component.zoomIn();
      expect(component.zoom()).toBe(5);

      for (let i = 0; i < 40; i += 1) component.zoomOut();
      // The floor is 0.25, not 0: a zoom of 0 renders a zero-width image the user cannot
      // recover from with the buttons alone.
      expect(component.zoom()).toBe(0.25);
    });

    it('rotates left and right in 90 degree steps, unbounded in both directions', () => {
      component.rotateRight();
      component.rotateRight();
      expect(component.rotation()).toBe(180);
      expect(component.transform()).toBe('scale(1) rotate(180deg)');

      component.rotateLeft();
      component.rotateLeft();
      component.rotateLeft();
      // Negative rotation is intentional — CSS accepts it and it keeps left/right symmetric.
      expect(component.rotation()).toBe(-90);
    });

    it('toggles fit to real size and back, resetting zoom and rotation each time', () => {
      component.zoomIn();
      component.rotateRight();

      component.toggleFit();
      expect(component.fitMode()).toBe('real');
      expect(component.zoom()).toBe(1);
      expect(component.rotation()).toBe(0);

      component.zoomOut();
      component.rotateLeft();

      component.toggleFit();
      expect(component.fitMode()).toBe('width');
      // Both branches reset, so a toggle is always a return to a known state rather than
      // carrying a 3x zoom from one fit mode into the other.
      expect(component.zoom()).toBe(1);
      expect(component.rotation()).toBe(0);
    });
  });

  describe('seekTo', () => {
    it('emits the timecode even when there is no video element to seek', () => {
      // The template is stubbed here, so `videoRef()` is undefined — the same situation as
      // seeking a storyboard thumbnail before the player has been created. The emit must still
      // happen, because the parent uses it to record the position.
      setInputs({ mimeType: 'video/mp4', blobUrl: safeUrl('blob:video') });
      expect(component.videoRef()).toBeUndefined();

      const emitted: number[] = [];
      component.storyboardSeek.subscribe((value) => emitted.push(value));

      component.seekTo(12.5);

      expect(emitted).toEqual([12.5]);
    });
  });

  describe('formatTimecode', () => {
    it('renders minutes and zero-padded seconds', () => {
      expect(component.formatTimecode(0)).toBe('0:00');
      expect(component.formatTimecode(9)).toBe('0:09');
      expect(component.formatTimecode(65)).toBe('1:05');
      expect(component.formatTimecode(600)).toBe('10:00');
    });

    it('truncates fractional seconds rather than rounding up', () => {
      expect(component.formatTimecode(59.9)).toBe('0:59');
    });

    it('does not roll minutes into hours', () => {
      // Storyboard timecodes are short by nature; a long video therefore reads "125:30", not
      // "2:05:30". Asserted so the difference from `formatDuration` is deliberate and visible.
      expect(component.formatTimecode(7530)).toBe('125:30');
    });
  });

  describe('formatDuration', () => {
    it('omits the hour segment below one hour', () => {
      expect(component.formatDuration(0)).toBe('0:00');
      expect(component.formatDuration(125)).toBe('2:05');
      expect(component.formatDuration(3599)).toBe('59:59');
    });

    it('includes hours, with both lower segments zero-padded, from one hour up', () => {
      expect(component.formatDuration(3600)).toBe('1:00:00');
      expect(component.formatDuration(3725)).toBe('1:02:05');
      expect(component.formatDuration(45296)).toBe('12:34:56');
    });
  });

  describe('isFiniteNumber', () => {
    it('accepts real numbers, including zero and negatives', () => {
      expect(component.isFiniteNumber(0)).toBe(true);
      expect(component.isFiniteNumber(-1.5)).toBe(true);
      expect(component.isFiniteNumber(1920)).toBe(true);
    });

    it('rejects null, undefined, NaN and Infinity', () => {
      // The template guards every metadata row with this. `NaN` in particular arrives from
      // `parseFloat` on a missing Nuxeo property, and without the check the card renders "NaN".
      expect(component.isFiniteNumber(null)).toBe(false);
      expect(component.isFiniteNumber(undefined)).toBe(false);
      expect(component.isFiniteNumber(Number.NaN)).toBe(false);
      expect(component.isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    });
  });
});
