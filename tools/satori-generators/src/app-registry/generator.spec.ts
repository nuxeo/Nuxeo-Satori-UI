import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import appActionGenerator from '../app-action/generator';
import appFormGenerator from '../app-form/generator';
import appLayoutGenerator from '../app-layout/generator';
import appPackageGenerator from '../app-package/generator';
import { CONTRACTS_MODEL } from '../app-package/testing/scaffold';
import appQueueGenerator from '../app-queue/generator';
import appRegistryGenerator from './generator';

const ROOT = 'business-apps/packages/acme-contracts';
const CONFIG = `${ROOT}/bundle/agentic-ui-config`;
const COMPONENT = `${ROOT}/bundle/OSGI-INF/acme-contracts-config.xml`;
const component = (tree: Tree): string => tree.read(COMPONENT, 'utf-8') ?? '';
/** The paths the component's `<app>` names, in order. */
const named = (tree: Tree): string[] =>
  [...component(tree).matchAll(/<file path="([^"]+)" \/>/g)].map(([, path]) => path);

describe('app-registry generator', () => {
  let tree: Tree;
  const generate = () => appRegistryGenerator(tree, { package: ROOT });

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    await appPackageGenerator(tree, {
      name: 'acme-contracts',
      owner: 'acme',
      platform: '>=0.2.0 <1.0.0',
    });
  });

  it('is written by app-package: the app, from app.json, in an extension of its own', () => {
    expect(component(tree)).toContain(
      '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
        '    <app id="acme-contracts" src="agentic-ui-config/app.json">\n' +
        '      <file path="labels/en.json" />\n' +
        '    </app>\n' +
        '  </extension>\n</component>',
    );
  });

  it('is kept in step by app-queue and app-action, as they add a file the registry serves', async () => {
    // Each on its own: a later generator naming every file would hide one that named none.
    await appQueueGenerator(tree, { package: ROOT, id: 'open', pageProvider: 'acme_open' });
    expect(named(tree)).toEqual(['labels/en.json', 'queues/open.json']);
    await appActionGenerator(tree, {
      package: ROOT,
      id: 'acme-contracts.approve',
      transition: 'approve',
      on: 'record',
    });
    expect(named(tree)).toEqual(['labels/en.json', 'queues/open.json', 'actions.json']);
  });

  it('is kept in step by app-layout and app-form, when they write labels/en.json anew', async () => {
    tree.delete(`${CONFIG}/labels/en.json`);
    await appRegistryGenerator(tree, { package: ROOT });
    expect(named(tree)).toEqual([]);
    await appLayoutGenerator(tree, { package: ROOT, type: 'Contract', model: CONTRACTS_MODEL });
    expect(named(tree)).toEqual(['labels/en.json']);
    tree.delete(`${CONFIG}/labels/en.json`);
    await appRegistryGenerator(tree, { package: ROOT });
    await appFormGenerator(tree, { package: ROOT, type: 'Contract', model: CONTRACTS_MODEL });
    expect(named(tree)).toEqual(['labels/en.json']);
  });

  it('names a file written by hand, in the order app-definition-v2.md lists them, and drops one gone', async () => {
    const write = (file: string) => tree.write(`${CONFIG}/${file}`, '{ "version": 2 }\n');
    await appQueueGenerator(tree, { package: ROOT, id: 'open', pageProvider: 'acme_open' });
    tree.delete(`${CONFIG}/queues/open.json`);
    for (const file of [
      'tasks/review.approve.layout.json',
      'navigation.json',
      'home.json',
      'labels/fr.json',
      'queues/mine.json',
      // At no place the registry serves: never named.
      'notes.json',
      'queues/nested/deep.json',
      'labels/English.json',
    ])
      write(file);
    await generate();
    // The ones it named and still has stay as they were; the rest follow in the registry's order.
    expect(named(tree)).toEqual([
      'labels/en.json',
      'home.json',
      'navigation.json',
      'queues/mine.json',
      'labels/fr.json',
      'tasks/review.approve.layout.json',
    ]);
    // Run again: nothing to change.
    const before = component(tree);
    await generate();
    expect(component(tree)).toBe(before);
  });

  it('takes out a layout whose file is gone, and its extension when that held nothing else', async () => {
    await appLayoutGenerator(tree, { package: ROOT, type: 'Contract', model: CONTRACTS_MODEL });
    const before = component(tree);
    await appFormGenerator(tree, { package: ROOT, type: 'Contract', model: CONTRACTS_MODEL });
    expect(component(tree)).toContain('<layout type="Contract" mode="edit"');
    // The Edit form removed: its entry goes, its line with it, and the record page's stays.
    tree.delete(`${CONFIG}/layouts/Contract/edit.layout.json`);
    await generate();
    expect(component(tree)).toBe(before);
    // The record page removed too: the extension that held the layouts goes, and the app's stays.
    tree.delete(`${CONFIG}/layouts/Contract/view.layout.json`);
    await generate();
    expect(component(tree)).not.toContain('<layout ');
    expect(component(tree)).toBe(
      before.replace(
        /\n {2}<extension target="org\.nuxeo\.agentic\.ui\.config" point="configuration">\n {4}<layout [^\n]*\n {2}<\/extension>\n/,
        '',
      ),
    );
    expect(named(tree)).toEqual(['labels/en.json']);
  });

  it('leaves a layout whose file is there, and one contributed from elsewhere, to the pipeline', async () => {
    await appLayoutGenerator(tree, { package: ROOT, type: 'Contract', model: CONTRACTS_MODEL });
    const xml = component(tree).replace(
      '<layout type="Contract" mode="view"',
      '<layout type="Other" mode="view" src="other/place.json" />\n    <layout type="Contract" mode="view"',
    );
    tree.write(COMPONENT, xml);
    await generate();
    expect(component(tree)).toBe(xml);
  });

  it('writes one for a package that has none, and keeps what else the component holds', async () => {
    const xml = component(tree);
    const at = xml.indexOf('\n  <extension');
    tree.write(COMPONENT, `${xml.slice(0, at)}\n</component>\n`);
    // Without an <app>, the other generators leave it to this one.
    await appQueueGenerator(tree, { package: ROOT, id: 'open', pageProvider: 'acme_open' });
    expect(component(tree)).not.toContain('<app ');
    await generate();
    expect(named(tree)).toEqual(['queues/open.json', 'labels/en.json']);
    expect(component(tree)).toContain('<require>org.nuxeo.agentic.ui.config.defaults</require>');
  });

  it('finds no app in a comment, and fills one written as an empty element', async () => {
    const xml = component(tree);
    const at = xml.indexOf('\n  <extension');
    tree.write(
      COMPONENT,
      `${xml.slice(0, at)}\n  <!-- <app id="old" src="other.json" /> -->\n` +
        '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
        '    <app id="acme-contracts" src="agentic-ui-config/app.json" />\n' +
        '  </extension>\n</component>\n',
    );
    await generate();
    expect(component(tree)).toContain(
      '    <app id="acme-contracts" src="agentic-ui-config/app.json">\n' +
        '      <file path="labels/en.json" />\n' +
        '    </app>\n',
    );
    expect(component(tree)).toContain('<!-- <app id="old" src="other.json" /> -->');
  });

  describe('refuses, and changes nothing', () => {
    const refusals: [string, (xml: string) => string, string][] = [
      [
        'an app under another id',
        (xml) => xml.replace('<app id="acme-contracts"', '<app id="acme-contract"'),
        `contributes the app "acme-contract", and app.json's id is "acme-contracts"`,
      ],
      [
        'an app from another app.json',
        (xml) =>
          xml.replace('src="agentic-ui-config/app.json"', 'src="./agentic-ui-config/app.json"'),
        'contributes the app acme-contracts from ./agentic-ui-config/app.json',
      ],
      [
        'two apps',
        (xml) =>
          xml.replace(
            '    <app id="acme-contracts"',
            '    <app id="other" src="agentic-ui-config/app.json" />\n    <app id="acme-contracts"',
          ),
        'contributes 2 apps; a package is one app',
      ],
      [
        'an app that is disabled',
        (xml) =>
          xml.replace('<app id="acme-contracts"', '<app enabled="false" id="acme-contracts"'),
        'has the app disabled (enabled="false")',
      ],
    ];
    for (const [what, change, message] of refusals) {
      it(what, async () => {
        tree.write(COMPONENT, change(component(tree)));
        const before = component(tree);
        await expect(generate()).rejects.toThrow(message);
        expect(component(tree)).toBe(before);
      });
    }

    it('a package with more files than the registry serves', async () => {
      for (let i = 0; i < 256; i++) tree.write(`${CONFIG}/queues/q${i}.json`, '{}');
      await expect(generate()).rejects.toThrow('it serves at most 256');
    });

    it('a folder that is not a package', async () => {
      await expect(
        appRegistryGenerator(tree, { package: 'business-apps/packages/none' }),
      ).rejects.toThrow('is not an app definition package');
    });
  });
});
