/**
 * What the layout designer reads of the form engine: the form an unserved `edit` or `create` file
 * draws, read and resolved as a served one is, and what the console would be told of it, which it
 * is not told.
 */
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import { NUXEO_API_ORIGIN, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';

const INDEX = '/nuxeo/agentic-ui-config/layouts.json';
const CONTRACT_TYPE = '/nuxeo/api/v1/config/types/Contract';
const RISK_SCHEMA = '/nuxeo/api/v1/config/schemas/risk';

const CONTRACT = {
  name: 'Contract',
  schemas: [
    { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
    {
      name: 'contract',
      '@prefix': 'contract',
      fields: { number: 'string', status: 'string', terminationReason: 'string' },
    },
  ],
};

const EDIT = {
  version: 2,
  cards: [
    {
      id: 'contract',
      fields: [
        { field: 'contract:number', required: true },
        'contract:status',
        {
          field: 'contract:terminationReason',
          widget: 'long-text',
          required: {
            type: 'app.rules.fieldIn',
            parameters: [{ field: 'contract:status' }, 'Terminated'],
          },
        },
      ],
    },
  ],
};

/** A contract whose own read reports a facet's schema, `risk`, which its type does not have. */
const RECORD = Object.assign(
  {
    uid: 'k1',
    type: 'Contract',
    title: 'Master services agreement',
    path: '/contracts/k1',
    lastModified: '2026-11-24T09:00:00Z',
    properties: { 'contract:number': 'CTR-1', 'risk:level': 'high' },
  },
  { schemas: [{ name: 'risk', prefix: 'risk' }] },
) as NuxeoDocument;

const xpaths = (layout: { cards: readonly { fields: readonly unknown[] }[] } | undefined) =>
  layout?.cards.flatMap((card) =>
    card.fields.map((field) => (field as { xpath?: string; id?: string }).xpath ?? null),
  );

describe('DocumentLayoutService: the form the layout designer previews', () => {
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
    TestBed.inject(ExtensionRuleRegistry).registerRules({ 'app.rules.fieldIn': () => true });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(DocumentLayoutService);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('draws an edit file for the record, resolved against its type, and tells the console nothing', async () => {
    const preview = firstValueFrom(service.previewFormLayout(EDIT, 'edit', 'Contract', RECORD));
    http.expectOne(CONTRACT_TYPE).flush(CONTRACT);
    const drawn = await preview;
    expect(drawn.notes).toEqual([]);
    expect(drawn.layout?.kind).toBe('edit');
    expect(xpaths(drawn.layout)).toEqual([
      'contract:number',
      'contract:status',
      'contract:terminationReason',
    ]);
    const [, , reason] = drawn.layout?.cards[0].fields ?? [];
    expect((reason as { required?: unknown }).required).toEqual({
      type: 'app.rules.fieldIn',
      parameters: [{ field: 'contract:status' }, 'Terminated'],
    });
    // Neither the index nor the served file is read: the preview draws the file it is given.
    http.expectNone(INDEX);
    expect(warnings).toEqual([]);
  });

  it("holds an edit to the record's own facet schemas, and a create to its type alone", async () => {
    const withRisk = { ...EDIT, cards: [{ id: 'risk', fields: ['risk:level'] }] };
    const edit = firstValueFrom(service.previewFormLayout(withRisk, 'edit', 'Contract', RECORD));
    http.expectOne(CONTRACT_TYPE).flush(CONTRACT);
    http
      .expectOne(RISK_SCHEMA)
      .flush({ name: 'risk', '@prefix': 'risk', fields: { level: 'string' } });
    expect(xpaths((await edit).layout)).toEqual(['risk:level']);

    // A create is for a record that does not exist yet: the chosen record's facets are not its.
    const create = await firstValueFrom(
      service.previewFormLayout(withRisk, 'create', 'Contract', RECORD),
    );
    http.expectNone(RISK_SCHEMA);
    expect(create.layout?.kind).toBe('create');
    expect(create.layout?.cards).toEqual([]);
    expect(create.notes).toEqual([
      "Contract/create layout: cards[0].fields[0] left out: risk:level is not on the Contract type or this document's facets",
    ]);
    expect(warnings).toEqual([]);
  });

  it('gives what the form leaves out as notes, in the words the console would have', async () => {
    const preview = firstValueFrom(
      service.previewFormLayout(
        {
          version: 2,
          cards: [
            {
              id: 'contract',
              fields: [
                'contract:number',
                { field: 'contract:status', widget: 'user' },
                {
                  field: 'contract:status',
                  visibleWhen: { type: 'app.rules.inGroup', parameters: ['legal-reviewers'] },
                },
                'contract:nope',
              ],
            },
          ],
        },
        'edit',
        'Contract',
        RECORD,
      ),
    );
    http.expectOne(CONTRACT_TYPE).flush(CONTRACT);
    const drawn = await preview;
    expect(drawn.notes).toEqual([
      'Contract/edit layout: cards[0].fields[2] names the rule "app.rules.inGroup", which this build does not register; left out',
      'Contract/edit layout: cards[0].fields[1]: the widget "user" is edited as the stored id, as the property\'s type edits it in this build',
      "Contract/edit layout: cards[0].fields[3] left out: contract:nope is not on the Contract type or this document's facets",
    ]);
    expect(warnings).toEqual([]);
  });

  it("refuses a file the form refuses, with the form's reason, and reads nothing", async () => {
    const refused = await firstValueFrom(
      service.previewFormLayout(
        { ...EDIT, cards: [{ id: 'contract', fields: [{ field: 'dc:title', required: '' }] }] },
        'edit',
        'Contract',
        RECORD,
      ),
    );
    expect(refused.refused).toContain('cards[0].fields[0].required');
    expect(refused.notes).toEqual([]);
    expect((await firstValueFrom(service.previewFormLayout('x', 'edit', 'Contract'))).refused).toBe(
      'a layout file is a JSON object',
    );
    http.expectNone(CONTRACT_TYPE);
  });

  it("draws none when the type's schemas cannot be read", async () => {
    const preview = firstValueFrom(service.previewFormLayout(EDIT, 'create', 'Contract'));
    http.expectOne(CONTRACT_TYPE).flush('', { status: 500, statusText: 'Server Error' });
    expect((await preview).notDrawn).toBe('the schemas of Contract could not be read');
  });
});
