import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
      expect(out).toBe('6 files: 6 passed, 0 refused.\n');
      expect(code).toBe(0);
    });

    it('exits 2 for an allow-list or a registered file of the wrong shape', () => {
      const root = packageWith({
        'extra.json': { operations: [], chains: [] },
        'numbers.json': { operations: [1] },
        'registered.json': { widgets: ['map'] },
      });
      for (const [option, file, message] of [
        ['--allow-list', 'extra.json', 'an allow-list is'],
        ['--allow-list', 'numbers.json', 'an allow-list is'],
        ['--registered', 'registered.json', 'a registered file is'],
      ]) {
        const { code, err } = run(['validate', root, option, join(root, file)]);
        expect(code).toBe(2);
        expect(err).toContain(message);
      }
    });
  });
});
