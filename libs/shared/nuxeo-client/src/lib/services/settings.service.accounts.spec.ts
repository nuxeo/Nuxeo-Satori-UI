import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { SettingsService } from './settings.service';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

const PROVIDERS_URL = '/nuxeo/api/v1/oauth2/provider/';
const PROVIDER_TOKENS_URL = '/nuxeo/api/v1/oauth2/token/provider';
const CLIENT_TOKENS_URL = '/nuxeo/api/v1/oauth2/token/client';
const DRIVE_ROOTS_URL = '/nuxeo/api/v1/automation/NuxeoDrive.GetRoots';
const DRIVE_SET_URL = '/nuxeo/api/v1/automation/NuxeoDrive.SetSynchronization';

describe('SettingsService accounts, drive roots and password', () => {
  let service: SettingsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [testTranslateModule()],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    service = TestBed.inject(SettingsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getConnectedAccounts', () => {
    it('joins each token to its provider and reports the login pair', async () => {
      const pending = firstValueFrom(service.getConnectedAccounts());

      httpMock.expectOne(PROVIDERS_URL).flush({
        entries: [{ serviceName: 'google', description: 'Google' }],
      });
      httpMock.expectOne(PROVIDER_TOKENS_URL).flush({
        entries: [
          {
            serviceName: 'google',
            nuxeoLogin: 'jdoe',
            serviceLogin: 'jane@gmail.com',
            creationDate: '2026-03-01T10:00:00Z',
            isShared: true,
          },
        ],
      });

      expect(await pending).toEqual([
        {
          serviceName: 'google',
          nuxeoLogin: 'jdoe',
          serviceLogin: 'jane@gmail.com',
          creationDate: '2026-03-01T10:00:00Z',
          shared: true,
        },
      ]);
    });

    it('still lists a token whose provider is no longer registered', async () => {
      const pending = firstValueFrom(service.getConnectedAccounts());
      httpMock.expectOne(PROVIDERS_URL).flush({ entries: [] });
      httpMock.expectOne(PROVIDER_TOKENS_URL).flush({
        entries: [
          {
            serviceName: 'retired-service',
            nuxeoLogin: 'jdoe',
            serviceLogin: 'jane@example.com',
            creationDate: '2026-03-01T10:00:00Z',
            isShared: false,
          },
        ],
      });

      const accounts = await pending;
      expect(accounts).toHaveLength(1);
      expect(accounts[0].serviceName).toBe('retired-service');
      expect(accounts[0].shared).toBe(false);
    });

    it('returns an empty list when the user has authorised nothing', async () => {
      const pending = firstValueFrom(service.getConnectedAccounts());
      httpMock.expectOne(PROVIDERS_URL).flush({ entries: [{ serviceName: 'google' }] });
      httpMock.expectOne(PROVIDER_TOKENS_URL).flush({ entries: [] });
      expect(await pending).toEqual([]);
    });

    it('fails when the provider list fails, rather than listing unresolved tokens', async () => {
      const pending = firstValueFrom(service.getConnectedAccounts());
      httpMock.expectOne(PROVIDER_TOKENS_URL).flush({ entries: [] });
      httpMock.expectOne(PROVIDERS_URL).flush('nope', { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toMatchObject({ status: 500 });
    });

    it('fails when the token list fails', async () => {
      const pending = firstValueFrom(service.getConnectedAccounts());
      httpMock.expectOne(PROVIDERS_URL).flush({ entries: [] });
      httpMock
        .expectOne(PROVIDER_TOKENS_URL)
        .flush('nope', { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('getAuthorizedApplications', () => {
    it('names each application by its client id', async () => {
      const pending = firstValueFrom(service.getAuthorizedApplications());
      httpMock.expectOne(CLIENT_TOKENS_URL).flush({
        entries: [
          {
            clientId: 'nuxeo-drive',
            serviceName: 'drive-service',
            creationDate: '2026-02-02T09:00:00Z',
          },
        ],
      });
      expect(await pending).toEqual([
        { name: 'nuxeo-drive', authorizationDate: '2026-02-02T09:00:00Z' },
      ]);
    });

    it('falls back to the service name when the token carries no client id', async () => {
      const pending = firstValueFrom(service.getAuthorizedApplications());
      httpMock.expectOne(CLIENT_TOKENS_URL).flush({
        entries: [{ serviceName: 'legacy-client', creationDate: '2026-02-02T09:00:00Z' }],
      });
      expect((await pending)[0].name).toBe('legacy-client');
    });

    it('propagates an authorisation failure', async () => {
      const pending = firstValueFrom(service.getAuthorizedApplications());
      httpMock
        .expectOne(CLIENT_TOKENS_URL)
        .flush('nope', { status: 401, statusText: 'Unauthorized' });
      await expect(pending).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('getSynchronizationRoots', () => {
    it('prefers uid over id and trims both', async () => {
      const pending = firstValueFrom(service.getSynchronizationRoots());
      const req = httpMock.expectOne(DRIVE_ROOTS_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ params: {}, context: {} });
      req.flush({
        entries: [
          { uid: '  uid-1  ', id: 'id-1', title: '  Workspaces ', path: ' /default-domain ' },
        ],
      });
      expect(await pending).toEqual([
        { id: 'uid-1', title: 'Workspaces', path: '/default-domain' },
      ]);
    });

    it('falls back to id when uid is blank', async () => {
      const pending = firstValueFrom(service.getSynchronizationRoots());
      httpMock
        .expectOne(DRIVE_ROOTS_URL)
        .flush({ entries: [{ uid: '   ', id: 'id-1', title: 'T', path: '/p' }] });
      expect((await pending)[0].id).toBe('id-1');
    });

    it('renders an em dash for a root with no title or path', async () => {
      const pending = firstValueFrom(service.getSynchronizationRoots());
      httpMock.expectOne(DRIVE_ROOTS_URL).flush({ entries: [{ uid: 'uid-1' }] });
      expect(await pending).toEqual([{ id: 'uid-1', title: '—', path: '—' }]);
    });

    it('returns an empty list when the response carries no entries key', async () => {
      const pending = firstValueFrom(service.getSynchronizationRoots());
      httpMock.expectOne(DRIVE_ROOTS_URL).flush({});
      expect(await pending).toEqual([]);
    });

    it('propagates the failure when Drive is not installed on the server', async () => {
      const pending = firstValueFrom(service.getSynchronizationRoots());
      httpMock
        .expectOne(DRIVE_ROOTS_URL)
        .flush('No such operation', { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('setSynchronizationRoot', () => {
    it('sends the root id as the operation input and the flag as a param', async () => {
      const pending = firstValueFrom(service.setSynchronizationRoot('uid-1', true));
      const req = httpMock.expectOne(DRIVE_SET_URL);
      expect(req.request.body).toEqual({
        params: { enable: true },
        context: {},
        input: 'uid-1',
      });
      req.flush({});
      await pending;
    });

    it('sends enable false when unsynchronising', async () => {
      const pending = firstValueFrom(service.setSynchronizationRoot('uid-1', false));
      const req = httpMock.expectOne(DRIVE_SET_URL);
      expect(req.request.body.params).toEqual({ enable: false });
      req.flush({});
      await pending;
    });

    it('propagates a permission failure', async () => {
      const pending = firstValueFrom(service.setSynchronizationRoot('uid-1', true));
      httpMock.expectOne(DRIVE_SET_URL).flush('nope', { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('changePassword', () => {
    it('puts both passwords to the me endpoint', async () => {
      const pending = firstValueFrom(service.changePassword('old-secret', 'new-secret'));
      const req = httpMock.expectOne('/nuxeo/api/v1/me/changepassword');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ oldPassword: 'old-secret', newPassword: 'new-secret' });
      req.flush(null);
      await pending;
    });

    it('propagates the rejection when the current password is wrong', async () => {
      const pending = firstValueFrom(service.changePassword('wrong', 'new-secret'));
      httpMock
        .expectOne('/nuxeo/api/v1/me/changepassword')
        .flush('Bad credentials', { status: 401, statusText: 'Unauthorized' });
      await expect(pending).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('getLocalPermissions', () => {
    it('escapes a single quote in the principal so the NXQL stays one predicate', async () => {
      const pending = firstValueFrom(service.getLocalPermissions("o'brien"));
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Repository.Query');
      const query: string = req.request.body.params.query;
      expect(query).toContain("ecm:acl/*1/principal = 'o''brien'");
      expect(query).not.toContain("'o'brien'");
      req.flush({ entries: [] });
      expect(await pending).toEqual([]);
    });

    it('requests the acls enricher and the caller page size', async () => {
      const pending = firstValueFrom(service.getLocalPermissions('jdoe', 5));
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Repository.Query');
      expect(req.request.body.params.pageSize).toBe(5);
      expect(req.request.headers.get('enrichers-document')).toBe('acls');
      req.flush({ entries: [] });
      await pending;
    });

    it('returns no rows when a matching document has no local ACL at all', async () => {
      const pending = firstValueFrom(service.getLocalPermissions('jdoe'));
      httpMock.expectOne('/nuxeo/api/v1/automation/Repository.Query').flush({
        entries: [
          {
            uid: 'doc-1',
            title: 'Report',
            path: '/default-domain/report',
            contextParameters: {
              acls: [
                {
                  name: 'inherited',
                  aces: [{ username: 'jdoe', permission: 'Read', granted: true }],
                },
              ],
            },
          },
        ],
      });
      expect(await pending).toEqual([]);
    });

    it('skips archived and denied ACEs', async () => {
      const pending = firstValueFrom(service.getLocalPermissions('jdoe'));
      httpMock.expectOne('/nuxeo/api/v1/automation/Repository.Query').flush({
        entries: [
          {
            uid: 'doc-1',
            title: 'Report',
            path: '/default-domain/report',
            contextParameters: {
              acls: [
                {
                  name: 'local',
                  aces: [
                    { username: 'jdoe', permission: 'Read', granted: true, status: 'archived' },
                    { username: 'jdoe', permission: 'Write', granted: false },
                    { username: 'jdoe', permission: 'Everything', granted: true },
                  ],
                },
              ],
            },
          },
        ],
      });
      const rows = await pending;
      expect(rows.map((row) => row.right)).toEqual(['Everything']);
    });

    it('reports an em dash when nobody is recorded as the grantor', async () => {
      const pending = firstValueFrom(service.getLocalPermissions('jdoe'));
      httpMock.expectOne('/nuxeo/api/v1/automation/Repository.Query').flush({
        entries: [
          {
            uid: 'doc-1',
            title: 'Report',
            path: '/default-domain/report',
            contextParameters: {
              acls: [
                {
                  name: 'local',
                  aces: [{ username: 'jdoe', permission: 'Read', granted: true, creator: '' }],
                },
              ],
            },
          },
        ],
      });
      expect((await pending)[0].grantedBy).toBe('—');
    });

    it('falls back to the uid when the document has neither title nor path', async () => {
      const pending = firstValueFrom(service.getLocalPermissions('jdoe'));
      httpMock.expectOne('/nuxeo/api/v1/automation/Repository.Query').flush({
        entries: [
          {
            uid: 'doc-1',
            contextParameters: {
              acls: [
                { name: 'local', aces: [{ username: 'jdoe', permission: 'Read', granted: true }] },
              ],
            },
          },
        ],
      });
      const rows = await pending;
      expect(rows[0].documentTitle).toBe('doc-1');
      expect(rows[0].documentPath).toBeNull();
    });

    it('aggregates rows across several documents', async () => {
      const pending = firstValueFrom(service.getLocalPermissions('jdoe'));
      httpMock.expectOne('/nuxeo/api/v1/automation/Repository.Query').flush({
        entries: [
          {
            uid: 'doc-1',
            title: 'A',
            path: '/a',
            contextParameters: {
              acls: [
                { name: 'local', aces: [{ username: 'jdoe', permission: 'Read', granted: true }] },
              ],
            },
          },
          {
            uid: 'doc-2',
            title: 'B',
            path: '/b',
            contextParameters: {
              acls: [
                {
                  name: 'local',
                  aces: [{ username: 'jdoe', permission: 'Write', granted: true }],
                },
              ],
            },
          },
        ],
      });
      const rows = await pending;
      expect(rows.map((row) => [row.documentTitle, row.right])).toEqual([
        ['A', 'Read'],
        ['B', 'Write'],
      ]);
    });

    it('returns an empty list when the query response carries no entries key', async () => {
      const pending = firstValueFrom(service.getLocalPermissions('jdoe'));
      httpMock.expectOne('/nuxeo/api/v1/automation/Repository.Query').flush({});
      expect(await pending).toEqual([]);
    });

    it('propagates a query failure', async () => {
      const pending = firstValueFrom(service.getLocalPermissions('jdoe'));
      httpMock
        .expectOne('/nuxeo/api/v1/automation/Repository.Query')
        .flush('nope', { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toMatchObject({ status: 500 });
    });
  });
});
