import { loadCatalogue } from './catalogue';
import { reportSummary } from './cli';
import { constructsOf, identitiesOf } from './constructs';
import { convert, packageBuildOf, type Conversion, type ReportEntry } from './convert';
import { decisionsFor } from './decisions';
import { runHarness, type HarnessInput } from './harness';
import { inventory } from './inventory';
import { MUTATIONS } from './mutations';
import { summarise, TALLIES } from './report';
import { readStudioPackage } from './studio-package';
import { m2CorpusFiles } from './testing/m2-corpus';
import { syntheticPackage } from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const catalogue = loadCatalogue();
const ALLOW_LIST: ReadonlySet<string> = new Set(['Claim.Approve']);

function prepare(): HarnessInput {
  const pkg = readStudioPackage(syntheticPackage());
  const read = inventory(pkg);
  return {
    pkg,
    inventory: read,
    catalogue,
    allowList: ALLOW_LIST,
    conversion: convert(pkg, read, catalogue, { allowList: ALLOW_LIST }),
  };
}

/** The identities of the made-up package's constructs, which decisions copy. */
const IDS = identitiesOf(inventory(readStudioPackage(syntheticPackage())));

/** The conversion with each reported item but the first `left` owned and decided. */
function decided(conversion: Conversion, left = 0): Conversion {
  const { file } = decisionsFor(
    conversion.report,
    packageBuildOf(readStudioPackage(syntheticPackage())),
    IDS,
    new Set(),
  );
  let reported = 0;
  return {
    ...conversion,
    decisions: {
      ...file,
      decisions: file.decisions.map((item) =>
        item.outcome !== 'reported' || reported++ < left
          ? item
          : { ...item, owner: 'Migration lead', decision: 'Rebuilt by hand' },
      ),
    },
  };
}

const withConstructs = (input: HarnessInput, constructs: readonly ReportEntry[]): HarnessInput => ({
  ...input,
  conversion: { ...input.conversion, report: { ...input.conversion.report, constructs } },
});

