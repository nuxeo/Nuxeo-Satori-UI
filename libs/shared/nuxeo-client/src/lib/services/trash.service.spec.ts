import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { TrashService } from './trash.service';

/**
 * The query these tests assert is the one Nuxeo parses, so the expectations were
 * checked against a live server rather than derived from the grammar:
 *
 * - `dc:title = 'O\'Brien'` → HTTP 200
 * - `dc:title = 'O''Brien'` → HTTP 400, `Invalid token <Brien> at offset 49`
 *
 * The injection payload below returned 193 documents against the same server while
 * the un-injected term returned 0, defeating the `ecm:isTrashed = 1` filter the
 * clause list opens with.
 */
describe('TrashService', () => {
  let service: TrashService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });

    service = TestBed.inject(TrashService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushSearch(): string {
    const req = httpMock.expectOne((r) => r.url.endsWith('/nuxeo/api/v1/search/lang/NXQL/execute'));
    const query = req.request.params.get('query') ?? '';
    req.flush({ entries: [], totalSize: 0 });
    return query;
  }

  describe('searchTrash escapes every user-supplied literal', () => {
    it('escapes an apostrophe in the full-text term', () => {
      service.searchTrash({ fullText: "O'Brien" }).subscribe();

      expect(flushSearch()).toContain(String.raw`ecm:fulltext = 'O\'Brien'`);
    });

    it('keeps an injected clause inside the literal instead of lifting it to top level', () => {
      service
        .searchTrash({ fullText: "zzznope' OR ecm:uuid IS NOT NULL OR dc:title = 'q" })
        .subscribe();

      const query = flushSearch();

      expect(query).toContain(
        String.raw`ecm:fulltext = 'zzznope\' OR ecm:uuid IS NOT NULL OR dc:title = \'q'`,
      );
      // The hygiene filter the payload exists to escape is still the only top-level
      // condition alongside the mixin filter and the term.
      expect(query).toBe(
        String.raw`SELECT * FROM Document WHERE ecm:isTrashed = 1 AND ecm:mixinType != 'HiddenInNavigation' AND ecm:fulltext = 'zzznope\' OR ecm:uuid IS NOT NULL OR dc:title = \'q' ORDER BY dc:created DESC`,
      );
    });

    it('escapes a backslash before the quote it would otherwise re-open', () => {
      service.searchTrash({ fullText: String.raw`c:\temp\' OR 1 = 1 OR '` }).subscribe();

      expect(flushSearch()).toContain(String.raw`ecm:fulltext = 'c:\\temp\\\' OR 1 = 1 OR \''`);
    });

    it('escapes the path filter', () => {
      service.searchTrash({ path: "/ws/o'brien" }).subscribe();

      expect(flushSearch()).toContain(String.raw`ecm:path STARTSWITH '/ws/o\'brien'`);
    });

    it('escapes the author filter', () => {
      service.searchTrash({ author: "o'brien" }).subscribe();

      expect(flushSearch()).toContain(String.raw`dc:creator = 'o\'brien'`);
    });

    it('leaves a term with nothing to escape unchanged', () => {
      service.searchTrash({ fullText: 'quarterly report' }).subscribe();

      expect(flushSearch()).toContain("ecm:fulltext = 'quarterly report'");
    });
  });

  it('getPathSuggestions escapes the parent path', () => {
    service.getPathSuggestions("/ws/o'brien/").subscribe();

    expect(flushSearch()).toContain(String.raw`ecm:path STARTSWITH '/ws/o\'brien'`);
  });
});
