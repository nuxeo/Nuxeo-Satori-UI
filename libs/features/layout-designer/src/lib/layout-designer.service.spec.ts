import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DocumentLayoutService } from '@agentic-ui/shared/document-layouts';
import { ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import { DocumentDetailService, NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
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

  beforeEach(() => {
    detail = { getFullDocument: vi.fn() };
    previewRecords = vi.fn<(type: string, size: number) => Observable<readonly unknown[]>>();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: DocumentDetailService, useValue: detail },
        {
          provide: DocumentLayoutService,
          useValue: {
            recordLayoutTypes: () => of(['Member']),
            recordLayoutSource: () => of({ url: '/x', content: { version: 2 } }),
            previewRecordLayout: () => of({ refused: 'no', notes: [] }),
            previewRecords: (type: string, size: number) => previewRecords(type, size),
          },
        },
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

  it('knows the rules this build registers, as the record page does', () => {
    expect('acme.rules.isVip' in service.registries().rules).toBe(false);
    TestBed.inject(ExtensionRuleRegistry).registerRules({ 'acme.rules.isVip': () => true });
    expect('acme.rules.isVip' in service.registries().rules).toBe(true);
    expect(service.registries().widgets).toBeDefined();
  });
});
