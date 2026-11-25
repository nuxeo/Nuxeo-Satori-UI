import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliIo } from './cli';
import { loadCatalogue } from './catalogue';
import { convert, writeConversion } from './convert';
import { inventory } from './inventory';
import type { AppRecording, LabDocument, RecordedRequest } from './lab';
import type { PwBrowser } from './lab-browser';
import { LAB_FORMAT, lab, type LabDeps } from './lab-cli';
import type { Answer, ServerReads } from './lab-server';
import { readStudioPackage } from './studio-package';
import { syntheticPackage } from './testing/synthetic-package';

const NOTE: LabDocument = { uid: '0a0b', path: '/ws/note', type: 'Note', title: 'A note' };
const FOLDER: LabDocument = { uid: '0c0d', path: '/ws/folder', type: 'Folder', title: 'A folder' };

function io(): CliIo & { printed: string[]; errors: string[] } {
  const printed: string[] = [];
  const errors: string[] = [];
  return {
    printed,
    errors,
    out: (text) => printed.push(text),
    err: (text) => errors.push(text),
    readFile: (path) => readFileSync(path),
  };
}

function reads(answers: Readonly<Record<string, unknown>>): (origin: string) => ServerReads {
  return (given) => ({
    origin: new URL(given).origin,
    async get(path: string): Promise<Answer> {
      const key = `${new URL(given).origin}${path}`;
      if (!Object.hasOwn(answers, key)) return { status: 404, body: Buffer.from('null') };
      const value = answers[key];
      return Buffer.isBuffer(value)
        ? { status: 200, body: value }
        : { status: 200, body: Buffer.from(JSON.stringify(value)) };
    },
  });
}

const SERVER = {
  'http://localhost:8080/nuxeo/api/v1/me': { id: 'alice' },
  'http://localhost:8080/nuxeo/api/v1/capabilities': {
    server: { distributionName: 'lts', distributionVersion: '2025.10' },
  },
  [`http://localhost:8080/nuxeo/api/v1/id/${NOTE.uid}`]: { 'entity-type': 'document', ...NOTE },
  [`http://localhost:8080/nuxeo/api/v1/path/ws/folder`]: { 'entity-type': 'document', ...FOLDER },
};

const read = (document: LabDocument, properties: readonly string[]): RecordedRequest => ({
  method: 'GET',
  path: `/nuxeo/api/v1/id/${document.uid}`,
  query: '',
  kind: 'fetch',
  asks: { properties: '*' },
  status: 200,
  signed: true,
  documentProperties: properties,
});
const me: RecordedRequest = {
  method: 'GET',
  path: '/nuxeo/api/v1/me',
  query: '',
  kind: 'fetch',
  asks: {},
  status: 200,
  signed: true,
  answeredAs: 'alice',
};

/** Web UI showing dc:description, and the new app on its document page or on Browse. */
function recorder(
  pages: Readonly<Record<string, 'document' | 'browse'>>,
  identity: readonly string[] = [],
  unreadable?: readonly string[],
): LabDeps['record'] {
  return async (_browser, app, _target, _credentials, document, options) => {
    writeFileSync(join(options.screenshot.out, options.screenshot.file), 'png');
    const recording: AppRecording = {
      app,
      url: 'http://x/',
      requests: [me, read(document, ['dc:title', 'dc:description'])],
      layouts:
        app === 'web-ui'
          ? [
              {
                path: '/nuxeo/ui/document/x/nuxeo-x-metadata-layout.html',
                status: 200,
                mode: 'metadata',
                fields: [{ xpath: 'dc:description', conditional: false }],
              },
            ]
          : [],
      ...(app === 'new-app'
        ? { page: { kind: pages[document.uid] ?? 'document', fields: [] } }
        : {}),
      identity: app === 'new-app' ? identity : [],
      ...(app === 'new-app' && unreadable ? { unreadable } : {}),
      screenshot: options.screenshot.file,
    };
    return recording;
  };
}

let closed = 0;
const browser = { close: async () => void closed++ } as unknown as PwBrowser;

function deps(overrides: Partial<LabDeps> = {}): LabDeps {
  return {
    env: { NUXEO_USER: 'alice', NUXEO_PASS: 'not-a-real-password' },
    launch: async () => browser,
    record: recorder({}),
    reads: reads(SERVER),
    ...overrides,
  };
}

const fresh = (): string => join(mkdtempSync(join(tmpdir(), 'lab-')), 'out');

