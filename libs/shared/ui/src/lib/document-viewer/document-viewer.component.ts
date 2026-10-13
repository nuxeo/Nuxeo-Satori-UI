import {
  Component,
  input,
  output,
  computed,
  signal,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
} from '@angular/core';
import { SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkAriaLive } from '@angular/cdk/a11y';
// Shared rather than local: this normalisation guards three separate served-type checks, and a
// divergence between them would be a bypass.
import { mediaTypeEssence } from '@nuxeo-satori/platform/nuxeo-client';
import { TranslatePipe } from '@ngx-translate/core';
import { NxsSpinnerComponent } from '@nuxeo-satori/platform/components';

export interface VideoSource {
  /**
   * Raw object URL, not `SafeResourceUrl`. This is bound to `<source [src]>`, which is
   * `SecurityContext.NONE` — see `DocumentViewerComponent.rawBlobUrl` for why a `Safe*` value
   * silently breaks there. The transcoded-video source list was broken this way.
   */
  url: string;
  mimeType: string;
  label?: string;
}

export interface StoryboardItem {
  timecode: number;
  thumbnailUrl: string | null;
  label: string;
}

export interface PictureInfo {
  width: number;
  height: number;
  format: string;
  colorSpace: string;
  depth: number;
  weight: string;
}

export interface PictureView {
  title: string;
  width: number;
  height: number;
  fileSize: string;
  format: string;
  downloadUrl: string;
}

export interface ExifData {
  dateTimeOriginal?: string;
  orientation?: string;
  fNumber?: string;
  exposureTime?: string;
  isoSpeedRatings?: string;
  focalLength?: string;
  [key: string]: string | undefined;
}

export interface IptcData {
  copyright?: string;
  rights?: string;
  source?: string;
  description?: string;
  [key: string]: string | undefined;
}

export interface VideoInfo {
  duration?: number;
  width?: number;
  height?: number;
  format?: string;
  videoCodec?: string;
  audioCodec?: string;
  frameRate?: number;
}

/**
 * Reusable document viewer component following Nuxeo Web UI's nuxeo-document-preview
 * dispatching logic. Renders content based on MIME type priority:
 *
 * 1. image/*           → Image viewer with zoom/rotate/pan
 * 2. video/*           → HTML5 video player with storyboard
 * 3. audio/*           → HTML5 audio player
 * 4. text/markdown     → Rendered markdown (passed as safe HTML)
 * 5. text/html         → Iframe with srcdoc
 * 6. text/xml          → Preformatted text
 * 7. text/plain        → Preformatted text
 * 8. application/pdf   → PDF iframe (browser-native or PDF.js)
 * 9. (pdf rendition)   → PDF iframe using server-rendered PDF of office docs
 * 10. (fallback)       → Generic iframe with preview URL, or "no preview" placeholder
 */
