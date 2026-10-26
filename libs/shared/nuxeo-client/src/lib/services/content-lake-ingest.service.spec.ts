import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { ContentLakeIngestService } from './content-lake-ingest.service';

describe('ContentLakeIngestService', () => {
  let service: ContentLakeIngestService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });

    service = TestBed.inject(ContentLakeIngestService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('starts a bulk ingest for one document', async () => {
    const command$ = firstValueFrom(service.startIngest(['doc-uuid-1']));
    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Bulk.RunAction');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      params: {
        action: 'ingest',
        query: "SELECT * FROM Document WHERE ecm:uuid = 'doc-uuid-1'",
      },
      context: {},
    });
    req.flush({ commandId: 'bulk-123' });

    await expect(command$).resolves.toEqual({ commandId: 'bulk-123' });
  });

  it('reads commandId from Nuxeo automation bulkStatus value wrapper', async () => {
    const command$ = firstValueFrom(service.startIngest(['doc-uuid-1']));
    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Bulk.RunAction');
    req.flush({
      'entity-type': 'bulkStatus',
      value: {
        'entity-type': 'bulkStatus',
        commandId: 'bulk-456',
        state: 'SCHEDULED',
      },
    });

    await expect(command$).resolves.toEqual({ commandId: 'bulk-456' });
  });

  it('surfaces Nuxeo automation exceptions from bulk ingest', async () => {
    const command$ = firstValueFrom(service.startIngest(['doc-uuid-1']));
    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Bulk.RunAction');
    req.flush({
      'entity-type': 'exception',
      status: 400,
      message: 'Unknown bulk action: ingest',
    });

    await expect(command$).rejects.toThrow('Unknown bulk action: ingest');
  });

  it('reads bulk status', async () => {
    const status$ = firstValueFrom(service.getStatus('bulk-123'));
    const req = httpMock.expectOne('/nuxeo/api/v1/bulk/bulk-123');
    req.flush({ state: 'COMPLETED', processed: 1, error: false, errorCount: 0 });

    await expect(status$).resolves.toEqual({
      commandId: 'bulk-123',
      state: 'COMPLETED',
      processed: 1,
      error: false,
      errorCount: 0,
    });
  });

  it('waitUntilComplete resolves on a terminal status', async () => {
    const status$ = firstValueFrom(service.waitUntilComplete('bulk-123'));
    const req = httpMock.expectOne('/nuxeo/api/v1/bulk/bulk-123');
    req.flush({ state: 'COMPLETED', processed: 1, error: false, errorCount: 0 });

    await expect(status$).resolves.toEqual({
      commandId: 'bulk-123',
      state: 'COMPLETED',
      processed: 1,
      error: false,
      errorCount: 0,
    });
  });

  it('waitUntilComplete errors when a bulk command never reaches a terminal state', fakeAsync(() => {
    let error: Error | undefined;

    service.waitUntilComplete('bulk-123', 10, 1).subscribe({
      error: (err: Error) => {
        error = err;
      },
    });

    const firstReq = httpMock.expectOne('/nuxeo/api/v1/bulk/bulk-123');
    firstReq.flush({ state: 'RUNNING', processed: 0, total: 1, error: false, errorCount: 0 });
    tick(10);

    const secondReq = httpMock.expectOne('/nuxeo/api/v1/bulk/bulk-123');
    secondReq.flush({ state: 'RUNNING', processed: 0, total: 1, error: false, errorCount: 0 });

    expect(error?.message).toContain('did not finish');
    expect(error?.message).toContain('RUNNING (0/1 processed)');
  }));

  it('findDuplicates returns matches from a repository-wide NXQL search', async () => {
    const duplicates$ = firstValueFrom(
      service.findDuplicates([new File(['x'.repeat(1024)], 'sample.pdf')]),
    );

    const searchReq = httpMock.expectOne(
      (req) =>
        req.url.includes('/nuxeo/api/v1/search/lang/NXQL/execute') &&
        req.params.get('query')?.includes("file:content/name = 'sample.pdf'") === true,
    );
    expect(searchReq.request.method).toBe('GET');
    searchReq.flush({
      entries: [
        {
          uid: 'doc-existing',
          title: 'sample.pdf',
          type: 'File',
          path: '/default-domain/workspaces/demo/sample.pdf',
          properties: {
            'file:content': { name: 'sample.pdf', length: '1024', digest: 'digest-1' },
            'dc:rights': 'agentic-ui:content-lake:digest-1',
          },
        },
      ],
    });

    await expect(duplicates$).resolves.toEqual([
      expect.objectContaining({
        fileName: 'sample.pdf',
        existingUid: 'doc-existing',
        existingPath: '/default-domain/workspaces/demo/sample.pdf',
      }),
    ]);
  });

  it('findDuplicates probes Content Lake when the repository match has no ingest marker', async () => {
    const duplicates$ = firstValueFrom(
      service.findDuplicates([new File(['x'.repeat(1024)], 'sample.pdf')], ['source-1']),
    );

    const searchReq = httpMock.expectOne((req) =>
      req.url.includes('/nuxeo/api/v1/search/lang/NXQL/execute'),
    );
    searchReq.flush({
      entries: [
        {
          uid: 'doc-existing',
          title: 'sample.pdf',
          type: 'File',
          path: '/default-domain/other-workspace/sample.pdf',
          properties: {
            'file:content': { name: 'sample.pdf', length: '1024', digest: 'digest-1' },
          },
        },
      ],
    });

    const checkReq = httpMock.expectOne('/nuxeo/api/v1/automation/HylandIngest.CheckDigest');
    expect(checkReq.request.body).toEqual({
      params: { xpath: 'file:content', sourceId: 'source-1' },
      context: {},
      input: 'doc-existing',
    });
    checkReq.flush({
      responseCode: 200,
      responseMessage: 'OK',
      response: { exists: true },
    });

    await expect(duplicates$).resolves.toEqual([
      expect.objectContaining({ fileName: 'sample.pdf', existingUid: 'doc-existing' }),
    ]);
  });

  it('markIngested writes the ingest marker from the blob digest', async () => {
    const mark$ = firstValueFrom(service.markIngested(['doc-uuid-1']));

    const getReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-uuid-1');
    getReq.flush({
      uid: 'doc-uuid-1',
      properties: {
        'file:content': { digest: 'digest-abc' },
      },
    });

    const putReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-uuid-1');
    expect(putReq.request.method).toBe('PUT');
    expect(putReq.request.body.properties['dc:source']).toBe('agentic-ui:content-lake:digest-abc');
    putReq.flush({
      uid: 'doc-uuid-1',
      properties: {
        'file:content': { digest: 'digest-abc' },
        'dc:source': 'agentic-ui:content-lake:digest-abc',
      },
    });

    await expect(mark$).resolves.toEqual([
      expect.objectContaining({
        uid: 'doc-uuid-1',
        properties: expect.objectContaining({
          'dc:source': 'agentic-ui:content-lake:digest-abc',
        }),
      }),
    ]);
  });

  it('markIngested uses dc:rights when dc:source is occupied', async () => {
    const mark$ = firstValueFrom(service.markIngested(['doc-uuid-1']));

    const getReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-uuid-1');
    getReq.flush({
      uid: 'doc-uuid-1',
      properties: {
        'file:content': { digest: 'digest-abc' },
        'dc:source': 'Imported from SharePoint',
      },
    });

    const putReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-uuid-1');
    expect(putReq.request.body.properties['dc:rights']).toBe('agentic-ui:content-lake:digest-abc');
    putReq.flush({
      uid: 'doc-uuid-1',
      properties: {
        'file:content': { digest: 'digest-abc' },
        'dc:rights': 'agentic-ui:content-lake:digest-abc',
      },
    });

    await expect(mark$).resolves.toEqual([
      expect.objectContaining({
        properties: expect.objectContaining({
          'dc:rights': 'agentic-ui:content-lake:digest-abc',
        }),
      }),
    ]);
  });

  it('checkIngested uses an empty sourceId when no ids are available', async () => {
    const ingested$ = firstValueFrom(service.checkIngested('doc-uuid-1', []));
    const req = httpMock.expectOne('/nuxeo/api/v1/automation/HylandIngest.CheckDigest');
    expect(req.request.body).toEqual({
      params: { xpath: 'file:content', sourceId: '' },
      context: {},
      input: 'doc-uuid-1',
    });
    req.flush({
      responseCode: 200,
      responseMessage: 'OK',
      response: { exists: false },
    });
    await expect(ingested$).resolves.toBe(false);
  });

  it('checkIngested calls HylandIngest.CheckDigest with a source id', async () => {
    const ingested$ = firstValueFrom(service.checkIngested('doc-uuid-1', ['source-1']));
    const req = httpMock.expectOne('/nuxeo/api/v1/automation/HylandIngest.CheckDigest');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      params: { xpath: 'file:content', sourceId: 'source-1' },
      context: {},
      input: 'doc-uuid-1',
    });
    req.flush({
      responseCode: 200,
      responseMessage: 'OK',
      response: { exists: true },
    });

    await expect(ingested$).resolves.toBe(true);
  });

  it('checkIngested tries the next source id when the first is not indexed', async () => {
    const ingested$ = firstValueFrom(service.checkIngested('doc-uuid-1', ['source-1', 'source-2']));

    const firstReq = httpMock.expectOne('/nuxeo/api/v1/automation/HylandIngest.CheckDigest');
    expect(firstReq.request.body.params.sourceId).toBe('source-1');
    firstReq.flush({
      responseCode: 200,
      responseMessage: 'OK',
      response: { exists: false },
    });

    const secondReq = httpMock.expectOne('/nuxeo/api/v1/automation/HylandIngest.CheckDigest');
    expect(secondReq.request.body.params.sourceId).toBe('source-2');
    secondReq.flush({
      responseCode: 200,
      responseMessage: 'OK',
      response: { exists: true },
    });

    await expect(ingested$).resolves.toBe(true);
  });

  it('backfillIngestMarkerIfNeeded marks documents already present in Content Lake', async () => {
    const doc = {
      uid: 'doc-uuid-1',
      title: 'Sample',
      type: 'File',
      path: '/default-domain/sample.pdf',
      lastModified: '2026-06-12T00:00:00.000Z',
      properties: {
        'file:content': { name: 'sample.pdf', length: '1024', digest: 'digest-abc' },
      },
    };

    const updated$ = firstValueFrom(service.backfillIngestMarkerIfNeeded(doc, ['source-1']));

    const checkReq = httpMock.expectOne('/nuxeo/api/v1/automation/HylandIngest.CheckDigest');
    checkReq.flush({
      responseCode: 200,
      responseMessage: 'OK',
      response: { exists: true },
    });

    const getReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-uuid-1');
    getReq.flush({
      uid: 'doc-uuid-1',
      properties: {
        'file:content': { digest: 'digest-abc' },
      },
    });

    const putReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-uuid-1');
    putReq.flush({
      uid: 'doc-uuid-1',
      properties: {
        'file:content': { digest: 'digest-abc' },
        'dc:source': 'agentic-ui:content-lake:digest-abc',
      },
    });

    await expect(updated$).resolves.toEqual({
      doc: expect.objectContaining({
        uid: 'doc-uuid-1',
        properties: expect.objectContaining({
          'dc:source': 'agentic-ui:content-lake:digest-abc',
        }),
      }),
      presentInContentLake: true,
    });
  });

  it('backfillIngestMarkerIfNeeded reports presence when marker properties are occupied', async () => {
    const doc = {
      uid: 'doc-uuid-1',
      title: 'Sample',
      type: 'File',
      path: '/default-domain/sample.pdf',
      lastModified: '2026-06-12T00:00:00.000Z',
      properties: {
        'file:content': { name: 'sample.pdf', length: '1024', digest: 'digest-abc' },
        'dc:source': 'Imported from SharePoint',
        'dc:rights': 'All rights reserved',
      },
    };

    const updated$ = firstValueFrom(service.backfillIngestMarkerIfNeeded(doc, ['source-1']));

    const checkReq = httpMock.expectOne('/nuxeo/api/v1/automation/HylandIngest.CheckDigest');
    checkReq.flush({
      responseCode: 200,
      responseMessage: 'OK',
      response: { exists: true },
    });

    await expect(updated$).resolves.toEqual({
      doc: null,
      presentInContentLake: true,
    });
    httpMock.expectNone('/nuxeo/api/v1/id/doc-uuid-1');
  });

  it('backfillIngestMarkerIfNeeded skips when the marker is already current', async () => {
    const doc = {
      uid: 'doc-uuid-1',
      title: 'Sample',
      type: 'File',
      path: '/default-domain/sample.pdf',
      lastModified: '2026-06-12T00:00:00.000Z',
      properties: {
        'file:content': { name: 'sample.pdf', length: '1024', digest: 'digest-abc' },
        'dc:rights': 'agentic-ui:content-lake:digest-abc',
      },
    };

    const updated$ = firstValueFrom(service.backfillIngestMarkerIfNeeded(doc));
    await expect(updated$).resolves.toEqual({
      doc: null,
      presentInContentLake: true,
    });
    httpMock.expectNone('/nuxeo/api/v1/automation/HylandIngest.CheckDigest');
  });
});
