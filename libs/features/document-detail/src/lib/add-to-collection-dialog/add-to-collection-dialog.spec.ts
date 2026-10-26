import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';

import {
  DocumentDetailService,
  type NuxeoDocument,
  type NuxeoDocumentList,
} from '@nuxeo/satori-platform/nuxeo-client';

import { AddToCollectionDialogComponent } from './add-to-collection-dialog';

function collection(uid: string, title: string): NuxeoDocument {
  return {
    uid,
    title,
    type: 'Collection',
    path: `/default-domain/collections/${uid}`,
    lastModified: '2026-08-01T00:00:00.000Z',
    properties: { 'dc:title': title },
  };
}

function documentList(entries: NuxeoDocument[]): NuxeoDocumentList {
  return {
    entries,
    totalSize: entries.length,
    resultsCount: entries.length,
    currentPageSize: entries.length,
    currentPageIndex: 0,
    numberOfPages: 1,
    isNextPageAvailable: false,
  };
}

const existingCollections: NuxeoDocument[] = [
  collection('col-1', 'Marketing'),
  collection('col-2', 'Engineering'),
];

const mockDialogRef = {
  close: vi.fn(),
};

const mockDetailService = {
  getCollections: vi.fn((): Observable<NuxeoDocumentList> => of(documentList([]))),
  createCollection: vi.fn((_title: string): Observable<NuxeoDocument> =>
    of(collection('col-new', 'New')),
  ),
};

async function createDialog(): Promise<{
  component: AddToCollectionDialogComponent;
  fixture: ComponentFixture<AddToCollectionDialogComponent>;
}> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [AddToCollectionDialogComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: MatDialogRef, useValue: mockDialogRef },
      { provide: DocumentDetailService, useValue: mockDetailService },
    ],
  })
    .overrideComponent(AddToCollectionDialogComponent, {
      set: { imports: [], template: '<div></div>' },
    })
    .compileComponents();

  const fixture = TestBed.createComponent(AddToCollectionDialogComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();
  return { component, fixture };
}

describe('AddToCollectionDialogComponent', () => {
  let component: AddToCollectionDialogComponent;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset implementations explicitly: `vi.clearAllMocks()` leaves `mockReturnValue` in place.
    mockDetailService.getCollections.mockReturnValue(of(documentList(existingCollections)));
    mockDetailService.createCollection.mockReturnValue(of(collection('col-3', 'Legal')));

    ({ component } = await createDialog());
  });

  describe('ngOnInit', () => {
    it('loads the collection list and clears the loading flag', () => {
      expect(mockDetailService.getCollections).toHaveBeenCalled();
      expect(component.collections().map((c) => c.uid)).toEqual(['col-1', 'col-2']);
      expect(component.loading()).toBe(false);
    });

    it('releases the loading flag when the list fails to load', async () => {
      // The success case above proves the list can be populated, so the empty list asserted
      // here is a statement about the error path, not about nothing.
      mockDetailService.getCollections.mockReturnValue(throwError(() => new Error('boom')));

      const { component: failed } = await createDialog();

      // A stuck spinner hides the picker entirely — the dialog becomes unusable.
      expect(failed.loading()).toBe(false);
      expect(failed.collections()).toEqual([]);
    });
  });

  describe('filteredCollections', () => {
    it('returns every collection when the search box is empty', () => {
      expect(component.filteredCollections().map((c) => c.uid)).toEqual(['col-1', 'col-2']);
    });

    it('matches case-insensitively on a substring of the title', () => {
      component.searchTerm.set('eNGiN');
      expect(component.filteredCollections().map((c) => c.uid)).toEqual(['col-2']);
    });

    it('returns nothing when no title matches', () => {
      component.searchTerm.set('nope');
      expect(component.filteredCollections()).toEqual([]);
    });
  });

  describe('showCreateOption', () => {
    it('is hidden while the search box is empty or whitespace only', () => {
      component.searchTerm.set('');
      expect(component.showCreateOption()).toBe(false);

      component.searchTerm.set('   ');
      expect(component.showCreateOption()).toBe(false);
    });

    it('is offered for a name that does not exist yet', () => {
      component.searchTerm.set('Legal');
      expect(component.showCreateOption()).toBe(true);
    });

    it('is withheld when a collection with that name already exists, ignoring case', () => {
      component.searchTerm.set('marketing');
      expect(component.showCreateOption()).toBe(false);
    });
  });

  describe('createNewCollection', () => {
    it('creates with the trimmed search term, selects it and clears the box', () => {
      component.searchTerm.set('  Legal  ');

      component.createNewCollection();

      expect(mockDetailService.createCollection).toHaveBeenCalledWith('Legal');
      expect(component.collections().map((c) => c.uid)).toEqual(['col-1', 'col-2', 'col-3']);
      expect(component.selectedCollectionId).toBe('col-3');
      expect(component.searchTerm()).toBe('');
      expect(component.creating()).toBe(false);
    });

    it('refuses to create from an empty or whitespace-only name', () => {
      component.searchTerm.set('   ');
      component.createNewCollection();
      expect(mockDetailService.createCollection).not.toHaveBeenCalled();
    });

    it('refuses to create while a create is already in flight', () => {
      component.searchTerm.set('Legal');
      component.creating.set(true);

      component.createNewCollection();

      expect(mockDetailService.createCollection).not.toHaveBeenCalled();
    });

    it('releases the creating flag on failure and keeps the typed name', () => {
      mockDetailService.createCollection.mockReturnValue(throwError(() => new Error('409')));
      component.searchTerm.set('Legal');

      component.createNewCollection();

      // Leaving `creating` true disables the create button permanently; keeping the typed name
      // is what lets the user retry at all.
      expect(component.creating()).toBe(false);
      expect(component.searchTerm()).toBe('Legal');
      expect(component.collections().map((c) => c.uid)).toEqual(['col-1', 'col-2']);
    });
  });

  describe('add', () => {
    it('closes with the selected collection id', () => {
      component.selectedCollectionId = 'col-2';

      component.add();

      expect(mockDialogRef.close).toHaveBeenCalledWith('col-2');
      // `adding` is set and never cleared, which is harmless only because the dialog closes in
      // the same tick. Asserted so a future change that stops closing here is caught.
      expect(component.adding()).toBe(true);
    });

    it('does nothing when no collection is selected', () => {
      component.selectedCollectionId = null;

      component.add();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
      expect(component.adding()).toBe(false);
    });
  });
});
