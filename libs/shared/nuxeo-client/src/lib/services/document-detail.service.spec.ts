import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CURRENT_USERNAME } from '../current-user.token';
import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { ANNOTATION_DOCUMENTS_QUERY, DocumentDetailService } from './document-detail.service';

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
    // The page merges this read over the document, so it carries what a permission change moves:
    // the permissions, and the lifecycle transitions they let the user follow.
    expect(req.request.headers.get('enrichers.document')?.split(',')).toEqual([
      'acls',
      'permissions',
      'userVisiblePermissions',
      'allowedTransitions',
    ]);
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

  describe('getAnnotationDocuments', () => {
    type Query = { params: { currentPageIndex: number } };
    const isQuery = (index: number) => (r: { url: string; body: unknown }) =>
      r.url === '/nuxeo/api/v1/automation/Repository.Query' &&
      (r.body as Query | null)?.params?.currentPageIndex === index;

    it('asks the repository, not the index, for one file and one origin, oldest first by the server date', async () => {
      const docs$ = firstValueFrom(
        service.getAnnotationDocuments('doc-uid', 'picture:views', 'nuxeo-satori.review'),
      );
      const req = httpMock.expectOne(isQuery(0));
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        params: {
          query: ANNOTATION_DOCUMENTS_QUERY,
          queryParams: ['doc-uid', 'picture:views', 'nuxeo-satori.review'],
          pageSize: 1000,
          currentPageIndex: 0,
        },
        context: {},
      });
      expect(ANNOTATION_DOCUMENTS_QUERY).toContain('ORDER BY dc:created ASC');
      expect(req.request.headers.get('properties')).toBe(
        'dublincore,comment,annotation,externalEntity',
      );
      req.flush({ entries: [{ uid: 'a1' }], isNextPageAvailable: false });
      await expect(docs$).resolves.toEqual([{ uid: 'a1' }]);
    });

    it('reads every page, in order', async () => {
      const docs$ = firstValueFrom(service.getAnnotationDocuments('doc-uid', 'x:y', 'o'));
      httpMock.expectOne(isQuery(0)).flush({ entries: [{ uid: 'a1' }], isNextPageAvailable: true });
      httpMock.expectOne(isQuery(1)).flush({ entries: [{ uid: 'a2' }], isNextPageAvailable: true });
      httpMock
        .expectOne(isQuery(2))
        .flush({ entries: [{ uid: 'a3' }], isNextPageAvailable: false });
      await expect(docs$).resolves.toEqual([{ uid: 'a1' }, { uid: 'a2' }, { uid: 'a3' }]);
    });

    it('errors, rather than answer part of a review, on an answer that is not a list or on too many pages', async () => {
      const odd$ = firstValueFrom(service.getAnnotationDocuments('doc-uid', 'x:y', 'o'));
      httpMock.expectOne(isQuery(0)).flush({ 'entity-type': 'exception' });
      await expect(odd$).rejects.toMatchObject({ status: 500 });

      const many$ = firstValueFrom(service.getAnnotationDocuments('doc-uid', 'x:y', 'o'));
      for (let index = 0; index < 20; index++)
        httpMock
          .expectOne(isQuery(index))
          .flush({ entries: [{ uid: `a${index}` }], isNextPageAvailable: true });
      await expect(many$).rejects.toMatchObject({ status: 500 });
    });
  });

  it('createAnnotation posts the file, the text and the payload, and no author', async () => {
    const created$ = firstValueFrom(
      service.createAnnotation('doc-uid', {
        xpath: 'picture:views',
        text: 'The logo is too close to the hem',
        origin: 'nuxeo-satori.review',
        entity: '{"kind":"pin"}',
      }),
    );

    const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-uid/@annotation');
    expect(req.request.method).toBe('POST');
    // The server makes the user signed in the author: the body names none.
    expect(req.request.body).toEqual({
      'entity-type': 'annotation',
      parentId: 'doc-uid',
      xpath: 'picture:views',
      text: 'The logo is too close to the hem',
      origin: 'nuxeo-satori.review',
      entity: '{"kind":"pin"}',
    });
    req.flush({ id: 'a1' });

    await expect(created$).resolves.toEqual({ id: 'a1' });
  });

  it('createAnnotation sends no origin or entity it was not given', () => {
    service.createAnnotation('doc-uid', { xpath: 'file:content', text: 'Note' }).subscribe();

    const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-uid/@annotation');
    expect(Object.keys(req.request.body as object).sort()).toEqual([
      'entity-type',
      'parentId',
      'text',
      'xpath',
    ]);
    req.flush({ id: 'a2' });
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
