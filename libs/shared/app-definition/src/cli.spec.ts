import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { main } from './cli';

/** A configuration package with these files, each at its place (app-definition-v2.md, section 1). */
function packageWith(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'app-definition-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

function run(argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

const view = {
  version: 2,
  cards: [
    { id: 'member', fields: ['member:firstName', { field: 'member:birthDate', widget: 'date' }] },
  ],
};

describe('app-definition validate', () => {
  it('passes a package whose version 2 layouts have no finding, and counts the version 1 ones', () => {
    const root = packageWith({
      'layouts/Member/view.layout.json': view,
      'layouts/Member/edit.layout.json': {
        version: 2,
        cards: [{ id: 'c', fields: [{ field: 'member:firstName', required: true }] }],
      },
      'layouts/Claim/metadata.layout.json': { version: 1, sections: [] },
    });
    const { code, out } = run(['validate', root]);
    expect(code).toBe(0);
    expect(out).toContain(
      '3 files: 2 passed, 0 refused, 1 in version 1, which this does not check.',
    );
  });

  // Phase 0's demo, step 1: an app definition with an unknown widget. The pipeline fails and
  // names the widget.
  it('refuses a layout with a widget nobody registered, naming the file, the place and the widget', () => {
    const broken = structuredClone(view);
    (broken.cards[0].fields[1] as { widget: string }).widget = 'calendar';
    const root = packageWith({ 'layouts/Member/view.layout.json': broken });
    const { code, out } = run(['validate', root]);
    expect(code).toBe(1);
    expect(out).toContain(
      `${join(root, 'layouts/Member/view.layout.json')}: cards[0].fields[1].widget: the widget "calendar" is not registered [unknown]`,
    );
    expect(out).toContain('1 file: 0 passed, 1 refused.');
  });

  it('reads the mode from the path, or from --mode, and refuses a file whose place says nothing', () => {
    // `required` belongs to forms: fine under edit, refused under view.
    const form = { version: 2, cards: [{ id: 'c', fields: [{ field: 'a:b', required: true }] }] };
    const root = packageWith({ 'layouts/Claim/edit.layout.json': form, 'claim.json': form });
    expect(run(['validate', join(root, 'layouts/Claim/edit.layout.json')]).code).toBe(0);
    expect(
      run(['validate', join(root, 'layouts/Claim/edit.layout.json'), '--mode', 'view']).code,
    ).toBe(1);
    const unnamed = run(['validate', join(root, 'claim.json')]);
    expect(unnamed.code).toBe(1);
    expect(unnamed.out).toContain('cannot tell which file of an app definition it is');
    expect(run(['validate', join(root, 'claim.json'), '--mode', 'edit']).code).toBe(0);
  });

  it('refuses a file that is not JSON, and a path that is not there', () => {
    const root = packageWith({ 'layouts/Member/view.layout.json': '{ not json' });
    const notJson = run(['validate', root]);
    expect(notJson.code).toBe(1);
    expect(notJson.out).toContain('cannot be read as JSON');
    const missing = run(['validate', join(root, 'nowhere')]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('nowhere');
  });

  it('fails, and says so, when there is nothing to check', () => {
    const { code, out } = run(['validate', packageWith({ 'README.md': 'no layouts here' })]);
    expect(code).toBe(1);
    expect(out).toMatch(/^No app definition files in .*: nothing was checked\.\n$/);
  });

  it('exits 2 for a command it does not know, no path, or a bad option', () => {
    for (const argv of [
      [],
      ['check', 'x'],
      ['validate'],
      ['validate', 'x', '--mode', 'kanban'],
      ['validate', 'x', '--strict'],
      ['validate', 'x', '--platform', 'latest'],
      ['validate', 'x', '--allow-list'],
      ['validate', 'x', '--registered'],
    ]) {
      const { code, err } = run(argv);
      expect(code).toBe(2);
      expect(err).toMatch(/usage:/);
    }
  });

  describe('a whole package', () => {
    const app = {
      version: 2,
      id: 'claims',
      label: 'Claims',
      packageVersion: '1.0.0',
      platform: '>=0.2.0 <1.0.0',
      groups: ['claims-adjusters'],
    };
    const actions = {
      version: 2,
      actions: [
        {
          id: 'payers.request',
          label: 'Request records',
          on: ['row'],
          operation: 'Payers.RequestRecords',
        },
      ],
    };
    const queue = {
      version: 2,
      label: 'Open claims',
      pageProvider: 'payers_open_claims',
      columns: ['claim:number'],
      rowActions: ['payers.request'],
    };
    const files = {
      'app.json': app,
      'actions.json': actions,
      'queues/open.json': queue,
      'tasks/review.approve.layout.json': {
        version: 2,
        cards: [{ id: 'c', fields: [{ field: 'var:comment', required: true }] }],
      },
      'labels/en.json': { version: 2, labels: { 'payers.claims': 'Claims' } },
      'layouts/Claim/view.layout.json': view,
      'bootstrap.json': { not: 'an app definition file' },
    };

    it("passes with the allow-list that has its operation, and leaves version 1's files alone", () => {
      const root = packageWith(files);
      const deployment = packageWith({
        'allow-list.json': { operations: ['Payers.RequestRecords'] },
      });
      const { code, out } = run([
        'validate',
        root,
        '--allow-list',
        join(deployment, 'allow-list.json'),
      ]);
      expect(out).toBe('6 files: 6 passed, 0 refused.\n');
      expect(code).toBe(0);
    });

    it('refuses every operation without an allow-list, and says why', () => {
      const { code, out } = run(['validate', packageWith(files)]);
      expect(code).toBe(1);
      expect(out).toContain(
        `actions[0].operation: the operation "Payers.RequestRecords" is not on this deployment's allow-list [unknown]`,
      );
      expect(out).toContain('No --allow-list was given, so every operation is refused.');
      expect(out).toContain('6 files: 5 passed, 1 refused.');
    });

    it("checks a file with its package's actions.json, named or not", () => {
      const root = packageWith(files);
      expect(run(['validate', join(root, 'queues/open.json')]).code).toBe(0);
      const alone = packageWith({ 'queues/open.json': queue });
      const { code, out } = run(['validate', join(alone, 'queues/open.json')]);
      expect(code).toBe(1);
      expect(out).toContain(
        'rowActions[0]: the row action "payers.request" is not registered [unknown]',
      );
    });

    it('says an id that is a platform route, with no address, and passes it', () => {
      const root = packageWith({ 'app.json': { ...app, id: 'contracts' } });
      const { code, out } = run(['validate', root]);
      expect(out).toContain(
        `app.json: note: with no "address", the app's address is its id, "contracts", which is the platform's own page, /contracts`,
      );
      expect(out).toContain('1 file: 1 passed, 0 refused.');
      expect(code).toBe(0);
      const written = packageWith({
        'app.json': { ...app, id: 'contracts', address: 'contracts' },
      });
      const refused = run(['validate', written]);
      expect(refused.out).not.toContain('note:');
      expect(refused.out).toContain(
        `address: the address "contracts" is the platform's own page, /contracts: choose one no platform route has [structure]`,
      );
      expect(refused.code).toBe(1);
    });

    it("holds app.json's range to --platform", () => {
      const root = packageWith({ 'app.json': app });
      expect(run(['validate', root, '--platform', '0.5.0']).code).toBe(0);
      const { code, out } = run(['validate', root, '--platform', '0.1.0']);
      expect(code).toBe(1);
      expect(out).toContain('platform: this platform is 0.1.0, outside ">=0.2.0 <1.0.0" [unknown]');
    });

    it('exits 2 for an allow-list it cannot read', () => {
      const root = packageWith({ 'app.json': app, 'list.json': ['Payers.RequestRecords'] });
      const { code, err } = run(['validate', root, '--allow-list', join(root, 'list.json')]);
      expect(code).toBe(2);
      expect(err).toContain('an allow-list is { "operations": [<operation or chain ID>, ...] }');
    });
  });

  describe('inside a package', () => {
    const app = {
      version: 2,
      id: 'claims',
      label: 'Claims',
      packageVersion: '1.0.0',
      platform: '^0.2.0',
      groups: ['members'],
    };

    it("checks neither demo/ nor assets/, refuses a file out of place, and leaves version 1's alone", () => {
      const root = packageWith({
        'app.json': app,
        'demo/app.json': { demo: 'data' },
        'demo/labels/en.json': { not: 'labels' },
        'assets/data.json': { not: 'a package file' },
        'manifest.json': { version: 1 },
        'queue/open.json': { version: 2 },
        'Labels/en.json': { version: 2, labels: {} },
      });
      const { code, out } = run(['validate', root]);
      expect(code).toBe(1);
      expect(out).toContain(`${join(root, 'queue/open.json')}: cannot tell which file`);
      expect(out).toContain(`${join(root, 'Labels/en.json')}: cannot tell which file`);
      expect(out).not.toContain('demo');
      expect(out).not.toContain('assets');
      expect(out).toContain('3 files: 1 passed, 2 refused.');
    });

    it('reads a package however its directory is spelt', () => {
      const root = packageWith({ 'app.json': app, 'labels/en.json': { version: 2, labels: {} } });
      // `./<path>` only where a relative path exists: across Windows drives, as on CI, where the
      // temporary directory is on C: and the workspace on D:, `relative()` gives an absolute one.
      const near = relative(process.cwd(), root);
      const dotted = isAbsolute(near) ? [] : [`.${sep}${near}`];
      for (const spelling of [`${root}${sep}`, ...dotted, `${root}${sep}.${sep}`]) {
        const { code, out } = run(['validate', spelling]);
        expect([spelling, out]).toEqual([spelling, '2 files: 2 passed, 0 refused.\n']);
        expect(code).toBe(0);
      }
    });

    it('checks every layout inside a package, in a directory called node_modules too', () => {
      const calendar = {
        version: 2,
        cards: [{ id: 'c', fields: [{ field: 'a:b', widget: 'calendar' }] }],
      };
      const root = packageWith({
        'app.json': app,
        'layouts/node_modules/view.layout.json': calendar,
      });
      const { code, out } = run(['validate', root]);
      expect(code).toBe(1);
      expect(out).toContain(
        'cards[0].fields[0].widget: the widget "calendar" is not registered [unknown]',
      );
      // Outside a package, dependencies are still passed over.
      const loose = packageWith({
        'layouts/Member/view.layout.json': view,
        'node_modules/dep/layouts/Member/view.layout.json': calendar,
      });
      expect(run(['validate', loose]).out).toBe('1 file: 1 passed, 0 refused.\n');
    });

    it('reads a package in a directory named queues as a package, not as queues', () => {
      const root = packageWith({ 'queues/app.json': app });
      const { code, out } = run(['validate', root]);
      expect(out).toBe('1 file: 1 passed, 0 refused.\n');
      expect(code).toBe(0);
    });

    it('reads a logo from assets/, and refuses one that is not there', () => {
      const branded = { ...app, branding: { logo: { src: 'assets/logo.svg' } } };
      expect(
        run(['validate', packageWith({ 'app.json': branded, 'assets/logo.svg': '<svg/>' })]).code,
      ).toBe(0);
      const { code, out } = run(['validate', packageWith({ 'app.json': branded })]);
      expect(code).toBe(1);
      expect(out).toContain(
        'branding.logo.src: the asset "assets/logo.svg" is not in the package [unknown]',
      );
    });

    it('reports a file of the package it cannot read, rather than leaning on nothing', () => {
      const queue = {
        version: 2,
        label: 'Open',
        pageProvider: 'p',
        columns: ['dc:title'],
        rowActions: ['payers.take'],
      };
      const root = packageWith({
        'queues/open.json': queue,
        'actions.json': '{ "version": 2, "act',
      });
      const { code, out } = run(['validate', join(root, 'queues/open.json')]);
      expect(code).toBe(1);
      expect(out).toContain(`${join(root, 'actions.json')}: cannot be read as JSON`);
      const assets = packageWith({ 'app.json': app, assets: 'a file, not a directory' });
      const unreadable = run(['validate', join(assets, 'app.json')]);
      expect(unreadable.code).toBe(1);
      expect(unreadable.out).toContain(`${join(assets, 'assets')}: cannot be read`);
    });

    it('reads a file that begins with a byte-order mark, as a browser does', () => {
      const root = packageWith({ 'app.json': '\uFEFF' + JSON.stringify(app) });
      expect(run(['validate', root]).code).toBe(0);
    });
  });

  describe('what the deployment gives it', () => {
    it("passes the proposal's own package, with its allow-list and a registered module", () => {
      const proposal = readFileSync(
        join(
          import.meta.dirname,
          '..',
          '..',
          '..',
          '..',
          'docs',
          'business-apps',
          'app-definition-v2.md',
        ),
        'utf8',
      );
      const examples = Object.fromEntries(
        [...proposal.matchAll(/```json ([^\n]+)\n([\s\S]*?)```/g)].map((match) => [
          match[1],
          match[2],
        ]),
      );
      const { 'allow-list.json': allowList, ...files } = examples;
      const root = packageWith(files);
      const deployment = packageWith({
        'allow-list.json': allowList,
        'registered.json': { modules: ['cases'] },
      });
      const { code, out } = run([
        'validate',
        root,
        '--allow-list',
        join(deployment, 'allow-list.json'),
        '--registered',
        join(deployment, 'registered.json'),
      ]);
      expect(out).toBe('8 files: 8 passed, 0 refused.\n');
      expect(code).toBe(0);
    });

    it('refuses an action taking the id of one the deployment registers in code, in any slot', () => {
      const actions = {
        version: 2,
        actions: [
          { id: 'acme.toolbar.countersign', label: 'Countersign', transition: 'countersign' },
        ],
      };
      const root = packageWith({
        'app.json': {
          version: 2,
          id: 'claims',
          label: 'Claims',
          packageVersion: '1.0.0',
          platform: '^0.2.0',
          groups: ['members'],
        },
        'actions.json': actions,
      });
      expect(run(['validate', root]).code).toBe(0);
      const deployment = packageWith({
        'registered.json': { actions: ['acme.toolbar.countersign'] },
      });
      const { code, out } = run([
        'validate',
        root,
        '--registered',
        join(deployment, 'registered.json'),
      ]);
      expect(code).toBe(1);
      expect(out).toContain(
        'actions[0].id: the id "acme.toolbar.countersign" is registered in code, and a manifest cannot rebind it [structure]',
      );
    });

    it("holds the home and the menu to the package's queues, and takes its own pages", () => {
      const home = {
        version: 2,
        cards: [{ id: 'open', label: 'Open', kpi: { pageProvider: 'payers_open' }, queue: 'open' }],
      };
      const navigation = {
        version: 2,
        entries: [{ id: 'contracts', label: 'Contracts', page: 'acme.navbar.contracts' }],
      };
      const queue = {
        version: 2,
        label: 'Open',
        pageProvider: 'payers_open',
        columns: ['dc:title'],
      };
      const app = {
        version: 2,
        id: 'claims',
        label: 'Claims',
        packageVersion: '1.0.0',
        platform: '^0.2.0',
        groups: ['members'],
      };
      const withQueue = packageWith({
        'app.json': app,
        'home.json': home,
        'queues/open.json': queue,
      });
      expect(run(['validate', withQueue])).toEqual({
        code: 0,
        out: '3 files: 3 passed, 0 refused.\n',
        err: '',
      });
      // A package with no queues/ has no queue to name.
      const noQueues = packageWith({ 'app.json': app, 'home.json': home });
      const refused = run(['validate', noQueues]);
      expect(refused.code).toBe(1);
      expect(refused.out).toContain(
        'home.json: cards[0].queue: the queue "open" is not in the package: no queues/open.json [unknown]',
      );
      // A home.json with no package around it is checked alone: its queues cannot be known.
      const alone = packageWith({ 'home.json': home });
      expect(run(['validate', join(alone, 'home.json')]).code).toBe(0);

      const menu = packageWith({ 'app.json': app, 'navigation.json': navigation });
      const unregistered = run(['validate', menu]);
      expect(unregistered.out).toContain(
        'the page "acme.navbar.contracts" is not registered [unknown]',
      );
      const deployment = packageWith({ 'registered.json': { pages: ['acme.navbar.contracts'] } });
      expect(
        run(['validate', menu, '--registered', join(deployment, 'registered.json')]).code,
      ).toBe(0);
    });

    it("holds a card from another system to the connectors' allow-lists the deployment gives", () => {
      const claim = {
        version: 2,
        cards: [
          {
            id: 'payment',
            label: 'Payment',
            external: {
              connector: 'payers.claimPayments',
              fields: ['paymentStatus', 'bankAccount'],
            },
          },
        ],
      };
      const root = packageWith({ 'layouts/Claim/view.layout.json': claim });
      // Without the server's connectors, the names are held to their form only.
      expect(run(['validate', root]).code).toBe(0);
      const deployment = packageWith({
        'registered.json': { connectors: { 'payers.claimPayments': ['paymentStatus', 'paidOn'] } },
      });
      const held = run(['validate', root, '--registered', join(deployment, 'registered.json')]);
      expect(held.code).toBe(1);
      expect(held.out).toContain(
        'cards[0].external.fields[1]: the connector "payers.claimPayments" does not return the field "bankAccount" [unknown]',
      );
    });

    it('exits 2 for an allow-list or a registered file of the wrong shape', () => {
      const root = packageWith({
        'extra.json': { operations: [], chains: [] },
        'numbers.json': { operations: [1] },
        'registered.json': { widgets: ['map'] },
        'connectors-list.json': { connectors: ['payers.claimPayments'] },
        'connectors-fields.json': { connectors: { 'payers.claimPayments': 'paymentStatus' } },
      });
      for (const [option, file, message] of [
        ['--allow-list', 'extra.json', 'an allow-list is'],
        ['--allow-list', 'numbers.json', 'an allow-list is'],
        ['--registered', 'registered.json', 'a registered file is'],
        ['--registered', 'connectors-list.json', 'a registered file is'],
        ['--registered', 'connectors-fields.json', 'a registered file is'],
      ]) {
        const { code, err } = run(['validate', root, option, join(root, file)]);
        expect(code).toBe(2);
        expect(err).toContain(message);
      }
    });
  });

  describe('the content model, from --model', () => {
    /** The model of a server with a Member type, as `app-package-model.mjs` exports it. */
    const model = {
      doctypes: { Member: { parent: 'Document', facets: [], schemas: ['member'] } },
      facets: [],
      schemas: [
        {
          name: 'member',
          '@prefix': 'member',
          fields: { firstName: { type: 'string' }, birthDate: { type: 'date' } },
        },
      ],
    };

    it('passes a package whose layouts fit the model, and says how many it held to it', () => {
      const root = packageWith({
        'pkg/layouts/Member/view.layout.json': view,
        // Not a layout, so not held to the model, and not counted.
        'pkg/labels/en.json': { version: 2, labels: {} },
        'model.json': model,
      });
      const { code, out } = run([
        'validate',
        join(root, 'pkg'),
        '--model',
        join(root, 'model.json'),
      ]);
      expect(out).toContain('2 files: 2 passed, 0 refused.');
      expect(code).toBe(0);
      expect(out).toContain(
        `1 layout was held to the content model in ${join(root, 'model.json')}.`,
      );
    });

    it('counts only the layouts the validator held to the model: not version 1, 3, or one with no type', () => {
      const none = (model: string): string =>
        `No layout was held to the content model in ${model}: none is of version 2, in a mode, for a type its path names.`;
      const root = packageWith({
        'pkg/layouts/Member/view.layout.json': { version: 1, sections: [{ fields: ['member:x'] }] },
        'pkg/layouts/Member/edit.layout.json': { version: 3, cards: [] },
        'loose/member.json': view,
        'model.json': model,
      });
      const modelFile = join(root, 'model.json');
      const versions = run(['validate', join(root, 'pkg'), '--model', modelFile]);
      expect(versions.out).toContain('version must be 2, not 3 [structure]');
      expect(versions.out).toContain(none(modelFile));
      expect(versions.out).not.toMatch(/\d+ layouts? (was|were) held/);
      // A file a forced --mode reads has no type in its path, so it is not held either.
      const loose = run([
        'validate',
        join(root, 'loose/member.json'),
        '--mode',
        'view',
        '--model',
        modelFile,
      ]);
      expect(loose.out).toContain(none(modelFile));
    });

    it('refuses a widget that does not show its property, naming the file, the place and both types', () => {
      const broken = structuredClone(view);
      (broken.cards[0].fields[1] as { widget: string }).widget = 'boolean';
      const root = packageWith({ 'layouts/Member/view.layout.json': broken, 'model.json': model });
      const { code, out } = run([
        'validate',
        join(root, 'layouts'),
        '--model',
        join(root, 'model.json'),
      ]);
      expect(code).toBe(1);
      expect(out).toContain(
        `${join(root, 'layouts/Member/view.layout.json')}: cards[0].fields[1].widget: the widget "boolean" does not show "member:birthDate", a date property: it takes boolean [parameter]`,
      );
      // The same file, with no model: the model is what refuses it.
      expect(run(['validate', join(root, 'layouts')]).code).toBe(0);
    });

    it('refuses a layout whose type a forced --mode leaves unsaid', () => {
      const root = packageWith({ 'member.json': view, 'model.json': model });
      const { code, out } = run([
        'validate',
        join(root, 'member.json'),
        '--mode',
        'view',
        '--model',
        join(root, 'model.json'),
      ]);
      expect(code).toBe(1);
      expect(out).toContain(
        'the file: a content model was given without the document type the file lays out, so no field was checked against it [unknown]',
      );
    });

    it('exits 2 for a model it cannot read, with what is wrong', () => {
      const root = packageWith({
        'layouts/Member/view.layout.json': view,
        'broken.json': { ...model, doctypes: { Member: { schemas: ['missing'] } } },
        'text.json': 'not JSON',
      });
      for (const [file, message] of [
        ['broken.json', 'doctypes.Member.schemas: the schema "missing" is not in schemas'],
        ['text.json', 'cannot be read as JSON'],
        ['absent.json', 'cannot be read as JSON'],
      ]) {
        const { code, err } = run(['validate', root, '--model', join(root, file)]);
        expect(code).toBe(2);
        expect(err).toContain(message);
      }
      expect(run(['validate', root, '--model']).code).toBe(2);
    });

    it('reads a model alone with model <file>: 0 when it is whole, 1 with every problem', () => {
      const root = packageWith({
        'model.json': model,
        'broken.json': {
          ...model,
          doctypes: { Member: { schemas: ['one', 'two'], facets: ['three'] } },
        },
      });
      const sound = run(['model', join(root, 'model.json')]);
      expect(sound.code).toBe(0);
      expect(sound.out).toBe(
        `${join(root, 'model.json')}: a content model of 1 document type, 0 facets and 1 schema.\n`,
      );
      const broken = run(['model', join(root, 'broken.json')]);
      expect(broken.code).toBe(1);
      expect(broken.out).toBe(
        `${join(root, 'broken.json')}: is not a content model:\n` +
          '  - doctypes.Member.facets: the facet "three" is not in facets\n' +
          '  - doctypes.Member.schemas: the schema "one" is not in schemas\n' +
          '  - doctypes.Member.schemas: the schema "two" is not in schemas\n',
      );
      for (const argv of [['model'], ['model', '--x'], ['model', 'a', 'b']])
        expect(run(argv).code).toBe(2);
    });
  });
});

describe('app-definition changes', () => {
  const app = (packageVersion: string, extra: Record<string, unknown> = {}) => ({
    version: 2,
    id: 'payers-claims',
    label: 'Claims',
    packageVersion,
    platform: '>=0.2.0 <1.0.0',
    groups: ['members'],
    ...extra,
  });
  const queue = { version: 2, pageProvider: 'payers_unassigned_claims', columns: ['dc:title'] };
  const configured = (version: string, files: Record<string, unknown> = {}) =>
    packageWith({
      'bundle/agentic-ui-config/app.json': app(version),
      'package/package.xml': `<package name="payers-claims-demo" version="${version}"></package>`,
      ...files,
    });
  const judged = (out: string) => JSON.parse(out) as Record<string, unknown>;

  it('passes a version raised as far as the changes need, and prints the judgement as JSON', () => {
    const before = configured('1.0.0');
    const after = configured('1.1.0', { 'bundle/agentic-ui-config/queues/open.json': queue });
    const { code, out, err } = run(['changes', before, after]);
    expect({ code, err }).toEqual({ code: 0, err: '' });
    expect(judged(out)).toMatchObject({
      previous: '1.0.0',
      version: '1.1.0',
      required: 'minor',
      raised: 'minor',
      refused: null,
      changes: [
        {
          level: 'addition',
          file: 'bundle/agentic-ui-config/queues/open.json',
          what: 'The queue open is added.',
        },
      ],
    });
  });

  it('exits 1 for a version that did not move as far as the changes need', () => {
    const before = configured('1.0.0', { 'bundle/agentic-ui-config/queues/open.json': queue });
    const removed = run(['changes', before, configured('1.1.0')]);
    expect(removed.code).toBe(1);
    expect(judged(removed.out)['refused']).toContain('need a major version');
    const unmoved = run([
      'changes',
      before,
      configured('1.0.0', { 'bundle/schemas/x.xsd': '<a/>' }),
    ]);
    expect(unmoved.code).toBe(1);
    expect(judged(unmoved.out)['refused']).toContain('and the version is still 1.0.0');
  });

  it('compares what the zip holds: not a Markdown file, nor what package/ keeps beside its two', () => {
    const at = (text: string) =>
      configured('1.0.0', {
        'bundle/agentic-ui-config/README.md': text,
        'package/notes.txt': text,
        'bundle/agentic-ui-config/queues/open.json': { $schema: text, ...queue },
      });
    const { code, out } = run(['changes', at('one'), at('two')]);
    expect(code).toBe(0);
    expect(judged(out)['changes']).toEqual([]);
  });

  it('compares an image by its bytes, not by its text', () => {
    const image = (byte: number) =>
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, byte]).toString('latin1');
    const write = (version: string, byte: number) => {
      const root = configured(version);
      writeFileSync(
        join(root, 'bundle/agentic-ui-config/logo.png'),
        Buffer.from(image(byte), 'latin1'),
      );
      return root;
    };
    // Two bytes that are not UTF-8 read as the same replacement character: compared as text, the
    // two images would be the same file.
    const { code, out } = run(['changes', write('1.0.0', 0xfe), write('1.0.0', 0xfd)]);
    expect(code).toBe(1);
    expect(judged(out)['changes']).toEqual([
      expect.objectContaining({ file: 'bundle/agentic-ui-config/logo.png' }),
    ]);
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a package holding a link, exit 2, reading nothing through it',
    () => {
      const before = configured('1.0.0');
      const after = configured('1.0.0');
      symlinkSync('/etc/hosts', join(after, 'bundle', 'hosts'));
      const { code, err } = run(['changes', before, after]);
      expect(code).toBe(2);
      expect(err).toContain('bundle/hosts is a symbolic link, which is not followed');
    },
  );

  it('exits 2 for a folder that is no package, or a wrong command', () => {
    const empty = mkdtempSync(join(tmpdir(), 'app-definition-'));
    expect(run(['changes', configured('1.0.0'), empty])).toMatchObject({ code: 2 });
    expect(run(['changes', configured('1.0.0'), empty]).err).toContain(
      'has no bundle/agentic-ui-config/app.json',
    );
    const noVersion = packageWith({ 'bundle/agentic-ui-config/app.json': { version: 2 } });
    expect(run(['changes', configured('1.0.0'), noVersion]).err).toContain(
      'names no packageVersion',
    );
    for (const argv of [
      ['changes'],
      ['changes', 'a'],
      ['changes', 'a', 'b', 'c'],
      ['changes', '--x', 'a'],
    ])
      expect(run(argv).code, argv.join(' ')).toBe(2);
  });
});
