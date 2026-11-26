import type { PlatformName } from './check-model';
import type { Conversion } from './convert';
import {
  confirmPlatform,
  resolveDocument,
  servedConversion,
  servedPackage,
  serverReads,
  whoAmI,
  type Answer,
  type ServerReads,
} from './lab-server';
import type { PackageModel } from './model';
import type { StudioPackage } from './studio-package';

/** A server that answers each path it is given, and 404 for any other. */
function server(
  answers: Readonly<Record<string, unknown>>,
  origin = 'http://nuxeo.test:8080',
): ServerReads & { asked: string[] } {
  const asked: string[] = [];
  return {
    origin,
    asked,
    async get(path: string): Promise<Answer> {
      asked.push(path);
      if (!Object.hasOwn(answers, path)) return { status: 404, body: Buffer.from('{}') };
      const value = answers[path];
      if (Buffer.isBuffer(value)) return { status: 200, body: value };
      if (typeof value === 'number') return { status: value, body: Buffer.from('{}') };
      return { status: 200, body: Buffer.from(JSON.stringify(value)) };
    },
  };
}

const MODEL_ANSWERS = {
  '/nuxeo/api/v1/config/types': {
    doctypes: {
      Document: { parent: 'None!!!', facets: [], schemas: [] },
      File: { parent: 'Document', facets: ['Downloadable'], schemas: ['dublincore', 'file'] },
    },
  },
  '/nuxeo/api/v1/config/facets': [
    { name: 'Downloadable', schemas: [] },
    {
      name: 'Hxai',
      schemas: [{ name: 'hxai', '@prefix': 'hxai', fields: { mappings: 'string' } }],
    },
  ],
  '/nuxeo/api/v1/config/schemas': [
    {
      name: 'dublincore',
      '@prefix': 'dc',
      fields: { title: 'string', created: 'date', subjects: 'string[]' },
    },
    { name: 'file', '@prefix': '', fields: { content: 'blob' } },
    { name: 'var_Task6d8', '@prefix': '', fields: { comment: 'string' } },
  ],
  '/nuxeo/api/v1/directory/l10nsubjects?pageSize=1': { 'entity-type': 'directoryEntries' },
  '/nuxeo/api/v1/search/pp/domain_documents': { name: 'domain_documents' },
  '/nuxeo/api/v1/search/pp/nowhere': null,
};

/** A package model with one type of its own, extending the platform's File. */
const PACKAGE_MODEL: PackageModel = {
  schemas: new Map(),
  types: new Map([['Claim', { name: 'Claim', extends: 'File', schemas: ['claim'], facets: [] }]]),
  facets: new Map(),
  pageProviders: new Set(),
  directories: new Set(),
  workflows: new Set(),
  problems: [],
};

const property = (
  xpath: string,
  widget: string | null = null,
  type: string | null = null,
): PlatformName => ({
  kind: 'property',
  xpath,
  widget,
  type,
  where: `layouts/${type ?? 'X'}/view.layout.json cards.0.fields.0`,
});

