import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import type { NuxeoDocument } from '../models/document.model';
import { BrowseService } from './browse.service';

const CSV_ASYNC_URL = '/nuxeo/api/v1/automation/Bulk.RunAction/@async';
const NXQL_URL = '/nuxeo/api/v1/search/lang/NXQL/execute';

function doc(overrides: Partial<NuxeoDocument> & { uid: string }): NuxeoDocument {
  return {
    title: overrides.uid,
    type: 'File',
    path: `/default-domain/${overrides.uid}`,
    lastModified: '2026-01-01T00:00:00Z',
    properties: {},
    ...overrides,
  } as NuxeoDocument;
}

describe('BrowseService subtypes, clipboard fallbacks, trash and CSV export', () => {
  let service: BrowseService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    service = TestBed.inject(BrowseService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getFolderContext / getCreatableSubtypes', () => {
    it('asks for the subtypes enricher and returns the allowed child types', async () => {
      const pending = firstValueFrom(service.getCreatableSubtypes('/default-domain/workspaces/'));
      const req = httpMock.expectOne(
        (r) => r.url === '/nuxeo/api/v1/path/default-domain/workspaces',
      );
      expect(req.request.headers.get('enrichers.document')).toBe('subtypes');
      req.flush(
        doc({
          uid: 'ws-1',
          type: 'Workspace',
          contextParameters: {
            subtypes: [{ type: 'File' }, { type: 'Folder' }, { type: 'Note' }],
          },
        }),
      );
      expect(await pending).toEqual(['File', 'Folder', 'Note']);
    });

    it('returns an empty list when the folder allows no children', async () => {
      const pending = firstValueFrom(service.getCreatableSubtypes('/default-domain/leaf'));
      httpMock
        .expectOne((r) => r.url === '/nuxeo/api/v1/path/default-domain/leaf')
        .flush(doc({ uid: 'leaf-1', contextParameters: { subtypes: [] } }));
      expect(await pending).toEqual([]);
    });

    it('collapses a bare repository path to the root path', async () => {
      const pending = firstValueFrom(service.getFolderContext('///'));
      const req = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/path/');
      req.flush(doc({ uid: 'root', type: 'Root', path: '/' }));
      expect((await pending).uid).toBe('root');
    });

    it('propagates a folder-context failure', async () => {
      const pending = firstValueFrom(service.getCreatableSubtypes('/nope'));
      httpMock
        .expectOne((r) => r.url === '/nuxeo/api/v1/path/nope')
        .flush('gone', { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('getChildren sorting', () => {
    it('joins several sort keys and their matching directions', async () => {
      const pending = firstValueFrom(
        service.getChildren('/default-domain/ws/', 10, 2, [
          { sortBy: 'dc:title', sortOrder: 'ASC' },
          { sortBy: 'dc:modified', sortOrder: 'DESC' },
        ]),
      );
      const req = httpMock.expectOne(
        (r) => r.url === '/nuxeo/api/v1/path/default-domain/ws/@children',
      );
      expect(req.request.params.get('sortBy')).toBe('dc:title,dc:modified');
      expect(req.request.params.get('sortOrder')).toBe('ASC,DESC');
      expect(req.request.params.get('pageSize')).toBe('10');
      expect(req.request.params.get('currentPageIndex')).toBe('2');
      req.flush({ entries: [] });
      await pending;
    });

    it('sends no sort parameters at all when the caller passed an empty sort list', async () => {
      const pending = firstValueFrom(service.getChildren('/default-domain/ws', 50, 0, []));
      const req = httpMock.expectOne(
        (r) => r.url === '/nuxeo/api/v1/path/default-domain/ws/@children',
      );
      expect(req.request.params.has('sortBy')).toBe(false);
      expect(req.request.params.has('sortOrder')).toBe(false);
      req.flush({ entries: [] });
      await pending;
    });
  });

  describe('getNavTreeChildren path fallback', () => {
    it('keeps the empty tree_children result when the @children fallback also fails', async () => {
      const parent = doc({ uid: 'ws-1', type: 'Workspace', path: '/default-domain/ws' });
      const pending = firstValueFrom(service.getNavTreeChildren(parent));

      httpMock
        .expectOne((r) => r.url.includes('tree_children'))
        .flush({ entries: [], resultsCount: 0 });
      httpMock
        .expectOne((r) => r.url === '/nuxeo/api/v1/path/default-domain/ws/@children')
        .flush('denied', { status: 403, statusText: 'Forbidden' });

      const list = await pending;
      expect(list.entries).toEqual([]);
    });

    it('does not attempt a path fallback for a parent with no usable path', async () => {
      const parent = doc({ uid: 'ws-1', type: 'Workspace', path: '/' });
      const pending = firstValueFrom(service.getNavTreeChildren(parent));
      httpMock
        .expectOne((r) => r.url.includes('tree_children'))
        .flush({ entries: [], resultsCount: 0 });
      httpMock.expectNone((r) => r.url.endsWith('/@children'));
      expect((await pending).entries).toEqual([]);
    });
  });

  describe('copyDocuments / moveDocuments', () => {
    it('issues no request at all for an empty selection', async () => {
      expect(await firstValueFrom(service.copyDocuments([], 'target-1'))).toEqual([]);
      httpMock.expectNone(() => true);
    });

    it('unwraps a single-document response into a one-element list', async () => {
      const pending = firstValueFrom(service.copyDocuments(['doc-1'], 'target-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Document.Copy');
      expect(req.request.body.input).toBe('doc:doc-1');
      req.flush(doc({ uid: 'copy-1' }));
      expect((await pending).map((d) => d.uid)).toEqual(['copy-1']);
    });

    it('returns an empty list when the server answers with neither entries nor a uid', async () => {
      const pending = firstValueFrom(service.copyDocuments(['doc-1'], 'target-1'));
      httpMock.expectOne('/nuxeo/api/v1/automation/Document.Copy').flush({ status: 'ok' });
      expect(await pending).toEqual([]);
    });

    it('retries each document singly when the batch move is rejected', async () => {
      const pending = firstValueFrom(service.moveDocuments(['doc-1', 'doc-2'], 'target-1'));

      const batch = httpMock.expectOne('/nuxeo/api/v1/automation/Document.Move');
      expect(batch.request.body.input).toBe('docs:doc-1,doc-2');
      batch.flush('batch failed', { status: 500, statusText: 'Server Error' });

      const singles = httpMock.match('/nuxeo/api/v1/automation/Document.Move');
      expect(singles.map((r) => r.request.body.input)).toEqual(['doc:doc-1', 'doc:doc-2']);
      singles[0].flush(doc({ uid: 'moved-1' }));
      singles[1].flush('nope', { status: 403, statusText: 'Forbidden' });

      expect((await pending).map((d) => d.uid)).toEqual(['moved-1']);
    });

    it('fails when the batch is rejected and every per-document retry is too', async () => {
      const pending = firstValueFrom(service.moveDocuments(['doc-1', 'doc-2'], 'target-1'));
      httpMock
        .expectOne('/nuxeo/api/v1/automation/Document.Move')
        .flush('batch failed', { status: 500, statusText: 'Server Error' });
      for (const single of httpMock.match('/nuxeo/api/v1/automation/Document.Move')) {
        single.flush('nope', { status: 403, statusText: 'Forbidden' });
      }
      await expect(pending).rejects.toThrow('All clipboard documents failed');
    });
  });

  describe('trash', () => {
    it('queries only trashed children of the parent, newest first', async () => {
      const pending = firstValueFrom(service.getTrashedChildren('parent-1', 10));
      const req = httpMock.expectOne((r) => r.url === NXQL_URL);
      const query = req.request.params.get('query') ?? '';
      expect(query).toContain("ecm:parentId = 'parent-1'");
      expect(query).toContain('ecm:isTrashed = 1');
      expect(query).toContain('ORDER BY dc:modified DESC');
      expect(req.request.params.get('pageSize')).toBe('10');
      req.flush({ entries: [doc({ uid: 'trashed-1' })] });
      expect((await pending).entries?.map((d) => d.uid)).toEqual(['trashed-1']);
    });

    it('restores through the Document.Untrash operation on the document id', async () => {
      const pending = firstValueFrom(service.restoreDocument('doc-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.Untrash');
      expect(req.request.method).toBe('POST');
      req.flush(doc({ uid: 'doc-1' }));
      expect((await pending).uid).toBe('doc-1');
    });

    it('propagates a restore failure', async () => {
      const pending = firstValueFrom(service.restoreDocument('doc-1'));
      httpMock
        .expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.Untrash')
        .flush('nope', { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('startCsvExport', () => {
    it('takes the execution id from the Location header', async () => {
      const pending = firstValueFrom(service.startCsvExport('parent-1'));
      const req = httpMock.expectOne(CSV_ASYNC_URL);
      expect(req.request.body.params.action).toBe('csvExport');
      expect(req.request.body.params.query).toContain("ecm:parentId = 'parent-1'");
      req.flush('', {
        status: 202,
        statusText: 'Accepted',
        headers: {
          Location:
            '/nuxeo/api/v1/automation/Bulk.RunAction/@async/1a2b3c4d-1111-2222-3333-444455556666/status',
        },
      });
      expect(await pending).toBe('1a2b3c4d-1111-2222-3333-444455556666');
    });

    it('falls back to the response body when no Location header was sent', async () => {
      const pending = firstValueFrom(service.startCsvExport('parent-1'));
      httpMock
        .expectOne(CSV_ASYNC_URL)
        .flush('{"commandId":"aaaabbbb-1111-2222-3333-444455556666"}', {
          status: 202,
          statusText: 'Accepted',
        });
      expect(await pending).toBe('aaaabbbb-1111-2222-3333-444455556666');
    });

    it('fails loudly when neither the header nor the body carries an execution id', async () => {
      const pending = firstValueFrom(service.startCsvExport('parent-1'));
      httpMock.expectOne(CSV_ASYNC_URL).flush('accepted', { status: 202, statusText: 'Accepted' });
      await expect(pending).rejects.toThrow('Could not extract execution ID from response');
    });

    it('propagates a rejected export request', async () => {
      const pending = firstValueFrom(service.startCsvExport('parent-1'));
      httpMock.expectOne(CSV_ASYNC_URL).flush('nope', { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toMatchObject({ status: 403 });
    });
  });
});
