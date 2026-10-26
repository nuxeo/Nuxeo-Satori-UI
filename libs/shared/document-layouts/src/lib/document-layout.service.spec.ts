import {
  HttpInterceptorFn,
  provideHttpClient,
  withInterceptors,
  withXhr,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom } from 'rxjs';

import {
  DocumentLayoutService,
  LAYOUT_LOAD_TIMEOUT_MS,
  layoutFileUrl,
  layoutsIndexUrl,
} from './document-layout.service';
import { ResolvedLayout } from './layout.model';

const FORMAT = 'nuxeo-agentic-ui-config/1';
const INDEX = '/nuxeo/agentic-ui-config/layouts.json';
const CLAIM_FILE = '/nuxeo/agentic-ui-config/layouts/Claim/metadata.layout.json';
const CLAIM_TYPE = '/nuxeo/api/v1/config/types/Claim';

const CLAIM = {
  name: 'Claim',
  schemas: [
    { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
    { name: 'claim', '@prefix': 'claim', fields: { number: 'string', status: 'string' } },
  ],
};

const SCHEMA = (name: string) => `/nuxeo/api/v1/config/schemas/${name}`;
const STRING = { 'entity-type': 'validation_constraint', name: 'string', parameters: {} };

/** Trimmed from real `/config/schemas/<name>` responses with `fetch-schema: fields`. */
const EXTERNAL_ENTITY = {
  'entity-type': 'schema',
  name: 'externalEntity',
  prefix: 'externalEntity',
  '@prefix': 'externalEntity',
  fields: {
    entityId: { type: 'string', constraints: [STRING] },
    origin: { type: 'string', constraints: [STRING] },
    entity: { type: 'string', constraints: [STRING] },
  },
};
const HXAI = {
  'entity-type': 'schema',
  name: 'hxai',
  prefix: 'hxai',
  '@prefix': 'hxai',
  fields: {
    mappings: { type: 'string[]', constraints: [], itemConstraints: [STRING] },
    aggregateDefaultMappings: { type: 'boolean', constraints: [] },
  },
};

const PREFIXES: Record<string, string> = {
  dublincore: 'dc',
  notification: 'notif',
  thumbnail: 'thumb',
};
/** The `schemas` a document read reports: its type's, then whatever its dynamic facets added. */
const carrying = (...names: string[]) =>
  ['claim', 'dublincore', ...names].map((name) => ({ name, prefix: PREFIXES[name] ?? name }));

const index = (...keys: string[]) => ({
  format: FORMAT,
  layer: 'layouts',
  layouts: keys.map((key) => {
    const [type, mode] = key.split('/');
    return { type, mode, component: 'org.acme.config' };
  }),
  diagnostics: [],
});

const envelope = (content: unknown) => ({
  format: FORMAT,
  layer: 'layout',
  type: 'Claim',
  mode: 'metadata',
  content,
});

describe('layout URLs', () => {
  it('sit beside the bootstrap response', () => {
    expect(layoutsIndexUrl('/nuxeo/agentic-ui-config/bootstrap.json')).toBe(INDEX);
    expect(layoutsIndexUrl('/agentic-ui-config/bootstrap.json?v=1')).toBe(
      '/agentic-ui-config/layouts.json',
    );
    expect(layoutFileUrl('/nuxeo/agentic-ui-config/bootstrap.json', 'Claim', 'metadata')).toBe(
      CLAIM_FILE,
    );
  });
});

describe('DocumentLayoutService', () => {
  let http: HttpTestingController;
  let service: DocumentLayoutService;
  let intercepted: string[];
  let warnings: string[];

  beforeEach(() => {
    intercepted = [];
    warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) =>
      warnings.push(String(message)),
    );
    const recorder: HttpInterceptorFn = (request, next) => {
      intercepted.push(request.url);
      return next(request);
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr(), withInterceptors([recorder])),
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

  const resolve = (
    type = 'Claim',
    schemas: readonly { name: string; prefix: string }[] = [],
  ): Promise<ResolvedLayout | null> => firstValueFrom(service.layoutFor(type, 'metadata', schemas));

  const sectionIds = (layout: ResolvedLayout | null) =>
    layout?.sections.map((section) => section.id);

  const answerType = (body: object = CLAIM) => http.expectOne(CLAIM_TYPE).flush(body);

  it('generates the layout from the type when no package contributed one', async () => {
    const layout = resolve();
    answerType();
    http.expectOne(INDEX).flush(index());
    const resolved = await layout;
    expect(resolved?.source).toBe('generated');
    expect(
      resolved?.sections.map((section) => [section.id, section.fields.map((field) => field.xpath)]),
    ).toEqual([['claim', ['claim:number', 'claim:status']]]);
  });

  it('reads the type with fetch-schema: fields, through the interceptors', async () => {
    const layout = resolve();
    const request = http.expectOne(CLAIM_TYPE);
    expect(request.request.headers.get('fetch-schema')).toBe('fields');
    request.flush(CLAIM);
    http.expectOne(INDEX).flush(index());
    await layout;
    expect(intercepted).toContain(CLAIM_TYPE);
  });

  it('reads the layout index and file without the interceptors, which would add credentials', async () => {
    const layout = resolve();
    answerType();
    http.expectOne(INDEX).flush(index('Claim/metadata'));
    http
      .expectOne(CLAIM_FILE)
      .flush(envelope({ version: 1, sections: [{ id: 'a', fields: ['claim:status'] }] }));
    await layout;
    expect(intercepted).not.toContain(INDEX);
    expect(intercepted).not.toContain(CLAIM_FILE);
  });

  it('renders a contributed file instead of the generated layout', async () => {
    const layout = resolve();
    answerType();
    http.expectOne(INDEX).flush(index('Claim/metadata'));
    http
      .expectOne(CLAIM_FILE)
      .flush(
        envelope({ version: 1, sections: [{ id: 'a', fields: ['claim:status', 'dc:title'] }] }),
      );
    const resolved = await layout;
    expect(resolved?.source).toBe('contributed');
    expect(resolved?.sections.map((section) => section.fields.map((field) => field.xpath))).toEqual(
      [['claim:status', 'dc:title']],
    );
  });

  it('fetches only the file for the type and mode asked for', async () => {
    const layout = resolve();
    answerType();
    http.expectOne(INDEX).flush(index('Member/metadata', 'Claim/edit'));
    expect((await layout)?.source).toBe('generated');
    http.expectNone((request) => request.url.includes('/layouts/'));
  });

  it('reads the index, the file and the type once per session', async () => {
    const first = resolve();
    answerType();
    http.expectOne(INDEX).flush(index('Claim/metadata'));
    http.expectOne(CLAIM_FILE).flush(envelope({ version: 1, sections: [] }));
    await first;
    const second = await resolve();
    expect(second?.source).toBe('contributed');
    http.expectNone(INDEX);
    http.expectNone(CLAIM_FILE);
    http.expectNone(CLAIM_TYPE);
  });

  it('falls back to the generated layout when the index cannot be read, and says why', async () => {
    const layout = resolve();
    answerType();
    http.expectOne(INDEX).flush('', { status: 404, statusText: 'Not Found' });
    expect((await layout)?.source).toBe('generated');
    expect(warnings).toContain(`[agentic-ui-layouts] layouts not loaded from ${INDEX}: HTTP 404`);
  });

  it('gives up on an index that never answers, cancels it, and shows the generated layout', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const layout = resolve().then((resolved) => {
        settled = true;
        return resolved;
      });
      answerType();
      const pending = http.expectOne(INDEX);

      await vi.advanceTimersByTimeAsync(LAYOUT_LOAD_TIMEOUT_MS);

      expect(settled).toBe(true);
      expect(pending.cancelled).toBe(true);
      expect((await layout)?.source).toBe('generated');
      expect(warnings).toContain(
        `[agentic-ui-layouts] layouts not loaded from ${INDEX}: no response within 10 s`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a layout file that never answers, cancels it, and shows the generated layout', async () => {
    vi.useFakeTimers();
    try {
      const layout = resolve();
      answerType();
      http.expectOne(INDEX).flush(index('Claim/metadata'));
      const pending = http.expectOne(CLAIM_FILE);

      await vi.advanceTimersByTimeAsync(LAYOUT_LOAD_TIMEOUT_MS);

      expect(pending.cancelled).toBe(true);
      expect((await layout)?.source).toBe('generated');
      expect(warnings).toContain(
        `[agentic-ui-layouts] Claim/metadata layout not loaded from ${CLAIM_FILE}: no response within 10 s`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an index that is not the layouts envelope', async () => {
    const layout = resolve();
    answerType();
    http.expectOne(INDEX).flush({ layouts: [{ type: 'Claim', mode: 'metadata' }] });
    expect((await layout)?.source).toBe('generated');
    expect(warnings.some((warning) => warning.includes(`layouts from ${INDEX} ignored`))).toBe(
      true,
    );
  });

  it('refuses a file of another version and shows the generated layout', async () => {
    const layout = resolve();
    answerType();
    http.expectOne(INDEX).flush(index('Claim/metadata'));
    http.expectOne(CLAIM_FILE).flush(envelope({ version: 2, sections: [] }));
    expect((await layout)?.source).toBe('generated');
    expect(warnings).toContain(
      `[agentic-ui-layouts] Claim/metadata layout from ${CLAIM_FILE} refused, showing the generated layout: version must be 1, got 2`,
    );
  });

  it('ignores a file answered for another type', async () => {
    const layout = resolve();
    answerType();
    http.expectOne(INDEX).flush(index('Claim/metadata'));
    http.expectOne(CLAIM_FILE).flush({ ...envelope({ version: 1, sections: [] }), type: 'Member' });
    expect((await layout)?.source).toBe('generated');
    expect(
      warnings.some((warning) => warning.includes('ignored: expected the Claim/metadata layout')),
    ).toBe(true);
  });

  it('falls back when the file cannot be fetched', async () => {
    const layout = resolve();
    answerType();
    http.expectOne(INDEX).flush(index('Claim/metadata'));
    http.expectOne(CLAIM_FILE).flush('', { status: 500, statusText: 'Server Error' });
    expect((await layout)?.source).toBe('generated');
    expect(warnings).toContain(
      `[agentic-ui-layouts] Claim/metadata layout not loaded from ${CLAIM_FILE}: HTTP 500`,
    );
  });

  it('names each field it skipped because the type does not have it', async () => {
    const layout = resolve();
    answerType();
    http.expectOne(INDEX).flush(index('Claim/metadata'));
    http.expectOne(CLAIM_FILE).flush(
      envelope({
        version: 1,
        sections: [{ id: 'a', fields: ['claim:nope', 'not an xpath', 'claim:number'] }],
      }),
    );
    expect((await layout)?.sections[0]?.fields.map((field) => field.xpath)).toEqual([
      'claim:number',
    ]);
    expect(warnings).toContain(
      "[agentic-ui-layouts] Claim/metadata layout: field claim:nope is not on the Claim type or this document's facets; skipped",
    );
    expect(warnings).toContain(
      '[agentic-ui-layouts] Claim/metadata layout: section "a" field 2 is not "<prefix>:<name>"; skipped',
    );
  });

  it('logs what the server reported about the contributions it replaced or rejected', async () => {
    const layout = resolve();
    answerType();
    http.expectOne(INDEX).flush({
      ...index(),
      diagnostics: [
        { level: 'warning', code: 'kept', message: 'layout Claim/metadata from a stays in force.' },
      ],
    });
    await layout;
    expect(warnings).toContain(
      '[agentic-ui-layouts] server warning kept: layout Claim/metadata from a stays in force.',
    );
  });

  it('treats a 200 that is not a document type as a failed read: logged, and asked again', async () => {
    const first = resolve();
    http.expectOne(CLAIM_TYPE).flush({ unexpected: true });
    http.expectOne(INDEX).flush(index());
    expect(await first).toBeNull();
    expect(warnings).toContain(
      '[agentic-ui-layouts] schemas of Claim not read: the response is not a document type',
    );

    const second = resolve();
    answerType();
    expect((await second)?.source).toBe('generated');
  });

  it('answers null when the type cannot be read, and asks again for the next document', async () => {
    const first = resolve();
    http.expectOne(CLAIM_TYPE).flush('', { status: 403, statusText: 'Forbidden' });
    http.expectOne(INDEX).flush(index());
    expect(await first).toBeNull();
    expect(warnings).toContain('[agentic-ui-layouts] schemas of Claim not read: HTTP 403');

    const second = resolve();
    answerType();
    expect((await second)?.source).toBe('generated');
  });

  describe('schemas a dynamic facet adds to one document', () => {
    /** The type read and the index come first; the facet schemas are read once both are in. */
    const answerTypeAndIndex = (...layouts: string[]) => {
      answerType();
      http.expectOne(INDEX).flush(index(...layouts));
    };

    const claimFile = (...fields: string[]) =>
      http.expectOne(CLAIM_FILE).flush(envelope({ version: 1, sections: [{ id: 'a', fields }] }));

    it("gives each a section after the type's own, read with fetch-schema: fields", async () => {
      const layout = resolve('Claim', carrying('hxai', 'externalEntity'));
      answerTypeAndIndex();
      const external = http.expectOne(SCHEMA('externalEntity'));
      expect(external.request.headers.get('fetch-schema')).toBe('fields');
      external.flush(EXTERNAL_ENTITY);
      const hxai = http.expectOne(SCHEMA('hxai'));
      expect(hxai.request.headers.get('fetch-schema')).toBe('fields');
      hxai.flush(HXAI);

      const resolved = await layout;
      expect(resolved?.source).toBe('generated');
      expect(
        resolved?.sections.map((section) => [section.id, section.fields.map((f) => f.xpath)]),
      ).toEqual([
        ['claim', ['claim:number', 'claim:status']],
        [
          'externalEntity',
          ['externalEntity:entity', 'externalEntity:entityId', 'externalEntity:origin'],
        ],
        ['hxai', ['hxai:aggregateDefaultMappings', 'hxai:mappings']],
      ]);
      expect(resolved?.sections[2]?.fields[1]?.definition).toEqual({ type: 'string[]' });
      expect(intercepted).toContain(SCHEMA('externalEntity'));
    });

    it('reads no schema the type already has, nor one the panel already presents', async () => {
      const layout = resolve('Claim', carrying('collectionMember', 'notification', 'thumbnail'));
      answerTypeAndIndex();
      expect(sectionIds(await layout)).toEqual(['claim']);
      http.expectNone((request) => request.url.includes('/config/schemas/'));
    });

    it('reads each facet schema once per session, whichever type carries it', async () => {
      const first = resolve('Claim', carrying('externalEntity'));
      answerTypeAndIndex();
      http.expectOne(SCHEMA('externalEntity')).flush(EXTERNAL_ENTITY);
      await first;

      const member = resolve('Member', [{ name: 'externalEntity', prefix: 'externalEntity' }]);
      http
        .expectOne('/nuxeo/api/v1/config/types/Member')
        .flush({ schemas: [{ name: 'member', fields: { plan: 'string' } }] });
      expect(sectionIds(await member)).toEqual(['member', 'externalEntity']);
      http.expectNone(SCHEMA('externalEntity'));
    });

    it("resolves each document's own schemas, never another document's of the same type", async () => {
      const withFacet = resolve('Claim', carrying('externalEntity'));
      answerTypeAndIndex();
      http.expectOne(SCHEMA('externalEntity')).flush(EXTERNAL_ENTITY);
      expect(sectionIds(await withFacet)).toEqual(['claim', 'externalEntity']);

      expect(sectionIds(await resolve('Claim', carrying()))).toEqual(['claim']);

      const other = resolve('Claim', carrying('hxai'));
      http.expectOne(SCHEMA('hxai')).flush(HXAI);
      expect(sectionIds(await other)).toEqual(['claim', 'hxai']);

      expect(sectionIds(await resolve('Claim', carrying('hxai', 'externalEntity')))).toEqual([
        'claim',
        'externalEntity',
        'hxai',
      ]);
    });

    it('drops only the section of a schema it cannot read, says why, and asks again next time', async () => {
      const first = resolve('Claim', carrying('externalEntity', 'hxai'));
      answerTypeAndIndex();
      http
        .expectOne(SCHEMA('externalEntity'))
        .flush('', { status: 500, statusText: 'Server Error' });
      http.expectOne(SCHEMA('hxai')).flush(HXAI);
      expect(sectionIds(await first)).toEqual(['claim', 'hxai']);
      expect(warnings).toContain('[agentic-ui-layouts] schema externalEntity not read: HTTP 500');

      const second = resolve('Claim', carrying('externalEntity', 'hxai'));
      http.expectOne(SCHEMA('externalEntity')).flush(EXTERNAL_ENTITY);
      http.expectNone(SCHEMA('hxai'));
      expect(sectionIds(await second)).toEqual(['claim', 'externalEntity', 'hxai']);
    });

    it('treats a 204, or a body that is not the schema asked for, as a failed read', async () => {
      const first = resolve('Claim', carrying('externalEntity'));
      answerTypeAndIndex();
      http
        .expectOne(SCHEMA('externalEntity'))
        .flush(null, { status: 204, statusText: 'No Content' });
      expect(sectionIds(await first)).toEqual(['claim']);

      const second = resolve('Claim', carrying('externalEntity'));
      http.expectOne(SCHEMA('externalEntity')).flush(HXAI);
      expect(sectionIds(await second)).toEqual(['claim']);
      expect(
        warnings.filter((w) => w.includes('schema externalEntity not read: the response is not')),
      ).toHaveLength(2);
    });

    it.each([
      ['no fields', { name: 'externalEntity' }],
      ['null fields', { name: 'externalEntity', fields: null }],
      ['a list of fields', { name: 'externalEntity', fields: [] }],
    ])(
      'treats a schema answered with %s as a failed read, not an empty schema',
      async (_, body) => {
        const first = resolve('Claim', carrying('externalEntity'));
        answerTypeAndIndex();
        http.expectOne(SCHEMA('externalEntity')).flush(body);
        expect(sectionIds(await first)).toEqual(['claim']);
        expect(warnings).toContain(
          '[agentic-ui-layouts] schema externalEntity not read: the response is not the externalEntity schema',
        );

        const second = resolve('Claim', carrying('externalEntity'));
        http.expectOne(SCHEMA('externalEntity')).flush(EXTERNAL_ENTITY);
        expect(sectionIds(await second)).toEqual(['claim', 'externalEntity']);
      },
    );

    it('gives up on a schema read that never answers, cancels it, and shows the rest', async () => {
      vi.useFakeTimers();
      try {
        const first = resolve('Claim', carrying('externalEntity', 'hxai'));
        answerTypeAndIndex();
        const stalled = http.expectOne(SCHEMA('externalEntity'));
        http.expectOne(SCHEMA('hxai')).flush(HXAI);

        await vi.advanceTimersByTimeAsync(LAYOUT_LOAD_TIMEOUT_MS);

        expect(stalled.cancelled).toBe(true);
        expect(sectionIds(await first)).toEqual(['claim', 'hxai']);
        expect(warnings).toContain(
          '[agentic-ui-layouts] schema externalEntity not read: no response within 10 s',
        );

        const second = resolve('Claim', carrying('externalEntity', 'hxai'));
        http.expectOne(SCHEMA('externalEntity')).flush(EXTERNAL_ENTITY);
        expect(sectionIds(await second)).toEqual(['claim', 'externalEntity', 'hxai']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('lets a contributed file show a field of a facet schema the document carries', async () => {
      const layout = resolve('Claim', carrying('externalEntity', 'hxai'));
      answerTypeAndIndex('Claim/metadata');
      claimFile('externalEntity:origin', 'claim:number');
      http.expectOne(SCHEMA('externalEntity')).flush(EXTERNAL_ENTITY);
      http.expectNone(SCHEMA('hxai'));
      expect((await layout)?.sections[0]?.fields.map((field) => field.xpath)).toEqual([
        'externalEntity:origin',
        'claim:number',
      ]);
      expect(warnings.filter((w) => w.includes('skipped'))).toEqual([]);
    });

    it('skips and reports a facet field on a document without that facet, reading nothing', async () => {
      const layout = resolve('Claim', carrying());
      answerTypeAndIndex('Claim/metadata');
      claimFile('externalEntity:origin', 'claim:number');
      expect((await layout)?.sections[0]?.fields.map((field) => field.xpath)).toEqual([
        'claim:number',
      ]);
      http.expectNone((request) => request.url.includes('/config/schemas/'));
      expect(warnings).toContain(
        "[agentic-ui-layouts] Claim/metadata layout: field externalEntity:origin is not on the Claim type or this document's facets; skipped",
      );
    });

    it('reports a field whose facet schema could not be read as unread, not as absent', async () => {
      const layout = resolve('Claim', carrying('externalEntity'));
      answerTypeAndIndex('Claim/metadata');
      claimFile('externalEntity:origin', 'claim:number');
      http.expectOne(SCHEMA('externalEntity')).flush('', { status: 403, statusText: 'Forbidden' });
      expect((await layout)?.sections[0]?.fields.map((field) => field.xpath)).toEqual([
        'claim:number',
      ]);
      expect(warnings).toContain(
        '[agentic-ui-layouts] Claim/metadata layout: field externalEntity:origin skipped: schema externalEntity was not read',
      );
      expect(warnings.some((w) => w.includes("or this document's facets"))).toBe(false);
    });
  });

  describe('vocabularyLabel', () => {
    const ENTRY = (directory: string, id: string) =>
      `/nuxeo/api/v1/directory/${directory}/${encodeURIComponent(id)}`;
    const entry = (directory: string, id: string, properties: Record<string, unknown>) => ({
      'entity-type': 'directoryEntry',
      directoryName: directory,
      id,
      properties: { id, ordering: 0, obsolete: 0, ...properties },
    });
    const label = (directory: string, id: string) =>
      firstValueFrom(service.vocabularyLabel(directory, id));

    it('reads one entry by id, translated in English, through the interceptors', async () => {
      const answer = label('claim_status', 'pending');
      const request = http.expectOne(ENTRY('claim_status', 'pending'));
      expect(request.request.method).toBe('GET');
      expect(request.request.headers.get('translate-directoryEntry')).toBe('label');
      expect(request.request.headers.get('Accept-Language')).toBe('en');
      request.flush(entry('claim_status', 'pending', { label: 'Pending review' }));
      expect(await answer).toBe('Pending review');
      expect(intercepted).toContain(ENTRY('claim_status', 'pending'));
    });

    it('names an entry whose label is an untranslated key by its id, as the pickers do', async () => {
      const answer = label('nature', 'article');
      http
        .expectOne(ENTRY('nature', 'article'))
        .flush(entry('nature', 'article', { label: 'label.directories.nature.article' }));
      expect(await answer).toBe('Article');
    });

    it('labels an l10n entry Parent/Child, reading its parent too', async () => {
      const answer = label('l10nsubjects', 'astronomy');
      http
        .expectOne(ENTRY('l10nsubjects', 'astronomy'))
        .flush(entry('l10nsubjects', 'astronomy', { parent: 'sciences', label_en: 'Astronomy' }));
      http
        .expectOne(ENTRY('l10nsubjects', 'sciences'))
        .flush(entry('l10nsubjects', 'sciences', { parent: '', label_en: 'Sciences' }));
      expect(await answer).toBe('Sciences/Astronomy');
    });

    it('reads each entry once per session', async () => {
      const first = label('claim_status', 'pending');
      http
        .expectOne(ENTRY('claim_status', 'pending'))
        .flush(entry('claim_status', 'pending', { label: 'Pending review' }));
      await first;
      expect(await label('claim_status', 'pending')).toBe('Pending review');
      http.expectNone(ENTRY('claim_status', 'pending'));
    });

    it('answers null for an entry it cannot read, and asks again the next time', async () => {
      const first = label('claim_status', 'gone');
      http
        .expectOne(ENTRY('claim_status', 'gone'))
        .flush('', { status: 404, statusText: 'Not Found' });
      expect(await first).toBeNull();

      const second = label('claim_status', 'gone');
      http.expectOne(ENTRY('claim_status', 'gone')).flush({ unexpected: true });
      expect(await second).toBeNull();

      const third = label('claim_status', 'gone');
      http
        .expectOne(ENTRY('claim_status', 'gone'))
        .flush(entry('claim_status', 'gone', { label: 'Gone' }));
      expect(await third).toBe('Gone');
    });

    it('encodes the id into the path', async () => {
      const answer = label('claim_status', 'a b?');
      http
        .expectOne('/nuxeo/api/v1/directory/claim_status/a%20b%3F')
        .flush(entry('claim_status', 'a b?', { label: 'Odd' }));
      expect(await answer).toBe('Odd');
    });
  });
});
