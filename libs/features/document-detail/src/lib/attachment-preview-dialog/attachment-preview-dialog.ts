import { Component, inject, signal, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SafeResourceUrl } from '@angular/platform-browser';
// Shared rather than local: see the note on the helper — one normalisation for three checks.
import { mediaTypeEssence } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe } from '@ngx-translate/core';

export interface AttachmentPreviewData {
  name: string;
  mimeType: string;
  /**
   * The `type` of the `Blob` the object URL was minted from — i.e. the `Content-Type` the server
   * actually served, which is what the browser parses the iframe document by.
   *
   * Separate from `mimeType` on purpose. `mimeType` is the document *metadata*, and gating the
   * iframe on metadata alone was a hole: a document recorded as `text/plain` but served as
   * `text/html` passed the allow-list and then parsed as markup. See
   * {@link PREVIEWABLE_TEXT_TYPES}.
   */
  blobType: string;
  /** Wrapped, for `iframe[src]` and `img[src]`. `iframe[src]` throws on a raw string. */
  blobUrl: SafeResourceUrl;
  /**
   * The same object URL, unwrapped, for `<source [src]>` — a `SecurityContext.NONE` binding where
   * no sanitizer runs, so a `SafeResourceUrl` would be assigned as its `toString()` and break
   * playback. Always populated.
   */
  rawUrl: string;
  /**
   * Whether this dialog revokes `rawUrl` when it closes.
   *
   * The two call sites differ, and the difference used to be smuggled through `rawUrl: ''`:
   * `previewAttachment` mints a URL solely for the dialog, so the dialog must revoke it, while
   * `previewMainBlob` shares the URL the document viewer is still using, so revoking it would
   * blank the page behind the dialog. Passing an empty string expressed that *and* silently
   * removed the value `<source [src]>` needed, so ownership is now stated separately.
   */
  ownsRawUrl: boolean;
}

/**
 * The text types rendered in the preview iframe — an allow-list, not a `text/*` prefix test.
 *
 * The prefix test was a live stored-XSS hole. `text/html` satisfies `startsWith('text/')`, and the
 * iframe loads a `blob:` URL, which **inherits the creating page's origin**. So previewing an
 * uploaded `.html` attachment executed its scripts under our origin, with `document.cookie`,
 * `localStorage` and `window.parent` all reachable. Anyone who could attach a file to a document
 * could run script against every user who previewed it.
 *
 * This is the same lesson `navigable-url.ts` records for schemes, one layer up: enumerating what is
 * safe is a filter, and testing a prefix is not. Adding a `text/html` special case would leave
 * `text/xsl`, `application/xhtml+xml` and the next active text type nobody thought of.
 *
 * **XML is not on this list, and that is not an oversight.** `text/xml` and `application/xml` are
 * parsed as markup, so a generic XML document is an execution vector twice over: namespaced content
 * runs (`<svg:svg><svg:script>`), and an `<?xml-stylesheet type="text/xsl" href="…"?>` instruction
 * pulls in XSLT that can emit scripted HTML. Rejecting `image/svg+xml` while admitting `text/xml`
 * closed the front door and left the side one open. Only formats the browser will not parse as
 * markup remain.
 *
 * Consequence: HTML and XML attachments now fall through to "Preview not available". Restoring
 * either safely means a sandboxed iframe (`sandbox` without `allow-same-origin`, so the document
 * gets an opaque origin) or decoding to text and escaping it. Neither is done here — closing the
 * hole and adding a feature are separate changes.
 *
 * **The metadata/served-type mismatch, now closed.** An earlier version of this note recorded the
 * mismatch as an unfixable residual risk: `isText` read the document metadata while the browser
 * parses by the served `Content-Type`, so `text/plain` metadata on an HTML-served blob still reached
 * the iframe. Calling that unanswerable was wrong — the caller holds the `Blob`, so its `type` can
 * simply be passed in. Both the declared type and {@link AttachmentPreviewData.blobType} must now be
 * on this list, which also fails closed when the server sends no `Content-Type` at all (`blob.type`
 * is `''`, which is not on the list, so no sniffing opportunity).
 *
 * A CSP `frame-src`/`sandbox` policy is still the structural control and is still absent — the same
 * gap the ARender iframe records. This check reduces what reaches the iframe; it does not replace a
 * header.
 */
const PREVIEWABLE_TEXT_TYPES = new Set(['text/plain', 'text/csv', 'application/json']);

