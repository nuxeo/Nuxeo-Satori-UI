import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, type Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentDetailService } from './document-detail.service';
import { SelectionService } from './selection.service';

/**
 * Covers `forgetPreviews`, the mitigation for a borrowed-object-URL lifetime bug.
 *
 * Callers hand `toggle`/`selectAll` a `blob:` URL **they** own, and this service keeps the string; the
 * selection topbar binds it into `<img [src]>`. Selection is global and survives a new search, so when
 * the owner revokes that URL this copy becomes a dangling reference and the popup renders a broken
 * image beside a still-selected item. Fixing the object-URL leak in this PR is what exposed it —
 * before, nothing was ever revoked, so the stale copy stayed loadable by accident.
 *
 * The contract that matters is therefore narrow and easy to get wrong in either direction: previews go
 * to `null`, and **nothing else changes**. Clearing selection would lose the user's work; leaving a
 * preview behind would leave the dangling reference this exists to remove.
 */
describe('SelectionService', () => {
  let service: SelectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: DocumentDetailService,
          useValue: { deleteDocument: vi.fn((): Observable<void> => of(undefined)) },
        },
      ],
    });
    service = TestBed.inject(SelectionService);
  });

  it('notifies every shared clear synchronously so pending selections can be cancelled', () => {
    const onClear = vi.fn();
    const subscription = service.cleared$.subscribe(onClear);
    service.selectAll(['doc']);
    service.clear();
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(service.selectedCount()).toBe(0);
    service.resetUiState();
    expect(onClear).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  describe('forgetPreviews', () => {
    it('nulls every retained preview while preserving ids, labels and types', () => {
      service.selectAll(
        ['doc1', 'doc2'],
        { doc1: 'First', doc2: 'Second' },
        { doc1: 'blob:one', doc2: 'blob:two' },
        { doc1: 'File', doc2: 'Picture' },
      );

      // Precondition, asserted rather than assumed: without it a bug that never stored previews would
      // make the assertions below pass for the wrong reason.
      expect(service.selectedPreviews().get('doc1')).toBe('blob:one');
      expect(service.selectedPreviews().get('doc2')).toBe('blob:two');

      service.forgetPreviews();

      expect(service.selectedPreviews().get('doc1')).toBeNull();
      expect(service.selectedPreviews().get('doc2')).toBeNull();

      // Everything else survives — the selection itself is not the thing being dropped.
      expect([...service.selectedIds()]).toEqual(['doc1', 'doc2']);
      expect(service.selectedCount()).toBe(2);
      expect(service.selectedLabels().get('doc1')).toBe('First');
      expect(service.selectedLabels().get('doc2')).toBe('Second');
      expect(service.selectedTypes().get('doc1')).toBe('File');
      expect(service.selectedTypes().get('doc2')).toBe('Picture');
      expect(service.isSelected('doc1')).toBe(true);
    });

    it('keeps an already-null preview as a present key rather than dropping it', () => {
      // A selection made without a thumbnail. The key must stay, or `selectedItems()` would lose the
      // entry's preview slot entirely and the two maps would disagree on membership.
      service.toggle('doc3', 'Third', null, 'Note');
      expect(service.selectedPreviews().has('doc3')).toBe(true);
      expect(service.selectedPreviews().get('doc3')).toBeNull();

      service.forgetPreviews();

      expect(service.selectedPreviews().has('doc3')).toBe(true);
      expect(service.selectedPreviews().get('doc3')).toBeNull();
      expect(service.isSelected('doc3')).toBe(true);
    });

    it('is reflected in selectedItems, which is what the topbar renders', () => {
      // The binding that actually caused the broken image, rather than the backing map.
      service.toggle('doc4', 'Fourth', 'blob:four', 'File');
      expect(service.selectedItems()[0].preview).toBe('blob:four');

      service.forgetPreviews();

      const [item] = service.selectedItems();
      expect(item.preview).toBeNull();
      expect(item.id).toBe('doc4');
      expect(item.name).toBe('Fourth');
      expect(item.type).toBe('File');
    });

    it('is safe on an empty selection', () => {
      expect(() => service.forgetPreviews()).not.toThrow();
      expect(service.selectedPreviews().size).toBe(0);
      expect(service.selectedCount()).toBe(0);
    });

    it('does not resurrect previews for ids that were deselected', () => {
      service.toggle('doc5', 'Fifth', 'blob:five', 'File');
      service.toggle('doc5'); // deselect
      expect(service.selectedPreviews().has('doc5')).toBe(false);

      service.forgetPreviews();

      expect(service.selectedPreviews().has('doc5')).toBe(false);
    });
  });
});
