import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';

import { CURRENT_USERNAME } from '../current-user.token';
import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import type { NuxeoDocument } from '../models/document.model';
import { DocumentDetailService } from './document-detail.service';

function doc(overrides: Partial<NuxeoDocument> = {}): NuxeoDocument {
  return {
    uid: 'doc-1',
    title: 'Invoice',
    type: 'File',
    path: '/default-domain/workspaces/ws/Invoice',
    state: 'project',
    lastModified: '2026-02-01T00:00:00.000Z',
    properties: {},
    ...overrides,
  } as NuxeoDocument;
}

describe('DocumentDetailService', () => {
  let service: DocumentDetailService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: CURRENT_USERNAME, useValue: () => 'satori-admin' },
      ],
    });
    service = TestBed.inject(DocumentDetailService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('reading a document', () => {
    it('asks for every property and the enrichers the detail page renders', async () => {
      const pending = firstValueFrom(service.getFullDocument('doc-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1');
      expect(req.request.headers.get('properties')).toBe('*');
      // Each of these feeds a specific panel. Dropping one silently empties that panel
      // rather than erroring, which is why the list is asserted rather than sampled.
      const enrichers = req.request.headers.get('enrichers.document') ?? '';
      for (const enricher of [
        'acls',
        'permissions',
        'renditions',
        'favorites',
        'subscribedNotifications',
        'collections',
        'preview',
        'thumbnail',
      ]) {
        expect(enrichers).toContain(enricher);
      }
      req.flush(doc());
      expect((await pending).uid).toBe('doc-1');
    });

    it('asks for the lock, which Nuxeo otherwise leaves out of the response', async () => {
      // Without `fetch-document: lock` a locked document arrives with no `lockOwner` and
      // no `lockCreated`, and every page reading it shows the document as unlocked.
      const pending = firstValueFrom(service.getFullDocument('doc-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1');
      expect(req.request.headers.get('fetch-document')).toBe('lock');
      req.flush(doc({ lockOwner: 'alice', lockCreated: '2026-10-09T06:27:22.039Z' }));
      expect(await pending).toMatchObject({
        lockOwner: 'alice',
        lockCreated: '2026-10-09T06:27:22.039Z',
      });
    });

    it('propagates a 404 rather than emitting an empty document', async () => {
      const pending = firstValueFrom(service.getFullDocument('ghost'));
      httpMock
        .expectOne('/nuxeo/api/v1/id/ghost')
        .flush('No such document', { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toMatchObject({ status: 404 });
    });

    it('propagates a 403 on a document the user cannot read', async () => {
      const pending = firstValueFrom(service.getFullDocument('secret'));
      httpMock
        .expectOne('/nuxeo/api/v1/id/secret')
        .flush('Forbidden', { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('fetchBlob', () => {
    it('falls back to blobholder:0 when file:content is absent', async () => {
      // Notes and structured documents carry no `file:content`; without the fallback the
      // preview pane shows an error for every one of them.
      const pending = firstValueFrom(service.fetchBlob('doc-1'));
      httpMock
        .expectOne((r) => r.url.includes('@blob/file:content'))
        .flush(new Blob(['x']), { status: 404, statusText: 'Not Found' });
      httpMock.expectOne((r) => r.url.includes('@blob/blobholder:0')).flush(new Blob(['pdf']));
      expect(await (await pending).text()).toBe('pdf');
    });

    it('does not fetch blobholder:0 when file:content succeeded', async () => {
      const pending = firstValueFrom(service.fetchBlob('doc-1'));
      httpMock.expectOne((r) => r.url.includes('@blob/file:content')).flush(new Blob(['main']));
      httpMock.expectNone((r) => r.url.includes('blobholder:0'));
      expect(await (await pending).text()).toBe('main');
    });

    it('surfaces the failure when both the main blob and the fallback fail', async () => {
      const pending = firstValueFrom(service.fetchBlob('doc-1'));
      httpMock
        .expectOne((r) => r.url.includes('@blob/file:content'))
        .flush(new Blob(['x']), { status: 500, statusText: 'Server Error' });
      httpMock
        .expectOne((r) => r.url.includes('@blob/blobholder:0'))
        .flush(new Blob(['x']), { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toMatchObject({ status: 500 });
    });

    it('carries the client reason on the fallback request too', async () => {
      // The reason drives Nuxeo's download audit. Losing it on the fallback would under-report
      // downloads for exactly the document types that need the fallback.
      const pending = firstValueFrom(service.fetchBlob('doc-1', { clientReason: 'download' }));
      httpMock
        .expectOne((r) => r.url.includes('@blob/file:content'))
        .flush(new Blob(['x']), { status: 404, statusText: 'Not Found' });
      const fallback = httpMock.expectOne((r) => r.url.includes('@blob/blobholder:0'));
      expect(fallback.request.params.get('clientReason')).toBe('download');
      fallback.flush(new Blob(['pdf']));
      await pending;
    });
  });

  describe('fetchBlobByXpath', () => {
    it('reads an attachment at the xpath it was given', async () => {
      const pending = firstValueFrom(service.fetchBlobByXpath('doc-1', 'files:files/0/file'));
      const req = httpMock.expectOne((r) => r.url.includes('@blob/files:files/0/file'));
      expect(req.request.params.get('clientReason')).toBe('view');
      req.flush(new Blob(['attachment']));
      expect(await (await pending).text()).toBe('attachment');
    });

    it('does not fall back to blobholder for an explicit xpath', async () => {
      // A named attachment that is missing is a real error; substituting the main file would
      // hand the user the wrong bytes under the right filename.
      const pending = firstValueFrom(service.fetchBlobByXpath('doc-1', 'files:files/9/file'));
      httpMock
        .expectOne((r) => r.url.includes('@blob/files:files/9/file'))
        .flush(new Blob(['x']), { status: 404, statusText: 'Not Found' });
      httpMock.expectNone((r) => r.url.includes('blobholder'));
      await expect(pending).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('renditions', () => {
    it('reads the pdf rendition from the rendition adapter', async () => {
      const pending = firstValueFrom(service.fetchPdfRendition('doc-1'));
      httpMock
        .expectOne('/nuxeo/api/v1/id/doc-1/@rendition/pdf')
        .flush(new Blob(['%PDF'], { type: 'application/pdf' }));
      expect(await (await pending).text()).toBe('%PDF');
    });

    it('propagates a rendition failure rather than an empty blob', async () => {
      const pending = firstValueFrom(service.fetchThumbnail('doc-1'));
      httpMock
        .expectOne('/nuxeo/api/v1/id/doc-1/@rendition/thumbnail')
        .flush(new Blob(['x']), { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('the queries it builds', () => {
    it('scopes published versions to proxies of this document, excluding trash', async () => {
      const pending = firstValueFrom(service.getPublishedVersions('doc-1'));
      const req = httpMock.expectOne((r) => r.url.includes('/search/pp/nxql_search/execute'));
      const query = req.request.params.get('queryParams') ?? '';
      expect(query).toContain('ecm:isProxy = 1');
      expect(query).toContain('ecm:isTrashed = 0');
      expect(query).toContain('rend:sourceVersionableId = "doc-1"');
      expect(query).toContain('ecm:proxyVersionableId = "doc-1"');
      // Newest first, and version-ordered within a day.
      expect(req.request.params.get('sortOrder')).toBe('desc,desc,desc');
      req.flush({ entries: [], resultsCount: 0 });
      await pending;
    });

    it('lists only section roots and sections for the publish dialog', async () => {
      const pending = firstValueFrom(service.getSectionTree());
      const req = httpMock.expectOne((r) => r.url.includes('/search/lang/NXQL/execute'));
      const query = req.request.params.get('query') ?? '';
      expect(query).toContain("ecm:primaryType IN ('SectionRoot', 'Section')");
      expect(query).toContain('ecm:isTrashed = 0');
      req.flush({ entries: [doc({ type: 'Section' })], resultsCount: 1 });
      expect((await pending).entries).toHaveLength(1);
    });

    it('excludes trashed and deleted collections from the collection picker', async () => {
      const pending = firstValueFrom(service.getCollections());
      const req = httpMock.expectOne((r) => r.url.includes('/search/lang/NXQL/execute'));
      const query = req.request.params.get('query') ?? '';
      expect(query).toContain('FROM Collection');
      expect(query).toContain('ecm:isTrashed = 0');
      expect(query).toContain("ecm:currentLifeCycleState != 'deleted'");
      req.flush({ entries: [], resultsCount: 0 });
      await pending;
    });

    it('scopes versions to this document and to versions only', async () => {
      const pending = firstValueFrom(service.getVersions('doc-1'));
      const req = httpMock.expectOne((r) => r.url.includes('/search/lang/NXQL/execute'));
      const query = req.request.params.get('query') ?? '';
      expect(query).toContain("ecm:versionVersionableId = 'doc-1'");
      expect(query).toContain('ecm:isVersion = 1');
      req.flush({ entries: [], resultsCount: 0 });
      await pending;
    });

    it('scopes comments to descendants of this document, oldest first', async () => {
      const pending = firstValueFrom(service.getAllComments('doc-1'));
      const req = httpMock.expectOne((r) => r.url.includes('/search/lang/NXQL/execute'));
      const query = req.request.params.get('query') ?? '';
      expect(query).toContain('FROM Comment');
      expect(query).toContain("ecm:ancestorId = 'doc-1'");
      expect(query).toContain('ORDER BY dc:created ASC');
      req.flush({ entries: [], resultsCount: 0 });
      await pending;
    });
  });

  describe('publishing', () => {
    it('sends only the target when no options are given', async () => {
      const pending = firstValueFrom(service.publishDocument('doc-1', 'section-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.PublishToSection');
      expect(req.request.body.params).toEqual({ target: 'section-1' });
      req.flush(doc());
      await pending;
    });

    it('adds only the options that were asked for', async () => {
      // Nuxeo treats a present `override` as a request to replace an existing publication, so
      // sending it unconditionally would silently overwrite.
      const pending = firstValueFrom(
        service.publishDocument('doc-1', 'section-1', {
          override: true,
          renditionName: 'pdf',
          defaultRendition: true,
        }),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.PublishToSection');
      expect(req.request.body.params).toEqual({
        target: 'section-1',
        override: 'true',
        renditionName: 'pdf',
        defaultRendition: true,
      });
      req.flush(doc());
      await pending;
    });

    it('omits falsy options rather than sending them as false', async () => {
      const pending = firstValueFrom(
        service.publishDocument('doc-1', 'section-1', {
          override: false,
          renditionName: '',
          defaultRendition: false,
        }),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.PublishToSection');
      expect(req.request.body.params).toEqual({ target: 'section-1' });
      req.flush(doc());
      await pending;
    });

    it('always overrides when republishing, which is the point of republish', async () => {
      const pending = firstValueFrom(service.republishDocument('doc-1', 'section-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.PublishToSection');
      expect(req.request.body.params).toEqual({ target: 'section-1', override: 'true' });
      req.flush(doc());
      await pending;
    });

    it('unpublishes by deleting the proxy, not the source document', async () => {
      // Deleting the source would destroy the document instead of withdrawing a publication.
      const pending = firstValueFrom(service.unpublishDocument('proxy-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/proxy-1');
      expect(req.request.method).toBe('DELETE');
      req.flush({});
      await pending;
    });
  });

  describe('the automation operations it targets', () => {
    const cases: Array<{ name: string; url: string; call: () => Promise<unknown> }> = [
      {
        name: 'lockDocument',
        url: '/nuxeo/api/v1/id/doc-1/@op/Document.Lock',
        call: () => firstValueFrom(service.lockDocument('doc-1')),
      },
      {
        name: 'unlockDocument',
        url: '/nuxeo/api/v1/id/doc-1/@op/Document.Unlock',
        call: () => firstValueFrom(service.unlockDocument('doc-1')),
      },
      {
        name: 'restoreFromTrash',
        url: '/nuxeo/api/v1/id/doc-1/@op/Document.Untrash',
        call: () => firstValueFrom(service.restoreFromTrash('doc-1')),
      },
      {
        name: 'addToFavorites',
        url: '/nuxeo/api/v1/automation/Document.AddToFavorites',
        call: () => firstValueFrom(service.addToFavorites('doc-1')),
      },
      {
        name: 'removeFromFavorites',
        url: '/nuxeo/api/v1/automation/Document.RemoveFromFavorites',
        call: () => firstValueFrom(service.removeFromFavorites('doc-1')),
      },
      {
        name: 'blockPermissionInheritance',
        url: '/nuxeo/api/v1/id/doc-1/@op/Document.BlockPermissionInheritance',
        call: () => firstValueFrom(service.blockPermissionInheritance('doc-1')),
      },
      {
        name: 'unblockPermissionInheritance',
        url: '/nuxeo/api/v1/id/doc-1/@op/Document.UnblockPermissionInheritance',
        call: () => firstValueFrom(service.unblockPermissionInheritance('doc-1')),
      },
      {
        name: 'restoreVersion',
        url: '/nuxeo/api/v1/id/ver-1/@op/Document.RestoreVersion',
        call: () => firstValueFrom(service.restoreVersion('ver-1')),
      },
    ];

    for (const { name, url, call } of cases) {
      // The operation name is the whole contract of these methods: a wrong one is answered by
      // Nuxeo with a 404 the caller reports as "the document is gone".
      it(`${name} posts to ${url}`, async () => {
        const pending = call();
        const req = httpMock.expectOne(url);
        expect(req.request.method).toBe('POST');
        req.flush(doc());
        await pending;
      });
    }

    it('asks for the lock on Lock, so the caller learns the owner and date the server recorded', async () => {
      const pending = firstValueFrom(service.lockDocument('doc-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.Lock');
      expect(req.request.headers.get('fetch-document')).toBe('lock');
      req.flush(doc({ lockOwner: 'satori-admin', lockCreated: '2026-10-09T06:27:22.039Z' }));
      expect(await pending).toMatchObject({ lockOwner: 'satori-admin' });
    });

    it('asks for the lock on Unlock too, so the response says the lock is gone', async () => {
      const pending = firstValueFrom(service.unlockDocument('doc-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.Unlock');
      expect(req.request.headers.get('fetch-document')).toBe('lock');
      req.flush(doc({ lockOwner: null, lockCreated: null }));
      expect(await pending).toMatchObject({ lockOwner: null });
    });

    it('subscribes with the default notification set', async () => {
      const pending = firstValueFrom(service.subscribe('doc-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.Subscribe');
      expect(req.request.body.params).toEqual({ notifications: 'Creation,Modification' });
      req.flush(doc());
      await pending;
    });

    it('unsubscribes from exactly the notifications it was given', async () => {
      const pending = firstValueFrom(service.unsubscribe('doc-1', 'Modification'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.Unsubscribe');
      expect(req.request.body.params).toEqual({ notifications: 'Modification' });
      req.flush(doc());
      await pending;
    });

    it('adds a document to a collection by collection id', async () => {
      const pending = firstValueFrom(service.addToCollection('doc-1', 'col-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.AddToCollection');
      expect(req.request.body.params).toEqual({ collection: 'col-1' });
      req.flush(doc());
      await pending;
    });

    it('creates a collection with an empty description by default', async () => {
      const pending = firstValueFrom(service.createCollection('My Collection'));
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Collection.Create');
      expect(req.request.body.params).toEqual({ name: 'My Collection', description: '' });
      req.flush(doc({ type: 'Collection' }));
      await pending;
    });

    it('permanently deletes with DELETE, not an operation', async () => {
      const pending = firstValueFrom(service.permanentlyDelete('doc-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      await pending;
    });

    it('checks in a minor version by default and a major one when asked', async () => {
      const minor = firstValueFrom(service.checkInDocument('doc-1'));
      const minorReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.CheckIn');
      expect(minorReq.request.body.params).toEqual({ version: 'minor' });
      minorReq.flush(doc());
      await minor;

      const major = firstValueFrom(service.checkInDocument('doc-1', false));
      const majorReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.CheckIn');
      expect(majorReq.request.body.params).toEqual({ version: 'major' });
      majorReq.flush(doc());
      await major;
    });

    it('saves the document when creating a version, or the increment is lost', async () => {
      const pending = firstValueFrom(service.createVersion('doc-1', 'Major'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.CreateVersion');
      expect(req.request.body.params).toEqual({ increment: 'Major', saveDocument: true });
      req.flush(doc());
      await pending;
    });

    it('checks the document out when restoring a version, so it stays editable', async () => {
      const pending = firstValueFrom(service.restoreVersion('ver-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/ver-1/@op/Document.RestoreVersion');
      expect(req.request.body.params).toEqual({ checkout: true });
      req.flush(doc());
      await pending;
    });
  });

  describe('trashing', () => {
    it('prefixes a bare uid with doc: for the automation input', async () => {
      const pending = firstValueFrom(service.trashDocument('doc-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Document.Trash');
      expect(req.request.body.input).toBe('doc:doc-1');
      req.flush(doc());
      await pending;
    });

    it('does not double-prefix a uid that already carries doc:', async () => {
      const pending = firstValueFrom(service.trashDocument('doc:doc-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Document.Trash');
      expect(req.request.body.input).toBe('doc:doc-1');
      req.flush(doc());
      await pending;
    });

    it('trashes nothing and makes no request for an empty selection', async () => {
      expect(await firstValueFrom(service.trashDocuments([]))).toEqual([]);
      httpMock.expectNone(() => true);
    });

    it('returns only the documents that were actually trashed', async () => {
      // A bulk trash where one document is locked must not fail the whole action, and must
      // not report the locked one as trashed either.
      const pending = firstValueFrom(service.trashDocuments(['a', 'b', 'c']));
      const requests = httpMock.match('/nuxeo/api/v1/automation/Document.Trash');
      expect(requests).toHaveLength(3);
      requests[0].flush(doc({ uid: 'a' }));
      requests[1].flush('Locked', { status: 409, statusText: 'Conflict' });
      requests[2].flush(doc({ uid: 'c' }));

      expect((await pending).map((d) => d.uid)).toEqual(['a', 'c']);
    });

    it('returns an empty list when every document in the selection failed', async () => {
      const pending = firstValueFrom(service.trashDocuments(['a', 'b']));
      for (const req of httpMock.match('/nuxeo/api/v1/automation/Document.Trash')) {
        req.flush('Locked', { status: 409, statusText: 'Conflict' });
      }
      expect(await pending).toEqual([]);
    });
  });

  describe('getRunnableWorkflows', () => {
    it('maps the enricher entries into workflow models, preferring workflowModelName', async () => {
      // `name` on the enricher entry is the *instance* name; `workflowModelName` is what
      // `Workflow.Start` takes. Sending the wrong one starts nothing.
      const pending = firstValueFrom(service.getRunnableWorkflows('doc-1'));
      httpMock.expectOne('/nuxeo/api/v1/id/doc-1').flush(
        doc({
          contextParameters: {
            runnableWorkflows: [
              { name: 'instance-1', workflowModelName: 'SerialDocumentReview', title: 'Review' },
            ],
          },
        }),
      );
      expect(await pending).toEqual([
        {
          'entity-type': 'workflowModel',
          name: 'SerialDocumentReview',
          title: 'Review',
        },
      ]);
    });

    it('falls back to name when the entry carries no workflowModelName', async () => {
      const pending = firstValueFrom(service.getRunnableWorkflows('doc-1'));
      httpMock
        .expectOne('/nuxeo/api/v1/id/doc-1')
        .flush(doc({ contextParameters: { runnableWorkflows: [{ name: 'x', title: 'X' }] } }));
      expect((await pending)[0].name).toBe('x');
    });

    it('returns an empty list when the enricher is absent, rather than throwing', async () => {
      // An approved document has no runnable workflows and Nuxeo omits the key entirely.
      const pending = firstValueFrom(service.getRunnableWorkflows('doc-1'));
      httpMock.expectOne('/nuxeo/api/v1/id/doc-1').flush(doc());
      expect(await pending).toEqual([]);
    });

    it('asks for the runnableWorkflows enricher, which is what filters by lifecycle state', async () => {
      const pending = firstValueFrom(service.getRunnableWorkflows('doc-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1');
      expect(req.request.headers.get('enrichers.document')).toBe('runnableWorkflows');
      req.flush(doc());
      await pending;
    });

    it('lists all available workflows through the workflow adapter', async () => {
      const pending = firstValueFrom(service.getAvailableWorkflows('doc-1'));
      httpMock
        .expectOne('/nuxeo/api/v1/id/doc-1/@workflow')
        .flush({ entries: [{ workflowModelName: 'SerialDocumentReview', title: 'Review' }] });
      expect((await pending).entries).toHaveLength(1);
    });
  });

  describe('permission helpers', () => {
    it('replaceACE defaults overwrite to true so an existing grant is replaced', async () => {
      const pending = firstValueFrom(
        service.replaceACE('doc-1', { user: 'jdoe', permission: 'ReadWrite' }),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.SetACE');
      expect(req.request.body.params.overwrite).toBe(true);
      req.flush(doc());
      await pending;
    });

    it('replaceACE honours an explicit overwrite of false', async () => {
      const pending = firstValueFrom(
        service.replaceACE('doc-1', { user: 'jdoe', permission: 'Read', overwrite: false }),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.SetACE');
      expect(req.request.body.params.overwrite).toBe(false);
      req.flush(doc());
      await pending;
    });

    it('addACE forwards its params verbatim, including the validity window', async () => {
      const pending = firstValueFrom(
        service.addACE('doc-1', {
          user: 'jdoe',
          permission: 'Read',
          begin: '2026-01-01',
          end: '2026-06-30',
          notify: true,
          comment: 'temporary access',
        }),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.AddACE');
      expect(req.request.body.params).toEqual({
        user: 'jdoe',
        permission: 'Read',
        begin: '2026-01-01',
        end: '2026-06-30',
        notify: true,
        comment: 'temporary access',
      });
      req.flush(doc());
      await pending;
    });

    it('removePermission defaults the acl to local', async () => {
      // Without a default Nuxeo would target the inherited acl, where the ace does not live,
      // and answer 200 having removed nothing.
      const pending = firstValueFrom(
        service.removePermission('doc-1', { user: 'jdoe', permission: 'Read' }),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.RemovePermission');
      expect(req.request.body.params).toEqual({
        user: 'jdoe',
        permission: 'Read',
        acl: 'local',
      });
      req.flush(doc());
      await pending;
    });

    it('removePermission honours an explicit acl name', async () => {
      const pending = firstValueFrom(
        service.removePermission('doc-1', { user: 'jdoe', permission: 'Read', acl: 'inherited' }),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.RemovePermission');
      expect(req.request.body.params.acl).toBe('inherited');
      req.flush(doc());
      await pending;
    });

    it('replacePermission seeds an empty users array before the caller params', async () => {
      // `Document.ReplacePermission` rejects the call without `users`, and the spread order
      // is what lets a caller override it.
      const pending = firstValueFrom(
        service.replacePermission('doc-1', {
          id: 'ace-1',
          username: 'jdoe',
          permission: 'ReadWrite',
        }),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Document.ReplacePermission');
      expect(req.request.body.params.users).toEqual([]);
      expect(req.request.body.params.id).toBe('ace-1');
      expect(req.request.body.input).toBe('doc-1');
      req.flush(doc());
      await pending;
    });

    it('addPermission sends username without email, and email without username', async () => {
      // Nuxeo rejects a call carrying both, so the conditional spread is load-bearing.
      const byName = firstValueFrom(
        service.addPermission('doc-1', { username: 'jdoe', permission: 'Read' }),
      );
      const nameReq = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
      expect(nameReq.request.body.params.username).toBe('jdoe');
      expect(nameReq.request.body.params).not.toHaveProperty('email');
      nameReq.flush(doc());
      await byName;

      const byEmail = firstValueFrom(
        service.addPermission('doc-1', { email: 'x@y.test', permission: 'Read' }),
      );
      const emailReq = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
      expect(emailReq.request.body.params.email).toBe('x@y.test');
      expect(emailReq.request.body.params).not.toHaveProperty('username');
      emailReq.flush(doc());
      await byEmail;
    });

    it('sends the notification email for a named ace', async () => {
      const pending = firstValueFrom(service.sendNotificationEmailForPermission('doc-1', 'ace-1'));
      const req = httpMock.expectOne(
        '/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission',
      );
      expect(req.request.body).toEqual({
        params: { id: 'ace-1' },
        context: {},
        input: 'doc-1',
      });
      req.flush(doc());
      await pending;
    });
  });

  describe('addPermissionWithNotification', () => {
    /** A local acl containing one granted ace for `jdoe`. */
    const withLocalAce = (id: string) =>
      doc({
        contextParameters: {
          acls: [
            {
              name: 'local',
              aces: [
                {
                  id,
                  username: 'jdoe',
                  externalUser: false,
                  permission: 'Read',
                  granted: true,
                  creator: 'satori-admin',
                  begin: null,
                  end: null,
                  status: 'effective',
                },
              ],
            },
          ],
        },
      });

    it('does not send a notification when notify was not requested', async () => {
      // `notify === true` rather than truthiness: an undefined flag must not mail the user.
      const pending = firstValueFrom(
        service.addPermissionWithNotification('doc-1', {
          username: 'jdoe',
          permission: 'Read',
        }),
      );
      httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission').flush(doc());
      httpMock.expectNone('/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission');
      const result = await pending;
      expect(result.notificationSent).toBe(false);
      expect(result.notificationErrorKey).toBeUndefined();
    });

    it('always asks Nuxeo not to notify, so the mail is a separate observable failure', async () => {
      // Document.AddPermission swallows SMTP failures. Sending `notify: false` and mailing
      // separately is what lets the UI report "permission added, email failed".
      const pending = firstValueFrom(
        service.addPermissionWithNotification('doc-1', {
          username: 'jdoe',
          permission: 'Read',
          notify: true,
        }),
      );
      const add = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
      expect(add.request.body.params.notify).toBe(false);
      add.flush(withLocalAce('ace-1'));

      const mail = httpMock.expectOne(
        '/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission',
      );
      expect(mail.request.body.params.id).toBe('ace-1');
      mail.flush(doc({ title: 'Invoice updated' }));

      const result = await pending;
      expect(result.notificationSent).toBe(true);
      expect(result.document.title).toBe('Invoice updated');
    });

    it('refetches permissions to find the ace when AddPermission did not return the acl', async () => {
      const pending = firstValueFrom(
        service.addPermissionWithNotification('doc-1', {
          username: 'jdoe',
          permission: 'Read',
          notify: true,
        }),
      );
      httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission').flush(doc());
      httpMock.expectOne('/nuxeo/api/v1/id/doc-1').flush(withLocalAce('ace-7'));

      const mail = httpMock.expectOne(
        '/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission',
      );
      expect(mail.request.body.params.id).toBe('ace-7');
      mail.flush(doc());
      expect((await pending).notificationSent).toBe(true);
    });

    it('keeps the granted permission and explains the failure when the ace cannot be found', async () => {
      // The permission IS in force at this point. Rejecting would tell the user the grant
      // failed, and they would grant it a second time.
      const pending = firstValueFrom(
        service.addPermissionWithNotification('doc-1', {
          username: 'jdoe',
          permission: 'Read',
          notify: true,
        }),
      );
      httpMock
        .expectOne('/nuxeo/api/v1/automation/Document.AddPermission')
        .flush(doc({ uid: 'doc-1' }));
      httpMock.expectOne('/nuxeo/api/v1/id/doc-1').flush(doc());

      const result = await pending;
      expect(result.document.uid).toBe('doc-1');
      expect(result.notificationSent).toBe(false);
      expect(result.notificationErrorKey).toBe('permissions.notification.ace-not-found-add');
    });

    it('keeps the granted permission when the refetch itself fails', async () => {
      const pending = firstValueFrom(
        service.addPermissionWithNotification('doc-1', {
          username: 'jdoe',
          permission: 'Read',
          notify: true,
        }),
      );
      httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission').flush(doc());
      httpMock
        .expectOne('/nuxeo/api/v1/id/doc-1')
        .flush('boom', { status: 500, statusText: 'Server Error' });

      const result = await pending;
      expect(result.notificationSent).toBe(false);
      expect(result.notificationErrorKey).toBe('permissions.notification.ace-not-found-add');
    });

    it('reports an SMTP failure without losing the permission', async () => {
      const pending = firstValueFrom(
        service.addPermissionWithNotification('doc-1', {
          username: 'jdoe',
          permission: 'Read',
          notify: true,
        }),
      );
      httpMock
        .expectOne('/nuxeo/api/v1/automation/Document.AddPermission')
        .flush(withLocalAce('ace-1'));
      httpMock
        .expectOne('/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission')
        .flush(
          { message: 'Failed to invoke operation: sending a mail' },
          { status: 500, statusText: 'Server Error' },
        );

      const result = await pending;
      expect(result.notificationSent).toBe(false);
      expect(result.notificationErrorKey).toBe('permissions.notification.mail-send-failed-add');
    });

    it('rethrows a notification failure that is not an SMTP failure', async () => {
      // A 403 on the notification means something else is wrong, and swallowing it would
      // present a broken server as a mail configuration problem.
      const pending = firstValueFrom(
        service.addPermissionWithNotification('doc-1', {
          username: 'jdoe',
          permission: 'Read',
          notify: true,
        }),
      );
      httpMock
        .expectOne('/nuxeo/api/v1/automation/Document.AddPermission')
        .flush(withLocalAce('ace-1'));
      httpMock
        .expectOne('/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission')
        .flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

      await expect(pending).rejects.toMatchObject({ status: 403 });
    });

    it('propagates a failure to grant the permission at all', async () => {
      const pending = firstValueFrom(
        service.addPermissionWithNotification('doc-1', {
          username: 'jdoe',
          permission: 'Read',
          notify: true,
        }),
      );
      httpMock
        .expectOne('/nuxeo/api/v1/automation/Document.AddPermission')
        .flush('nope', { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('replacePermissionWithNotification', () => {
    it('does not mail when notify was not requested', async () => {
      const pending = firstValueFrom(
        service.replacePermissionWithNotification('doc-1', {
          id: 'ace-1',
          username: 'jdoe',
          permission: 'ReadWrite',
        }),
      );
      httpMock.expectOne('/nuxeo/api/v1/automation/Document.ReplacePermission').flush(doc());
      expect((await pending).notificationSent).toBe(false);
    });

    it('mails separately and reports the update wording on an SMTP failure', async () => {
      const pending = firstValueFrom(
        service.replacePermissionWithNotification('doc-1', {
          id: 'ace-1',
          username: 'jdoe',
          permission: 'ReadWrite',
          notify: true,
        }),
      );
      const replace = httpMock.expectOne('/nuxeo/api/v1/automation/Document.ReplacePermission');
      expect(replace.request.body.params.notify).toBe(false);
      replace.flush(
        doc({
          contextParameters: {
            acls: [
              {
                name: 'local',
                aces: [
                  {
                    id: 'ace-1',
                    username: 'jdoe',
                    externalUser: false,
                    permission: 'ReadWrite',
                    granted: true,
                    creator: 'satori-admin',
                    begin: null,
                    end: null,
                    status: 'effective',
                  },
                ],
              },
            ],
          },
        }),
      );
      httpMock
        .expectOne('/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission')
        .flush(
          { message: 'error while sending a mail' },
          { status: 500, statusText: 'Server Error' },
        );

      const result = await pending;
      // "updated", not "added": the wording tells the user which action did land.
      expect(result.notificationErrorKey).toBe('permissions.notification.mail-send-failed-update');
    });
  });

  describe('addExternalPermissionWithNotification', () => {
    it('notifies by default, because an external invitee has no other way to learn', async () => {
      // `notify !== false` here, unlike the internal paths' `notify === true`. The default
      // differs on purpose and is asserted so a "consistency" change has to be deliberate.
      const pending = firstValueFrom(
        service.addExternalPermissionWithNotification('doc-1', {
          email: '  guest@example.com  ',
          permission: 'Read',
        }),
      );
      const add = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
      // Trimmed: an untrimmed address becomes a `transient/ guest@... ` principal that never
      // matches the ace the notification lookup is searching for.
      expect(add.request.body.params.email).toBe('guest@example.com');
      add.flush(
        doc({
          contextParameters: {
            acls: [
              {
                name: 'local',
                aces: [
                  {
                    id: 'ace-ext',
                    username: 'transient/guest@example.com',
                    externalUser: true,
                    permission: 'Read',
                    granted: true,
                    creator: 'satori-admin',
                    begin: null,
                    end: null,
                    status: 'effective',
                  },
                ],
              },
            ],
          },
        }),
      );

      const mail = httpMock.expectOne(
        '/nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission',
      );
      expect(mail.request.body.params.id).toBe('ace-ext');
      mail.flush(doc());
      expect((await pending).notificationSent).toBe(true);
    });

    it('skips the mail only when notify is explicitly false', async () => {
      const pending = firstValueFrom(
        service.addExternalPermissionWithNotification('doc-1', {
          email: 'guest@example.com',
          permission: 'Read',
          notify: false,
        }),
      );
      httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission').flush(doc());
      expect((await pending).notificationSent).toBe(false);
    });
  });

  describe('addExternalPermission', () => {
    it('normalises an absent end date to null and defaults notify off', async () => {
      const pending = firstValueFrom(
        service.addExternalPermission('doc-1', {
          email: 'guest@example.com',
          permission: 'Read',
        }),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Document.AddPermission');
      expect(req.request.body.params).toMatchObject({
        email: 'guest@example.com',
        permission: 'Read',
        begin: null,
        end: null,
        notify: false,
        comment: '',
        creator: 'satori-admin',
      });
      req.flush(doc());
      await pending;
    });
  });

  describe('attachments', () => {
    it('attaches a file at files:files with save enabled', async () => {
      const pending = firstValueFrom(service.uploadAttachment('doc-1', new File(['x'], 'a.txt')));
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Blob.AttachOnDocument');
      const form: FormData = req.request.body;
      expect(form.get('file')).toBeInstanceOf(File);
      const request = form.get('request');
      expect(request).toBeInstanceOf(Blob);
      // `save: 'true'` is what persists the change; without it the blob is attached to a
      // transient copy and silently lost.
      expect(await (request as Blob).text()).toContain('"xpath":"files:files"');
      expect(await (request as Blob).text()).toContain('"save":"true"');
      req.flush(new Blob(['ok']));
      await pending;
    });

    it('replaces an attachment at its indexed xpath, not the whole list', async () => {
      const pending = firstValueFrom(
        service.replaceAttachment('doc-1', 2, new File(['x'], 'a.txt')),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Blob.AttachOnDocument');
      const request = req.request.body.get('request') as Blob;
      expect(await request.text()).toContain('"xpath":"files:files/2/file"');
      req.flush(new Blob(['ok']));
      await pending;
    });

    it('removes the attachment at the given index and keeps the rest, in order', async () => {
      const pending = firstValueFrom(service.removeAttachment('doc-1', 1));
      httpMock.expectOne('/nuxeo/api/v1/id/doc-1').flush(
        doc({
          properties: {
            'files:files': [
              { file: { name: 'a' } },
              { file: { name: 'b' } },
              { file: { name: 'c' } },
            ],
          },
        }),
      );

      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.properties['files:files']).toEqual([
        { file: { name: 'a' } },
        { file: { name: 'c' } },
      ]);
      put.flush(doc());
      await pending;
    });

    it('sends an empty list when removing the only attachment', async () => {
      const pending = firstValueFrom(service.removeAttachment('doc-1', 0));
      httpMock
        .expectOne('/nuxeo/api/v1/id/doc-1')
        .flush(doc({ properties: { 'files:files': [{ file: { name: 'a' } }] } }));
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.properties['files:files']).toEqual([]);
      put.flush(doc());
      await pending;
    });

    it('sends an empty list when the document has no attachments at all', async () => {
      // `?? []` rather than assuming the property exists: a document that never had an
      // attachment omits the key, and indexing it would throw before the PUT.
      const pending = firstValueFrom(service.removeAttachment('doc-1', 0));
      httpMock.expectOne('/nuxeo/api/v1/id/doc-1').flush(doc());
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.properties['files:files']).toEqual([]);
      put.flush(doc());
      await pending;
    });

    it('never issues the PUT when the document read fails', async () => {
      // A PUT built on a failed read would send `files:files: []` and delete every
      // attachment on the document.
      const pending = firstValueFrom(service.removeAttachment('doc-1', 0));
      httpMock
        .expectOne('/nuxeo/api/v1/id/doc-1')
        .flush('nope', { status: 403, statusText: 'Forbidden' });
      httpMock.expectNone((r) => r.method === 'PUT');
      await expect(pending).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('exports', () => {
    it('exports one document as a zip named after the caller', async () => {
      const pending = firstValueFrom(service.exportZip('doc-1', 'invoices.zip'));
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Blob.BulkDownload');
      expect(req.request.body).toEqual({
        params: { filename: 'invoices.zip' },
        input: 'docs:doc-1',
      });
      req.flush(new Blob(['PK']));
      await pending;
    });

    it('joins several uids into one bulk download input', async () => {
      const pending = firstValueFrom(service.bulkDownload(['a', 'b', 'c']));
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/Blob.BulkDownload');
      expect(req.request.body.input).toBe('docs:a,b,c');
      expect(req.request.body.params.filename).toBe('export.zip');
      req.flush(new Blob(['PK']));
      await pending;
    });

    it('exports the raw blob from blobholder:0', async () => {
      const pending = firstValueFrom(service.exportBlob('doc-1'));
      httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@blob/blobholder:0').flush(new Blob(['bytes']));
      expect(await (await pending).text()).toBe('bytes');
    });

    it('exports XML through the export adapter', async () => {
      const pending = firstValueFrom(service.exportXml('doc-1'));
      httpMock
        .expectOne((r) => r.url.includes('@export') && r.url.includes('adapter=export'))
        .flush(new Blob(['<document/>']));
      expect(await (await pending).text()).toBe('<document/>');
    });
  });

  describe('comments', () => {
    it('reads comments oldest first, which is how a thread reads', async () => {
      const pending = firstValueFrom(service.getComments('doc-1'));
      const req = httpMock.expectOne((r) => r.url.includes('/nuxeo/api/v1/id/doc-1/@comment'));
      expect(req.request.params.get('sortBy')).toBe('creationDate');
      expect(req.request.params.get('sortOrder')).toBe('ASC');
      req.flush({
        entries: [],
        totalSize: 0,
        currentPageSize: 0,
        currentPageIndex: 0,
        numberOfPages: 0,
      });
      await pending;
    });

    it('creates a comment parented to the document', async () => {
      const pending = firstValueFrom(service.createComment('doc-1', 'hello'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@comment');
      expect(req.request.body).toEqual({
        'entity-type': 'comment',
        parentId: 'doc-1',
        text: 'hello',
      });
      req.flush({ id: 'c-1', parentId: 'doc-1', text: 'hello' });
      expect((await pending).id).toBe('c-1');
    });

    it('parents a reply to the comment, not to the document', async () => {
      // Posting a reply against the document id would flatten the thread.
      const pending = firstValueFrom(service.createReply('doc-1', 'c-1', 'me too'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/c-1/@comment');
      expect(req.request.body.parentId).toBe('c-1');
      req.flush({ id: 'c-2', parentId: 'c-1', text: 'me too' });
      await pending;
    });

    it('updates a comment in place', async () => {
      const pending = firstValueFrom(service.updateComment('doc-1', 'c-1', 'edited'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@comment/c-1');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ 'entity-type': 'comment', text: 'edited' });
      req.flush({ id: 'c-1', parentId: 'doc-1', text: 'edited' });
      await pending;
    });

    it('deletes a comment by id under its document', async () => {
      const pending = firstValueFrom(service.deleteComment('doc-1', 'c-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@comment/c-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      await pending;
    });
  });

  describe('searchUsersGroups', () => {
    it('searches users and groups together and returns the suggestions', async () => {
      const pending = firstValueFrom(service.searchUsersGroups('ja'));
      const req = httpMock.expectOne('/nuxeo/api/v1/automation/UserGroup.Suggestion');
      expect(req.request.body.params).toEqual({
        searchTerm: 'ja',
        searchType: 'USER_GROUP_TYPE',
      });
      req.flush([
        {
          id: 'jdoe',
          displayLabel: 'Jane Doe',
          type: 'USER_TYPE',
          prefixed_id: 'user:jdoe',
        },
      ]);
      expect((await pending)[0].displayLabel).toBe('Jane Doe');
    });

    it('propagates a search failure rather than returning an empty suggestion list', async () => {
      // An empty list reads as "no such user" and sends the admin looking in the wrong place.
      const pending = firstValueFrom(service.searchUsersGroups('ja'));
      httpMock
        .expectOne('/nuxeo/api/v1/automation/UserGroup.Suggestion')
        .flush({}, { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toBeDefined();
    });
  });

  describe('getVersionsDirect', () => {
    it('reads versions from the repository operation, not the search index', async () => {
      // `/search/lang/NXQL/execute` is OpenSearch-backed here and lags a check-in, so a
      // versions panel reloading on check-in would miss the version just created.
      const pending = firstValueFrom(service.getVersionsDirect('doc-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.GetVersions');
      expect(req.request.method).toBe('POST');
      req.flush({ 'entity-type': 'documents', entries: [doc({ uid: 'ver-1' })] });
      expect((await pending).map((d) => d.uid)).toEqual(['ver-1']);
    });

    it('returns an empty list when the operation answers with no entries key', async () => {
      const pending = firstValueFrom(service.getVersionsDirect('doc-1'));
      httpMock
        .expectOne('/nuxeo/api/v1/id/doc-1/@op/Document.GetVersions')
        .flush({ 'entity-type': 'documents' });
      expect(await pending).toEqual([]);
    });
  });

  describe('getAuditLog', () => {
    it('defaults to fifty entries on the first page', async () => {
      const pending = firstValueFrom(service.getAuditLog('doc-1'));
      const req = httpMock.expectOne((r) => r.url.includes('/@audit'));
      expect(req.request.params.get('pageSize')).toBe('50');
      expect(req.request.params.get('currentPageIndex')).toBe('0');
      req.flush({ entries: [], resultsCount: 0 });
      await pending;
    });
  });
});