@Component({
  selector: 'lib-attachment-preview-dialog',
  standalone: true,
  imports: [TranslatePipe, MatDialogModule, MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './attachment-preview-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      :host {
        display: block;
        width: min(90vw, 1200px);
      }

      .preview-viewer {
        display: flex;
        flex-direction: column;
        height: 85vh;
        background: #f5f5f5;
      }

      .viewer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        background: #37474f;
        color: #fff;
        min-height: 44px;
      }

      .viewer-filename {
        font-size: 14px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        margin-right: 12px;
      }

      .viewer-close {
        border: none;
        background: none;
        color: #fff;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        border-radius: 50%;

        &:hover {
          background: rgba(255, 255, 255, 0.15);
        }

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      .viewer-body {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: auto;
        background: #e8e8e8;
        padding: 24px;
      }

      .viewer-img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        transition: transform 0.2s ease;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
      }

      .viewer-frame {
        width: 100%;
        height: 100%;
        border: none;
        background: #fff;
      }

      .viewer-video {
        max-width: 100%;
        max-height: 100%;
      }

      .viewer-audio {
        width: 80%;
        max-width: 500px;
      }

      .viewer-unsupported {
        text-align: center;
        color: #666;
        padding: 48px 24px;
      }

      .unsupported-icon {
        font-size: 64px !important;
        width: 64px !important;
        height: 64px !important;
        color: #999;
        margin-bottom: 16px;
      }

      .viewer-unsupported p {
        margin: 4px 0;
        font-size: 14px;
      }

      .mime-label {
        color: #aaa;
        font-size: 12px !important;
      }

      .viewer-toolbar {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 4px;
        padding: 8px 0;
        background: #37474f;

        button {
          color: #fff;

          &:hover {
            background: rgba(255, 255, 255, 0.15);
          }
        }
      }
    `,
  ],
})
export class AttachmentPreviewDialogComponent implements OnDestroy {
  private readonly dialogRef = inject(MatDialogRef<AttachmentPreviewDialogComponent>);
  readonly data: AttachmentPreviewData = inject(MAT_DIALOG_DATA);

  readonly zoom = signal(1);
  private rotation = 0;

  get isImage(): boolean {
    return this.data.mimeType.startsWith('image/');
  }

  /**
   * Both the declared and the served type must be PDF, because this is an iframe branch.
   *
   * A document recorded as `application/pdf` but served as `text/html` would otherwise render as
   * scripted HTML in a same-origin blob iframe. An absent `Content-Type` (`blob.type === ''`) also
   * fails this, which is deliberate: it is the case where the browser would otherwise sniff.
   */
  get isPdf(): boolean {
    return (
      mediaTypeEssence(this.data.mimeType) === 'application/pdf' &&
      mediaTypeEssence(this.data.blobType) === 'application/pdf'
    );
  }

  get isVideo(): boolean {
    return this.data.mimeType.startsWith('video/');
  }

  get isAudio(): boolean {
    return this.data.mimeType.startsWith('audio/');
  }

  /**
   * The `type` hint for `<source>`: the served type when we have one, metadata otherwise.
   *
   * `type` is a hint the browser uses to decide whether to even attempt a source — per spec it skips a
   * source whose declared type it does not support. So advertising the *document metadata* type while
   * the blob is something else can make it skip a perfectly playable source, which is the same
   * metadata/served disagreement that motivated `blobType`, showing up in the attribute rather than the
   * URL. Fixing `rawUrl` alone left this half.
   *
   * Falls back to `mimeType` when the server sent no `Content-Type`, rather than emitting `type=""` —
   * an empty declared type is not a supported type, so it would make the browser skip the source
   * outright, which is worse than a possibly-wrong hint.
   */
  get sourceType(): string {
    return this.data.blobType || this.data.mimeType;
  }

  /**
   * See {@link PREVIEWABLE_TEXT_TYPES} — an allow-list, because `text/html` is executable.
   *
   * Both the declared and the served type must be on it. Checking only the declared one left the
   * mismatch open: `text/plain` metadata on an HTML-served blob reached the iframe and parsed.
   */
  get isText(): boolean {
    return (
      PREVIEWABLE_TEXT_TYPES.has(mediaTypeEssence(this.data.mimeType)) &&
      PREVIEWABLE_TEXT_TYPES.has(mediaTypeEssence(this.data.blobType))
    );
  }

  zoomIn(): void {
    this.zoom.update((z) => Math.min(z + 0.25, 5));
  }

  zoomOut(): void {
    this.zoom.update((z) => Math.max(z - 0.25, 0.25));
  }

  zoomReset(): void {
    this.zoom.set(1);
    this.rotation = 0;
  }

  rotateLeft(): void {
    this.rotation -= 90;
  }

  rotateRight(): void {
    this.rotation += 90;
  }

  close(): void {
    this.dialogRef.close();
  }

  ngOnDestroy(): void {
    // Only revoke what this dialog owns — `previewMainBlob` shares the document viewer's URL.
    if (this.data.ownsRawUrl) URL.revokeObjectURL(this.data.rawUrl);
  }
}
