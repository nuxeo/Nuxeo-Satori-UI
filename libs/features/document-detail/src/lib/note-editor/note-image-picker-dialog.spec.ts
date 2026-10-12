import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  DocumentDetailService,
  SearchService,
  SelectionService,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { NoteImagePickerDialogComponent } from './note-image-picker-dialog';

/**
 * The picker a note's rich-text editor opens to insert repository images.
 *
 * `SelectionService` is the real one — it is signal state with no I/O, and the whole point
 * of this dialog is that it borrows the app-wide selection and gives it back untouched.
 * Stubbing it would leave the borrow-and-restore contract, which is the only thing here
 * that can corrupt state outside the dialog, completely unasserted.
 */

function picture(uid: string, over: Partial<NuxeoDocument> = {}): NuxeoDocument {
  return {
    uid,
    title: `Picture ${uid}`,
    type: 'Picture',
    path: `/default-domain/workspaces/ws/${uid}`,
    state: 'project',
    lastModified: '2026-08-24T10:00:00.000Z',
    properties: { 'file:content': { name: `${uid}.png`, 'mime-type': 'image/png' } },
    contextParameters: { permissions: ['Read'] },
    ...over,
  };
}

const mockSearch = {
  searchDocumentPicker: vi.fn(
    (_options: {
      fulltext?: string;
      pageSize?: number;
    }): Observable<{ entries: NuxeoDocument[]; totalSize?: number }> =>
      of({ entries: [], totalSize: 0 }),
  ),
};

const mockDetailService = {
  fetchThumbnail: vi.fn((_uid: string): Observable<Blob> =>
    of(new Blob(['t'], { type: 'image/png' })),
  ),
};

