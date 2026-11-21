import { main, type CliIo } from './cli';
import { syntheticPackage } from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';

function run(
  argv: string[],
  files: Record<string, Buffer> = {},
): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: CliIo = {
    out: (text) => (out += text),
    err: (text) => (err += text),
    readFile: (path) => {
      if (path in files) return files[path];
      throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' });
    },
  };
  return { code: main(argv, io), out, err };
}

describe('studio-migration inventory', () => {
  it('prints what the package holds and where each part goes, and exits 0', () => {
    const { code, out, err } = run(['inventory', 'acme.zip'], { 'acme.zip': syntheticPackage() });
    expect(code).toBe(0);
    expect(err).toBe('');
    expect(out).toContain(
      'Acme-Claims 1.0.0: a studio package for [2025.0,2026) (lts), depending on nuxeo-web-ui',
    );
    expect(out).toContain('Document layouts: 2\n  Claim: view (2 fields), edit (3 fields)');
    expect(out).toContain(
      'claims: a form with 2 fields; results with 2 columns, shown as nuxeo-data-table',
    );
    expect(out).toMatch(/DOCUMENT_ACTIONS +approveClaim +automatic → toolbar/);
    expect(out).toMatch(/THEMES +acme +automatic → Layer 0 themes/);
    expect(out).toContain('Dashboard: 3 cards, 1 of them a repeat');
    expect(out).toContain('Theme acme: 5 properties, 2 set a token and 3 are reported');
    expect(out).toContain('Translations: en 3 keys, fr 3 keys');
    expect(out).toContain(
      'Decisions needed: 1\n  - dashboard card 2 (Open claims) repeats card 1, and is kept once',
    );
  });

  it('reports the mistakes a real project carries: a button with no operation, a field bound twice', () => {
    const pkg = syntheticPackage({
      bundle: {
        [`${UI}/nuxeo-Acme-Claims-bundle.html`]:
          '<nuxeo-slot-content name="TestBtn" slot="DOCUMENT_ACTIONS"><template><nuxeo-operation-button label="Test"></nuxeo-operation-button></template></nuxeo-slot-content>',
        [`${UI}/document/claim/nuxeo-claim-import-layout.html`]: `<dom-module id="nuxeo-claim-import-layout"><template>
          <nuxeo-input role="widget" value="{{document.properties.dc:title}}" label="Title"></nuxeo-input>
          <nuxeo-input role="widget" value="{{document.properties.dc:description}}" label="Description"></nuxeo-input>
          <nuxeo-input role="widget" value="{{document.properties.dc:title}}" label="Title"></nuxeo-input>
        </template></dom-module>`,
      },
    });
    const { out } = run(['inventory', 'acme.zip'], { 'acme.zip': pkg });
    expect(out).toContain(
      'slot DOCUMENT_ACTIONS (contribution "TestBtn") has a nuxeo-operation-button that runs no operation',
    );
    expect(out).toContain(
      'layout nuxeo-claim-import-layout binds dc:title 2 times, and keeps it once',
    );
  });

  it('lists what the catalogue cannot place as decisions, rather than passing it', () => {
    const pkg = syntheticPackage({
      bundle: {
        [`${UI}/nuxeo-Acme-Claims-bundle.html`]:
          '<nuxeo-slot-content name="x" slot="MY_SLOT"><template><acme-widget></acme-widget></template></nuxeo-slot-content>',
        [`${UI}/workflow/review/nuxeo-review-task-layout.html`]: '<p></p>',
      },
    });
    const { code, out } = run(['inventory', 'acme.zip'], { 'acme.zip': pkg });
    expect(code).toBe(0);
    // The three below, and the repeated dashboard card.
    expect(out).toContain('Decisions needed: 4');
    expect(out).toContain('slot MY_SLOT (contribution "x") is not in the catalogue');
    expect(out).toContain('element acme-widget (used 1 times) is not in the catalogue');
    expect(out).toContain(
      `file ${UI}/workflow/review/nuxeo-review-task-layout.html is of no known kind`,
    );
  });

  it('writes the whole inventory and accounting as JSON with --json', () => {
    const { code, out } = run(['inventory', 'acme.zip', '--json'], {
      'acme.zip': syntheticPackage(),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.inventory.descriptor.name).toBe('Acme-Claims');
    expect(parsed.inventory.elements['nuxeo-input']).toBe(2);
    expect(parsed.accounting.decisions).toEqual([
      'dashboard card 2 (Open claims) repeats card 1, and is kept once',
    ]);
  });

  it('exits 1 with the reason when the package cannot be read', () => {
    const notAPackage = run(['inventory', 'bad.zip'], {
      'bad.zip': Buffer.from('not a zip archive at all, but long'),
    });
    expect(notAPackage.code).toBe(1);
    expect(notAPackage.err).toMatch(/^bad\.zip: not a ZIP archive/);
    expect(notAPackage.out).toBe('');

    const missing = run(['inventory', 'missing.zip']);
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/^missing\.zip: ENOENT/);
  });

  it('exits 2 for a command it does not know, a missing or extra path, or an unknown option', () => {
    for (const argv of [
      [],
      ['convert', 'a.zip'],
      ['inventory'],
      ['inventory', 'a.zip', 'b.zip'],
      ['inventory', 'a.zip', '--yaml'],
    ]) {
      const { code, err } = run(argv);
      expect(code).toBe(2);
      expect(err).toMatch(/^usage:/);
    }
  });
});
