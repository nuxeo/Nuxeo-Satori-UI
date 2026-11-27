import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import type { NuxeoDocument, NuxeoDocumentList } from '../models/document.model';
import { DocumentService } from './document.service';

const NXQL_URL = '/nuxeo/api/v1/search/lang/NXQL/execute';

const list = (...uids: string[]): NuxeoDocumentList =>
  ({
    entries: uids.map((uid) => ({ uid, title: uid, type: 'File' })),
    totalSize: uids.length,
    currentPageSize: uids.length,
    currentPageIndex: 0,
    numberOfPages: 1,
  }) as unknown as NuxeoDocumentList;

/** The dashboard's and the navigation drawer's document lists. */
describe('DocumentService', () => {
  let service: DocumentService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    service = TestBed.inject(DocumentService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  const expectNxql = () => http.expectOne((r) => r.url === NXQL_URL);

  describe('recently edited', () => {
    it('asks NXQL for live documents, newest change first, with their Dublin Core', () => {
      service.getRecentlyEdited().subscribe();

      const request = expectNxql();
      const query = request.request.params.get('query') ?? '';
      expect(request.request.method).toBe('GET');
      expect(request.request.params.get('pageSize')).toBe('10');
      expect(request.request.headers.get('properties')).toBe('dublincore');
      expect(query).toContain('ecm:isProxy = 0');
      expect(query).toContain('ecm:isVersion = 0');
      expect(query).toContain('ecm:isTrashed = 0');
      expect(query).toContain("ecm:mixinType != 'HiddenInNavigation'");
      expect(query).toMatch(/ORDER BY dc:modified DESC$/);
      request.flush(list());
    });

    it('answers with the documents Nuxeo found, at the page size asked for', () => {
      let result: NuxeoDocumentList | undefined;
      service.getRecentlyEdited(3).subscribe((r) => (result = r));

      const request = expectNxql();
      expect(request.request.params.get('pageSize')).toBe('3');
      request.flush(list('d1', 'd2', 'd3'));

      expect(result?.entries.map((d) => d.uid)).toEqual(['d1', 'd2', 'd3']);
    });

    it('passes a server error to the caller, so the panel can say it failed', () => {
      let status: number | undefined;
      service.getRecentlyEdited().subscribe({ error: (e) => (status = e.status) });

      expectNxql().flush('boom', { status: 500, statusText: 'Server Error' });

      expect(status).toBe(500);
    });
  });

  describe('recently viewed', () => {
    it('finds what the user created or last changed, and nothing of anyone else’s', () => {
      service.getRecentlyViewed('jdoe').subscribe();

      const request = expectNxql();
      const query = request.request.params.get('query') ?? '';
      expect(query).toContain("(dc:creator = 'jdoe' OR dc:lastContributor = 'jdoe')");
      expect(query).not.toContain('{user}');
      expect(request.request.params.get('pageSize')).toBe('10');
      request.flush(list());
    });

    it('leaves out the containers no one opens as a document: Root, Favorites, Collections', () => {
      service.getRecentlyViewed('jdoe', 20).subscribe();

      const request = expectNxql();
      expect(request.request.params.get('query')).toContain(
        "ecm:primaryType NOT IN ('Root', 'Favorites', 'Collections')",
      );
      expect(request.request.params.get('pageSize')).toBe('20');
      request.flush(list());
    });

    it('escapes a quote in the user id, which Nuxeo otherwise refuses with HTTP 400', () => {
      // Checked against the local server: `dc:creator = 'o'brien'` is a syntax error, so the
      // dashboard's and the drawer's recently-viewed lists failed for such a user.
      service.getRecentlyViewed("o'brien").subscribe();

      const request = expectNxql();
      expect(request.request.params.get('query')).toContain(
        "(dc:creator = 'o\\'brien' OR dc:lastContributor = 'o\\'brien')",
      );
      request.flush(list());
    });

    it('puts the user id in as written, even where it looks like a replacement pattern', () => {
      service.getRecentlyViewed('a$&b').subscribe();

      const request = expectNxql();
      expect(request.request.params.get('query')).toContain("dc:creator = 'a$&b'");
      request.flush(list());
    });

    it('keeps to the types it is given, before the order, and to every type when given none', () => {
      service.getRecentlyViewed('jdoe', 5, ['Contract', 'Note']).subscribe();
      const typed = expectNxql();
      const query = typed.request.params.get('query') ?? '';
      expect(query).toMatch(
        /\(dc:creator = 'jdoe' OR dc:lastContributor = 'jdoe'\) AND ecm:primaryType IN \('Contract', 'Note'\) ORDER BY dc:modified DESC$/,
      );
      expect(typed.request.params.get('pageSize')).toBe('5');
      typed.flush(list());

      // The control: no types, and an empty list, ask for every type, as before.
      for (const types of [undefined, []]) {
        service.getRecentlyViewed('jdoe', 5, types).subscribe();
        const any = expectNxql();
        expect(any.request.params.get('query')).not.toContain('ecm:primaryType IN');
        any.flush(list());
      }
    });

    it('puts the types before the order whatever the user id reads, " ORDER BY " included', () => {
      service.getRecentlyViewed('jo ORDER BY x', 5, ['Contract']).subscribe();
      const request = expectNxql();
      expect(request.request.params.get('query')).toContain(
        "(dc:creator = 'jo ORDER BY x' OR dc:lastContributor = 'jo ORDER BY x') AND ecm:primaryType IN ('Contract') ORDER BY dc:modified DESC",
      );
      request.flush(list());
    });

    it('escapes a type as it escapes the user, and puts it in as written', () => {
      service.getRecentlyViewed('jdoe', 5, ["x') OR ('1", 'a$&b']).subscribe();
      const request = expectNxql();
      expect(request.request.params.get('query')).toContain(
        "ecm:primaryType IN ('x\\') OR (\\'1', 'a$&b') ORDER BY",
      );
      request.flush(list());
    });
  });

  describe('expired documents', () => {
    it('finds documents whose expiry is before now, as an NXQL timestamp in UTC', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-24T09:05:07.123Z'));

      service.getExpiredDocuments().subscribe();

      const request = expectNxql();
      const query = request.request.params.get('query') ?? '';
      expect(query).toContain("dc:expired < TIMESTAMP '2026-11-24 09:05:07'");
      expect(query).toMatch(/ORDER BY dc:expired DESC$/);
      expect(request.request.params.get('pageSize')).toBe('20');
      request.flush(list());
    });

    it('reads the clock on each call, so a drawer left open does not keep an old “now”', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-24T09:00:00.000Z'));
      service.getExpiredDocuments(5).subscribe();
      expectNxql().flush(list());

      vi.setSystemTime(new Date('2026-11-25T10:30:00.000Z'));
      service.getExpiredDocuments(5).subscribe();

      const later = expectNxql();
      expect(later.request.params.get('query')).toContain("TIMESTAMP '2026-11-25 10:30:00'");
      later.flush(list());
    });
  });

  describe('by id', () => {
    it('reads the document at /id/{uid}', () => {
      let doc: NuxeoDocument | undefined;
      service.getById('doc-1').subscribe((d) => (doc = d));

      const request = http.expectOne('/nuxeo/api/v1/id/doc-1');
      expect(request.request.method).toBe('GET');
      request.flush({ uid: 'doc-1', title: 'Contract', type: 'File' });

      expect(doc?.title).toBe('Contract');
    });

    it('passes a missing document’s 404 to the caller', () => {
      let status: number | undefined;
      service.getById('gone').subscribe({ error: (e) => (status = e.status) });

      http.expectOne('/nuxeo/api/v1/id/gone').flush('', { status: 404, statusText: 'Not Found' });

      expect(status).toBe(404);
    });
  });
});
