import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';

import {
  CollectionService,
  CURRENT_USERNAME,
  DirectoryService,
  DocumentDetailService,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { CollectionDetailComponent } from './collection-detail';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

/**
 * These render the REAL template, unlike `collection-detail.spec.ts`, which replaces it with
 * `<div></div>`. That matters here: the defect being guarded is that a collection which does not
 * exist still drew its full surface — header, tabs, Delete, Export — because the template read
 * `collection()?.title ?? 'Collection'` and never asked whether the load had succeeded. A test
 * against component state alone would pass whether or not the markup was fixed.
 */

// jsdom does not implement it, and the real template pulls in Satori breadcrumbs and the Material
// tab strip, both of which observe their host on construction.
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
};

const collection: NuxeoDocument = {
  uid: 'collection-1',
  title: 'Q3 Contracts',
  type: 'Collection',
  path: '/default-domain/collections/q3',
  state: 'project',
  isCheckedOut: true,
  lastModified: '2026-09-01T10:00:00.000Z',
  properties: {},
} as unknown as NuxeoDocument;

const httpError = (status: number) => throwError(() => ({ status }));

const mockCollectionService = {
  getById: vi.fn((): Observable<NuxeoDocument | null> => of(null)),
  getCollectionMembers: vi.fn((): Observable<{ entries: NuxeoDocument[]; totalSize: number }> =>
    of({ entries: [], totalSize: 0 }),
  ),
  bulkDownload: vi.fn((): Observable<Blob> => of(new Blob())),
};

const mockDetailService = {
  getFullDocument: vi.fn((): Observable<NuxeoDocument | null> => of(null)),
  fetchThumbnail: vi.fn((): Observable<Blob | null> => of(null)),
};

const mockDirectoryService = {
  getDirectoryEntries: vi.fn((): Observable<unknown[]> => of([])),
};

/** Every control the page must not offer for a collection that did not load. */
const ACTION_LABELS = ['Delete', 'Export', 'Edit', 'Refresh'];

describe('CollectionDetailComponent — unresolved collection', () => {
  let fixture: ComponentFixture<CollectionDetailComponent>;
  let component: CollectionDetailComponent;

  const build = async () => {
    await TestBed.configureTestingModule({
      // The app bootstraps translation, not the feature; the real template reaches it through
      // child components, so the test has to supply it.
      imports: [CollectionDetailComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ uid: 'collection-1' })) },
        },
        { provide: CURRENT_USERNAME, useValue: () => 'jdoe' },
        { provide: CollectionService, useValue: mockCollectionService },
        { provide: DocumentDetailService, useValue: mockDetailService },
        { provide: DirectoryService, useValue: mockDirectoryService },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const actionButtons = () =>
    Array.from(fixture.nativeElement.querySelectorAll('button[aria-label]')).filter((b) =>
      ACTION_LABELS.includes((b as HTMLElement).getAttribute('aria-label') ?? ''),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockDetailService.fetchThumbnail.mockReturnValue(of(null));
    mockCollectionService.getCollectionMembers.mockReturnValue(of({ entries: [], totalSize: 0 }));
  });

  it('reports a 404 as not-found and offers no actions on it', async () => {
    mockDetailService.getFullDocument.mockReturnValue(httpError(404));
    mockCollectionService.getById.mockReturnValue(httpError(404));

    await build();

    expect(component.loadState()).toBe('not-found');
    expect(fixture.nativeElement.textContent).toContain('Collection not found');
    // The heart of the defect: the surface used to render in full for a collection that does not
    // exist, offering Delete and Export against nothing.
    expect(actionButtons()).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain('Q3 Contracts');
  });

  it('distinguishes an unreachable collection from a missing one', async () => {
    mockDetailService.getFullDocument.mockReturnValue(httpError(500));
    mockCollectionService.getById.mockReturnValue(httpError(500));

    await build();

    // Saying "does not exist" on a 500 would be a guess, and would send the user to recreate
    // something that is merely unreachable.
    expect(component.loadState()).toBe('error');
    expect(fixture.nativeElement.textContent).toContain('Collection unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('Collection not found');
    expect(actionButtons()).toEqual([]);
  });

  it('still renders the collection and its actions when the load succeeds', async () => {
    mockDetailService.getFullDocument.mockReturnValue(of(collection));
    mockCollectionService.getById.mockReturnValue(of(collection));

    await build();

    // The over-correction this guards against is a fix that hides the page for everyone. Without
    // this assertion, returning `not-found` unconditionally would pass the two tests above.
    expect(component.loadState()).toBe('loaded');
    expect(fixture.nativeElement.textContent).toContain('Q3 Contracts');
    expect(actionButtons().length).toBeGreaterThan(0);
    expect(fixture.nativeElement.textContent).not.toContain('Collection not found');
  });

  it('recovers when a retried load succeeds', async () => {
    mockDetailService.getFullDocument.mockReturnValue(httpError(500));
    mockCollectionService.getById.mockReturnValue(httpError(500));

    await build();
    expect(component.loadState()).toBe('error');

    mockDetailService.getFullDocument.mockReturnValue(of(collection));
    component.retryLoad();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.loadState()).toBe('loaded');
    expect(actionButtons().length).toBeGreaterThan(0);
  });
});
