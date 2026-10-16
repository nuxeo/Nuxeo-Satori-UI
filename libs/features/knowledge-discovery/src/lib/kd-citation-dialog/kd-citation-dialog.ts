import { Component, DestroyRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { catchError, of, switchMap, map } from 'rxjs';

import {
  buildIndexedReferences,
  extractNuxeoDocumentId,
  findReferenceByIndex,
  findReferenceByKey,
  formatReferenceExcerpt,
  formatReferenceLabel,
  referenceKey,
  referencesForObject,
  type KdAnswerResponse,
  type KdIndexedReference,
} from '@agentic-ui/shared/kd-client';
import {
  DocumentDetailService,
  renderTrustedHtml,
  trustObjectUrl,
  mediaTypeEssence,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

export interface KdCitationDialogData {
  answer: KdAnswerResponse;
  initialIndex: number;
}

type PreviewMode = 'pdf' | 'image' | 'text' | 'unsupported';

@Component({
  selector: 'lib-kd-citation-dialog',
  standalone: true,
  imports: [
    TranslatePipe,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './kd-citation-dialog.html',
  styleUrl: './kd-citation-dialog.scss',
})
export class KdCitationDialogComponent implements OnDestroy {
  private readonly dialogRef = inject(MatDialogRef<KdCitationDialogComponent>);
  private readonly translate = inject(TranslateService);
  /** The active language as a signal, so a `computed` that calls `instant()` recomputes on a switch. */
  private readonly currentLang = toSignal(
    this.translate.onLangChange.pipe(map((event) => event.lang)),
    { initialValue: this.translate.getCurrentLang() },
  );
  private readonly data = inject<KdCitationDialogData>(MAT_DIALOG_DATA);
  private readonly detailService = inject(DocumentDetailService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly blobUrls: string[] = [];

  readonly references = buildIndexedReferences(this.data.answer);
  readonly activeReferenceKey = signal(this.resolveInitialReferenceKey(this.data.initialIndex));
  readonly loadingDocument = signal(true);
  readonly documentError = signal<string | null>(null);
  readonly documentTitle = signal('');
  readonly documentPath = signal('');
  readonly previewMode = signal<PreviewMode>('unsupported');
  readonly previewUrl = signal<SafeResourceUrl | null>(null);
  readonly textPreview = signal<SafeHtml | null>(null);
  readonly mimeType = signal('');

  readonly activeReference = computed(
    () => findReferenceByKey(this.references, this.activeReferenceKey()) ?? null,
  );

  readonly documentReferences = computed(() => {
    const reference = this.activeReference();
    return reference ? referencesForObject(this.references, reference.objectId) : [];
  });

  readonly headerLabel = computed(() => {
    this.currentLang();
    const reference = this.activeReference();
    if (!reference) {
      return this.translate.instant('kd.kd-citation-dialog.reference-document');
    }
    return reference.title || this.documentTitle() || reference.objectId;
  });

  constructor() {
    this.loadDocumentForActiveReference();
  }

  selectReference(key: string): void {
    if (key === this.activeReferenceKey()) {
      return;
    }

    const previous = this.activeReference();
    const next = findReferenceByKey(this.references, key);
    if (!next) {
      return;
    }

    this.activeReferenceKey.set(key);

    const previousDocumentId = previous ? extractNuxeoDocumentId(previous.objectId) : null;
    const nextDocumentId = extractNuxeoDocumentId(next.objectId);
    if (
      previousDocumentId &&
      nextDocumentId &&
      previousDocumentId === nextDocumentId &&
      this.previewMode() === 'pdf' &&
      !this.loadingDocument()
    ) {
      this.updatePdfPage(next.pageNumber);
      return;
    }

    this.loadDocumentForActiveReference();
  }

  referenceLabel(reference: KdIndexedReference): string {
    return formatReferenceLabel(reference);
  }

  referenceTrackKey(reference: KdIndexedReference): string {
    return referenceKey(reference);
  }

  formatExcerpt(content?: string): string {
    return (
      formatReferenceExcerpt(content) ||
      this.translate.instant('kd.kd-citation-dialog.no-excerpt-returned')
    );
  }

  close(): void {
    this.dialogRef.close();
  }

  ngOnDestroy(): void {
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url);
    }
  }

  private resolveInitialReferenceKey(initialIndex: number): string {
    const match = findReferenceByIndex(this.references, initialIndex);
    if (match) {
      return referenceKey(match);
    }
    const first = this.references[0];
    return first ? referenceKey(first) : '';
  }

  private loadDocumentForActiveReference(): void {
    const reference = this.activeReference();
    if (!reference) {
      this.loadingDocument.set(false);
      this.documentError.set(
        this.translate.instant('kd.message.no-reference-is-available-for-this-citation'),
      );
      return;
    }

    const documentId = extractNuxeoDocumentId(reference.objectId);
    if (!documentId) {
      this.loadingDocument.set(false);
      this.documentError.set(this.translate.instant('kd.message.this-citation-does-not-map-to-a'));
      return;
    }

    this.loadingDocument.set(true);
    this.documentError.set(null);
    this.clearPreview();

    this.detailService
      .getFullDocument(documentId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((document) => this.loadPreview(document, reference)),
        catchError(() => {
          this.loadingDocument.set(false);
          this.documentError.set(
            this.translate.instant('kd.message.failed-to-load-the-source-document-from'),
          );
          return of(null);
        }),
      )
      .subscribe();
  }

  private loadPreview(document: NuxeoDocument, reference: KdIndexedReference) {
    this.documentTitle.set(this.getDocumentDisplayTitle(document));
    this.documentPath.set(document.path ?? '');

    const fileContent = document.properties?.['file:content'] as
      { 'mime-type'?: string; name?: string } | undefined;
    const mime = fileContent?.['mime-type'] ?? '';
    this.mimeType.set(mime);

    if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
      return this.detailService.fetchBlob(document.uid).pipe(
        switchMap(async (blob) => {
          const text = await blob.text();
          this.textPreview.set(this.highlightExcerpt(text, reference.content));
          this.previewMode.set('text');
          this.loadingDocument.set(false);
        }),
      );
    }

    if (mime.startsWith('image/')) {
      return this.detailService.fetchBlob(document.uid).pipe(
        switchMap((blob) => {
          this.setBlobPreview(blob, 'image');
          return of(null);
        }),
      );
    }

    if (mime === 'application/pdf') {
      return this.detailService.fetchBlob(document.uid).pipe(
        switchMap((blob) => {
          this.setBlobPreview(blob, 'pdf', reference.pageNumber);
          return of(null);
        }),
      );
    }

    const renditions = (document.contextParameters?.['renditions'] ?? []) as Array<{
      name: string;
    }>;
    if (renditions.some((rendition) => rendition.name === 'pdf')) {
      return this.detailService.fetchPdfRendition(document.uid).pipe(
        switchMap((blob) => {
          this.setBlobPreview(blob, 'pdf', reference.pageNumber);
          return of(null);
        }),
        catchError(() =>
          this.detailService.fetchBlob(document.uid).pipe(
            switchMap((blob) => {
              this.setBlobPreview(blob, mime.startsWith('image/') ? 'image' : 'unsupported');
              return of(null);
            }),
          ),
        ),
      );
    }

    return this.detailService.fetchBlob(document.uid).pipe(
      switchMap((blob) => {
        if (mime.startsWith('image/')) {
          this.setBlobPreview(blob, 'image');
        } else {
          this.previewMode.set('unsupported');
          this.loadingDocument.set(false);
        }
        return of(null);
      }),
    );
  }

  private setBlobPreview(blob: Blob, mode: PreviewMode, pageNumber?: number): void {
    // The served-type gate, placed here rather than at the two `'pdf'` call sites so a future third
    // caller cannot miss it.
    //
    // `'pdf'` was chosen from document metadata — the recorded mime type, or the presence of a `pdf`
    // rendition — and neither is what the browser consults. It parses a `blob:` document by its
    // `Content-Type`, and a blob URL inherits this origin, so a document recorded as PDF but served as
    // `text/html` executed as script here. Same defect already closed in the attachment preview dialog
    // and `DocumentViewerComponent`; this was the third instance, in a component neither review pass
    // had reached.
    //
    // An absent `Content-Type` also fails this, deliberately: that is the case where the browser would
    // otherwise sniff.
    const effectiveMode: PreviewMode =
      mode === 'pdf' && mediaTypeEssence(blob.type) !== 'application/pdf' ? 'unsupported' : mode;
    const rawUrl = URL.createObjectURL(blob);
    this.blobUrls.push(rawUrl);
    this.previewUrl.set(trustObjectUrl(this.sanitizer, this.buildPreviewUrl(rawUrl, pageNumber)));
    this.previewMode.set(effectiveMode);
    this.loadingDocument.set(false);
  }

  private updatePdfPage(pageNumber?: number): void {
    const currentUrl = this.blobUrls[this.blobUrls.length - 1];
    if (!currentUrl) {
      return;
    }
    this.previewUrl.set(
      trustObjectUrl(this.sanitizer, this.buildPreviewUrl(currentUrl, pageNumber)),
    );
  }

  private buildPreviewUrl(rawUrl: string, pageNumber?: number): string {
    if (pageNumber !== undefined && pageNumber > 0) {
      return `${rawUrl}#page=${pageNumber}`;
    }
    return rawUrl;
  }

  private clearPreview(): void {
    this.previewUrl.set(null);
    this.textPreview.set(null);
    this.previewMode.set('unsupported');
  }

  /**
   * `<mark>` around the cited excerpt, everything else escaped.
   *
   * Routed through `renderTrustedHtml` rather than bypassing directly, so the only markup that can
   * reach `innerHTML` is what DOMPurify's allow-list permits — `mark` and its `class`. The local
   * `escapeHtml` still runs first and is still what makes the concatenation safe; DOMPurify is a
   * second, independent check rather than a replacement for it. That matters because the safety of
   * this member previously rested entirely on `escapeHtml` covering every interpolated segment,
   * which nothing enforced.
   */
  private highlightExcerpt(text: string, excerpt?: string): SafeHtml {
    const allowMarkOnly = { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: ['class'] };

    if (!excerpt?.trim()) {
      return renderTrustedHtml(this.sanitizer, this.escapeHtml(text), allowMarkOnly);
    }

    const matchIndex = text.toLowerCase().indexOf(excerpt.toLowerCase());
    if (matchIndex === -1) {
      return renderTrustedHtml(this.sanitizer, this.escapeHtml(text), allowMarkOnly);
    }

    const before = this.escapeHtml(text.slice(0, matchIndex));
    const highlighted = this.escapeHtml(text.slice(matchIndex, matchIndex + excerpt.length));
    const after = this.escapeHtml(text.slice(matchIndex + excerpt.length));
    return renderTrustedHtml(
      this.sanitizer,
      `${before}<mark class="kd-citation-dialog__highlight">${highlighted}</mark>${after}`,
      allowMarkOnly,
    );
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private getDocumentDisplayTitle(document: NuxeoDocument): string {
    const properties = document.properties ?? {};
    const fileContent = properties['file:content'] as { name?: unknown } | undefined;
    const fileName = typeof fileContent?.name === 'string' ? fileContent.name : undefined;
    const dcTitle = properties['dc:title'];
    return (
      fileName ??
      document.title ??
      (typeof dcTitle === 'string' ? dcTitle : undefined) ??
      document.uid ??
      ''
    );
  }
}
