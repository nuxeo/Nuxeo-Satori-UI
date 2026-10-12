import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import type { NuxeoDocument } from '../models/document.model';
import { CollectionService } from './collection.service';

describe('CollectionService', () => {
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

  describe('getById', () => {
    it('asks for the lock and the permissions, so the collection-detail fallback still knows a locked collection and who may unlock it', async () => {
      const pending = firstValueFrom(service.getById('col-1'));
      const req = httpMock.expectOne('/nuxeo/api/v1/id/col-1');
      expect(req.request.headers.get('properties')).toBe('dublincore');
      expect(req.request.headers.get('fetch-document')).toBe('lock');
      // Without the enricher `canShowWriteDocumentAction()` treats the user as a writer.
      expect(req.request.headers.get('enrichers.document')).toBe('permissions');
      req.flush({
        uid: 'col-1',
        type: 'Collection',
        lockOwner: 'alice',
        lockCreated: '2026-10-09T06:34:27.610Z',
      } as NuxeoDocument);
      expect(await pending).toMatchObject({ lockOwner: 'alice' });
    });

    it('propagates a 404 rather than emitting an empty collection', async () => {
      const pending = firstValueFrom(service.getById('ghost'));
      httpMock
        .expectOne('/nuxeo/api/v1/id/ghost')
        .flush('No such document', { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toMatchObject({ status: 404 });
    });
  });
});
