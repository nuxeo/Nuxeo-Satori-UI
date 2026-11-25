/**
 * What the layout designer reads of the record page engine: the layout files served, a type's file
 * for a mode as it is served, and the page an unserved `view` file draws for a record. The forms'
 * preview is `form-layout/form-layout-preview.spec.ts`.
 */
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import { NUXEO_API_ORIGIN, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom } from 'rxjs';

import { DocumentLayoutService, PREVIEW_RECORDS_QUERY } from '../document-layout.service';

const FORMAT = 'nuxeo-agentic-ui-config/1';
const INDEX = '/nuxeo/agentic-ui-config/layouts.json';
const VIEW_FILE = '/nuxeo/agentic-ui-config/layouts/Claim/view.layout.json';
const CLAIM_TYPE = '/nuxeo/api/v1/config/types/Claim';

const CLAIM = {
  name: 'Claim',
  schemas: [
    { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
    { name: 'claim', '@prefix': 'claim', fields: { number: 'string', amount: 'double' } },
  ],
};

const VIEW = {
  version: 2,
  cards: [{ id: 'claim', label: 'Claim', fields: ['claim:number', 'claim:amount'] }],
};

const RECORD = {
  uid: 'c-1',
  type: 'Claim',
  title: 'Claim 1',
  path: '/claims/c-1',
  lastModified: '2026-11-24T09:00:00Z',
  properties: { 'claim:number': 'CLM-1', 'claim:amount': 12.5 },
} as NuxeoDocument;

describe('DocumentLayoutService: what the layout designer reads', () => {
  let http: HttpTestingController;
  let service: DocumentLayoutService;
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) =>
      warnings.push(String(message)),
    );
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/nuxeo/agentic-ui-config/bootstrap.json' },
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(DocumentLayoutService);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  describe('servedLayouts', () => {
    it('lists each type and mode the index serves a file for, once, in its order', async () => {
      const types = firstValueFrom(service.servedLayouts());
      http.expectOne(INDEX).flush({
        format: FORMAT,
        layer: 'layouts',
        layouts: [
          { type: 'Member', mode: 'view', component: 'a' },
          { type: 'Member', mode: 'metadata', component: 'a' },
          { type: 'Claim', mode: 'edit', component: 'a' },
          { type: 'Case', mode: 'view', component: 'a' },
          { type: 'Member', mode: 'view', component: 'b' },
        ],
        diagnostics: [],
      });
      expect(await types).toEqual([
        { type: 'Member', mode: 'view' },
        { type: 'Member', mode: 'metadata' },
        { type: 'Claim', mode: 'edit' },
        { type: 'Case', mode: 'view' },
      ]);
    });

    it('errors when the index cannot be read, or is not one, rather than listing none', async () => {
      const failed = firstValueFrom(service.servedLayouts());
      http.expectOne(INDEX).flush('', { status: 500, statusText: 'Server Error' });
      await expect(failed).rejects.toMatchObject({ status: 500 });

      const wrong = firstValueFrom(service.servedLayouts());
      http.expectOne(INDEX).flush({ format: 'other' });
      await expect(wrong).rejects.toThrow(/nuxeo-agentic-ui-config\/1/);
    });

    it('reads the index anew, so a failed read is not kept for the session', async () => {
      const failed = firstValueFrom(service.servedLayouts());
      http.expectOne(INDEX).flush('', { status: 503, statusText: 'Unavailable' });
      await expect(failed).rejects.toMatchObject({ status: 503 });
      const again = firstValueFrom(service.servedLayouts());
      http.expectOne(INDEX).flush({
        format: FORMAT,
        layer: 'layouts',
        layouts: [{ type: 'Member', mode: 'view', component: 'a' }],
        diagnostics: [],
      });
      expect(await again).toEqual([{ type: 'Member', mode: 'view' }]);
    });
  });

  describe('layoutSource', () => {
    const envelope = (content: unknown, mode = 'view') => ({
      format: FORMAT,
      layer: 'layout',
      type: 'Claim',
      mode,
      content,
    });

    it("gives the file's content as it is served, unread", async () => {
      const unknownKey = { ...VIEW, later: true };
      const source = firstValueFrom(service.layoutSource('Claim', 'view'));
      http.expectOne(VIEW_FILE).flush(envelope(unknownKey));
      expect(await source).toEqual({ url: VIEW_FILE, content: unknownKey });
    });

    it('reads it anew on every call, not from the record page cache', async () => {
      const first = firstValueFrom(service.layoutSource('Claim', 'view'));
      http.expectOne(VIEW_FILE).flush(envelope(VIEW));
      await first;
      const second = firstValueFrom(service.layoutSource('Claim', 'view'));
      http.expectOne(VIEW_FILE).flush(envelope({ ...VIEW, columns: 2 }));
      expect((await second).content?.['columns']).toBe(2);
    });

    it("reads a form's file at its own mode's address, and holds the envelope to that mode", async () => {
      const edit = { version: 2, cards: [{ id: 'claim', fields: ['claim:number'] }] };
      const EDIT_FILE = '/nuxeo/agentic-ui-config/layouts/Claim/edit.layout.json';
      const source = firstValueFrom(service.layoutSource('Claim', 'edit'));
      http.expectOne(EDIT_FILE).flush(envelope(edit, 'edit'));
      expect(await source).toEqual({ url: EDIT_FILE, content: edit });
      const wrong = firstValueFrom(service.layoutSource('Claim', 'edit'));
      http.expectOne(EDIT_FILE).flush(envelope(edit, 'view'));
      expect(await wrong).toEqual({ url: EDIT_FILE, problem: 'expected the Claim/edit layout' });
    });

    it('says why there is no file: an envelope for another mode, or a failed read', async () => {
      const wrong = firstValueFrom(service.layoutSource('Claim', 'view'));
      http.expectOne(VIEW_FILE).flush(envelope(VIEW, 'metadata'));
      expect(await wrong).toEqual({ url: VIEW_FILE, problem: 'expected the Claim/view layout' });

      const missing = firstValueFrom(service.layoutSource('Claim', 'view'));
      http.expectOne(VIEW_FILE).flush('', { status: 404, statusText: 'Not Found' });
      expect(await missing).toEqual({ url: VIEW_FILE, problem: 'HTTP 404' });
    });
  });

  describe('previewRecords', () => {
    const SEARCH = '/nuxeo/api/v1/search/lang/NXQL/execute';

    it('asks for the live records of the type, the type as a query parameter, never in the query', async () => {
      const read = firstValueFrom(service.previewRecords("Member' OR 1=1", 20));
      const request = http.expectOne((each) => each.url === SEARCH);
      expect(request.request.method).toBe('GET');
      expect(request.request.params.get('query')).toBe(PREVIEW_RECORDS_QUERY);
      expect(PREVIEW_RECORDS_QUERY).toContain('ecm:primaryType = ?');
      expect(PREVIEW_RECORDS_QUERY).not.toContain('Member');
      expect(request.request.params.getAll('queryParams')).toEqual(["Member' OR 1=1"]);
      expect(request.request.params.get('pageSize')).toBe('20');
      expect(request.request.headers.get('properties')).toBe('dublincore');
      request.flush({ entries: [{ uid: 'm1', title: 'Jane Doe' }, { title: 'no uid' }, 'x'] });
      expect(await read).toEqual([{ uid: 'm1', title: 'Jane Doe' }]);
    });

    it('errors when the search fails, for the caller to say why', async () => {
      const read = firstValueFrom(service.previewRecords('Member', 20));
      http.expectOne((each) => each.url === SEARCH).flush('', { status: 500, statusText: 'x' });
      await expect(read).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('previewRecordLayout', () => {
    it('draws the file for the record, resolved against its type, and tells the console nothing', async () => {
      const preview = firstValueFrom(service.previewRecordLayout(VIEW, RECORD));
      http.expectOne(CLAIM_TYPE).flush(CLAIM);
      const drawn = await preview;
      expect(drawn.notes).toEqual([]);
      expect(drawn.layout?.type).toBe('Claim');
      expect(
        drawn.layout?.cards[0].fields.map((field) => field.kind === 'property' && field.xpath),
      ).toEqual(['claim:number', 'claim:amount']);
      expect(warnings).toEqual([]);
    });

    it('draws each edit anew, reading the type once', async () => {
      const first = firstValueFrom(service.previewRecordLayout(VIEW, RECORD));
      http.expectOne(CLAIM_TYPE).flush(CLAIM);
      await first;
      const moved = {
        ...VIEW,
        cards: [{ ...VIEW.cards[0], fields: ['claim:amount', 'claim:number'] }],
      };
      const second = await firstValueFrom(service.previewRecordLayout(moved, RECORD));
      http.expectNone(CLAIM_TYPE);
      expect(
        second.layout?.cards[0].fields.map((field) => field.kind === 'property' && field.xpath),
      ).toEqual(['claim:amount', 'claim:number']);
    });

    it("refuses a file the record page refuses, with the record page's reason", async () => {
      const refused = await firstValueFrom(
        service.previewRecordLayout({ ...VIEW, cards: [{ id: 'a b', fields: [] }] }, RECORD),
      );
      expect(refused).toEqual({
        refused:
          'cards[0].id: an id is 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit',
        notes: [],
      });
      expect((await firstValueFrom(service.previewRecordLayout([], RECORD))).refused).toBe(
        'a layout file is a JSON object',
      );
      http.expectNone(CLAIM_TYPE);
    });

    it('gives what the page leaves out as notes, in the words the console would have', async () => {
      TestBed.inject(ExtensionRuleRegistry).registerRules({ 'app.rules.canWrite': () => true });
      const preview = firstValueFrom(
        service.previewRecordLayout(
          {
            version: 2,
            cards: [
              {
                id: 'claim',
                fields: [
                  'claim:number',
                  'claim:nope',
                  {
                    field: 'claim:amount',
                    visibleWhen: { type: 'app.rules.inGroup', parameters: ['x'] },
                  },
                ],
              },
            ],
          },
          RECORD,
        ),
      );
      http.expectOne(CLAIM_TYPE).flush(CLAIM);
      const drawn = await preview;
      expect(drawn.layout?.cards[0].fields).toHaveLength(1);
      expect(drawn.notes).toEqual([
        'Claim/view layout: cards[0].fields[2] names the rule "app.rules.inGroup", which this build does not register; left out',
        "Claim/view layout: cards[0].fields[1] left out: claim:nope is not on the Claim type or this document's facets",
      ]);
      expect(warnings).toEqual([]);
    });

    it("draws none when the type's schemas cannot be read, or for a record with a file", async () => {
      const unread = firstValueFrom(service.previewRecordLayout(VIEW, RECORD));
      http.expectOne(CLAIM_TYPE).flush('', { status: 500, statusText: 'Server Error' });
      expect((await unread).notDrawn).toBe('the schemas of Claim could not be read');

      const withFile = {
        ...CLAIM,
        schemas: [
          ...CLAIM.schemas,
          { name: 'file', '@prefix': 'file', fields: { content: 'blob' } },
        ],
      };
      const file = firstValueFrom(service.previewRecordLayout(VIEW, RECORD));
      http.expectOne(CLAIM_TYPE).flush(withFile);
      expect((await file).notDrawn).toBe(
        'a Claim with a file or a note keeps its own View tab, which shows it first',
      );
    });

    it("leaves the View tab's own reads alone: the served file is still read when a page asks", async () => {
      const preview = firstValueFrom(service.previewRecordLayout(VIEW, RECORD));
      http.expectOne(CLAIM_TYPE).flush(CLAIM);
      await preview;
      const served = firstValueFrom(service.recordLayoutFor('Claim'));
      http.expectOne(INDEX).flush({
        format: FORMAT,
        layer: 'layouts',
        layouts: [{ type: 'Claim', mode: 'view', component: 'a' }],
        diagnostics: [],
      });
      http
        .expectOne(VIEW_FILE)
        .flush({ format: FORMAT, layer: 'layout', type: 'Claim', mode: 'view', content: VIEW });
      expect((await served)?.cards[0].fields).toHaveLength(2);
    });
  });
});
