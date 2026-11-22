import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { main } from './cli';

/** A configuration package with these layout files, under `layouts/<Type>/<mode>.layout.json`. */
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
      '3 layout files: 2 passed, 0 refused, 1 in version 1, which this does not check.',
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
    expect(out).toContain('1 layout files: 0 passed, 1 refused.');
  });

  it('reads the mode from the path, or from --mode, and refuses a file whose mode it cannot tell', () => {
    // `required` belongs to forms: fine under edit, refused under view.
    const form = { version: 2, cards: [{ id: 'c', fields: [{ field: 'a:b', required: true }] }] };
    const root = packageWith({ 'layouts/Claim/edit.layout.json': form, 'claim.json': form });
    expect(run(['validate', join(root, 'layouts/Claim/edit.layout.json')]).code).toBe(0);
    expect(
      run(['validate', join(root, 'layouts/Claim/edit.layout.json'), '--mode', 'view']).code,
    ).toBe(1);
    const unnamed = run(['validate', join(root, 'claim.json')]);
    expect(unnamed.code).toBe(1);
    expect(unnamed.out).toContain('cannot tell its mode');
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

  it('says so when there is nothing to check', () => {
    const { code, out } = run(['validate', packageWith({ 'README.md': 'no layouts here' })]);
    expect(code).toBe(0);
    expect(out).toMatch(/^No layout files in /);
  });

  it('exits 2 for a command it does not know, no path, or a bad option', () => {
    for (const argv of [
      [],
      ['check', 'x'],
      ['validate'],
      ['validate', 'x', '--mode', 'kanban'],
      ['validate', 'x', '--strict'],
    ]) {
      const { code, err } = run(argv);
      expect(code).toBe(2);
      expect(err).toMatch(/usage:/);
    }
  });
});
