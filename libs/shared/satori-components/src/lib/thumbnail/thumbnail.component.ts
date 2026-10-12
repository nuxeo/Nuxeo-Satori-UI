import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';

import { DocumentDetailService } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsThumbnailCache } from './thumbnail-cache';

/**
 * A document's thumbnail rendition, fetched through the authenticated client and shown from a blob
 * URL that no caller creates or revokes.
 *
 * Under a page that lists `provideNxsThumbnailCache()`, the page's `NxsThumbnailCache` owns the URL:
 * thumbnails of one document share it, a view switch reuses it, requests are bounded, and it is
 * revoked once nothing shows it and with the page. Without one, this component owns it and revokes
 * it when the document changes and when it is destroyed.
 *
 * Until the image arrives — and when there is none, the request fails or the bytes do not decode —
 * the projected content shows instead, usually the document-type icon. While it shows, the host
 * has no box of its own (`display: contents`), so the fallback lays out exactly as it would without
 * this wrapper. Size the thumbnail with a class on the host; the image fills it and takes the host's
 * `object-fit` and `border-radius`. Do not set `display` on the host.
 *
 * Decorative by default, like Web UI's `nuxeo-document-thumbnail`: a blank `alt` hides it from
 * assistive technology, because the title beside it already names the document.
 */
@Component({
  selector: 'nxs-thumbnail',
  standalone: true,
  templateUrl: './thumbnail.component.html',
  styleUrl: './thumbnail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxs-thumbnail',
    '[class.nxs-thumbnail--empty]': 'url() === null',
  },
})
export class NxsThumbnailComponent {
  /** The document whose `thumbnail` rendition to show. */
  readonly documentId = input.required<string>();
  /** The image's text alternative, already translated. Blank marks it decorative. */
  readonly alt = input('');

  protected readonly url = signal<string | null>(null);

  private readonly documents = inject(DocumentDetailService);
  private readonly cache = inject(NxsThumbnailCache, { optional: true });
  /** Whether `url` is this component's to revoke — it is not when a page cache lent it. */
  private owned = false;

  constructor() {
    toObservable(this.documentId)
      .pipe(
        // Cleared before the next request rather than when it answers, so a changed document never
        // shows the previous one's image, even for the length of a request.
        tap(() => this.clear()),
        switchMap((id) => this.load(id)),
        takeUntilDestroyed(),
      )
      .subscribe((url) => this.url.set(url));
    inject(DestroyRef).onDestroy(() => this.clear());
  }

  private load(documentId: string): Observable<string | null> {
    if (!documentId) return of(null);
    return this.cache ? this.cache.lend(documentId) : this.own(documentId);
  }

  /** The bytes arrived but are not an image the browser can draw. */
  protected broken(): void {
    const url = this.url();
    if (url && !this.owned) this.cache?.discard(this.documentId(), url);
    this.clear();
  }

  private own(documentId: string): Observable<string | null> {
    return this.documents.fetchThumbnail(documentId).pipe(
      catchError(() => of(null)),
      map((blob) => {
        if (!blob || blob.size === 0) return null;
        this.owned = true;
        return URL.createObjectURL(blob);
      }),
    );
  }

  private clear(): void {
    const url = this.url();
    if (url && this.owned) URL.revokeObjectURL(url);
    this.owned = false;
    this.url.set(null);
  }
}
