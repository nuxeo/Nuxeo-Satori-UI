import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import type { NuxeoDocument } from '../models/document.model';
import { BrowseService } from './browse.service';

describe('BrowseService', () => {
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

  it('getTreeChildren calls tree_children page provider with parent uid', async () => {
    const parentUid = '00000000-0000-0000-0000-000000000001';
    const result$ = firstValueFrom(service.getTreeChildren(parentUid));

    const req = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/pp/tree_children/execute' &&
        r.params.get('queryParams') === parentUid &&
        r.params.get('pageSize') === '50' &&
        r.params.get('currentPageIndex') === '0',
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('properties')).toBe('*');
    req.flush({
      entries: [
        { uid: 'domain-1', title: 'Domain', type: 'Domain', path: '/domain', properties: {} },
      ],
      totalSize: 1,
      currentPageSize: 1,
      currentPageIndex: 0,
      numberOfPages: 1,
      isNextPageAvailable: false,
    });

    const result = await result$;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].uid).toBe('domain-1');
  });

  it('getTreeChildren fetches additional pages when isNextPageAvailable is true', async () => {
    const parentUid = 'root-uid';
    const result$ = firstValueFrom(service.getTreeChildren(parentUid, 2));

    const page0 = httpMock.expectOne(
      (r) => r.url.includes('/tree_children/execute') && r.params.get('currentPageIndex') === '0',
    );
    page0.flush({
      entries: [
        { uid: 'd1', title: 'Domain', type: 'Domain', path: '/domain', properties: {} },
        { uid: 'd2', title: 'Domain-1', type: 'Domain', path: '/domain-1', properties: {} },
      ],
      totalSize: 3,
      currentPageSize: 2,
      currentPageIndex: 0,
      numberOfPages: 2,
      isNextPageAvailable: true,
    });

    const page1 = httpMock.expectOne(
      (r) => r.url.includes('/tree_children/execute') && r.params.get('currentPageIndex') === '1',
    );
    page1.flush({
      entries: [
        { uid: 'd3', title: 'Domain-2', type: 'Domain', path: '/domain-2', properties: {} },
      ],
      totalSize: 3,
      currentPageSize: 1,
      currentPageIndex: 1,
      numberOfPages: 2,
      isNextPageAvailable: false,
    });

    const result = await result$;
    expect(result.entries.map((e) => e.uid)).toEqual(['d1', 'd2', 'd3']);
    expect(result.totalSize).toBe(3);
  });

  it('getRepositoryRoot returns the root document when path access succeeds', async () => {
    const result$ = firstValueFrom(service.getRepositoryRoot());

    const req = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/path/' && r.method === 'GET');
    req.flush({
      uid: 'root-uid',
      title: 'Root',
      type: 'Root',
      path: '/',
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    });

    const result = await result$;
    expect(result.uid).toBe('root-uid');
    expect(result.type).toBe('Root');
  });

  it('getRepositoryRoot resolves root uid from accessible domains when path access is denied', async () => {
    const result$ = firstValueFrom(service.getRepositoryRoot());

    const rootReq = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/path/');
    rootReq.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

    const nxqlReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/lang/NXQL/execute' &&
        r.params.get('query')?.includes('FROM Domain') === true,
    );
    expect(nxqlReq.request.params.get('pageSize')).toBe('50');
    nxqlReq.flush({
      entries: [
        {
          uid: 'domain-5-uid',
          title: 'Domain-5',
          type: 'Domain',
          path: '/domain-5',
          parentRef: '00000000-0000-0000-0000-000000000000',
          lastModified: '2026-01-01T00:00:00.000Z',
          properties: {},
        },
      ],
      totalSize: 1,
      currentPageSize: 1,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const result = await result$;
    expect(result.uid).toBe('00000000-0000-0000-0000-000000000000');
    expect(result.type).toBe('Root');
    expect(result.path).toBe('/');
  });

  it('getRepositoryRoot skips nested domain NXQL hits for isolated users (NXSAT-164)', async () => {
    const result$ = firstValueFrom(service.getRepositoryRoot());

    const rootReq = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/path/');
    rootReq.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

    const nxqlReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/lang/NXQL/execute' &&
        r.params.get('query')?.includes('FROM Domain') === true,
    );
    nxqlReq.flush({
      entries: [
        {
          uid: 'demo-folder-uid',
          title: 'Demo Folder',
          type: 'Domain',
          path: '/default-domain/Demo Folder',
          parentRef: 'default-domain-uid',
          lastModified: '2026-01-01T00:00:00.000Z',
          properties: {},
        },
        {
          uid: 'default-domain-uid',
          title: 'Domain',
          type: 'Domain',
          path: '/default-domain',
          parentRef: '00000000-0000-0000-0000-000000000000',
          lastModified: '2026-01-01T00:00:00.000Z',
          properties: {},
        },
        {
          uid: 'domain-5-uid',
          title: 'Domain-5',
          type: 'Domain',
          path: '/domain-5',
          parentRef: '00000000-0000-0000-0000-000000000000',
          lastModified: '2026-01-01T00:00:00.000Z',
          properties: {},
        },
      ],
      totalSize: 3,
      currentPageSize: 3,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const result = await result$;
    expect(result.uid).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('getNavTreeBootstrap lists every accessible domain for isolated users (NXSAT-164)', async () => {
    const result$ = firstValueFrom(service.getNavTreeBootstrap());

    const rootReq = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/path/');
    rootReq.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

    const nxqlReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/lang/NXQL/execute' &&
        r.params.get('query')?.includes('FROM Domain') === true,
    );
    nxqlReq.flush({
      entries: [
        {
          uid: 'demo-folder-uid',
          title: 'Demo Folder',
          type: 'Domain',
          path: '/default-domain/Demo Folder',
          parentRef: 'default-domain-uid',
          lastModified: '2026-01-01T00:00:00.000Z',
          properties: {},
        },
        {
          uid: 'default-domain-uid',
          title: 'Domain',
          type: 'Domain',
          path: '/default-domain',
          parentRef: '00000000-0000-0000-0000-000000000000',
          lastModified: '2026-01-01T00:00:00.000Z',
          properties: {},
        },
        {
          uid: 'domain-5-uid',
          title: 'Domain-5',
          type: 'Domain',
          path: '/domain-5',
          parentRef: '00000000-0000-0000-0000-000000000000',
          lastModified: '2026-01-01T00:00:00.000Z',
          properties: {},
        },
      ],
      totalSize: 3,
      currentPageSize: 3,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const treeReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/pp/tree_children/execute' &&
        r.params.get('queryParams') === '00000000-0000-0000-0000-000000000000',
    );
    treeReq.flush({
      entries: [
        {
          uid: 'default-domain-uid',
          title: 'Domain',
          type: 'Domain',
          path: '/default-domain',
          facets: ['Folderish'],
          properties: {},
        },
        {
          uid: 'domain-5-uid',
          title: 'Domain-5',
          type: 'Domain',
          path: '/domain-5',
          facets: ['Folderish'],
          properties: {},
        },
      ],
      totalSize: 2,
      currentPageSize: 2,
      currentPageIndex: 0,
      numberOfPages: 1,
      isNextPageAvailable: false,
    });

    const result = await result$;
    expect(result.root.uid).toBe('00000000-0000-0000-0000-000000000000');
    expect(result.entries.map((e) => e.title)).toEqual(['Domain', 'Domain-5']);
  });

  it('getNavTreeBootstrap resolves non-null repository root uid (local Docker)', async () => {
    const localRootUid = '4a56c793-d0ae-4ace-bef4-f909e6b9eb59';
    const result$ = firstValueFrom(service.getNavTreeBootstrap());

    const rootReq = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/path/');
    rootReq.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

    const nxqlReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/lang/NXQL/execute' &&
        r.params.get('query')?.includes('FROM Domain') === true,
    );
    nxqlReq.flush({
      entries: [
        {
          uid: 'default-domain-uid',
          title: 'Domain',
          type: 'Domain',
          path: '/default-domain',
          parentRef: localRootUid,
          lastModified: '2026-01-01T00:00:00.000Z',
          properties: {},
        },
        {
          uid: 'domain-5-uid',
          title: 'Domain-5',
          type: 'Domain',
          path: '/domain-5',
          parentRef: localRootUid,
          lastModified: '2026-01-01T00:00:00.000Z',
          properties: {},
        },
      ],
      totalSize: 2,
      currentPageSize: 2,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const treeReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/pp/tree_children/execute' &&
        r.params.get('queryParams') === localRootUid,
    );
    treeReq.flush({
      entries: [
        {
          uid: 'default-domain-uid',
          title: 'Domain',
          type: 'Domain',
          path: '/default-domain',
          facets: ['Folderish'],
          properties: {},
        },
        {
          uid: 'domain-5-uid',
          title: 'Domain-5',
          type: 'Domain',
          path: '/domain-5',
          facets: ['Folderish'],
          properties: {},
        },
      ],
      totalSize: 2,
      currentPageSize: 2,
      currentPageIndex: 0,
      numberOfPages: 1,
      isNextPageAvailable: false,
    });

    const result = await result$;
    expect(result.root.uid).toBe(localRootUid);
    expect(result.entries.map((e) => e.title)).toEqual(['Domain', 'Domain-5']);
  });

  it('getBrowseFolderContents redirects workspace-only users from repository root', async () => {
    const result$ = firstValueFrom(service.getBrowseFolderContents('/'));

    const rootReq = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/path/');
    rootReq.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

    const bootstrapRootReq = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/path/');
    bootstrapRootReq.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

    const domainNxqlReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/lang/NXQL/execute' &&
        r.params.get('query')?.includes('FROM Domain') === true,
    );
    domainNxqlReq.flush({
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 0,
    });

    const treeReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/pp/tree_children/execute' &&
        r.params.get('queryParams') === 'virtual-root',
    );
    treeReq.flush({
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 1,
      isNextPageAvailable: false,
    });

    const navNodesReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/lang/NXQL/execute' &&
        r.params.get('query')?.includes("ecm:primaryType IN ('Domain', 'Workspace'") === true,
    );
    navNodesReq.flush({
      entries: [
        {
          uid: 'ws-uid',
          title: 'user readonly',
          type: 'Workspace',
          path: '/default-domain/UserWorkspaces/user-readonly01',
          parentRef: 'userworkspaces-root',
          lastModified: '2026-01-01T00:00:00.000Z',
          properties: {},
        },
      ],
      totalSize: 1,
      currentPageSize: 1,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const result = await result$;
    expect(result.redirectTo).toBe('/default-domain/UserWorkspaces/user-readonly01');
    expect(result.entries).toHaveLength(1);
  });

  describe('getFolderIdsWithSubfolders', () => {
    it('asks once for every folder, with the tree provider filter, and returns their parents', async () => {
      const result$ = firstValueFrom(service.getFolderIdsWithSubfolders(['a', "o'b"]));
      const req = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/search/lang/NXQL/execute');
      const query = req.request.params.get('query') ?? '';
      // The id is escaped: an apostrophe in a uid must not end the literal.
      expect(query).toContain("ecm:parentId IN ('a', 'o\\'b')");
      expect(query).toContain("ecm:mixinType = 'Folderish'");
      expect(query).toContain("ecm:mixinType != 'HiddenInNavigation'");
      expect(query).toContain('ecm:isTrashed = 0');
      req.flush({ entries: [{ uid: 'x', parentRef: 'a' }], isNextPageAvailable: false });

      expect([...((await result$) ?? [])]).toEqual(['a']);
    });

    it('answers unknown rather than "none" when there are more matches than one page', async () => {
      const result$ = firstValueFrom(service.getFolderIdsWithSubfolders(['a', 'b']));
      httpMock
        .expectOne((r) => r.url === '/nuxeo/api/v1/search/lang/NXQL/execute')
        .flush({ entries: [{ uid: 'x', parentRef: 'a' }], isNextPageAvailable: true });

      expect(await result$).toBeNull();
    });

    it('makes no request for an empty level', async () => {
      expect((await firstValueFrom(service.getFolderIdsWithSubfolders([])))?.size).toBe(0);
      httpMock.expectNone(() => true);
    });

    it('propagates a failed probe', async () => {
      const result$ = firstValueFrom(service.getFolderIdsWithSubfolders(['a']));
      httpMock
        .expectOne((r) => r.url === '/nuxeo/api/v1/search/lang/NXQL/execute')
        .flush({}, { status: 500, statusText: 'Server Error' });
      await expect(result$).rejects.toBeDefined();
    });
  });

  describe('a domain listing, which keeps only folders', () => {
    const domain = {
      uid: 'dom-uid',
      title: 'Domain',
      type: 'Domain',
      path: '/default-domain',
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    };
    const child = (uid: string, type: string, facets: string[] = []) => ({
      uid,
      title: uid,
      type,
      path: `/default-domain/${uid}`,
      facets,
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    });
    const threeFoldersTwoFiles = [
      child('sections', 'SectionRoot', ['Folderish']),
      child('templates', 'TemplateRoot', ['Folderish']),
      child('workspaces', 'WorkspaceRoot', ['Folderish']),
      child('tour.pdf', 'File'),
      child('csx.pdf', 'File'),
    ];

    function flushDomain(children: Record<string, unknown>) {
      httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/path/default-domain').flush(domain);
      httpMock
        .expectOne((r) => r.url === '/nuxeo/api/v1/path/default-domain/@children')
        .flush({
          entries: threeFoldersTwoFiles,
          totalSize: 5,
          resultsCount: 5,
          currentPageSize: 5,
          currentPageIndex: 0,
          numberOfPages: 1,
          ...children,
        });
    }

    it('counts the folders it shows, not every child Nuxeo counted', async () => {
      // Nuxeo counted five children; three are folders. Passing its 5 through beside three rows
      // is what showed "1–3 of 5" in the adf-hx pager.
      const result$ = firstValueFrom(service.getBrowseFolderContents('/default-domain'));
      flushDomain({ isNextPageAvailable: false });

      const result = await result$;
      expect(result.entries.map((e) => e.uid)).toEqual(['sections', 'templates', 'workspaces']);
      expect(result.totalSize).toBe(3);
    });

    it('reports the total as unknown when Nuxeo has more pages to filter', async () => {
      const result$ = firstValueFrom(service.getBrowseFolderContents('/default-domain'));
      flushDomain({ isNextPageAvailable: true });

      const result = await result$;
      expect(result.entries).toHaveLength(3);
      expect(result.totalSize).toBeLessThan(0);
      expect(result.hasNextPage).toBe(true);
    });

    it('keeps a count Nuxeo declined to compute unknown, even without a next page', async () => {
      const result$ = firstValueFrom(service.getBrowseFolderContents('/default-domain'));
      flushDomain({ isNextPageAvailable: false, resultsCount: -2 });

      const result = await result$;
      expect(result.entries).toHaveLength(3);
      expect(result.totalSize).toBeLessThan(0);
    });

    it('keeps the total unknown when Nuxeo reports neither the next-page flag nor a count', async () => {
      const result$ = firstValueFrom(service.getBrowseFolderContents('/default-domain'));
      flushDomain({ totalSize: undefined, resultsCount: undefined });

      const result = await result$;
      expect(result.entries).toHaveLength(3);
      expect(result.totalSize).toBeLessThan(0);
    });
  });

  it('getBrowseFolderContents loads Favorites members via default_content_collection', async () => {
    const result$ = firstValueFrom(
      service.getBrowseFolderContents('/default-domain/UserWorkspaces/user-readonly01/Favorites'),
    );

    const folderReq = httpMock.expectOne(
      (r) => r.url === '/nuxeo/api/v1/path/default-domain/UserWorkspaces/user-readonly01/Favorites',
    );
    folderReq.flush({
      uid: 'fav-uid',
      title: 'My Favorites',
      type: 'Favorites',
      path: '/default-domain/UserWorkspaces/user-readonly01/Favorites',
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    });

    const membersReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/pp/default_content_collection/execute' &&
        r.params.get('queryParams') === 'fav-uid' &&
        r.params.get('pageSize') === '50',
    );
    membersReq.flush({
      entries: [
        {
          uid: 'doc-uid',
          title: 'Sample doc',
          type: 'File',
          path: '/default-domain/workspaces/demo/sample',
          properties: {},
        },
      ],
      totalSize: 1,
      currentPageSize: 1,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const result = await result$;
    expect(result.folder.title).toBe('My Favorites');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].title).toBe('Sample doc');
  });

  it('getBrowseFolderContents loads workspace children via @children', async () => {
    const result$ = firstValueFrom(
      service.getBrowseFolderContents('/default-domain/UserWorkspaces/user-readonly01'),
    );

    const folderReq = httpMock.expectOne(
      (r) => r.url === '/nuxeo/api/v1/path/default-domain/UserWorkspaces/user-readonly01',
    );
    folderReq.flush({
      uid: 'ws-uid',
      title: 'user readonly',
      type: 'Workspace',
      path: '/default-domain/UserWorkspaces/user-readonly01',
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    });

    const childrenReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/path/default-domain/UserWorkspaces/user-readonly01/@children' &&
        r.params.get('pageSize') === '50',
    );
    childrenReq.flush({
      entries: [
        {
          uid: 'fav-uid',
          title: 'My Favorites',
          type: 'Favorites',
          path: '/default-domain/UserWorkspaces/user-readonly01/Favorites',
          properties: {},
        },
      ],
      totalSize: 1,
      currentPageSize: 1,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const result = await result$;
    expect(result.folder.title).toBe('user readonly');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].title).toBe('My Favorites');
  });

  it.each([403, 404, 500])(
    'getBrowseFolderContents keeps Nuxeo’s %i when a folder below the root fails to load',
    async (status) => {
      const result$ = firstValueFrom(service.getBrowseFolderContents('/default-domain/private'));

      httpMock
        .expectOne((r) => r.url === '/nuxeo/api/v1/path/default-domain/private')
        .flush('refused', { status, statusText: 'refused' });

      await expect(result$).rejects.toMatchObject({ status });
      httpMock.expectNone((r) => r.url.includes('@children'));
    },
  );

  it('getBrowseFolderContents keeps the status when the folder loads but its children fail', async () => {
    const result$ = firstValueFrom(
      service.getBrowseFolderContents('/default-domain/workspaces/ws'),
    );

    httpMock
      .expectOne((r) => r.url === '/nuxeo/api/v1/path/default-domain/workspaces/ws')
      .flush({
        uid: 'ws-uid',
        title: 'ws',
        type: 'Workspace',
        path: '/default-domain/workspaces/ws',
        properties: {},
      });
    httpMock
      .expectOne((r) => r.url === '/nuxeo/api/v1/path/default-domain/workspaces/ws/@children')
      .flush('refused', { status: 403, statusText: 'Forbidden' });

    await expect(result$).rejects.toMatchObject({ status: 403 });
  });

  it('getNavTreeChildren loads user workspace children via @children (Favorites + Collections)', async () => {
    const workspace: NuxeoDocument = {
      uid: 'ws-uid',
      title: 'user readonly',
      type: 'Workspace',
      path: '/default-domain/UserWorkspaces/user-readonly01',
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    };
    const result$ = firstValueFrom(service.getNavTreeChildren(workspace));

    const childrenReq = httpMock.expectOne(
      (r) => r.url === '/nuxeo/api/v1/path/default-domain/UserWorkspaces/user-readonly01/@children',
    );
    childrenReq.flush({
      entries: [
        {
          uid: 'fav-uid',
          title: 'My Favorites',
          type: 'Favorites',
          path: '/default-domain/UserWorkspaces/user-readonly01/Favorites',
          properties: {},
        },
        {
          uid: 'cols-uid',
          title: 'Collections',
          type: 'Collections',
          path: '/default-domain/UserWorkspaces/user-readonly01/Collections',
          properties: {},
        },
      ],
      totalSize: 2,
      currentPageSize: 2,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const result = await result$;
    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.type)).toEqual(['Favorites', 'Collections']);
    httpMock.expectNone((r) => r.url === '/nuxeo/api/v1/search/pp/tree_children/execute');
  });

  it('getNavTreeChildren falls back to @children when tree_children is empty for non-user workspaces', async () => {
    const workspace: NuxeoDocument = {
      uid: 'ws-uid',
      title: 'Demo Workspace',
      type: 'Workspace',
      path: '/default-domain/workspaces/demo',
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    };
    const result$ = firstValueFrom(service.getNavTreeChildren(workspace));

    const treeReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/pp/tree_children/execute' &&
        r.params.get('queryParams') === 'ws-uid',
    );
    treeReq.flush({
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 1,
      isNextPageAvailable: false,
    });

    const childrenReq = httpMock.expectOne(
      (r) => r.url === '/nuxeo/api/v1/path/default-domain/workspaces/demo/@children',
    );
    childrenReq.flush({
      entries: [
        {
          uid: 'folder-uid',
          title: 'Folder',
          type: 'Folder',
          path: '/default-domain/workspaces/demo/folder',
          properties: {},
        },
      ],
      totalSize: 1,
      currentPageSize: 1,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const result = await result$;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].title).toBe('Folder');
  });

  it('getNavTreeBootstrap falls back to accessible workspaces when root and domains are unavailable', async () => {
    const result$ = firstValueFrom(service.getNavTreeBootstrap());

    const rootReq = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/path/');
    rootReq.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

    const domainNxqlReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/lang/NXQL/execute' &&
        r.params.get('query')?.includes('FROM Domain') === true,
    );
    domainNxqlReq.flush({
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 0,
    });

    const treeReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/pp/tree_children/execute' &&
        r.params.get('queryParams') === 'virtual-root',
    );
    treeReq.flush({
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 1,
      isNextPageAvailable: false,
    });

    const navNodesReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/lang/NXQL/execute' &&
        r.params.get('query')?.includes("ecm:primaryType IN ('Domain', 'Workspace'") === true,
    );
    navNodesReq.flush({
      entries: [
        {
          uid: 'ws-uid',
          title: 'user readonly',
          type: 'Workspace',
          path: '/default-domain/UserWorkspaces/user-readonly01',
          parentRef: 'userworkspaces-root',
          lastModified: '2026-01-01T00:00:00.000Z',
          properties: {},
        },
      ],
      totalSize: 1,
      currentPageSize: 1,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const result = await result$;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].title).toBe('user readonly');
    expect(result.entries[0].type).toBe('Workspace');
  });

  it('getNavTreeChildren uses tree_children for Root parents', async () => {
    const root: NuxeoDocument = {
      uid: '00000000-0000-0000-0000-000000000000',
      title: 'Root',
      type: 'Root',
      path: '/',
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    };
    const result$ = firstValueFrom(service.getNavTreeChildren(root));

    const req = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/pp/tree_children/execute' &&
        r.params.get('queryParams') === root.uid,
    );
    req.flush({
      entries: [
        { uid: 'd1', title: 'Domain', type: 'Domain', path: '/domain', properties: {} },
        { uid: 'd2', title: 'Domain-2', type: 'Domain', path: '/domain-2', properties: {} },
      ],
      totalSize: 2,
      currentPageSize: 2,
      currentPageIndex: 0,
      numberOfPages: 1,
      isNextPageAvailable: false,
    });

    const result = await result$;
    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((e) => e.uid)).toEqual(['d1', 'd2']);
  });

  it('getNavTreeChildren uses @children for Domain parents', async () => {
    const domain: NuxeoDocument = {
      uid: 'domain-uid',
      title: 'Domain-1',
      type: 'Domain',
      path: '/domain-1',
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    };
    const result$ = firstValueFrom(service.getNavTreeChildren(domain));

    const req = httpMock.expectOne(
      (r) => r.url === '/nuxeo/api/v1/path/domain-1/@children' && r.params.get('pageSize') === '50',
    );
    expect(req.request.method).toBe('GET');
    req.flush({
      entries: [
        {
          uid: 'ws-root',
          title: 'Workspaces',
          type: 'WorkspaceRoot',
          path: '/domain-1/workspaces',
          properties: {},
        },
        { uid: 'file-1', title: 'Readme', type: 'File', path: '/domain-1/readme', properties: {} },
      ],
      totalSize: 2,
      currentPageSize: 2,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const result = await result$;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe('WorkspaceRoot');
  });

  it('getNavTreeChildren uses tree_children for workspace folders', async () => {
    const workspace: NuxeoDocument = {
      uid: 'ws-uid',
      title: 'Marketing',
      type: 'Workspace',
      path: '/domain-1/workspaces/marketing',
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    };
    const result$ = firstValueFrom(service.getNavTreeChildren(workspace));

    const req = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/pp/tree_children/execute' &&
        r.params.get('queryParams') === 'ws-uid',
    );
    req.flush({
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 1,
      isNextPageAvailable: false,
    });

    const childrenReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/path/domain-1/workspaces/marketing/@children' &&
        r.params.get('pageSize') === '50',
    );
    childrenReq.flush({
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    const result = await result$;
    expect(result.entries).toHaveLength(0);
  });

  it('getUserWorkspace calls User.GetUserWorkspace automation', async () => {
    const result$ = firstValueFrom(service.getUserWorkspace());

    const req = httpMock.expectOne(
      (r) => r.url === '/nuxeo/api/v1/automation/User.GetUserWorkspace',
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ params: {}, context: {} });
    req.flush({
      uid: 'ws-uid',
      title: 'Administrator',
      type: 'Workspace',
      path: '/default-domain/UserWorkspaces/Administrator',
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    } satisfies NuxeoDocument);

    const doc = await result$;
    expect(doc.path).toBe('/default-domain/UserWorkspaces/Administrator');
  });

  it('copyDocuments calls Document.Copy with docs input and target param', async () => {
    const result$ = firstValueFrom(service.copyDocuments(['doc-1', 'doc-2'], 'folder-uid'));

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Document.Copy');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      params: { target: 'folder-uid' },
      context: {},
      input: 'docs:doc-1,doc-2',
    });
    req.flush({
      entries: [
        { uid: 'copy-1', title: 'Copy 1', type: 'File', path: '/folder/copy-1', properties: {} },
      ],
      totalSize: 1,
    });

    const result = await result$;
    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('copy-1');
  });

  it('moveDocuments calls Document.Move with single doc input', async () => {
    const result$ = firstValueFrom(service.moveDocuments(['doc-1'], 'folder-uid'));

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Document.Move');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      params: { target: 'folder-uid' },
      context: {},
      input: 'doc:doc-1',
    });
    req.flush({
      uid: 'doc-1',
      title: 'Moved',
      type: 'File',
      path: '/folder/doc-1',
      properties: {},
    });

    const result = await result$;
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Moved');
  });

  it('updateDocument requests permissions enricher on PUT (NXSAT-196)', async () => {
    const uid = 'note-uid-1';
    const result$ = firstValueFrom(
      service.updateDocument(uid, { 'note:note': '<p>updated</p>' }, { enrichPermissions: true }),
    );

    const req = httpMock.expectOne((r) => r.url === `/nuxeo/api/v1/id/${uid}`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('enrichers.document')).toBe('permissions');
    expect(req.request.headers.get('properties')).toBe('*');
    req.flush({
      uid,
      title: 'Note',
      type: 'Note',
      path: '/a/note',
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: { 'note:note': '<p>updated</p>' },
      contextParameters: { permissions: ['Read', 'WriteProperties'] },
    } satisfies NuxeoDocument);

    const result = await result$;
    expect(result.contextParameters?.['permissions']).toEqual(['Read', 'WriteProperties']);
  });

  it('hasChildCollections returns true when NXQL finds a child collection', async () => {
    const parentUid = 'cols-folder-uid';
    const result$ = firstValueFrom(service.hasChildCollections(parentUid));

    const req = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/lang/NXQL/execute' &&
        r.params.get('pageSize') === '1' &&
        (r.params.get('query') ?? '').includes(`ecm:parentId = '${parentUid}'`) &&
        (r.params.get('query') ?? '').includes("ecm:primaryType = 'Collection'"),
    );
    expect(req.request.method).toBe('GET');
    req.flush({
      entries: [
        {
          uid: 'col-1',
          title: 'My Collection',
          type: 'Collection',
          path: '/collections/my-collection',
          properties: {},
        },
      ],
      totalSize: 1,
      currentPageSize: 1,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    expect(await result$).toBe(true);
  });

  it('hasChildCollections returns false when NXQL finds no child collections', async () => {
    const result$ = firstValueFrom(service.hasChildCollections('empty-folder'));

    const req = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/lang/NXQL/execute' &&
        r.params.get('pageSize') === '1' &&
        (r.params.get('query') ?? '').includes("ecm:parentId = 'empty-folder'"),
    );
    req.flush({
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 0,
    });

    expect(await result$).toBe(false);
  });
});
