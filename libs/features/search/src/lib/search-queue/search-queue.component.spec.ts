import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { Subject, of, type Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DocumentDetailService,
  SearchAggregationService,
  type SearchResultItem,
} from '@nuxeo-satori/platform/nuxeo-client';

import { SearchQueueComponent } from './search-queue.component';

/**
 * Covers the queue's thumbnails, which `nxs-thumbnail` now fetches and revokes per result. The queue
 * stays mounted across searches, so the case that matters is a result leaving the list: its URL must
 * be revoked then — once the cache's grace period runs out — not at teardown — an earlier ledger in this component only ever added, and kept
 * every thumbnail ever fetched for the life of the page.
 *
 * Create and revoke are asserted as a PAIR. Counting only creates cannot detect a leak, and counting
 * only revokes cannot detect over-revocation — the two failure modes are opposite and both matter. *
 * The REAL template renders — no `overrideComponent` stub. The repository requires external templates,
 * and although a TestBed override is arguably a different thing from authoring one, review asked twice
 * and the alternative it offered turned out to be simply better: rendering the real `templateUrl` costs
 * nothing here, adds fidelity, and leaves no convention question to argue about. I should have tried it
 * before defending the stub.
 */
describe('SearchQueueComponent — thumbnails', () => {
  let fixture: ComponentFixture<SearchQueueComponent>;

  const items = signal<SearchResultItem[]>([]);
  /**
   * Hoisted so a test can leave a request PENDING. The default resolves synchronously, which is what
   * every other test here wants — and is also why the late-response guard had no coverage: a
   * synchronous `of(...)` callback runs inside the effect, when the id is always still active.
   */
  const fetchThumbnail = vi.fn((_uid?: string): Observable<Blob | null> => of(new Blob(['thumb'])));

  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;

  function item(id: string): SearchResultItem {
    return { id, title: id, type: 'File' } as unknown as SearchResultItem;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    // The queue's thumbnail cache keeps a URL briefly after its result leaves, for a view switch to
    // reuse; these tests run that grace period out rather than wait for it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    created.length = 0;
    revoked.length = 0;
    seq = 0;
    items.set([]);
    fetchThumbnail.mockImplementation(() => of(new Blob(['thumb'])));

    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => {
      const url = `blob:mock/${(seq += 1)}`;
      created.push(url);
      return url;
    });
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn((u: string) => {
      revoked.push(u);
    });

    await TestBed.configureTestingModule({
      imports: [SearchQueueComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SearchAggregationService, useValue: { items } },
        { provide: DocumentDetailService, useValue: { fetchThumbnail } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchQueueComponent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Lets the cache's grace period for results that left the list run out. */
  function graceElapses(): void {
    vi.runOnlyPendingTimers();
  }

  /** Publishes a result set and lets each thumbnail request start and answer. */
  async function withResults(...ids: string[]): Promise<void> {
    items.set(ids.map(item));
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The image each result shows, by result id; absent while it shows its type icon. */
  function shown(): Record<string, string> {
    const host = fixture.nativeElement as HTMLElement;
    return Object.fromEntries(
      [...host.querySelectorAll('.queue-item')].flatMap((row) => {
        const img = row.querySelector('img');
        const title = row.querySelector('.queue-item-title')?.textContent?.trim() ?? '';
        return img ? [[title, img.getAttribute('src') ?? '']] : [];
      }),
    );
  }

  it('shows a thumbnail per result, from a blob URL, named by the title', async () => {
    await withResults('doc1', 'doc2');

    expect(created).toHaveLength(2);
    expect(shown()).toEqual({ doc1: created[0], doc2: created[1] });
    const img = (fixture.nativeElement as HTMLElement).querySelector('.queue-item img');
    expect(img?.getAttribute('alt')).toBe('doc1');
    expect(revoked).toHaveLength(0);
  });

  it('revokes the URL of a result that left the list', async () => {
    await withResults('doc1', 'doc2');
    const [urlOne, urlTwo] = created;

    // A second search returns only doc2.
    await withResults('doc2');
    expect(revoked).toEqual([]);
    graceElapses();

    expect(revoked).toContain(urlOne);
    expect(revoked).not.toContain(urlTwo);
    expect(shown()).toEqual({ doc2: urlTwo });
  });

  it('does not accumulate across repeated disjoint searches', async () => {
    // The unbounded-growth case stated directly: three searches with no overlap must leave exactly one
    // live URL, not three.
    await withResults('a');
    await withResults('b');
    await withResults('c');
    graceElapses();

    expect(created).toHaveLength(3);
    expect(revoked).toHaveLength(2);
    expect(Object.keys(shown())).toEqual(['c']);
  });

  it('keeps a result that survives a search, without re-fetching or re-minting it', async () => {
    // The positive control. Reconciliation must not revoke something still on screen, which would show
    // a broken image, and must not re-fetch it either.
    await withResults('doc1', 'doc2');
    expect(created).toHaveLength(2);
    const survivor = shown()['doc2'];

    await withResults('doc2', 'doc3');

    expect(shown()['doc2']).toBe(survivor);
    expect(fetchThumbnail.mock.calls.filter(([id]) => id === 'doc2')).toHaveLength(1);
    expect(revoked).not.toContain(survivor);
    expect(created).toHaveLength(3);
  });

  it('does not keep a URL for a result that left the list, even when its response is late', async () => {
    // Only a pending request can arrive after its item has gone, which is the case that would mint an
    // orphaned URL — one nothing renders and nothing revokes until teardown.
    const pending = new Subject<Blob | null>();
    fetchThumbnail.mockImplementation((uid?: string) =>
      uid === 'slow' ? pending.asObservable() : of(new Blob(['thumb'])),
    );

    await withResults('slow');
    expect(created).toHaveLength(0);

    // A new search drops 'slow' while its thumbnail is still in flight.
    await withResults('other');
    expect(created).toHaveLength(1);

    pending.next(new Blob(['late']));
    pending.complete();
    await settle();
    graceElapses();

    // Whatever the late answer minted is revoked; only the result on screen keeps one.
    expect(Object.keys(shown())).toEqual(['other']);
    expect(created.filter((url) => !revoked.includes(url))).toEqual([shown()['other']]);
  });

  it('still accepts a response that arrives while its result is present', async () => {
    // The positive control for the same path: a pending request whose id is STILL active must be
    // honoured, or the guard would just be dropping everything asynchronous.
    const pending = new Subject<Blob | null>();
    fetchThumbnail.mockImplementation(() => pending.asObservable());

    await withResults('doc1');
    expect(created).toHaveLength(0);

    pending.next(new Blob(['late but valid']));
    pending.complete();
    await settle();

    expect(created).toHaveLength(1);
    expect(shown()).toEqual({ doc1: created[0] });
  });

  it('revokes everything still held on destroy', async () => {
    await withResults('doc1', 'doc2');

    fixture.destroy();

    for (const url of created) expect(revoked).toContain(url);
  });
});

describe('SearchQueueComponent — outputs', () => {
  let fixture: ComponentFixture<SearchQueueComponent>;
  const items = signal<SearchResultItem[]>([
    { id: 'doc1', title: 'doc1', type: 'File' } as unknown as SearchResultItem,
  ]);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchQueueComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SearchAggregationService, useValue: { items } },
        { provide: DocumentDetailService, useValue: { fetchThumbnail: () => of(null) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SearchQueueComponent);
    fixture.componentRef.setInput('activeFilters', [
      { label: 'PDF', value: 'pdf', selected: false },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('reports a press on a result and on a quick filter, and a switch to the filters', () => {
    const queue = fixture.componentInstance;
    const host = fixture.nativeElement as HTMLElement;
    const selected: string[] = [];
    const toggled: string[] = [];
    let switched = 0;
    queue.itemSelected.subscribe((item) => selected.push(item.id));
    queue.quickFilterToggled.subscribe((value) => toggled.push(value));
    queue.switchToFilter.subscribe(() => (switched += 1));

    host.querySelector<HTMLButtonElement>('.queue-item')?.click();
    host.querySelector<HTMLButtonElement>('.quick-filter-btn')?.click();
    queue.onSwitchToFilter();

    expect(selected).toEqual(['doc1']);
    expect(toggled).toEqual(['pdf']);
    expect(switched).toBe(1);
  });
});
