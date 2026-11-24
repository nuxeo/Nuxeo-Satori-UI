import { provideHttpClient, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import type { NuxeoAce } from '../models/acl.model';
import type { PrincipalPermissionPage } from '../models/principal-permissions.model';
import { PrincipalPermissionsService } from './principal-permissions.service';

const NXQL_URL = '/nuxeo/api/v1/search/lang/NXQL/execute';

/** The four queries, in the order the service tries them. */
const strict = (p: string) =>
  `SELECT * FROM Document WHERE ecm:acl/*1/principal = '${p}' AND ecm:acl/*1/name = 'local'`;
const userPrefixed = (p: string) =>
  `SELECT * FROM Document WHERE ecm:acl/*1/principal = 'user:${p}' AND ecm:acl/*1/name = 'local'`;
const groupPrefixed = (p: string) =>
  `SELECT * FROM Document WHERE ecm:acl/*1/principal = 'group:${p}' AND ecm:acl/*1/name = 'local'`;
const loose = (p: string) => `SELECT * FROM Document WHERE ecm:acl/*/principal = '${p}'`;

const ace = (overrides: Partial<NuxeoAce>): NuxeoAce => ({
  id: `${overrides.username ?? 'jdoe'}:${overrides.permission ?? 'Read'}:true:admin::`,
  username: 'jdoe',
  externalUser: false,
  permission: 'Read',
  granted: true,
  creator: 'admin',
  begin: null,
  end: null,
  status: 'effective',
  ...overrides,
});

const fullDoc = (
  uid: string,
  acls: { name: string; aces: NuxeoAce[] }[],
  extra: Record<string, unknown> = {},
) => ({
  uid,
  title: `Title of ${uid}`,
  path: `/default-domain/workspaces/${uid}`,
  type: 'File',
  properties: {},
  contextParameters: { acls },
  ...extra,
});

const page = (uids: string[], meta: Record<string, number> = {}) => ({
  entries: uids.map((uid) => ({ uid })),
  totalSize: uids.length,
  numberOfPages: uids.length ? 1 : 0,
  currentPageIndex: 0,
  currentPageSize: uids.length,
  ...meta,
});

describe('PrincipalPermissionsService.listLocalPermissionRows', () => {
  let service: PrincipalPermissionsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    service = TestBed.inject(PrincipalPermissionsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const expectQuery = (query: string): TestRequest =>
    http.expectOne((r) => r.url === NXQL_URL && r.params.get('query') === query);
  const expectDocument = (uid: string): TestRequest => http.expectOne(`/nuxeo/api/v1/id/${uid}`);

  const list = (principal: string, pageSize = 20, pageIndex = 0) => {
    let result: PrincipalPermissionPage | undefined;
    service.listLocalPermissionRows(principal, pageSize, pageIndex).subscribe((r) => (result = r));
    return () => result;
  };

  it('finds the documents whose local ACL names the principal, a page at a time', () => {
    list('jdoe', 10, 2);

    const request = expectQuery(strict('jdoe'));
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('pageSize')).toBe('10');
    expect(request.request.params.get('currentPageIndex')).toBe('2');
    expect(request.request.headers.get('properties')).toBe('*');
    request.flush(page([]));
    expectQuery(userPrefixed('jdoe')).flush(page([]));
    expectQuery(groupPrefixed('jdoe')).flush(page([]));
    expectQuery(loose('jdoe')).flush(page([]));
  });

  it('lists one row per local entry the principal holds, read from each document’s ACLs', () => {
    const result = list('jdoe');

    expectQuery(strict('jdoe')).flush(page(['d1', 'd2'], { totalSize: 2 }));
    expectDocument('d1').flush(
      fullDoc('d1', [
        {
          name: 'local',
          aces: [
            ace({ permission: 'Read', begin: '2026-01-01T00:00:00Z', end: '2026-12-31T00:00:00Z' }),
            ace({ permission: 'Write', creator: 'asmith' }),
          ],
        },
      ]),
    );
    expectDocument('d2').flush(
      fullDoc('d2', [{ name: 'local', aces: [ace({ permission: 'Everything' })] }]),
    );

    expect(result()).toEqual({
      rows: [
        {
          documentUid: 'd1',
          documentTitle: 'Title of d1',
          documentPath: '/default-domain/workspaces/d1',
          permission: 'Read',
          begin: '2026-01-01T00:00:00Z',
          end: '2026-12-31T00:00:00Z',
          grantedBy: 'admin',
          acePrincipal: 'jdoe',
          aceId: 'jdoe:Read:true:admin::',
        },
        expect.objectContaining({ documentUid: 'd1', permission: 'Write', grantedBy: 'asmith' }),
        expect.objectContaining({ documentUid: 'd2', permission: 'Everything' }),
      ],
      totalDocuments: 2,
      numberOfPages: 1,
      currentPageIndex: 0,
      currentPageSize: 2,
    });
  });

  it('lists what was granted locally, current or pending, and leaves out what has expired', () => {
    const result = list('jdoe');

    expectQuery(strict('jdoe')).flush(page(['d1']));
    expectDocument('d1').flush(
      fullDoc('d1', [
        {
          name: 'local',
          aces: [
            ace({ permission: 'Read' }),
            ace({ permission: 'Write', granted: false }),
            ace({ permission: 'Remove', status: 'archived' }),
            ace({ permission: 'ReadWrite', status: 'pending' }),
            ace({ username: 'asmith', permission: 'Everything' }),
          ],
        },
        { name: 'inherited', aces: [ace({ permission: 'Everything' })] },
      ]),
    );

    expect(result()?.rows.map((r) => r.permission)).toEqual(['Read', 'ReadWrite']);
  });

  it('matches an entry stored with a user: or group: prefix to the bare name', () => {
    const result = list('editors');

    expectQuery(strict('editors')).flush(page(['d1']));
    expectDocument('d1').flush(
      fullDoc('d1', [
        {
          name: 'local',
          aces: [
            ace({ username: 'group:editors', permission: 'ReadWrite' }),
            ace({ username: 'user:editors', permission: 'Read' }),
            ace({ username: 'editors-old', permission: 'Everything' }),
          ],
        },
      ]),
    );

    expect(result()?.rows.map((r) => [r.acePrincipal, r.permission])).toEqual([
      ['group:editors', 'ReadWrite'],
      ['user:editors', 'Read'],
    ]);
  });

  it('titles a row by the document title, then its dc:title, then its id', () => {
    const result = list('jdoe');

    expectQuery(strict('jdoe')).flush(page(['d1', 'd2', 'd3']));
    const local = [{ name: 'local', aces: [ace({})] }];
    expectDocument('d1').flush(fullDoc('d1', local));
    expectDocument('d2').flush(
      fullDoc('d2', local, { title: '', properties: { 'dc:title': 'From dc:title' } }),
    );
    expectDocument('d3').flush(fullDoc('d3', local, { title: '' }));

    expect(result()?.rows.map((r) => r.documentTitle)).toEqual([
      'Title of d1',
      'From dc:title',
      'd3',
    ]);
  });

  it('counts a document whose local ACL has nothing for the principal, but lists no row for it', () => {
    const result = list('jdoe');

    expectQuery(strict('jdoe')).flush(page(['d1', 'd2']));
    expectDocument('d1').flush(fullDoc('d1', []));
    expectDocument('d2').flush(fullDoc('d2', [{ name: 'local', aces: [] }]));

    expect(result()).toEqual(expect.objectContaining({ rows: [], totalDocuments: 2 }));
  });

  describe('when a query finds nothing, it tries the next', () => {
    it('tries the principal with a user: prefix after the bare name', () => {
      const result = list('jdoe');

      expectQuery(strict('jdoe')).flush(page([]));
      expectQuery(userPrefixed('jdoe')).flush(page(['d1']));
      expectDocument('d1').flush(
        fullDoc('d1', [{ name: 'local', aces: [ace({ username: 'user:jdoe' })] }]),
      );

      expect(result()?.rows).toHaveLength(1);
    });

    it('then with a group: prefix', () => {
      const result = list('editors');

      expectQuery(strict('editors')).flush(page([]));
      expectQuery(userPrefixed('editors')).flush(page([]));
      expectQuery(groupPrefixed('editors')).flush(page(['d1']));
      expectDocument('d1').flush(
        fullDoc('d1', [{ name: 'local', aces: [ace({ username: 'group:editors' })] }]),
      );

      expect(result()?.rows.map((r) => r.acePrincipal)).toEqual(['group:editors']);
    });

    it('then across every ACL, not only the local one', () => {
      const result = list('jdoe');

      expectQuery(strict('jdoe')).flush(page([]));
      expectQuery(userPrefixed('jdoe')).flush(page([]));
      expectQuery(groupPrefixed('jdoe')).flush(page([]));
      expectQuery(loose('jdoe')).flush(page(['d1']));
      expectDocument('d1').flush(fullDoc('d1', [{ name: 'local', aces: [ace({})] }]));

      expect(result()?.totalDocuments).toBe(1);
    });

    it('stops at the first query that finds documents', () => {
      list('jdoe');

      expectQuery(strict('jdoe')).flush(page(['d1']));
      expectDocument('d1').flush(fullDoc('d1', []));

      http.expectNone((r) => r.params.get('query') === userPrefixed('jdoe'));
    });

    it('answers an empty page when all four find nothing', () => {
      const result = list('nobody');

      expectQuery(strict('nobody')).flush(page([]));
      expectQuery(userPrefixed('nobody')).flush(page([]));
      expectQuery(groupPrefixed('nobody')).flush(page([]));
      expectQuery(loose('nobody')).flush(page([]));

      expect(result()).toEqual({
        rows: [],
        totalDocuments: 0,
        numberOfPages: 0,
        currentPageIndex: 0,
        currentPageSize: 0,
      });
    });
  });

  describe('when a read fails', () => {
    it('treats a failed query as one that found nothing, and tries the next', () => {
      const result = list('jdoe');

      expectQuery(strict('jdoe')).flush('bad', { status: 400, statusText: 'Bad Request' });
      expectQuery(userPrefixed('jdoe')).flush(page(['d1']));
      expectDocument('d1').flush(fullDoc('d1', [{ name: 'local', aces: [ace({})] }]));

      expect(result()?.rows).toHaveLength(1);
    });

    it('answers an empty page, not an error, when every query fails', () => {
      let failed = false;
      let result: PrincipalPermissionPage | undefined;
      service
        .listLocalPermissionRows('jdoe', 20, 0)
        .subscribe({ next: (r) => (result = r), error: () => (failed = true) });

      for (const query of [strict, userPrefixed, groupPrefixed, loose]) {
        expectQuery(query('jdoe')).flush('down', { status: 503, statusText: 'Unavailable' });
      }

      expect(failed).toBe(false);
      expect(result?.rows).toEqual([]);
      expect(result?.totalDocuments).toBe(0);
    });
  });
});
