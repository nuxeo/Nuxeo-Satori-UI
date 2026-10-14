import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';

import { AiFeatureFlagService, AiGatewayService } from '@agentic-ui/shared/ai-client';
import { NUXEO_API_ORIGIN, SearchAggregationService } from '@nuxeo-satori/platform/nuxeo-client';

import { SearchFiltersDrawerComponent } from '../search-filters-drawer/search-filters-drawer.component';
import { SearchComponent } from '../search/search';

const EXECUTE = '/nuxeo/api/v1/search/pp/default_search/execute';

/** A `default_search` answer with aggregates, so the drawer's filters have choices. */
const answer = {
  'entity-type': 'documents',
  resultsCount: 2,
  entries: [
    { uid: 'a', title: 'Alpha', type: 'File', properties: {}, contextParameters: {} },
    { uid: 'b', title: 'Beta', type: 'Note', properties: {}, contextParameters: {} },
  ],
  aggregations: {
    dc_nature_agg: { buckets: [{ key: 'article', docCount: 2 }] },
    dc_modified_agg: { buckets: [{ key: 'last24h', docCount: 2 }] },
  },
};

@Component({ standalone: true, template: '' })
class BlankPage {}

/** The search page and the search drawer, side by side as the shell shows them. */
@Component({
  standalone: true,
  imports: [SearchComponent, SearchFiltersDrawerComponent],
  template: '<lib-search-filters-drawer /><lib-search />',
})
class SearchScreen {}

/**
 * Register 14.2 A: one Enter in the drawer's full-text box sent three identical search requests —
 * the page's, the shell navigation drawer's (its effect read the filters, so it searched again on
 * every change) and the filters drawer's own "baseline" for its counts. This counts requests on the
 * wire, through the real `SearchService`, with the page and the drawer both on screen.
 */
describe('one change of the search, one request', () => {
  let fixture: ComponentFixture<SearchScreen>;
  let http: HttpTestingController;
  const queryParamMap = new BehaviorSubject(convertToParamMap({}));

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [SearchScreen],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'search', component: BlankPage }]),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: ActivatedRoute, useValue: { queryParamMap, parent: null } },
        { provide: AiFeatureFlagService, useValue: { aiEnabled: signal(false) } },
        {
          provide: AiGatewayService,
          useValue: { nlToNxqlSuggestions: () => of({ suggestions: [] }), nlToNxql: () => of() },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SearchAggregationService).drawerFilters.set({});
    fixture = TestBed.createComponent(SearchScreen);
    await settle();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The search requests sent since the last call, answered. */
  function searches(): TestRequest[] {
    const sent = http.match((req) => req.url === EXECUTE);
    for (const req of sent) req.flush(answer);
    return sent;
  }

  function fulltextInput(): HTMLInputElement {
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'nxs-search-filters input[type="search"]',
    );
    if (!input) throw new Error('the drawer renders no full-text box');
    return input;
  }

  it('sends one request when the page and the drawer open together', async () => {
    expect(searches()).toHaveLength(1);
    await settle();
    expect(searches()).toHaveLength(0);
  });

  it('sends one request for one Enter in the full-text box', async () => {
    searches();
    await settle();

    const input = fulltextInput();
    input.value = 'contract';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(searches()).toHaveLength(0);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    // Past the drawer's old 150 ms baseline debounce, so a delayed duplicate is counted too.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle();

    const sent = searches();
    expect(sent).toHaveLength(1);
    expect(sent[0].request.params.get('ecm_fulltext')).toBe('contract');
  });

  it('sends one request for one checkbox, and the drawer counts from its aggregates', async () => {
    searches();
    await settle();

    const checkbox = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'nxs-search-filters mat-checkbox input',
    );
    expect(checkbox, 'the modification-date group is open with a choice').not.toBeNull();
    expect(checkbox?.closest('mat-checkbox')?.textContent).toContain('(2)');
    checkbox?.click();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle();

    const sent = searches();
    expect(sent).toHaveLength(1);
    expect(sent[0].request.params.get('dc_modified_agg')).toBe('["last24h"]');
  });

  it('sends one request when the quick filters in the URL change', async () => {
    searches();
    await settle();

    queryParamMap.next(convertToParamMap({ quickFilters: 'noFolder' }));
    await settle();

    const sent = searches();
    expect(sent).toHaveLength(1);
    expect(sent[0].request.params.get('quickFilters')).toBe('noFolder');
    queryParamMap.next(convertToParamMap({}));
  });
});
