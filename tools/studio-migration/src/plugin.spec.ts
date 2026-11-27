import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, type CliIo } from './cli';
import { inventory } from './inventory';
import {
  behaviours,
  childNodeOptions,
  GENERATED_SAMPLES,
  PLUGIN_FILE,
  pluginFiles,
  pluginNames,
  PluginError,
  restampPlugin,
  scaffoldPlugin,
  templateConfiguration,
  type Spawn,
} from './plugin';
import { observedProblem } from './observed';
import { WORKSPACE } from './plugins';
import { readStudioPackage } from './studio-package';
import { M3_CUSTOM_BUNDLE, M3_OBSERVED, m3CorpusFiles } from './testing/m3-corpus';
import { syntheticPackage } from './testing/synthetic-package';

const archive = syntheticPackage({ bundle: m3CorpusFiles() });
const pkg = readStudioPackage(archive);
const read = inventory(pkg);
const exposure = read.customElements[0];

function run(argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: CliIo = {
    out: (text) => (out += text),
    err: (text) => (err += text),
    readFile: (path) => {
      if (path === 'acme.zip') return archive;
      throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' });
    },
  };
  return { code: main(argv, io), out, err };
}

describe('the plugin command', () => {
  it('names a plugin by its element, with the owner the element is prefixed with', () => {
    expect(pluginNames('acme-claim-exposure')).toEqual({
      element: 'acme-claim-exposure',
      owner: 'acme',
      library: 'libs/extensions/acme-claim-exposure',
      project: 'acme-claim-exposure',
      importPath: '@agentic-ui/acme-claim-exposure',
      className: 'AcmeClaimExposure',
      provider: 'provideAcmeClaimExposurePlugin',
      idsConstant: 'ACME_CLAIM_EXPOSURE_PLUGIN_IDS',
      textsConstant: 'ACME_CLAIM_EXPOSURE_TEXTS',
      componentId: 'acme.components.claimExposure',
      componentClass: 'AcmeClaimExposureComponent',
    });
    expect(pluginNames('acme-claim-exposure', 'contoso').componentId).toBe(
      'contoso.components.acmeClaimExposure',
    );
    expect(() => pluginNames('acme-claim-exposure', 'Not An Owner')).toThrow(PluginError);
  });

  it("writes the element's interface, its texts, and a test still to write for each behaviour", () => {
    const files = pluginFiles(pkg, read, exposure, pluginNames(exposure.name));
    const component = files['src/lib/acme-claim-exposure/acme-claim-exposure.ts'];
    expect(component).toContain('readonly document = input<NuxeoDocument | null>(null);');
    // The element's default, a literal, is the input's; nothing of its code is copied.
    expect(component).toContain('readonly threshold = input<number>(10000);');
    expect(component).toContain("templateUrl: './acme-claim-exposure.html'");
    expect(component).not.toMatch(/_outstanding|toFixed/);
    const spec = files['src/lib/acme-claim-exposure/acme-claim-exposure.spec.ts'];
    for (const behaviour of behaviours(exposure))
      expect(spec).toContain(behaviour.title.replace(/'/g, "\\'"));
    expect(spec.match(/it\.todo\(/g)?.length).toBe(behaviours(exposure).length);
    expect(files['src/lib/texts.ts']).toContain("'label.claim.outstanding': 'Outstanding',");
    expect(JSON.parse(files[PLUGIN_FILE])).toEqual({
      format: 'studio-migration-plugin/1',
      element: 'acme-claim-exposure',
      package: { name: 'Acme-Claims', version: '1.0.0' },
      definition: exposure.sha256,
      project: 'acme-claim-exposure',
      importPath: '@agentic-ui/acme-claim-exposure',
      provider: 'provideAcmeClaimExposurePlugin',
      component: 'acme.components.claimExposure',
    });
    // The README quotes the element for the person who writes the plugin.
    expect(files['README.md']).toContain('<dom-module id="acme-claim-exposure">');
  });

  it('runs the generator, takes its samples away, and writes the element’s files over it', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'studio-plugin-'));
    mkdirSync(join(workspace, 'node_modules', 'nx'), { recursive: true });
    writeFileSync(
      join(workspace, 'node_modules', 'nx', 'package.json'),
      '{"bin":{"nx":"./bin/nx.js"}}',
    );
    const calls: (readonly string[])[] = [];
    const generator: Spawn = (_command, args) => {
      calls.push(args);
      const root = join(workspace, 'libs', 'extensions', 'acme-claim-exposure');
      mkdirSync(join(root, 'src', 'lib', 'panel'), { recursive: true });
      writeFileSync(join(root, 'src', 'lib', 'rules.service.ts'), 'export class Sample {}');
      writeFileSync(join(root, 'src', 'lib', 'panel', 'acme-panel.ts'), 'export class Panel {}');
      return { status: 0, stdout: '', stderr: '', error: undefined };
    };
    const { names, written } = scaffoldPlugin(
      pkg,
      read,
      'acme-claim-exposure',
      { workspace },
      generator,
    );
    expect(calls[0]?.slice(1)).toEqual([
      'g',
      './tools/satori-generators:extension-library',
      'acme-claim-exposure',
      '--owner=acme',
      '--directory=libs/extensions',
      '--no-interactive',
    ]);
    const root = join(workspace, ...names.library.split('/'));
    for (const sample of GENERATED_SAMPLES) expect(existsSync(join(root, sample))).toBe(false);
    for (const path of written) expect(existsSync(join(root, path))).toBe(true);
    expect(readFileSync(join(root, PLUGIN_FILE), 'utf8')).toContain(
      '"element": "acme-claim-exposure"',
    );
    // Never over a library already there.
    expect(() =>
      scaffoldPlugin(pkg, read, 'acme-claim-exposure', { workspace }, generator),
    ).toThrow(/already exists, and the plugin command never writes over a library/);
  });

  it('refuses an element the package does not define, and a generator that writes nothing', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'studio-plugin-'));
    mkdirSync(join(workspace, 'node_modules', 'nx'), { recursive: true });
    writeFileSync(
      join(workspace, 'node_modules', 'nx', 'package.json'),
      '{"bin":{"nx":"./bin/nx.js"}}',
    );
    expect(() => scaffoldPlugin(pkg, read, 'acme-nothing', { workspace })).toThrow(
      'the package defines no custom element acme-nothing; its custom elements are acme-claim-exposure, acme-claim-escalate',
    );
    const failing: Spawn = () => ({
      status: 1,
      stdout: '',
      stderr: 'NX  no such generator',
      error: undefined,
    });
    expect(() => scaffoldPlugin(pkg, read, 'acme-claim-escalate', { workspace }, failing)).toThrow(
      'the generator did not write libs/extensions/acme-claim-escalate: NX  no such generator',
    );
    expect(run(['plugin', 'acme.zip', 'acme-nothing']).code).toBe(1);
  });

  it("records the element's definition anew with --restamp, and nothing else of the plugin", () => {
    const workspace = mkdtempSync(join(tmpdir(), 'studio-plugin-'));
    const root = join(workspace, 'libs', 'extensions', 'acme-claim-exposure');
    mkdirSync(root, { recursive: true });
    const stale = {
      element: 'acme-claim-exposure',
      package: { name: 'Acme-Claims', version: '0.9.0' },
      definition: 'old',
      component: 'acme.components.claimExposure',
    };
    writeFileSync(join(root, PLUGIN_FILE), JSON.stringify(stale));
    const stamped = restampPlugin(pkg, read, 'acme-claim-exposure', { workspace });
    expect(stamped).toEqual({
      library: 'libs/extensions/acme-claim-exposure',
      from: 'old',
      to: exposure.sha256,
    });
    expect(JSON.parse(readFileSync(join(root, PLUGIN_FILE), 'utf8'))).toEqual({
      ...stale,
      package: { name: 'Acme-Claims', version: '1.0.0' },
      definition: exposure.sha256,
    });
    expect(() => restampPlugin(pkg, read, 'acme-claim-escalate', { workspace })).toThrow(
      'libs/extensions/acme-claim-escalate/studio-plugin.json is not there: write the plugin with the plugin command first',
    );
  });

  it('refuses an observed behaviour of the wrong shape, rather than misreading it', () => {
    expect(observedProblem(M3_OBSERVED)).toBeNull();
    const element = M3_OBSERVED.elements['acme-claim-escalate'];
    const broken = (records: unknown[]): unknown => ({
      ...M3_OBSERVED,
      elements: { 'acme-claim-escalate': { ...element, records } },
    });
    expect(
      observedProblem(
        broken([
          { record: 'claim-cl-1001', shows: '', clicks: [{ button: 'Escalate', asks: null }] },
        ]),
      ),
    ).toBe(
      'acme-claim-escalate, on claim-cl-1001: events are a list of an event and its detail each',
    );
    expect(
      observedProblem(
        broken([
          {
            record: 'claim-cl-1001',
            shows: '',
            clicks: [{ button: 'Escalate', asks: { input: 'x' }, fires: [] }],
          },
        ]),
      ),
    ).toBe('acme-claim-escalate, on claim-cl-1001: a request names its operation');
    expect(observedProblem(broken([{ record: 'nobody', shows: '' }]))).toBe(
      'acme-claim-escalate: nobody is none of its records',
    );
  });

  it('gives a child Node its options less any loader of the caller’s', () => {
    const before = process.env['NODE_OPTIONS'];
    process.env['NODE_OPTIONS'] =
      '--no-experimental-webstorage --import file:///loader.mjs --require=x.cjs';
    try {
      expect(childNodeOptions('--no-experimental-strip-types')).toBe(
        '--no-experimental-webstorage --no-experimental-strip-types',
      );
    } finally {
      if (before === undefined) delete process.env['NODE_OPTIONS'];
      else process.env['NODE_OPTIONS'] = before;
    }
  });

  it("renders the template's build and test configuration for a library", () => {
    const files = templateConfiguration(WORKSPACE, 'libs/extensions/acme-claim-exposure');
    expect(files['tsconfig.lib.json']).toContain('"rootDir": "../../.."');
    expect(files['vite.config.mts']).toContain("name: 'acme-claim-exposure'");
    expect(files['vite.config.mts']).not.toContain('<%=');
  });
});

describe('the command line, on the made-up custom elements', () => {
  it('prints each custom element in the inventory', () => {
    const { out } = run(['inventory', 'acme.zip']);
    expect(out).toContain('Custom elements: 2\n  acme-claim-exposure, in ' + M3_CUSTOM_BUNDLE);
    expect(out).toContain('    fires: claim-escalated, document-updated, notify');
    expect(out).toContain(
      '    as a plugin: inputs document, reason; outputs claimEscalated, documentUpdated, notify',
    );
  });

  it('runs check 9 on the plugins of this repository, in part until they are run', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'studio-m3-')), 'conversion');
    expect(run(['convert', 'acme.zip', out]).code).toBe(0);
    const checked = run(['check', 'acme.zip', out]);
    expect(checked.out).toMatch(
      /\n 9 {2}Plugins {20}partial: acme-claim-exposure's tests, gates and values were not run; acme-claim-escalate's tests, gates and values were not run\./,
    );
    expect(checked.code).toBe(0);
  });
});
