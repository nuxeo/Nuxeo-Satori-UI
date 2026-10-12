import { Component, inject, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentDetailService } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsThumbnailComponent } from './thumbnail.component';
import {
  NXS_THUMBNAIL_CONCURRENCY,
  NXS_THUMBNAIL_GRACE,
  NxsThumbnailCache,
  provideNxsThumbnailCache,
} from './thumbnail-cache';

/** A page that provides the cache, and renders thumbnails it can switch between two views. */
@Component({
  standalone: true,
  imports: [NxsThumbnailComponent],
  providers: [provideNxsThumbnailCache()],
  template: `
    @if (shown()) {
      @if (cards()) {
        @for (id of ids(); track id) {
          <nxs-thumbnail class="probe-card" [documentId]="id"><i>icon</i></nxs-thumbnail>
        }
      } @else {
        @for (id of ids(); track id) {
          <nxs-thumbnail class="probe-row" [documentId]="id"><i>icon</i></nxs-thumbnail>
        }
      }
    }
  `,
})
class PageComponent {
  readonly ids = signal<string[]>(['doc-1']);
  readonly cards = signal(false);
  readonly shown = signal(true);
  readonly cache = inject(NxsThumbnailCache);
}

describe('NxsThumbnailCache', () => {
  let fixture: ComponentFixture<PageComponent>;
  let page: PageComponent;
  let requests: Map<string, Subject<Blob>>;
  let fetchThumbnail: ReturnType<typeof vi.fn>;
  let created: string[];
  let revoked: string[];

  const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function images(): string[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('img')].map(
      (img) => img.getAttribute('src') ?? '',
    );
  }

  function answer(id: string, blob: Blob = png()): void {
    requests.get(id)?.next(blob);
    requests.get(id)?.complete();
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    requests = new Map();
    created = [];
    revoked = [];
    let counter = 0;
    // jsdom implements neither, so they are installed rather than spied on, and removed after.
    Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        const url = `blob:cache-${++counter}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revoked.push(url);
      }),
    });
    fetchThumbnail = vi.fn((id: string): Observable<Blob> => {
      const subject = new Subject<Blob>();
      requests.set(id, subject);
      return subject;
    });

    await TestBed.configureTestingModule({
      imports: [PageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DocumentDetailService, useValue: { fetchThumbnail } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PageComponent);
    page = fixture.componentInstance;
    await render();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
  });

  it('gives two thumbnails of one document one request and one URL', async () => {
    page.ids.set(['doc-1', 'doc-1']);
    await render();
    answer('doc-1');
    await render();

    expect(fetchThumbnail).toHaveBeenCalledTimes(1);
    expect(images()).toEqual(['blob:cache-1', 'blob:cache-1']);
  });

  it('reuses the URL across a view switch instead of fetching again', async () => {
    answer('doc-1');
    await render();
    expect(images()).toEqual(['blob:cache-1']);

    page.cards.set(true);
    await render();

    expect(
      fixture.nativeElement.querySelector('nxs-thumbnail.probe-card img')?.getAttribute('src'),
    ).toBe('blob:cache-1');
    expect(fetchThumbnail).toHaveBeenCalledTimes(1);
    expect(revoked).toEqual([]);
  });

  it('keeps a URL that is still shown, however long it stays on screen', async () => {
    answer('doc-1');
    await render();

    vi.advanceTimersByTime(NXS_THUMBNAIL_GRACE * 10);
    await render();

    expect(revoked).toEqual([]);
    expect(images()).toEqual(['blob:cache-1']);
  });

  it('revokes a URL nothing shows once the grace period has passed', async () => {
    answer('doc-1');
    await render();
    page.ids.set([]);
    await render();

    vi.advanceTimersByTime(NXS_THUMBNAIL_GRACE - 1);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(revoked).toEqual(['blob:cache-1']);

    // Shown again later, it is fetched afresh rather than handed a revoked URL.
    page.ids.set(['doc-1']);
    await render();
    expect(fetchThumbnail).toHaveBeenCalledTimes(2);
  });

  it('runs no more than its concurrency limit of requests at once', async () => {
    const ids = Array.from({ length: NXS_THUMBNAIL_CONCURRENCY + 2 }, (_, i) => `doc-${i}`);
    page.ids.set(ids);
    await render();
    expect(fetchThumbnail).toHaveBeenCalledTimes(NXS_THUMBNAIL_CONCURRENCY);

    answer('doc-0');
    await render();
    expect(fetchThumbnail).toHaveBeenCalledTimes(NXS_THUMBNAIL_CONCURRENCY + 1);

    // A failed request frees its slot too.
    requests.get('doc-1')?.error(new Error('500'));
    await render();
    expect(fetchThumbnail).toHaveBeenCalledTimes(NXS_THUMBNAIL_CONCURRENCY + 2);
  });

  it('revokes every URL, and starts nothing queued, when the page is destroyed', async () => {
    const ids = Array.from({ length: NXS_THUMBNAIL_CONCURRENCY + 3 }, (_, i) => `doc-${i}`);
    page.ids.set(ids);
    await render();
    answer('doc-0');
    await render();
    // doc-0 answered and doc-4 took its slot: doc-1..doc-4 in flight, doc-5 and doc-6 queued.
    expect(fetchThumbnail).toHaveBeenCalledTimes(NXS_THUMBNAIL_CONCURRENCY + 1);

    fixture.destroy();

    expect(revoked).toEqual(created);
    expect(created).toHaveLength(1);
    expect(fetchThumbnail).toHaveBeenCalledTimes(NXS_THUMBNAIL_CONCURRENCY + 1);
    // Cancelled, not merely unanswered: an answer now mints nothing.
    answer('doc-1');
    expect(created).toHaveLength(1);
  });

  it('hands out no URL for a failed request or an empty rendition', async () => {
    page.ids.set(['doc-err', 'doc-empty']);
    await render();
    requests.get('doc-err')?.error(new Error('404'));
    answer('doc-empty', new Blob([]));
    await render();

    expect(images()).toEqual([]);
    expect(created).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('i')).toHaveLength(2);
  });

  it('forgets a URL whose bytes do not decode, so the next thumbnail fetches again', async () => {
    answer('doc-1');
    await render();
    fixture.nativeElement.querySelector('img')?.dispatchEvent(new Event('error'));
    await render();

    expect(revoked).toEqual(['blob:cache-1']);
    expect(images()).toEqual([]);

    page.cards.set(true);
    await render();
    expect(fetchThumbnail).toHaveBeenCalledTimes(2);
  });

  it('ignores a discard of a URL it does not hold', async () => {
    answer('doc-1');
    await render();

    page.cache.discard('doc-1', 'blob:other');
    page.cache.discard('never-lent', 'blob:other');

    expect(revoked).toEqual([]);
    expect(images()).toEqual(['blob:cache-1']);
  });

  it('does not let a holder of a forgotten entry release the one fetched after it', () => {
    const stale = page.cache.lend('doc-x').subscribe();
    answer('doc-x');
    page.cache.discard('doc-x', created[0]);
    const fresh = page.cache.lend('doc-x').subscribe();
    answer('doc-x');
    expect(created).toHaveLength(2);

    stale.unsubscribe();
    vi.advanceTimersByTime(NXS_THUMBNAIL_GRACE * 2);
    expect(revoked).toEqual([created[0]]);

    fresh.unsubscribe();
    vi.advanceTimersByTime(NXS_THUMBNAIL_GRACE);
    expect(revoked).toEqual(created);
  });

  it('drops a request still in flight when nothing shows its document past the grace', async () => {
    page.ids.set([]);
    await render();
    vi.advanceTimersByTime(NXS_THUMBNAIL_GRACE);

    answer('doc-1');
    expect(created).toEqual([]);
  });
});
