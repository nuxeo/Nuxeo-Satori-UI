import { Component, input, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { NXS_TRASH_LIST_ID, type NxsTrashListResults } from '@nuxeo/satori-platform/components';
import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';
import {
  DocumentDetailService,
  SearchService,
  TrashFilterService,
  TrashService,
  type NuxeoDocument,
  type TrashFilters,
} from '@nuxeo/satori-platform/nuxeo-client';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { TrashComponent } from './trash.component';

/** A stand-in replacement, distinct from the packaged list so the assertions can tell them apart. */
@Component({
  selector: 'lib-replacement-trash-list',
  standalone: true,
  template: '<p>replacement</p>',
})
class ReplacementTrashListComponent {
  readonly filters = input<TrashFilters | null>(null);
  readonly openHandler = input<((doc: NuxeoDocument) => void) | null>(null);
  readonly resultsHandler = input<((results: NxsTrashListResults) => void) | null>(null);
}

const NOTE = { uid: 'uid-1', title: 'Note 1', type: 'Note' } as NuxeoDocument;

describe('TrashComponent', () => {
  let fixture: ComponentFixture<TrashComponent>;
  const navigateByUrl = vi.fn(() => Promise.resolve(true));
  const searchTrash = vi.fn(() => of({ entries: [NOTE], resultsCount: 1 }));
  const updateSearch = vi.fn(() => of({ uid: 'saved-1', title: 'Mine', params: {} }));

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [TrashComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: { navigateByUrl, url: '/trash' } },
        { provide: TrashService, useValue: { searchTrash, updateSearch } },
        { provide: SearchService, useValue: { deleteSavedSearch: vi.fn(() => of({})) } },
        {
          provide: DocumentDetailService,
          useValue: { fetchThumbnail: () => throwError(() => ({ status: 404 })) },
        },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();
  });

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(TrashComponent);
    await render();
  }

  it('renders the packaged nxs-trash-list when no registration resolves the ID', async () => {
    await create();
    expect(fixture.nativeElement.querySelector('nxs-trash-list')).not.toBeNull();
    expect(searchTrash).toHaveBeenCalled();
  });

  it('renders a registered replacement in place of the packaged list, with the same inputs', async () => {
    TestBed.inject(ExtensionComponentRegistry).register({
      [NXS_TRASH_LIST_ID]: ReplacementTrashListComponent,
    });
    await create();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('lib-replacement-trash-list')).not.toBeNull();
    expect(element.querySelector('nxs-trash-list')).toBeNull();
    expect(searchTrash).not.toHaveBeenCalled();

    // The replacement is handed the same inputs, and they stay live.
    const replacement = fixture.debugElement.query(
      (node) => node.componentInstance instanceof ReplacementTrashListComponent,
    ).componentInstance as ReplacementTrashListComponent;
    const filters = TestBed.inject(TrashFilterService);
    expect(replacement.filters()).toEqual(filters.filters());
    filters.filters.set({ fullText: 'invoice', path: '/ws', author: '', sizeRanges: [] });
    await render();
    expect(replacement.filters()).toEqual(
      expect.objectContaining({ fullText: 'invoice', path: '/ws' }),
    );

    replacement.openHandler()?.(NOTE);
    expect(navigateByUrl).toHaveBeenCalledWith('/doc/uid-1');
    replacement.resultsHandler()?.({ loading: false, documents: [NOTE], totalSize: 7 });
    expect(filters.totalResults()).toBe(7);
    expect(filters.results()).toEqual([{ uid: 'uid-1', title: 'Note 1', type: 'Note' }]);
  });

  it('searches the trash with the drawer’s filters', async () => {
    const filters = TestBed.inject(TrashFilterService);
    await create();
    filters.filters.set({ fullText: 'invoice', path: '/ws', author: 'jdoe', sizeRanges: ['tiny'] });
    await render();
    expect(searchTrash).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fullText: 'invoice',
        path: '/ws',
        author: 'jdoe',
        sizeRanges: ['tiny'],
      }),
    );
  });

  it('mirrors what the list shows into the drawer’s results, and opens a document by route', async () => {
    await create();
    const filters = TestBed.inject(TrashFilterService);
    expect(filters.results()).toEqual([{ uid: 'uid-1', title: 'Note 1', type: 'Note' }]);
    expect(filters.totalResults()).toBe(1);
    expect(filters.resultsLoading()).toBe(false);

    const inputs = (
      fixture.componentInstance as unknown as {
        listInputs(): {
          openHandler(doc: NuxeoDocument): void;
          resultsHandler(results: NxsTrashListResults): void;
        };
      }
    ).listInputs();
    inputs.resultsHandler({ loading: true, documents: [], totalSize: 0 });
    expect(filters.resultsLoading()).toBe(true);
    expect(filters.results()).toHaveLength(1);

    inputs.openHandler(NOTE);
    expect(navigateByUrl).toHaveBeenCalledWith('/doc/uid-1');
  });

  it('saves the drawer’s filters into the open saved search', async () => {
    const filters = TestBed.inject(TrashFilterService);
    filters.activeSavedFilterUid.set('saved-1');
    filters.activeSavedFilterTitle.set('Mine');
    filters.filters.set({ fullText: 'q', path: '/ws', author: 'jdoe', sizeRanges: ['tiny'] });
    await create();
    fixture.componentInstance.saveSearch();
    expect(updateSearch).toHaveBeenCalledWith('saved-1', 'Mine', {
      ecm_fulltext: 'q',
      ecm_path: '/ws',
      dc_creator: 'jdoe',
      common_size: ['tiny'],
    });
    filters.reset();
  });
});
