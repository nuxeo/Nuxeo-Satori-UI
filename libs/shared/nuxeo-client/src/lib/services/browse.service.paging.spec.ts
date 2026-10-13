import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import type { NuxeoDocument } from '../models/document.model';
import { BrowseService } from './browse.service';
import { CollectionService } from './collection.service';

function doc(uid: string, type: string, path: string, facets: string[] = []): NuxeoDocument {
  return { uid, title: uid, type, path, lastModified: '', properties: {}, facets } as NuxeoDocument;
}

function page(entries: NuxeoDocument[], extra: Record<string, unknown> = {}) {
  return {
    entries,
    totalSize: -2,
    resultsCount: -2,
    currentPageSize: entries.length,
    currentPageIndex: 0,
    numberOfPages: -1,
    ...extra,
  };
}

const SORT = [{ sortBy: 'dc:title', sortOrder: 'DESC' as const }];

/**
 * Paging for the four browse sources that used to take only a page size.
 *
 * `Root` and `Domain` went through `getNavTreeChildren`, and `Favorites` and `Collection` through
 * `getCollectionMembers`. Both dropped the page index and the sort, so a folder with more than one
 * page of entries showed its first page whatever page the caller asked for, in Nuxeo's order.
 */
describe('BrowseService paging — Root, Domain, Favorites and Collection', () => {
  let service: BrowseService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    service = TestBed.inject(BrowseService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushFolder(path: string, folder: NuxeoDocument): void {
    httpMock.expectOne((r) => r.url === `/nuxeo/api/v1/path${path}`).flush(folder);
  }

  function expectPaged(req: TestRequest, pageIndex: string, pageSize = '50'): void {
    expect(req.request.params.get('currentPageIndex')).toBe(pageIndex);
    expect(req.request.params.get('pageSize')).toBe(pageSize);
  }

  describe('Root', () => {
    const root = doc('root-uid', 'Root', '/');

    it('asks tree_children for the requested page, in the requested order, once', async () => {
      const result$ = firstValueFrom(
        service.getBrowseFolderContents('/', 2, { currentPageIndex: 1, sort: SORT }),
      );
      flushFolder('/', root);
      const req = httpMock.expectOne(
        (r) => r.url === '/nuxeo/api/v1/search/pp/tree_children/execute',
      );
      expectPaged(req, '1', '2');
      expect(req.request.params.get('queryParams')).toBe('root-uid');
      expect(req.request.params.get('sortBy')).toBe('dc:title');
      expect(req.request.params.get('sortOrder')).toBe('DESC');
      req.flush(page([doc('d3', 'Domain', '/d3')], { isNextPageAvailable: false }));

      const result = await result$;
      // One request, not the whole provider: the listing pages, the tree level does not.
      expect(result.entries.map((e) => e.uid)).toEqual(['d3']);
      expect(result.hasNextPage).toBe(false);
    });

    it('still lists every page for a tree level, which asks with no page', async () => {
      const result$ = firstValueFrom(service.getNavTreeChildren(root, 1));
      httpMock
        .expectOne((r) => r.params.get('currentPageIndex') === '0')
        .flush(page([doc('d1', 'Domain', '/d1')], { isNextPageAvailable: true }));
      httpMock
        .expectOne((r) => r.params.get('currentPageIndex') === '1')
        .flush(
          page([doc('d2', 'Domain', '/d2')], { currentPageIndex: 1, isNextPageAvailable: false }),
        );

      expect((await result$).entries.map((e) => e.uid)).toEqual(['d1', 'd2']);
    });

    it('defaults the listing to its first page when no page index is given', async () => {
      const result$ = firstValueFrom(service.getBrowseFolderContents('/', 50, {}));
      flushFolder('/', root);
      const req = httpMock.expectOne((r) => r.url.endsWith('/tree_children/execute'));
      expectPaged(req, '0');
      expect(req.request.params.has('sortBy')).toBe(false);
      req.flush(page([], { isNextPageAvailable: false }));
      await result$;
    });
  });

  describe('Domain', () => {
    const domain = doc('domain-uid', 'Domain', '/default-domain');

    it('asks @children for the requested page and order, and lists every child, as Web UI does', async () => {
      const result$ = firstValueFrom(
        service.getBrowseFolderContents('/default-domain', 2, { currentPageIndex: 3, sort: SORT }),
      );
      flushFolder('/default-domain', domain);
      const req = httpMock.expectOne(
        (r) => r.url === '/nuxeo/api/v1/path/default-domain/@children',
      );
      expectPaged(req, '3', '2');
      expect(req.request.params.get('sortBy')).toBe('dc:title');
      req.flush(
        page(
          [
            doc('ws', 'WorkspaceRoot', '/default-domain/workspaces', ['Folderish']),
            doc('pdf', 'File', '/default-domain/test.pdf'),
          ],
          { isNextPageAvailable: true },
        ),
      );

      const result = await result$;
      // Nothing dropped after the server paged: a page of files and folders is a full page.
      expect(result.entries.map((e) => e.uid)).toEqual(['ws', 'pdf']);
      expect(result.hasNextPage).toBe(true);
    });

    it('still gives the tree only a domain’s folders, from the first page', async () => {
      const result$ = firstValueFrom(
        service.getNavTreeChildren(domain, 50, { currentPageIndex: 3, sort: SORT }),
      );
      const req = httpMock.expectOne(
        (r) => r.url === '/nuxeo/api/v1/path/default-domain/@children',
      );
      expectPaged(req, '0');
      expect(req.request.params.has('sortBy')).toBe(false);
      req.flush(
        page([
          doc('ws', 'WorkspaceRoot', '/default-domain/workspaces', ['Folderish']),
          doc('pdf', 'File', '/default-domain/test.pdf'),
        ]),
      );
      expect((await result$).entries?.map((e) => e.uid)).toEqual(['ws']);
    });
  });

  describe.each(['Favorites', 'Collection'])('%s', (type) => {
    const path = `/default-domain/workspaces/ws/${type.toLowerCase()}`;
    const folder = doc(`${type}-uid`, type, path);

    it('asks default_content_collection for the requested page and order', async () => {
      const result$ = firstValueFrom(
        service.getBrowseFolderContents(path, 50, { currentPageIndex: 1, sort: SORT }),
      );
      flushFolder(path, folder);
      const req = httpMock.expectOne(
        (r) => r.url === '/nuxeo/api/v1/search/pp/default_content_collection/execute',
      );
      expect(req.request.params.get('queryParams')).toBe(`${type}-uid`);
      // Each row's own permissions, which its menu's rules read.
      expect(req.request.headers.get('enrichers.document')).toBe('permissions');
      expectPaged(req, '1');
      expect(req.request.params.get('sortBy')).toBe('dc:title');
      expect(req.request.params.get('sortOrder')).toBe('DESC');
      req.flush(
        page([doc('note-51', 'Note', '/n51')], {
          totalSize: 60,
          resultsCount: 60,
          currentPageIndex: 1,
          isNextPageAvailable: false,
        }),
      );

      const result = await result$;
      expect(result.entries.map((e) => e.uid)).toEqual(['note-51']);
      // This provider counts every member, so the real total reaches the pager on page two.
      expect(result.totalSize).toBe(60);
      expect(result.hasNextPage).toBe(false);
    });

    it('keeps the server error, so a refused sort is not shown as an empty page', async () => {
      const result$ = firstValueFrom(
        service.getBrowseFolderContents(path, 50, {
          sort: [{ sortBy: 'dc:nosuch', sortOrder: 'ASC' }],
        }),
      );
      flushFolder(path, folder);
      httpMock
        .expectOne((r) => r.url.endsWith('/default_content_collection/execute'))
        .flush({ status: 400 }, { status: 400, statusText: 'Bad Request' });

      await expect(result$).rejects.toMatchObject({ status: 400 });
    });
  });

  it('asks an ordinary folder for the page and order too, as before', async () => {
    const path = '/default-domain/workspaces/ws';
    const result$ = firstValueFrom(
      service.getBrowseFolderContents(path, 50, { currentPageIndex: 2, sort: SORT }),
    );
    flushFolder(path, doc('ws-uid', 'Workspace', path));
    const req = httpMock.expectOne((r) => r.url === `/nuxeo/api/v1/path${path}/@children`);
    expectPaged(req, '2');
    expect(req.request.params.get('sortBy')).toBe('dc:title');
    req.flush(page([]));
    await result$;
  });
});

describe('CollectionService.getCollectionMembers paging', () => {
  let service: CollectionService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    service = TestBed.inject(CollectionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('asks for the requested page, in the requested order', async () => {
    const result$ = firstValueFrom(
      service.getCollectionMembers('col-uid', 40, { currentPageIndex: 1, sort: SORT }),
    );
    const req = httpMock.expectOne((r) =>
      r.url.endsWith('/search/pp/default_content_collection/execute'),
    );
    expect(req.request.params.get('queryParams')).toBe('col-uid');
    expect(req.request.params.get('pageSize')).toBe('40');
    expect(req.request.params.get('currentPageIndex')).toBe('1');
    expect(req.request.params.get('sortBy')).toBe('dc:title');
    expect(req.request.params.get('sortOrder')).toBe('DESC');
    req.flush(page([], { totalSize: 60 }));
    expect((await result$).totalSize).toBe(60);
  });

  it('defaults to the first page, in the provider’s own order', async () => {
    const result$ = firstValueFrom(service.getCollectionMembers('col-uid'));
    const req = httpMock.expectOne((r) => r.url.endsWith('/default_content_collection/execute'));
    expect(req.request.params.get('currentPageIndex')).toBe('0');
    expect(req.request.params.get('pageSize')).toBe('50');
    expect(req.request.params.has('sortBy')).toBe(false);
    req.flush(page([]));
    await result$;
  });
});
