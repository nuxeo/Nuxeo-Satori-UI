/**
 * The validated writes, on copies of the kits in a scratch package root: never on the kits
 * themselves. The tests that run the pipeline need `unzip`, as `validate_package`'s do.
 */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  GENERATORS_SOURCE,
  fileKind,
  runGenerator,
  writePackage,
  type Change,
  type WriteOptions,
  type WriteResult,
} from './package-writes.ts';
import { PIPELINE_TESTS_RUN } from './testing/unzip.ts';
import { REPO_ROOT, validatePackage } from './validate-package.ts';

const KITS = join(REPO_ROOT, 'business-apps', 'packages');
const scratch = mkdtempSync(join(tmpdir(), 'builder-mcp-writes-'));
const packages = join(scratch, 'packages');
const work = join(scratch, 'work');
mkdirSync(packages);
mkdirSync(work);
afterAll(() => {
  // A test that made a folder read-only gives it back, but a failed one may not have.
  chmodAll(scratch);
  rmSync(scratch, { recursive: true, force: true });
});

function chmodAll(folder: string): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(folder, entry.name);
    chmodSync(path, 0o755);
    chmodAll(path);
  }
}

// Several copies of one kit share the scratch root, so their names are compared with no other
// kit's here: the comparison has tests of its own, each in a root of its own.
const OPTIONS: WriteOptions = { packageRoots: [packages], workIn: work, kits: null };
const CONFIG = 'bundle/agentic-ui-config';
const LABELS = `${CONFIG}/labels/en.json`;
const QUEUE = `${CONFIG}/queues/up-for-renewal.json`;
const VIEW = `${CONFIG}/layouts/Contract/view.layout.json`;

/** A copy of a kit in the scratch root, without its build output. */
function kit(name: string, as: string, change: (root: string) => void = () => undefined): string {
  const root = join(packages, as);
  cpSync(join(KITS, name), root, {
    recursive: true,
    filter: (source) => relative(join(KITS, name), source) !== 'dist',
  });
  change(root);
  return root;
}

/** Every file under a folder, `dist/` included, with the SHA-256 of its bytes. */
function fingerprint(root: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [
          relative(root, path).split('\\').join('/'),
          createHash('sha256').update(readFileSync(path)).digest('hex'),
        ];
      })
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

function read(root: string, path: string): string {
  return readFileSync(join(root, ...path.split('/')), 'utf8');
}

function edited(root: string, path: string, from: string, to: string): string {
  const text = read(root, path);
  if (!text.includes(from)) throw new Error(`${path} has no ${from}`);
  return text.replace(from, to);
}

function writeFile(pkg: string, path: string, content: string, options: WriteOptions = OPTIONS) {
  return writePackage({ package: pkg, changes: [{ kind: 'write', path, content }] }, options);
}

/** A pipeline that must not be reached: the request is refused before anything runs. */
const NEVER: WriteOptions = {
  ...OPTIONS,
  validate: () => {
    throw new Error('the pipeline ran');
  },
  generate: () => {
    throw new Error('a generator ran');
  },
};

/** The write was refused by the pipeline, and the package is byte for byte as it was. */
function expectRefused(result: WriteResult, root: string, before: Record<string, string>) {
  expect(result.written).toBe(false);
  expect(result.validation?.passed).toBe(false);
  expect(result.note).toContain('nothing was written');
  expect(fingerprint(root)).toEqual(before);
  expect(readdirSync(work)).toEqual([]);
}

describe('fileKind', () => {
  it('lets write_package_file write the app definition, and the generators their own files too', () => {
    for (const path of [
      `${CONFIG}/app.json`,
      `${CONFIG}/home.json`,
      `${CONFIG}/navigation.json`,
      `${CONFIG}/actions.json`,
      QUEUE,
      LABELS,
      `${CONFIG}/labels/fr-CA.json`,
      `${CONFIG}/tasks/PayersClaimReview.determine.layout.json`,
      VIEW,
      `${CONFIG}/layouts/Contract/edit.layout.json`,
    ])
      expect(fileKind(path), path).toBe('definition');
    for (const path of [
      '.gitignore',
      'README.md',
      'build.mjs',
      'content-model.json',
      'package/package.xml',
      'package/install.xml',
      'bundle/META-INF/MANIFEST.MF',
      'bundle/OSGI-INF/contracts-demo-config.xml',
      'bundle/schemas/contract.xsd',
    ])
      expect(fileKind(path), path).toBe('generated');
  });

  it('refuses every other path, naming why', () => {
    const refused: [string, string][] = [
      ['../outside.json', 'leaves the package'],
      [`${CONFIG}/../../../outside.json`, 'leaves the package'],
      ['bundle//app.json', 'leaves the package'],
      ['/etc/passwd', 'is absolute'],
      ['C:/Windows/x.json', 'is not a path inside the package'],
      ['bundle\\agentic-ui-config\\app.json', 'is not a path inside the package'],
      ['.env', 'hidden'],
      [`${CONFIG}/.app.json`, 'hidden'],
      [`${CONFIG}/layouts/CON/view.layout.json`, 'is not a file name'],
      [`${CONFIG}/assets/logo.svg`, 'is an asset'],
      [`${CONFIG}/layouts/notes.json`, 'is not a file of the app definition'],
      [`${CONFIG}/layouts/Contract/view.layout.js`, 'is not a file of the app definition'],
      [`${CONFIG}/bootstrap.json`, 'is not a file of the app definition'],
      ['deployment/build-allow-list.json', "is the deployment's"],
      ['deployment/payers-claims-demo-operations-config.xml', "is the deployment's"],
      ['dist/x.zip', "the pipeline's output"],
      ['demo/seed.mjs', 'is code'],
      ['workflow/PlatformCheck.java', 'is code'],
      ['bundle/OSGI-INF/deployment-fragment.txt', 'is not a file these tools write'],
      ['bundle/data/vocabularies/x.csv', 'is not a file these tools write'],
    ];
    for (const [path, why] of refused) {
      const kind = fileKind(path);
      expect(typeof kind, path).toBe('object');
      expect((kind as { problem: string }).problem, path).toContain(why);
    }
  });
});

