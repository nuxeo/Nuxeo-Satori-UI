import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import type { NuxeoDocumentList } from '../models/document.model';
import { PageProviderService, resultWindow } from './page-provider.service';

const PAGE: NuxeoDocumentList = {
  entries: [],
  totalSize: 0,
  currentPageSize: 0,
  currentPageIndex: 0,
  numberOfPages: 0,
};

const execute = (url: string) => url === '/nuxeo/api/v1/search/pp/member_claims/execute';

describe('PageProviderService', () => {
  let service: PageProviderService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    service = TestBed.inject(PageProviderService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks for one page, every schema and the permissions that row actions need', async () => {
    const page = firstValueFrom(service.execute('member_claims', { pageSize: 10, pageIndex: 2 }));
    const request = http.expectOne((r) => execute(r.url));
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('pageSize')).toBe('10');
    expect(request.request.params.get('currentPageIndex')).toBe('2');
    expect(request.request.params.has('queryParams')).toBe(false);
    expect(request.request.params.has('sortBy')).toBe(false);
    expect(request.request.headers.get('properties')).toBe('*');
    expect(request.request.headers.get('enrichers.document')).toBe('permissions');
    request.flush({ ...PAGE, totalSize: 3 });
    expect((await page).totalSize).toBe(3);
  });

  it('sends each parameter as a queryParams value of its own, commas and all', async () => {
    const page = firstValueFrom(
      service.execute('member_claims', {
        pageSize: 10,
        parameters: ['m-1', 'Smith, Jane', '$currentUser'],
      }),
    );
    const request = http.expectOne((r) => execute(r.url));
    // Nuxeo reads the list of values, one parameter each, and never splits one on its commas.
    expect(request.request.params.getAll('queryParams')).toEqual([
      'm-1',
      'Smith, Jane',
      '$currentUser',
    ]);
    request.flush(PAGE);
    await page;
  });

  it('sends the order as comma-separated keys and directions, first key first', async () => {
    const page = firstValueFrom(
      service.execute('member_claims', {
        pageSize: 10,
        sort: [
          { field: 'claim:serviceDate', order: 'desc' },
          { field: 'dc:title', order: 'asc' },
        ],
      }),
    );
    const request = http.expectOne((r) => execute(r.url));
    expect(request.request.params.get('sortBy')).toBe('claim:serviceDate,dc:title');
    expect(request.request.params.get('sortOrder')).toBe('desc,asc');
    request.flush(PAGE);
    await page;
  });

  it('sends the schemas a caller names instead of every one', async () => {
    const page = firstValueFrom(
      service.execute('member_claims', { pageSize: 5, properties: 'dublincore,claim' }),
    );
    const request = http.expectOne((r) => execute(r.url));
    expect(request.request.headers.get('properties')).toBe('dublincore,claim');
    request.flush(PAGE);
    await page;
  });

  it('refuses, without a request, a name that is not a page provider', async () => {
    for (const name of ['../id/secret', '..', '.', '_hidden', '']) {
      await expect(firstValueFrom(service.execute(name, { pageSize: 10 }))).rejects.toThrow(
        `"${name}" is not the name of a page provider`,
      );
    }
    http.expectNone(() => true);
  });

  it('refuses, without a request, a page size Nuxeo would read as no limit, or one too large', async () => {
    for (const pageSize of [0, -1, 1001, 2.5]) {
      await expect(firstValueFrom(service.execute('member_claims', { pageSize }))).rejects.toThrow(
        `a page is 1 to 1000 records, not ${pageSize}`,
      );
    }
    http.expectNone(() => true);
  });

  it('refuses, without a request, a sort that Nuxeo would split or cannot read', async () => {
    for (const sort of [
      { field: 'dc:title,dc:created', order: 'asc' as const },
      { field: 'title', order: 'asc' as const },
      { field: 'dc:title', order: 'up' as unknown as 'asc' },
    ]) {
      await expect(
        firstValueFrom(service.execute('member_claims', { pageSize: 10, sort: [sort] })),
      ).rejects.toThrow('a page provider sorts by <prefix>:<name> asc or desc');
    }
    http.expectNone(() => true);
  });

  it("sends each aggregate's chosen buckets as a JSON array named after it, as the search page does", async () => {
    const page = firstValueFrom(
      service.execute('member_claims', {
        pageSize: 10,
        parameters: ['m-1'],
        aggregates: {
          claim_type_agg: ['medical', 'dental, vision'],
          claim_state_agg: [],
        },
      }),
    );
    const request = http.expectOne((r) => execute(r.url));
    // A key holding a comma stays whole: the array is JSON, not comma-separated.
    expect(request.request.params.get('claim_type_agg')).toBe('["medical","dental, vision"]');
    // An aggregate with nothing chosen filters nothing, and is not sent.
    expect(request.request.params.has('claim_state_agg')).toBe(false);
    expect(request.request.params.getAll('queryParams')).toEqual(['m-1']);
    request.flush({
      ...PAGE,
      aggregations: { claim_type_agg: { buckets: [{ key: 'medical', docCount: 2 }] } },
    });
    expect((await page).aggregations).toEqual({
      claim_type_agg: { buckets: [{ key: 'medical', docCount: 2 }] },
    });
  });

  it('refuses, without a request, an aggregate the search or its rendering reads for itself', async () => {
    for (const aggregate of [
      'pageSize',
      'sortBy',
      'queryParams',
      'properties',
      'enrichers.document',
      'fetch-document',
      '_agg',
    ]) {
      await expect(
        firstValueFrom(
          service.execute('member_claims', { pageSize: 10, aggregates: { [aggregate]: ['x'] } }),
        ),
      ).rejects.toThrow(`"${aggregate}" cannot be sent as an aggregate`);
    }
    http.expectNone(() => true);
  });

  it('passes a failed request on', async () => {
    const page = firstValueFrom(service.execute('member_claims', { pageSize: 10 }));
    http
      .expectOne((r) => execute(r.url))
      .flush('No such provider', { status: 404, statusText: 'Not Found' });
    await expect(page).rejects.toMatchObject({ status: 404 });
  });
});

