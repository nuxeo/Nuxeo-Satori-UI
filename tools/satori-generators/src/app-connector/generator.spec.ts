import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import appModelGenerator from '../app-model/generator';
import appPackageGenerator from '../app-package/generator';
import appConnectorGenerator, { type AppConnectorSchema } from './generator';

const ROOT = 'business-apps/packages/acme-claims';
const FILE = `${ROOT}/connectors/acme-claims-connectors-config.xml`;
const read = (tree: Tree, path: string): string => tree.read(path, 'utf-8') ?? '';

describe('app-connector generator', () => {
  let tree: Tree;
  const payments: AppConnectorSchema = {
    package: ROOT,
    id: 'acme.claimPayments',
    type: 'Claim',
    key: 'claim:number',
    path: '/claims/{key}',
    fields: 'paymentStatus=/payment/status, paidAmount=/payment/amount, policyNumber',
  };
  const generate = (options: Partial<AppConnectorSchema> = {}) =>
    appConnectorGenerator(tree, { ...payments, ...options });

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    await appPackageGenerator(tree, {
      name: 'acme-claims',
      owner: 'acme',
      platform: '>=0.2.0 <1.0.0',
    });
  });

  it('writes the connector beside the bundle, naming its address and its credential by setting only', async () => {
    await generate();
    const xml = read(tree, FILE);
    expect(xml).toContain('<component name="acme.config.acme-claims.connectors" version="1.0">');
    expect(xml).toContain('  <require>org.nuxeo.agentic.connectors</require>');
    expect(xml).toContain(
      '  <extension target="org.nuxeo.agentic.connectors" point="connectors">\n' +
        '    <connector id="acme.claimPayments">\n' +
        '      <type>Claim</type>\n' +
        '      <address property="nuxeo.agentic.connectors.acme.claimPayments.address" />\n' +
        '      <path>/claims/{key}</path>\n' +
        '      <key xpath="claim:number" />\n' +
        '      <permission>Read</permission>\n' +
        '      <credential header="Authorization" prefix="Bearer " property="nuxeo.agentic.connectors.acme.claimPayments.token"\n' +
        '                  env="NUXEO_CONNECTOR_ACME_CLAIMPAYMENTS_TOKEN" />\n' +
        '      <field name="paymentStatus" pointer="/payment/status" />\n' +
        '      <field name="paidAmount" pointer="/payment/amount" />\n' +
        '      <field name="policyNumber" pointer="/policyNumber" />\n' +
        '    </connector>\n' +
        '  </extension>\n' +
        '</component>\n',
    );
    // Nothing in the bundle, and the manifest names no new component: the add-on has no package.
    expect(tree.children(`${ROOT}/bundle/OSGI-INF`)).toEqual(['acme-claims-config.xml']);
    expect(read(tree, `${ROOT}/bundle/META-INF/MANIFEST.MF`)).not.toContain('connectors');
  });

  it('adds a second connector beside the first, writes one again with --force, and takes one out', async () => {
    await generate();
    await generate({ id: 'acme.policy', fields: 'status', credential: false, timeout: 3000 });
    const xml = read(tree, FILE);
    expect(xml).toContain('    </connector>\n\n    <connector id="acme.policy">\n');
    expect(xml).toContain(
      '      <timeout>3000</timeout>\n      <field name="status" pointer="/status" />\n',
    );
    expect(xml.split('<credential ').length).toBe(2);
    await expect(generate()).rejects.toThrow('has the connector acme.claimPayments already');
    await generate({ fields: 'paymentStatus', force: true });
    expect(read(tree, FILE)).not.toContain('paidAmount');
    expect(read(tree, FILE)).toContain('<connector id="acme.policy">');
    await appConnectorGenerator(tree, { package: ROOT, id: 'acme.policy', remove: true });
    expect(read(tree, FILE)).not.toContain('acme.policy');
    await appConnectorGenerator(tree, { package: ROOT, id: 'acme.claimPayments', remove: true });
    expect(tree.exists(FILE)).toBe(false);
  });

  it("holds the types and the key to the kit's own content model when it has one", async () => {
    await appModelGenerator(tree, {
      package: ROOT,
      type: 'Claim',
      properties: 'number,lines:string[]',
    });
    await generate();
    await expect(generate({ id: 'a.b', type: 'Policy' })).rejects.toThrow(
      'the content model has no document type "Policy"',
    );
    await expect(generate({ id: 'a.b', key: 'claim:numero' })).rejects.toThrow(
      '"claim:numero" is not a property of Claim',
    );
    await expect(generate({ id: 'a.b', key: 'claim:lines' })).rejects.toThrow('holds a list');
  });

  describe('refuses, and writes nothing', () => {
    const refusals: [string, Partial<AppConnectorSchema>, string][] = [
      ['an id that is not one', { id: 'a b' }, '--id "a b"'],
      [
        "an id ending as the server's own settings",
        { id: 'acme.events' },
        'not end in .http, .cache or .events',
      ],
      ['no type', { type: undefined }, '--type: 1 to 20'],
      ['a key that is no property', { key: 'number' }, '--key "number"'],
      ["the server's own property as a key", { key: 'ecm:uuid' }, '--key "ecm:uuid"'],
      ['a path that does not start at /', { path: 'claims/{key}' }, 'starts with /'],
      ['a path with no key', { path: '/claims' }, 'holds {key} once'],
      ['a path with a query', { path: '/claims/{key}?x=1' }, 'and no query'],
      ['a path with a ".." segment', { path: '/claims/../{key}' }, 'no empty, "." or ".." segment'],
      ['an address for a path', { path: '//core.example/{key}' }, 'no empty'],
      ['no field', { fields: '' }, '--fields: 1 to 50'],
      ['a field twice', { fields: 'a,a' }, 'lists "a" twice'],
      ['a field that is not a name', { fields: 'paid-amount' }, '"paid-amount" is not a field'],
      ['a pointer that is not one', { fields: 'a=payment' }, 'is not a JSON pointer'],
      ['a header that changes where the request goes', { header: 'Host' }, '--header "Host"'],
      [
        'a header the add-on refuses, Content-Type',
        { header: 'Content-Type' },
        '--header "Content-Type"',
      ],
      ['a header with a character the add-on refuses', { header: 'X_Key' }, '--header "X_Key"'],
      ['a path longer than the add-on reads', { path: `/${'a'.repeat(260)}/{key}` }, 'at most 256'],
      ["a timeout past the add-on's", { timeout: 60000 }, '--timeout 60000'],
      [
        'a credential header with no credential',
        { credential: false, header: 'X-Key' },
        'not with --credential=false',
      ],
      [
        'a removal of a connector the file does not have',
        { remove: true, type: undefined, key: undefined, path: undefined, fields: undefined },
        'no connector acme.claimPayments to take out',
      ],
      ['a removal with what describes one', { remove: true }, '--remove takes the connector'],
    ];
    for (const [what, options, message] of refusals) {
      it(what, async () => {
        await expect(generate(options)).rejects.toThrow(message);
        expect(tree.exists(FILE)).toBe(false);
      });
    }
  });
});