describe('writePackage, refusing before anything runs', () => {
  const root = kit('contracts-demo', 'refused-early');
  const before = fingerprint(root);
  const outside = join(scratch, 'outside.json');

  async function refusal(
    request: { package?: string; changes: Change[] },
    options: WriteOptions = NEVER,
  ) {
    let message = '';
    try {
      await writePackage({ package: request.package ?? root, changes: request.changes }, options);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(fingerprint(root)).toEqual(before);
    expect(existsSync(outside)).toBe(false);
    expect(readdirSync(work)).toEqual([]);
    return message;
  }
  const writing = (path: string, content = '{}'): Change[] => [{ kind: 'write', path, content }];

  it('refuses a path that leaves the package', async () => {
    for (const path of [
      '../outside.json',
      '../../outside.json',
      // From the staging copy, these two reach the work folder and the scratch folder beside it.
      '../../../outside.json',
      '../../../../outside.json',
      `${CONFIG}/../../../outside.json`,
      outside,
    ])
      expect(await refusal({ changes: writing(path) }), path).toMatch(
        /leaves the package|is absolute/,
      );
  });

  it('refuses a package that is not one folder directly inside a package root', async () => {
    for (const pkg of [
      `${packages}/../outside`,
      `${packages}/./refused-early`,
      'business-apps/packages/../x',
    ])
      expect(await refusal({ package: pkg, changes: writing(LABELS) }), pkg).toContain(
        'has a "." or ".." part',
      );
    for (const pkg of [
      join(root, 'bundle'),
      packages,
      join(REPO_ROOT, 'business-apps', 'packages', 'contracts-demo'),
      join(REPO_ROOT, 'scripts'),
      '/etc',
    ])
      expect(await refusal({ package: pkg, changes: writing(LABELS) }), pkg).toContain(
        'is not a package folder directly inside',
      );
    expect(
      await refusal({ package: join(packages, 'Not_Kebab'), changes: writing(LABELS) }),
    ).toContain("is not a package's name");
  });

  it('refuses the files the generators write, the deployment, code and assets', async () => {
    expect(await refusal({ changes: writing('build.mjs', 'process.exit(0)') })).toContain(
      'is written by the generators only: app-package writes it',
    );
    expect(
      await refusal({ changes: writing('bundle/OSGI-INF/contracts-demo-config.xml') }),
    ).toContain('is written by the generators only');
    expect(await refusal({ changes: writing('content-model.json') })).toContain(
      'app-model writes it',
    );
    expect(
      await refusal({
        changes: writing('deployment/build-allow-list.json', '{"operations":["Document.Delete"]}'),
      }),
    ).toContain("is the deployment's");
    expect(await refusal({ changes: writing('demo/seed.mjs', 'process.exit(0)') })).toContain(
      'is code',
    );
    expect(await refusal({ changes: writing(`${CONFIG}/assets/logo.svg`, '<svg/>') })).toContain(
      'is an asset',
    );
  });

  it('refuses a generator that is not an app generator, and options it should not take', async () => {
    const run = (generator: string, options: Record<string, unknown>) =>
      refusal({ changes: [{ kind: 'generator', generator, options }] });
    expect(await run('config-package', { name: 'x', owner: 'acme' })).toContain(
      'is not one the write tools run',
    );
    expect(await run('extension-library', {})).toContain('is not one the write tools run');
    expect(
      await run('app-layout', { type: 'Contract', modelServer: 'http://attacker.example/nuxeo' }),
    ).toContain('the write tools read no server');
    expect(
      await run('app-layout', { type: 'Contract', package: 'business-apps/packages/x' }),
    ).toContain('the package argument names the package');
    expect(await run('app-queue', { id: 'x', pageProvider: 'p', colour: 'red' })).toContain(
      'app-queue has no such option',
    );
    expect(await run('app-queue', { id: 'x', pageProvider: 'p', pageSize: '50' })).toContain(
      'app-queue takes a number here',
    );
    expect(await run('app-form', { type: 'Contract', mode: 'delete', model: 'x.json' })).toContain(
      'one of edit, create',
    );
    expect(await run('app-queue', { id: '../escape', pageProvider: 'p' })).toContain(
      'is not of the form app-queue takes there',
    );
  });

  it('runs app-model only for a demo kit, one that ships its own stand-in model', async () => {
    const run = (pkg: string) =>
      refusal({
        package: pkg,
        changes: [
          { kind: 'generator', generator: 'app-model', options: { type: 'Acme', properties: 'x' } },
        ],
      });
    // A package on a server's model: no content-model.json of its own.
    const customers = kit('contracts-demo', 'customer-model', (copy) =>
      rmSync(join(copy, 'content-model.json')),
    );
    expect(await run(customers)).toContain('app-model is for a demo kit only');
    // The control: a demo kit reaches the generator.
    expect(await run(root)).toBe('a generator ran');
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a model that is not a file, without waiting on it',
    async () => {
      const fifo = join(packages, 'waiting.json');
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
      try {
        expect(
          await refusal({
            changes: [
              {
                kind: 'generator',
                generator: 'app-layout',
                options: { type: 'Contract', model: fifo },
              },
            ],
          }),
        ).toContain('is not a JSON file, or goes through a link');
      } finally {
        rmSync(fifo, { force: true });
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'reads nothing through a link before a ".." in the package path',
    async () => {
      const outside = mkdtempSync(join(scratch, 'outside-'));
      mkdirSync(join(outside, 'sub'));
      mkdirSync(join(outside, 'victim', 'bundle'), { recursive: true });
      symlinkSync(join(outside, 'sub'), join(packages, 'through'));
      try {
        for (const pkg of [`${packages}/through/../victim`, `${packages}/through/../fresh`])
          expect(await refusal({ package: pkg, changes: writing(LABELS) }), pkg).toContain(
            'has a "." or ".." part',
          );
        expect(readdirSync(outside).sort()).toEqual(['sub', 'victim']);
      } finally {
        // The link itself, never what it names. `rmSync` on a link to a folder follows it on
        // Node 25 and throws "Path is a directory"; Node 24 removed the link. `unlink` does not
        // follow on either.
        unlinkSync(join(packages, 'through'));
      }
    },
  );

  it('refuses a model outside the repository and the package roots, or not JSON', async () => {
    writeFileSync(join(scratch, 'model.json'), '{}');
    const run = (model: string) =>
      refusal({
        changes: [
          { kind: 'generator', generator: 'app-layout', options: { type: 'Contract', model } },
        ],
      });
    expect(await run(join(scratch, 'model.json'))).toContain('is outside the repository');
    expect(await run('/etc/hosts')).toContain('is outside the repository');
    expect(await run('.env')).toContain('hidden');
    expect(await run('README.md')).toContain('is not a JSON file');
    // The control: a JSON file inside the repository is taken, and the generator is reached.
    expect(await run('package.json')).toBe('a generator ran');
    rmSync(join(scratch, 'model.json'));
  });

  it('refuses to remove app.json, a generated file, or a path outside the app definition', async () => {
    const root = kit('contracts-demo', 'remove-refused');
    const remove = (path: string) =>
      writePackage({ package: root, changes: [{ kind: 'remove', path }] }, NEVER);
    await expect(remove(`${CONFIG}/app.json`)).rejects.toThrow('is the app itself');
    await expect(remove('bundle/OSGI-INF/contracts-demo-config.xml')).rejects.toThrow(
      'is written by the generators only, and taken out by them',
    );
    await expect(remove('build.mjs')).rejects.toThrow('is written by the generators only');
    await expect(remove('../contracts-demo/README.md')).rejects.toThrow('leaves the package');
    await expect(remove('demo/seed.mjs')).rejects.toThrow('is code');
  });

  it('refuses to remove a file the package does not hold, before the pipeline runs', async () => {
    const root = kit('contracts-demo', 'remove-missing');
    const before = fingerprint(root);
    await expect(
      writePackage(
        { package: root, changes: [{ kind: 'remove', path: `${CONFIG}/queues/none.json` }] },
        NEVER,
      ),
    ).rejects.toThrow('is not a file of');
    expect(fingerprint(root)).toEqual(before);
  });

  it('refuses a package that does not exist, unless app-package makes it', async () => {
    expect(
      await refusal({ package: join(packages, 'not-yet'), changes: writing(LABELS) }),
    ).toContain('does not exist. A new package starts with');
    expect(existsSync(join(packages, 'not-yet'))).toBe(false);
  });

  it('refuses a file of version 1 or none, which the validator would not check', async () => {
    const generatorless: WriteOptions = { ...NEVER, validate: NEVER.validate };
    for (const content of ['{ "version": 1, "cards": [] }', '{ "cards": [] }', '[]'])
      expect(await refusal({ changes: writing(VIEW, content) }, generatorless), content).toContain(
        'is not a JSON object of "version": 2',
      );
  });
});

describe.skipIf(process.platform === 'win32')('writePackage, and links', () => {
  const elsewhere = join(scratch, 'elsewhere.json');
  writeFileSync(elsewhere, '{ "version": 2, "labels": {} }\n');
  const message = async (pkg: string, path = LABELS) => {
    try {
      await writeFile(pkg, path, '{ "version": 2, "labels": {} }', NEVER);
    } catch (error) {
      return (error as Error).message;
    }
    return 'written';
  };

  it('refuses a package whose file is a symbolic link, and leaves its target alone', async () => {
    const root = kit('contracts-demo', 'linked-file', (copy) => {
      rmSync(join(copy, ...LABELS.split('/')));
      symlinkSync(elsewhere, join(copy, ...LABELS.split('/')));
    });
    expect(await message(root)).toContain(`holds a link, ${LABELS}, which is not followed`);
    expect(readFileSync(elsewhere, 'utf8')).toBe('{ "version": 2, "labels": {} }\n');
  });

  it('refuses a package with a linked folder on the way to the file', async () => {
    const outsideFolder = mkdtempSync(join(scratch, 'outside-folder-'));
    const root = kit('contracts-demo', 'linked-folder', (copy) => {
      rmSync(join(copy, CONFIG, 'queues'), { recursive: true });
      symlinkSync(outsideFolder, join(copy, CONFIG, 'queues'));
    });
    expect(await message(root, QUEUE)).toContain(`holds a link, ${CONFIG}/queues`);
    expect(readdirSync(outsideFolder)).toEqual([]);
  });

  it('refuses a package that is itself a link, or reached through one', async () => {
    const real = kit('contracts-demo', 'real-package');
    symlinkSync(real, join(packages, 'linked-package'));
    expect(await message(join(packages, 'linked-package'))).toContain(
      'is a link, which is not followed',
    );
  });

  it('refuses a package holding a hard link, a file with a second name elsewhere', async () => {
    const root = kit('contracts-demo', 'hard-linked', (copy) => {
      rmSync(join(copy, ...LABELS.split('/')));
      linkSync(elsewhere, join(copy, ...LABELS.split('/')));
    });
    expect(await message(root)).toContain(`holds a link, ${LABELS}`);
    expect(readFileSync(elsewhere, 'utf8')).toBe('{ "version": 2, "labels": {} }\n');
  });
});

describe.skipIf(!PIPELINE_TESTS_RUN)(
  'writePackage, through the pipeline (it needs unzip, which a Windows runner lacks)',
  () => {
    it('writes a file that passes, that file alone, and leaves no folder of its own behind', async () => {
      const root = kit('contracts-demo', 'sound-write');
      const before = fingerprint(root);
      const content = edited(root, LABELS, '"Contract manager"', '"Account manager"');
      const result = await writeFile(root, LABELS, content);
      expect(result.written, JSON.stringify(result.validation?.stderr)).toBe(true);
      expect(result.changes).toEqual([{ path: LABELS, change: 'updated' }]);
      expect(result.validation).toMatchObject({ passed: true, findings: [], asCi: true });
      expect(result.validation?.package).toBe(root);
      expect(read(root, LABELS)).toBe(content);
      const after = fingerprint(root);
      expect(Object.keys(after)).toEqual(Object.keys(before));
      for (const path of Object.keys(before))
        if (path !== LABELS) expect(after[path], path).toBe(before[path]);
      expect(existsSync(join(root, 'dist'))).toBe(false);
      expect(readdirSync(work)).toEqual([]);
      // And the package as written passes the pipeline on its own.
      expect((await validatePackage({ directory: root }, { roots: [packages] })).passed).toBe(true);
    });

    it("warns, and still writes, when a kit's schema has no Properties heading", async () => {
      const root = kit('moves-demo', 'no-heading');
      const content = edited(root, LABELS, '"layout.schema.move": "Move",', '');
      const result = await writeFile(root, LABELS, content);
      expect(result.written, JSON.stringify(result.validation?.stderr)).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings?.[0]).toContain('has no text for layout.schema.move,');
      // Written back, the heading is there and nothing is said.
      const again = await writeFile(root, LABELS, read(join(KITS, 'moves-demo'), LABELS));
      expect(again.written).toBe(true);
      expect(again.warnings).toBeUndefined();
    });

    it('refuses a page provider whose NXQL Nuxeo would refuse, naming its component', async () => {
      const root = kit('moves-demo', 'between-now');
      const before = fingerprint(root);
      const result = await writePackage(
        {
          package: root,
          changes: [
            {
              kind: 'generator',
              generator: 'app-model',
              options: {
                type: 'DamageClaim',
                pageProvider: 'moves_filed_this_month',
                where: "dmg:filedOn BETWEEN NOW('-P30D') AND NOW()",
              },
            },
          ],
        },
        OPTIONS,
      );
      expectRefused(result, root, before);
      expect(result.validation?.refusedAt?.step).toBe(2);
      expect(result.validation?.findings).toEqual([
        expect.objectContaining({
          file: 'bundle/OSGI-INF/moves-demo-model.xml',
          place: 'pageProviders.moves_filed_this_month.pattern',
          message: expect.stringContaining('BETWEEN takes a literal on each side of its AND'),
        }),
      ]);
    });

    it('answers a write of what the file already holds with nothing to write', async () => {
      const root = kit('contracts-demo', 'same-write');
      const result = await writeFile(root, LABELS, read(root, LABELS));
      expect(result).toMatchObject({ written: false, changes: [], validation: null });
      expect(result.note).toContain('Nothing to write');
    });

    it('refuses a write that would leave a finding, and changes nothing', async () => {
      const root = kit('contracts-demo', 'finding');
      const before = fingerprint(root);
      const result = await writeFile(
        root,
        VIEW,
        edited(root, VIEW, '"widget": "currency"', '"widget": "calendar"'),
      );
      expectRefused(result, root, before);
      expect(result.changes).toEqual([{ path: VIEW, change: 'updated' }]);
      expect(result.validation?.refusedAt?.step).toBe(2);
      expect(result.validation?.findings).toEqual([
        expect.objectContaining({
          file: VIEW,
          message: 'the widget "calendar" is not registered',
          kind: 'unknown',
        }),
      ]);
      // The answer names the package, not the staging copy it checked.
      expect(JSON.stringify(result)).not.toContain(work);
    });

    it('refuses an unregistered rule id at write time', async () => {
      const root = kit('contracts-demo', 'unregistered-rule');
      const before = fingerprint(root);
      const result = await writeFile(
        root,
        VIEW,
        edited(
          root,
          VIEW,
          '"type": "app.rules.fieldIn",\n        "parameters": [{ "field": "contract:status" }, "Terminated"]',
          '"type": "acme.rules.isTerminated",\n        "parameters": [{ "field": "contract:status" }, "Terminated"]',
        ),
      );
      expectRefused(result, root, before);
      expect(result.validation?.findings.map((finding) => finding.message).join('\n')).toContain(
        'acme.rules.isTerminated',
      );
    });

    it('refuses an unregistered widget in a layout of version 1, which the pipeline alone would pass', async () => {
      const root = kit('contracts-demo', 'version-one');
      const before = fingerprint(root);
      const versionOne = JSON.stringify({
        version: 1,
        cards: [{ fields: [{ field: 'contract:number', widget: 'calendar' }] }],
      });
      // The control: the pipeline itself passes the package with that file, since the validator
      // does not check a layout of version 1.
      const copy = kit('contracts-demo', 'version-one-control', (folder) =>
        writeFileSync(join(folder, ...VIEW.split('/')), versionOne),
      );
      expect((await validatePackage({ directory: copy }, { roots: [packages] })).passed).toBe(true);
      await expect(writeFile(root, VIEW, versionOne)).rejects.toThrow(
        'is not a JSON object of "version": 2',
      );
      expect(fingerprint(root)).toEqual(before);
    });

    it('refuses an operation the build allow-list does not name, which the write cannot widen', async () => {
      const root = kit('payers-claims-demo', 'unlisted-operation');
      const before = fingerprint(root);
      const actions = `${CONFIG}/actions.json`;
      const result = await writeFile(
        root,
        actions,
        edited(root, actions, '"Payers.RequestMedicalRecords"', '"Document.Delete"'),
      );
      expectRefused(result, root, before);
      expect(result.validation?.findings.map((finding) => finding.message).join('\n')).toContain(
        "is not on this deployment's allow-list",
      );
    });

    it('refuses a new registry file the component does not name, and writes it with app-registry', async () => {
      const root = kit('contracts-demo', 'new-queue');
      const before = fingerprint(root);
      const queue = `${CONFIG}/queues/all-contracts.json`;
      const content = read(root, QUEUE);
      const alone = await writeFile(root, queue, content);
      expectRefused(alone, root, before);
      expect(alone.validation?.refusedAt?.reason).toContain(
        'does not name queues/all-contracts.json',
      );

      const together = await writePackage(
        {
          package: root,
          changes: [
            { kind: 'write', path: queue, content },
            { kind: 'generator', generator: 'app-registry' },
          ],
        },
        OPTIONS,
      );
      expect(together.written, JSON.stringify(together.validation?.stderr)).toBe(true);
      expect(together.changes).toEqual([
        { path: 'bundle/OSGI-INF/contracts-demo-config.xml', change: 'updated' },
        { path: queue, change: 'created' },
      ]);
      expect(read(root, 'bundle/OSGI-INF/contracts-demo-config.xml')).toContain(
        'queues/all-contracts.json',
      );
    });

    it('removes a file the component names, with app-registry, once nothing else names it', async () => {
      const root = kit('contracts-demo', 'remove-queue');
      const before = fingerprint(root);
      const component = 'bundle/OSGI-INF/contracts-demo-config.xml';
      // The menu and the home still open it: refused, and nothing changes.
      const named = await writePackage(
        {
          package: root,
          changes: [
            { kind: 'remove', path: QUEUE },
            { kind: 'generator', generator: 'app-registry' },
          ],
        },
        OPTIONS,
      );
      expectRefused(named, root, before);
      expect(named.changes).toEqual([
        { path: component, change: 'updated' },
        { path: QUEUE, change: 'removed' },
      ]);
      expect(named.validation?.findings.map((finding) => finding.file)).toContain(
        `${CONFIG}/navigation.json`,
      );
      // Given another id: the old file removed, the new one and the two that open it written.
      const queue = `${CONFIG}/queues/renewals-due.json`;
      const renamed = await writePackage(
        {
          package: root,
          changes: [
            { kind: 'remove', path: QUEUE },
            { kind: 'write', path: queue, content: read(root, QUEUE) },
            {
              kind: 'write',
              path: `${CONFIG}/navigation.json`,
              content: edited(
                root,
                `${CONFIG}/navigation.json`,
                '"up-for-renewal"',
                '"renewals-due"',
              ),
            },
            {
              kind: 'write',
              path: `${CONFIG}/home.json`,
              content: edited(root, `${CONFIG}/home.json`, '"up-for-renewal"', '"renewals-due"'),
            },
            { kind: 'generator', generator: 'app-registry' },
          ],
        },
        OPTIONS,
      );
      expect(renamed.written, JSON.stringify(renamed.validation?.stdout)).toBe(true);
      expect(renamed.changes).toEqual([
        { path: component, change: 'updated' },
        { path: `${CONFIG}/home.json`, change: 'updated' },
        { path: `${CONFIG}/navigation.json`, change: 'updated' },
        { path: queue, change: 'created' },
        { path: QUEUE, change: 'removed' },
      ]);
      expect(existsSync(join(root, ...QUEUE.split('/')))).toBe(false);
      expect(read(root, component)).toContain('queues/renewals-due.json');
      expect(read(root, component)).not.toContain('queues/up-for-renewal.json');
    });

    it('removes a layout, and app-registry takes it out of the component', async () => {
      const root = kit('contracts-demo', 'remove-layout');
      const edit = `${CONFIG}/layouts/Contract/edit.layout.json`;
      const component = 'bundle/OSGI-INF/contracts-demo-config.xml';
      expect(read(root, component)).toContain('mode="edit"');
      const result = await writePackage(
        {
          package: root,
          changes: [
            { kind: 'remove', path: edit },
            { kind: 'generator', generator: 'app-registry' },
          ],
        },
        OPTIONS,
      );
      expect(result.written, JSON.stringify(result.validation?.stdout)).toBe(true);
      expect(result.changes).toEqual([
        { path: component, change: 'updated' },
        { path: edit, change: 'removed' },
      ]);
      expect(read(root, component)).not.toContain('mode="edit"');
      expect(result.generatorOutput.join('\n')).toContain(
        'No longer contributes the layouts, whose files are gone: Contract/edit',
      );
    });

    it("compares the package's names with the other kits in its root, and refuses a clash", async () => {
      const own = mkdtempSync(join(scratch, 'kits-'));
      const at = (name: string) => {
        cpSync(join(KITS, 'contracts-demo'), join(own, name), {
          recursive: true,
          filter: (source) => relative(join(KITS, 'contracts-demo'), source) !== 'dist',
        });
        return join(own, name);
      };
      const root = at('contracts-a');
      const options: WriteOptions = { packageRoots: [own], workIn: work };
      const content = edited(root, LABELS, '"Contract manager"', '"Account manager"');
      // Alone in its root, the write passes; beside a copy of itself, every name is the copy's.
      const alone = await writeFile(root, LABELS, content, options);
      expect(alone.written, JSON.stringify(alone.validation?.stdout)).toBe(true);
      expect(alone.validation?.stdout.join('\n')).toContain('Compared with the 0 other kits in');
      at('contracts-b');
      const before = fingerprint(root);
      const beside = await writeFile(
        root,
        LABELS,
        edited(root, LABELS, '"Account manager"', '"Contract owner"'),
        options,
      );
      expectRefused(beside, root, before);
      expect(beside.validation?.findings).toContainEqual(
        expect.objectContaining({
          file: `${CONFIG}/queues/up-for-renewal.json`,
          place: 'queue "up-for-renewal"',
          message: 'contracts-b contributes it too',
          kind: 'clash',
        }),
      );
    });

    it('puts every file back when a move fails part way', async () => {
      const root = kit('contracts-demo', 'part-way');
      const before = fingerprint(root);
      const changes: Change[] = [
        {
          kind: 'write',
          path: LABELS,
          content: edited(root, LABELS, '"Contract manager"', '"Owner"'),
        },
        {
          kind: 'write',
          path: QUEUE,
          content: edited(root, QUEUE, '"pageSize": 50', '"pageSize": 25'),
        },
      ];
      const moved: string[] = [];
      let message = '';
      try {
        await writePackage(
          { package: root, changes },
          {
            ...OPTIONS,
            beforeMove: (path, index) => {
              moved.push(path);
              if (index === 1) throw new Error('the disk is full');
            },
          },
        );
      } catch (error) {
        message = (error as Error).message;
      }
      // The first file was moved into the package before the second failed.
      expect(moved).toEqual([LABELS, QUEUE]);
      expect(message).toContain('failed part way (the disk is full)');
      expect(message).toContain('Every file already written was put back');
      expect(fingerprint(root)).toEqual(before);
      expect(readdirSync(work)).toEqual([]);
    });

    it.skipIf(process.getuid?.() === 0)(
      'puts every file back when the file system refuses a move',
      async () => {
        const root = kit('contracts-demo', 'read-only');
        const before = fingerprint(root);
        const queues = join(root, CONFIG, 'queues');
        chmodSync(queues, 0o555);
        let message = '';
        try {
          await writePackage(
            {
              package: root,
              changes: [
                {
                  kind: 'write',
                  path: LABELS,
                  content: edited(root, LABELS, '"Contract manager"', '"Owner"'),
                },
                {
                  kind: 'write',
                  path: QUEUE,
                  content: edited(root, QUEUE, '"pageSize": 50', '"pageSize": 25'),
                },
              ],
            },
            OPTIONS,
          );
        } catch (error) {
          message = (error as Error).message;
        } finally {
          chmodSync(queues, 0o755);
        }
        expect(message).toMatch(/failed part way \(EACCES/);
        expect(message).toContain('Every file already written was put back');
        expect(fingerprint(root)).toEqual(before);
      },
    );

    it('refuses a path that differs from a file of the package only in case', async () => {
      const root = kit('contracts-demo', 'case');
      const before = fingerprint(root);
      await expect(
        writeFile(root, VIEW.replace('/Contract/', '/contract/'), read(root, VIEW)),
      ).rejects.toThrow(`differs only in case from ${CONFIG}/layouts/Contract,`);
      // A folder in another case, though no file of that name is there yet.
      await expect(
        writeFile(root, `${CONFIG}/layouts/contract/edit.layout.json`, read(root, VIEW)),
      ).rejects.toThrow(`differs only in case from ${CONFIG}/layouts/Contract,`);
      expect(fingerprint(root)).toEqual(before);
    });

    it('keeps the mode of a file it replaces', async () => {
      const root = kit('contracts-demo', 'mode');
      chmodSync(join(root, ...LABELS.split('/')), 0o600);
      const result = await writeFile(
        root,
        LABELS,
        edited(root, LABELS, '"Contract manager"', '"Owner"'),
      );
      expect(result.written).toBe(true);
      if (process.platform !== 'win32')
        expect(statSync(join(root, ...LABELS.split('/'))).mode & 0o777).toBe(0o600);
    });

    it('waits for no one: a lock a running process holds refuses the write, and one left is taken over', async () => {
      const root = kit('contracts-demo', 'locked');
      mkdirSync(join(root, 'dist'));
      const lock = join(root, 'dist', 'builder-mcp-write.lock');
      const content = edited(root, LABELS, '"Contract manager"', '"Owner"');
      // Held by a running process: this one.
      writeFileSync(lock, `${process.pid}\n`);
      const before = fingerprint(root);
      await expect(writeFile(root, LABELS, content)).rejects.toThrow(
        `is being committed, by process ${process.pid}`,
      );
      expect(fingerprint(root)).toEqual(before);
      expect(existsSync(lock)).toBe(true);
      // Left by one that has stopped.
      const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
      writeFileSync(lock, `${String(gone.stdout)}\n`);
      const result = await writeFile(root, LABELS, content);
      expect(result.written).toBe(true);
      expect(existsSync(lock)).toBe(false);
      // dist/ was the package's own, so it stays.
      expect(existsSync(join(root, 'dist'))).toBe(true);
    });

    it('names a model it was given as given, not the copy the generator read', async () => {
      const root = kit('contracts-demo', 'model-named');
      const model = 'business-apps/packages/contracts-demo/content-model.json';
      let message = '';
      try {
        await writePackage(
          {
            package: root,
            changes: [
              { kind: 'generator', generator: 'app-layout', options: { type: 'Nothing', model } },
            ],
          },
          OPTIONS,
        );
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(`The content model ${model} has no document type "Nothing"`);
      expect(message).not.toContain('<temporary>');
    });

    it('writes nothing to a package that changed while it was being checked', async () => {
      const root = kit('contracts-demo', 'changed-meanwhile');
      const content = edited(root, LABELS, '"Contract manager"', '"Owner"');
      let changedTo = '';
      const result = await writeFile(root, LABELS, content, {
        ...OPTIONS,
        beforeCommit: () => {
          changedTo = edited(root, QUEUE, '"pageSize": 50', '"pageSize": 10');
          writeFileSync(join(root, ...QUEUE.split('/')), changedTo);
        },
      });
      expect(result.written).toBe(false);
      expect(result.validation?.passed).toBe(true);
      expect(result.note).toContain('the package changed while the changes were being checked');
      expect(read(root, LABELS)).not.toBe(content);
      expect(read(root, QUEUE)).toBe(changedTo);
    });

    it.skipIf(process.platform === 'win32')(
      'writes nothing to a package that gained a link while it was being checked',
      async () => {
        const root = kit('contracts-demo', 'linked-meanwhile');
        const labels = read(root, LABELS);
        const outsideFolder = mkdtempSync(join(scratch, 'meanwhile-'));
        let message = '';
        try {
          await writeFile(root, QUEUE, edited(root, QUEUE, '"pageSize": 50', '"pageSize": 25'), {
            ...OPTIONS,
            beforeCommit: () => {
              rmSync(join(root, CONFIG, 'queues'), { recursive: true });
              symlinkSync(outsideFolder, join(root, CONFIG, 'queues'));
            },
          });
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toContain(`holds a link, ${CONFIG}/queues, which is not followed`);
        expect(message).toContain('Nothing was written');
        expect(readdirSync(outsideFolder)).toEqual([]);
        expect(read(root, LABELS)).toBe(labels);
        expect(existsSync(join(root, 'dist'))).toBe(false);
      },
    );

    it('runs a generator on the staging copy and writes what it wrote, when it passes', async () => {
      const root = kit('contracts-demo', 'queue-generator');
      const result = await writePackage(
        {
          package: root,
          changes: [
            {
              kind: 'generator',
              generator: 'app-queue',
              options: {
                id: 'active-contracts',
                pageProvider: 'contracts_up_for_renewal',
                columns: 'contract:number,dc:title',
              },
            },
          ],
        },
        OPTIONS,
      );
      expect(result.written, JSON.stringify(result)).toBe(true);
      expect(result.changes).toEqual([
        { path: 'bundle/OSGI-INF/contracts-demo-config.xml', change: 'updated' },
        { path: LABELS, change: 'updated' },
        { path: `${CONFIG}/queues/active-contracts.json`, change: 'created' },
      ]);
      expect(read(root, `${CONFIG}/queues/active-contracts.json`)).toContain(
        '"pageProvider": "contracts_up_for_renewal"',
      );
      // What the generator printed names the package, not the staging copy.
      expect(result.generatorOutput.join('\n')).toContain('active-contracts');
      expect(result.generatorOutput.join('\n')).not.toContain(work);
    });

    it.skipIf(process.platform === 'win32')(
      'loads no code of the package while a generator formats what it wrote',
      async () => {
        // A stand-in repository, as the generator's process reads one. At the package's path in it
        // is a prettier.config.mjs, which Nx's formatFiles would load, since it looks for a
        // configuration upwards from each file it formats. A package in business-apps/packages/
        // of this checkout is where it would be; the test does not write there.
        const fake = mkdtempSync(join(scratch, 'fake-repository-'));
        for (const file of ['package.json', '.prettierrc', '.editorconfig', '.prettierignore'])
          cpSync(join(REPO_ROOT, file), join(fake, file));
        symlinkSync(join(REPO_ROOT, 'node_modules'), join(fake, 'node_modules'));
        const packagePath = 'business-apps/packages/planted';
        const planted = join(fake, ...packagePath.split('/'));
        mkdirSync(planted, { recursive: true });
        // Loaded, it leaves a marker at the stand-in repository's root.
        writeFileSync(
          join(planted, 'prettier.config.mjs'),
          "import { writeFileSync } from 'node:fs';\n" +
            "writeFileSync(new URL('../../../loaded.txt', import.meta.url), 'loaded');\n" +
            'export default {};\n',
        );
        const staging = kit('contracts-demo', 'runner-staging');
        const runWork = mkdtempSync(join(scratch, 'runner-work-'));
        const answer = await runGenerator({
          generator: 'app-queue',
          request: {
            factory: join(GENERATORS_SOURCE, 'app-queue', 'generator.ts'),
            options: {
              package: packagePath,
              id: 'all-contracts',
              pageProvider: 'contracts_up_for_renewal',
              force: false,
            },
            root: fake,
            packagePath,
            staging,
          },
          work: runWork,
          timeoutMs: 60_000,
        });
        expect('error' in answer ? answer.error : '').toBe('');
        expect(existsSync(join(fake, 'loaded.txt')), 'the package prettier.config.mjs ran').toBe(
          false,
        );
        // Formatted all the same, with the repository's configuration: printWidth 100.
        const queue = 'changes' in answer ? answer.changes : [];
        const written = queue.find((change) => change.path.endsWith('queues/all-contracts.json'));
        expect(Buffer.from(written?.content ?? '', 'base64').toString('utf8')).toContain(
          '"columns": ["dc:title", "dc:modified"]',
        );
      },
    );

    it("refuses an action id that is the platform's, as the generator does", async () => {
      const root = kit('contracts-demo', 'platform-id');
      const before = fingerprint(root);
      await expect(
        writePackage(
          {
            package: root,
            changes: [
              {
                kind: 'generator',
                generator: 'app-action',
                options: { id: 'app.approve', transition: 'approve', on: 'record' },
              },
            ],
          },
          OPTIONS,
        ),
      ).rejects.toThrow(/app-action refused:[\s\S]*app\./);
      expect(fingerprint(root)).toEqual(before);
    });

    it('refuses an operation the allow-list does not name, from app-action too', async () => {
      const root = kit('payers-claims-demo', 'generated-operation');
      const before = fingerprint(root);
      const result = await writePackage(
        {
          package: root,
          changes: [
            {
              kind: 'generator',
              generator: 'app-action',
              options: { id: 'payers.delete', operation: 'Document.Delete', on: 'record' },
            },
          ],
        },
        OPTIONS,
      );
      expectRefused(result, root, before);
      expect(result.validation?.findings.map((finding) => finding.message).join('\n')).toContain(
        "is not on this deployment's allow-list",
      );
    });

    it('refuses what a generator writes outside the package, or a file no generator writes', async () => {
      const root = kit('contracts-demo', 'rogue-generator');
      const before = fingerprint(root);
      const rogue = (path: string): WriteOptions => ({
        ...OPTIONS,
        generate: async ({ request }) => ({
          changes: [
            {
              path: path.replace('<package>', request.packagePath),
              type: 'CREATE',
              content: Buffer.from('{}').toString('base64'),
            },
          ],
          said: [],
        }),
      });
      const run = (path: string) =>
        writePackage(
          { package: root, changes: [{ kind: 'generator', generator: 'app-registry' }] },
          rogue(path),
        );
      await expect(run('package.json')).rejects.toThrow('which is outside the package');
      await expect(run('<package>-other/x.json')).rejects.toThrow('which is outside the package');
      await expect(run('<package>/../escape.json')).rejects.toThrow('leaves the package');
      await expect(run('<package>/demo/seed.mjs')).rejects.toThrow('is code');
      await expect(run('<package>/deployment/build-allow-list.json')).rejects.toThrow(
        "is the deployment's",
      );
      expect(fingerprint(root)).toEqual(before);
      expect(readdirSync(work)).toEqual([]);
    });

    it('makes a new demo kit in one call, though each step would be refused alone', async () => {
      const pkg = join(packages, 'acme-fleet');
      const alone = await writePackage(
        {
          package: pkg,
          changes: [{ kind: 'generator', generator: 'app-package', options: { owner: 'acme' } }],
        },
        OPTIONS,
      );
      expect(alone.written).toBe(false);
      expect(alone.validation?.refusedAt).not.toBeNull();
      expect(existsSync(pkg)).toBe(false);

      const model = `${pkg}/content-model.json`;
      const result = await writePackage(
        {
          package: pkg,
          changes: [
            {
              kind: 'generator',
              generator: 'app-package',
              options: { owner: 'acme', title: 'Acme Fleet' },
            },
            {
              kind: 'generator',
              generator: 'app-model',
              options: { type: 'Vehicle', properties: 'plate,status=Active|Retired,mileage:long' },
            },
            { kind: 'generator', generator: 'app-layout', options: { type: 'Vehicle', model } },
          ],
        },
        OPTIONS,
      );
      expect(result.written, JSON.stringify(result.validation?.stderr ?? result)).toBe(true);
      expect(result.changes.map((change) => change.path)).toEqual(
        expect.arrayContaining([
          'build.mjs',
          'content-model.json',
          `${CONFIG}/app.json`,
          `${CONFIG}/layouts/Vehicle/view.layout.json`,
        ]),
      );
      expect(result.changes.every((change) => change.change === 'created')).toBe(true);
      expect(read(pkg, 'build.mjs')).toBe(
        readFileSync(
          join(
            REPO_ROOT,
            'tools',
            'satori-generators',
            'src',
            'config-package',
            'files',
            'build.mjs__tmpl__',
          ),
          'utf8',
        ),
      );
      expect(existsSync(join(pkg, 'dist'))).toBe(false);
      expect((await validatePackage({ directory: pkg }, { roots: [packages] })).passed).toBe(true);
    });

    it('makes a demo kit with a checklist, a facet, a type with no schema of its own and a register, none by hand', async () => {
      const pkg = join(packages, 'acme-onboard');
      const model = `${pkg}/content-model.json`;
      const view = `${CONFIG}/layouts/Customer/view.layout.json`;
      const generator = (name: string, options: Record<string, unknown>): Change => ({
        kind: 'generator',
        generator: name,
        options,
      });
      const result = await writePackage(
        {
          package: pkg,
          changes: [
            generator('app-package', { owner: 'acme', title: 'Acme Onboarding' }),
            generator('app-model', {
              type: 'Customer',
              properties: 'number,status=Open|Done,steps:checklist',
              facets: 'Versionable',
              attachments: true,
            }),
            generator('app-model', { type: 'Request', schemaless: true, facets: 'Versionable' }),
            generator('app-model', {
              type: 'CustomerRegister',
              folder: true,
              subtypes: 'Customer,Request',
            }),
            generator('app-layout', { type: 'Customer', model }),
          ],
        },
        OPTIONS,
      );
      expect(result.written, JSON.stringify(result.validation?.stdout ?? result)).toBe(true);
      const described = JSON.parse(read(pkg, 'content-model.json'));
      expect(Object.keys(described.doctypes)).toEqual(['Customer', 'Request', 'CustomerRegister']);
      // The checklist card on the generated record page, held to the property's shape.
      const page = JSON.parse(read(pkg, view));
      page.cards.push({
        id: 'steps',
        label: 'Steps',
        checklist: {
          field: 'customer:steps',
          tickable: true,
          items: [{ id: 'identity', label: 'Identity checked' }],
        },
      });
      const card = await writeFile(pkg, view, `${JSON.stringify(page, null, 2)}\n`);
      expect(card.written, JSON.stringify(card.validation?.stdout)).toBe(true);
      // On a property that is not a checklist's entries, the same card is refused.
      page.cards[page.cards.length - 1].checklist.field = 'customer:status';
      const wrong = await writeFile(pkg, view, `${JSON.stringify(page, null, 2)}\n`);
      expect(wrong.written).toBe(false);
      expect(wrong.validation?.findings.map((finding) => finding.message).join('\n')).toContain(
        'a checklist reads a list of complex values',
      );
    });

    it("makes a new package on a server's model in one generator, the model a file in the repository", async () => {
      const pkg = join(packages, 'acme-contracts');
      const result = await writePackage(
        {
          package: pkg,
          changes: [
            {
              kind: 'generator',
              generator: 'app-package',
              options: {
                owner: 'acme',
                title: 'Acme Contracts',
                groups: 'contract-managers',
                type: 'Contract',
                model: 'business-apps/packages/contracts-demo/content-model.json',
              },
            },
          ],
        },
        OPTIONS,
      );
      expect(result.written, JSON.stringify(result.validation?.stderr ?? result)).toBe(true);
      expect(read(pkg, `${CONFIG}/layouts/Contract/view.layout.json`)).toContain('"version": 2');
      expect(existsSync(join(pkg, 'content-model.json'))).toBe(false);
    });

    it('writes nothing to a new package another write made meanwhile', async () => {
      const pkg = join(packages, 'acme-meanwhile');
      const result = await writePackage(
        {
          package: pkg,
          changes: [
            {
              kind: 'generator',
              generator: 'app-package',
              options: {
                owner: 'acme',
                type: 'Contract',
                model: 'business-apps/packages/contracts-demo/content-model.json',
              },
            },
          ],
        },
        { ...OPTIONS, beforeCommit: () => mkdirSync(pkg) },
      );
      expect(result.written).toBe(false);
      expect(result.note).toContain('the package changed while the changes were being checked');
      expect(readdirSync(pkg)).toEqual([]);
    });

    it('leaves no package folder behind when a new package is refused', async () => {
      const pkg = join(packages, 'acme-refused');
      await expect(
        writePackage(
          {
            package: pkg,
            changes: [
              { kind: 'generator', generator: 'app-package', options: { owner: 'acme' } },
              {
                kind: 'generator',
                generator: 'app-layout',
                options: { type: 'Nothing', model: `${pkg}/content-model.json` },
              },
            ],
          },
          OPTIONS,
        ),
      ).rejects.toThrow('app-layout refused');
      expect(existsSync(pkg)).toBe(false);
      expect(readdirSync(work)).toEqual([]);
    });
  },
);
