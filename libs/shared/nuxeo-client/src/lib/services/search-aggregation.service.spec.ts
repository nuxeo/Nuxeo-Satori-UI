import { TestBed } from '@angular/core/testing';

import { SearchAggregationService } from './search-aggregation.service';

/**
 * The search page, its filters drawer and its queue share search state through this service.
 * What matters is that they share it, and that a saved-search change reaches the drawer.
 */
describe('SearchAggregationService', () => {
  it('is one instance per application, so the drawer and the results read the same state', () => {
    const drawer = TestBed.inject(SearchAggregationService);
    const results = TestBed.inject(SearchAggregationService);

    results.drawerFilters.set({ 'dc:creator': 'jdoe' });
    results.selectedSavedSearchTitle.set('My contracts');

    expect(drawer.drawerFilters()).toEqual({ 'dc:creator': 'jdoe' });
    expect(drawer.selectedSavedSearchTitle()).toBe('My contracts');
  });

  it('starts with no aggregations, items, drawer filters or saved search', () => {
    const service = TestBed.inject(SearchAggregationService);

    expect(service.aggregations()).toEqual({});
    expect(service.items()).toEqual([]);
    expect(service.drawerFilters()).toEqual({});
    expect(service.selectedSavedSearchId()).toBe('');
    expect(service.selectedSavedSearchTitle()).toBe('');
    expect(service.savedSearchVersion()).toBe(0);
  });

  it('moves the saved-search version on every save, so the drawer reloads its list each time', () => {
    const service = TestBed.inject(SearchAggregationService);

    service.markSavedSearchDirty();
    service.markSavedSearchDirty();
    service.markSavedSearchDirty();

    expect(service.savedSearchVersion()).toBe(3);
  });
});
