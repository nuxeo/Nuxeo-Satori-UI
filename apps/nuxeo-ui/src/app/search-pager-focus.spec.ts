import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import type { SearchComponent } from '@agentic-ui/feature-search';
import {
  SearchAggregationService,
  SearchService,
  type SearchResponse,
} from '@nuxeo/satori-platform/nuxeo-client';

import { appConfig } from './app.config';

describe('Search pager browser focus', () => {
  let fixture: ComponentFixture<SearchComponent>;
  let requests: Subject<SearchResponse>[];
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(async () => {
    const { SearchComponent: SearchComponentClass } = await import('@agentic-ui/feature-search');
    requests = [];
    queryParams = new BehaviorSubject(convertToParamMap({ page: '2' }));
    await TestBed.configureTestingModule({
      imports: [SearchComponentClass, MatIconTestingModule],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(ActivatedRoute, {
        useValue: {
          queryParamMap: queryParams,
          parent: null,
        },
      })
      .overrideProvider(SearchService, {
        useValue: {
          search: () => {
            const response = new Subject<SearchResponse>();
            requests.push(response);
            return response;
          },
          getSavedSearches: () => of([]),
          getUserCollections: () => of([]),
          getTagSuggestions: () => of([]),
        },
      })
      .compileComponents();
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(SearchComponentClass);
    await settle();
    answer(true);
    await settle();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }

  function answer(hasNextPage: boolean): void {
    requests.at(-1)?.next({ items: [], aggregations: {}, totalSize: 120, hasNextPage });
    requests.at(-1)?.complete();
  }

  for (const criteria of ['metadata', 'customer quick filter'] as const) {
    it(`retains Reset focus after clearing the last ${criteria}`, async () => {
      const navigate = TestBed.inject(Router).navigate as jasmine.Spy;
      navigate.and.callFake(async (_commands: unknown[], extras: { queryParams?: object }) => {
        queryParams.next(convertToParamMap(extras.queryParams ?? {}));
        return true;
      });
      if (criteria === 'metadata') {
        TestBed.inject(SearchAggregationService).drawerFilters.set({ ecm_fulltext: 'applied' });
      } else {
        queryParams.next(convertToParamMap({ quickFilters: 'customerFilter' }));
      }
      await settle();
      answer(false);
      await settle();
      const control = fixture.nativeElement.querySelector(
        '.search-workspace__actions button:last-child',
      ) as HTMLButtonElement;
      expect(fixture.componentInstance.canReset()).toBeTrue();
      window.focus();
      control.focus();
      expect(document.hasFocus()).withContext('the browser test document has focus').toBeTrue();
      expect(document.activeElement).toBe(control);
      control.click();
      await settle();

      expect(fixture.componentInstance.canReset()).toBeFalse();
      expect(document.activeElement)
        .withContext('after Reset clears the last criteria')
        .toBe(control);
      expect(control.disabled).withContext('keep unavailable Reset focusable').toBeFalse();
      expect(control.getAttribute('aria-disabled')).toBe('true');
      const requestCount = requests.length;
      const navigationCount = navigate.calls.count();
      control.click();
      await settle();
      expect(requests.length).withContext('ignore unavailable Reset activation').toBe(requestCount);
      expect(navigate.calls.count()).toBe(navigationCount);
      answer(false);
      await settle();
      expect(document.activeElement).withContext('after the cleared results arrive').toBe(control);
    });
  }

  for (const button of ['first', 'previous', 'next', 'last'] as const) {
    it(`retains ${button} focus during loading and when the boundary page arrives`, async () => {
      const buttons = fixture.nativeElement.querySelectorAll(
        'nxs-pager button',
      ) as NodeListOf<HTMLButtonElement>;
      const control = buttons[['first', 'previous', 'next', 'last'].indexOf(button)];
      expect(control).toBeDefined();
      window.focus();
      control.focus();
      expect(document.hasFocus()).withContext('the browser test document has focus').toBeTrue();
      expect(document.activeElement).toBe(control);
      control.click();
      await settle();
      expect(fixture.componentInstance.loading()).toBeTrue();
      expect(control.disabled).withContext('keep the control enabled while loading').toBeFalse();
      expect(document.activeElement).withContext('while the page request is pending').toBe(control);
      const requestCount = requests.length;
      control.click();
      await settle();
      expect(requests.length)
        .withContext('ignore repeated paging while loading')
        .toBe(requestCount);

      answer(button === 'first' || button === 'previous');
      await settle();
      expect(control.disabled).withContext('keep boundary navigation focusable').toBeFalse();
      expect(control.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).withContext('after reaching the page boundary').toBe(control);
      control.click();
      await settle();
      expect(requests.length)
        .withContext('ignore navigation beyond the boundary')
        .toBe(requestCount);
    });
  }
});
