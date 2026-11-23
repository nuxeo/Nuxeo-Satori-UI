import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalogue } from './catalogue';
import { constructsOf } from './constructs';
import {
  convert,
  ConversionError,
  labelsOf,
  readConversion,
  writeConversion,
  type Conversion,
} from './convert';
import { runHarness, type HarnessInput } from './harness';
import { inventory } from './inventory';
import { MUTATIONS } from './mutations';
import { readStudioPackage } from './studio-package';
import {
  syntheticBundleFiles,
  syntheticPackage,
  type SyntheticPackageOptions,
} from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const catalogue = loadCatalogue();

/** The deployment's allow-list the tests convert with: the synthetic package's approve button. */
export const ALLOW_LIST: ReadonlySet<string> = new Set(['Claim.Approve']);

function prepare(options?: SyntheticPackageOptions): HarnessInput {
  const pkg = readStudioPackage(syntheticPackage(options));
  const read = inventory(pkg);
  return {
    pkg,
    inventory: read,
    catalogue,
    allowList: ALLOW_LIST,
    conversion: convert(pkg, read, catalogue, { allowList: ALLOW_LIST }),
  };
}

const check = (input: HarnessInput, number: number) =>
  runHarness(input).checks.find((result) => result.number === number);

describe('the harness on a sound conversion', () => {
  const input = prepare();
  const result = runHarness(input);

  it('passes what runs without a server, and runs the rest in part', () => {
    expect(result.checks.map((c) => [c.number, c.status])).toEqual([
      [1, 'pass'],
      [2, 'pass'],
      [3, 'partial'],
      [4, 'pass'],
      [5, 'partial'],
      [6, 'partial'],
      [7, 'partial'],
      [8, 'pass'],
      [9, 'not run'],
      [10, 'pass'],
    ]);
    expect(result.checks.flatMap((c) => c.findings)).toEqual([]);
  });

  it('says what each partial check did not run, and why', () => {
    const reason = (number: number) => result.checks.find((c) => c.number === number)?.reason;
    expect(reason(3)).toBe(
      "1 name rests on the platform's own model, which only the migration server can confirm: dc:title",
    );
    expect(reason(5)).toBe(
      "The truth tables of 5 conditions ran against Web UI's and the app's code as written; evaluating each original in Web UI itself, on the migration server, has not run",
    );
    expect(reason(6)).toMatch(/^The values half opens the same records in both apps/);
    expect(reason(7)).toMatch(/needs the migration server$/);
  });

  it("runs check 10 only in part when it has the conversion's word for the allow-list alone", () => {
    const { allowList: _given, ...recorded } = input;
    expect(runHarness(recorded).checks.find((c) => c.number === 10)).toMatchObject({
      status: 'partial',
      findings: [],
      reason: expect.stringMatching(/the allow-list the conversion recorded/),
    });
  });

  it('says why each other check did not run, and never counts it as a pass', () => {
    for (const notRun of result.checks.filter((c) => c.status !== 'pass')) {
      expect(notRun.reason).toMatch(/\w/);
    }
  });

  it('is not ready, and says what stands in the way', () => {
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([
      'check 3 ran only in part',
      'check 5 ran only in part',
      'check 6 ran only in part',
      'check 7 ran only in part',
      'check 9 did not run',
      expect.stringMatching(/^\d+ constructs are pending a later phase$/),
      expect.stringMatching(/^\d+ proposals wait for a person to accept or reject them$/),
      expect.stringMatching(/^\d+ reported items have no owner$/),
    ]);
  });

  it('accounts for every construct, with the outcomes M1 gives them', () => {
    const outcomes = Object.fromEntries(
      input.conversion.report.constructs.map((entry) => [
        entry.id.replace(/#.*/, ''),
        entry.outcome,
      ]),
    );
    expect(input.conversion.report.constructs).toHaveLength(constructsOf(input.inventory).length);
    expect(outcomes).toMatchObject({
      'file:package.xml': 'generated',
      'file:OSGI-INF/extensions.xml': 'server',
      'file:data/i18n/messages.properties': 'reported',
      [`file:${UI}/themes/acme/logo.png`]: 'converted',
      [`layout:${UI}/document/claim/nuxeo-claim-view-layout.html`]: 'converted',
      [`script:${UI}/document/claim/nuxeo-claim-view-layout.html`]: 'generated',
      'translation:data/i18n/messages-fr.json': 'converted',
    });
    expect(labelsOf(input.conversion).fr['label.claim.amount']).toBe('Montant');
    expect(input.conversion.themes.acme.tokens).toEqual({
      '--mat-sys-primary': '#00796b',
      '--mat-sys-on-surface': '#1d1d1f',
    });
  });

  it('gives what a migration reports a reason, and reports the repeated card', () => {
    const repeated = input.conversion.report.constructs.find(
      (entry) => entry.id === `dashboard-card:${UI}/nuxeo-home.html#2`,
    );
    expect(repeated).toMatchObject({
      outcome: 'reported',
      note: 'It repeats card 1, and is kept once',
    });
  });
});

// The negative controls of docs/business-apps/studio-migration.md, section 7, for the checks the
// harness runs: each mutation must make the check it names fail.
describe('each deliberate breakage fails the check that guards it', () => {
  for (const mutation of MUTATIONS) {
    it(`${mutation.name}: ${mutation.description}`, () => {
      const input = prepare();
      const broken = mutation.apply(input.conversion).conversion;
      const result = check({ ...input, conversion: broken }, mutation.caughtBy);
      expect(result?.status).toBe('fail');
      expect(result?.findings.length).toBeGreaterThan(0);
      expect(runHarness({ ...input, conversion: broken }).ready).toBe(false);
    });
  }

  it('says so, rather than failing some other way, when there is nothing of its kind to break', () => {
    const files = syntheticBundleFiles();
    const bare = prepare({
      without: Object.keys(files).filter(
        (path) => path.startsWith(`${UI}/`) || path.startsWith('data/i18n/'),
      ),
    });
    for (const mutation of MUTATIONS) {
      try {
        mutation.apply(bare.conversion);
      } catch (error) {
        expect([mutation.name, (error as Error).name]).toEqual([mutation.name, 'MutationError']);
      }
    }
  });

  it('names what broke', () => {
    const input = prepare();
    const findings = (name: string) => {
      const mutation = MUTATIONS.find((m) => m.name === name);
      if (!mutation) throw new Error(name);
      return check(
        { ...input, conversion: mutation.apply(input.conversion).conversion },
        mutation.caughtBy,
      )?.findings;
    };
    expect(findings('drop-translation')).toEqual([
      'app/labels/en.json: label.claim.number is missing',
    ]);
    expect(findings('drop-field')).toEqual([
      "layouts/Claim/edit.layout.json: cl:number is missing, though Web UI's edit layout of Claim shows it",
    ]);
    expect(findings('date-to-text')).toEqual([
      'layouts/Claim/view.layout.json: cl:incidentDate shows as text, not as date',
    ]);
    expect(findings('drop-required')).toEqual([
      "layouts/Claim/edit.layout.json: cl:number is not required, but Web UI's is required",
    ]);
    expect(findings('rename-field')).toEqual([
      'layouts/Claim/edit.layout.json sections.0.fields.0: the schema claim has no field numberRenamed, so cl:numberRenamed does not exist',
    ]);
    expect(findings('slip-free-javascript')).toEqual([
      'layouts/Claim/edit.layout.json: sections.0.fields.0.visibleWhen holds a rule that no condition of the package gives',
    ]);
    expect(findings('widen-to-everyone')).toEqual([
      'layouts/Claim/metadata.layout.json: it shows cl:reserve to everyone, though Web UI shows it only while condition 1 passes',
    ]);
    expect(findings('change-label')).toEqual([
      'layouts/Claim/edit.layout.json: cl:number: the app shows "Claim number (changed)", where Web UI shows "Claim number"',
    ]);
    expect(findings('wrong-page-provider')).toEqual([
      'queues/claims.json: it asks the page provider "claims_other", where Web UI asks claims',
    ]);
    expect(findings('change-parameter')).toEqual([
      'actions.json: acme-claims.approveClaim sends {"comment":"Approved in Web UIchanged"}, where Web UI sends {"comment":"Approved in Web UI"}',
    ]);
    expect(findings('bind-other-operation')).toEqual([
      'actions.json: acme-claims.approveClaim runs "Document.Delete", where Web UI\'s "approveClaim" runs Claim.Approve',
    ]);
    expect(findings('unregistered-widget')).toEqual([
      'app/layouts/Claim/view.layout.json cards[0].fields[0].widget: the widget "signature" is not registered',
    ]);
    expect(findings('wrong-primary-token')).toEqual([
      'acme: --mat-sys-primary is not set, though --nuxeo-primary-color sets it to #00796b',
      'acme: --mat-sys-secondary is set, but no property of the theme sets it',
    ]);
    expect(findings('drop-report-entry')).toEqual([
      expect.stringMatching(
        /^dropped: the view layout of Claim, in .*nuxeo-claim-view-layout\.html/,
      ),
      expect.stringMatching(/^coverage is 9\d\.\d%, not 100%$/),
    ]);
  });
});

describe('check 1, nothing dropped', () => {
  it('fails when the two counts of the package disagree, as when the parser misses something', () => {
    const path = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
    // A field written inside a script's string: the text holds six, the parser sees five.
    const layout = syntheticBundleFiles()[path].replace(
      '</template>',
      `<script>const row = '<div role="widget"></div>';</script></template>`,
    );
    const findings = check(prepare({ bundle: { [path]: layout } }), 1)?.findings;
    expect(findings).toEqual([
      `the two counts disagree on ${path}: the parser finds 5 layout-field, the text holds 6`,
    ]);
  });

  it('counts a field whose tag writes role="widget" twice once, as the parser does', () => {
    // The sample package's SampleTestDocu view layout does exactly this.
    const path = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
    const layout = syntheticBundleFiles()[path].replace(
      '<div role="widget">',
      '<div role="widget" role="widget">',
    );
    expect(check(prepare({ bundle: { [path]: layout } }), 1)?.findings).toEqual([]);
  });

  it('does not take a role="widget" inside another attribute for a field', () => {
    const path = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
    const layout = syntheticBundleFiles()[path].replace(
      '</template>',
      `<div data-note='role="widget"' title="a > b"></div></template>`,
    );
    expect(check(prepare({ bundle: { [path]: layout } }), 1)?.findings).toEqual([]);
  });

  it('agrees with the second count on the whole synthetic package', () => {
    expect(check(prepare(), 1)?.findings).toEqual([]);
  });
});

describe('check 8, theme', () => {
  it('fails when text is not readable on the background the theme sets', () => {
    const path = `${UI}/themes/acme/theme.html`;
    const theme = syntheticBundleFiles()[path].replace(
      '--nuxeo-text-default: #1d1d1f;',
      '--nuxeo-text-default: #777777;\n      --nuxeo-page-background: #888888;',
    );
    const findings = check(prepare({ bundle: { [path]: theme } }), 8)?.findings;
    expect(findings).toEqual([
      expect.stringMatching(
        /--mat-sys-on-surface \(#777777\) on --mat-sys-surface \(#888888\) has a contrast of 1\.\d\d, below the 4\.5/,
      ),
      expect.stringMatching(
        /--mat-sys-primary \(#00796b\) on --mat-sys-surface \(#888888\) has a contrast of/,
      ),
    ]);
  });

  it('resolves var() references, and reports a property whose value it cannot resolve', () => {
    const path = `${UI}/themes/acme/theme.html`;
    const theme = syntheticBundleFiles()
      [path].replace(
        '--nuxeo-primary-color: #00796b;',
        '--nuxeo-primary-color: var(--acme-brand);\n      --acme-brand: #00796b;',
      )
      .replace('--nuxeo-text-default: #1d1d1f;', '--nuxeo-text-default: var(--not-set);');
    const input = prepare({ bundle: { [path]: theme } });
    expect(input.conversion.themes.acme.tokens).toEqual({ '--mat-sys-primary': '#00796b' });
    const textDefault = input.conversion.report.constructs.find(
      (entry) => entry.label === '--nuxeo-text-default',
    );
    expect(textDefault).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/refers to a property the theme does not set/),
    });
    expect(check(input, 8)?.findings).toEqual([]);
  });
});

