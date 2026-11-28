import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, Subject } from 'rxjs';
import type { SearchComponent } from '@agentic-ui/feature-search';
import { SearchService, type SearchResponse } from '@nuxeo/satori-platform/nuxeo-client';

import { appConfig } from './app.config';

describe('Search selection menu browser behavior', () => {
  let fixture: ComponentFixture<SearchComponent>;
  let requests: Subject<SearchResponse>[];

  beforeEach(async () => {
    const { SearchComponent: SearchComponentClass } = await import('@agentic-ui/feature-search');
    requests = [];
    await TestBed.configureTestingModule({
      imports: [SearchComponentClass, MatIconTestingModule],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(ActivatedRoute, {
        useValue: { queryParamMap: of(convertToParamMap({})), parent: null },
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
    requests.at(-1)?.next({ items: [], aggregations: {}, totalSize: 120, hasNextPage: true });
    requests.at(-1)?.complete();
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

  it('restores menu focus and keeps cancellation reachable during Select all', async () => {
    const trigger = fixture.nativeElement.querySelector(
      '.list-header .col-checkbox button',
    ) as HTMLButtonElement;
    window.focus();
    trigger.focus();
    expect(document.hasFocus()).withContext('the browser test document has focus').toBeTrue();
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    await settle();
    const selectAll = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1];
    expect(selectAll).toBeDefined();
    selectAll.focus();
    selectAll.click();
    await settle();

    expect(fixture.componentInstance.selectingAll()).toBeTrue();
    expect(document.activeElement).withContext('after the selection menu closes').toBe(trigger);
    expect(trigger.disabled).withContext('keep Clear selection reachable').toBeFalse();
    trigger.click();
    await settle();
    const items = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    expect(items.length).withContext('the menu reopens during Select all').toBe(3);
    if (items.length !== 3) return;
    expect(items[0].disabled).withContext('prevent page selection being overwritten').toBeTrue();
    expect(items[1].disabled).withContext('prevent another Select all request').toBeTrue();
    expect(items[2].disabled).withContext('allow cancellation').toBeFalse();
    const requestCount = requests.length;
    items[2].focus();
    items[2].click();
    await settle();
    expect(fixture.componentInstance.selectingAll()).toBeFalse();
    expect(requests).toHaveSize(requestCount);
    expect(document.activeElement).withContext('after clearing the selection').toBe(trigger);
  });
});
