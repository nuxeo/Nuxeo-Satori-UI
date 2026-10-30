import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import * as prettier from 'prettier';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import configPackageGenerator from './generator';

const ROOT = 'config-packages/acme-config';

/** The entries of a zip, read from its central directory. Enough for archives `build.mjs` writes. */
function unzip(archive: Buffer): Map<string, Buffer> {
  const end = archive.length - 22;
  if (archive.readUInt32LE(end) !== 0x06054b50)
    throw new Error('no end-of-central-directory record');
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    const compressed = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const localOffset = archive.readUInt32LE(at + 42);
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength);
    const localName = archive.readUInt16LE(localOffset + 26);
    const localExtra = archive.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    files.set(name, inflateRawSync(archive.subarray(start, start + compressed)));
    at += 46 + nameLength;
  }
  return files;
}

describe('config-package generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('writes a package ordered after Satori: the package dependency and the component require', async () => {
    await configPackageGenerator(tree, { name: 'acme-config', owner: 'acme' });

    const packageXml = tree.read(`${ROOT}/package/package.xml`, 'utf8') ?? '';
    expect(packageXml).toContain('<package type="addon" name="acme-config" version="1.0.0">');
    // The floor is load-bearing, not decorative: below `2026.0.2` the component this
    // package `<require>`s does not exist and Nuxeo refuses to start, so a generated
    // package that depended on `nuxeo-agentic-ui` unbounded would be installable onto a
    // server it breaks.
    expect(packageXml).toContain('<package>nuxeo-agentic-ui:2026.0.2</package>');

    const component = tree.read(`${ROOT}/bundle/OSGI-INF/acme-config-config.xml`, 'utf8') ?? '';
    expect(component).toContain('<component name="acme.config.acme-config"');
    expect(component).toContain('<require>org.nuxeo.agentic.ui.config.defaults</require>');
    expect(component).toContain('layer="bootstrap" src="agentic-ui-config/bootstrap.json"');
    expect(component).toContain('layer="manifest" src="agentic-ui-config/manifest.json"');

    expect(tree.read(`${ROOT}/bundle/META-INF/MANIFEST.MF`, 'utf8')).toContain(
      'Nuxeo-Component: OSGI-INF/acme-config-config.xml',
    );
    expect(
      JSON.parse(tree.read(`${ROOT}/bundle/agentic-ui-config/bootstrap.json`, 'utf8') ?? ''),
    ).toEqual({
      $schema: '../../schema/bootstrap.schema.json',
      branding: { applicationTitle: 'Acme Config', documentTitle: 'Acme Config' },
    });

    const project = readProjectConfiguration(tree, 'acme-config');
    expect(project.tags).toEqual(['scope:customer', 'type:config']);
    expect(project.targets?.['build']?.options?.command).toBe(
      `node ${ROOT}/build.mjs --out dist/${ROOT}`,
    );
  });

  it('adds a presales block, preset switching on, only when asked', async () => {
    await configPackageGenerator(tree, { name: 'acme-config', owner: 'acme', presales: true });
    const bootstrap = JSON.parse(
      tree.read(`${ROOT}/bundle/agentic-ui-config/bootstrap.json`, 'utf8') ?? '',
    );
    expect(bootstrap.presales.presetSwitching).toBe(true);
    expect(Object.keys(bootstrap.presales.presets)).toEqual(['example']);

    const plain = createTreeWithEmptyWorkspace();
    await configPackageGenerator(plain, { name: 'acme-config', owner: 'acme' });
    expect(plain.read(`${ROOT}/bundle/agentic-ui-config/bootstrap.json`, 'utf8')).not.toContain(
      'presales',
    );
  });

  it('escapes the title and vendor into package.xml', async () => {
    await configPackageGenerator(tree, {
      name: 'acme-config',
      owner: 'acme',
      title: 'Acme <Claims> & Co',
      vendor: 'Acme "Insurance"',
    });
    const packageXml = tree.read(`${ROOT}/package/package.xml`, 'utf8') ?? '';
    expect(packageXml).toContain('<title>Acme &lt;Claims&gt; &amp; Co</title>');
    expect(packageXml).toContain('<vendor>Acme &#34;Insurance&#34;</vendor>');
  });

  it('writes every file but project.json as Prettier formats it, though it runs no Prettier', async () => {
    const workspace = join(__dirname, '../../../..');
    let checked = 0;
    for (const presales of [false, true]) {
      const generated = createTreeWithEmptyWorkspace();
      await configPackageGenerator(generated, { name: 'acme-config', owner: 'acme', presales });
      for (const change of generated.listChanges()) {
        // Nx's own JSON.stringify, one array item per line, as for any project it adds.
        if (!change.path.startsWith(`${ROOT}/`) || change.path.endsWith('/project.json')) continue;
        const filepath = join(workspace, change.path);
        if (!(await prettier.getFileInfo(filepath)).inferredParser) continue;
        const text = change.content?.toString('utf8') ?? '';
        const config = await prettier.resolveConfig(filepath);
        expect(await prettier.format(text, { ...config, filepath }), change.path).toBe(text);
        checked++;
      }
    }
    // README.md, build.mjs, both fragments, both schemas and assets/README.md, twice.
    expect(checked).toBe(14);
  });

  it.each(['customer configs', '../outside', 'a;b', 'a/./b', '-configs', 'customers/-acme'])(
    'refuses --directory "%s", which the build command cannot carry unquoted',
    async (directory) => {
      await expect(
        configPackageGenerator(tree, { name: 'acme-config', owner: 'acme', directory }),
      ).rejects.toThrow(/must be a relative path/);
    },
  );

  it('accepts a nested --directory', async () => {
    await configPackageGenerator(tree, {
      name: 'acme-config',
      owner: 'acme',
      directory: 'customers/acme',
    });
    expect(readProjectConfiguration(tree, 'acme-config').targets?.['build']?.options?.command).toBe(
      'node customers/acme/acme-config/build.mjs --out dist/customers/acme/acme-config',
    );
  });

  it('refuses a name over 128 characters, the server’s limit for the fragment name it becomes', async () => {
    const longest = `a${'-b'.repeat(63)}a`;
    expect(longest).toHaveLength(128);
    await expect(
      configPackageGenerator(tree, { name: longest, owner: 'acme' }),
    ).resolves.toBeDefined();
    await expect(
      configPackageGenerator(createTreeWithEmptyWorkspace(), {
        name: `${longest}x`,
        owner: 'acme',
      }),
    ).rejects.toThrow(/129 characters; a fragment name may have at most 128/);
  });

  // NXSAT-729. The package name is copied into three namespaces it does not own — the fragment
  // name in the component XML, the Marketplace package name, and a directory on disk — and the
  // only uniqueness check there was looked at this workspace's directories. A package named
  // `defaults` contributes `fragment bootstrap/defaults`, which is the key Satori's own packaged
  // defaults occupy, and `ContributionRegistry.resolve()` lets the later contribution take it.
  describe('refuses a name it does not own', () => {
    it.each([
      ['defaults', /Satori itself uses/],
      ['nuxeo-agentic-ui', /Satori itself uses/],
    ])('%s, which Satori itself uses', async (name, message) => {
      await expect(configPackageGenerator(tree, { name, owner: 'acme' })).rejects.toThrow(message);
    });

    it('names what it clashes with, rather than only saying no', async () => {
      await expect(
        configPackageGenerator(tree, { name: 'defaults', owner: 'acme' }),
      ).rejects.toThrow(/replaces them on the server/);
      await expect(
        configPackageGenerator(tree, { name: 'nuxeo-agentic-ui', owner: 'acme' }),
      ).rejects.toThrow(/every configuration package depends on/);
    });

    // The name becomes a directory, and a directory with one of these names cannot be created on
    // Windows — so one generated on macOS leaves a repository that cannot be checked out there.
    it.each(['con', 'prn', 'aux', 'nul', 'com1', 'com0', 'com9', 'lpt1', 'lpt0', 'lpt9'])(
      '%s, a device name Windows reserves',
      async (name) => {
        await expect(configPackageGenerator(tree, { name, owner: 'acme' })).rejects.toThrow(
          /device name Windows reserves/,
        );
      },
    );

    // The same harm through the other option that becomes a directory. Mixed case and a trailing
    // extension both reach the same device on Windows, and `--directory` — unlike the name —
    // permits both.
    it.each(['con', 'customers/nul', 'CON', 'con.v1', 'customers/Nul.old'])(
      'a --directory segment "%s", for the same reason',
      async (directory) => {
        await expect(
          configPackageGenerator(tree, { name: 'acme-config', owner: 'acme', directory }),
        ).rejects.toThrow(/device name Windows reserves/);
      },
    );

    // Satori's names are refused as a package name only: a parent directory is neither a
    // fragment name nor a Marketplace package name, so it clashes with nothing.
    it('accepts "defaults" as a --directory segment, which clashes with nothing', async () => {
      await expect(
        configPackageGenerator(tree, { name: 'acme-config', owner: 'acme', directory: 'defaults' }),
      ).resolves.toBeDefined();
    });

    it.each(['acme-config', 'contoso-claims', 'constellation', 'aux-config', 'nul2', 'defaults2'])(
      'still accepts "%s", so the refusal is the listed names and not a prefix',
      async (name) => {
        await expect(
          configPackageGenerator(createTreeWithEmptyWorkspace(), { name, owner: 'acme' }),
        ).resolves.toBeDefined();
      },
    );

    it('writes nothing when it refuses', async () => {
      // The paths, not their count: a refusal that wrote one file and removed another would
      // leave the count alone, and "writes nothing" is a claim about the files.
      const paths = () =>
        tree
          .listChanges()
          .map((change) => change.path)
          .sort();
      const before = paths();
      await expect(
        configPackageGenerator(tree, { name: 'defaults', owner: 'acme' }),
      ).rejects.toThrow();
      expect(paths()).toEqual(before);
    });
  });

  it.each([
    [{ owner: 'Acme Corp' }, /--owner "Acme Corp" must be/],
    [{ owner: 'acme', version: '1.0' }, /--version "1\.0" must be/],
  ])('refuses %j when called directly, as the CLI schema would', async (options, message) => {
    await expect(configPackageGenerator(tree, { name: 'acme-config', ...options })).rejects.toThrow(
      message,
    );
  });

  it('refuses to overwrite an existing package unless forced', async () => {
    await configPackageGenerator(tree, { name: 'acme-config', owner: 'acme' });
    await expect(
      configPackageGenerator(tree, { name: 'acme-config', owner: 'acme' }),
    ).rejects.toThrow(/already exists/);
    await expect(
      configPackageGenerator(tree, { name: 'acme-config', owner: 'acme', force: true }),
    ).resolves.toBeDefined();
  });
});