describe('NoteImagePickerDialogComponent', () => {
  let component: NoteImagePickerDialogComponent;
  let fixture: ComponentFixture<NoteImagePickerDialogComponent>;
  let selection: SelectionService;
  let closed: unknown[];

  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => {
    const url = `blob:picker/${(seq += 1)}`;
    created.push(url);
    return url;
  });
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });

  function build(): void {
    fixture = TestBed.createComponent(NoteImagePickerDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    created.length = 0;
    revoked.length = 0;
    closed = [];
    mockSearch.searchDocumentPicker.mockReturnValue(of({ entries: [], totalSize: 0 }));
    mockDetailService.fetchThumbnail.mockReturnValue(of(new Blob(['t'], { type: 'image/png' })));

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), NoteImagePickerDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SearchService, useValue: mockSearch },
        { provide: DocumentDetailService, useValue: mockDetailService },
        {
          provide: MatDialogRef,
          useValue: { close: (value: unknown) => void closed.push(value) },
        },
      ],
    }).compileComponents();

    selection = TestBed.inject(SelectionService);
    selection.clear();
    selection.setClearOnlyMode(false);
  });

  describe('search', () => {
    it('lists everything on open, before the user types anything', () => {
      mockSearch.searchDocumentPicker.mockReturnValue(
        of({ entries: [picture('a'), picture('b')], totalSize: 2 }),
      );

      build();

      expect(mockSearch.searchDocumentPicker).toHaveBeenCalledWith({
        fulltext: '',
        pageSize: 40,
      });
      expect(component.results().map((d) => d.uid)).toEqual(['a', 'b']);
      expect(component.totalSize()).toBe(2);
      expect(component.resultsLabel()).toBe('2 results');
      expect(component.loading()).toBe(false);
      expect(component.searchError()).toBeNull();
    });

    it('searches on the trimmed term', () => {
      build();
      component.searchTerm.set('  logo  ');

      component.search();

      expect(mockSearch.searchDocumentPicker).toHaveBeenLastCalledWith({
        fulltext: 'logo',
        pageSize: 40,
      });
    });

    it('clears the term and re-lists everything', () => {
      build();
      component.searchTerm.set('logo');

      component.clearSearch();

      expect(component.searchTerm()).toBe('');
      expect(mockSearch.searchDocumentPicker).toHaveBeenLastCalledWith({
        fulltext: '',
        pageSize: 40,
      });
    });

    it('shows an empty list and a retryable message when the search fails', () => {
      mockSearch.searchDocumentPicker.mockReturnValue(throwError(() => new Error('500')));

      build();

      expect(component.searchError()).toBe('Search failed. Try again.');
      expect(component.results()).toEqual([]);
      expect(component.totalSize()).toBe(0);
      expect(component.loading()).toBe(false);
    });

    it('clears a previous error when a later search succeeds', () => {
      mockSearch.searchDocumentPicker.mockReturnValue(throwError(() => new Error('500')));
      build();
      expect(component.searchError()).not.toBeNull();

      mockSearch.searchDocumentPicker.mockReturnValue(
        of({ entries: [picture('a')], totalSize: 1 }),
      );
      component.search();

      expect(component.searchError()).toBeNull();
      expect(component.results()).toHaveLength(1);
    });

    it('counts the entries when the server sends no total', () => {
      mockSearch.searchDocumentPicker.mockReturnValue(
        of({ entries: [picture('a'), picture('b')] }),
      );

      build();

      expect(component.totalSize()).toBe(2);
    });
  });

  describe('display name', () => {
    it('prefers the stored filename over the document title', () => {
      build();

      expect(component.displayFileName(picture('a'))).toBe('a.png');
      expect(
        component.displayFileName(picture('b', { properties: {}, title: 'Just a title' })),
      ).toBe('Just a title');
      expect(
        component.displayFileName(
          picture('c', { properties: { 'file:content': { 'mime-type': 'image/png' } } }),
        ),
      ).toBe('Picture c');
    });
  });

  describe('selection', () => {
    beforeEach(() => {
      mockSearch.searchDocumentPicker.mockReturnValue(
        of({ entries: [picture('a'), picture('b')], totalSize: 2 }),
      );
      build();
    });

    it('selects and deselects one image', () => {
      component.toggleSelection(picture('a'));

      expect(component.isSelected('a')).toBe(true);
      expect(selection.selectedLabels().get('a')).toBe('a.png');
      expect(component.isIndeterminate()).toBe(true);
      expect(component.isAllSelected()).toBe(false);

      component.toggleSelection(picture('a'));

      expect(component.isSelected('a')).toBe(false);
      expect(component.isIndeterminate()).toBe(false);
    });

    it('selects every visible result and then clears them all', () => {
      component.toggleSelectAll();

      expect(component.isAllSelected()).toBe(true);
      expect([...selection.selectedIds()]).toEqual(['a', 'b']);

      component.toggleSelectAll();

      expect([...selection.selectedIds()]).toEqual([]);
    });

    it('adds the unselected remainder rather than inverting the selection', () => {
      component.toggleSelection(picture('a'));

      component.toggleSelectAll();

      expect([...selection.selectedIds()].sort()).toEqual(['a', 'b']);
    });

    it('does nothing when there is nothing on screen to select', () => {
      component.results.set([]);

      component.toggleSelectAll();

      expect([...selection.selectedIds()]).toEqual([]);
    });

    it('returns the chosen documents when confirmed', () => {
      component.toggleSelection(picture('a'));

      component.confirm();

      expect(closed).toHaveLength(1);
      expect((closed[0] as NuxeoDocument[]).map((d) => d.uid)).toEqual(['a']);
    });

    it('still returns an image chosen before the search results changed under it', () => {
      component.toggleSelection(picture('a'));
      mockSearch.searchDocumentPicker.mockReturnValue(
        of({ entries: [picture('z')], totalSize: 1 }),
      );
      component.searchTerm.set('z');
      component.search();
      expect(component.results().map((d) => d.uid)).toEqual(['z']);

      component.confirm();

      // Selection survives a new search, so the picker must remember the document
      // itself, not just look it up in the current page.
      expect((closed[0] as NuxeoDocument[]).map((d) => d.uid)).toEqual(['a']);
    });

    it('returns nothing when the user confirms without choosing anything', () => {
      component.confirm();

      expect(closed[0]).toEqual([]);
    });
  });

  describe('thumbnails', () => {
    /** Lets each result's `nxs-thumbnail` start its request and draw the answer. */
    async function settle(): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    function images(): string[] {
      return [...(fixture.nativeElement as HTMLElement).querySelectorAll('img')].map(
        (img) => img.getAttribute('src') ?? '',
      );
    }

    it('shows a thumbnail per result and does not refetch one it already has', async () => {
      mockSearch.searchDocumentPicker.mockReturnValue(
        of({ entries: [picture('a'), picture('b')], totalSize: 2 }),
      );
      build();
      await settle();

      expect(images()).toEqual(created);
      expect(created).toHaveLength(2);
      expect(mockDetailService.fetchThumbnail).toHaveBeenCalledTimes(2);

      component.search();
      await settle();

      expect(mockDetailService.fetchThumbnail).toHaveBeenCalledTimes(2);
    });

    it('keeps the placeholder for a result whose thumbnail cannot be fetched', async () => {
      mockSearch.searchDocumentPicker.mockReturnValue(
        of({ entries: [picture('a'), picture('b')], totalSize: 2 }),
      );
      mockDetailService.fetchThumbnail.mockImplementation((uid: string) =>
        uid === 'a' ? throwError(() => new Error('404')) : of(new Blob(['t'])),
      );

      build();
      await settle();

      expect(images()).toHaveLength(1);
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.note-image-picker__placeholder'),
      ).toHaveLength(1);
    });

    it('frees every thumbnail URL when the dialog closes', async () => {
      mockSearch.searchDocumentPicker.mockReturnValue(
        of({ entries: [picture('a'), picture('b')], totalSize: 2 }),
      );
      build();
      await settle();
      const outstanding = [...created];
      expect(outstanding.length).toBeGreaterThan(0);

      fixture.destroy();

      for (const url of outstanding) {
        expect(revoked, `thumbnail ${url} survived the dialog`).toContain(url);
      }
    });
  });

  describe('borrowing the app-wide selection', () => {
    it('starts empty even though something was selected elsewhere', () => {
      selection.selectAll(['elsewhere-1'], { 'elsewhere-1': 'Report' });

      build();

      expect([...selection.selectedIds()]).toEqual([]);
      expect(selection.clearOnlyMode()).toBe(true);
    });

    it('gives the previous selection back on close', () => {
      selection.selectAll(
        ['elsewhere-1'],
        { 'elsewhere-1': 'Report' },
        { 'elsewhere-1': null },
        { 'elsewhere-1': 'File' },
      );
      build();
      component.toggleSelection(picture('a'));

      fixture.destroy();

      // Leaving the picker's own choices behind would delete the user's real
      // selection on the page underneath.
      expect([...selection.selectedIds()]).toEqual(['elsewhere-1']);
      expect(selection.selectedLabels().get('elsewhere-1')).toBe('Report');
      expect(selection.selectedTypes().get('elsewhere-1')).toBe('File');
      expect(selection.clearOnlyMode()).toBe(false);
    });

    it('leaves the selection empty on close when nothing was selected before', () => {
      build();
      component.toggleSelection(picture('a'));

      fixture.destroy();

      expect([...selection.selectedIds()]).toEqual([]);
      expect(selection.clearOnlyMode()).toBe(false);
    });
  });
});
