import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import * as prettier from 'prettier';
import { beforeEach, describe, expect, it } from 'vitest';

import { generatorFilesDir } from '../util/generator-files-dir';
import appPackageGenerator, { type AppPackageSchema } from './generator';
import { platformRoutes, PLATFORM_ROUTES_FILE } from './package-files';
import { CONTRACTS_MODEL, validate } from './testing/scaffold';

const ROOT = 'business-apps/packages/acme-contracts';
const CONFIG = `${ROOT}/bundle/agentic-ui-config`;
const json = (tree: Tree, path: string): unknown => JSON.parse(tree.read(path, 'utf-8') ?? 'null');

describe('app-package generator', () => {
  let tree: Tree;
  const generate = (options: Partial<AppPackageSchema> = {}) =>
    appPackageGenerator(tree, {
      name: 'acme-contracts',
      owner: 'acme',
      platform: '>=0.2.0 <1.0.0',
      ...options,
    });

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('writes app.json version 2, with its name as a label key in labels/en.json', async () => {
    await generate({ title: 'Acme Contracts', groups: 'contract-managers, legal' });
    expect(json(tree, `${CONFIG}/app.json`)).toEqual({
      $schema: '../../../../../libs/shared/app-definition/src/app.schema.json',
      version: 2,
      id: 'acme-contracts',
      label: 'Acme Contracts',
      labelKey: 'acme-contracts.app',
      packageVersion: '0.1.0',
      platform: '>=0.2.0 <1.0.0',
      // Written, so that the validator holds it to the platform's routes.
      address: 'acme-contracts',
      groups: ['contract-managers', 'legal'],
      branding: { applicationTitle: 'Acme Contracts' },
    });
    expect(json(tree, `${CONFIG}/labels/en.json`)).toEqual({
      $schema: '../../../../../../libs/shared/app-definition/src/labels.schema.json',
      version: 2,
      labels: { 'acme-contracts.app': 'Acme Contracts' },
    });
  });

  it('writes one version into package.xml, app.json and the manifest', async () => {
    await generate({ version: '1.2.3' });
    expect(tree.read(`${ROOT}/package/package.xml`, 'utf-8')).toContain(
      '<package type="addon" name="acme-contracts" version="1.2.3">',
    );
    expect((json(tree, `${CONFIG}/app.json`) as { packageVersion: string }).packageVersion).toBe(
      '1.2.3',
    );
    expect(tree.read(`${ROOT}/bundle/META-INF/MANIFEST.MF`, 'utf-8')).toContain(
      'Bundle-Version: 1.2.3',
    );
  });

  describe('describes only what it wrote', () => {
    const readme = () => tree.read(`${ROOT}/README.md`, 'utf-8') ?? '';
    const descriptor = () => tree.read(`${ROOT}/package/package.xml`, 'utf-8') ?? '';
    /** The rows of the README's table of files, by the file each names. */
    const rows = () =>
      [...readme().matchAll(/^\| `([^`]+)` +\|/gm)].map(([, file]) => file).filter(Boolean);

    it('names no queue, action or record page in a package that has none', async () => {
      await generate({ title: 'Acme Contracts' });
      expect(descriptor()).not.toMatch(/queues|actions|record pages/);
      expect(descriptor()).toContain(
        '<p>The Acme Contracts app definition, a Nuxeo Satori business app.</p>',
      );
      expect(rows()).toEqual([
        'bundle/agentic-ui-config/app.json',
        'bundle/agentic-ui-config/labels/en.json',
        'bundle/OSGI-INF/acme-contracts-config.xml',
        'bundle/META-INF/MANIFEST.MF',
        'package/package.xml',
        'package/install.xml',
        'build.mjs',
      ]);
      // Each row is a file the generator wrote.
      for (const file of rows()) expect(tree.exists(`${ROOT}/${file}`), file).toBe(true);
      expect(readme()).not.toMatch(/\| `[^`]*(queues|actions\.json)/);
    });

    it('names the record page it wrote, given --type', async () => {
      await generate({ type: 'Contract', model: CONTRACTS_MODEL });
      expect(rows()).toContain('bundle/agentic-ui-config/layouts/Contract/view.layout.json');
      for (const file of rows()) expect(tree.exists(`${ROOT}/${file}`), file).toBe(true);
      expect(descriptor()).not.toMatch(/queues|actions/);
    });
  });

  it('writes a component ordered after Satori, with no bootstrap fragment', async () => {
    await generate();
    const component = tree.read(`${ROOT}/bundle/OSGI-INF/acme-contracts-config.xml`, 'utf-8') ?? '';
    expect(component).toContain('<component name="acme.config.acme-contracts" version="1.0">');
    expect(component).toContain('<require>org.nuxeo.agentic.ui.config.defaults</require>');
    expect(component).not.toContain('<fragment');
    expect(tree.read(`${ROOT}/bundle/META-INF/MANIFEST.MF`, 'utf-8')).toContain(
      'Nuxeo-Component: OSGI-INF/acme-contracts-config.xml',
    );
    expect(tree.read(`${ROOT}/package/package.xml`, 'utf-8')).toContain(
      '<package>nuxeo-agentic-ui:2026.0.2</package>',
    );
    expect(tree.exists(`${CONFIG}/bootstrap.json`)).toBe(false);
  });

  it("writes the config-package generator's build.mjs, byte for byte, as the pipeline's step 1 requires", async () => {
    await generate();
    expect(
      tree
        .read(`${ROOT}/build.mjs`)
        ?.equals(readFileSync(join(generatorFilesDir('config-package'), 'build.mjs__tmpl__'))),
    ).toBe(true);
  });

  it('writes its JSON and Markdown as Prettier formats them', async () => {
    // Nx formats with the formatter the workspace configures. This repository's is Prettier; the
    // empty workspace Nx tests in configures oxfmt, which is not installed here.
    tree.delete('.oxfmtrc.json');
    tree.write('.prettierrc', JSON.stringify({ printWidth: 100, singleQuote: true }));
    await generate({ type: 'Contract', model: CONTRACTS_MODEL });
    const files = tree
      .listChanges()
      .map((change) => change.path)
      .filter((path) => path.startsWith(`${ROOT}/`) && /\.(json|md)$/.test(path));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const path of files) {
      const text = tree.read(path, 'utf-8') ?? '';
      expect(
        await prettier.format(text, { filepath: path, printWidth: 100, singleQuote: true }),
        path,
      ).toBe(text);
    }
  });

  it("takes the platform range from libs/platform's version, up to its next major", async () => {
    tree.write('libs/platform/package.json', JSON.stringify({ version: '0.4.1' }));
    await appPackageGenerator(tree, { name: 'acme-contracts', owner: 'acme' });
    expect((json(tree, `${CONFIG}/app.json`) as { platform: string }).platform).toBe(
      '>=0.4.0 <1.0.0',
    );
    tree = createTreeWithEmptyWorkspace();
    tree.write('libs/platform/package.json', JSON.stringify({ version: '2.1.0' }));
    await appPackageGenerator(tree, { name: 'acme-contracts', owner: 'acme' });
    expect((json(tree, `${CONFIG}/app.json`) as { platform: string }).platform).toBe(
      '>=2.1.0 <3.0.0',
    );
  });

  it('writes the first record page, contributed by the component, when given a type', async () => {
    await generate({ type: 'Contract', model: CONTRACTS_MODEL });
    expect(tree.exists(`${CONFIG}/layouts/Contract/view.layout.json`)).toBe(true);
    expect(tree.read(`${ROOT}/bundle/OSGI-INF/acme-contracts-config.xml`, 'utf-8')).toContain(
      '<layout type="Contract" mode="view" src="agentic-ui-config/layouts/Contract/view.layout.json" />',
    );
  });

  it('lists each group once, as the validator requires', async () => {
    await generate({ groups: 'legal,legal, legal,members' });
    expect((json(tree, `${CONFIG}/app.json`) as { groups: string[] }).groups).toEqual([
      'legal',
      'members',
    ]);
  });

  it("refuses a platform range that leaves out libs/platform's version, as the pipeline would", async () => {
    tree.write('libs/platform/package.json', JSON.stringify({ version: '0.2.0' }));
    await expect(generate({ platform: '>=0.3.0 <1.0.0' })).rejects.toThrow(
      'leaves out this platform, 0.2.0',
    );
    await expect(generate({ platform: '^0.3.0' })).rejects.toThrow('leaves out this platform');
    // A release comes after every prerelease of its own version, as the validator compares them.
    for (const range of ['^0.3.0-0', '>=0.3.0-0', '<0.2.0-rc.1', '>0.2.0']) {
      await expect(generate({ platform: range }), range).rejects.toThrow(
        'leaves out this platform',
      );
    }
    await expect(generate({ platform: '>=0.2.0 <9007199254740993.0.0' })).rejects.toThrow(
      'is not a range',
    );
    await generate({ platform: '>=0.2.0-0 <1.0.0' });
    // 0.2.0 is after its own prerelease: a range that starts past one holds it.
    tree = createTreeWithEmptyWorkspace();
    tree.write('libs/platform/package.json', JSON.stringify({ version: '0.2.0' }));
    await generate({ platform: '>0.2.0-rc.1 <1.0.0' });
    tree = createTreeWithEmptyWorkspace();
    tree.write('libs/platform/package.json', JSON.stringify({ version: '0.2.0' }));
    await generate({ platform: '~0.2.0' });
    expect((json(tree, `${CONFIG}/app.json`) as { platform: string }).platform).toBe('~0.2.0');
  });

  it('writes the app id the registry knows, when it is not the package name', async () => {
    await generate({ appId: 'acme-legal' });
    expect(json(tree, `${CONFIG}/app.json`)).toMatchObject({
      id: 'acme-legal',
      labelKey: 'acme-legal.app',
      address: 'acme-legal',
    });
    expect(tree.read(`${ROOT}/bundle/OSGI-INF/acme-contracts-config.xml`, 'utf-8')).toContain(
      '<app id="acme-legal" src="agentic-ui-config/app.json">',
    );
  });

  it('writes the address the shell is to open the app at, when it is not the id', async () => {
    // `contracts` is a platform route: the validator refuses it as the app's address, so an app
    // with that id needs one of its own.
    await generate({ appId: 'contracts', address: 'contract-desk' });
    expect(json(tree, `${CONFIG}/app.json`)).toMatchObject({
      id: 'contracts',
      address: 'contract-desk',
    });
  });

  describe("the platform's routes, read from the one place they are listed", () => {
    it('reads every name the validator refuses as an address, and some it must', () => {
      const routes = platformRoutes();
      // A guard on the reading itself: one that found nothing would let every address through.
      expect(routes).toEqual(expect.arrayContaining(['contracts', 'login', 'settings', 'tasks']));
      expect(routes.length).toBeGreaterThan(15);
      // Each, as an app's address, is refused by the validator: what the generator reads is in
      // the validator's list. The other way, apps/nuxeo-ui's platform-routes.spec.ts holds that
      // list to the application's routes, and the strict reading below to its every entry.
      const scratch = mkdtempSync(join(tmpdir(), 'platform-routes-'));
      try {
        for (const route of routes) {
          mkdirSync(join(scratch, route));
          writeFileSync(
            join(scratch, route, 'app.json'),
            JSON.stringify({
              version: 2,
              id: 'acme-app',
              label: 'Acme',
              packageVersion: '0.1.0',
              platform: '>=0.2.0 <1.0.0',
              address: route,
              groups: ['members'],
            }),
          );
        }
        const run = validate(scratch);
        for (const route of routes)
          expect(run.output).toContain(
            `address: the address "${route}" is the platform's own page, /${route}`,
          );
        expect(run.output).toContain(`${routes.length} files: 0 passed, ${routes.length} refused.`);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });

    it('refuses a list it cannot read whole, rather than read it in part', () => {
      const scratch = mkdtempSync(join(tmpdir(), 'platform-routes-'));
      const file = join(scratch, PLATFORM_ROUTES_FILE);
      try {
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(
          file,
          "export const PLATFORM_ROUTES: readonly string[] = [\n  'browse',\n  // 'gone',\n  'search',\n];\n",
        );
        expect(() => platformRoutes(scratch)).toThrow('is not a list of quoted names there');
        writeFileSync(
          file,
          "export const PLATFORM_ROUTES: readonly string[] = ['browse', 'search'];\n",
        );
        expect(platformRoutes(scratch)).toEqual(['browse', 'search']);
        expect(() => platformRoutes(join(scratch, 'nowhere'))).toThrow(
          "Cannot read the platform's routes",
        );
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  });

  describe('refuses, and writes nothing', () => {
    const refusals: [string, Partial<AppPackageSchema>, string][] = [
      ['a name that is not kebab-case', { name: 'Acme_Contracts' }, 'must be kebab-case'],
      ['a name Satori uses', { name: 'nuxeo-agentic-ui' }, 'a name Satori itself uses'],
      ['a device name Windows reserves', { name: 'aux' }, 'a device name Windows reserves'],
      ['an owner with capitals', { owner: 'Acme' }, '--owner "Acme"'],
      ['an app id the registry refuses', { appId: 'Contracts' }, '--appId "Contracts"'],
      ['an app id over 63 characters', { appId: `a${'b'.repeat(63)}` }, '--appId'],
      ['an address that is not a path segment', { address: 'Contract Desk' }, '--address'],
      [
        'an id that is a platform route, with no address of its own',
        { appId: 'contracts' },
        `The app's address would be "contracts", its id, which is the platform's own page, /contracts`,
      ],
      [
        'an address that is a platform route',
        { address: 'search' },
        `The app's address would be "search", which is the platform's own page, /search`,
      ],
      ['a version that is not semantic', { version: '1.0' }, '--version "1.0"'],
      ['a group with a control character', { groups: 'legal\u0007' }, '--groups'],
      ['a directory that climbs', { directory: '../elsewhere' }, '--directory "../elsewhere"'],
      ['a model with no type', { model: CONTRACTS_MODEL }, 'give its --type too'],
      ['a platform that is not a range', { platform: 'latest' }, '"latest" is not a range'],
    ];
    for (const [what, options, message] of refusals) {
      it(what, async () => {
        await expect(generate(options)).rejects.toThrow(message);
        expect(
          tree.listChanges().filter((change) => change.path.startsWith('business-apps/')),
        ).toEqual([]);
      });
    }

    it('a type the model does not have', async () => {
      // Found once the package's files are in the tree, by app-layout; a generator that throws has
      // nothing of its tree written to disk.
      await expect(generate({ type: 'Invoice', model: CONTRACTS_MODEL })).rejects.toThrow(
        'has no document type "Invoice"',
      );
    });

    it('a package that exists already: written again, it would lose what the others added', async () => {
      await generate();
      await expect(generate()).rejects.toThrow(`${ROOT} already exists`);
    });

    it('a workspace with no libs/platform and no --platform', async () => {
      await expect(
        appPackageGenerator(tree, { name: 'acme-contracts', owner: 'acme' }),
      ).rejects.toThrow('pass --platform');
    });
  });
});
