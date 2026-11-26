import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { DOCUMENT_RULE_EVALUATORS, ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom } from 'rxjs';

import { DocumentLayoutService, principalName } from '../document-layout.service';
import type { ResolvedRecordLayout } from './resolve-record-layout';

const FORMAT = 'nuxeo-agentic-ui-config/1';
const INDEX = '/nuxeo/agentic-ui-config/layouts.json';
const VIEW_FILE = '/nuxeo/agentic-ui-config/layouts/Claim/view.layout.json';
const CLAIM_TYPE = '/nuxeo/api/v1/config/types/Claim';

const CLAIM = {
  name: 'Claim',
  schemas: [
    { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
    {
      name: 'claim',
      '@prefix': 'claim',
      fields: { number: 'string', amount: 'double', serviceDate: 'date' },
    },
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

const envelope = (content: unknown, mode = 'view') => ({
  format: FORMAT,
  layer: 'layout',
  type: 'Claim',
  mode,
  content,
});

const VIEW = {
  version: 2,
  columns: 2,
  cards: [
    {
      id: 'claim',
      label: 'Claim',
      fields: [
        'claim:number',
        { field: 'claim:amount', widget: 'currency', parameters: { currency: 'USD' } },
      ],
    },
  ],
};

describe('DocumentLayoutService: record pages', () => {
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

  const recordLayout = (): Promise<ResolvedRecordLayout | null> =>
    firstValueFrom(service.recordLayoutFor('Claim'));

  /** Index, file and type answered in the order the service asks. */
  async function answer(content: unknown): Promise<ResolvedRecordLayout | null> {
    const layout = recordLayout();
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(VIEW_FILE).flush(envelope(content));
    const type = http.match(CLAIM_TYPE);
    type.forEach((request) => request.flush(CLAIM));
    return layout;
  }

  it('is null for a type with no view file, without reading the type', async () => {
    const layout = recordLayout();
    http.expectOne(INDEX).flush(index('Claim/metadata'));
    expect(await layout).toBeNull();
    http.expectNone(CLAIM_TYPE);
    http.expectNone(VIEW_FILE);
  });

  it("resolves the type's view file against its schemas", async () => {
    const layout = await answer(VIEW);
    expect(warnings).toEqual([]);
    expect(layout?.type).toBe('Claim');
    expect(layout?.columns).toBe(2);
    expect(
      layout?.cards[0].fields.map(
        (field) => field.kind === 'property' && [field.xpath, field.definition.type],
      ),
    ).toEqual([
      ['claim:number', 'string'],
      ['claim:amount', 'double'],
    ]);
  });

  it('refuses a version 1 file, which has no view mode, and says so', async () => {
    expect(await answer({ version: 1, display: 'sections', sections: [] })).toBeNull();
    expect(warnings).toEqual([
      `[agentic-ui-layouts] Claim/view layout from ${VIEW_FILE} refused, showing the document page: version: version must be 2, not 1`,
    ]);
  });

  it('ignores an envelope for another mode', async () => {
    const layout = recordLayout();
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(VIEW_FILE).flush(envelope(VIEW, 'metadata'));
    expect(await layout).toBeNull();
    expect(warnings).toEqual([
      `[agentic-ui-layouts] Claim/view layout from ${VIEW_FILE} ignored: expected the Claim/view layout`,
    ]);
  });

  it("leaves out a field whose rule this build's registry lacks, and keeps one whose rule it has", async () => {
    TestBed.inject(ExtensionRuleRegistry).registerRules({ 'app.rules.canWrite': () => true });
    const layout = await answer({
      version: 2,
      cards: [
        {
          id: 'claim',
          fields: [
            { field: 'claim:number', visibleWhen: 'app.rules.canWrite' },
            {
              field: 'claim:amount',
              visibleWhen: { type: 'app.rules.inGroup', parameters: ['adjusters'] },
            },
          ],
        },
      ],
    });
    expect(layout?.cards[0].fields.map((field) => field.place)).toEqual(['cards[0].fields[0]']);
    expect(warnings).toEqual([
      '[agentic-ui-layouts] Claim/view layout: cards[0].fields[1] names the rule "app.rules.inGroup", which this build does not register; left out',
    ]);
  });

  it('leaves out a field the type does not have, and one whose widget does not show its type', async () => {
    const layout = await answer({
      version: 2,
      cards: [
        {
          id: 'claim',
          fields: ['claim:number', 'claim:nope', { field: 'claim:number', widget: 'date' }],
        },
      ],
    });
    expect(layout?.cards[0].fields).toHaveLength(1);
    expect(warnings).toEqual([
      "[agentic-ui-layouts] Claim/view layout: cards[0].fields[1] left out: claim:nope is not on the Claim type or this document's facets",
      '[agentic-ui-layouts] Claim/view layout: cards[0].fields[2] left out: the widget "date" does not show claim:number, a string property',
    ]);
  });

  it("is null when the type's schemas cannot be read", async () => {
    const layout = recordLayout();
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(VIEW_FILE).flush(envelope(VIEW));
    http.expectOne(CLAIM_TYPE).flush('', { status: 500, statusText: 'Server Error' });
    expect(await layout).toBeNull();
  });

  it('reads the index, the file and the type once per session', async () => {
    await answer(VIEW);
    const again = await recordLayout();
    expect(again?.cards[0].fields).toHaveLength(2);
    http.expectNone(INDEX);
    http.expectNone(VIEW_FILE);
    http.expectNone(CLAIM_TYPE);
  });

  it("keeps a file record's own view, and says so once however many of its documents open", async () => {
    const withFile = {
      ...CLAIM,
      schemas: [...CLAIM.schemas, { name: 'file', '@prefix': 'file', fields: { content: 'blob' } }],
    };
    const first = recordLayout();
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(VIEW_FILE).flush(envelope(VIEW));
    http.expectOne(CLAIM_TYPE).flush(withFile);
    expect(await first).toBeNull();
    expect(await recordLayout()).toBeNull();
    expect(warnings).toEqual([
      '[agentic-ui-layouts] Claim/view layout not drawn for a Claim with a file or a note, which the View tab shows first; a record page beside it comes later',
    ]);
  });

  /** A dynamic facet adds a schema to one document, which the packaged view then previews. */
  it.each(['file', 'note'])(
    'keeps the own view of a document whose facet adds the %s schema to a type without it',
    async (schema) => {
      const facetted = firstValueFrom(
        service.recordLayoutFor('Claim', [
          { name: 'dublincore', prefix: 'dc' },
          { name: 'claim', prefix: 'claim' },
          { name: schema, prefix: schema },
        ]),
      );
      http.expectOne(INDEX).flush(index('Claim/view'));
      http.expectOne(VIEW_FILE).flush(envelope(VIEW));
      http.expectOne(CLAIM_TYPE).flush(CLAIM);
      expect(await facetted).toBeNull();
      http.expectNone(`/nuxeo/api/v1/config/schemas/${schema}`);
      expect(warnings).toEqual([
        '[agentic-ui-layouts] Claim/view layout not drawn for a Claim with a file or a note, which the View tab shows first; a record page beside it comes later',
      ]);
      // Another Claim, without the facet: its record page, from the reads already made.
      const plain = await firstValueFrom(
        service.recordLayoutFor('Claim', [
          { name: 'dublincore', prefix: 'dc' },
          { name: 'claim', prefix: 'claim' },
        ]),
      );
      expect(plain?.cards[0].fields).toHaveLength(2);
    },
  );

  it('draws the record page of a Picture, its views first, though it holds a file', async () => {
    const picture = {
      ...CLAIM,
      schemas: [
        ...CLAIM.schemas,
        { name: 'file', '@prefix': 'file', fields: { content: 'blob' } },
        { name: 'picture', '@prefix': 'picture', fields: { views: 'complex[]' } },
      ],
    };
    const layout = recordLayout();
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(VIEW_FILE).flush(envelope(VIEW));
    http.expectOne(CLAIM_TYPE).flush(picture);
    const resolved = await layout;
    expect(resolved?.preview).toBe('picture');
    expect(resolved?.cards[0].fields).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('draws it for a record whose facet adds the picture schema', async () => {
    const facetted = firstValueFrom(
      service.recordLayoutFor('Claim', [
        { name: 'dublincore', prefix: 'dc' },
        { name: 'claim', prefix: 'claim' },
        { name: 'file', prefix: 'file' },
        { name: 'picture', prefix: 'picture' },
      ]),
    );
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(VIEW_FILE).flush(envelope(VIEW));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    expect((await facetted)?.preview).toBe('picture');
    // A plain Claim has no preview: its record holds no file.
    expect((await recordLayout())?.preview).toBeNull();
  });

  it("draws a Video's record page with its player first, though Nuxeo's Video facet brings the picture schema", async () => {
    // A Video's schemas, as Nuxeo 2025 reports them: `file`, `video` and `picture`, among others.
    const video = {
      ...CLAIM,
      schemas: [
        ...CLAIM.schemas,
        { name: 'file', '@prefix': 'file', fields: { content: 'blob' } },
        { name: 'video', '@prefix': 'vid', fields: { duration: 'double' } },
        { name: 'picture', '@prefix': 'picture', fields: { views: 'complex[]' } },
      ],
    };
    const layout = recordLayout();
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(VIEW_FILE).flush(envelope(VIEW));
    http.expectOne(CLAIM_TYPE).flush(video);
    const resolved = await layout;
    expect(resolved?.preview).toBe('video');
    expect(resolved?.review).toBe(false);
    expect(resolved?.cards[0].fields).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('draws it for a record whose facet adds the video schema, and leaves its review out', async () => {
    const facetted = firstValueFrom(
      service.recordLayoutFor('Claim', [
        { name: 'dublincore', prefix: 'dc' },
        { name: 'claim', prefix: 'claim' },
        { name: 'file', prefix: 'file' },
        { name: 'video', prefix: 'vid' },
        { name: 'picture', prefix: 'picture' },
      ]),
    );
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(VIEW_FILE).flush(envelope({ ...VIEW, review: {} }));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    const resolved = await facetted;
    expect(resolved?.preview).toBe('video');
    expect(resolved?.review).toBe(false);
    expect(warnings).toEqual([
      '[agentic-ui-layouts] Claim/view layout: review: a review is drawn on a picture, and this record shows a video; left out',
    ]);
  });

  it('keeps the own view of a record with a file and neither a picture nor a video', async () => {
    const file = {
      ...CLAIM,
      schemas: [...CLAIM.schemas, { name: 'file', '@prefix': 'file', fields: { content: 'blob' } }],
    };
    const layout = recordLayout();
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(VIEW_FILE).flush(envelope(VIEW));
    http.expectOne(CLAIM_TYPE).flush(file);
    expect(await layout).toBeNull();
    expect(warnings).toEqual([
      '[agentic-ui-layouts] Claim/view layout not drawn for a Claim with a file or a note, which the View tab shows first; a record page beside it comes later',
    ]);
  });

  it("carries the file's banners to the record page, leaving out one whose rule this build lacks", async () => {
    TestBed.inject(ExtensionRuleRegistry).registerRules({
      'app.rules.dateWithin': DOCUMENT_RULE_EVALUATORS['app.rules.dateWithin'],
    });
    const banners = [
      {
        id: 'rights-ending',
        tone: 'warning',
        label: 'Rights ending',
        visibleWhen: { type: 'app.rules.dateWithin', parameters: [{ field: 'dc:expired' }, 30] },
      },
      { id: 'notice', labelKey: 'acme.asset.notice' },
      { id: 'licensed', label: 'Licensed', visibleWhen: 'acme.rules.licensed' },
    ];
    const layout = recordLayout();
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(VIEW_FILE).flush(envelope({ ...VIEW, banners }));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    expect((await layout)?.banners).toEqual([
      {
        id: 'rights-ending',
        place: 'banners[0]',
        label: { literal: 'Rights ending', keys: [], fallback: 'Rights ending' },
        tone: 'warning',
        visibleWhen: banners[0].visibleWhen,
        link: null,
      },
      {
        id: 'notice',
        place: 'banners[1]',
        label: { keys: ['acme.asset.notice'], fallback: 'Notice' },
        tone: 'info',
        visibleWhen: null,
        link: null,
      },
    ]);
    expect(warnings).toEqual([
      '[agentic-ui-layouts] Claim/view layout: banners[2].visibleWhen: the rule "acme.rules.licensed" is not registered; banners[2] left out',
    ]);
  });

  it("tells the console what it left out of a table's columns", async () => {
    const layout = recordLayout();
    http.expectOne(INDEX).flush(index('Claim/view'));
    http.expectOne(VIEW_FILE).flush(
      envelope({
        version: 2,
        cards: [
          {
            id: 'lines',
            fields: [
              {
                field: 'claim:lines',
                widget: 'table',
                parameters: { columns: ['line:code', 'line:cod'] },
              },
            ],
          },
        ],
      }),
    );
    http.expectOne(CLAIM_TYPE).flush({
      ...CLAIM,
      schemas: [
        ...CLAIM.schemas,
        {
          name: 'claimLines',
          '@prefix': 'claim',
          fields: { lines: { type: 'complex[]', fields: { code: 'string' } } },
        },
      ],
    });
    expect((await layout)?.cards[0].fields[0].parameters['columns']).toEqual(['line:code']);
    expect(warnings).toEqual([
      '[agentic-ui-layouts] Claim/view layout: cards[0].fields[0].parameters.columns[1] left out: claim:lines has no subfield "cod"',
    ]);
  });

  describe('rowPropertiesOf', () => {
    const row = (uid: string, schemas: { name: string; prefix: string }[] = []) => ({
      uid,
      title: uid,
      type: 'Claim',
      path: `/${uid}`,
      lastModified: '',
      properties: {},
      schemas,
    });

    it("reads a row's type once for every row of it, and gives its properties' definitions", async () => {
      const first = firstValueFrom(service.rowPropertiesOf(row('c1'), ['claim:amount']));
      const second = firstValueFrom(service.rowPropertiesOf(row('c2'), ['claim:amount']));
      http.expectOne(CLAIM_TYPE).flush(CLAIM);
      expect((await first)?.get('claim:amount')).toEqual({ type: 'double' });
      expect((await second)?.get('dc:title')).toEqual({ type: 'string' });
    });

    it("reads the schema a row's facet adds only where a column names its prefix", async () => {
      const facets = [
        { name: 'audit', prefix: 'aud' },
        { name: 'unnamed', prefix: 'un' },
      ];
      const properties = firstValueFrom(
        service.rowPropertiesOf(row('c1', facets), ['claim:number', 'aud:reviewer']),
      );
      http.expectOne(CLAIM_TYPE).flush(CLAIM);
      http
        .expectOne('/nuxeo/api/v1/config/schemas/audit')
        .flush({ name: 'audit', '@prefix': 'aud', fields: { reviewer: 'string' } });
      http.expectNone('/nuxeo/api/v1/config/schemas/unnamed');
      const read = await properties;
      expect(read?.get('aud:reviewer')).toEqual({ type: 'string' });
      expect(read?.get('claim:number')).toEqual({ type: 'string' });
    });

    it("is null when the row's type cannot be read", async () => {
      const properties = firstValueFrom(service.rowPropertiesOf(row('c1'), ['claim:amount']));
      http.expectOne(CLAIM_TYPE).flush('', { status: 500, statusText: 'Server Error' });
      expect(await properties).toBeNull();
    });
  });

  describe('principalLabel', () => {
    it('names a user by first and last name, and a group by its label', async () => {
      const user = firstValueFrom(service.principalLabel('user', 'jdoe'));
      http
        .expectOne('/nuxeo/api/v1/user/jdoe')
        .flush({ id: 'jdoe', properties: { firstName: 'Jane', lastName: 'Doe' } });
      expect(await user).toBe('Jane Doe');
      const group = firstValueFrom(service.principalLabel('group', 'members'));
      const request = http.expectOne('/nuxeo/api/v1/group/members');
      // Without its members: a label does not need them, and a large group's list is heavy.
      expect(request.request.headers.has('fetch-group')).toBe(false);
      request.flush({ groupname: 'members', grouplabel: 'Member services' });
      expect(await group).toBe('Member services');
    });

    it('is null, and asked again later, when the read fails', async () => {
      const first = firstValueFrom(service.principalLabel('user', 'gone'));
      http.expectOne('/nuxeo/api/v1/user/gone').flush('', { status: 404, statusText: 'Not Found' });
      expect(await first).toBeNull();
      expect(warnings).toEqual(['[agentic-ui-layouts] user gone not read: HTTP 404']);
      const second = firstValueFrom(service.principalLabel('user', 'gone'));
      http.expectOne('/nuxeo/api/v1/user/gone').flush({ properties: { firstName: 'Back' } });
      expect(await second).toBe('Back');
    });

    it('reads each one once per session', async () => {
      const first = firstValueFrom(service.principalLabel('group', 'members'));
      http.expectOne('/nuxeo/api/v1/group/members').flush({ groupname: 'members' });
      expect(await first).toBe('members');
      expect(await firstValueFrom(service.principalLabel('group', 'members'))).toBe('members');
    });
  });
});

describe('principalName', () => {
  it.each([
    ['user', { properties: { firstName: 'Jane', lastName: 'Doe' } }, 'Jane Doe'],
    ['user', { properties: { firstName: '', lastName: 'Doe' } }, 'Doe'],
    ['user', { properties: {} }, null],
    ['user', null, null],
    ['group', { groupname: 'g', grouplabel: '  ' }, 'g'],
    ['group', { groupname: '', grouplabel: '' }, null],
  ] as const)('a %s read as %j is named %j', (kind, raw, name) => {
    expect(principalName(kind, raw)).toBe(name);
  });
});