describe('writing and reading a conversion', () => {
  const directory = () => join(mkdtempSync(join(tmpdir(), 'studio-conversion-')), 'out');

  it('reads back what it wrote', () => {
    const input = prepare();
    const out = directory();
    writeConversion(out, input.conversion);
    const back: Conversion = readConversion(out);
    expect(back.report).toEqual(input.conversion.report);
    expect(back.app).toEqual(input.conversion.app);
    expect(back.themes).toEqual(input.conversion.themes);
    expect(Object.keys(back.assets)).toEqual(Object.keys(input.conversion.assets));
    expect(
      runHarness({ ...input, conversion: back }).checks.filter((c) => c.status === 'fail'),
    ).toEqual([]);
  });

  it('refuses to write into a directory that is not empty', () => {
    const out = directory();
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'keep.txt'), 'mine');
    expect(() => writeConversion(out, prepare().conversion)).toThrow(/is not an empty directory/);
  });

  it('refuses a theme name that is not a safe file name on every system', () => {
    const input = prepare();
    const conversion = { ...input.conversion, themes: { 'a:b': { id: 'a:b', tokens: {} } } };
    expect(() => writeConversion(directory(), conversion)).toThrow(ConversionError);
  });

  it('refuses a directory with no report, or a report of another format', () => {
    const out = directory();
    mkdirSync(out, { recursive: true });
    expect(() => readConversion(out)).toThrow(/holds no report\.json/);
    writeFileSync(
      join(out, 'report.json'),
      JSON.stringify({ format: 'something-else', constructs: [] }),
    );
    expect(() => readConversion(out)).toThrow(/is not a studio-migration-report\/m1 report/);
    writeFileSync(
      join(out, 'report.json'),
      JSON.stringify({ format: 'studio-migration-report/m0', constructs: [] }),
    );
    expect(() => readConversion(out)).toThrow(
      /a conversion of an earlier phase is converted again/,
    );
  });
});
