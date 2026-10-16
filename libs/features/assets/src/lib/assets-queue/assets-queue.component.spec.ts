import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { Subject, of, type Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DocumentDetailService,
  AssetAggregationService,
  type AssetQueueItem,
} from '@nuxeo/satori-platform/nuxeo-client';

import { AssetsQueueComponent } from './assets-queue.component';

/**
 * Covers the object-URL ledger, which is the only thing in this component that can misbehave silently.
 *
 * The effect that fetches thumbnails only ever ADDED: `objectUrls` and `thumbnailMap` kept every id
 * they had ever seen until `onDestroy`, and this queue stays mounted across searches. So every prior
 * result's thumbnail blob was retained for the lifetime of the page, growing without bound. The
 * per-id revoke-before-replace already there only covers re-fetching the *same* id; it never saw an id
 * that simply stopped being in the results.
 *
 * This is the first spec in the `assets` project, which had none — so `nx test assets` reported
 * success over zero coverage. The component it covers is a near-copy of `search-queue`, and it had
 * the identical defect; the two were fixed together.
 *
 * Create and revoke are asserted as a PAIR. Counting only creates cannot detect a leak, and counting
 * only revokes cannot detect over-revocation — the two failure modes are opposite and both matter. *
 * The REAL template renders — no `overrideComponent` stub. The repository requires external templates,
 * and although a TestBed override is arguably a different thing from authoring one, review asked twice
 * and the alternative it offered turned out to be simply better: rendering the real `templateUrl` costs
 * nothing here, adds fidelity, and leaves no convention question to argue about. I should have tried it
 * before defending the stub.
 */
describe('AssetsQueueComponent — thumbnail object URL lifecycle', () => {
  let fixture: ComponentFixture<AssetsQueueComponent>;
  let component: AssetsQueueComponent;

  const items = signal<AssetQueueItem[]>([]);
  /**
   * Hoisted so a test can leave a request PENDING. The default resolves synchronously, which is what
   * every other test here wants — and is also why the late-response guard had no coverage: a
   * synchronous `of(...)` callback runs inside the effect, when the id is always still active.
   */
  const fetchThumbnail = vi.fn((_uid?: string): Observable<Blob | null> => of(new Blob(['thumb'])));

  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;

  function item(id: string): AssetQueueItem {
    return { id, title: id, type: 'File' } as unknown as AssetQueueItem;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
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
      imports: [AssetsQueueComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AssetAggregationService, useValue: { items } },
        { provide: DocumentDetailService, useValue: { fetchThumbnail } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AssetsQueueComponent);
    component = fixture.componentInstance;
  });

  /** Publishes a result set and lets the effect run. */
  function withResults(...ids: string[]): void {
    items.set(ids.map(item));
    fixture.detectChanges();
  }

  it('mints a thumbnail URL per result', () => {
    withResults('doc1', 'doc2');

    expect(created).toHaveLength(2);
    expect(component.thumbnailMap()['doc1']).toBe(created[0]);
    expect(component.thumbnailMap()['doc2']).toBe(created[1]);
    expect(revoked).toHaveLength(0);
  });

  it('revokes and forgets the URL of a result that left the list', () => {
    withResults('doc1', 'doc2');
    const [urlOne, urlTwo] = created;

    // A second search returns only doc2. Before the fix, doc1's URL stayed in both maps until the
    // drawer was destroyed, so repeated searches retained every thumbnail ever fetched.
    withResults('doc2');

    expect(revoked).toContain(urlOne);
    expect(revoked).not.toContain(urlTwo);
    expect(component.thumbnailMap()['doc1']).toBeUndefined();
    expect(component.thumbnailMap()['doc2']).toBe(urlTwo);
  });

  it('does not accumulate across repeated disjoint searches', () => {
    // The unbounded-growth case stated directly: three searches with no overlap must leave exactly one
    // live URL, not three.
    withResults('a');
    withResults('b');
    withResults('c');

    expect(created).toHaveLength(3);
    expect(revoked).toHaveLength(2);
    expect(Object.keys(component.thumbnailMap())).toEqual(['c']);
  });

  it('keeps a result that survives a search, without re-fetching or re-minting it', () => {
    // The positive control. Reconciliation must not revoke something still on screen, which would show
    // a broken image, and must not re-fetch it either.
    withResults('doc1', 'doc2');
    expect(created).toHaveLength(2);
    const survivor = component.thumbnailMap()['doc2'];

    withResults('doc2', 'doc3');

    expect(component.thumbnailMap()['doc2']).toBe(survivor);
    expect(revoked).not.toContain(survivor);
    expect(created).toHaveLength(3);
  });

  it('drops a late response for a result that already left the list', () => {
    // The guard this exercises could not be reached before: with a synchronous `of(...)` the callback
    // runs inside the effect, while the id is still active. Only a pending request can arrive after its
    // item has gone, which is the case that mints an orphaned URL — one nothing renders and nothing
    // revokes until teardown.
    const pending = new Subject<Blob | null>();
    fetchThumbnail.mockImplementation((uid?: string) =>
      uid === 'slow' ? pending.asObservable() : of(new Blob(['thumb'])),
    );

    withResults('slow');
    expect(created).toHaveLength(0);

    // A new search drops 'slow' while its thumbnail is still in flight.
    withResults('other');
    expect(created).toHaveLength(1);

    pending.next(new Blob(['late']));
    pending.complete();

    // No URL minted for the departed id, and nothing added to the map.
    expect(created).toHaveLength(1);
    expect(component.thumbnailMap()['slow']).toBeUndefined();
    expect(Object.keys(component.thumbnailMap())).toEqual(['other']);
  });

  it('still accepts a response that arrives while its result is present', () => {
    // The positive control for the same path: a pending request whose id is STILL active must be
    // honoured, or the guard would just be dropping everything asynchronous.
    const pending = new Subject<Blob | null>();
    fetchThumbnail.mockImplementation(() => pending.asObservable());

    withResults('doc1');
    expect(created).toHaveLength(0);

    pending.next(new Blob(['late but valid']));
    pending.complete();

    expect(created).toHaveLength(1);
    expect(component.thumbnailMap()['doc1']).toBe(created[0]);
  });

  it('revokes everything still held on destroy', () => {
    withResults('doc1', 'doc2');

    fixture.destroy();

    for (const url of created) expect(revoked).toContain(url);
  });
});
