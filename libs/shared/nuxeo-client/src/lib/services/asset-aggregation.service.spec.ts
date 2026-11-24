import { TestBed } from '@angular/core/testing';

import { AssetAggregationService } from './asset-aggregation.service';

/**
 * The assets page's drawer, results and queue each inject this service to share one search
 * state. What matters is that they share it, and that a saved-search change reaches the drawer.
 */
describe('AssetAggregationService', () => {
  it('is one instance per application, so the drawer and the results read the same state', () => {
    const drawer = TestBed.inject(AssetAggregationService);
    const results = TestBed.inject(AssetAggregationService);

    results.items.set([{ id: 'a1', title: 'Logo', type: 'Picture', icon: '/icons/picture.svg' }]);
    results.selectedSavedSearchId.set('ss-1');

    expect(drawer.items()).toEqual([
      { id: 'a1', title: 'Logo', type: 'Picture', icon: '/icons/picture.svg' },
    ]);
    expect(drawer.selectedSavedSearchId()).toBe('ss-1');
  });

  it('starts with no aggregations, no items and no saved search selected', () => {
    const service = TestBed.inject(AssetAggregationService);

    expect(service.aggregations()).toEqual({});
    expect(service.items()).toEqual([]);
    expect(service.selectedSavedSearchId()).toBe('');
    expect(service.selectedSavedSearchTitle()).toBe('');
    expect(service.savedSearchVersion()).toBe(0);
  });

  it('moves the saved-search version on every change, so the drawer reloads its list each time', () => {
    const service = TestBed.inject(AssetAggregationService);

    service.markSavedSearchDirty();
    service.markSavedSearchDirty();

    expect(service.savedSearchVersion()).toBe(2);
  });
});
