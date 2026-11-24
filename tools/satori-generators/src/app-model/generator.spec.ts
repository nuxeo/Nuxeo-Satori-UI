import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { readModel, schemasOf } from '../app-layout/content-model';
import appPackageGenerator from '../app-package/generator';
import appModelGenerator, { type AppModelSchema } from './generator';

const ROOT = 'business-apps/packages/acme-contracts';
const MODEL = `${ROOT}/bundle/OSGI-INF/acme-contracts-model.xml`;
const MANIFEST = `${ROOT}/bundle/META-INF/MANIFEST.MF`;
const read = (tree: Tree, path: string): string => tree.read(path, 'utf-8') ?? '';

describe('app-model generator', () => {
  let tree: Tree;
  const generate = (options: Partial<AppModelSchema> = {}) =>
    appModelGenerator(tree, { package: ROOT, type: 'Contract', ...options });
  const contract = () =>
    generate({
      properties:
        'number, counterparty, status=Draft|Active|Terminated, value:double, start:date, end:date, noticeDays:long, autoRenew:boolean, parties:string[]',
    });

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    await appPackageGenerator(tree, {
      name: 'acme-contracts',
      owner: 'acme',
      platform: '>=0.2.0 <1.0.0',
    });
  });

  it("writes the type's schema: one element per property, a list through a list type", async () => {
    await contract();
    const xsd = read(tree, `${ROOT}/bundle/schemas/contract.xsd`);
    expect(xsd).toContain(
      'targetNamespace="http://www.nuxeo.org/ecm/project/schemas/acme-contracts/contract"',
    );
    expect(xsd).toContain(
      '  <xs:simpleType name="stringList">\n    <xs:list itemType="xs:string" />\n  </xs:simpleType>\n',
    );
    for (const element of [
      '<xs:element name="number" type="xs:string" />',
      '<xs:element name="value" type="xs:double" />',
      '<xs:element name="start" type="xs:date" />',
      '<xs:element name="noticeDays" type="xs:long" />',
      '<xs:element name="autoRenew" type="xs:boolean" />',
      '<xs:element name="parties" type="nxs:stringList" />',
    ])
      expect(xsd).toContain(element);
    expect(xsd).toContain(
      '  <xs:element name="status">\n' +
        '    <xs:simpleType>\n' +
        '      <xs:restriction base="xs:string">\n' +
        '        <xs:enumeration value="Draft" />\n' +
        '        <xs:enumeration value="Active" />\n' +
        '        <xs:enumeration value="Terminated" />\n',
    );
  });

  it('writes a model component of its own, the type a record with the default lifecycle', async () => {
    await contract();
    const xml = read(tree, MODEL);
    expect(xml).toContain('<component name="acme.config.acme-contracts.model" version="1.0">');
    expect(xml).toContain('<require>org.nuxeo.runtime.started</require>');
    // It contributes nothing to Satori's configuration, so it needs none of its defaults.
    expect(xml).not.toContain('target="org.nuxeo.agentic.ui.config"');
    expect(xml).toContain(
      '  <extension target="org.nuxeo.ecm.core.schema.TypeService" point="schema">\n' +
        '    <schema name="contract" prefix="contract" src="schemas/contract.xsd" />\n' +
        '  </extension>',
    );
    expect(xml).toContain(
      '    <doctype name="Contract" extends="Document">\n' +
        '      <schema name="common" />\n' +
        '      <schema name="dublincore" />\n' +
        '      <schema name="contract" />\n' +
        '    </doctype>',
    );
    expect(xml).toContain(
      '  <extension target="org.nuxeo.ecm.core.lifecycle.LifeCycleService" point="types">\n' +
        '    <types>\n      <type name="Contract">default</type>\n    </types>\n',
    );
  });

  it("lists the model component first in the manifest's Nuxeo-Component, once", async () => {
    await contract();
    await generate({ type: 'Counterparty', properties: 'name,registration' });
    expect(read(tree, MANIFEST)).toContain(
      'Nuxeo-Component: OSGI-INF/acme-contracts-model.xml,OSGI-INF/acme-contracts-config.xml\n',
    );
    // A second type goes in the same component, in the same extensions.
    const xml = read(tree, MODEL);
    expect(xml.match(/point="doctype"/g)).toHaveLength(1);
    expect(xml).toContain('<doctype name="Counterparty" extends="Document">');
  });

  it('describes the type in content-model.json, as the export does, for the other generators', async () => {
    await contract();
    const raw = JSON.parse(read(tree, `${ROOT}/content-model.json`));
    const model = readModel(raw, 'content-model.json');
    const type = model.types.get('Contract');
    expect(type && schemasOf(model, type)).toEqual(['common', 'dublincore', 'contract']);
    const schema = model.schemas.get('contract');
    expect(schema?.prefix).toBe('contract');
    expect(
      Object.fromEntries(
        [...(schema?.properties ?? [])].map(([n, p]) => [n, `${p.type}${p.list ? '[]' : ''}`]),
      ),
    ).toEqual({
      number: 'string',
      counterparty: 'string',
      status: 'string',
      value: 'double',
      start: 'date',
      end: 'date',
      noticeDays: 'long',
      autoRenew: 'boolean',
      parties: 'string[]',
    });
    expect(model.schemas.get('dublincore')?.properties.get('title')?.type).toBe('string');
  });

  it('writes a page provider over the type, reading the repository, a ? bound as a literal', async () => {
    await contract();
    await generate({
      pageProvider: 'acme_active_contracts',
      where: "contract:status = 'Active' AND contract:end <= NOW('P90D')",
      sort: 'contract:end',
    });
    await generate({ pageProvider: 'acme_contracts_of', where: 'contract:counterparty = ?' });
    const xml = read(tree, MODEL);
    expect(xml).toContain(
      '    <coreQueryPageProvider name="acme_active_contracts">\n' +
        '      <pattern>\n' +
        "        SELECT * FROM Document WHERE ecm:primaryType = 'Contract' AND (contract:status = 'Active' AND contract:end &lt;= NOW('P90D'))\n" +
        '        AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0\n' +
        '      </pattern>\n' +
        '      <sort column="contract:end" ascending="true" />\n' +
        '      <pageSize>50</pageSize>\n' +
        '      <maxPageSize>100</maxPageSize>\n' +
        '    </coreQueryPageProvider>',
    );
    expect(xml).toContain('<pattern quoteParameters="true" escapeParameters="true">');
    expect(xml).toContain('<sort column="dc:modified" ascending="false" />');
    expect(xml.match(/point="providers"/g)).toHaveLength(1);
  });

  it('writes a page provider again in its place with --force', async () => {
    await generate({ pageProvider: 'acme_contracts' });
    await generate({ pageProvider: 'acme_contracts', sort: 'dc:title', pageSize: 20, force: true });
    const xml = read(tree, MODEL);
    expect(xml.match(/<coreQueryPageProvider /g)).toHaveLength(1);
    expect(xml).toContain('<sort column="dc:title" ascending="true" />');
    expect(xml).toContain('<pageSize>20</pageSize>');
  });

  it("writes the type's schema again with --force, and keeps the component's entries", async () => {
    await contract();
    await generate({ properties: 'number,title', force: true });
    expect(read(tree, `${ROOT}/bundle/schemas/contract.xsd`)).toContain('<xs:element name="title"');
    expect(read(tree, MODEL).match(/<doctype /g)).toHaveLength(1);
    const raw = JSON.parse(read(tree, `${ROOT}/content-model.json`));
    expect(raw.schemas.find((s: { name: string }) => s.name === 'contract').fields).toEqual({
      number: 'string',
      title: 'string',
    });
  });

  it('takes a schema name and prefix of its own', async () => {
    await generate({ properties: 'number', schema: 'acme_contract', prefix: 'acon' });
    expect(read(tree, MODEL)).toContain(
      '<schema name="acme_contract" prefix="acon" src="schemas/acme_contract.xsd" />',
    );
    expect(tree.exists(`${ROOT}/bundle/schemas/acme_contract.xsd`)).toBe(true);
    // Without --prefix, the schema's name without its "_", which a prefix may not have.
    await generate({ type: 'AcmeDeed', properties: 'number', schema: 'acme_deed' });
    expect(read(tree, MODEL)).toContain(
      '<schema name="acme_deed" prefix="acmedeed" src="schemas/acme_deed.xsd" />',
    );
  });

  it('keeps a condition with parentheses and quotes of its own whole', async () => {
    await generate({
      pageProvider: 'p',
      where:
        "(contract:status = 'Active' OR contract:status = 'Draft (old)') AND contract:end IS NOT NULL",
    });
    expect(read(tree, MODEL)).toContain(
      "AND ((contract:status = 'Active' OR contract:status = 'Draft (old)') AND contract:end IS NOT NULL)",
    );
  });

  it('writes again a page provider written as an empty element, and nothing after it', async () => {
    await generate({ pageProvider: 'first' });
    await generate({ pageProvider: 'second' });
    tree.write(
      MODEL,
      read(tree, MODEL).replace(
        /<coreQueryPageProvider name="first">[\s\S]*?<\/coreQueryPageProvider>/,
        '<coreQueryPageProvider name="first" />',
      ),
    );
    await generate({ pageProvider: 'first', sort: 'dc:title', force: true });
    const xml = read(tree, MODEL);
    expect(xml.match(/<coreQueryPageProvider /g)).toHaveLength(2);
    expect(xml).toContain('<coreQueryPageProvider name="second">');
    expect(xml).toContain('<sort column="dc:title" ascending="true" />');
  });

  describe('refuses, and writes nothing', () => {
    const refusals: [string, Partial<AppModelSchema>, string][] = [
      ['nothing to write', {}, 'Give the type its properties with --properties'],
      ["one of Nuxeo's own types", { type: 'File', properties: 'a' }, "one of Nuxeo's own types"],
      ['a type name that is not one', { type: '../Contract', properties: 'a' }, '--type'],
      ['a property type there is none of', { properties: 'a:money' }, 'has the type "money"'],
      ['a list of booleans', { properties: 'a:boolean[]' }, 'has the type "boolean[]"'],
      ['values for a number', { properties: 'a:long=1|2' }, 'only a single string may'],
      ['a value with markup', { properties: 'a=<b>' }, '"<b>", a value of "a"'],
      ['a property twice', { properties: 'a,b,a:long' }, 'lists "a" twice'],
      ['a property name with a colon', { properties: 'contract:number' }, 'has the type "number"'],
      ["Nuxeo's own schema", { properties: 'a', schema: 'dublincore' }, '--schema "dublincore"'],
      ["Dublin Core's prefix", { properties: 'a', prefix: 'dc' }, '--prefix "dc"'],
      ["a task's schema", { type: 'Task', properties: 'a' }, '--schema "task"'],
      ["a task's prefix", { properties: 'a', prefix: 'nt' }, '--prefix "nt"'],
      [
        'a condition that breaks out of its parentheses',
        { pageProvider: 'p', where: "contract:status = 'Active') OR (1 = 1" },
        'its parentheses and quotes closed',
      ],
      [
        'a condition left open',
        { pageProvider: 'p', where: "contract:status = 'Active" },
        'its parentheses and quotes closed',
      ],
      ['a schema with no properties', { pageProvider: 'p', schema: 'x' }, 'give those too'],
      [
        'a condition with an order',
        { pageProvider: 'p', where: 'a = 1 ORDER BY b' },
        'no ORDER BY',
      ],
      [
        'a condition with no page provider',
        { where: "a = 'b'", properties: 'a' },
        'give its --pageProvider too',
      ],
      ['a sort that is not a property', { pageProvider: 'p', sort: 'title' }, '--sort "title"'],
      ['a page size over 100', { pageProvider: 'p', pageSize: 500 }, '--pageSize 500'],
    ];
    for (const [what, options, message] of refusals) {
      it(what, async () => {
        const manifest = read(tree, MANIFEST);
        await expect(generate(options)).rejects.toThrow(message);
        expect(tree.exists(MODEL)).toBe(false);
        expect(read(tree, MANIFEST)).toBe(manifest);
        expect(tree.exists(`${ROOT}/content-model.json`)).toBe(false);
      });
    }

    it('a type it has, or a page provider, without --force', async () => {
      await contract();
      await expect(contract()).rejects.toThrow('has the type Contract already');
      await generate({ pageProvider: 'p' });
      await expect(generate({ pageProvider: 'p' })).rejects.toThrow(
        'has the page provider p already',
      );
    });

    it("another type's schema", async () => {
      await contract();
      await expect(
        generate({ type: 'Other', properties: 'a', schema: 'contract' }),
      ).rejects.toThrow('The schema contract is in');
    });
  });
});