describe('lab: the command', () => {
  it('refuses a wrong command with its usage, and exit 2', async () => {
    for (const argv of [
      [NOTE.uid],
      ['--out', fresh()],
      [NOTE.uid, '--out', fresh(), '--package', 'a.zip'],
      [NOTE.uid, '--out', fresh(), '--wat'],
      [NOTE.uid, '--out'],
    ]) {
      const out = io();
      expect(await lab(argv, out, deps())).toBe(2);
      expect(out.errors.join('')).toContain('studio-migration lab <document>...');
    }
    const out = io();
    expect(await lab([NOTE.uid, '--out', fresh(), '--control', 'nope'], out, deps())).toBe(2);
    expect(out.errors.join('')).toContain('nope is not a control');
  });

  it('refuses to run without both credentials, with no default and nothing written', async () => {
    for (const env of [{}, { NUXEO_USER: 'alice' }, { NUXEO_USER: 'alice', NUXEO_PASS: '' }]) {
      const out = io();
      const directory = fresh();
      expect(await lab([NOTE.uid, '--out', directory], out, deps({ env }))).toBe(2);
      expect(out.errors.join('')).toContain('NUXEO_USER and NUXEO_PASS must both be set');
      expect(existsSync(directory)).toBe(false);
    }
  });

  it('writes over nothing: an --out that holds a file is refused', async () => {
    const directory = fresh();
    mkdirSync(directory);
    writeFileSync(join(directory, 'kept.txt'), 'mine');
    const out = io();
    expect(await lab([NOTE.uid, '--out', directory], out, deps())).toBe(1);
    expect(readdirSync(directory)).toEqual(['kept.txt']);
  });

  it('opens nothing when the server does not answer as the user, and says so with exit 2', async () => {
    const out = io();
    const directory = fresh();
    const guest = reads({
      ...SERVER,
      'http://localhost:8080/nuxeo/api/v1/me': { id: 'Guest', isAnonymous: true },
    });
    expect(await lab([NOTE.uid, '--out', directory], out, deps({ reads: guest }))).toBe(2);
    expect(out.errors.join('')).toContain('Nothing was opened');
    expect(existsSync(directory)).toBe(false);
  });

  it('says when Playwright is missing, with exit 2', async () => {
    const out = io();
    expect(
      await lab(
        [NOTE.uid, '--out', fresh()],
        out,
        deps({ launch: async () => 'Playwright is not installed.' }),
      ),
    ).toBe(2);
    expect(out.errors).toEqual(['Playwright is not installed.\n']);
  });

  it('compares each document, prints the report and writes it, the data and the screenshots: exit 1 on a difference', async () => {
    const out = io();
    const directory = fresh();
    const before = closed;
    const code = await lab(
      [NOTE.uid, '/ws/folder', '--out', directory, '--app', 'http://localhost:4297/'],
      out,
      deps({ record: recorder({ [FOLDER.uid]: 'browse' }) }),
    );
    expect(code).toBe(1);
    expect(closed).toBe(before + 1);
    const text = readFileSync(join(directory, 'lab.txt'), 'utf8');
    expect(out.printed[0]).toBe(text);
    expect(text).toContain(
      'Lab mode: Web UI at http://localhost:8080/nuxeo/ui/ and the new app at http://localhost:4297/, on http://localhost:8080 (lts 2025.10), as alice',
    );
    expect(text).toContain(`Document 1 of 2: Note "A note", /ws/note (${NOTE.uid})`);
    expect(text).toContain(' 7  What the server is asked   partial:');
    expect(text).toContain(
      ' 7  What the server is asked   FAIL\n      - Web UI shows dc:description',
    );
    expect(text).toContain(
      'Lab verdict: 1 of 2 documents with a difference under the request-log rule',
    );
    expect(readdirSync(directory).sort()).toEqual([
      '1-new-app.png',
      '1-web-ui.png',
      '2-new-app.png',
      '2-web-ui.png',
      'lab.json',
      'lab.txt',
    ]);
    const data = JSON.parse(readFileSync(join(directory, 'lab.json'), 'utf8'));
    expect(data.format).toBe(LAB_FORMAT);
    expect(data.documents.map((entry: { document: LabDocument }) => entry.document.uid)).toEqual([
      NOTE.uid,
      FOLDER.uid,
    ]);
    expect(JSON.stringify(data)).not.toContain('not-a-real-password');
  });

  it('exits 0 when no document differs, and 2 when one could not be compared as the user', async () => {
    expect(await lab([NOTE.uid, '--out', fresh()], io(), deps())).toBe(0);
    const out = io();
    expect(
      await lab(
        [NOTE.uid, '--out', fresh()],
        out,
        deps({ record: recorder({}, ['its sign-in answered as Guest']) }),
      ),
    ).toBe(2);
    expect(out.printed[0]).toContain('1 not compared, each saying why');
    expect(out.printed[0]).toContain('because not every request ran as the user');
  });

  it('exits 1, never 0, when a document could not be compared because its page could not be read', async () => {
    const out = io();
    expect(
      await lab(
        [NOTE.uid, '--out', fresh()],
        out,
        deps({ record: recorder({}, [], ['its page could not be read: gone']) }),
      ),
    ).toBe(1);
    expect(out.printed[0]).toContain(
      'Lab verdict: 0 of 1 document with a difference under the request-log rule; 1 not compared, each saying why',
    );
    expect(out.printed[0]).toContain('the new app: its page could not be read: gone');
  });

  it('says, with a control, whether the rule reported it', async () => {
    const caught = io();
    expect(
      await lab(
        ['/ws/folder', '--out', fresh(), '--control', 'withhold-property=dc:description'],
        caught,
        deps({ record: recorder({ [FOLDER.uid]: 'browse' }) }),
      ),
    ).toBe(1);
    expect(caught.printed[0]).toContain('Control: withhold-property=dc:description');
    expect(caught.printed[0]).toContain('The control was reported on 1 of 1.');
    const missed = io();
    expect(
      await lab(
        [NOTE.uid, '--out', fresh(), '--control', 'narrow-schemas=dublincore'],
        missed,
        deps(),
      ),
    ).toBe(0);
    expect(missed.printed[0]).toContain('The control was reported on none');
  });

  it('runs the server halves for a package and its conversion: check 3 whole, and says what 5, 6 and 7 need', async () => {
    const zip = join(mkdtempSync(join(tmpdir(), 'lab-pkg-')), 'acme.zip');
    writeFileSync(zip, syntheticPackage());
    const pkg = readStudioPackage(syntheticPackage());
    const conversion = join(mkdtempSync(join(tmpdir(), 'lab-conv-')), 'conversion');
    writeConversion(
      conversion,
      convert(pkg, inventory(pkg), loadCatalogue(), { allowList: new Set() }),
    );
    const model = {
      'http://localhost:8080/nuxeo/api/v1/config/types': {
        doctypes: { Document: { parent: 'None!!!', facets: [], schemas: ['dublincore'] } },
      },
      'http://localhost:8080/nuxeo/api/v1/config/facets': [],
      'http://localhost:8080/nuxeo/api/v1/config/schemas': [
        { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
      ],
    };
    const out = io();
    const argv = [NOTE.uid, '--out', fresh(), '--package', zip, '--conversion', conversion];
    // The made-up package rests one name on the platform: dc:title, which this server has.
    expect(await lab(argv, out, deps({ reads: reads({ ...SERVER, ...model }) }))).toBe(0);
    const text = out.printed[0];
    expect(text).toContain(
      `The server halves, for Acme-Claims 1.0.0 and the conversion in ${conversion}:`,
    );
    expect(text).toContain(' 3  Model                      pass');
    expect(text).toContain(
      ' 5  Conditions                 not run: Evaluating each condition in Web UI needs the Studio package installed on this server',
    );
    expect(text).toContain(
      ' 6  What people see            not run: It needs the Studio package installed on this server, for Web UI to run it (Web UI serves 0 of its',
    );
    expect(text).toContain(' 7  What the server is asked   not run: It needs');

    // A server whose Dublin Core has no title fails check 3, and the run.
    const without = io();
    const bare = {
      ...model,
      'http://localhost:8080/nuxeo/api/v1/config/schemas': [
        { name: 'dublincore', '@prefix': 'dc', fields: {} },
      ],
    };
    expect(
      await lab(
        [...argv.slice(0, 2), fresh(), ...argv.slice(3)],
        without,
        deps({ reads: reads({ ...SERVER, ...bare }) }),
      ),
    ).toBe(1);
    expect(without.printed[0]).toContain(
      " 3  Model                      FAIL\n      - queues/claims.json columns.0: the server's schema dublincore has no field title, so dc:title does not exist",
    );

    // Web UI serving the package, and not yet the new app its conversion: 6 and 7 still wait.
    const served: Record<string, unknown> = { ...SERVER, ...model };
    for (const [path, bytes] of pkg.bundleFiles)
      if (path.startsWith('web/nuxeo.war/ui/'))
        served[`http://localhost:8080/nuxeo/ui/${path.slice('web/nuxeo.war/ui/'.length)}`] = bytes;
    const half = io();
    await lab(
      ['/ws/folder', '--out', fresh(), '--package', zip, '--conversion', conversion],
      half,
      deps({ reads: reads(served) }),
    );
    expect(half.printed[0]).toContain(
      ' 6  What people see            not run: It needs its conversion served to the new app (0 of its',
    );
    expect(half.printed[0]).not.toContain('the Studio package installed');

    // And with the conversion too: 6 and 7 stand on the documents.
    for (const path of readdirSync(join(conversion, 'app', 'layouts'), { recursive: true }))
      if (String(path).endsWith('.layout.json'))
        served[`http://localhost:4200/agentic-ui-config/layouts/${String(path)}`] = {
          format: 'nuxeo-agentic-ui-config/1',
          layer: 'layout',
          content: JSON.parse(
            readFileSync(join(conversion, 'app', 'layouts', String(path)), 'utf8'),
          ),
        };
    const both = io();
    expect(
      await lab(
        ['/ws/folder', '--out', fresh(), '--package', zip, '--conversion', conversion],
        both,
        deps({ reads: reads(served), record: recorder({ [FOLDER.uid]: 'browse' }) }),
      ),
    ).toBe(1);
    expect(both.printed[0]).toContain(
      ' 6  What people see            partial: On the document given: the values are not compared yet',
    );
    expect(both.printed[0]).toContain(
      ' 7  What the server is asked   FAIL\n      - document 1: Web UI shows dc:description',
    );
  });
});
