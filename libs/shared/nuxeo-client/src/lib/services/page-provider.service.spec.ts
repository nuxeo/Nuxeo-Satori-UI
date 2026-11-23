import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import type { NuxeoDocumentList } from '../models/document.model';
import { PageProviderService } from './page-provider.service';

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

  it('passes a failed request on', async () => {
    const page = firstValueFrom(service.execute('member_claims', { pageSize: 10 }));
    http
      .expectOne((r) => execute(r.url))
      .flush('No such provider', { status: 404, statusText: 'Not Found' });
    await expect(page).rejects.toMatchObject({ status: 404 });
  });
});
