import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { ResolvedLayout } from '../layout.model';
import type { ResolvedFormLayout } from './resolve-form-layout';

const FORMAT = 'nuxeo-agentic-ui-config/1';
const INDEX = '/nuxeo/agentic-ui-config/layouts.json';
const FILE = (mode: string) => `/nuxeo/agentic-ui-config/layouts/Claim/${mode}.layout.json`;
const CLAIM_TYPE = '/nuxeo/api/v1/config/types/Claim';

const CLAIM = {
  name: 'Claim',
  schemas: [
    { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
    { name: 'claim', '@prefix': 'claim', fields: { number: 'string', amount: 'double' } },
  ],
};

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

const EDIT = {
  version: 2,
  cards: [
    {
      id: 'claim',
      label: 'Claim',
      fields: [
        'claim:number',
        {
          field: 'claim:amount',
          widget: 'currency',
          parameters: { currency: 'USD' },
          required: true,
        },
      ],
    },
  ],
};

describe('DocumentLayoutService: forms of version 2', () => {
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
    TestBed.inject(ExtensionRuleRegistry).registerRules({ 'app.rules.canWrite': () => true });
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  /** The form of `mode`, its index, file and type answered in the order the service asks. */
  async function form(
    mode: 'edit' | 'create',
    content: unknown,
  ): Promise<ResolvedLayout | ResolvedFormLayout | null> {
    const layout = firstValueFrom(service.formLayoutFor('Claim', mode));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    http.expectOne(INDEX).flush(index(`Claim/${mode}`));
    http.expectOne(FILE(mode)).flush(envelope(content, mode));
    return layout;
  }

  it('reads an edit file of version 2 and resolves it against the type', async () => {
    const layout = (await form('edit', EDIT)) as ResolvedFormLayout;
    expect(warnings).toEqual([]);
    expect(layout).toMatchObject({ version: 2, kind: 'edit', type: 'Claim', tabs: null });
    expect(
      layout.cards[0]?.fields.map(
        (field) =>
          field.kind === 'property' && [field.xpath, field.definition.type, field.required],
      ),
    ).toEqual([
      ['claim:number', 'string', false],
      ['claim:amount', 'double', true],
    ]);
  });

  it('reads a create file of version 2 the same way', async () => {
    const layout = (await form('create', EDIT)) as ResolvedFormLayout;
    expect(layout).toMatchObject({ version: 2, kind: 'create' });
  });

  it('still reads a version 1 file, as before', async () => {
    const layout = (await form('edit', {
      version: 1,
      sections: [{ id: 'a', fields: ['claim:number'] }],
    })) as ResolvedLayout;
    expect(layout.source).toBe('contributed');
    expect(layout.sections[0]?.fields.map((field) => field.xpath)).toEqual(['claim:number']);
  });

  it('refuses a version 2 file with a structural error, shows the generated form, and says why', async () => {
    const layout = (await form('edit', { version: 2, columns: 2, cards: [] })) as ResolvedLayout;
    expect(layout.source).toBe('generated');
    expect(warnings).toEqual([
      `[agentic-ui-layouts] Claim/edit layout from ${FILE('edit')} refused, showing the generated form: columns: columns belongs in view mode only`,
    ]);
  });

  it('leaves out what it cannot draw and says so: a field the type lacks, a rule nobody registered', async () => {
    const layout = (await form('edit', {
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            'claim:number',
            'claim:nope',
            { field: 'claim:amount', required: { type: 'app.rules.inGroup', parameters: ['x'] } },
          ],
        },
      ],
    })) as ResolvedFormLayout;
    expect(layout.cards[0]?.fields).toHaveLength(1);
    expect(warnings).toEqual([
      '[agentic-ui-layouts] Claim/edit layout: cards[0].fields[2] names the rule "app.rules.inGroup", which this build does not register; left out',
      "[agentic-ui-layouts] Claim/edit layout: cards[0].fields[1] left out: claim:nope is not on the Claim type or this document's facets",
    ]);
  });

  it('says which widgets it edits through their property’s type, once per field', async () => {
    await form('edit', {
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            { field: 'claim:number', widget: 'user' },
            { field: 'claim:number', widget: 'text' },
            // Never edited, so its widget is only ever shown: nothing to say.
            {
              id: 'owner',
              widget: 'user',
              computed: { type: 'core.template', parameters: ['{claim:number}'] },
            },
          ],
        },
      ],
    });
    expect(warnings).toEqual([
      `[agentic-ui-layouts] Claim/edit layout: cards[0].fields[0]: the widget "user" is edited as the stored id, as the property's type edits it in this build`,
    ]);
  });

  it('still refuses a metadata file of version 2, and the generated panel shows', async () => {
    const layout = firstValueFrom(service.layoutFor('Claim', 'metadata'));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    http.expectOne(INDEX).flush(index('Claim/metadata'));
    http.expectOne(FILE('metadata')).flush(envelope(EDIT, 'metadata'));
    expect((await layout)?.source).toBe('generated');
    expect(warnings).toEqual([
      `[agentic-ui-layouts] Claim/metadata layout from ${FILE('metadata')} refused, showing the generated layout: version must be 1, got 2`,
    ]);
  });

  it('hands layoutFor no version 2 file, which only formLayoutFor draws', async () => {
    const layout = firstValueFrom(service.layoutFor('Claim', 'edit'));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    http.expectOne(INDEX).flush(index('Claim/edit'));
    http.expectOne(FILE('edit')).flush(envelope(EDIT, 'edit'));
    expect((await layout)?.source).toBe('generated');
  });
});