describe('the report of a sound conversion', () => {
  const input = prepare();
  const entries = input.conversion.report.constructs;
  const constructs = constructsOf(input.inventory);
  const summary = summarise({ ...input, conversion: decided(input.conversion, 2) });

  it('heads it with the package, Studio’s build, the app, the converter and the allow-list', () => {
    expect(summary.header).toEqual({
      package: {
        name: 'Acme-Claims',
        version: '1.0.0',
        bundle: 'Acme-Claims-1.0.0.jar',
        targetPlatform: '[2025.0,2026)',
        targetPlatformName: 'lts',
      },
      studio: { branch: null, commit: null, buildTime: null },
      app: { id: 'acme-claims', platform: expect.stringMatching(/^>=\d+\.\d+\.\d+ <1\.0\.0$/) },
      converter: { name: '@nuxeo-satori/studio-migration', version: '0.0.0', phase: 'M1' },
      allowList: { operations: ['Claim.Approve'], from: 'deployment' },
    });
  });

  it('counts every construct of the package once, by kind, with the outcome the report gives it', () => {
    expect(summary.all.total).toBe(constructs.length);
    expect(summary.kinds.reduce((total, kind) => total + kind.total, 0)).toBe(constructs.length);
    for (const kind of [...summary.kinds, summary.all]) {
      expect(TALLIES.reduce((total, tally) => total + kind.tallies[tally], 0)).toBe(kind.total);
    }
    for (const outcome of [
      'converted',
      'proposed',
      'reported',
      'generated',
      'server',
      'pending',
    ] as const) {
      expect(summary.all.tallies[outcome]).toBe(
        entries.filter((entry) => entry.outcome === outcome).length,
      );
    }
    expect(summary.kinds.find((kind) => kind.kind === 'translation')).toMatchObject({
      total: 6,
      tallies: { converted: 6, missing: 0 },
    });
  });

  it('accounts for all of it, as check 1 does', () => {
    expect(summary.coverage).toEqual({
      accounted: constructs.length,
      constructs: constructs.length,
      percent: 100,
    });
    expect(summary.all.tallies.missing).toBe(0);
    expect(summary.checks.find((check) => check.number === 1)?.status).toBe('pass');
  });

  it('lists every reported item with its owner and decision, or none, and counts the decided', () => {
    const reported = entries.filter((entry) => entry.outcome === 'reported');
    expect(summary.reported.map((item) => item.id)).toEqual(reported.map((entry) => entry.id));
    expect(summary.reported.slice(0, 3).map(({ owner, decision }) => [owner, decision])).toEqual([
      [null, null],
      [null, null],
      ['Migration lead', 'Rebuilt by hand'],
    ]);
    expect(summary.all.decided).toBe(reported.length - 2);
    expect(summary.decisionFindings).toEqual([]);
    expect(summary.blockers).toContain('2 reported items have no owner');
  });

  it('counts as decided only an item whose owner says what they decided', () => {
    const conversion = decided(input.conversion);
    const raw = conversion.decisions as { decisions: Record<string, unknown>[] };
    raw.decisions[0]['decision'] = '';
    raw.decisions[1]['owner'] = ' ';
    const partly = summarise({ ...input, conversion });
    // Of the reported items, less the proposal the file holds too.
    expect(partly.all.decided).toBe(
      raw.decisions.filter((item) => item['outcome'] === 'reported').length - 2,
    );
    expect(partly.reported.slice(0, 2).map(({ owner, decision }) => [owner, decision])).toEqual([
      ['Migration lead', null],
      [null, 'Rebuilt by hand'],
    ]);
  });

  it('lists every proposal, which waits for a person', () => {
    expect(summary.proposed.map((item) => item.id)).toEqual(
      entries.filter((entry) => entry.outcome === 'proposed').map((entry) => entry.id),
    );
    expect(summary.blockers).toContain(
      `${summary.proposed.length} proposals wait for a person to accept or reject them`,
    );
  });

  it('says what each file of the package became', () => {
    expect(summary.files.map((file) => file.path)).toEqual(
      input.inventory.files.map((file) => file.path),
    );
    expect(summary.files.find((file) => file.path === 'data/i18n/messages-fr.json')).toEqual({
      path: 'data/i18n/messages-fr.json',
      kind: 'translations',
      tallies: { converted: 3 },
      became: ['app/labels/fr.json'],
      found: [],
    });
    expect(
      summary.files.find(
        (file) => file.path === `${UI}/document/claim/nuxeo-claim-edit-layout.html`,
      ),
    ).toMatchObject({ tallies: { converted: 3, reported: 1, generated: 1 } });
  });

  it('says a file became only where its constructs were converted, not where one was reported', () => {
    const fr = 'data/i18n/messages-fr.json';
    let changed = false;
    const constructs = entries.map((entry) => {
      if (changed || entry.file !== fr) return entry;
      changed = true;
      return { ...entry, outcome: 'reported' as const, note: 'Left out', to: 'somewhere else' };
    });
    expect(
      summarise(withConstructs(input, constructs)).files.find((file) => file.path === fr),
    ).toMatchObject({ tallies: { converted: 2, reported: 1 }, became: ['app/labels/fr.json'] });
  });

  it('heads it with the package handed in, and the allow-list the conversion recorded when given none', () => {
    const { allowList: _given, ...recorded } = input;
    const bumped = {
      ...recorded,
      conversion: {
        ...input.conversion,
        report: {
          ...input.conversion.report,
          package: { ...input.conversion.report.package, version: '0.9.0' },
        },
      },
    };
    const header = summarise(bumped);
    expect(header.header.package.version).toBe('1.0.0');
    expect(header.header.allowList).toEqual({ operations: ['Claim.Approve'], from: 'conversion' });
    expect(header.checks[0].findings).toContain(
      'the report is of Acme-Claims 0.9.0, not of the package given, Acme-Claims 1.0.0',
    );
    expect(reportSummary(header)).toContain(
      "Allow-list: Claim.Approve, as the conversion recorded it, not the deployment's word for it\n",
    );
  });

  it('gives the harness’s own findings and verdict', () => {
    const result = runHarness({ ...input, conversion: decided(input.conversion, 2) });
    expect(summary.checks).toEqual(result.checks);
    expect(summary.blockers).toEqual(result.blockers);
    expect(summary.ready).toBe(false);
  });
});

