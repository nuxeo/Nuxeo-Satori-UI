import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import {
  BLOB_NOT_ATTACHED_ERROR,
  DEFAULT_IMPORT_PARENT_PATH,
  DOMAIN_CONTAINER_PATH,
  DocumentImportService,
  MAIN_BLOB_POLL_INTERVAL_MS,
  MAIN_BLOB_POLL_MAX_ATTEMPTS,
  documentHasMainBlob,
  documentHasPersistedMainBlob,
  inferBlobDocTypeFromFile,
  isBlobHoldingDocType,
  isRepositoryRootPath,
  isRestrictedImportParentPath,
  mergeCreateDocumentBody,
  normalizeImportParentPath,
  resolveImportBlobDocType,
  sanitizeDocumentCreateName,
  summarizeCsvImportReport,
} from './document-import.service';

function flushEmptyWithDefault(
  httpMock: HttpTestingController,
  parentPath: string,
  docType: string,
): void {
  const base = nuxeoPathForEmptyWithDefault(parentPath);
  const req = httpMock.expectOne(
    (r) => r.url === `${base}/@emptyWithDefault` && r.params.get('type') === docType,
  );
  expect(req.request.method).toBe('GET');
  req.flush({
    uid: '',
    name: '',
    title: '',
    type: docType,
    path: '',
    lastModified: '',
    properties: { 'dc:title': '' },
  });
}

function nuxeoPathForEmptyWithDefault(parentPath: string): string {
  const safePath = normalizeImportParentPath(parentPath);
  return safePath === '/'
    ? '/nuxeo/api/v1/path'
    : `/nuxeo/api/v1/path${safePath}`.replace(/\/$/, '');
}

