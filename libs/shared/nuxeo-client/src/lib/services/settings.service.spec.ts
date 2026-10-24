import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { SettingsService } from './settings.service';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

describe('SettingsService', () => {
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

  it('returns only local ACL rows for the requested principal (Web UI parity)', async () => {
    const rows$ = firstValueFrom(service.getLocalPermissions('Administrator'));

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Repository.Query');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.params.query).toContain("ecm:acl/*1/name = 'local'");
    expect(req.request.body.params.query).toContain("ecm:acl/*1/principal = 'Administrator'");
    req.flush({
      entries: [
        {
          uid: 'doc-1',
          title: 'Workspace',
          path: '/default-domain/workspaces',
          contextParameters: {
            acls: [
              {
                name: 'local',
                aces: [
                  {
                    username: 'Administrator',
                    permission: 'Everything',
                    granted: true,
                    status: 'effective',
                    creator: 'Administrator',
                    begin: null,
                    end: null,
                  },
                ],
              },
              {
                name: 'inherited',
                aces: [
                  {
                    username: 'Administrator',
                    permission: 'Read',
                    granted: true,
                    status: 'effective',
                    creator: 'System',
                    begin: null,
                    end: null,
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    const rows = await rows$;
    expect(rows).toEqual([
      {
        documentTitle: 'Workspace',
        documentPath: '/default-domain/workspaces',
        right: 'Everything',
        timeFrame: 'Permanent',
        grantedBy: 'Administrator',
      },
    ]);
  });

  it('matches user: and group: ACE principal prefixes', async () => {
    const rows$ = firstValueFrom(service.getLocalPermissions('members'));

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Repository.Query');
    expect(req.request.body.params.query).toContain("ecm:acl/*1/principal = 'group:members'");
    req.flush({
      entries: [
        {
          uid: 'doc-2',
          title: 'Sections',
          path: '/default-domain/sections',
          contextParameters: {
            acls: [
              {
                name: 'local',
                aces: [
                  {
                    username: 'group:members',
                    permission: 'Read',
                    granted: true,
                    status: 'effective',
                    creator: null,
                    begin: null,
                    end: null,
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    const rows = await rows$;
    expect(rows).toEqual([
      {
        documentTitle: 'Sections',
        documentPath: '/default-domain/sections',
        right: 'Read',
        timeFrame: 'Permanent',
        grantedBy: '—',
      },
    ]);
  });

  it('falls back to document path when title is missing', async () => {
    const rows$ = firstValueFrom(service.getLocalPermissions('Administrator'));

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Repository.Query');
    req.flush({
      entries: [
        {
          uid: 'doc-3',
          path: '/default-domain/workspaces',
          contextParameters: {
            acls: [
              {
                name: 'local',
                aces: [
                  {
                    username: 'Administrator',
                    permission: 'Read',
                    granted: true,
                    status: 'effective',
                    creator: 'Administrator',
                    begin: null,
                    end: null,
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    const rows = await rows$;
    expect(rows[0]?.documentTitle).toBe('/default-domain/workspaces');
    expect(rows[0]?.documentPath).toBeNull();
  });
});
