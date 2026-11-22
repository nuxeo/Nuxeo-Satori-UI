import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalogue } from './catalogue';
import { constructsOf } from './constructs';
import {
  convert,
  ConversionError,
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

function prepare(options?: SyntheticPackageOptions): HarnessInput {
  const pkg = readStudioPackage(syntheticPackage(options));
  const read = inventory(pkg);
  return { pkg, inventory: read, catalogue, conversion: convert(pkg, read, catalogue) };
}

const check = (input: HarnessInput, number: number) =>
  runHarness(input).checks.find((result) => result.number === number);

describe('the harness on a sound conversion', () => {
  const input = prepare();
  const result = runHarness(input);

  it('passes the three checks M0 runs', () => {
    expect(result.checks.map((c) => [c.number, c.status])).toEqual([
      [1, 'pass'],
      [2, 'not run'],
      [3, 'not run'],
      [4, 'pass'],
      [5, 'not run'],
      [6, 'not run'],
      [7, 'not run'],
      [8, 'pass'],
      [9, 'not run'],
      [10, 'not run'],
    ]);
    expect(result.checks.flatMap((c) => c.findings)).toEqual([]);
  });

  it('says why each other check did not run, and never counts it as a pass', () => {
    for (const notRun of result.checks.filter((c) => c.status === 'not run')) {
      expect(notRun.reason).toMatch(/\w/);
    }
  });

  it('is not ready, and says what stands in the way', () => {
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([
      'check 2 did not run',
      'check 3 did not run',
      'check 5 did not run',
      'check 6 did not run',
      'check 7 did not run',
      'check 9 did not run',
      'check 10 did not run',
      expect.stringMatching(/^\d+ constructs are pending a later phase$/),
      expect.stringMatching(/^\d+ reported items have no owner$/),
    ]);
  });

  it('accounts for every construct, with the outcomes M0 gives them', () => {
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
      [`layout:${UI}/document/claim/nuxeo-claim-view-layout.html`]: 'pending',
      [`script:${UI}/document/claim/nuxeo-claim-view-layout.html`]: 'generated',
      'translation:data/i18n/messages-fr.json': 'converted',
    });
    expect(input.conversion.labels.fr['label.claim.amount']).toBe('Montant');
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

// The negative controls of docs/business-apps/studio-migration.md, section 7, for the checks M0
// runs: each mutation must make the check it names fail.
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
    expect(findings('drop-translation')).toEqual(['labels/en.json: label.claim.number is missing']);
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
    // A field written inside a script's string: the text holds three, the parser sees two.
    const layout = syntheticBundleFiles()[path].replace(
      '</template>',
      `<script>const row = '<div role="widget"></div>';</script></template>`,
    );
    const findings = check(prepare({ bundle: { [path]: layout } }), 1)?.findings;
    expect(findings).toEqual([
      `the two counts disagree on ${path}: the parser finds 2 layout-field, the text holds 3`,
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
    expect(back.labels).toEqual(input.conversion.labels);
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
    expect(() => readConversion(out)).toThrow(/is not a studio-migration-report\/m0 report/);
  });
});
