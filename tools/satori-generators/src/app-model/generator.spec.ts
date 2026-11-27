import { workspaceRoot, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { readModel, schemasOf } from '../app-layout/content-model';
import appLayoutGenerator from '../app-layout/generator';
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

  describe("names the schema's section of the Properties panel", () => {
    const labels = () =>
      JSON.parse(read(tree, `${ROOT}/bundle/agentic-ui-config/labels/en.json`)).labels as Record<
        string,
        string
      >;

    it('in labels/en.json, layout.schema.<schema>, from the type, as kit-schema-labels.spec.ts asks', async () => {
      await generate({ type: 'DamageClaim', properties: 'number' });
      // By the schema's name, not its prefix: the panel heads the section from it.
      expect(labels()['layout.schema.damageclaim']).toBe('Damage claim');
      await generate({ type: 'MoveItem', schema: 'move_item', prefix: 'mi', properties: 'tag' });
      expect(labels()['layout.schema.move_item']).toBe('Move item');
      expect(labels()['layout.schema.mi']).toBeUndefined();
    });

    it('keeps a text the kit gave it, written again with --force', async () => {
      await contract();
      const file = `${ROOT}/bundle/agentic-ui-config/labels/en.json`;
      const written = JSON.parse(read(tree, file));
      written.labels['layout.schema.contract'] = 'Agreement';
      tree.write(file, JSON.stringify(written));
      await generate({ properties: 'number', force: true });
      expect(labels()['layout.schema.contract']).toBe('Agreement');
    });

    it('writes none for a page provider alone', async () => {
      await contract();
      const before = read(tree, `${ROOT}/bundle/agentic-ui-config/labels/en.json`);
      await generate({ pageProvider: 'acme_contracts' });
      expect(read(tree, `${ROOT}/bundle/agentic-ui-config/labels/en.json`)).toBe(before);
    });
  });

  it("gives a new type Nuxeo's files schema with --attachments, and keeps it with --force", async () => {
    await generate({ properties: 'number, status=Open|Closed', attachments: true });
    expect(read(tree, MODEL)).toContain(
      '    <doctype name="Contract" extends="Document">\n' +
        '      <schema name="common" />\n' +
        '      <schema name="dublincore" />\n' +
        '      <schema name="files" />\n' +
        '      <schema name="contract" />\n' +
        '    </doctype>',
    );
    const described = () => {
      const model = readModel(JSON.parse(read(tree, `${ROOT}/content-model.json`)), 'model');
      const type = model.types.get('Contract');
      return { model, schemas: type && schemasOf(model, type) };
    };
    const { model, schemas } = described();
    expect(schemas).toEqual(['common', 'dublincore', 'files', 'contract']);
    const files = model.schemas.get('files')?.properties.get('files');
    expect(files?.list).toBe(true);
    expect(files?.fields?.get('file')?.type).toBe('blob');

    await generate({ properties: 'number, status=Open|Closed|Archived', force: true });
    expect(read(tree, MODEL)).toContain('<schema name="files" />');
    expect(described().schemas).toEqual(['common', 'dublincore', 'files', 'contract']);
  });

  it('writes no files schema without --attachments', async () => {
    await contract();
    expect(read(tree, MODEL)).not.toContain('<schema name="files" />');
    await expect(
      generate({ properties: 'number', attachments: true, force: true }),
    ).rejects.toThrow('give --attachments when the type is first written');
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

  describe('a page provider of the search index, with --aggregates', () => {
    const SEARCH_XSD = `${ROOT}/bundle/schemas/contractsearch.xsd`;
    const open = () =>
      generate({
        pageProvider: 'acme_open_contracts',
        where: "contract:status IN ('Draft', 'Active')",
        sort: 'contract:end',
        aggregates: 'contract:status,contract:noticeDays',
      });

    it('reads the index, with a terms aggregate per property, each its search field', async () => {
      await contract();
      await open();
      const xml = read(tree, MODEL);
      expect(xml).toContain(
        '    <genericPageProvider name="acme_open_contracts"\n' +
          '        class="org.nuxeo.ecm.platform.query.nxql.SearchServicePageProvider">\n' +
          '      <searchDocumentType>ContractSearch</searchDocumentType>\n' +
          '      <whereClause>\n' +
          '        <fixedPart>\n' +
          "          ecm:primaryType = 'Contract' AND (contract:status IN ('Draft', 'Active'))\n" +
          '          AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0\n' +
          '        </fixedPart>\n' +
          '      </whereClause>\n' +
          '      <aggregates>\n' +
          '        <aggregate id="contract_status_agg" type="terms" parameter="contract:status">\n' +
          '          <field schema="contract_search" name="contract_status_agg" />\n' +
          '          <properties>\n' +
          '            <property name="size">10</property>\n' +
          '          </properties>\n' +
          '        </aggregate>\n' +
          '        <aggregate id="contract_noticeDays_agg" type="terms" parameter="contract:noticeDays">\n',
      );
      expect(xml).toContain(
        '      </aggregates>\n' +
          '      <sort column="contract:end" ascending="true" />\n' +
          '      <pageSize>50</pageSize>\n' +
          '      <maxPageSize>100</maxPageSize>\n' +
          '    </genericPageProvider>',
      );
      expect(xml).not.toContain('<coreQueryPageProvider');
      // Its search document: never saved, hidden, with a schema of its own registered once.
      expect(xml).toContain(
        '    <doctype name="ContractSearch" extends="Document">\n' +
          '      <facet name="HiddenInNavigation" />\n' +
          '      <schema name="contract_search" />\n' +
          '    </doctype>',
      );
      expect(xml).toContain(
        '<schema name="contract_search" prefix="contractsearch" src="schemas/contractsearch.xsd" />',
      );
      const xsd = read(tree, SEARCH_XSD);
      expect(xsd).toContain('<xs:element name="contract_status_agg" type="nxs:stringList" />');
      expect(xsd).toContain('<xs:element name="contract_noticeDays_agg" type="nxs:stringList" />');
      // Not a record type: the content model the layouts are held to is unchanged.
      expect(read(tree, `${ROOT}/content-model.json`)).not.toContain('ContractSearch');
    });

    it("keeps the search document's fields for another page provider, and writes it once", async () => {
      await contract();
      await open();
      await generate({ pageProvider: 'acme_by_party', aggregates: 'dc:creator' });
      const xml = read(tree, MODEL);
      expect(xml.match(/<doctype name="ContractSearch"/g)).toHaveLength(1);
      expect(xml.match(/<schema name="contract_search" prefix=/g)).toHaveLength(1);
      expect(xml).toContain('<aggregate id="dc_creator_agg" type="terms" parameter="dc:creator">');
      const xsd = read(tree, SEARCH_XSD);
      for (const field of ['contract_status_agg', 'contract_noticeDays_agg', 'dc_creator_agg'])
        expect(xsd).toContain(`<xs:element name="${field}" type="nxs:stringList" />`);
    });

    it('turns a page provider of the repository into one of the index with --force', async () => {
      await contract();
      await generate({ pageProvider: 'acme_open_contracts' });
      await expect(open()).rejects.toThrow('has the page provider acme_open_contracts already');
      expect(read(tree, MODEL)).toContain('<coreQueryPageProvider name="acme_open_contracts">');
      await generate({
        pageProvider: 'acme_open_contracts',
        aggregates: 'contract:status',
        force: true,
      });
      const xml = read(tree, MODEL);
      expect(xml).not.toContain('<coreQueryPageProvider');
      expect(xml.match(/<genericPageProvider /g)).toHaveLength(1);
    });

    it('writes the type and its page provider in one run', async () => {
      await generate({
        properties: 'number,status=Draft|Active',
        pageProvider: 'acme_open_contracts',
        aggregates: 'contract:status',
      });
      expect(read(tree, MODEL)).toContain('<aggregate id="contract_status_agg"');
    });

    const refused: [string, Partial<AppModelSchema>, string][] = [
      [
        'with no page provider',
        { type: 'Other', properties: 'a', aggregates: 'other:a' },
        'give its --pageProvider too',
      ],
      [
        'with a parameter, which a queue cannot fill',
        { pageProvider: 'p', where: 'contract:counterparty = ?', aggregates: 'contract:status' },
        'has no record to fill it',
      ],
      [
        'on a property the type does not have',
        { pageProvider: 'p', aggregates: 'contract:owner' },
        '"contract:owner" is not a property of Contract',
      ],
      [
        'on a date, which ranges',
        { pageProvider: 'p', aggregates: 'contract:end' },
        '"contract:end" is a date property',
      ],
      ['on a double', { pageProvider: 'p', aggregates: 'contract:value' }, 'is a double property'],
      [
        'on something not a property',
        { pageProvider: 'p', aggregates: 'status' },
        '"status" must be a property',
      ],
      [
        'whose id a facet could not send back',
        { pageProvider: 'p', aggregates: 'common:icon-expanded' },
        'would make the aggregate "common_icon-expanded_agg", which a facet cannot send back',
      ],
      [
        'twice',
        { pageProvider: 'p', aggregates: 'contract:status,contract:status' },
        'lists "contract:status" twice',
      ],
    ];
    for (const [what, options, message] of refused) {
      it(`refuses an aggregate ${what}`, async () => {
        await contract();
        const before = read(tree, MODEL);
        await expect(generate(options)).rejects.toThrow(message);
        expect(read(tree, MODEL)).toBe(before);
        expect(tree.exists(SEARCH_XSD)).toBe(false);
      });
    }

    it("refuses a search schema whose file is another schema's", async () => {
      await contract();
      await generate({ type: 'ContractLog', properties: 'entry', schema: 'contractsearch' });
      const before = read(tree, MODEL);
      const xsd = read(tree, SEARCH_XSD);
      await expect(open()).rejects.toThrow(
        "schemas/contractsearch.xsd, where the search document's schema contract_search goes, is another schema's",
      );
      expect(read(tree, MODEL)).toBe(before);
      expect(read(tree, SEARCH_XSD)).toBe(xsd);
    });

    it("leaves alone a file at the search schema's place that no entry registers", async () => {
      await contract();
      tree.write(SEARCH_XSD, '<!-- written by hand, for something else -->\n');
      const before = read(tree, MODEL);
      await expect(open()).rejects.toThrow('or a file no entry of');
      expect(read(tree, MODEL)).toBe(before);
      expect(read(tree, SEARCH_XSD)).toBe('<!-- written by hand, for something else -->\n');
    });

    it('refuses an aggregate on a type the content model does not describe', async () => {
      await expect(generate({ pageProvider: 'p', aggregates: 'contract:status' })).rejects.toThrow(
        'write its --properties first',
      );
      expect(tree.exists(MODEL)).toBe(false);
    });
  });

  describe('a checklist, facets, a type with no schema of its own, and a folder', () => {
    const model = () => JSON.parse(read(tree, `${ROOT}/content-model.json`));
    const doctype = (name: string) => {
      const xml = read(tree, MODEL);
      const at = xml.indexOf(`<doctype name="${name}"`);
      return at < 0 ? '' : xml.slice(at, xml.indexOf('</doctype>', at) + '</doctype>'.length);
    };

    it('writes a checklist property as the entries a checklist card reads, in the schema and the model', async () => {
      await generate({ properties: 'number, steps:checklist' });
      const xsd = read(tree, `${ROOT}/bundle/schemas/contract.xsd`);
      expect(xsd).toContain(
        '  <xs:element name="steps" type="nxs:stepsEntries" />\n' +
          '  <xs:complexType name="stepsEntries">\n' +
          '    <xs:sequence>\n' +
          '      <xs:element name="entry" type="nxs:stepsEntry" minOccurs="0" maxOccurs="unbounded" />\n' +
          '    </xs:sequence>\n' +
          '  </xs:complexType>\n' +
          '  <xs:complexType name="stepsEntry">\n' +
          '    <xs:sequence>\n' +
          '      <xs:element name="item" type="xs:string" />\n' +
          '      <xs:element name="done" type="xs:boolean" />\n' +
          '      <xs:element name="doneBy" type="xs:string" />\n' +
          '      <xs:element name="doneOn" type="xs:date" />\n',
      );
      expect(
        model().schemas.find((each: { name: string }) => each.name === 'contract').fields,
      ).toEqual({
        number: 'string',
        steps: {
          type: 'complex[]',
          fields: { item: 'string', done: 'boolean', doneBy: 'string', doneOn: 'date' },
        },
      });
      // Read back as the other generators read it: a list of complex values with those subfields.
      const read_ = readModel(model(), 'content-model.json');
      const steps = read_.schemas.get('contract')?.properties.get('steps');
      expect(steps).toMatchObject({ type: 'complex', list: true });
      expect([...(steps?.fields.keys() ?? [])]).toEqual(['item', 'done', 'doneBy', 'doneOn']);
      // A checklist groups nothing: a terms aggregate is refused on it.
      await expect(generate({ pageProvider: 'p', aggregates: 'contract:steps' })).rejects.toThrow(
        '"contract:steps" is a complex[] property',
      );
    });

    it('writes a complex property and a list of them, with their subfields, which app-layout lays out as an address and a table', async () => {
      await generate({
        properties:
          'number, address:complex{street, city, zip}, parties:complex[]{name, role=Buyer|Seller, share:double, tags:string[]}, notes:string[]',
      });
      const xsd = read(tree, `${ROOT}/bundle/schemas/contract.xsd`);
      // One list type for the property's and the subfield's lists alike.
      expect(xsd.match(/<xs:simpleType name="stringList">/g)).toHaveLength(1);
      expect(xsd).toContain(
        '  <xs:element name="address" type="nxs:addressType" />\n' +
          '  <xs:complexType name="addressType">\n' +
          '    <xs:sequence>\n' +
          '      <xs:element name="street" type="xs:string" />\n' +
          '      <xs:element name="city" type="xs:string" />\n' +
          '      <xs:element name="zip" type="xs:string" />\n' +
          '    </xs:sequence>\n' +
          '  </xs:complexType>\n',
      );
      expect(xsd).toContain(
        '  <xs:element name="parties" type="nxs:partiesEntries" />\n' +
          '  <xs:complexType name="partiesEntries">\n' +
          '    <xs:sequence>\n' +
          '      <xs:element name="entry" type="nxs:partiesEntry" minOccurs="0" maxOccurs="unbounded" />\n' +
          '    </xs:sequence>\n' +
          '  </xs:complexType>\n' +
          '  <xs:complexType name="partiesEntry">\n' +
          '    <xs:sequence>\n' +
          '      <xs:element name="name" type="xs:string" />\n' +
          '      <xs:element name="role">\n' +
          '        <xs:simpleType>\n' +
          '          <xs:restriction base="xs:string">\n' +
          '            <xs:enumeration value="Buyer" />\n' +
          '            <xs:enumeration value="Seller" />\n' +
          '          </xs:restriction>\n' +
          '        </xs:simpleType>\n' +
          '      </xs:element>\n' +
          '      <xs:element name="share" type="xs:double" />\n' +
          '      <xs:element name="tags" type="nxs:stringList" />\n' +
          '    </xs:sequence>\n' +
          '  </xs:complexType>\n',
      );
      expect(
        model().schemas.find((each: { name: string }) => each.name === 'contract').fields,
      ).toEqual({
        number: 'string',
        address: { type: 'complex', fields: { street: 'string', city: 'string', zip: 'string' } },
        parties: {
          type: 'complex[]',
          fields: { name: 'string', role: 'string', share: 'double', tags: 'string[]' },
        },
        notes: 'string[]',
      });
      const asRead = readModel(model(), 'content-model.json');
      expect(asRead.schemas.get('contract')?.properties.get('address')).toMatchObject({
        type: 'complex',
        list: false,
      });
      expect(asRead.schemas.get('contract')?.properties.get('parties')).toMatchObject({
        type: 'complex',
        list: true,
      });
      // app-layout, given the model app-model wrote, shows them as Nuxeo would have them shown.
      const scratch = mkdtempSync(join(tmpdir(), 'app-model-complex-'));
      const file = join(scratch, 'content-model.json');
      writeFileSync(file, read(tree, `${ROOT}/content-model.json`));
      await appLayoutGenerator(tree, { package: ROOT, type: 'Contract', model: file });
      const fields = JSON.parse(
        read(tree, `${ROOT}/bundle/agentic-ui-config/layouts/Contract/view.layout.json`),
      ).cards.flatMap((card: { fields?: unknown[] }) => card.fields ?? []);
      expect(fields).toContainEqual({
        field: 'contract:address',
        widget: 'address',
        parameters: { parts: { street: 'street', city: 'city', postcode: 'zip' } },
      });
      expect(fields).toContainEqual(
        expect.objectContaining({ field: 'contract:parties', widget: 'table' }),
      );
    });

    it('adds a schema of its own to a type it has, as the vehicle kit wrote its checklist by hand', async () => {
      const VEHICLE = join(workspaceRoot, 'business-apps', 'packages', 'vehicle-titles-demo');
      await generate({
        type: 'VehicleDeal',
        schema: 'vehicledeal',
        prefix: 'vdeal',
        properties: 'number, status=Draft|Contracted',
        attachments: true,
      });
      const xsd = read(tree, `${ROOT}/bundle/schemas/vehicledeal.xsd`);
      const manifest = read(tree, MANIFEST);
      await generate({
        type: 'VehicleDeal',
        schema: 'vehicledeal_docs',
        prefix: 'vdocs',
        properties: 'checklist:checklist',
      });
      // In the model component: the schema registered, and the type given it after its own.
      expect(read(tree, MODEL)).toContain(
        '<schema name="vehicledeal_docs" prefix="vdocs" src="schemas/vehicledeal_docs.xsd" />',
      );
      expect(doctype('VehicleDeal')).toContain(
        '      <schema name="vehicledeal" />\n      <schema name="vehicledeal_docs" />\n    </doctype>',
      );
      // The type's own schema is not written again, and the manifest lists no other component.
      expect(read(tree, `${ROOT}/bundle/schemas/vehicledeal.xsd`)).toBe(xsd);
      expect(read(tree, MANIFEST)).toBe(manifest);
      // The schema file and the model's entries are the ones the vehicle kit wrote by hand.
      // The schema's elements, its comments left out one after the other, as a reader skips them.
      const elements = (text: string) => {
        let kept = '';
        let at = 0;
        for (let start = text.indexOf('<!--'); start >= 0; start = text.indexOf('<!--', at)) {
          kept += text.slice(at, start);
          const end = text.indexOf('-->', start + 4);
          at = end < 0 ? text.length : end + 3;
        }
        kept += text.slice(at);
        return kept.slice(kept.indexOf('<xs:element')).split(/\s+/).join(' ');
      };
      expect(elements(read(tree, `${ROOT}/bundle/schemas/vehicledeal_docs.xsd`))).toBe(
        elements(readFileSync(join(VEHICLE, 'bundle', 'schemas', 'vehicledeal_docs.xsd'), 'utf8')),
      );
      const kit = JSON.parse(readFileSync(join(VEHICLE, 'content-model.json'), 'utf8'));
      expect(model().doctypes.VehicleDeal).toEqual(kit.doctypes.VehicleDeal);
      const docs = (from: { schemas: { name: string }[] }) =>
        from.schemas.find((each) => each.name === 'vehicledeal_docs');
      expect(docs(model())).toEqual(docs(kit));
      // Its heading is apart from the type's first schema's, for the person to name.
      const labels = JSON.parse(read(tree, `${ROOT}/bundle/agentic-ui-config/labels/en.json`));
      expect(labels.labels['layout.schema.vehicledeal']).toBe('Vehicle deal');
      expect(labels.labels['layout.schema.vehicledeal_docs']).toBe('Vehicle deal docs');
      // The type has it now: written again only with --force, which keeps the type as it is.
      const xml = read(tree, MODEL);
      await expect(
        generate({
          type: 'VehicleDeal',
          schema: 'vehicledeal_docs',
          prefix: 'vdocs',
          properties: 'checklist:checklist',
        }),
      ).rejects.toThrow('has the type VehicleDeal already. Pass --force');
      await generate({
        type: 'VehicleDeal',
        schema: 'vehicledeal_docs',
        prefix: 'vdocs',
        properties: 'checklist:checklist, notes',
        force: true,
      });
      expect(read(tree, MODEL)).toBe(xml);
      expect(model().doctypes.VehicleDeal).toEqual(kit.doctypes.VehicleDeal);
      // Not with a prefix another schema has, nor a schema another type has.
      await expect(
        generate({
          type: 'VehicleDeal',
          schema: 'vehicledeal_more',
          prefix: 'vdeal',
          properties: 'a',
        }),
      ).rejects.toThrow('registers the schema vehicledeal with the prefix vdeal already');
      await generate({ type: 'Other', properties: 'a' });
      await expect(
        generate({ type: 'VehicleDeal', schema: 'other', prefix: 'oth', properties: 'a' }),
      ).rejects.toThrow('The schema other is in');
      // A schema the type does not have, named by default rather than by --schema, adds nothing.
      await generate({ type: 'Third', schema: 'third_own', properties: 'a' });
      await expect(generate({ type: 'Third', properties: 'b', force: true })).rejects.toThrow(
        'The type Third in',
      );
      expect(doctype('Third')).not.toContain('<schema name="third" />');
      // Nor does one given with --force, which writes again what the type has: a misspelt name.
      await expect(
        generate({
          type: 'VehicleDeal',
          schema: 'vehicledeal_doc',
          prefix: 'vdoc',
          properties: 'a',
          force: true,
        }),
      ).rejects.toThrow('--force writes again a schema the type has');
      expect(doctype('VehicleDeal')).not.toContain('vehicledeal_doc"');
    });

    it("names the search document after the type's first schema, a schema added with aggregates", async () => {
      await generate({
        type: 'VehicleDeal',
        schema: 'vehicledeal',
        prefix: 'vdeal',
        properties: 'number, status=Draft|Contracted',
        pageProvider: 'deals_by_status',
        aggregates: 'vdeal:status',
      });
      const search = read(tree, `${ROOT}/bundle/schemas/vehicledealsearch.xsd`);
      await generate({
        type: 'VehicleDeal',
        schema: 'vehicledeal_docs',
        prefix: 'vdocs',
        properties: 'kind=Title|Insurance',
        pageProvider: 'deals_by_document',
        aggregates: 'vdocs:kind',
      });
      const xml = read(tree, MODEL);
      // One search document, its schema the first's, with the new aggregate's field added.
      expect(xml).not.toContain('vehicledeal_docs_search');
      expect(xml).toContain('<field schema="vehicledeal_search" name="vdocs_kind_agg" />');
      expect(xml.match(/<doctype name="VehicleDealSearch"/g)).toHaveLength(1);
      expect(read(tree, `${ROOT}/bundle/schemas/vehicledealsearch.xsd`)).not.toBe(search);
      expect(read(tree, `${ROOT}/bundle/schemas/vehicledealsearch.xsd`)).toContain(
        '<xs:element name="vdocs_kind_agg" type="nxs:stringList" />',
      );
    });

    it("writes a document property as another record's id, which app-layout shows as a link", async () => {
      await generate({ properties: 'number, counterparty:document' });
      const xsd = read(tree, `${ROOT}/bundle/schemas/contract.xsd`);
      expect(xsd).toContain(
        '  xmlns:ref="http://www.nuxeo.org/ecm/schemas/core/external-references/"\n',
      );
      expect(xsd).toContain(
        '  <xs:element name="counterparty">\n' +
          '    <xs:simpleType>\n' +
          '      <xs:restriction base="xs:string" ref:resolver="documentResolver" ref:store="id" />\n',
      );
      const fields = model().schemas.find(
        (each: { name: string }) => each.name === 'contract',
      ).fields;
      expect(fields.counterparty).toEqual({
        type: 'string',
        constraints: [{ name: 'documentResolver', parameters: { store: 'id' } }],
      });
      const asRead = readModel(model(), 'content-model.json');
      expect(asRead.schemas.get('contract')?.properties.get('counterparty')).toMatchObject({
        type: 'string',
        document: true,
      });
      // A schema with no document property names no ref namespace.
      await generate({ type: 'Other', properties: 'a' });
      expect(read(tree, `${ROOT}/bundle/schemas/other.xsd`)).not.toContain('xmlns:ref');
      await expect(generate({ type: 'Third', properties: 'a:document[]' })).rejects.toThrow(
        'has the type "document[]"',
      );
    });

    it("gives a type Nuxeo's own facets, Versionable with the uid schema, when first written", async () => {
      await generate({ properties: 'number', facets: 'Versionable, Commentable' });
      expect(doctype('Contract')).toBe(
        '<doctype name="Contract" extends="Document">\n' +
          '      <schema name="common" />\n' +
          '      <schema name="dublincore" />\n' +
          '      <schema name="contract" />\n' +
          '      <schema name="uid" />\n' +
          '      <facet name="Versionable" />\n' +
          '      <facet name="Commentable" />\n' +
          '    </doctype>',
      );
      expect(model().doctypes.Contract).toEqual({
        parent: 'Document',
        facets: ['Versionable', 'Commentable'],
        schemas: ['common', 'dublincore', 'contract', 'uid'],
      });
      expect(model().facets).toEqual([
        { name: 'Versionable', schemas: [] },
        { name: 'Commentable', schemas: [] },
      ]);
      const asRead = readModel(model(), 'content-model.json');
      const contractType = asRead.types.get('Contract');
      expect(contractType && schemasOf(asRead, contractType)).toContain('uid');
    });

    it("adds an add-on's facet a given model describes, with its schema, and keeps it when --force writes the schema again", async () => {
      await contract();
      const addOn = `${ROOT}/../addon-model.json`;
      tree.write(
        addOn,
        JSON.stringify({
          doctypes: {},
          facets: [
            {
              name: 'Signable',
              schemas: [
                { name: 'signable', prefix: 'sgn', '@prefix': 'sgn', fields: { status: 'string' } },
              ],
            },
          ],
          schemas: [],
        }),
      );
      // Read from the file system, as the write tools give a model.
      const file = join(mkdtempSync(join(tmpdir(), 'app-model-')), 'addon-model.json');
      writeFileSync(file, read(tree, addOn));
      await generate({ facets: 'Signable,Versionable', model: file });
      expect(doctype('Contract')).toContain(
        '      <schema name="contract" />\n' +
          '      <schema name="uid" />\n' +
          '      <facet name="Signable" />\n' +
          '      <facet name="Versionable" />\n' +
          '    </doctype>',
      );
      const entry = {
        parent: 'Document',
        facets: ['Signable', 'Versionable'],
        schemas: ['common', 'dublincore', 'contract', 'uid', 'signable'],
      };
      expect(model().doctypes.Contract).toEqual(entry);
      expect(model().facets.map((each: { name: string }) => each.name)).toEqual([
        'Signable',
        'Versionable',
      ]);
      expect(model().schemas.map((each: { name: string }) => each.name)).toContain('signable');
      // Given again, nothing is added twice.
      const xml = read(tree, MODEL);
      await generate({ facets: 'Signable', model: file });
      expect(read(tree, MODEL)).toBe(xml);
      // The schema written again: the type's facets and schemas stay, in the component and the model.
      await generate({ properties: 'number, value:double', force: true });
      expect(model().doctypes.Contract).toEqual(entry);
      expect(read(tree, MODEL)).toBe(xml);
      // Without the model, a facet no model describes is refused.
      await expect(generate({ facets: 'Sealed' })).rejects.toThrow(
        '"Sealed" is not one of Nuxeo\'s own facets that bring no schema',
      );
    });

    it("writes a type with no schema of its own, its properties all a facet's", async () => {
      await generate({
        type: 'Request',
        schemaless: true,
        facets: 'Versionable',
        attachments: true,
      });
      expect(doctype('Request')).toBe(
        '<doctype name="Request" extends="Document">\n' +
          '      <schema name="common" />\n' +
          '      <schema name="dublincore" />\n' +
          '      <schema name="files" />\n' +
          '      <schema name="uid" />\n' +
          '      <facet name="Versionable" />\n' +
          '    </doctype>',
      );
      expect(read(tree, MODEL)).toContain('<type name="Request">default</type>');
      expect(model().doctypes.Request).toEqual({
        parent: 'Document',
        facets: ['Versionable'],
        schemas: ['common', 'dublincore', 'files', 'uid'],
      });
      expect(tree.exists(`${ROOT}/bundle/schemas/request.xsd`)).toBe(false);
      // No schema of its own, so no Properties heading for one.
      expect(read(tree, `${ROOT}/bundle/agentic-ui-config/labels/en.json`)).not.toContain(
        'layout.schema.request',
      );
    });

    it('writes a folder whose Create menu offers its subtypes, and adds to them', async () => {
      await contract();
      await generate({ type: 'Register', folder: true, subtypes: 'Contract' });
      expect(doctype('Register')).toBe(
        '<doctype name="Register" extends="Folder">\n' +
          '      <subtypes>\n' +
          '        <type>Contract</type>\n' +
          '      </subtypes>\n' +
          '    </doctype>',
      );
      expect(read(tree, MODEL)).toContain(
        '<!-- A folder: its Create menu offers its subtypes. -->',
      );
      expect(model().doctypes.Register).toEqual({
        parent: 'Folder',
        facets: ['Folderish'],
        schemas: ['common', 'dublincore'],
      });
      expect(model().facets).toContainEqual({ name: 'Folderish', schemas: [] });
      await generate({ type: 'Register', subtypes: 'Contract, File' });
      expect(doctype('Register')).toBe(
        '<doctype name="Register" extends="Folder">\n' +
          '      <subtypes>\n' +
          '        <type>Contract</type>\n' +
          '        <type>File</type>\n' +
          '      </subtypes>\n' +
          '    </doctype>',
      );
      // Read back as the pipeline reads a model: it is one.
      expect(readModel(model(), 'content-model.json').types.get('Register')).toBeDefined();
    });

    const refusals: [string, Partial<AppModelSchema>, string][] = [
      [
        '--schemaless with --properties',
        { schemaless: true, properties: 'a' },
        'give one of the two',
      ],
      [
        'Folderish as a facet',
        { properties: 'a', facets: 'Folderish' },
        'write the type with --folder',
      ],
      [
        'a facet twice',
        { properties: 'a', facets: 'Versionable,Versionable' },
        'lists "Versionable" twice',
      ],
      ['a facet name that is not one', { properties: 'a', facets: 'a b' }, '"a b" is not a facet'],
      ['--model without --facets', { properties: 'a', model: 'x.json' }, 'give those too'],
      [
        '--subtypes on a type that is not a folder',
        { properties: 'a', subtypes: 'File' },
        'write the type with --folder too',
      ],
      [
        'a subtype the model does not have',
        { folder: true, subtypes: 'Nothing' },
        '"Nothing" is no type of',
      ],
      [
        '--facets on a type the package does not have',
        { facets: 'Versionable' },
        'has no type Contract to add',
      ],
      ['--buckets without --aggregates', { pageProvider: 'p', buckets: 20 }, 'give those too'],
    ];
    for (const [what, options, message] of refusals) {
      it(`refuses ${what}, and writes nothing`, async () => {
        const manifest = read(tree, MANIFEST);
        await expect(generate(options)).rejects.toThrow(message);
        expect(tree.exists(MODEL)).toBe(false);
        expect(read(tree, MANIFEST)).toBe(manifest);
      });
    }
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
      ['a complex property with no subfields', { properties: 'a:complex' }, 'names no subfield'],
      [
        'a complex list with none in its braces',
        { properties: 'a:complex[]{}' },
        'lists no subfield',
      ],
      ['subfields of a simple property', { properties: 'a:string{b}' }, 'only a complex property'],
      ['a brace left open', { properties: 'a:complex{b, c' }, 'opens or closes a brace'],
      ['a brace closing nothing', { properties: 'a, b}' }, 'opens or closes a brace'],
      ['a subfield twice', { properties: 'a:complex{b, b:long}' }, 'the subfield "b" twice'],
      ['a complex subfield', { properties: 'a:complex{b:checklist}' }, 'a subfield of "a",'],
      ['a list of booleans as a subfield', { properties: 'a:complex{b:boolean[]}' }, 'boolean[]'],
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
        'attachments with no properties',
        { pageProvider: 'p', attachments: true },
        '--attachments gives the type',
      ],
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
