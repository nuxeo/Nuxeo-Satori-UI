import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import type { NuxeoContentModel } from '../models/content-model.model';
import { ContentModelService } from './content-model.service';

const TYPES = '/nuxeo/api/v1/config/types';
const FACETS = '/nuxeo/api/v1/config/facets';
const SCHEMAS = '/nuxeo/api/v1/config/schemas';

const types = { doctypes: { File: { parent: 'Document', facets: [], schemas: ['file'] } } };
const facets = [{ name: 'Folderish', schemas: [] }];
const schemas = [{ name: 'file', prefix: 'file', fields: {} }];

/** A JSON body as `TestRequest.flush` takes one: an object, an array, or `null`. */
type Body = object | null;

describe('ContentModelService', () => {
  let service: ContentModelService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    service = TestBed.inject(ContentModelService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const flushAll = (bodies: { types: Body; facets: Body; schemas: Body }) => {
    http.expectOne(TYPES).flush(bodies.types);
    http.expectOne(FACETS).flush(bodies.facets);
    http.expectOne(SCHEMAS).flush(bodies.schemas);
  };

  it('reads nothing until someone asks for the model', () => {
    http.expectNone(TYPES);
    http.expectNone(FACETS);
    http.expectNone(SCHEMAS);
  });

  it('reads types, facets and schemas from /config and answers with them as one model', () => {
    let model: NuxeoContentModel | undefined;
    service.getContentModel().subscribe((m) => (model = m));

    flushAll({ types, facets, schemas });

    expect(model).toEqual({ doctypes: types.doctypes, facets, schemas });
  });

  it('answers only once all three reads have arrived', () => {
    let model: NuxeoContentModel | undefined;
    service.getContentModel().subscribe((m) => (model = m));

    http.expectOne(TYPES).flush(types);
    http.expectOne(FACETS).flush(facets);
    expect(model).toBeUndefined();

    http.expectOne(SCHEMAS).flush(schemas);
    expect(model).toBeDefined();
  });

  it('reads the server once for the life of the app, however many panels open and close', () => {
    const first = service.getContentModel().subscribe();
    flushAll({ types, facets, schemas });
    first.unsubscribe();

    let again: NuxeoContentModel | undefined;
    service.getContentModel().subscribe((m) => (again = m));

    http.expectNone(TYPES);
    expect(again?.schemas).toEqual(schemas);
  });

  it('keeps the reads going when the panel that asked closes before they answer', () => {
    // Once the reads complete, `shareReplay` keeps the answer whatever `refCount` says. Only a
    // subscriber leaving mid-flight tells them apart: `refCount: true` would cancel the three
    // reads here, and the next panel would send three more.
    service.getContentModel().subscribe().unsubscribe();

    let model: NuxeoContentModel | undefined;
    service.getContentModel().subscribe((m) => (model = m));
    flushAll({ types, facets, schemas });

    expect(model?.facets).toEqual(facets);
  });

  it('reads empty bodies, as a locked-down server can answer, as an empty model', () => {
    let model: NuxeoContentModel | undefined;
    service.getContentModel().subscribe((m) => (model = m));

    flushAll({ types: null, facets: null, schemas: {} });

    expect(model).toEqual({ doctypes: {}, facets: [], schemas: [] });
  });

  it('reads a types body without doctypes as no document types', () => {
    let model: NuxeoContentModel | undefined;
    service.getContentModel().subscribe((m) => (model = m));

    flushAll({ types: {}, facets, schemas });

    expect(model?.doctypes).toEqual({});
  });

  it('passes a failed read to the caller, and does not keep the failure: the next ask reads again', () => {
    let status: number | undefined;
    service.getContentModel().subscribe({ error: (e) => (status = e.status) });

    http.expectOne(TYPES).flush('down', { status: 503, statusText: 'Unavailable' });
    // forkJoin cancels the other two reads once one fails.
    expect(http.expectOne(FACETS).cancelled).toBe(true);
    expect(http.expectOne(SCHEMAS).cancelled).toBe(true);
    expect(status).toBe(503);

    let model: NuxeoContentModel | undefined;
    service.getContentModel().subscribe((m) => (model = m));
    flushAll({ types, facets, schemas });

    expect(model?.doctypes).toEqual(types.doctypes);
  });
});
