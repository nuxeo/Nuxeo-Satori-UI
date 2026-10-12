import { DestroyRef, Injectable, inject, type Provider } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NEVER,
  ReplaySubject,
  Subject,
  catchError,
  concat,
  defer,
  finalize,
  of,
  takeUntil,
  type Observable,
} from 'rxjs';

import { DocumentDetailService } from '@nuxeo-satori/platform/nuxeo-client';

/** How many thumbnail requests one cache keeps in flight at once. */
export const NXS_THUMBNAIL_CONCURRENCY = 4;
/**
 * How long a thumbnail nothing shows is kept, in milliseconds, before its URL is revoked — long
 * enough for a view switch to show it again, short enough that a revisited page fetches afresh.
 */
export const NXS_THUMBNAIL_GRACE = 2000;

interface Entry {
  /** Replays the blob URL — or `null` when there is none — to every holder. */
  readonly url: ReplaySubject<string | null>;
  /** Ends the entry's request, if it is running, when the entry is dropped. */
  readonly cancel: Subject<void>;
  minted: string | null;
  holders: number;
  expiry: ReturnType<typeof setTimeout> | null;
}

/**
 * The thumbnails of one page, shared by every `nxs-thumbnail` under the component that provides it.
 *
 * Three things a per-thumbnail fetch cannot do. Two thumbnails of the same document share one
 * request and one blob URL. A view switch — list to cards — that destroys a thumbnail and creates
 * another for the same document reuses the URL instead of fetching again. And at most
 * `NXS_THUMBNAIL_CONCURRENCY` requests run at once, however many results the page renders.
 *
 * A URL nothing shows is revoked `NXS_THUMBNAIL_GRACE` after its last thumbnail goes, and every URL
 * when the providing component is destroyed. So nothing outlives the page, and a document shown
 * again later is fetched again, as it was before this cache existed.
 */
@Injectable()
export class NxsThumbnailCache {
  private readonly documents = inject(DocumentDetailService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly entries = new Map<string, Entry>();
  private readonly waiting: string[] = [];
  private running = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      // Emptied first: dropping a running request frees its slot, which would start a queued one.
      this.waiting.length = 0;
      for (const id of this.entries.keys()) this.drop(id);
    });
  }

  /**
   * The blob URL of a document's thumbnail — `null` when there is none — held for as long as it is
   * subscribed. The stream stays open once it has answered: unsubscribing is what lets the URL go.
   */
  lend(documentId: string): Observable<string | null> {
    return defer(() => {
      const entry = this.hold(documentId);
      return concat(entry.url, NEVER).pipe(finalize(() => this.letGo(documentId, entry)));
    });
  }

  /** The bytes behind `url` did not decode: forget the document, so the URL is not handed out again. */
  discard(documentId: string, url: string): void {
    if (this.entries.get(documentId)?.minted === url) this.drop(documentId);
  }

  private hold(documentId: string): Entry {
    let entry = this.entries.get(documentId);
    if (!entry) {
      entry = {
        url: new ReplaySubject(1),
        cancel: new Subject(),
        minted: null,
        holders: 0,
        expiry: null,
      };
      this.entries.set(documentId, entry);
      this.waiting.push(documentId);
      this.next();
    }
    if (entry.expiry) clearTimeout(entry.expiry);
    entry.expiry = null;
    entry.holders += 1;
    return entry;
  }

  private letGo(documentId: string, entry: Entry): void {
    // A dropped document may since have been fetched again; that entry is not this holder's.
    if (this.entries.get(documentId) !== entry) return;
    entry.holders -= 1;
    if (entry.holders === 0) {
      entry.expiry = setTimeout(() => this.drop(documentId), NXS_THUMBNAIL_GRACE);
    }
  }

  private next(): void {
    while (this.running < NXS_THUMBNAIL_CONCURRENCY && this.waiting.length > 0) {
      const documentId = this.waiting.shift() as string;
      const entry = this.entries.get(documentId);
      if (!entry) continue;
      this.running += 1;
      this.documents
        .fetchThumbnail(documentId)
        .pipe(
          catchError(() => of(null)),
          takeUntil(entry.cancel),
          takeUntilDestroyed(this.destroyRef),
          // Finished however it ends — answered, failed or cancelled by `drop`.
          finalize(() => {
            this.running -= 1;
            this.next();
          }),
        )
        .subscribe((blob) => {
          if (blob && blob.size > 0) entry.minted = URL.createObjectURL(blob);
          entry.url.next(entry.minted);
          entry.url.complete();
        });
    }
  }

  private drop(documentId: string): void {
    const entry = this.entries.get(documentId);
    if (!entry) return;
    this.entries.delete(documentId);
    const queued = this.waiting.indexOf(documentId);
    if (queued >= 0) this.waiting.splice(queued, 1);
    if (entry.expiry) clearTimeout(entry.expiry);
    entry.cancel.next();
    entry.cancel.complete();
    if (entry.minted) URL.revokeObjectURL(entry.minted);
    entry.url.complete();
  }
}

/** Lists `NxsThumbnailCache` in a page component's `providers`, for every thumbnail under it. */
export function provideNxsThumbnailCache(): Provider {
  return NxsThumbnailCache;
}
