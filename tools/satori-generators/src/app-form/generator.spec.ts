import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import appLayoutGenerator from '../app-layout/generator';
import appPackageGenerator from '../app-package/generator';
import { CONTRACTS_MODEL } from '../app-package/testing/scaffold';
import appFormGenerator, { type AppFormSchema } from './generator';

const ROOT = 'business-apps/packages/acme-contracts';
const CONFIG = `${ROOT}/bundle/agentic-ui-config`;
const COMPONENT = `${ROOT}/bundle/OSGI-INF/acme-contracts-config.xml`;
const formOf = (tree: Tree, type: string, mode = 'edit'): Record<string, unknown> =>
  JSON.parse(tree.read(`${CONFIG}/layouts/${type}/${mode}.layout.json`, 'utf-8') ?? 'null');
const labelsOf = (tree: Tree): Record<string, string> =>
  JSON.parse(tree.read(`${CONFIG}/labels/en.json`, 'utf-8') ?? 'null').labels;

describe('app-form generator', () => {
  let tree: Tree;
  const generate = (options: Partial<AppFormSchema> = {}) =>
    appFormGenerator(tree, {
      package: ROOT,
      type: 'Contract',
      model: CONTRACTS_MODEL,
      ...options,
    });

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    await appPackageGenerator(tree, {
      name: 'acme-contracts',
      owner: 'acme',
      platform: '>=0.2.0 <1.0.0',
    });
  });

  it('writes an Edit form, one card per schema, the title first, with no record-page keys', async () => {
    await generate();
    const form = formOf(tree, 'Contract');
    expect(form['$schema']).toBe(
      '../../../../../../../libs/shared/app-definition/src/layout-v2.schema.json',
    );
    expect(form['version']).toBe(2);
    // A form has no columns and no banners: the validator refuses both in edit mode.
    expect(Object.keys(form).sort()).toEqual(['$schema', 'cards', 'version']);
    const cards = form['cards'] as { id: string; labelKey: string; fields: unknown[] }[];
    expect(cards.map((card) => card.id)).toEqual(['contract', 'review']);
    expect(cards[0].fields).toEqual([
      // A form draws only the fields it lists, and a record is named by its title.
      'dc:title',
      'contract:number',
      // A document's id: a form edits the stored id as the bare name does.
      'contract:counterparty',
      // A directory: the form's vocabulary picker.
      {
        field: 'contract:category',
        widget: 'vocabulary',
        parameters: { directory: 'contract_category' },
      },
      { field: 'contract:regions', widget: 'vocabulary', parameters: { directory: 'country' } },
      'contract:value',
      'contract:signed',
      'contract:start',
      'contract:end',
      'contract:keywords',
      'contract:billingAddress',
      // `contract:lines` holds a file, and `contract:scan` is one: changed in Attachments.
      'contract:notes',
    ]);
    expect(cards[1].fields).toEqual(['rev:reviewer', 'rev:reviewed']);
  });

  it('has the component contribute it in its mode, beside the record page', async () => {
    await appLayoutGenerator(tree, { package: ROOT, type: 'Contract', model: CONTRACTS_MODEL });
    await generate();
    await generate({ mode: 'create' });
    const xml = tree.read(COMPONENT, 'utf-8') ?? '';
    expect(xml).toContain(
      '    <layout type="Contract" mode="view" src="agentic-ui-config/layouts/Contract/view.layout.json" />\n' +
        '    <layout type="Contract" mode="edit" src="agentic-ui-config/layouts/Contract/edit.layout.json" />\n' +
        '    <layout type="Contract" mode="create" src="agentic-ui-config/layouts/Contract/create.layout.json" />\n' +
        '  </extension>',
    );
    expect(tree.exists(`${CONFIG}/layouts/Contract/create.layout.json`)).toBe(true);
  });

  it("shares the record page's card headings, keeping a corrected one", async () => {
    await appLayoutGenerator(tree, { package: ROOT, type: 'Contract', model: CONTRACTS_MODEL });
    const labels = JSON.parse(tree.read(`${CONFIG}/labels/en.json`, 'utf-8') ?? '');
    labels.labels['acme-contracts.card.contract.contract'] = 'The contract';
    tree.write(`${CONFIG}/labels/en.json`, JSON.stringify(labels));
    await generate();
    const [card] = formOf(tree, 'Contract')['cards'] as { labelKey: string }[];
    expect(card.labelKey).toBe('acme-contracts.card.contract.contract');
    expect(labelsOf(tree)['acme-contracts.card.contract.contract']).toBe('The contract');
  });

  it('makes the fields --required names required, the title among them', async () => {
    await generate({ required: 'dc:title, contract:number,contract:category' });
    const [card] = formOf(tree, 'Contract')['cards'] as { fields: unknown[] }[];
    expect(card.fields.slice(0, 4)).toEqual([
      { field: 'dc:title', required: true },
      { field: 'contract:number', required: true },
      'contract:counterparty',
      {
        field: 'contract:category',
        widget: 'vocabulary',
        parameters: { directory: 'contract_category' },
        required: true,
      },
    ]);
  });

  it('leaves the title out when asked, or when --schemas shows Dublin Core whole', async () => {
    await generate({ title: false });
    const [card] = formOf(tree, 'Contract')['cards'] as { fields: unknown[] }[];
    expect(card.fields[0]).toBe('contract:number');
    await generate({ schemas: 'dublincore', force: true });
    expect(formOf(tree, 'Contract')['cards']).toEqual([
      {
        id: 'dublincore',
        labelKey: 'acme-contracts.card.contract.dublincore',
        fields: ['dc:title', 'dc:description', 'dc:created', 'dc:modified'],
      },
    ]);
  });

  describe('refuses, and writes nothing', () => {
    const refusals: [string, Partial<AppFormSchema>, string][] = [
      ['a record page, which is app-layout’s', { mode: 'view' }, '--mode "view" is not a form’s'],
      ['the Properties panel', { mode: 'metadata' }, '--mode "metadata"'],
      [
        'a required field the form does not list',
        { required: 'contract:scan' },
        '--required names contract:scan, which the form does not list',
      ],
      ['a required field that is not a property', { required: 'scan' }, '--required: "scan"'],
      ['a type the model does not have', { type: 'contract' }, 'did you mean Contract?'],
      ['a type with only Nuxeo’s own schemas', { type: 'Memo' }, 'Name the ones to show'],
      ['a type name that is not one', { type: '../Contract' }, '--type "../Contract"'],
      ['neither a model file nor a server', { model: undefined }, 'one way'],
    ];
    for (const [what, options, message] of refusals) {
      it(what, async () => {
        const before = tree.read(COMPONENT, 'utf-8');
        await expect(generate(options)).rejects.toThrow(message.replace(/’/g, "'"));
        expect(tree.read(COMPONENT, 'utf-8')).toBe(before);
        expect(tree.exists(`${CONFIG}/layouts`)).toBe(false);
      });
    }

    it('a form that exists, without --force', async () => {
      await generate();
      await expect(generate()).rejects.toThrow('already exists. Pass --force');
    });

    it('a component that contributes the form from another file', async () => {
      const xml = tree.read(COMPONENT, 'utf-8') ?? '';
      tree.write(
        COMPONENT,
        xml.replace(
          '</component>',
          '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
            '    <layout type="Contract" mode="edit" src="agentic-ui-config/contract-form.json" />\n' +
            '  </extension>\n</component>',
        ),
      );
      await expect(generate()).rejects.toThrow(
        'already contributes the Contract/edit layout, from agentic-ui-config/contract-form.json',
      );
      expect(tree.exists(`${CONFIG}/layouts/Contract/edit.layout.json`)).toBe(false);
    });
  });
});
