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
import { runCheck, runHarness, type HarnessInput } from './harness';
import { inventory } from './inventory';
import { MUTATIONS } from './mutations';
import { readStudioPackage } from './studio-package';
import {
  syntheticBundleFiles,
  syntheticPackage,
  type SyntheticPackageOptions,
} from './testing/synthetic-package';
import { m2CorpusFiles } from './testing/m2-corpus';

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

/** What one check finds: that check alone, as the harness runs it, not the ten. */
const check = (input: HarnessInput, number: number) => runCheck(input, number);

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
      "1 name rests on the platform's own model, which only a server can confirm, such as the migration server, in lab mode: dc:title",
    );
    expect(reason(5)).toBe(
      "The truth tables of 5 conditions ran against Web UI's and the app's code as written; evaluating each original in Web UI itself, on the migration server, has not run",
    );
    expect(reason(6)).toMatch(/^The values half opens the same records in both apps/);
    expect(reason(7)).toMatch(/needs the migration server$/);
  });

  it("runs check 10 only in part when it has the conversion's word for the allow-list alone", () => {
    const { allowList: _given, ...recorded } = input;
    expect(runCheck(recorded, 10)).toMatchObject({
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
      '1 proposal waits for a person to accept or reject it',
      expect.stringMatching(/^\d+ reported items have no owner$/),
      'no one has approved the report and its decisions: a person does, with the approve command, once every decision is made',
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
  // The made-up package with M2's corpus, which holds what each control breaks: task forms, tabs
  // and layout blocks besides M1's.
  // Read once: a control breaks a copy, never the conversion it is given, and each package read
  // holds its parsed documents, so reading one per control runs the worker out of memory.
  const corpus = prepare({ bundle: m2CorpusFiles() });
  const pristine = JSON.stringify(corpus.conversion);
  for (const mutation of MUTATIONS) {
    it(`${mutation.name}: ${mutation.description}`, () => {
      const input = corpus;
      const broken = mutation.apply(input.conversion, input).conversion;
      // It broke a copy: the conversion the next control is given is still whole.
      expect(JSON.stringify(corpus.conversion)).toBe(pristine);
      const result = check({ ...input, conversion: broken }, mutation.caughtBy);
      expect(result?.status).toBe('fail');
      expect(result?.findings.length).toBeGreaterThan(0);
      // Its failure stands in the way. Not `ready` alone: check 9 never runs, so no migration is
      // ready yet, broken or not.
      expect(runHarness({ ...input, conversion: broken }).blockers).toContain(
        `check ${mutation.caughtBy} failed`,
      );
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

  // One case a control: each runs the one check that catches it, not the ten.
  describe('names what broke', () => {
    const input = prepare();
    it.each<[string, readonly unknown[]]>([
      ['drop-translation', ['app/labels/en.json: label.claim.number is missing']],
      [
        'drop-field',
        [
          "layouts/Claim/edit.layout.json: cl:number is missing, though Web UI's edit layout of Claim shows it",
        ],
      ],
      [
        'date-to-text',
        ['layouts/Claim/view.layout.json: cl:incidentDate shows as text, not as date'],
      ],
      [
        'drop-required',
        ["layouts/Claim/edit.layout.json: cl:number is not required, but Web UI's is required"],
      ],
      [
        'rename-field',
        [
          'layouts/Claim/edit.layout.json sections.0.fields.0: the schema claim has no field numberRenamed, so cl:numberRenamed does not exist',
        ],
      ],
      [
        'slip-free-javascript',
        [
          'layouts/Claim/edit.layout.json: sections.0.fields.0.visibleWhen holds a rule that no condition of the package gives',
        ],
      ],
      [
        'widen-to-everyone',
        [
          'layouts/Claim/metadata.layout.json: it shows cl:reserve to everyone, though Web UI shows it only while condition 1 passes',
        ],
      ],
      [
        'change-label',
        [
          'layouts/Claim/edit.layout.json: cl:number: the app shows "Claim number (changed)", where Web UI shows "Claim number"',
        ],
      ],
      [
        'wrong-page-provider',
        ['queues/claims.json: it asks the page provider "claims_other", where Web UI asks claims'],
      ],
      [
        'change-parameter',
        [
          'actions.json: acme-claims.approveClaim sends {"comment":"Approved in Web UIchanged"}, where Web UI sends {"comment":"Approved in Web UI"}',
        ],
      ],
      [
        'bind-other-operation',
        [
          'actions.json: acme-claims.approveClaim runs "Document.Delete", where Web UI\'s "approveClaim" runs Claim.Approve',
        ],
      ],
      [
        'unregistered-widget',
        [
          'app/layouts/Claim/view.layout.json cards[0].fields[0].widget: the widget "signature" is not registered',
        ],
      ],
      [
        'wrong-primary-token',
        [
          'acme: --mat-sys-primary is not set, though --nuxeo-primary-color sets it to #00796b',
          'acme: --mat-sys-secondary is set, but no property of the theme sets it',
        ],
      ],
      [
        'drop-report-entry',
        [
          expect.stringMatching(
            /^dropped: the view layout of Claim, in .*nuxeo-claim-view-layout\.html/,
          ),
          expect.stringMatching(/^coverage is 9\d\.\d%, not 100%$/),
        ],
      ],
    ])('%s', (name, expected) => {
      const mutation = MUTATIONS.find((m) => m.name === name);
      if (!mutation) throw new Error(name);
      expect(
        check(
          { ...input, conversion: mutation.apply(input.conversion).conversion },
          mutation.caughtBy,
        )?.findings,
      ).toEqual(expected);
    });
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

  it('reads an id the report lists twice by its first entry for what stands in the way', () => {
    const input = prepare();
    const { constructs } = input.conversion.report;
    const converted = constructs.find((entry) => entry.outcome === 'converted');
    if (!converted) throw new Error('the made-up package converts');
    const twice = {
      ...input,
      conversion: {
        ...input.conversion,
        report: {
          ...input.conversion.report,
          constructs: [
            ...constructs,
            { ...converted, outcome: 'pending' as const, note: 'Later' },
            { ...converted, outcome: 'proposed' as const, note: 'Later' },
          ],
        },
      },
    };
    const count = (blockers: readonly string[], pattern: RegExp) =>
      blockers.find((line) => pattern.test(line));
    const sound = runHarness(input).blockers;
    const listed = runHarness(twice).blockers;
    expect(count(listed, /constructs are pending/)).toBe(count(sound, /constructs are pending/));
    expect(count(listed, /proposals? waits?/)).toBe(count(sound, /proposals? waits?/));
  });

  it('stands in the way of a conversion made with another allow-list than the deployment gives', () => {
    const input = prepare();
    const line =
      "the conversion was made with the allow-list Claim.Approve, not the deployment's, Claim.Approve, Claim.Close: convert it again with the deployment's";
    expect(
      runHarness({ ...input, allowList: new Set(['Claim.Close', 'Claim.Approve']) }).blockers,
    ).toContain(line);
    expect(runHarness(input).blockers).not.toContain(line);
    // With no list given, the conversion's is all there is: check 10 says it ran in part.
    const { allowList: _given, ...recorded } = input;
    expect(
      runHarness(recorded).blockers.filter((blocker) =>
        blocker.startsWith('the conversion was made'),
      ),
    ).toEqual([]);
  });

  it('fails a report of another version of the package, or of another Studio build of it', () => {
    const input = prepare();
    const { report } = input.conversion;
    const of = (change: Partial<typeof report>) =>
      check({ ...input, conversion: { ...input.conversion, report: { ...report, ...change } } }, 1)
        ?.findings;
    expect(of({ package: { ...report.package, name: 'Other-Project' } })).toEqual([
      'the report is of Other-Project 1.0.0, not of the package given, Acme-Claims 1.0.0',
    ]);
    expect(of({ studio: { ...report.studio, commit: 'abc123' } })).toEqual([
      "the report records Studio's commit abc123 and no build time, and the package's manifest no commit and no build time",
    ]);
    expect(of({ studio: { ...report.studio, buildTime: '2026-11-20T10:00:00Z' } })).toEqual([
      "the report records Studio's no commit and build time 2026-11-20T10:00:00Z, and the package's manifest no commit and no build time",
    ]);
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