describe("lab mode: check 3's server half", () => {
  it("confirms each platform name on the server's model, the directories and the page providers", async () => {
    const names: PlatformName[] = [
      property('dc:title', 'text', 'Claim'),
      property('dc:subjects', null, 'File'),
      property('hxai:mappings', null, 'File'),
      { kind: 'type', name: 'File' },
      { kind: 'vocabulary', name: 'l10nsubjects' },
      { kind: 'page provider', name: 'domain_documents' },
      {
        kind: 'variable',
        xpath: 'var:comment',
        workflow: 'SerialDocumentReview',
        step: 'Task6d8',
        widget: 'long-text',
        where: 'tasks/x',
      },
    ];
    expect(await confirmPlatform(server(MODEL_ANSWERS), names, PACKAGE_MODEL)).toEqual([]);
  });

  it('fails a name the server does not have, and a widget that does not show its type there', async () => {
    const findings = await confirmPlatform(
      server(MODEL_ANSWERS),
      [
        property('dc:nope'),
        property('zz:title'),
        property('dc:created', 'text'),
        property('dc:title', null, 'Document'),
        { kind: 'type', name: 'Invoice' },
        { kind: 'vocabulary', name: 'claim_decision' },
        { kind: 'page provider', name: 'nowhere' },
        {
          kind: 'variable',
          xpath: 'var:missing',
          workflow: 'SerialDocumentReview',
          step: 'Task6d8',
          widget: null,
          where: 'tasks/x',
        },
      ],
      PACKAGE_MODEL,
    );
    expect(findings).toEqual([
      "layouts/X/view.layout.json cards.0.fields.0: the server's schema dublincore has no field nope, so dc:nope does not exist",
      'layouts/X/view.layout.json cards.0.fields.0: the server has no schema of the prefix zz, so zz:title does not exist',
      'layouts/X/view.layout.json cards.0.fields.0: the text widget does not show dc:created, which is a date on the server',
      'layouts/Document/view.layout.json cards.0.fields.0: the type Document has no dublincore schema on the server, so it has no dc:title',
      'the server has no type Invoice',
      'the server has no vocabulary claim_decision',
      'the server has no page provider nowhere',
      'tasks/x: neither var_Task6d8 nor var_SerialDocumentReview on the server has a variable missing, so var:missing does not exist',
    ]);
  });

  it('says when the model cannot be read, rather than confirming anything', async () => {
    const findings = await confirmPlatform(
      server({ ...MODEL_ANSWERS, '/nuxeo/api/v1/config/facets': 500 }),
      [property('dc:title')],
      PACKAGE_MODEL,
    );
    expect(findings).toEqual([
      "the platform's model could not be read: /config/facets answered 500",
    ]);
  });
});

describe('lab mode: what it asks the server first', () => {
  it('judges /me with the identity guard', async () => {
    expect(await whoAmI(server({ '/nuxeo/api/v1/me': { id: 'alice' } }), 'alice')).toBeNull();
    expect(
      await whoAmI(server({ '/nuxeo/api/v1/me': { id: 'Guest', isAnonymous: true } }), 'alice'),
    ).toContain('anonymous');
    expect(await whoAmI(server({ '/nuxeo/api/v1/me': { id: 'bob' } }), 'alice')).toContain(
      'not as alice',
    );
    expect(await whoAmI(server({}), 'alice')).toContain('answered 404');
  });

  it('resolves a document by its id or by its path, and says why it cannot', async () => {
    const answer = {
      'entity-type': 'document',
      uid: 'f00d',
      path: '/ws/a note',
      type: 'Note',
      title: 'A note',
    };
    const reads = server({
      '/nuxeo/api/v1/id/f00d': answer,
      '/nuxeo/api/v1/path/ws/a%20note': answer,
    });
    const expected = { uid: 'f00d', path: '/ws/a note', type: 'Note', title: 'A note' };
    expect(await resolveDocument(reads, 'f00d')).toEqual(expected);
    expect(await resolveDocument(reads, '/ws/a note')).toEqual(expected);
    expect(await resolveDocument(reads, 'f00e')).toBe(
      'f00e: the server answered 404 for it, not with a document',
    );
    expect(await resolveDocument(reads, '../config')).toContain('is neither');
    expect(reads.asked).not.toContain('/nuxeo/api/v1/id/../config');
  });
});

