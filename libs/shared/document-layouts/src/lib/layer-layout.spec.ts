import { HttpErrorResponse, provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_DEFINITION_FILES, type AppDefinitionFiles } from '@agentic-ui/shared/app-registry';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom, of, throwError } from 'rxjs';

import { DocumentLayoutService } from './document-layout.service';
import type { ResolvedFormLayout } from './form-layout/resolve-form-layout';

const FORMAT = 'nuxeo-agentic-ui-config/1';
const INDEX = '/nuxeo/agentic-ui-config/layouts.json';
const FILE = (mode: string) => `/nuxeo/agentic-ui-config/layouts/Claim/${mode}.layout.json`;
const CLAIM_TYPE = '/nuxeo/api/v1/config/types/Claim';

const CLAIM = {
  name: 'Claim',
  schemas: [
    { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
    { name: 'claim', '@prefix': 'claim', fields: { number: 'string', status: 'string' } },
  ],
};

const view = (heading: string) => ({
  version: 2,
  cards: [{ id: 'claim', label: heading, fields: ['claim:number'] }],
});

const edit = (heading: string) => ({
  version: 2,
  cards: [{ id: 'claim', label: heading, fields: ['claim:status'] }],
});

const index = (...keys: string[]) => ({
  format: FORMAT,
  layer: 'layouts',
  layouts: keys.map((key) => {
    const [type, mode] = key.split('/');
    return { type, mode, component: 'org.acme.config' };
  }),
  diagnostics: [],
});

const envelope = (content: unknown, mode: string) => ({
  format: FORMAT,
  layer: 'layout',
  type: 'Claim',
  mode,
  content,
});

/**
 * The deployment layer's layouts on the record page and the forms: the app open's own version of a
 * type's file, which the app registry serves after sign-in to the app's groups, wins over the one
 * the packages contribute, which the configuration servlet serves to everyone; with none, or one
 * that cannot be read, the packages' shows, as before the layer.
 */
describe('DocumentLayoutService: the deployment layer', () => {
  let http: HttpTestingController;
  let layer: Record<string, unknown>;
  let asked: string[];
  let warnings: string[];

  beforeEach(() => {
    layer = {};
    asked = [];
    warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) =>
      warnings.push(String(message)),
    );
    const files: AppDefinitionFiles = {
      file: (path: string, developmentUrl: string | null) => {
        asked.push(`${path} ${developmentUrl}`);
        const content = layer[path];
        if (content instanceof HttpErrorResponse) return throwError(() => content);
        return content === undefined
          ? throwError(() => new HttpErrorResponse({ status: 404, url: path }))
          : of(content);
      },
      labelLanguages: () => of([]),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/nuxeo/agentic-ui-config/bootstrap.json' },
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: APP_DEFINITION_FILES, useValue: files },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  const service = (): DocumentLayoutService => TestBed.inject(DocumentLayoutService);

  it("draws the app's own record page in place of the package's, and reads no package file", async () => {
    layer['layouts/Claim/view.layout.json'] = view('From the layer');
    const layout = firstValueFrom(service().recordLayoutFor('Claim'));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    const resolved = await layout;
    expect(resolved?.cards[0].label.literal).toBe('From the layer');
    expect(asked).toEqual(['layouts/Claim/view.layout.json null']);
    http.expectNone(INDEX);
    http.expectNone(FILE('view'));
    expect(warnings).toEqual([]);
  });

  it("draws the package's record page when the app has none, as before the layer", async () => {
    const layout = firstValueFrom(service().recordLayoutFor('Claim'));
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(FILE('view')).flush(envelope(view('From the package'), 'view'));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    expect((await layout)?.cards[0].label.literal).toBe('From the package');
    expect(warnings).toEqual([]);
  });

  it("draws the package's record page, and says why, when the app's cannot be read", async () => {
    layer['layouts/Claim/view.layout.json'] = new HttpErrorResponse({ status: 500, url: 'x' });
    const layout = firstValueFrom(service().recordLayoutFor('Claim'));
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(FILE('view')).flush(envelope(view('From the package'), 'view'));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    expect((await layout)?.cards[0].label.literal).toBe('From the package');
    expect(warnings.join('\n')).toContain("not loaded from the app's deployment layer");
  });

  it("holds the app's record page to the same reading as a package's: one it refuses is not drawn", async () => {
    layer['layouts/Claim/view.layout.json'] = { version: 1, sections: [] };
    expect(await firstValueFrom(service().recordLayoutFor('Claim'))).toBeNull();
    expect(warnings.join('\n')).toContain('refused, showing the document page');
  });

  it("draws the app's own edit and create forms in place of the package's", async () => {
    layer['layouts/Claim/edit.layout.json'] = edit('Edit from the layer');
    layer['layouts/Claim/create.layout.json'] = edit('Create from the layer');
    const editing = firstValueFrom(service().formLayoutFor('Claim', 'edit'));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    const creating = firstValueFrom(service().formLayoutFor('Claim', 'create'));
    expect(((await editing) as ResolvedFormLayout).cards[0].label.literal).toBe(
      'Edit from the layer',
    );
    expect(((await creating) as ResolvedFormLayout).cards[0].label.literal).toBe(
      'Create from the layer',
    );
    http.expectNone(INDEX);
  });

  it('never asks the layer for a metadata file, which no layer holds', async () => {
    const layout = firstValueFrom(service().layoutFor('Claim', 'metadata'));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    http.expectOne(INDEX).flush(index());
    await layout;
    expect(asked).toEqual([]);
  });
});
