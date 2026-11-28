import { Injectable, signal } from '@angular/core';
import type { SearchAggregations, SearchResultItem } from '../models/search.model';

@Injectable({ providedIn: 'root' })
export class SearchAggregationService {
  /** Header submissions are consumed by the search page's existing search session. */
  readonly keywordRequest = signal<{ term: string } | null>(null);
  /** Explicit reset/open actions resynchronize keyword drafts even if the applied term is unchanged. */
  readonly keywordSyncVersion = signal(0);
  readonly aggregations = signal<SearchAggregations>({});
  readonly items = signal<SearchResultItem[]>([]);
  readonly drawerFilters = signal<Record<string, string>>({});
  readonly selectedSavedSearchId = signal('');
  readonly selectedSavedSearchTitle = signal('');
  /** Incremented whenever a saved search is created so the drawer can refresh its list. */
  readonly savedSearchVersion = signal(0);

  markSavedSearchDirty(): void {
    this.savedSearchVersion.update((v) => v + 1);
  }
}