describe('lab mode: whether the server serves the package, and the new app its conversion', () => {
  const pkg = {
    bundleFiles: new Map([
      [
        'web/nuxeo.war/ui/document/claim/nuxeo-claim-view-layout.html',
        Buffer.from('<dom-module id="a"></dom-module>'),
      ],
      ['web/nuxeo.war/ui/nuxeo-acme-bundle.html', Buffer.from('<link rel="import">')],
      ['OSGI-INF/extensions.xml', Buffer.from('<component/>')],
    ]),
  } as unknown as StudioPackage;

  it('compares each of the package Web UI files with what Web UI serves, byte for byte', async () => {
    const all = await servedPackage(
      server({
        '/nuxeo/ui/document/claim/nuxeo-claim-view-layout.html': Buffer.from(
          '<dom-module id="a"></dom-module>',
        ),
        '/nuxeo/ui/nuxeo-acme-bundle.html': Buffer.from('<link rel="import">'),
      }),
      'http://nuxeo.test:8080/nuxeo/ui/',
      pkg,
    );
    expect(all).toEqual({ total: 2, same: 2, examples: [] });
    const other = await servedPackage(
      server({ '/nuxeo/ui/nuxeo-acme-bundle.html': Buffer.from('<link rel="import" href="x">') }),
      'http://nuxeo.test:8080/nuxeo/ui',
      pkg,
    );
    expect(other).toEqual({
      total: 2,
      same: 0,
      examples: [
        '/nuxeo/ui/document/claim/nuxeo-claim-view-layout.html answers 404',
        '/nuxeo/ui/nuxeo-acme-bundle.html answers other bytes',
      ],
    });
  });

  it("compares each of the conversion's layout files with what the new app is served, out of its envelope", async () => {
    const layout = { version: 1, sections: [{ id: 's', fields: ['claim:number'] }] };
    const conversion = {
      app: { 'layouts/Claim/metadata.layout.json': layout, 'app.json': {} },
    } as unknown as Conversion;
    const envelope = (content: unknown): unknown => ({
      format: 'nuxeo-agentic-ui-config/1',
      layer: 'layout',
      content,
    });
    expect(
      await servedConversion(
        server(
          { '/agentic-ui-config/layouts/Claim/metadata.layout.json': envelope(layout) },
          'http://app.test:4297',
        ),
        'http://app.test:4297/',
        conversion,
      ),
    ).toEqual({ total: 1, same: 1, examples: [] });
    expect(
      await servedConversion(
        server(
          {
            '/agentic-ui-config/layouts/Claim/metadata.layout.json': envelope({
              ...layout,
              sections: [],
            }),
          },
          'http://app.test:4297',
        ),
        'http://app.test:4297/',
        conversion,
      ),
    ).toEqual({
      total: 1,
      same: 0,
      examples: ['/agentic-ui-config/layouts/Claim/metadata.layout.json answers another file'],
    });
  });
});

describe('lab mode: its reads of the server', () => {
  it('sends GET alone, to its own origin, with the header, and follows no redirect', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const reads = serverReads(
      'http://nuxeo.test:8080/anything',
      'Basic eA==',
      async (url, init) => {
        calls.push({ url, init });
        return new Response('{"id":"alice"}', { status: 200 });
      },
    );
    expect(reads.origin).toBe('http://nuxeo.test:8080');
    const answer = await reads.get('/nuxeo/api/v1/me', { properties: 'dublincore' });
    expect(answer.status).toBe(200);
    expect(calls[0].url).toBe('http://nuxeo.test:8080/nuxeo/api/v1/me');
    expect(calls[0].init).toEqual(
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: expect.objectContaining({ authorization: 'Basic eA==', properties: 'dublincore' }),
      }),
    );
    await expect(reads.get('@elsewhere.test/x')).rejects.toThrow(
      'is not a path on http://nuxeo.test:8080',
    );
    // Two slashes stay a path of the origin, so they go there and nowhere else.
    await reads.get('//elsewhere.test/x');
    expect(calls.map((call) => new URL(call.url).origin)).toEqual([
      'http://nuxeo.test:8080',
      'http://nuxeo.test:8080',
    ]);
  });

  it('sends back the session the server opened, so that its reads sign in once', async () => {
    const cookies: (string | undefined)[] = [];
    const reads = serverReads('http://nuxeo.test:8080', 'Basic eA==', async (_url, init) => {
      cookies.push((init.headers as Record<string, string>)['cookie']);
      return new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=abc123; Path=/nuxeo; HttpOnly' },
      });
    });
    await reads.get('/nuxeo/api/v1/me');
    await reads.get('/nuxeo/api/v1/config/types');
    expect(cookies).toEqual([undefined, 'JSESSIONID=abc123']);
  });

  it('sends no header when it is given none', async () => {
    const calls: RequestInit[] = [];
    const reads = serverReads('http://app.test:4297', null, async (_url, init) => {
      calls.push(init);
      return new Response('{}', { status: 200 });
    });
    await reads.get('/agentic-ui-config/layouts.json');
    expect(Object.keys(calls[0].headers as Record<string, string>)).not.toContain('authorization');
  });
});
