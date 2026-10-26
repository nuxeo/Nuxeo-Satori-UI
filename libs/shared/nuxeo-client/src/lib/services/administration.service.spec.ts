import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { AdministrationService } from './administration.service';

const AUTOMATION_URL = '/nuxeo/api/v1/automation/Audit.QueryWithPageProvider';

/**
 * Shape of a real `Audit.QueryWithPageProvider` response, taken from the local instance. The
 * detail that matters is that it carries `resultsCount` and **no** `totalSize`.
 */
const logEntriesResponse = {
  'entity-type': 'logEntries',
  entries: [
    {
      id: 227874,
      category: 'NuxeoAuthentication',
      principalName: 'Administrator',
      eventId: 'loginSuccess',
      eventDate: '2026-09-07T09:38:22.621Z',
    },
  ],
  resultsCount: 10000,
  currentPageSize: 1,
  currentPageIndex: 0,
  numberOfPages: 5000,
};

describe('AdministrationService — audit', () => {
  let service: AdministrationService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });

    service = TestBed.inject(AdministrationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('requests a page provider the server can resolve', async () => {
    const list$ = firstValueFrom(service.searchAuditLogs({ pageSize: 20, currentPageIndex: 0 }));

    const req = httpMock.expectOne(AUTOMATION_URL);
    const body = req.request.body as { params: Record<string, unknown> };

    // The previous value, `AUDIT_SEARCH`, is not registered on Nuxeo and answered 500 on every
    // call. Asserting the exact name rather than "not AUDIT_SEARCH" so that a future rename has to
    // be re-verified against a server rather than merely differ from the broken one.
    expect(body.params['providerName']).toBe('AUDIT_BROWSER');
    req.flush(logEntriesResponse);

    expect((await list$).entries.length).toBe(1);
  });

  it('reads the total from resultsCount when the provider omits totalSize', async () => {
    const list$ = firstValueFrom(service.searchAuditLogs({ pageSize: 20, currentPageIndex: 0 }));

    httpMock.expectOne(AUTOMATION_URL).flush(logEntriesResponse);

    // Without this mapping the audit page falls back to `entries.length` and pages 10,000 entries
    // as though there were one.
    expect((await list$).totalSize).toBe(10000);
  });

  it('leaves an explicit totalSize alone', async () => {
    const list$ = firstValueFrom(service.searchAuditLogs({ pageSize: 20, currentPageIndex: 0 }));

    httpMock
      .expectOne(AUTOMATION_URL)
      .flush({ ...logEntriesResponse, totalSize: 42, resultsCount: 10000 });

    expect((await list$).totalSize).toBe(42);
  });

  it('does not send a filtered query to a provider that ignores filters', async () => {
    void firstValueFrom(
      service.searchAuditLogs({
        pageSize: 20,
        currentPageIndex: 0,
        principalName: 'Administrator',
      }),
    );

    // `AUDIT_BROWSER` ignores `namedParameters` entirely, so asking it for a filtered page would
    // return every row while the UI showed the filter applied. The filtered path uses the
    // client-side fallback instead, whose first call is the domain lookup.
    httpMock.expectNone(AUTOMATION_URL);
    httpMock.expectOne('/nuxeo/api/v1/path/default-domain');
  });

  it('falls back when the provider call fails', async () => {
    void firstValueFrom(service.searchAuditLogs({ pageSize: 20, currentPageIndex: 0 }));

    httpMock
      .expectOne(AUTOMATION_URL)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    httpMock.expectOne('/nuxeo/api/v1/path/default-domain');
  });
});
