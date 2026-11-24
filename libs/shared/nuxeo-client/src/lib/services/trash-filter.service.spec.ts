import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TrashFilterService } from './trash-filter.service';

/** The trash page and its filters drawer share filter, layout and saved-filter state here. */
describe('TrashFilterService', () => {
  let service: TrashFilterService;

  beforeEach(() => {
    service = TestBed.inject(TrashFilterService);
  });

  it('starts on the filters layout, with every filter empty and the path at the root', () => {
    expect(service.layoutMode()).toBe('filters');
    expect(service.filters()).toEqual({ fullText: '', path: '/', author: '', sizeRanges: [] });
    expect(service.hasSavedFilter()).toBe(false);
  });

  it('re-notifies on every set, even of the same filters, so re-applying them searches again', () => {
    let evaluations = 0;
    const readsFilters = computed(() => {
      evaluations++;
      return service.filters();
    });
    readsFilters();

    service.filters.set(service.filters());
    readsFilters();

    expect(evaluations).toBe(2);
  });

  it('toggles between the filters and the results layout', () => {
    service.toggleLayout();
    expect(service.layoutMode()).toBe('results');

    service.toggleLayout();
    expect(service.layoutMode()).toBe('filters');
  });

  it('reports a saved filter while one is applied', () => {
    service.activeSavedFilterUid.set('saved-1');
    expect(service.hasSavedFilter()).toBe(true);

    service.activeSavedFilterUid.set(null);
    expect(service.hasSavedFilter()).toBe(false);
  });

  it('clears the filters and the applied saved filter on reset, and leaves the results alone', () => {
    service.filters.set({ fullText: 'invoice', path: '/ws', author: 'jdoe', sizeRanges: ['big'] });
    service.activeSavedFilterUid.set('saved-1');
    service.activeSavedFilterTitle.set('Big invoices');
    service.layoutMode.set('results');
    service.results.set([{ uid: 'd1', title: 'Invoice', type: 'File' }]);
    service.totalResults.set(1);

    service.reset();

    expect(service.filters()).toEqual({ fullText: '', path: '/', author: '', sizeRanges: [] });
    expect(service.activeSavedFilterUid()).toBeNull();
    expect(service.activeSavedFilterTitle()).toBeNull();
    expect(service.hasSavedFilter()).toBe(false);
    expect(service.layoutMode()).toBe('results');
    expect(service.results()).toEqual([{ uid: 'd1', title: 'Invoice', type: 'File' }]);
    expect(service.totalResults()).toBe(1);
  });

  it('hands out a fresh empty filter on each reset, so editing one cannot dirty the next', () => {
    service.reset();
    const first = service.filters();
    first.fullText = 'edited in place';

    service.reset();

    expect(service.filters()).not.toBe(first);
    expect(service.filters().fullText).toBe('');
  });

  it('moves the saved-search version on every save, so the drawer reloads its list', () => {
    service.markSavedSearchDirty();
    service.markSavedSearchDirty();

    expect(service.savedSearchVersion()).toBe(2);
  });
});