@Component({
  selector: 'lib-document-viewer',
  standalone: true,
  imports: [
    NxsSpinnerComponent,
    TranslatePipe,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    CdkAriaLive,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './document-viewer.component.html',
  styleUrl: './document-viewer.component.scss',
})
export class DocumentViewerComponent {
  readonly blobUrl = input<SafeResourceUrl | null>(null);
  /**
   * The same object URL as `blobUrl`, unwrapped.
   *
   * `source[src]`, `audio[src]` and `video[poster]` are `SecurityContext.NONE` in Angular's DOM
   * security schema, which means no sanitizer runs on them — and a `Safe*` value is only ever
   * unwrapped *by* a sanitizer. Bound into a NONE context it is therefore assigned to the DOM
   * property as-is and coerced by `toString()`, writing the literal string
   * `"SafeValue must use [property]=binding: …"` into `src`. Audio playback and the
   * single-source video fallback were broken exactly that way until this input existed.
   *
   * So: `blobUrl` for `iframe[src]` (which conversely *throws* on a raw string) and `img[src]`,
   * this one for the three NONE bindings. Enforced by `scripts/beta-harness/sanitizer-audit.mjs`
   * check 4, which follows the bound expression to a type declaration and — crucially — reports any
   * NONE-context binding whose type it cannot resolve, rather than assuming it is safe.
   */
  /**
   * Required, not optional with a `null` default — the default is what made this fail silently.
   *
   * `audio[src]` and the single-source `video[src]` fallback are `SecurityContext.NONE`, so they need
   * the raw string; `blobUrl` is a `SafeResourceUrl` and stringifies to
   * `"SafeValue must use [property]=binding: …"` there. A consumer that omits this input keeps
   * compiling and renders a null source, which is exactly the silent breakage this PR exists to fix —
   * so omitting it has to be a compile error, not a runtime shrug.
   *
   * This was made required in `3d6638f` and reverted to optional in `511b22e`; restoring it. All
   * three in-repo consumers already pass it, so the only thing the requirement breaks is an external
   * consumer that would otherwise have shipped broken audio.
   */
  readonly rawBlobUrl = input.required<string | null>();
  /**
   * `Blob.type` of the blob behind {@link blobUrl} — the `Content-Type` the server actually served.
   *
   * Required for the same reason as `rawBlobUrl`: it gates the unsandboxed iframe branches, and a
   * default would let a consumer omit it and silently get either no PDF preview or, worse, the
   * pre-existing behaviour of choosing the iframe from metadata alone.
   *
   * That was a same-origin execution path. `contentType()` picked `'pdf'` from `mimeType`,
   * `hasPdfRendition` and even a filename-extension fallback, none of which the browser consults —
   * it parses a `blob:` document by its `Content-Type`, and a blob URL inherits this origin. A
   * document recorded as PDF but served as `text/html` therefore ran as script here. The attachment
   * dialog closed the same mismatch; this input closes it for the embedded viewer.
   */
  readonly blobType = input.required<string>();
  readonly mimeType = input<string>('');
  readonly fileName = input<string>('');
  readonly fileSize = input<string>('');
  readonly loading = input<boolean>(false);

  readonly noteContent = input<string | null>(null);
  readonly noteHtml = input<SafeHtml | null>(null);
  readonly videoSources = input<VideoSource[]>([]);
  readonly storyboard = input<StoryboardItem[]>([]);
  /** Raw string, not `SafeResourceUrl`: `video[poster]` is `SecurityContext.NONE`. See `rawBlobUrl`. */
  readonly posterUrl = input<string | null>(null);
  readonly hasPdfRendition = input<boolean>(false);
  readonly previewUrl = input<SafeResourceUrl | null>(null);

  readonly pictureInfo = input<PictureInfo | null>(null);
  readonly pictureViews = input<PictureView[]>([]);
  readonly exifData = input<ExifData | null>(null);
  readonly iptcData = input<IptcData | null>(null);
  readonly videoInfo = input<VideoInfo | null>(null);

  readonly arenderUrl = input<SafeResourceUrl | null>(null);
  /** When this changes, the ARender iframe is destroyed and recreated. */
  readonly arenderReloadId = input(0);
  /** When the open document changes, exit ARender mode so the user does not keep a stale viewer. */
  readonly viewerDocUid = input<string>('');
  /**
   * When true (Annotations tab), the main area only shows ARender or a “not available” state,
   * matching Nuxeo Web UI’s Annotations tab.
   */
  readonly annotationsTab = input(false);

  /** When true, show Replace / Remove actions for the primary blob in the footer toolbar. */
  readonly showMainFileControls = input(false);
  readonly mainFileActionInProgress = input<string | null>(null);

  readonly downloadClicked = output<void>();
  readonly openWithDriveClicked = output<void>();
  readonly previewClicked = output<void>();
  readonly replaceMainFileClicked = output<void>();
  readonly removeMainFileClicked = output<void>();
  readonly storyboardSeek = output<number>();
  readonly formatDownload = output<string>();

  readonly contentType = computed<
    | 'image'
    | 'video'
    | 'audio'
    | 'markdown'
    | 'html'
    | 'xml'
    | 'text'
    | 'pdf'
    | 'pdfRendition'
    | 'preview'
    | 'none'
  >(() => {
    const mime = this.mimeType();

    if (this.noteContent() !== null || this.noteHtml() !== null) {
      if (mime === 'text/markdown') return 'markdown';
      if (mime === 'text/html') return 'html';
      if (mime === 'text/xml' || mime === 'application/xml') return 'xml';
      if (mime.startsWith('text/')) return 'text';
    }

    if (!this.blobUrl() && !this.previewUrl() && this.videoSources().length === 0) {
      if (this.noteContent() !== null) return 'text';
      return 'none';
    }

    // The server-rendered preview has to be reachable BEFORE metadata dispatch.
    //
    // `loadPreviewFallback` is what runs when the local blob could not be fetched: it sets only
    // `previewUrl`, leaving `blobUrl` and `blobType` empty. Every branch below assumes a local blob, so
    // with the branches ordered by MIME first, a recognised type reached its own branch and never got
    // here — a PDF returned 'pdf' and rendered an iframe bound to a null `blobUrl`, and after the
    // served-type gate landed it returned 'none' instead. Both are the fallback being shadowed rather
    // than used; the gate changed the symptom, not the cause.
    //
    // Transcoded video sources still win, because those are usable content rather than a fallback.
    if (!this.blobUrl() && this.videoSources().length === 0 && this.previewUrl()) return 'preview';

    if (/^image\//.test(mime)) return 'image';
    if (/^video\//.test(mime) || /^application\/(g|m)xf$/.test(mime)) return 'video';
    if (/^audio\//.test(mime)) return 'audio';
    if (mime === 'text/markdown') return 'markdown';
    if (mime === 'text/html') return 'html';
    if (mime === 'text/xml' || mime === 'application/xml') return 'xml';
    if (mime.startsWith('text/') || mime === 'application/json') return 'text';
    // The three branches below that put `blobUrl()` in an iframe are gated on the SERVED type, not
    // on `mime`/`hasPdfRendition`/the filename. Those are all metadata, and the browser parses a
    // `blob:` document by its `Content-Type` — see the `blobType` input. Disagreement falls through
    // to 'none' rather than guessing, which is a lost preview instead of an execution path.
    const servedIsPdf = mediaTypeEssence(this.blobType()) === 'application/pdf';

    if (mime === 'application/pdf') return servedIsPdf ? 'pdf' : 'none';
    if (this.hasPdfRendition() && this.blobUrl()) return servedIsPdf ? 'pdfRendition' : 'none';
    // `previewUrl` is not a blob: it is a same-origin Nuxeo endpoint already constrained by
    // `navigableUrlOrNull` and an origin allow-list, so the served-type gate does not apply to it.
    if (this.previewUrl()) return 'preview';
    if (this.blobUrl()) {
      if (/\.(png|jpe?g|gif|webp|bmp|svg|tiff?)$/i.test(this.fileName())) return 'image';
      // The old unconditional `return 'pdf'` here was the widest part of the hole: any unrecognised
      // mime with a blob URL landed in the iframe regardless of what was served.
      return servedIsPdf ? 'pdf' : 'none';
    }

    return 'none';
  });

  /** ARender appears only on the Annotations tab (View tab uses the built-in preview). */
  readonly showARenderViewer = computed(() => this.annotationsTab() && this.arenderUrl() !== null);

  readonly showImageToolbar = computed(
    () => !this.annotationsTab() && !this.showARenderViewer() && this.contentType() === 'image',
  );
  readonly showVideoStoryboard = computed(
    () =>
      !this.annotationsTab() &&
      !this.showARenderViewer() &&
      this.contentType() === 'video' &&
      this.storyboard().length > 0,
  );
  readonly showPictureCards = computed(
    () =>
      !this.annotationsTab() &&
      !this.showARenderViewer() &&
      this.contentType() === 'image' &&
      this.pictureInfo() !== null,
  );
  readonly showVideoInfoCard = computed(
    () =>
      !this.annotationsTab() &&
      !this.showARenderViewer() &&
      this.contentType() === 'video' &&
      this.videoInfo() !== null,
  );
  readonly arenderAvailable = computed(() => this.arenderUrl() !== null);

  readonly exifEntries = computed(() => {
    const data = this.exifData();
    if (!data) return [];
    const labelKeys: Record<string, string> = {
      dateTimeOriginal: 'shared-ui.document-viewer.exif-date',
      orientation: 'shared-ui.document-viewer.exif-orientation',
      fNumber: 'shared-ui.document-viewer.exif-aperture',
      exposureTime: 'shared-ui.document-viewer.exif-exposure',
      isoSpeedRatings: 'shared-ui.document-viewer.exif-iso',
      focalLength: 'shared-ui.document-viewer.exif-focal-length',
    };
    return Object.entries(labelKeys)
      .filter(([key]) => data[key])
      .map(([key, labelKey]) => ({ labelKey, value: data[key]! }));
  });

  readonly iptcEntries = computed(() => {
    const data = this.iptcData();
    if (!data) return [];
    const labelKeys: Record<string, string> = {
      copyright: 'shared-ui.document-viewer.iptc-copyright',
      rights: 'shared-ui.document-viewer.iptc-rights',
      source: 'shared-ui.document-viewer.iptc-source',
      description: 'shared-ui.document-viewer.iptc-description',
    };
    return Object.entries(labelKeys)
      .filter(([key]) => data[key])
      .map(([key, labelKey]) => ({ labelKey, value: data[key]! }));
  });

  readonly zoom = signal(1);
  readonly rotation = signal(0);
  readonly fitMode = signal<'width' | 'real'>('width');

  readonly transform = computed(() => `scale(${this.zoom()}) rotate(${this.rotation()}deg)`);

  readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoPlayer');

  zoomIn(): void {
    this.zoom.update((z) => Math.min(z + 0.25, 5));
  }

  zoomOut(): void {
    this.zoom.update((z) => Math.max(z - 0.25, 0.25));
  }

  toggleFit(): void {
    if (this.fitMode() === 'width') {
      this.fitMode.set('real');
      this.zoom.set(1);
    } else {
      this.fitMode.set('width');
      this.zoom.set(1);
    }
    this.rotation.set(0);
  }

  rotateLeft(): void {
    this.rotation.update((r) => r - 90);
  }

  rotateRight(): void {
    this.rotation.update((r) => r + 90);
  }

  seekTo(timecode: number): void {
    const video = this.videoRef()?.nativeElement;
    if (video) {
      video.currentTime = timecode;
    }
    this.storyboardSeek.emit(timecode);
  }

  formatTimecode(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  isFiniteNumber(value: number | null | undefined): value is number {
    return value !== null && value !== undefined && Number.isFinite(value);
  }
}