describe('the report of a conversion that misses something', () => {
  const input = prepare();
  const entries = input.conversion.report.constructs;

  it('counts a construct the report leaves out as missing, and its coverage short of 100%', () => {
    const drop = MUTATIONS.find((mutation) => mutation.name === 'drop-report-entry');
    if (!drop) throw new Error('drop-report-entry');
    const broken = { ...input, conversion: drop.apply(input.conversion).conversion };
    const summary = summarise(broken);
    const constructs = constructsOf(input.inventory).length;
    expect(summary.all.tallies.missing).toBe(1);
    expect(summary.kinds.find((kind) => kind.kind === 'layout')?.tallies.missing).toBe(1);
    expect(summary.coverage).toEqual({
      accounted: constructs - 1,
      constructs,
      percent: Math.floor(((constructs - 1) / constructs) * 1000) / 10,
    });
    expect(summary.coverage.percent).toBeLessThan(100);
  });

  it('counts an outcome that is none apart, and an item listed twice by its first entry', () => {
    const [first, second] = entries;
    const summary = summarise(
      withConstructs(input, [
        { ...first, outcome: 'kept' as ReportEntry['outcome'] },
        ...entries.slice(1),
        { ...second, outcome: 'reported', note: 'A second entry' },
        { ...second, outcome: 'proposed', note: 'A third entry' },
      ]),
    );
    expect(summary.proposed.some((item) => item.note === 'A third entry')).toBe(false);
    expect(summary.all.tallies['not an outcome']).toBe(1);
    expect(summary.all.tallies[second.outcome]).toBe(
      entries.filter((entry) => entry.outcome === second.outcome).length -
        (first.outcome === second.outcome ? 1 : 0),
    );
    expect(summary.reported.some((item) => item.note === 'A second entry')).toBe(false);
    expect(summary.checks.find((check) => check.number === 1)?.status).toBe('fail');
  });
});

