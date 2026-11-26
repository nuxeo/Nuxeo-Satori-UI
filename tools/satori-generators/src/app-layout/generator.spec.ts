import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import appPackageGenerator from '../app-package/generator';
import { CONTRACTS_MODEL } from '../app-package/testing/scaffold';
import appLayoutGenerator, { type AppLayoutSchema } from './generator';

const ROOT = 'business-apps/packages/acme-contracts';
const CONFIG = `${ROOT}/bundle/agentic-ui-config`;
const COMPONENT = `${ROOT}/bundle/OSGI-INF/acme-contracts-config.xml`;
const layoutOf = (tree: Tree, type: string): Record<string, unknown> =>
  JSON.parse(tree.read(`${CONFIG}/layouts/${type}/view.layout.json`, 'utf-8') ?? 'null');
const labelsOf = (tree: Tree): Record<string, string> =>
  JSON.parse(tree.read(`${CONFIG}/labels/en.json`, 'utf-8') ?? 'null').labels;

describe('app-layout generator', () => {
  let tree: Tree;
  const generate = (options: Partial<AppLayoutSchema> = {}) =>
    appLayoutGenerator(tree, {
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

  it("lays out the type's own schemas, one card each, and its facets', leaving Nuxeo's out", async () => {
    await generate();
    const layout = layoutOf(tree, 'Contract');
    expect(layout['$schema']).toBe(
      '../../../../../../../libs/shared/app-definition/src/layout-v2.schema.json',
    );
    expect(layout['version']).toBe(2);
    expect(layout['columns']).toBe(2);
    const cards = layout['cards'] as { id: string; labelKey: string; fields: unknown[] }[];
    // `contract` is the type's; `review` comes with the Reviewable facet it declares.
    expect(cards.map((card) => card.id)).toEqual(['contract', 'review']);
    expect(cards[1].fields).toEqual(['rev:reviewer', 'rev:reviewed']);
    expect(JSON.stringify(cards)).not.toMatch(/"(dc|common|uid):/);
  });

  it('writes a widget only where the model says more than the type', async () => {
    await generate();
    const [contract] = layoutOf(tree, 'Contract')['cards'] as { fields: unknown[] }[];
    expect(contract.fields).toEqual([
      'contract:number',
      // A documentResolver: the id of a document.
      { field: 'contract:counterparty', widget: 'document-link' },
      // A directoryResolver, on the value and on each item of a list.
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
      // A complex value with a street and a city.
      {
        field: 'contract:billingAddress',
        widget: 'address',
        parameters: {
          parts: { street: 'street', city: 'city', postcode: 'zip', country: 'country' },
        },
      },
      // A list of complex values, over its one-line subfields: the file in it is not a column.
      {
        field: 'contract:lines',
        widget: 'table',
        parameters: { columns: ['contract:description', 'contract:amount', 'contract:due'] },
      },
      // `contract:scan`, a file, is left out.
      'contract:notes',
    ]);
  });

  it('has the component contribute it, from the one place the pipeline accepts', async () => {
    await generate();
    const xml = tree.read(COMPONENT, 'utf-8') ?? '';
    // In an extension of its own, before the one app-package wrote for the app.
    expect(xml).toContain(
      '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
        '    <layout type="Contract" mode="view" src="agentic-ui-config/layouts/Contract/view.layout.json" />\n' +
        '  </extension>\n\n' +
        '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
        '    <app id="acme-contracts" src="agentic-ui-config/app.json">\n',
    );
    await generate({ type: 'Counterparty' });
    const twice = tree.read(COMPONENT, 'utf-8') ?? '';
    expect(twice.match(/<extension /g)).toHaveLength(2);
    expect(twice).toContain(
      '    <layout type="Contract" mode="view" src="agentic-ui-config/layouts/Contract/view.layout.json" />\n' +
        '    <layout type="Counterparty" mode="view" src="agentic-ui-config/layouts/Counterparty/view.layout.json" />\n' +
        '  </extension>',
    );
  });

  it('adds a layout extension before the app, or after the last one when there is no app', async () => {
    const xml = tree.read(COMPONENT, 'utf-8') ?? '';
    // A component with no app: the layouts' extension goes before </component>, as it always did.
    const app = xml.indexOf('\n  <extension');
    tree.write(COMPONENT, `${xml.slice(0, app)}\n</component>\n`);
    await generate();
    expect(tree.read(COMPONENT, 'utf-8')).toContain(
      '    <layout type="Contract" mode="view" src="agentic-ui-config/layouts/Contract/view.layout.json" />\n' +
        '  </extension>\n</component>',
    );
  });

  it('reads no entry and no extension in a comment', async () => {
    const xml = tree.read(COMPONENT, 'utf-8') ?? '';
    tree.write(
      COMPONENT,
      xml.replace(
        '</component>',
        '  <!-- <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
          '    <layout type="Contract" mode="view" src="agentic-ui-config/old.json" />\n' +
          '  </extension> -->\n</component>',
      ),
    );
    await generate();
    const written = tree.read(COMPONENT, 'utf-8') ?? '';
    // The new extension is outside the comment, which is left as it was, and its entry refused
    // nothing.
    const opened = written.lastIndexOf('<!-- <extension');
    const closed = written.indexOf('-->', opened);
    const at = written.indexOf(
      '<layout type="Contract" mode="view" src="agentic-ui-config/layouts/Contract/view.layout.json" />',
    );
    expect(at).toBeGreaterThan(-1);
    expect(at < opened || at > closed).toBe(true);
    expect(written.slice(opened, closed)).toContain('agentic-ui-config/old.json');
    expect(written.slice(opened, closed)).not.toContain('layouts/Contract/view.layout.json');
  });

  describe('reads the component as the pipeline does', () => {
    const LAYOUT =
      '<layout type="Contract" mode="view" src="agentic-ui-config/layouts/Contract/view.layout.json" />';
    const withXml = (extra: string): void => {
      const xml = tree.read(COMPONENT, 'utf-8') ?? '';
      tree.write(COMPONENT, xml.replace('</component>', `${extra}\n</component>`));
    };

    it("adds nothing inside the component's documentation, whatever markup it shows", async () => {
      withXml(
        '  <documentation>An example:\n' +
          '    <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
          '    </extension>\n  </documentation>',
      );
      await generate();
      const written = tree.read(COMPONENT, 'utf-8') ?? '';
      const at = written.indexOf(LAYOUT);
      expect(at).toBeGreaterThan(-1);
      expect(
        at < written.indexOf('<documentation>') || at > written.indexOf('</documentation>'),
      ).toBe(true);
    });

    it('finds no entry in a CDATA section or a processing instruction', async () => {
      withXml(
        '  <?note <layout type="Contract" mode="view" src="x.json" /> ?>\n' +
          '  <![CDATA[ <layout type="Contract" mode="view" src="y.json" /> ]]>',
      );
      await generate();
      expect(tree.read(COMPONENT, 'utf-8')).toContain(LAYOUT);
    });

    it('decodes and trims attribute values, as the server does', async () => {
      withXml(
        '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
          '    <layout type=" Contr&#97;ct " mode="view" src="agentic-ui-config/other.json" />\n' +
          '  </extension>',
      );
      await expect(generate()).rejects.toThrow('already contributes the Contract/view layout');
      tree.write(
        COMPONENT,
        (tree.read(COMPONENT, 'utf-8') ?? '').replace(
          '<layout type=" Contr&#97;ct " mode="view" src="agentic-ui-config/other.json" />',
          '<layout type="Contract" mode="view" enabled="tr&#117;e" src="agentic-ui-config/layouts/Contract/view.layout.json" />',
        ),
      );
      // Enabled, and naming the file: there already, so nothing is added.
      await generate();
      expect((tree.read(COMPONENT, 'utf-8') ?? '').match(/<layout /g)).toHaveLength(1);
    });
  });

  it('refuses an entry outside the configuration point, where nothing registers it', async () => {
    const xml = tree.read(COMPONENT, 'utf-8') ?? '';
    tree.write(
      COMPONENT,
      xml.replace(
        '</component>',
        '  <extension target="org.nuxeo.agentic.ui.config" point="configurations">\n' +
          '    <layout type="Contract" mode="view" src="agentic-ui-config/layouts/Contract/view.layout.json" />\n' +
          '  </extension>\n</component>',
      ),
    );
    const before = tree.read(COMPONENT, 'utf-8');
    await expect(generate()).rejects.toThrow(
      `has the Contract/view layout outside an extension of org.nuxeo.agentic.ui.config's "configuration" point`,
    );
    expect(tree.read(COMPONENT, 'utf-8')).toBe(before);
  });

  it('reads an extension closed as </extension >, as the pipeline does', async () => {
    const xml = tree.read(COMPONENT, 'utf-8') ?? '';
    tree.write(
      COMPONENT,
      xml.replace('  </extension>\n</component>', '  </extension >\n</component>'),
    );
    await generate();
    expect(tree.read(COMPONENT, 'utf-8')).toContain(
      '<layout type="Contract" mode="view" src="agentic-ui-config/layouts/Contract/view.layout.json" />',
    );
  });

  it('finds an extension whose attributes are quoted with apostrophes, and adds to it', async () => {
    const xml = tree.read(COMPONENT, 'utf-8') ?? '';
    tree.write(
      COMPONENT,
      xml.replace(
        '</component>',
        "  <extension point='configuration' target='org.nuxeo.agentic.ui.config'>\n  </extension>\n</component>",
      ),
    );
    await generate();
    const written = tree.read(COMPONENT, 'utf-8') ?? '';
    // Its own and the app's: no third.
    expect(written.match(/<extension /g)).toHaveLength(2);
    expect(written).toContain(
      "<extension point='configuration' target='org.nuxeo.agentic.ui.config'>\n" +
        '    <layout type="Contract" mode="view" src="agentic-ui-config/layouts/Contract/view.layout.json" />\n' +
        '  </extension>',
    );
  });

  it('names each card with a label key, its English text in labels/en.json, keeping a corrected one', async () => {
    await generate();
    expect(labelsOf(tree)).toMatchObject({
      'acme-contracts.card.contract.contract': 'Contract',
      'acme-contracts.card.contract.review': 'Review',
    });
    const labels = JSON.parse(tree.read(`${CONFIG}/labels/en.json`, 'utf-8') ?? '');
    labels.labels['acme-contracts.card.contract.contract'] = 'The contract';
    tree.write(`${CONFIG}/labels/en.json`, JSON.stringify(labels));
    await generate({ force: true });
    expect(labelsOf(tree)['acme-contracts.card.contract.contract']).toBe('The contract');
  });

  it('shows exactly the schemas --schemas names, in its order, one card in one column', async () => {
    await generate({ schemas: 'dublincore' });
    const layout = layoutOf(tree, 'Contract');
    expect(layout['columns']).toBeUndefined();
    expect(layout['cards']).toEqual([
      {
        id: 'dublincore',
        labelKey: 'acme-contracts.card.contract.dublincore',
        fields: ['dc:title', 'dc:description', 'dc:created', 'dc:modified'],
      },
    ]);
    await generate({ schemas: ['review', 'contract'], columns: 3, force: true });
    const again = layoutOf(tree, 'Contract');
    expect(again['columns']).toBe(3);
    expect((again['cards'] as { id: string }[]).map((card) => card.id)).toEqual([
      'review',
      'contract',
    ]);
  });

  describe('says what it left out, every property and why', () => {
    /** What the generator prints once it has written the layout. */
    const said = async (options: Partial<AppLayoutSchema> = {}): Promise<string> => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        (await generate(options))();
        return log.mock.calls.map((call) => call.join(' ')).join('\n');
      } finally {
        log.mockRestore();
      }
    };

    it("names the properties of Nuxeo's own schemas, as well as a file of the type's own", async () => {
      const output = await said();
      expect(output).not.toContain('Left out: nothing');
      expect(output).toContain('contract:scan: a file;');
      expect(output).toContain(
        "common:icon, common:size: in Nuxeo's own schema common, left out unless --schemas names it",
      );
      expect(output).toContain('dc:title, dc:description, dc:created, dc:modified: in Nuxeo');
      expect(output).toContain('uid:major_version, uid:minor_version: in Nuxeo');
    });

    it("names a record's attachments, files:files, with where they are shown", async () => {
      // A type with Nuxeo's files schema and one of its own, as app-model --attachments writes.
      const scratch = mkdtempSync(join(tmpdir(), 'app-layout-files-'));
      try {
        const model = join(scratch, 'content-model.json');
        writeFileSync(
          model,
          JSON.stringify({
            doctypes: {
              Claim: { parent: 'Document', facets: [], schemas: ['files', 'claim'] },
            },
            facets: [],
            schemas: [
              { name: 'files', fields: { files: { type: 'complex[]', fields: { file: 'blob' } } } },
              { name: 'claim', prefix: 'claim', fields: { number: 'string' } },
            ],
          }),
        );
        const output = await said({ type: 'Claim', model });
        expect(output).not.toContain('Left out: nothing');
        expect(output).toContain(
          "files:files: in Nuxeo's own schema files, a record's attachments, which the document page's Attachments panel shows and adds",
        );
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });

    it("names the properties of the type's own schemas --schemas does not name", async () => {
      const output = await said({ schemas: 'review' });
      expect(output).not.toContain('Left out: nothing');
      expect(output).toMatch(
        /contract:number, contract:counterparty, [^\n]*: in the schema contract, which --schemas does not name/,
      );
    });

    it('says it left out nothing when --schemas names every schema', async () => {
      const output = await said({
        type: 'Counterparty',
        schemas: 'common,dublincore,counterparty',
      });
      expect(output).toContain('Left out: nothing');
    });
  });

  describe('refuses', () => {
    const refusals: [string, Partial<AppLayoutSchema>, string][] = [
      [
        'a type the model does not have, offering the near one',
        { type: 'contract' },
        'did you mean Contract?',
      ],
      [
        'a type with only Nuxeo’s own schemas',
        { type: 'Memo' },
        'Name the ones to show with --schemas',
      ],
      [
        'a schema the type does not have',
        { schemas: 'counterparty' },
        'Contract has no schema "counterparty"',
      ],
      ['a type name that is not one', { type: '../Contract' }, '--type "../Contract"'],
      ['four columns', { columns: 4 }, '--columns 4 must be 1, 2 or 3'],
      ['both a model file and a server', { modelServer: 'http://localhost:1/nuxeo' }, 'one way'],
      ['neither a model file nor a server', { model: undefined }, 'one way'],
      ['a model file that is not there', { model: '/no/such/model.json' }, 'does not exist'],
    ];
    for (const [what, options, message] of refusals) {
      it(what, async () => {
        await expect(generate(options)).rejects.toThrow(message);
      });
    }

    it('a package that is not one', async () => {
      await expect(generate({ package: 'business-apps/packages/nothing' })).rejects.toThrow(
        'has no bundle/agentic-ui-config/app.json',
      );
    });

    it('a layout the type has already, unless forced', async () => {
      await generate();
      await expect(generate()).rejects.toThrow('already exists. Pass --force');
      await generate({ force: true });
    });

    it('a component that has the layout disabled, so the server serves none', async () => {
      const xml = tree.read(COMPONENT, 'utf-8') ?? '';
      tree.write(
        COMPONENT,
        xml.replace(
          '</component>',
          "  <extension target='org.nuxeo.agentic.ui.config' point='configuration'>\n" +
            "    <layout type='Contract' mode='view' enabled='false' src='agentic-ui-config/layouts/Contract/view.layout.json' />\n" +
            '  </extension>\n</component>',
        ),
      );
      await expect(generate()).rejects.toThrow('has the Contract/view layout disabled');
    });

    it('a component that contributes the layout from another file', async () => {
      const xml = tree.read(COMPONENT, 'utf-8') ?? '';
      tree.write(
        COMPONENT,
        xml.replace(
          '</component>',
          '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
            '    <layout type="Contract" mode="view" src="agentic-ui-config/contract.json" />\n' +
            '  </extension>\n</component>',
        ),
      );
      await expect(generate()).rejects.toThrow(
        'already contributes the Contract/view layout, from agentic-ui-config/contract.json',
      );
    });
  });

  describe('reading the model live', () => {
    let server: Server;
    let address: string;
    const seen: { path: string; authorization?: string; fetchSchema?: string }[] = [];
    const saved = { user: process.env['NUXEO_USER'], pass: process.env['NUXEO_PASS'] };
    const credentials = {
      user: randomBytes(6).toString('hex'),
      pass: randomBytes(12).toString('hex'),
    };

    beforeEach(async () => {
      seen.length = 0;
      const model = JSON.parse(readFileSync(CONTRACTS_MODEL, 'utf8'));
      const schemas = new Map<string, unknown>(
        model.schemas.map((schema: { name: string }) => [schema.name, schema]),
      );
      // Answers as Nuxeo does, for the reads the pipeline's export makes.
      server = createServer((request, response) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname;
        seen.push({
          path,
          authorization: request.headers.authorization,
          fetchSchema: request.headers['fetch-schema'] as string | undefined,
        });
        const answer = (body: unknown) => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify(body));
        };
        const named = /^\/nuxeo\/api\/v1\/config\/schemas\/([^/]+)$/.exec(path);
        if (path === '/nuxeo/api/v1/config/types') answer({ doctypes: model.doctypes });
        else if (path === '/nuxeo/api/v1/config/facets') answer(model.facets);
        else if (path === '/nuxeo/api/v1/config/schemas') answer(model.schemas);
        else if (named && schemas.has(decodeURIComponent(named[1])))
          answer(schemas.get(decodeURIComponent(named[1])));
        else {
          response.writeHead(404);
          response.end();
        }
      });
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
      address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/nuxeo`;
      process.env['NUXEO_USER'] = credentials.user;
      process.env['NUXEO_PASS'] = credentials.pass;
    });

    afterEach(async () => {
      for (const [name, value] of [
        ['NUXEO_USER', saved.user],
        ['NUXEO_PASS', saved.pass],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await new Promise((done) => server.close(done));
    });

    it('writes the layout the same model, read from a file, gives', async () => {
      await generate({ model: undefined, modelServer: address });
      const live = layoutOf(tree, 'Contract');
      await generate({ force: true });
      expect(layoutOf(tree, 'Contract')).toEqual(live);
      // Read through the pipeline's export: every read carries the credentials, in a header, and
      // each schema is read on its own with its fields' constraints.
      const expected = `Basic ${Buffer.from(`${credentials.user}:${credentials.pass}`).toString('base64')}`;
      expect(seen.length).toBeGreaterThan(3);
      expect(seen.every((read) => read.authorization === expected)).toBe(true);
      expect(
        seen.filter((read) => read.path.startsWith('/nuxeo/api/v1/config/schemas/')),
      ).toHaveLength(JSON.parse(readFileSync(CONTRACTS_MODEL, 'utf8')).schemas.length);
      expect(
        seen
          .filter((read) => read.path.startsWith('/nuxeo/api/v1/config/schemas/'))
          .every((read) => read.fetchSchema === 'fields'),
      ).toBe(true);
    });

    it('refuses, with the reason, when the credentials are not in the environment', async () => {
      delete process.env['NUXEO_PASS'];
      await expect(generate({ model: undefined, modelServer: address })).rejects.toThrow(
        /was not read \(exit 2\)[\s\S]*NUXEO_PASS/,
      );
      expect(seen).toEqual([]);
    });

    it('refuses a server address that carries credentials, before any read, and does not repeat them', async () => {
      const secret = randomBytes(9).toString('hex');
      const refused = await generate({
        model: undefined,
        modelServer: address.replace('http://', `http://someone:${secret}@`),
      }).catch((error: Error) => error);
      expect(refused).toBeInstanceOf(Error);
      expect((refused as Error).message).toContain('the address carries credentials');
      expect((refused as Error).message).not.toContain(secret);
      expect((refused as Error).message).not.toContain('someone');
      expect(seen).toEqual([]);
    });
  });
});