describe('DocumentImportService', () => {
  let service: DocumentImportService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });

    service = TestBed.inject(DocumentImportService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('identifies blob-holding document types', () => {
    expect(isBlobHoldingDocType('File')).toBe(true);
    expect(isBlobHoldingDocType('Folder')).toBe(false);
  });

  it('defaults import parent path to repository root', async () => {
    await expect(firstValueFrom(service.getDefaultImportParentPath())).resolves.toBe('/');
    expect(DEFAULT_IMPORT_PARENT_PATH).toBe('/');
  });

  it('classifies repository root vs restricted domain container paths', () => {
    expect(isRepositoryRootPath('/')).toBe(true);
    expect(isRepositoryRootPath('//')).toBe(true);
    expect(isRepositoryRootPath('/workspaces/demo')).toBe(false);
    expect(isRestrictedImportParentPath('/')).toBe(false);
    expect(isRestrictedImportParentPath(DOMAIN_CONTAINER_PATH)).toBe(true);
    expect(isRestrictedImportParentPath('/default-domain/')).toBe(true);
    expect(normalizeImportParentPath('/workspaces/demo/')).toBe('/workspaces/demo');
  });

  it('imports CSV via CSV.Import automation', async () => {
    const csv = new File(['name,type\na,File'], 'docs.csv', { type: 'text/csv' });
    const report$ = firstValueFrom(
      service.importCsvFile({
        path: '/default-domain/workspaces/demo',
        file: csv,
        sendReport: true,
        documentMode: false,
      }),
    );

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/CSV.Import');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeInstanceOf(FormData);
    const form = req.request.body as FormData;
    const requestJson = JSON.parse(await (form.get('request') as Blob).text());
    expect(requestJson.params).toEqual({
      path: '/default-domain/workspaces/demo',
      sendReport: true,
      documentMode: false,
      trim: true,
    });
    expect(form.get('file')).toBe(csv);
    req.flush('<p>Import completed</p>');

    await expect(report$).resolves.toBe('<p>Import completed</p>');
  });

  it('normalizes path and passes documentMode/trim to CSV.Import', async () => {
    const csv = new File(['name,type\na,File'], 'docs.csv', { type: 'text/csv' });
    const report$ = firstValueFrom(
      service.importCsvFile({
        path: '/default-domain/workspaces/demo/',
        file: csv,
        sendReport: false,
        documentMode: true,
        trim: false,
      }),
    );

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/CSV.Import');
    const form = req.request.body as FormData;
    const requestJson = JSON.parse(await (form.get('request') as Blob).text());
    expect(requestJson.params).toEqual({
      path: '/default-domain/workspaces/demo',
      sendReport: false,
      documentMode: true,
      trim: false,
    });
    req.flush('done');

    await expect(report$).resolves.toBe('done');
  });

  it('surfaces CSV.Import HTTP errors', async () => {
    const csv = new File(['name,type\na,File'], 'docs.csv', { type: 'text/csv' });
    const report$ = firstValueFrom(
      service.importCsvFile({
        path: '/default-domain/workspaces/demo',
        file: csv,
      }),
    );

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/CSV.Import');
    req.flush('Not found', { status: 404, statusText: 'Not Found' });

    await expect(report$).rejects.toMatchObject({ status: 404 });
  });

  it('summarizeCsvImportReport strips HTML and is empty for a report with no text', () => {
    expect(summarizeCsvImportReport('<p>Imported <b>3</b> documents</p>')).toBe(
      'Imported 3 documents',
    );
    expect(
      summarizeCsvImportReport('<p>Imported 2 documents</p><br/>Skipped 1 row<br/>Errors: 0'),
    ).toBe('Imported 2 documents\n\nSkipped 1 row\nErrors: 0');
    expect(summarizeCsvImportReport('Row one<br/>Row two')).toBe('Row one\nRow two');
    expect(summarizeCsvImportReport('   ')).toBe('');
  });

  it('importFromCsvText creates documents from valid rows', async () => {
    const csv = [
      'name,type,dc:title',
      'folder-a,Folder,Folder A',
      'folder-a/doc-a,File,Doc A',
    ].join('\n');

    const result$ = firstValueFrom(
      service.importFromCsvText('/default-domain/workspaces/demo', csv),
    );

    flushEmptyWithDefault(httpMock, '/default-domain/workspaces/demo', 'Folder');
    const folderReq = httpMock.expectOne('/nuxeo/api/v1/path/default-domain/workspaces/demo');
    folderReq.flush({
      uid: 'folder-a',
      title: 'Folder A',
      type: 'Folder',
      path: '/default-domain/workspaces/demo/folder-a',
      properties: { 'dc:title': 'Folder A' },
    });

    flushEmptyWithDefault(httpMock, '/default-domain/workspaces/demo/folder-a', 'File');
    const fileReq = httpMock.expectOne(
      '/nuxeo/api/v1/path/default-domain/workspaces/demo/folder-a',
    );
    fileReq.flush({
      uid: 'doc-a',
      title: 'Doc A',
      type: 'File',
      path: '/default-domain/workspaces/demo/folder-a/doc-a',
      properties: { 'dc:title': 'Doc A' },
    });

    const result = await result$;
    expect(result.created).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('importFromCsvText rejects CSV without name/type columns', async () => {
    const result = await firstValueFrom(
      service.importFromCsvText('/ws', 'title,description\nA,Desc'),
    );
    expect(result.created).toHaveLength(0);
    expect(result.errors[0]).toContain('name');
    httpMock.expectNone('/nuxeo/api/v1/path/ws');
  });

  it('importFromCsvText skips rows with file:content', async () => {
    const csv = ['name,type,file:content', 'doc,File,binary.pdf'].join('\n');
    const result = await firstValueFrom(service.importFromCsvText('/ws', csv));
    expect(result.created).toHaveLength(0);
    expect(result.skipped[0]).toContain('file:content');
    httpMock.expectNone('/nuxeo/api/v1/path/ws');
  });

  it('importFromCsvText reports missing parent paths', async () => {
    const csv = ['name,type', 'orphan/doc,File'].join('\n');
    const result = await firstValueFrom(service.importFromCsvText('/ws', csv));
    expect(result.created).toHaveLength(0);
    expect(result.errors[0]).toContain('orphan/doc');
    httpMock.expectNone('/nuxeo/api/v1/path/ws');
  });

  it('detects main blob on document properties', () => {
    expect(
      documentHasMainBlob({
        uid: '1',
        title: 't',
        type: 'File',
        path: '/a',
        lastModified: '2026-01-01T00:00:00.000Z',
        properties: { 'file:content': { name: 'photo.jpg', length: '1024' } },
      }),
    ).toBe(true);
    expect(
      documentHasPersistedMainBlob({
        uid: '1',
        title: 't',
        type: 'File',
        path: '/a',
        lastModified: '2026-01-01T00:00:00.000Z',
        properties: { 'file:content': { name: 'photo.jpg' } },
      }),
    ).toBe(false);
    expect(
      documentHasPersistedMainBlob({
        uid: '1',
        title: 't',
        type: 'File',
        path: '/a',
        lastModified: '2026-01-01T00:00:00.000Z',
        properties: { 'file:content': { name: '', 'mime-type': 'image/jpeg' } },
      }),
    ).toBe(false);
    expect(
      documentHasMainBlob({
        uid: '1',
        title: 't',
        type: 'File',
        path: '/a',
        lastModified: '2026-01-01T00:00:00.000Z',
        properties: { 'file:content': null },
      }),
    ).toBe(false);
  });

  it('initializes upload batch via /upload/new/default', async () => {
    const batchId$ = firstValueFrom(service.initUploadBatch());
    const req = httpMock.expectOne('/nuxeo/api/v1/upload/new/default');
    expect(req.request.method).toBe('POST');
    req.flush({ batchId: 'batch-abc' });

    await expect(batchId$).resolves.toBe('batch-abc');
  });

  it('imports a file and attaches blob to created document', async () => {
    const file = new File(['jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const import$ = firstValueFrom(service.importFiles('/ws', [file]));

    const initReq = httpMock.expectOne('/nuxeo/api/v1/upload/new/default');
    initReq.flush({ batchId: 'batch-1' });

    const uploadReq = httpMock.expectOne('/nuxeo/api/v1/upload/batch-1/0');
    expect(uploadReq.request.headers.get('X-File-Name')).toBe('photo.jpg');
    uploadReq.flush('');

    const verifyReq = httpMock.expectOne('/nuxeo/api/v1/upload/batch-1/0');
    expect(verifyReq.request.method).toBe('GET');
    verifyReq.flush({ name: 'photo.jpg', size: file.size, uploadType: 'normal' });

    flushEmptyWithDefault(httpMock, '/ws', 'File');
    const createReq = httpMock.expectOne('/nuxeo/api/v1/path/ws');
    expect(createReq.request.body.properties['file:content']).toEqual({
      'upload-batch': 'batch-1',
      'upload-fileId': '0',
    });
    createReq.flush({
      uid: 'doc-1',
      title: 'photo',
      type: 'File',
      path: '/ws/photo',
      properties: {
        'dc:title': 'photo',
        'file:content': { name: 'photo.jpg', length: String(file.size), 'mime-type': 'image/jpeg' },
      },
    });

    const docs = await import$;
    expect(docs).toHaveLength(1);
    expect(docs[0].uid).toBe('doc-1');
  });

  it('fails import when created document has no main blob', async () => {
    vi.useFakeTimers();
    const file = new File(['x'], 'empty.jpg', { type: 'image/jpeg' });
    const import$ = firstValueFrom(service.importFiles('/ws', [file]));

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-2' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-2/0').flush('');
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-2/0').flush({ name: 'empty.jpg', size: 1 });
    flushEmptyWithDefault(httpMock, '/ws', 'File');
    httpMock.expectOne('/nuxeo/api/v1/path/ws').flush({
      uid: 'doc-2',
      title: 'empty',
      type: 'File',
      path: '/ws/empty',
      properties: { 'dc:title': 'empty', 'file:content': null },
    });

    const nullDoc = {
      uid: 'doc-2',
      title: 'empty',
      type: 'File',
      path: '/ws/empty',
      properties: { 'dc:title': 'empty', 'file:content': null },
    };

    const rejection = expect(import$).rejects.toThrow(BLOB_NOT_ATTACHED_ERROR);
    for (let i = 0; i <= MAIN_BLOB_POLL_MAX_ATTEMPTS; i++) {
      await Promise.resolve();
      const refetchReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-2');
      expect(refetchReq.request.headers.get('properties')).toBe('file:content');
      refetchReq.flush(nullDoc);
      httpMock.expectNone('/nuxeo/api/v1/id/doc-2/@blob/file:content');
      await vi.advanceTimersByTimeAsync(MAIN_BLOB_POLL_INTERVAL_MS);
    }

    httpMock.expectNone('/nuxeo/api/v1/automation/Document.Trash');

    await rejection;
    vi.useRealTimers();
  });

  it('does not call @blob HEAD when properties already include a persisted blob', async () => {
    const file = new File(['x'], 'local.png', { type: 'image/png' });
    const create$ = firstValueFrom(
      service.createBlobHoldingDocument('/ws', 'local', 'File', { 'dc:title': 'local' }, file),
    );

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-local' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-local/0').flush('');
    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-local/0')
      .flush({ name: 'local.png', size: file.size });
    flushEmptyWithDefault(httpMock, '/ws', 'File');
    httpMock.expectOne('/nuxeo/api/v1/path/ws').flush({
      uid: 'doc-local',
      title: 'local',
      type: 'File',
      path: '/ws/local',
      properties: { 'dc:title': 'local', 'file:content': null },
    });

    const refetchReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-local');
    refetchReq.flush({
      uid: 'doc-local',
      title: 'local',
      type: 'File',
      path: '/ws/local',
      properties: {
        'dc:title': 'local',
        'file:content': {
          name: 'local.png',
          length: '1',
          'mime-type': 'image/png',
          digest: 'abc123',
        },
      },
    });

    const doc = await create$;
    expect(doc.uid).toBe('doc-local');
    httpMock.expectNone('/nuxeo/api/v1/id/doc-local/@blob/file:content');
  });

  it('does not call @blob HEAD when file:content key is present but null', async () => {
    vi.useFakeTimers();
    const file = new File(['x'], 'pending.png', { type: 'image/png' });
    const create$ = firstValueFrom(
      service.createBlobHoldingDocument('/ws', 'pending', 'File', { 'dc:title': 'pending' }, file),
    );

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-pending' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-pending/0').flush('');
    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-pending/0')
      .flush({ name: 'pending.png', size: file.size });
    flushEmptyWithDefault(httpMock, '/ws', 'File');
    httpMock.expectOne('/nuxeo/api/v1/path/ws').flush({
      uid: 'doc-pending',
      title: 'pending',
      type: 'File',
      path: '/ws/pending',
      properties: { 'dc:title': 'pending', 'file:content': null },
    });

    const nullDoc = {
      uid: 'doc-pending',
      title: 'pending',
      type: 'File',
      path: '/ws/pending',
      properties: { 'dc:title': 'pending', 'file:content': null },
    };

    const refetchReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-pending');
    refetchReq.flush(nullDoc);
    httpMock.expectNone('/nuxeo/api/v1/id/doc-pending/@blob/file:content');

    await vi.advanceTimersByTimeAsync(MAIN_BLOB_POLL_INTERVAL_MS);
    const refetchReq2 = httpMock.expectOne('/nuxeo/api/v1/id/doc-pending');
    refetchReq2.flush({
      ...nullDoc,
      properties: {
        'dc:title': 'pending',
        'file:content': {
          name: 'pending.png',
          length: '1',
          'mime-type': 'image/png',
          digest: 'abc123',
        },
      },
    });

    const doc = await create$;
    expect(doc.uid).toBe('doc-pending');
    httpMock.expectNone('/nuxeo/api/v1/id/doc-pending/@blob/file:content');
    vi.useRealTimers();
  });

  it('succeeds when cloud properties omit file:content but @blob HEAD succeeds (NXSAT-198)', async () => {
    const file = new File(['x'], 'cloud.png', { type: 'image/png' });
    const create$ = firstValueFrom(
      service.createBlobHoldingDocument('/ws', 'cloud', 'Picture', { 'dc:title': 'cloud' }, file),
    );

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-cloud' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-cloud/0').flush('');
    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-cloud/0')
      .flush({ name: 'cloud.png', size: file.size });
    flushEmptyWithDefault(httpMock, '/ws', 'Picture');
    httpMock.expectOne('/nuxeo/api/v1/path/ws').flush({
      uid: 'doc-cloud',
      title: 'cloud',
      type: 'Picture',
      path: '/ws/cloud',
      properties: { 'dc:title': 'cloud' },
    });

    const refetchReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-cloud');
    refetchReq.flush({
      uid: 'doc-cloud',
      title: 'cloud',
      type: 'Picture',
      path: '/ws/cloud',
      properties: {},
    });
    const blobHeadReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-cloud/@blob/file:content');
    expect(blobHeadReq.request.method).toBe('HEAD');
    blobHeadReq.flush(null, {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'image/png', 'Content-Length': '70' },
    });

    const doc = await create$;
    expect(doc.uid).toBe('doc-cloud');
    expect(documentHasPersistedMainBlob(doc)).toBe(true);
  });

  it('succeeds when polling times out but documentHasMainBlob is true', async () => {
    vi.useFakeTimers();
    const file = new File(['x'], 'slow.jpg', { type: 'image/jpeg' });
    const create$ = firstValueFrom(
      service.createBlobHoldingDocument('/ws', 'slow', 'File', { 'dc:title': 'slow' }, file),
    );

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-slow' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-slow/0').flush('');
    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-slow/0')
      .flush({ name: 'slow.jpg', size: file.size });
    flushEmptyWithDefault(httpMock, '/ws', 'File');
    httpMock.expectOne('/nuxeo/api/v1/path/ws').flush({
      uid: 'doc-slow',
      title: 'slow',
      type: 'File',
      path: '/ws/slow',
      properties: { 'dc:title': 'slow', 'file:content': null },
    });

    const slowBlobDoc = {
      uid: 'doc-slow',
      title: 'slow',
      type: 'File',
      path: '/ws/slow',
      properties: {
        'dc:title': 'slow',
        'file:content': { name: 'slow.jpg' },
      },
    };

    for (let i = 0; i < MAIN_BLOB_POLL_MAX_ATTEMPTS; i++) {
      await Promise.resolve();
      const refetchReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-slow');
      refetchReq.flush(slowBlobDoc);
      await vi.advanceTimersByTimeAsync(MAIN_BLOB_POLL_INTERVAL_MS);
    }

    await Promise.resolve();
    const finalRefetch = httpMock.expectOne('/nuxeo/api/v1/id/doc-slow');
    finalRefetch.flush(slowBlobDoc);

    const doc = await create$;
    expect(doc.uid).toBe('doc-slow');
    expect(documentHasMainBlob(doc)).toBe(true);
    vi.useRealTimers();
  });

  it('falls back to fresh upload when staged batch is no longer available', async () => {
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    const create$ = firstValueFrom(
      service.createBlobHoldingDocumentReliable(
        '/ws',
        'photo',
        'Picture',
        { 'dc:title': 'photo' },
        file,
        { batchId: 'batch-expired', fileIndex: 0 },
      ),
    );

    const staleBatchReq = httpMock.expectOne('/nuxeo/api/v1/upload/batch-expired/0');
    expect(staleBatchReq.request.method).toBe('GET');
    staleBatchReq.flush('not found', { status: 404, statusText: 'Not Found' });

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-fresh' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-fresh/0').flush('');
    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-fresh/0')
      .flush({ name: 'photo.jpg', size: file.size });
    flushEmptyWithDefault(httpMock, '/ws', 'Picture');
    httpMock.expectOne('/nuxeo/api/v1/path/ws').flush({
      uid: 'doc-fresh',
      title: 'photo',
      type: 'Picture',
      path: '/ws/photo',
      properties: {
        'dc:title': 'photo',
        'file:content': { name: 'photo.jpg', length: String(file.size), digest: 'abc' },
      },
    });

    const doc = await create$;
    expect(doc.uid).toBe('doc-fresh');
  });

  it('falls back to fresh upload when staged batch returns HTTP 410', async () => {
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    const create$ = firstValueFrom(
      service.createBlobHoldingDocumentReliable(
        '/ws',
        'photo',
        'Picture',
        { 'dc:title': 'photo' },
        file,
        { batchId: 'batch-gone', fileIndex: 0 },
      ),
    );

    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-gone/0')
      .flush('gone', { status: 410, statusText: 'Gone' });
    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-fresh' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-fresh/0').flush('');
    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-fresh/0')
      .flush({ name: 'photo.jpg', size: file.size });
    flushEmptyWithDefault(httpMock, '/ws', 'Picture');
    httpMock.expectOne('/nuxeo/api/v1/path/ws').flush({
      uid: 'doc-fresh',
      title: 'photo',
      type: 'Picture',
      path: '/ws/photo',
      properties: {
        'dc:title': 'photo',
        'file:content': { name: 'photo.jpg', length: String(file.size), digest: 'abc' },
      },
    });

    const doc = await create$;
    expect(doc.uid).toBe('doc-fresh');
  });

  it('does not fall back to fresh upload when batch check fails with auth or server errors', async () => {
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    const create$ = firstValueFrom(
      service.createBlobHoldingDocumentReliable(
        '/ws',
        'photo',
        'Picture',
        { 'dc:title': 'photo' },
        file,
        { batchId: 'batch-auth', fileIndex: 0 },
      ),
    );

    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-auth/0')
      .flush('unauthorized', { status: 401, statusText: 'Unauthorized' });

    await expect(create$).rejects.toMatchObject({ status: 401 });
    httpMock.expectNone('/nuxeo/api/v1/upload/new/default');
  });

  it('succeeds when create response omits blob but re-fetch has file:content', async () => {
    const file = new File(['jpeg-bytes'], 'cat.jpg', { type: 'image/jpeg' });
    const import$ = firstValueFrom(service.importFiles('/ws', [file]));

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-5' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-5/0').flush('');
    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-5/0')
      .flush({ name: 'cat.jpg', size: file.size });
    flushEmptyWithDefault(httpMock, '/ws', 'File');
    httpMock.expectOne('/nuxeo/api/v1/path/ws').flush({
      uid: 'doc-5',
      title: 'cat',
      type: 'File',
      path: '/ws/cat',
      properties: { 'dc:title': 'cat', 'file:content': null },
    });

    const refetchReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-5');
    expect(refetchReq.request.headers.get('properties')).toBe('file:content');
    refetchReq.flush({
      uid: 'doc-5',
      title: 'cat',
      type: 'File',
      path: '/ws/cat',
      properties: {
        'dc:title': 'cat',
        'file:content': { name: 'cat.jpg', length: String(file.size), 'mime-type': 'image/jpeg' },
      },
    });

    const docs = await import$;
    expect(docs).toHaveLength(1);
    expect(docs[0].properties?.['file:content']).toEqual({
      name: 'cat.jpg',
      length: String(file.size),
      'mime-type': 'image/jpeg',
    });
  });

  it('succeeds when create response only has upload-batch reference', async () => {
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const create$ = firstValueFrom(
      service.createBlobHoldingDocument('/ws', 'photo', 'Picture', { 'dc:title': 'photo' }, file),
    );

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-6' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-6/0').flush('');
    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-6/0')
      .flush({ name: 'photo.jpg', size: file.size });
    flushEmptyWithDefault(httpMock, '/ws', 'Picture');
    httpMock.expectOne('/nuxeo/api/v1/path/ws').flush({
      uid: 'doc-6',
      title: 'photo',
      type: 'Picture',
      path: '/ws/photo',
      properties: {
        'dc:title': 'photo',
        'file:content': { 'upload-batch': 'batch-6', 'upload-fileId': '0' },
      },
    });

    const refetchReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-6');
    refetchReq.flush({
      uid: 'doc-6',
      title: 'photo',
      type: 'Picture',
      path: '/ws/photo',
      properties: {
        'dc:title': 'photo',
        'file:content': { name: 'photo.jpg', length: String(file.size), digest: 'abc123' },
      },
    });

    const doc = await create$;
    expect(doc.uid).toBe('doc-6');
    expect(documentHasMainBlob(doc)).toBe(true);
  });

  it('accepts zero-byte batch uploads during verification', async () => {
    const file = new File([], 'empty.txt', { type: 'text/plain' });
    const import$ = firstValueFrom(service.importFiles('/ws', [file]));

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-3' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-3/0').flush('');
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-3/0').flush({ name: 'empty.txt', size: 0 });
    flushEmptyWithDefault(httpMock, '/ws', 'File');
    httpMock.expectOne('/nuxeo/api/v1/path/ws').flush({
      uid: 'doc-3',
      title: 'empty',
      type: 'File',
      path: '/ws/empty',
      properties: {
        'dc:title': 'empty',
        'file:content': { name: 'empty.txt', length: '0', 'mime-type': 'text/plain' },
      },
    });

    const docs = await import$;
    expect(docs).toHaveLength(1);
  });

  it('sanitizes unsafe characters in X-File-Name header', async () => {
    const file = new File(['x'], 'bad\r\nname.jpg', { type: 'image/jpeg' });
    const import$ = firstValueFrom(service.importFiles('/ws', [file]));

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-4' });
    const uploadReq = httpMock.expectOne('/nuxeo/api/v1/upload/batch-4/0');
    expect(uploadReq.request.headers.get('X-File-Name')).toBe('badname.jpg');
    uploadReq.flush('');
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-4/0').flush({ name: 'badname.jpg', size: 1 });
    flushEmptyWithDefault(httpMock, '/ws', 'File');
    httpMock.expectOne('/nuxeo/api/v1/path/ws').flush({
      uid: 'doc-4',
      title: 'badname',
      type: 'File',
      path: '/ws/badname',
      properties: {
        'dc:title': 'badname',
        'file:content': { name: 'badname.jpg', length: '1' },
      },
    });

    await import$;
  });

  it('creates a blob-holding document from a staged batch', async () => {
    const create$ = firstValueFrom(
      service.createBlobHoldingDocumentFromBatch(
        '/ws',
        'photo',
        'Picture',
        { 'dc:title': 'photo' },
        'batch-staged',
        0,
      ),
    );

    flushEmptyWithDefault(httpMock, '/ws', 'Picture');
    const createReq = httpMock.expectOne('/nuxeo/api/v1/path/ws');
    expect(createReq.request.body.properties['file:content']).toEqual({
      'upload-batch': 'batch-staged',
      'upload-fileId': '0',
    });
    createReq.flush({
      uid: 'doc-staged',
      title: 'photo',
      type: 'Picture',
      path: '/ws/photo',
      properties: {
        'dc:title': 'photo',
        'file:content': { name: 'photo.jpg', length: '1024', digest: 'abc' },
      },
    });

    const doc = await create$;
    expect(doc.uid).toBe('doc-staged');
  });

  it('stages a file in a batch on selection (Web UI immediate upload)', async () => {
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    const progress: number[] = [];
    const stage$ = firstValueFrom(
      service.stageFileInBatch(file, { onProgress: (pct) => progress.push(pct) }),
    );

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-stage' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-stage/0').flush('');
    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-stage/0')
      .flush({ name: 'photo.jpg', size: file.size });

    const staged = await stage$;
    expect(staged).toEqual({ batchId: 'batch-stage', fileIndex: 0 });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('infers Picture from png files', () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    expect(inferBlobDocTypeFromFile(file)).toBe('Picture');
    expect(resolveImportBlobDocType(file, ['File', 'Picture'])).toBe('Picture');
  });

  it('importFilesWithProperties creates documents with custom metadata and type', async () => {
    const file = new File(['jpeg-bytes'], 'photo.png', { type: 'image/png' });
    const import$ = firstValueFrom(
      service.importFilesWithProperties('/ws', [
        {
          file,
          docType: 'Picture',
          properties: {
            'dc:title': 'My Picture',
            'dc:description': 'desc',
            'dc:nature': 'article',
          },
        },
      ]),
    );

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-pic' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-pic/0').flush('');
    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-pic/0')
      .flush({ name: 'photo.png', size: file.size });
    flushEmptyWithDefault(httpMock, '/ws', 'Picture');
    const createReq = httpMock.expectOne('/nuxeo/api/v1/path/ws');
    expect(createReq.request.body.type).toBe('Picture');
    expect(createReq.request.body.properties['dc:title']).toBe('My Picture');
    expect(createReq.request.body.properties['dc:description']).toBe('desc');
    expect(createReq.request.body.properties['dc:nature']).toBe('article');
    createReq.flush({
      uid: 'pic-1',
      title: 'My Picture',
      type: 'Picture',
      path: '/ws/photo',
      properties: {
        'dc:title': 'My Picture',
        'file:content': { name: 'photo.png', length: String(file.size), 'mime-type': 'image/png' },
      },
    });

    const docs = await import$;
    expect(docs[0].uid).toBe('pic-1');
  });

  it('createDocumentWithBlob uses emptyWithDefault and skips null DC overrides (Picture create)', async () => {
    const file = new File(['png'], 'Screenshot 2024-07-16 132702.png', { type: 'image/png' });
    const create$ = firstValueFrom(
      service.createBlobHoldingDocument(
        '/ws',
        'Edit user',
        'Picture',
        {
          'dc:title': 'Edit user',
          'dc:description': null,
          'dc:nature': null,
          'dc:subjects': [],
          'dc:coverage': null,
          'dc:expired': null,
        },
        file,
      ),
    );

    httpMock.expectOne('/nuxeo/api/v1/upload/new/default').flush({ batchId: 'batch-picture' });
    httpMock.expectOne('/nuxeo/api/v1/upload/batch-picture/0').flush('');
    httpMock
      .expectOne('/nuxeo/api/v1/upload/batch-picture/0')
      .flush({ name: 'Screenshot 2024-07-16 132702.png', size: file.size });

    const emptyReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/path/ws/@emptyWithDefault' && r.params.get('type') === 'Picture',
    );
    emptyReq.flush({
      uid: '',
      name: '',
      title: '',
      type: 'Picture',
      path: '',
      lastModified: '',
      properties: {
        'dc:title': '',
        'dc:description': '',
        'picture:info': { width: 0, height: 0 },
      },
    });

    const createReq = httpMock.expectOne('/nuxeo/api/v1/path/ws');
    expect(createReq.request.body.type).toBe('Picture');
    expect(createReq.request.body.name).toBe('Edit user');
    expect(createReq.request.body.properties['dc:title']).toBe('Edit user');
    expect(createReq.request.body.properties['dc:description']).toBe('');
    expect(createReq.request.body.properties['dc:nature']).toBeUndefined();
    expect(createReq.request.body.properties['dc:coverage']).toBeUndefined();
    expect(createReq.request.body.properties['file:content']).toEqual({
      'upload-batch': 'batch-picture',
      'upload-fileId': '0',
    });
    createReq.flush({
      uid: 'pic-create',
      title: 'Edit user',
      type: 'Picture',
      path: '/ws/Edit user',
      properties: {
        'dc:title': 'Edit user',
        'file:content': {
          name: 'Screenshot 2024-07-16 132702.png',
          length: String(file.size),
          digest: 'abc',
        },
      },
    });

    const doc = await create$;
    expect(doc.uid).toBe('pic-create');
  });

  it('sanitizeDocumentCreateName matches Web UI slash-only sanitization', () => {
    expect(sanitizeDocumentCreateName('Test Domain')).toBe('Test Domain');
    expect(sanitizeDocumentCreateName('a/b\\c')).toBe('a-b-c');
  });

  it('mergeCreateDocumentBody preserves server defaults and skips null overrides', () => {
    const body = mergeCreateDocumentBody(
      {
        name: '',
        properties: {
          'dc:title': '',
          'domain:content_roots': [],
          'domain:display_type': 'false',
        },
      },
      'Domain',
      'Test Domain',
      {
        'dc:title': 'Test Domain',
        'dc:description': null,
        'dc:nature': null,
        'dc:subjects': [],
        'dc:coverage': null,
        'dc:expired': null,
      },
    );

    expect(body['name']).toBe('Test Domain');
    expect(body['type']).toBe('Domain');
    expect((body['properties'] as Record<string, unknown>)['dc:title']).toBe('Test Domain');
    expect((body['properties'] as Record<string, unknown>)['dc:nature']).toBeUndefined();
    expect((body['properties'] as Record<string, unknown>)['domain:display_type']).toBe('false');
  });

  it('createChildDocument uses @emptyWithDefault then posts merged body (NXSAT-199)', async () => {
    const create$ = firstValueFrom(
      service.createChildDocument('/', 'Test Domain', 'Domain', {
        'dc:title': 'Test Domain',
        'dc:description': null,
        'dc:nature': null,
        'dc:subjects': [],
        'dc:coverage': null,
        'dc:expired': null,
      }),
    );

    flushEmptyWithDefault(httpMock, '/', 'Domain');
    const createReq = httpMock.expectOne('/nuxeo/api/v1/path/');
    expect(createReq.request.method).toBe('POST');
    expect(createReq.request.body.name).toBe('Test Domain');
    expect(createReq.request.body.type).toBe('Domain');
    expect(createReq.request.body.properties['dc:title']).toBe('Test Domain');
    expect(createReq.request.body.properties['dc:nature']).toBeUndefined();
    createReq.flush({
      uid: 'domain-new',
      title: 'Test Domain',
      type: 'Domain',
      path: '/Test Domain',
      lastModified: '',
      properties: { 'dc:title': 'Test Domain' },
    });

    const doc = await create$;
    expect(doc.uid).toBe('domain-new');
  });
});