describe('resultWindow', () => {
  /** A page's counts, as the local Nuxeo 2025.10.18 answered them (docs/api-integrations.md, section 33). */
  const counted = (more: Partial<NuxeoDocumentList>): NuxeoDocumentList => ({ ...PAGE, ...more });

  it('reaches the whole pages within the search index window, and keeps its exact total past it', () => {
    // Every document, through the search service: 13,592 counted, a window of 10,000.
    const page = counted({ totalSize: 13_592, resultsCount: 13_592, resultsCountLimit: 10_000 });
    expect(resultWindow(page, 50)).toEqual({ total: 13_592, moreThan: null, reach: 10_000 });
    // 30 a page: page 332 ends at 9,990, and 333 would end at 10,020, which the server refuses.
    expect(resultWindow(page, 30)).toEqual({ total: 13_592, moreThan: null, reach: 9_990 });
    expect(resultWindow(page, 1)).toEqual({ total: 13_592, moreThan: null, reach: 10_000 });
  });

  it("sets no reach while the query fits in the window, as the brand library's six assets do", () => {
    const page = counted({ totalSize: 6, resultsCount: 6, resultsCountLimit: 10_000 });
    expect(resultWindow(page, 50)).toEqual({ total: 6, moreThan: null, reach: null });
    const full = counted({ totalSize: 10_000, resultsCount: 10_000, resultsCountLimit: 10_000 });
    expect(resultWindow(full, 50).reach).toBeNull();
  });

  it('ends the reach where the index stops short of its count within the window, at a page size that does not divide it', () => {
    // 9,886 created since a given second, 910 a page: page 9 had no next page, page 10 was HTTP 500.
    const counts = { totalSize: 9_886, resultsCount: 9_886, resultsCountLimit: 10_000 };
    const edge = counted({ ...counts, currentPageIndex: 9, isNextPageAvailable: false });
    expect(resultWindow(edge, 910)).toEqual({ total: 9_886, moreThan: null, reach: 9_100 });
    // Before the edge the server offers a next page, and nothing yet says where the reach ends.
    const before = counted({ ...counts, currentPageIndex: 8, isNextPageAvailable: true });
    expect(resultWindow(before, 910).reach).toBeNull();
    // A last page that ends with the results, or one past them, stops short of nothing.
    const last = counted({ ...counts, currentPageIndex: 197, isNextPageAvailable: false });
    expect(resultWindow(last, 50).reach).toBeNull();
    const past = counted({ ...counts, currentPageIndex: 300, isNextPageAvailable: false });
    expect(resultWindow(past, 50).reach).toBeNull();
    // Nor does one whose server leaves the flag out.
    expect(resultWindow(counted({ ...counts, currentPageIndex: 9 }), 910).reach).toBeNull();
  });

  it('sets no reach for the repository, which reports no limit and pages past 10,000', () => {
    // nxql_search over every document: 11,902 counted, resultsCountLimit 0, page 10,000 served.
    const page = counted({ totalSize: 11_902, resultsCount: 11_902, resultsCountLimit: 0 });
    expect(resultWindow(page, 1)).toEqual({ total: 11_902, moreThan: null, reach: null });
    expect(resultWindow(counted({ totalSize: 20_000 }), 50).reach).toBeNull();
  });

  it('says "more than" the limit where the server stopped counting there, and reaches on', () => {
    // A folder's children a page of one at a time: resultsCount -2, resultsCountLimit 1.
    const page = counted({ totalSize: -2, resultsCount: -2, resultsCountLimit: 1 });
    expect(resultWindow(page, 1)).toEqual({ total: null, moreThan: 1, reach: null });
    const limited = counted({ totalSize: -2, resultsCount: -2, resultsCountLimit: 200 });
    expect(resultWindow(limited, 50)).toEqual({ total: null, moreThan: 200, reach: null });
  });

  it('claims nothing where the server neither counted nor gave a limit it stopped at', () => {
    expect(resultWindow(counted({ totalSize: -1, resultsCount: -1 }), 50)).toEqual({
      total: null,
      moreThan: null,
      reach: null,
    });
    const uncounted = counted({ totalSize: -1, resultsCount: -1, resultsCountLimit: 10_000 });
    expect(resultWindow(uncounted, 50).moreThan).toBeNull();
  });

  it('takes the larger of the two counts, and a page size that is not one as 1', () => {
    const page = counted({ totalSize: 12_000, resultsCount: 13_000, resultsCountLimit: 10_000 });
    expect(resultWindow(page, 50).total).toBe(13_000);
    expect(resultWindow(page, 0).reach).toBe(10_000);
    expect(resultWindow(page, Number.NaN).reach).toBe(10_000);
    expect(resultWindow(counted({ totalSize: 50, resultsCountLimit: 2.5 }), 1).reach).toBeNull();
  });
});
