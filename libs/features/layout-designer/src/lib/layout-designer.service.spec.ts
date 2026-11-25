import { HttpErrorResponse, provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DocumentLayoutService } from '@agentic-ui/shared/document-layouts';
import { APP_DEFINITION_FILES } from '@agentic-ui/shared/app-registry';
import { HomeService, type HomeLoad } from '@agentic-ui/shared/home';
import { QueueService, type QueueLoad } from '@agentic-ui/shared/queues';
import { ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import {
  DocumentDetailService,
  NUXEO_API_ORIGIN,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { lastValueFrom, of, throwError, toArray, type Observable } from 'rxjs';
import type { Mock } from 'vitest';

import { LayoutDesignerService, RECORDS_OFFERED, type Reading } from './layout-designer.service';

/** The content model as `ContentModelService` reads it: one type with one schema. */
const MODEL = {
  types: { doctypes: { Member: { parent: 'Document', facets: [], schemas: ['member'] } } },
  facets: [],
  schemas: [{ name: 'member', '@prefix': 'member', fields: { phone: 'string' } }],
};

describe('LayoutDesignerService', () => {
  let http: HttpTestingController;
  let service: LayoutDesignerService;
  let detail: { getFullDocument: ReturnType<typeof vi.fn> };
  let previewRecords: Mock<(type: string, size: number) => Observable<readonly unknown[]>>;
  let layouts: Record<string, Mock>;
  let navigation: Mock<() => Observable<HomeLoad>>;
  let queueLoad: Mock<(id: string) => Observable<QueueLoad>>;
  let definitionFile: Mock<(path: string, developmentUrl: string | null) => Observable<unknown>>;

  beforeEach(() => {
    definitionFile = vi.fn<(path: string, developmentUrl: string | null) => Observable<unknown>>();
    detail = { getFullDocument: vi.fn() };
    navigation = vi.fn<() => Observable<HomeLoad>>();
    queueLoad = vi.fn<(id: string) => Observable<QueueLoad>>();
    previewRecords = vi.fn<(type: string, size: number) => Observable<readonly unknown[]>>();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: DocumentDetailService, useValue: detail },
        {
          provide: DocumentLayoutService,
          useFactory: () => {
            layouts = {
              servedLayouts: vi.fn(() =>
                of([
                  { type: 'Member', mode: 'view' },
                  { type: 'Member', mode: 'metadata' },
                  { type: 'Contract', mode: 'edit' },
                  { type: 'Contract', mode: 'create' },
                ]),
              ),
              layoutSource: vi.fn(() => of({ url: '/x', content: { version: 2 } })),
              previewRecordLayout: vi.fn(() => of({ refused: 'no', notes: [] })),
              previewFormLayout: vi.fn(() => of({ refused: 'no', notes: [] })),
              previewRecords: vi.fn((type: string, size: number) => previewRecords(type, size)),
            };
            return layouts;
          },
        },
        { provide: HomeService, useValue: { loadNavigation: () => navigation() } },
        {
          provide: APP_DEFINITION_FILES,
          useValue: {
            file: (path: string, developmentUrl: string | null) =>
              definitionFile(path, developmentUrl),
            labelLanguages: () => of([]),
          },
        },
        { provide: QueueService, useValue: { load: (id: string) => queueLoad(id) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(LayoutDesignerService);
  });

  // A model read that fails cancels its other two reads, which are left behind as cancelled.
  afterEach(() => http.verify({ ignoreCancelled: true }));

  /** Every value a reading gives, `reading` first. */
  const all = <T>(source: Observable<Reading<T>>): Promise<Reading<T>[]> =>
    lastValueFrom(source.pipe(toArray()));

  describe('records', () => {
    it("asks the record page engine for the type's last changed records, each by its title", async () => {
      previewRecords.mockReturnValueOnce(
        of([
          { uid: 'm1', title: 'Jane Doe', path: '/payers-demo/m1' },
          { uid: 'm2', title: '', path: '/payers-demo/m2' },
        ]),
      );
      expect(await all(service.records('Member'))).toEqual([
        { state: 'reading' },
        {
          state: 'read',
          value: [
            { uid: 'm1', title: 'Jane Doe', path: '/payers-demo/m1' },
            { uid: 'm2', title: 'm2', path: '/payers-demo/m2' },
          ],
        },
      ]);
      expect(previewRecords).toHaveBeenCalledWith('Member', RECORDS_OFFERED);
    });

    it('says why they could not be read', async () => {
      previewRecords.mockReturnValueOnce(throwError(() => ({ status: 500 })));
      expect((await all(service.records('Member'))).at(-1)).toEqual({
        state: 'failed',
        problem: 'HTTP 500',
      });
    });
  });

  describe('record', () => {
    it('reads the record as the document page does, and says why it could not', async () => {
      detail.getFullDocument.mockReturnValueOnce(of({ uid: 'm1' }));
      expect((await all(service.record('m1'))).at(-1)).toEqual({
        state: 'read',
        value: { uid: 'm1' },
      });
      expect(detail.getFullDocument).toHaveBeenCalledWith('m1');
      detail.getFullDocument.mockReturnValueOnce(throwError(() => ({ status: 403 })));
      expect((await all(service.record('m1'))).at(-1)).toEqual({
        state: 'failed',
        problem: 'HTTP 403',
      });
    });
  });

  describe('model', () => {
    const answer = (types: object, facets: object, schemas: object): void => {
      http.expectOne('/nuxeo/api/v1/config/types').flush(types);
      http.expectOne('/nuxeo/api/v1/config/facets').flush(facets);
      http.expectOne('/nuxeo/api/v1/config/schemas').flush(schemas);
    };

    it("reads the server's content model with the app definition's model reader", async () => {
      const read = all(service.model());
      answer(MODEL.types, MODEL.facets, MODEL.schemas);
      const values = await read;
      expect(values[0]).toEqual({ state: 'reading' });
      const last = values.at(-1);
      expect(last?.state).toBe('read');
      expect(last?.state === 'read' && [...last.value.types.keys()]).toEqual(['Member']);
    });

    it('refuses a model it cannot read whole, with its first problem', async () => {
      const read = all(service.model());
      answer(MODEL.types, MODEL.facets, [{ name: 'member', '@prefix': 3, fields: {} }]);
      expect((await read).at(-1)).toEqual({
        state: 'failed',
        problem: "schemas[0].@prefix: must be the schema's prefix, a text (and 1 more)",
      });
    });

    it('says why the model could not be read', async () => {
      const read = all(service.model());
      http.expectOne('/nuxeo/api/v1/config/types').flush('', { status: 401, statusText: 'x' });
      expect((await read).at(-1)).toEqual({ state: 'failed', problem: 'HTTP 401' });
    });
  });

  describe('the layout files', () => {
    it('lists the record pages and the edit and create forms the server serves, no other mode', async () => {
      expect((await all(service.files())).at(-1)).toEqual({
        state: 'read',
        value: [
          { type: 'Member', mode: 'view' },
          { type: 'Contract', mode: 'edit' },
          { type: 'Contract', mode: 'create' },
        ],
      });
    });

    it("reads a type's file for its mode, as it is served now", async () => {
      expect((await all(service.source('Contract', 'edit'))).at(-1)).toEqual({
        state: 'read',
        value: { url: '/x', content: { version: 2 } },
      });
      expect(layouts['layoutSource']).toHaveBeenCalledWith('Contract', 'edit');
    });

    it('previews a form for the record it edits, through the form engine', () => {
      const record = { uid: 'c1', type: 'Contract' } as NuxeoDocument;
      service.previewForm({ version: 2 }, 'edit', 'Contract', record);
      expect(layouts['previewFormLayout']).toHaveBeenCalledWith(
        { version: 2 },
        'edit',
        'Contract',
        record,
      );
    });
  });

  describe('the queues', () => {
    it("offers the queues the app's menu opens, each once, and no id that cannot name one", async () => {
      navigation.mockReturnValueOnce(
        of({
          kind: 'file',
          content: {
            version: 2,
            entries: [
              { id: 'home', page: 'home' },
              { id: 'renewals', queue: 'up-for-renewal' },
              { id: 'again', queue: 'up-for-renewal' },
              { id: 'odd', queue: '../etc' },
            ],
          },
        }),
      );
      expect(await all(service.queueIds())).toEqual([
        { state: 'reading' },
        { state: 'read', value: ['up-for-renewal'] },
      ]);
    });

    it('offers none without a menu, and says why one could not be read', async () => {
      navigation.mockReturnValueOnce(of({ kind: 'none' }));
      expect((await all(service.queueIds())).at(-1)).toEqual({ state: 'read', value: [] });
      navigation.mockReturnValueOnce(of({ kind: 'unreadable', reason: 'HTTP 500' }));
      expect((await all(service.queueIds())).at(-1)).toEqual({
        state: 'failed',
        problem: 'HTTP 500',
      });
    });

    it("reads a queue's file as the queue page does, and says why it could not", async () => {
      queueLoad.mockReturnValueOnce(of({ kind: 'file', content: { version: 2 } }));
      expect((await all(service.queueSource('up-for-renewal'))).at(-1)).toEqual({
        state: 'read',
        value: { version: 2 },
      });
      expect(queueLoad).toHaveBeenCalledWith('up-for-renewal');
      queueLoad.mockReturnValueOnce(of({ kind: 'none' }));
      expect((await all(service.queueSource('nope'))).at(-1)).toEqual({
        state: 'failed',
        problem: 'no queue is served there',
      });
      queueLoad.mockReturnValueOnce(of({ kind: 'unreadable', reason: 'it is not JSON' }));
      expect((await all(service.queueSource('bad'))).at(-1)).toEqual({
        state: 'failed',
        problem: 'it is not JSON',
      });
    });
  });

  describe("the app's own actions", () => {
    it('reads actions.json from the app registry alone: the development server serves none', async () => {
      definitionFile.mockReturnValueOnce(of({ version: 2, actions: [] }));
      expect((await all(service.packageActions())).at(-1)).toEqual({
        state: 'read',
        value: { version: 2, actions: [] },
      });
      expect(definitionFile).toHaveBeenCalledWith('actions.json', null);
    });

    it('reads none where nothing serves it, and says why one could not be read', async () => {
      definitionFile.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })),
      );
      expect((await all(service.packageActions())).at(-1)).toEqual({ state: 'read', value: null });
      definitionFile.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
      );
      expect((await all(service.packageActions())).at(-1)).toEqual({
        state: 'failed',
        problem: 'HTTP 500',
      });
    });
  });

  it('knows the rules this build registers, as the record page does', () => {
    expect('acme.rules.isVip' in service.registries().rules).toBe(false);
    TestBed.inject(ExtensionRuleRegistry).registerRules({ 'acme.rules.isVip': () => true });
    expect('acme.rules.isVip' in service.registries().rules).toBe(true);
    expect(service.registries().widgets).toBeDefined();
  });
});
