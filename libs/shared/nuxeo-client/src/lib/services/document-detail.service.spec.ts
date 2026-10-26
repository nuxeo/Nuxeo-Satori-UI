import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CURRENT_USERNAME } from '../current-user.token';
import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { DocumentDetailService } from './document-detail.service';

describe('DocumentDetailService permissions', () => {
  let service: DocumentDetailService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: CURRENT_USERNAME, useValue: () => 'satori-admin' },
      ],
    });

    service = TestBed.inject(DocumentDetailService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('addPermission sends creator from CURRENT_USERNAME', async () => {
    const doc$ = firstValueFrom(
      service.addPermission('doc-uid', {
        username: 'user-readonly01',
        permission: 'Read',
      }),
    );

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      params: {
        username: 'user-readonly01',
        permission: 'Read',
        begin: null,
        end: null,
        notify: false,
        comment: '',
        creator: 'satori-admin',
      },
      context: {},
      input: 'doc-uid',
    });
    req.flush({ uid: 'doc-uid' });

    await expect(doc$).resolves.toEqual({ uid: 'doc-uid' });
  });

  it('addPermission prefers explicit creator override', async () => {
    const doc$ = firstValueFrom(
      service.addPermission('doc-uid', {
        username: 'user-readonly01',
        permission: 'Read',
        creator: 'custom-grantor',
      }),
    );

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
    expect(req.request.body.params.creator).toBe('custom-grantor');
    req.flush({ uid: 'doc-uid' });

    await doc$;
  });

  it('addPermission omits creator when no user is available', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: CURRENT_USERNAME, useValue: () => null },
      ],
    });
    service = TestBed.inject(DocumentDetailService);
    httpMock = TestBed.inject(HttpTestingController);

    const doc$ = firstValueFrom(
      service.addPermission('doc-uid', {
        username: 'user-readonly01',
        permission: 'Read',
      }),
    );

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
    expect(req.request.body.params).not.toHaveProperty('creator');
    req.flush({ uid: 'doc-uid' });

    await doc$;
  });

  it('getDocumentPermissions normalizes enriched username and creator entities', async () => {
    const doc$ = firstValueFrom(service.getDocumentPermissions('root-uid'));

    const req = httpMock.expectOne('/nuxeo/api/v1/id/root-uid');
    expect(req.request.headers.get('fetch-acls')).toBe('username,creator,extended');
    req.flush({
      uid: 'root-uid',
      contextParameters: {
        acls: [
          {
            name: 'local',
            aces: [
              {
                id: 'ace-1',
                username: {
                  'entity-type': 'user',
                  id: 'Administrator',
                  properties: { username: 'Administrator' },
                },
                externalUser: false,
                permission: 'Everything',
                granted: true,
                creator: {
                  'entity-type': 'user',
                  id: 'Administrator',
                  properties: { username: 'Administrator' },
                },
                begin: null,
                end: null,
                status: 'effective',
              },
            ],
          },
        ],
      },
    });

    const doc = await doc$;
    const ace = doc.contextParameters?.['acls']?.[0]?.aces?.[0];
    expect(ace?.username).toBe('Administrator');
    expect(ace?.creator).toBe('Administrator');
  });

  it('addExternalPermission sends creator from CURRENT_USERNAME with notify disabled', async () => {
    const doc$ = firstValueFrom(
      service.addExternalPermission('doc-uid', {
        email: 'guest@example.com',
        permission: 'Read',
        end: '2026-12-31',
      }),
    );

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
    expect(req.request.body).toEqual({
      params: {
        email: 'guest@example.com',
        permission: 'Read',
        begin: null,
        end: '2026-12-31',
        notify: false,
        comment: '',
        creator: 'satori-admin',
      },
      context: {},
      input: 'doc-uid',
    });
    req.flush({ uid: 'doc-uid' });

    await doc$;
  });

  it('addExternalPermissionWithNotification creates ACE then sends notification separately', async () => {
    const result$ = firstValueFrom(
      service.addExternalPermissionWithNotification('doc-uid', {
        email: 'guest@example.com',
        permission: 'Read',
        notify: true,
        end: '2026-12-31',
        comment: 'Please review',
      }),
    );

    const addReq = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
    expect(addReq.request.body.params).toEqual({
      email: 'guest@example.com',
      permission: 'Read',
      begin: null,
      end: '2026-12-31',
      notify: false,
      comment: 'Please review',
      creator: 'satori-admin',
    });
    addReq.flush(docWithLocalAce('ace-ext', 'transient/guest@example.com'));

    const notifyReq = httpMock.expectOne(
      '/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission',
    );
    expect(notifyReq.request.body).toEqual({
      params: { id: 'ace-ext' },
      context: {},
      input: 'doc-uid',
    });
    notifyReq.flush({ uid: 'doc-uid' });

    await expect(result$).resolves.toEqual({
      document: { uid: 'doc-uid' },
      notificationSent: true,
    });
  });

  it('addExternalPermissionWithNotification persists ACE when notification lookup fails', async () => {
    const result$ = firstValueFrom(
      service.addExternalPermissionWithNotification('doc-uid', {
        email: 'guest@example.com',
        permission: 'Read',
        notify: true,
        end: '2026-12-31',
      }),
    );

    const addReq = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
    addReq.flush({ uid: 'doc-uid' });

    const permReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-uid');
    permReq.flush({ uid: 'doc-uid', contextParameters: { acls: [] } });

    await expect(result$).resolves.toEqual({
      document: { uid: 'doc-uid' },
      notificationSent: false,
      notificationErrorKey: 'permissions.notification.ace-not-found-add',
    });
  });

  it('addExternalPermissionWithNotification reports refetch failure without masking notify errors', async () => {
    const refetchFailure$ = firstValueFrom(
      service.addExternalPermissionWithNotification('doc-uid', {
        email: 'guest@example.com',
        permission: 'Read',
        notify: true,
        end: '2026-12-31',
      }),
    );

    httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission').flush({ uid: 'doc-uid' });
    httpMock
      .expectOne('/nuxeo/api/v1/id/doc-uid')
      .flush('', { status: 500, statusText: 'Server Error' });

    await expect(refetchFailure$).resolves.toEqual({
      document: { uid: 'doc-uid' },
      notificationSent: false,
      notificationErrorKey: 'permissions.notification.ace-not-found-add',
    });

    const notifyFailure$ = firstValueFrom(
      service.addExternalPermissionWithNotification('doc-uid', {
        email: 'guest@example.com',
        permission: 'Read',
        notify: true,
        end: '2026-12-31',
      }),
    );

    httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission').flush({ uid: 'doc-uid' });
    httpMock
      .expectOne('/nuxeo/api/v1/id/doc-uid')
      .flush(docWithLocalAce('ace-ext', 'transient/guest@example.com'));
    httpMock
      .expectOne('/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission')
      .flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

    await expect(notifyFailure$).rejects.toEqual(expect.objectContaining({ status: 403 }));
  });

  it('addPermissionWithNotification creates ACE then sends notification separately', async () => {
    const result$ = firstValueFrom(
      service.addPermissionWithNotification('doc-uid', {
        username: 'user-readonly01',
        permission: 'Read',
        notify: true,
        comment: 'Please review',
      }),
    );

    const addReq = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
    expect(addReq.request.body.params.notify).toBe(false);
    expect(addReq.request.body.params.comment).toBe('Please review');
    addReq.flush(docWithLocalAce('ace-42', 'user-readonly01'));

    const notifyReq = httpMock.expectOne(
      '/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission',
    );
    expect(notifyReq.request.body).toEqual({
      params: { id: 'ace-42' },
      context: {},
      input: 'doc-uid',
    });
    notifyReq.flush({ uid: 'doc-uid' });

    await expect(result$).resolves.toEqual({
      document: { uid: 'doc-uid' },
      notificationSent: true,
    });
  });

  it('addPermissionWithNotification reports SMTP failure after permission is created', async () => {
    const result$ = firstValueFrom(
      service.addPermissionWithNotification('doc-uid', {
        username: 'user-readonly01',
        permission: 'Read',
        notify: true,
      }),
    );

    const addReq = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
    addReq.flush(docWithLocalAce('ace-42', 'user-readonly01'));

    const notifyReq = httpMock.expectOne(
      '/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission',
    );
    notifyReq.flush(
      { message: 'An error occurred while sending a mail' },
      { status: 500, statusText: 'Server Error' },
    );

    await expect(result$).resolves.toEqual({
      document: docWithLocalAce('ace-42', 'user-readonly01'),
      notificationSent: false,
      notificationErrorKey: 'permissions.notification.mail-send-failed-add',
    });
  });

  it('removeMainFile clears file:content via PUT', async () => {
    const doc$ = firstValueFrom(service.removeMainFile('doc-uid'));

    const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-uid');
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('Content-Type')).toBe('application/json');
    expect(req.request.body).toEqual({
      'entity-type': 'document',
      uid: 'doc-uid',
      properties: { 'file:content': null },
    });
    req.flush({ uid: 'doc-uid', properties: { 'file:content': null } });

    await expect(doc$).resolves.toEqual({ uid: 'doc-uid', properties: { 'file:content': null } });
  });

  it('replaceMainFile posts Blob.AttachOnDocument with file:content xpath', async () => {
    const file = new File(['content'], 'replacement.pdf', { type: 'application/pdf' });
    const blob$ = firstValueFrom(service.replaceMainFile('doc-uid', file));

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/Blob.AttachOnDocument');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeInstanceOf(FormData);
    const form = req.request.body as FormData;
    const requestJson = JSON.parse(await (form.get('request') as Blob).text());
    expect(requestJson.params).toEqual({
      document: 'doc-uid',
      save: 'true',
      xpath: 'file:content',
    });
    expect(form.get('file')).toBe(file);
    req.flush(new Blob(['ok']));

    const blob = await blob$;
    expect(blob).toBeInstanceOf(Blob);
  });

  it('fetchBlob sends clientReason=view by default (Web UI preview parity)', async () => {
    const blob$ = firstValueFrom(service.fetchBlob('doc-uid'));

    const req = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/id/doc-uid/@blob/file:content' &&
        r.params.get('clientReason') === 'view',
    );
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['preview']));

    await expect(blob$).resolves.toBeInstanceOf(Blob);
  });

  it('fetchBlob sends clientReason=download for explicit downloads', async () => {
    const blob$ = firstValueFrom(service.fetchBlob('doc-uid', { clientReason: 'download' }));

    const req = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/id/doc-uid/@blob/file:content' &&
        r.params.get('clientReason') === 'download',
    );
    req.flush(new Blob(['file']));

    await expect(blob$).resolves.toBeInstanceOf(Blob);
  });
});

function docWithLocalAce(aceId: string, username: string) {
  return {
    uid: 'doc-uid',
    contextParameters: {
      acls: [
        {
          name: 'local',
          aces: [
            {
              id: aceId,
              username,
              externalUser: username.startsWith('transient/'),
              permission: 'Read',
              granted: true,
              creator: null,
              begin: null,
              end: null,
              status: 'effective',
            },
          ],
        },
      ],
    },
  };
}
