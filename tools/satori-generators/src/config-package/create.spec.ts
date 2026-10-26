import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import configPackageGenerator, { type ConfigPackageSchema } from './generator';

/**
 * `create.mjs` and the `config-package` generator must write the same bytes for the same options,
 * and refuse the same options with the same message: the first is what a customer without this
 * repository's install runs, and the second what everyone else runs.
 *
 * `create.mjs` runs from a copy of this directory under the system temp directory, where no
 * `node_modules` is reachable, so a dependency added to it fails here and not in a fresh clone.
 */

const LONGEST = `a${'-b'.repeat(63)}a`;

let scratch: string;
let createMjs: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'create-config-package-'));
  cpSync(__dirname, join(scratch, 'config-package'), { recursive: true });
  createMjs = join(scratch, 'config-package', 'create.mjs');
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** `create.mjs`'s command line for the options the generator takes. */
function argv({ name, ...options }: ConfigPackageSchema): string[] {
  return [
    name,
    ...Object.entries(options).flatMap(([key, value]) =>
      value === true ? [`--${key}`] : value === false ? [] : [`--${key}=${value}`],
    ),
  ];
}

function run(script: string, cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** One way of producing a package, driven through the same steps as the other. */
interface Workspace {
  /** `null` when it generated, the message when it refused. */
  generate(options: ConfigPackageSchema): Promise<string | null>;
  write(path: string, content: string): void;
  /** Every file written since the workspace was created, by path. */
  files(): Map<string, Buffer>;
}

function generatorWorkspace(): Workspace {
  const tree = createTreeWithEmptyWorkspace();
  const initial = new Map(tree.listChanges().map((change) => [change.path, change.content]));
  return {
    async generate(options) {
      try {
        await configPackageGenerator(tree, options);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    },
    write: (path, content) => tree.write(path, content),
    files: () =>
      new Map(
        tree
          .listChanges()
          .filter(
            (change) =>
              change.type !== 'DELETE' &&
              !(change.content && initial.get(change.path)?.equals(change.content)),
          )
          .map((change) => [change.path, change.content as Buffer]),
      ),
  };
}

function createWorkspace(): Workspace & { generateWith(args: string[]): Promise<string | null> } {
  const dir = mkdtempSync(join(scratch, 'out-'));
  const walk = (at: string, prefix = ''): [string, Buffer][] =>
    readdirSync(at).flatMap((entry) => {
      const path = join(at, entry);
      return statSync(path).isDirectory()
        ? walk(path, `${prefix}${entry}/`)
        : [[`${prefix}${entry}`, readFileSync(path)] as [string, Buffer]];
    });
  const generateWith = async (args: string[]) => {
    const { status, stderr } = run(createMjs, dir, args);
    if (status === 0) return null;
    if (status === 1) return stderr.trim();
    throw new Error(`create.mjs exited ${status}: ${stderr}`);
  };
  return {
    generate: (options) => generateWith(argv(options)),
    generateWith,
    write(path, content) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    },
    files: () => new Map(walk(dir)),
  };
}

/** Same paths, same bytes. The text comparison first, for a readable diff when it fails. */
function expectSameFiles(actual: Map<string, Buffer>, expected: Map<string, Buffer>): void {
  const text = (files: Map<string, Buffer>) =>
    Object.fromEntries([...files].map(([path, bytes]) => [path, bytes.toString('utf8')]));
  expect(text(actual)).toEqual(text(expected));
  expect(
    [...expected].filter(([path, bytes]) => !actual.get(path)?.equals(bytes)).map(([path]) => path),
  ).toEqual([]);
}

describe('create.mjs writes what the config-package generator writes', () => {
  it.each<[string, ConfigPackageSchema]>([
    ['the defaults', { name: 'acme-config', owner: 'acme' }],
    ['--presales', { name: 'acme-config', owner: 'acme', presales: true }],
    [
      'a nested --directory, a pre-release --version, and a title and vendor XML must escape',
      {
        name: 'contoso-claims',
        owner: 'contoso',
        directory: 'customers/contoso',
        version: '2.3.4-rc.1',
        title: 'Contoso <Claims> & "Co"',
        vendor: "O'Brien & Sons",
      },
    ],
    [
      'a 128-character name with --presales, and a title Prettier would have rewritten',
      { name: LONGEST, owner: 'a1', presales: true, title: '  Acme *Claims*  — Ünïcode 日本  ' },
    ],
    [
      'a one-letter name under a dotted directory, with a blank title and vendor',
      { name: 'x', owner: 'x', directory: '.config/_pkgs-1', title: '', vendor: '   ' },
    ],
  ])('for %s', async (_case, options) => {
    const generator = generatorWorkspace();
    const create = createWorkspace();
    expect(await generator.generate(options)).toBeNull();
    expect(await create.generate(options)).toBeNull();
    expect(create.files().size).toBe(13);
    expectSameFiles(create.files(), generator.files());
  });

  it('reads --option value as well as --option=value', async () => {
    const generator = generatorWorkspace();
    await generator.generate({ name: 'acme-config', owner: 'acme', title: 'Acme Claims Cloud' });
    const create = createWorkspace();
    expect(
      await create.generateWith(['acme-config', '--owner', 'acme', '--title', 'Acme Claims Cloud']),
    ).toBeNull();
    expectSameFiles(create.files(), generator.files());
  });

  it('refuses an existing package, and with --force overwrites what it generated and keeps the rest', async () => {
    const results = [];
    for (const workspace of [generatorWorkspace(), createWorkspace()]) {
      const root = 'config-packages/acme-config';
      await workspace.generate({ name: 'acme-config', owner: 'acme' });
      workspace.write(`${root}/bundle/agentic-ui-config/bootstrap.json`, '{ "edited": true }\n');
      workspace.write(`${root}/bundle/agentic-ui-config/assets/acme-logo.svg`, '<svg/>');
      const refused = await workspace.generate({ name: 'acme-config', owner: 'acme' });
      const forced = await workspace.generate({
        name: 'acme-config',
        owner: 'acme',
        title: 'Renamed',
        version: '1.0.1',
        presales: true,
        force: true,
      });
      results.push({ refused, forced, files: workspace.files() });
    }
    const [generator, create] = results;
    const fragment = 'config-packages/acme-config/bundle/agentic-ui-config/bootstrap.json';
    expect(generator.refused).toMatch(/already exists/);
    expect(create.refused).toBe(generator.refused);
    expect(create.forced).toBeNull();
    expect(generator.forced).toBeNull();
    expect(create.files.get(fragment)?.toString('utf8')).toContain('"applicationTitle": "Renamed"');
    expect(
      create.files.get('config-packages/acme-config/bundle/agentic-ui-config/assets/acme-logo.svg'),
    ).toEqual(Buffer.from('<svg/>'));
    expectSameFiles(create.files, generator.files);
  });

  it.each<[Partial<ConfigPackageSchema>]>([
    [{ directory: 'customer configs' }],
    [{ directory: '../outside' }],
    [{ directory: '/etc' }],
    [{ directory: 'a/./b' }],
    [{ directory: '-configs' }],
    [{ directory: 'customers/-acme' }],
    [{ directory: '' }],
    [{ name: '' }],
    [{ name: 'Acme' }],
    [{ name: 'acme_config' }],
    [{ name: 'acme-' }],
    [{ name: '9acme' }],
    [{ name: `${LONGEST}x` }],
    [{ owner: '' }],
    [{ owner: 'Acme Corp' }],
    [{ owner: 'acme-co' }],
    [{ version: '1.0' }],
    [{ version: 'v1.0.0' }],
    [{ name: 'Acme', owner: 'Acme', version: 'x' }],
  ])('refuses %j with the generator’s message, and writes nothing', async (invalid) => {
    const options = { name: 'acme-config', owner: 'acme', ...invalid };
    const generator = generatorWorkspace();
    const create = createWorkspace();
    const expected = await generator.generate(options);
    expect(expected).toEqual(expect.any(String));
    expect(await create.generate(options)).toBe(expected);
    expect(create.files().size).toBe(0);
  });
});

describe('create.mjs on its own', () => {
  it.each([
    ['no name', ['--owner=acme'], /Give a package name/],
    ['two names', ['acme-config', 'other', '--owner=acme'], /Give one package name, not 2/],
    ['no --owner', ['acme-config'], /--owner is required/],
    ['an unknown option', ['acme-config', '--owner=acme', '--ownr=x'], /Unknown option '--ownr'/],
    ['a value for a flag', ['acme-config', '--owner=acme', '--presales=yes'], /--presales/],
  ])('stops at %s with the usage, exit 2, writing nothing', (_case, args, message) => {
    const dir = mkdtempSync(join(scratch, 'usage-'));
    const { status, stderr } = run(createMjs, dir, args);
    expect(status).toBe(2);
    expect(stderr).toMatch(message);
    expect(stderr).toContain('Usage: node tools/satori-generators/src/config-package/create.mjs');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('prints the node and nuxeoctl commands for the package it wrote', () => {
    const dir = mkdtempSync(join(scratch, 'message-'));
    const { status, stdout } = run(createMjs, dir, ['acme-config', '--owner=acme']);
    expect(status).toBe(0);
    expect(stdout).toContain('node config-packages/acme-config/build.mjs');
    expect(stdout).toContain(
      'nuxeoctl mp-install config-packages/acme-config/dist/acme-config-1.0.0.zip',
    );
  });

  it('imports nothing but Node built-ins, and neither does the build.mjs it writes', () => {
    for (const file of ['create.mjs', 'files/build.mjs__tmpl__']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      // Static imports over any number of lines, side-effect imports, import() and require().
      const specifiers = [
        ...source.matchAll(
          /(?:\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/gm,
        ),
      ].map((match) => match[1]);
      // At least one specifier per import statement, or the pattern missed one.
      expect(specifiers.length).toBeGreaterThanOrEqual(source.match(/^import\b/gm)?.length ?? 1);
      expect(specifiers.filter((specifier) => !specifier.startsWith('node:'))).toEqual([]);
    }
  });

  describe('refuses a template it cannot render as EJS would, rather than guess', () => {
    it.each([
      [
        'an expression',
        'Hello <%= name.toUpperCase() %>',
        /does not render "<%= name\.toUpperCase\(\) %>"/,
      ],
      ['whitespace slurping', '<%_ if (presales) { _%>x<%_ } _%>', /does not render/],
      ['an unclosed tag', 'Hello <%= name', /a "<%" has no closing "%>"/],
      ['an unclosed if', '<% if (presales) { %>x', /is never closed/],
      ['an unknown value', '<%= nmae %>', /"nmae" is not a template value/],
    ])('%s', (_case, template, message) => {
      const copy = mkdtempSync(join(scratch, 'templates-'));
      cpSync(__dirname, copy, { recursive: true });
      writeFileSync(join(copy, 'files/extra.txt__tmpl__'), template);
      const dir = mkdtempSync(join(scratch, 'refused-'));
      const { status, stderr } = run(join(copy, 'create.mjs'), dir, [
        'acme-config',
        '--owner=acme',
      ]);
      expect(status).toBe(1);
      expect(stderr).toMatch(message);
      expect(readdirSync(dir)).toEqual([]);
    });

    it('a file that is not a *__tmpl__ template, which Nx might copy as binary', () => {
      const copy = mkdtempSync(join(scratch, 'templates-'));
      cpSync(__dirname, copy, { recursive: true });
      writeFileSync(join(copy, 'files/bundle/agentic-ui-config/assets/logo.png'), 'PNG');
      const dir = mkdtempSync(join(scratch, 'refused-'));
      const { status, stderr } = run(join(copy, 'create.mjs'), dir, [
        'acme-config',
        '--owner=acme',
      ]);
      expect(status).toBe(1);
      expect(stderr).toMatch(/renders only \*__tmpl__ templates/);
      expect(readdirSync(dir)).toEqual([]);
    });
  });
});