describe('the report as text', () => {
  const input = prepare();
  const text = reportSummary(summarise({ ...input, conversion: decided(input.conversion, 1) }));

  it('heads it, and counts the constructs in a table with the decided and the missing', () => {
    expect(text).toMatch(/^Migration report: Acme-Claims 1\.0\.0\n/);
    expect(text).toContain(
      'Package: Acme-Claims 1.0.0, for [2025.0,2026) (lts); its bundle Acme-Claims-1.0.0.jar',
    );
    expect(text).toContain(
      'Studio: branch not recorded, commit not recorded, built at a time not recorded',
    );
    expect(text).toContain("Allow-list: Claim.Approve, the deployment's, as given\n");
    expect(text).toMatch(
      /\n {2}kind +total +converted +proposed +accepted +rejected +reported +decided +generated +server +pending +missing\n/,
    );
    expect(text).toMatch(/\n {2}translation +6 +6 +0 +0 +0 +0 +0 +0 +0 +0 +0\n/);
    expect(text).not.toContain('not an outcome');
    expect(text).toMatch(/\nCoverage: 100%, (\d+) of the package's \1 constructs in the report\n/);
  });

  it('gives the checks and the verdict, then every reported item with its owner', () => {
    expect(text).toMatch(/\n {3}1 {2}Nothing dropped +pass\n/);
    expect(text).toContain('\n  Verdict: not ready\n');
    expect(text).toContain('    - 1 reported item has no owner\n');
    expect(text).toMatch(/\nDecisions needed: (\d+) reported items, \d+ of them decided\n/);
    expect(text).toContain(
      `  - cl:adjuster ("Adjuster"), in ${UI}/document/claim/nuxeo-claim-edit-layout.html\n` +
        `      id: layout-field:${UI}/document/claim/nuxeo-claim-edit-layout.html#3\n`,
    );
    expect(text).toContain(
      '      written to: layouts/Claim/edit.layout.json\n      owner: none; decided: nothing yet\n',
    );
    expect(text).toContain('      owner: Migration lead; decided: Rebuilt by hand\n');
    expect(text).toMatch(
      /\nProposals: 2: 0 accepted, 0 rejected, 1 waiting for a person to accept or reject them, and 1 decided with the condition each shows under\n/,
    );
    expect(text).toContain(
      '  data/i18n/messages-fr.json (translations): converted 3\n      became: app/labels/fr.json\n',
    );
  });

  it('writes what people and the package wrote on one line each, so no line can be forged', () => {
    const conversion = decided(input.conversion);
    const raw = conversion.decisions as { decisions: Record<string, unknown>[] };
    raw.decisions[0]['decision'] =
      'Rebuilt\n  - the search form of claims, in x\n      owner: Lead; decided: Rebuilt\u0007';
    const text = reportSummary(summarise({ ...input, conversion }));
    expect(text).toContain(
      '      owner: Migration lead; decided: Rebuilt\\n  - the search form of claims, in x\\n      owner: Lead; decided: Rebuilt\\u0007\n',
    );
    expect(text).not.toContain('\n  - the search form of claims, in x\n');
  });

  it('heads it with the package’s own build, bundle and platform, whatever the report says', () => {
    const report = input.conversion.report;
    const other = {
      ...input,
      conversion: {
        ...input.conversion,
        report: {
          ...report,
          package: { ...report.package, bundle: 'other.jar', targetPlatform: '[2027.0,2028)' },
          studio: { branch: 'b', commit: 'c', buildTime: 't' },
        },
      },
    };
    expect(summarise(other).header).toMatchObject({
      package: { bundle: 'Acme-Claims-1.0.0.jar', targetPlatform: '[2025.0,2026)' },
      studio: { branch: null, commit: null, buildTime: null },
    });
  });

  it('counts no decision made for another build of the package as decided', () => {
    const other = readStudioPackage(syntheticPackage({ bundle: m2CorpusFiles() }));
    const otherInput = { ...input, pkg: other, inventory: inventory(other) };
    const summary = summarise({ ...otherInput, conversion: decided(input.conversion) });
    expect(summary.all.decided).toBe(0);
    expect(summary.reported.every((item) => item.owner === null)).toBe(true);
    expect(summary.decisionFindings).toEqual([
      expect.stringMatching(/^decisions\.json is for .*so none of it is taken$/),
    ]);
  });

  it('shows what an item’s decision says even where it names no owner', () => {
    const conversion = decided(input.conversion);
    const raw = conversion.decisions as { decisions: Record<string, unknown>[] };
    raw.decisions[0]['owner'] = '';
    expect(reportSummary(summarise({ ...input, conversion }))).toContain(
      '      written to: layouts/Claim/edit.layout.json\n      owner: none; decided: Rebuilt by hand\n',
    );
  });

  it('names what it did not take from decisions.json', () => {
    const conversion = decided(input.conversion);
    const raw = conversion.decisions as { decisions: Record<string, unknown>[] };
    raw.decisions.push({ ...raw.decisions[0], id: 'file:elsewhere.html#file' });
    expect(reportSummary(summarise({ ...input, conversion }))).toContain(
      '  Not taken from decisions.json:\n    - decisions.json: file:elsewhere.html#file is not in the report\n',
    );
  });

  it('adds a column for an outcome that is none, and says when there is no proposal', () => {
    const entries = input.conversion.report.constructs.map((entry) =>
      entry.outcome === 'proposed'
        ? { ...entry, outcome: 'kept' as ReportEntry['outcome'] }
        : entry,
    );
    const odd = reportSummary(summarise(withConstructs(input, entries)));
    expect(odd).toMatch(/ pending +not an outcome +missing\n/);
    expect(odd).toContain('\nProposals: none\n');
  });
});