describe('the generated build.mjs', () => {
  let dir: string;

  /** Generate into a real directory, so the generated script runs as a customer would run it. */
  async function generate(presales = false, name = 'acme-config'): Promise<void> {
    const tree = createTreeWithEmptyWorkspace();
    await configPackageGenerator(tree, { name, owner: 'acme', presales });
    const root = `config-packages/${name}`;
    for (const change of tree.listChanges()) {
      if (!change.path.startsWith(`${root}/`) || !change.content) continue;
      const target = join(dir, change.path.slice(root.length + 1));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, change.content);
    }
  }

  function build(env: NodeJS.ProcessEnv = process.env): {
    status: number;
    output: string;
    zip?: Buffer;
  } {
    try {
      const output = execFileSync(
        process.execPath,
        [join(dir, 'build.mjs'), '--out', join(dir, 'out')],
        {
          encoding: 'utf8',
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const [zip] = readdirSync(join(dir, 'out')).filter((file) => file.endsWith('.zip'));
      return { status: 0, output, zip: readFileSync(join(dir, 'out', zip)) };
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string };
      return { status: failure.status, output: `${failure.stdout}${failure.stderr}` };
    }
  }

  const write = (path: string, content: string) => writeFileSync(join(dir, path), content);
  const fragment = 'bundle/agentic-ui-config/bootstrap.json';
  const componentXml = 'bundle/OSGI-INF/acme-config-config.xml';
  /** Adds entries to the generated component's extension, after the two fragments it ships. */
  const contribute = (entries: string) =>
    write(
      componentXml,
      readFileSync(join(dir, componentXml), 'utf8').replace(
        '</extension>',
        `${entries}\n  </extension>`,
      ),
    );

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'config-package-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a Marketplace zip holding the bundle, manifest first, without $schema or Markdown', async () => {
    await generate(true);
    const { status, zip } = build();
    expect(status).toBe(0);

    const archive = unzip(zip as Buffer);
    expect([...archive.keys()]).toEqual([
      'install.xml',
      'install/bundles/acme-config.jar',
      'package.xml',
    ]);
    const jar = unzip(archive.get('install/bundles/acme-config.jar') as Buffer);
    // By code point after the manifest: upper case before lower, whatever the locale says.
    expect([...jar.keys()]).toEqual([
      'META-INF/MANIFEST.MF',
      'OSGI-INF/acme-config-config.xml',
      'agentic-ui-config/bootstrap.json',
      'agentic-ui-config/manifest.json',
    ]);
    const packaged = JSON.parse(
      jar.get('agentic-ui-config/bootstrap.json')?.toString('utf8') ?? '',
    );
    expect(packaged.$schema).toBeUndefined();
    expect(packaged.presales.presetSwitching).toBe(true);
  });

  it('is reproducible: the same source builds the same bytes, whenever it is built', async () => {
    await generate();
    const digest = () =>
      createHash('sha256')
        .update(build().zip as Buffer)
        .digest('hex');
    const first = digest();
    // Past the 2-second resolution of a zip timestamp, so a build stamping the clock would differ.
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(digest()).toBe(first);
  });

  it('builds the same bytes whatever the machine’s locale', async () => {
    await generate();
    // English collation puts "ia" first (i and I are one letter); Turkish puts "Iz" first (I is ı).
    write('bundle/agentic-ui-config/assets/ia.svg', '<svg/>');
    write('bundle/agentic-ui-config/assets/Iz.svg', '<svg/>');
    const digestIn = (locale: string) =>
      createHash('sha256')
        .update(build({ ...process.env, LC_ALL: locale, LANG: locale }).zip as Buffer)
        .digest('hex');
    expect(digestIn('tr_TR.UTF-8')).toBe(digestIn('en_US.UTF-8'));
  });

  it.each([
    [
      'a repeated key',
      '{ "branding": {}, "branding": {} }',
      /duplicate key "branding" in the top level/,
    ],
    [
      'a nested repeated key',
      '{ "sso": { "postLoginPath": "/a", "postLoginPath": "/b" } }',
      /duplicate key "postLoginPath" in sso/,
    ],
    ['JSON that does not parse', '{ "branding": ', /bootstrap\.json: /],
    ['a fragment that is not an object', '[{ "branding": {} }]', /must be a JSON object/],
  ])('refuses %s, naming the file', async (_case, content, message) => {
    await generate();
    write(fragment, content);
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toContain('bundle/agentic-ui-config/bootstrap.json');
    expect(output).toMatch(message);
  });

  it('refuses a fragment over the server’s 1 MiB limit', async () => {
    await generate();
    write(fragment, JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }));
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toMatch(
      /packaged as \d+ bytes; the server refuses a fragment or layout over 1048576/,
    );
  });

  it('measures the limit on what is packaged, not on the source', async () => {
    await generate();
    // Over 1 MiB as written, well under once packaged compact — what the server reads.
    const spaced = `{\n${' '.repeat(1024 * 1024)}"branding": { "applicationTitle": "Acme" }\n}`;
    write(fragment, spaced);
    expect(build().status).toBe(0);
  });

  it.each([
    ['single quotes', `<asset name='logo.svg' src='agentic-ui-config/assets/logo.svg' />`],
    ['spaces around =', `<asset name = "logo.svg" src = "agentic-ui-config/assets/logo.svg" />`],
  ])('reads attributes written with %s', async (_case, element) => {
    await generate();
    const xml = readFileSync(join(dir, componentXml), 'utf8');
    write(componentXml, xml.replace('</extension>', `${element}\n  </extension>`));
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toContain('src="agentic-ui-config/assets/logo.svg" names no file in bundle/');
  });

  it('finds the extension target however it is quoted', async () => {
    await generate();
    const xml = readFileSync(join(dir, componentXml), 'utf8')
      .replace(/<require>[^<]*<\/require>/, '')
      .replace('target="org.nuxeo.agentic.ui.config"', "target = 'org.nuxeo.agentic.ui.config'");
    write(componentXml, xml);
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toMatch(/must <require>org\.nuxeo\.agentic\.ui\.config\.defaults<\/require>/);
  });

  describe('an asset', () => {
    const withAsset = async (name: string, bytes: number) => {
      await generate();
      writeFileSync(join(dir, 'bundle/agentic-ui-config/assets', name), Buffer.alloc(bytes, 0x20));
      const xml = readFileSync(join(dir, componentXml), 'utf8');
      write(
        componentXml,
        xml.replace(
          '</extension>',
          `<asset name="${name}" src="agentic-ui-config/assets/${name}" />\n  </extension>`,
        ),
      );
      return build();
    };

    it('is accepted as a plain image file name', async () => {
      expect((await withAsset('acme-logo.svg', 100)).status).toBe(0);
    });

    it('is refused when its name is not an image file name, as the server would', async () => {
      const { status, output } = await withAsset('logo.html', 100);
      expect(status).toBe(1);
      expect(output).toMatch(/asset name "logo\.html" must be a plain file name ending in \.svg/);
    });

    it('is refused over the server’s 2 MiB limit', async () => {
      const { status, output } = await withAsset('big.png', 2 * 1024 * 1024 + 1);
      expect(status).toBe(1);
      expect(output).toMatch(/2097153 bytes; the server refuses an asset over 2097152/);
    });

    it('has no body to check when disabled, by any value Nuxeo reads as false', async () => {
      await generate();
      contribute(
        '<asset name="old-logo.svg" src="gone" enabled="false" />\n' +
          '<asset name="older-logo.svg" src="gone" enabled="no" />',
      );
      expect(build().status).toBe(0);
    });

    it('is refused for a bad name even when disabled, as the server validates it first', async () => {
      await generate();
      contribute('<asset name="old.html" src="gone" enabled="false" />');
      const { status, output } = build();
      expect(status).toBe(1);
      expect(output).toMatch(/asset name "old\.html" must be a plain file name/);
    });
  });

  it.each([
    [
      'a fragment layer',
      '<fragment name="x" layer="bootstap" src="a.json" />',
      /has layer "bootstap"/,
    ],
    [
      'a fragment name',
      '<fragment name="a b" layer="bootstrap" src="a.json" />',
      /fragment name "a b"/,
    ],
    ['a layout type', '<layout type="1File" mode="view" src="a.json" />', /layout type "1File"/],
    ['a layout mode', '<layout type="File" mode="View" src="a.json" />', /layout mode "View"/],
  ])('refuses %s the server rejects', async (_case, element, message) => {
    await generate();
    contribute(element);
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toMatch(message);
  });

  describe('a fragment or layout body', () => {
    it('is checked when its file is not called .json, and packaged compact', async () => {
      await generate();
      write('bundle/agentic-ui-config/labels.txt', '{\n  "labels": {}\n}\n');
      contribute('<fragment name="labels" layer="manifest" src="agentic-ui-config/labels.txt" />');
      const { status, zip } = build();
      expect(status).toBe(0);
      const jar = unzip(unzip(zip as Buffer).get('install/bundles/acme-config.jar') as Buffer);
      expect(jar.get('agentic-ui-config/labels.txt')?.toString('utf8')).toBe('{"labels":{}}');

      write('bundle/agentic-ui-config/labels.txt', '{ "labels": {}, "labels": {} }');
      const refused = build();
      expect(refused.status).toBe(1);
      expect(refused.output).toMatch(/labels\.txt: duplicate key "labels" in the top level/);
    });

    it('is checked when inline, references and CDATA read as the server reads them', async () => {
      await generate();
      contribute(
        '<fragment name="labels" layer="manifest"><json>{ &quot;labels&quot;: {} }</json></fragment>\n' +
          '<layout type="File" mode="view"><json><![CDATA[{ "a": 1, "b": "<&>" }]]></json></layout>',
      );
      expect(build().status).toBe(0);

      contribute(
        '<fragment name="dup" layer="bootstrap"><json><![CDATA[{ "branding": {}, "branding": {} }]]></json></fragment>\n' +
          '<layout type="Note" mode="edit"><json>[1]</json></layout>',
      );
      const { status, output } = build();
      expect(status).toBe(1);
      expect(output).toMatch(
        /inline JSON of fragment "dup" in bootstrap: duplicate key "branding" in the top level/,
      );
      expect(output).toMatch(/inline JSON of layout Note\/edit: must be a JSON object/);
    });

    it('keeps comment markers and markup inside CDATA as text', async () => {
      await generate();
      contribute(
        `<fragment name="marks" layer="manifest"><json><![CDATA[{ "labels": { "a": "<!--", "b": "<asset name='x.html'/>", "c": "-- --->", "d": "<?pi <require/> ?>" } }]]></json></fragment>`,
      );
      expect(build().status).toBe(0);

      contribute(
        `<fragment name="hidden" layer="manifest"><json><![CDATA[{ "labels": { "a": "<!--", "a": "-->" } }]]></json></fragment>`,
      );
      const { status, output } = build();
      expect(status).toBe(1);
      expect(output).toMatch(
        /inline JSON of fragment "hidden" in manifest: duplicate key "a" in labels/,
      );
    });

    it('is refused when it has both a src and inline JSON, or neither', async () => {
      await generate();
      contribute(
        '<fragment name="both" layer="manifest" src="agentic-ui-config/manifest.json"><json>{}</json></fragment>\n' +
          '<fragment name="neither" layer="manifest" />\n' +
          '<asset name="nothing.svg" />',
      );
      const { status, output } = build();
      expect(status).toBe(1);
      expect(output).toMatch(/fragment "both" in manifest has both a src and inline JSON; use one/);
      expect(output).toMatch(/fragment "neither" in manifest has neither a src nor inline JSON/);
      expect(output).toMatch(/asset "nothing\.svg" has no src/);
    });
  });

  it.each([
    ['a directory', 'agentic-ui-config', /src="agentic-ui-config" names no file in bundle\//],
    [
      'a Markdown file, which is not packaged',
      'agentic-ui-config/assets/README.md',
      /names a Markdown file, which is not packaged/,
    ],
  ])('refuses a src naming %s', async (_case, src, message) => {
    await generate();
    contribute(`<fragment name="x" layer="manifest" src="${src}" />`);
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toMatch(message);
  });

  it('refuses bundle/ or package metadata that is itself a symbolic link', async () => {
    await generate();
    renameSync(join(dir, 'bundle'), join(dir, 'reviewed-elsewhere'));
    symlinkSync(join(dir, 'reviewed-elsewhere'), join(dir, 'bundle'));
    renameSync(join(dir, 'package/package.xml'), join(dir, 'package.xml'));
    symlinkSync(join(dir, 'package.xml'), join(dir, 'package/package.xml'));
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toMatch(/^\s+- bundle: is a symbolic link/m);
    expect(output).toContain('package/package.xml: is a symbolic link');
  });

  it.each([
    ['a name that leaves the output directory', 'name="acme-config"', 'name="../escaped"'],
    ['a version that is a path', 'version="1.0.0"', 'version="1.0.0/../../x"'],
  ])('refuses %s', async (_case, from, to) => {
    await generate();
    const file = 'package/package.xml';
    write(file, readFileSync(join(dir, file), 'utf8').replace(from, to));
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toMatch(/must each be letters, digits, "\.", "_" and "-"/);
  });

  it.each([
    ['outside bundle/', '../outside.xml'],
    ['a Markdown file, which is not packaged', 'agentic-ui-config/assets/README.md'],
  ])('refuses a Nuxeo-Component naming %s', async (_case, path) => {
    await generate();
    write('outside.xml', '<component name="outside"/>');
    write('bundle/META-INF/MANIFEST.MF', `Manifest-Version: 1.0\nNuxeo-Component: ${path}\n`);
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toContain(
      `Nuxeo-Component names ${path}, which is not a packaged file in bundle/`,
    );
  });

  it('reads a Nuxeo-Component line continued as a JAR manifest continues it', async () => {
    await generate();
    write(
      'bundle/META-INF/MANIFEST.MF',
      'Manifest-Version: 1.0\nNuxeo-Component: OSGI-INF/acme-config-co\n nfig.xml\n',
    );
    expect(build().status).toBe(0);
  });

  it.each([
    [
      'an unclosed element',
      (xml: string) => xml.replace('</extension>', ''),
      /<\/component> closes <extension>/,
    ],
    [
      'a truncated file',
      (xml: string) => xml.replace('</component>', ''),
      /<component> is never closed/,
    ],
    ['an unterminated comment', (xml: string) => `${xml}\n<!-- `, /unterminated comment/],
    [
      'an unterminated CDATA section',
      (xml: string) =>
        xml.replace(
          '</extension>',
          '<fragment name="x" layer="manifest"><json><![CDATA[{}</json></fragment></extension>',
        ),
      /unterminated CDATA section/,
    ],
    [
      'a bare "&"',
      (xml: string) => xml.replace('<extension', '<!-- & --><extension a="b & c"'),
      /"&" that starts no reference/,
    ],
    [
      'a comment containing "--"',
      (xml: string) => xml.replace('<extension', '<!-- generated with --presales --><extension'),
      /a comment containing "--"/,
    ],
    [
      'a comment ending in "-"',
      (xml: string) => xml.replace('<extension', '<!-- a ---><extension'),
      /a comment containing "--"/,
    ],
    [
      'an element name starting with a digit',
      (xml: string) => xml.replace('</extension>', '<1invalid/></extension>'),
      /a tag with no valid element name/,
    ],
    [
      'an undeclared namespace prefix',
      (xml: string) =>
        xml.replace('</extension>', '<x:fragment name="a" layer="manifest" src="b"/></extension>'),
      /the undeclared prefix x on x:fragment/,
    ],
    [
      'a control character',
      (xml: string) => xml.replace('<extension', '<!-- \u0001 --><extension'),
      /a character XML does not allow, U\+0001/,
    ],
    [
      'a reference to U+0000',
      (xml: string) => xml.replace('<extension', '<extension a="&#0;"'),
      /a reference to a character XML does not allow/,
    ],
    [
      'a DOCTYPE',
      (xml: string) => xml.replace('<component', '<!DOCTYPE component>\n<component'),
      /a DOCTYPE/,
    ],
    [
      '"]]>" in text',
      (xml: string) => xml.replace('</extension>', 'a ]]> b</extension>'),
      /a "]]>" in text/,
    ],
    [
      'an encoding other than UTF-8',
      (xml: string) =>
        xml.replace('<?xml version="1.0"?>', '<?xml version="1.0" encoding="ISO-8859-1"?>'),
      /an encoding of ISO-8859-1/,
    ],
    [
      'a second XML declaration',
      (xml: string) => xml.replace('<component', '<?xml version="1.0"?><component'),
      /an XML declaration that is not at the start/,
    ],
    [
      'attributes run together',
      (xml: string) => xml.replace('point="configuration"', 'point="configuration"a="b"'),
      /a malformed start tag <extension>/,
    ],
  ])('refuses component XML that is not well-formed: %s', async (_case, edit, message) => {
    await generate();
    write(componentXml, edit(readFileSync(join(dir, componentXml), 'utf8')));
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toContain('bundle/OSGI-INF/acme-config-config.xml: is not well-formed XML');
    expect(output).toMatch(message);
  });

  it('builds the untouched scaffold of a 128-character name', async () => {
    const longest = `a${'-b'.repeat(63)}a`;
    await generate(false, longest);
    const { status, zip } = build();
    expect(status).toBe(0);
    expect([...unzip(zip as Buffer).keys()]).toContain(`install/bundles/${longest}.jar`);
  });

  it('does not read markup written inside a processing instruction', async () => {
    await generate();
    write(
      componentXml,
      readFileSync(join(dir, componentXml), 'utf8').replace(
        /<require>([^<]*)<\/require>/,
        '<?probe <require>$1</require> ?>',
      ),
    );
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toMatch(/must <require>org\.nuxeo\.agentic\.ui\.config\.defaults<\/require>/);
  });

  it.each([
    [
      'a fragment',
      'bundle/agentic-ui-config/bootstrap.json',
      '{ "branding": { "applicationTitle": "Caf',
      '" } }',
    ],
    [
      'the manifest',
      'bundle/META-INF/MANIFEST.MF',
      'Manifest-Version: 1.0\nNuxeo-Component: OSGI-INF/acme-config-config.xml\nBundle-Name: Caf',
      '\n',
    ],
  ])(
    'refuses %s that is not valid UTF-8, rather than packaging it changed',
    async (_case, path, before, after) => {
      await generate();
      // "Café" as Windows-1252 writes it: 0xE9 is not UTF-8 on its own.
      writeFileSync(
        join(dir, path),
        Buffer.concat([Buffer.from(before), Buffer.from([0xe9]), Buffer.from(after)]),
      );
      const { status, output } = build();
      expect(status).toBe(1);
      expect(output).toContain(`${path}: is not valid UTF-8`);
    },
  );

  it('refuses component XML that is not valid UTF-8', async () => {
    await generate();
    const xml = readFileSync(join(dir, componentXml));
    writeFileSync(
      join(dir, componentXml),
      Buffer.concat([xml.subarray(0, 30), Buffer.from([0xc3, 0x28]), xml.subarray(30)]),
    );
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toContain('bundle/OSGI-INF/acme-config-config.xml: is not valid UTF-8');
  });

  it('accepts well-formed XML the extraction must read past: a ">" in a value, space in a tag', async () => {
    await generate();
    write(
      componentXml,
      readFileSync(join(dir, componentXml), 'utf8')
        .replace(/<require>([^<]*)<\/require>/, '<require >$1</require >')
        .replace(
          '</extension>',
          `<asset title="a>b" name="logo.svg" src="agentic-ui-config/assets/logo.svg" />\n  </extension>`,
        ),
    );
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).not.toMatch(/must <require>/);
    expect(output).toContain('src="agentic-ui-config/assets/logo.svg" names no file in bundle/');
  });

  it('reads a fragment with a byte-order mark, as the server does, and packages it without', async () => {
    await generate();
    write(fragment, '\uFEFF{ "branding": { "applicationTitle": "Acme" } }');
    const { status, zip } = build();
    expect(status).toBe(0);
    const jar = unzip(unzip(zip as Buffer).get('install/bundles/acme-config.jar') as Buffer);
    expect(jar.get('agentic-ui-config/bootstrap.json')?.toString('utf8')).toBe(
      '{"branding":{"applicationTitle":"Acme"}}',
    );
  });

  it.each([
    [
      'inside bundle/, where the zip would be packaged next time',
      ['--out', 'bundle/out'],
      /is inside bundle\//,
    ],
    ['with no directory', ['--out'], /--out needs a directory/],
  ])('refuses --out %s', async (_case, args, message) => {
    await generate();
    let failure: { status: number; stderr: string } | undefined;
    try {
      execFileSync(process.execPath, [join(dir, 'build.mjs'), ...args], {
        cwd: dir,
        stdio: 'pipe',
      });
    } catch (error) {
      failure = error as { status: number; stderr: string };
    }
    expect(failure?.status).toBe(2);
    expect(String(failure?.stderr)).toMatch(message);
  });

  it('refuses a symbolic link in bundle/, to a file or a directory, rather than following it', async () => {
    await generate();
    writeFileSync(join(dir, 'outside.txt'), 'not part of the package');
    symlinkSync(join(dir, 'outside.txt'), join(dir, 'bundle/agentic-ui-config/assets/logo.svg'));
    mkdirSync(join(dir, 'elsewhere'));
    symlinkSync(join(dir, 'elsewhere'), join(dir, 'bundle/agentic-ui-config/linked'));
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toContain('bundle/agentic-ui-config/assets/logo.svg: is a symbolic link');
    expect(output).toContain('bundle/agentic-ui-config/linked: is a symbolic link');
  });

  it('refuses a component that does not require Satori’s defaults', async () => {
    await generate();
    write(
      componentXml,
      readFileSync(join(dir, componentXml), 'utf8').replace(/<require>[^<]*<\/require>/, ''),
    );
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toMatch(/must <require>org\.nuxeo\.agentic\.ui\.config\.defaults<\/require>/);
  });

  it('does not count a commented-out require', async () => {
    await generate();
    const xml = readFileSync(join(dir, componentXml), 'utf8');
    write(
      componentXml,
      xml.replace(/<require>([^<]*)<\/require>/, '<!-- <require>$1</require> -->'),
    );
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toMatch(/must <require>org\.nuxeo\.agentic\.ui\.config\.defaults<\/require>/);
  });

  it('refuses a src that names no file, and ignores the commented-out example', async () => {
    await generate();
    const xml = readFileSync(join(dir, componentXml), 'utf8');
    expect(build().status).toBe(0);

    write(
      componentXml,
      xml.replace(
        '</extension>',
        '<asset name="logo.svg" src="agentic-ui-config/assets/logo.svg" />\n  </extension>',
      ),
    );
    const { status, output } = build();
    expect(status).toBe(1);
    expect(output).toContain('src="agentic-ui-config/assets/logo.svg" names no file in bundle/');
  });
});
