import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalogue } from './catalogue';
import {
  convert,
  packageBuildOf,
  readConversion,
  writeConversion,
  type Conversion,
  type MigrationReport,
  type ReportEntry,
} from './convert';
import { constructsOf, identitiesOf, sharedIdentities } from './constructs';
import {
  DECISIONS_FILE,
  DECISIONS_FORMAT,
  DecisionsError,
  decisionsFor,
  holdDecisions,
  type DecisionsBuild,
  type DecisionsFile,
} from './decisions';
import { runHarness, type HarnessInput } from './harness';
import { inventory } from './inventory';
import { DECISION_MUTATIONS, MutationError } from './mutations';
import { readStudioPackage } from './studio-package';
import { m2CorpusFiles } from './testing/m2-corpus';
import { syntheticPackage, type SyntheticPackageOptions } from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const catalogue = loadCatalogue();
const ALLOW_LIST: ReadonlySet<string> = new Set(['Claim.Approve']);

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

type Json = Record<string, unknown>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The build of the made-up package, which decisions are held to. */
const BUILD: DecisionsBuild = packageBuildOf(readStudioPackage(syntheticPackage()));

/** The identities of the made-up package's constructs, and of those it holds more than once. */
const PLAIN = prepare();
const IDS = identitiesOf(PLAIN.inventory);
const SHARED = sharedIdentities(constructsOf(PLAIN.inventory));
/** The same of the made-up package with M2's corpus. */
const CORPUS_INPUT = prepare({ bundle: m2CorpusFiles() });
const CORPUS_IDS = identitiesOf(CORPUS_INPUT.inventory);

/** `decisionsFor`, for the made-up package unless told otherwise. */
const carry = (
  report: MigrationReport,
  build: DecisionsBuild,
  earlier?: { readonly raw: unknown; readonly file: string },
  ids: ReadonlyMap<string, string> = IDS,
  shared: ReadonlySet<string> = SHARED,
): ReturnType<typeof decisionsFor> => decisionsFor(report, build, ids, shared, earlier);
/** `holdDecisions`, for the made-up package unless told otherwise. */
const hold = (
  report: MigrationReport,
  raw: unknown,
  build: DecisionsBuild,
  ids: ReadonlyMap<string, string> = IDS,
): ReturnType<typeof holdDecisions> => holdDecisions(report, raw, build, ids);

/** The conversion's decisions file, with every reported item owned and decided. */
function decidedFile(
  conversion: Conversion,
  build: DecisionsBuild = BUILD,
  ids: ReadonlyMap<string, string> = IDS,
): DecisionsFile {
  const { file } = carry(conversion.report, build, undefined, ids);
  return {
    ...file,
    decisions: file.decisions.map((item) =>
      item.outcome === 'proposed'
        ? {
            ...item,
            owner: 'Dana Reviewer',
            decision: 'accept',
            reason: 'The host has the function',
          }
        : { ...item, owner: 'Migration lead', decision: `Kept as reported: ${item.label}` },
    ),
  };
}

/**
 * The made-up package's input with every item decided, and the conversion made with those
 * decisions, as `migrate --from` makes it: what the proposals' acceptance writes is written.
 */
function decidedInput(
  given: HarnessInput,
  build: DecisionsBuild = BUILD,
  ids: ReadonlyMap<string, string> = IDS,
): HarnessInput {
  const decisions = decidedFile(given.conversion, build, ids);
  const { verdicts } = hold(given.conversion.report, decisions, build, ids);
  const conversion = convert(given.pkg, given.inventory, catalogue, {
    allowList: ALLOW_LIST,
    verdicts,
  });
  return { ...given, conversion: { ...conversion, decisions } };
}

/** The decisions file as data, with one change made to it. */
function changed(
  conversion: Conversion,
  change: (file: Json, items: Json[]) => void,
  build: DecisionsBuild = BUILD,
  ids: ReadonlyMap<string, string> = IDS,
): unknown {
  const file = clone(decidedFile(conversion, build, ids)) as unknown as Json;
  change(file, file['decisions'] as Json[]);
  return file;
}

const reportedIn = (conversion: Conversion): ReportEntry[] =>
  conversion.report.constructs.filter((entry) => entry.outcome === 'reported');

const withEntry = (
  conversion: Conversion,
  id: string,
  change: Partial<ReportEntry>,
): Conversion => ({
  ...conversion,
  report: {
    ...conversion.report,
    constructs: conversion.report.constructs.map((entry) =>
      entry.id === id ? { ...entry, ...change } : entry,
    ),
  },
});

describe('the decisions file the `decisions` command writes', () => {
  const { conversion } = prepare();
  const reported = reportedIn(conversion);
  const { file, carried, notCarried } = carry(conversion.report, BUILD);

  it('names the package, at its version, in the format the harness reads', () => {
    expect(file.format).toBe(DECISIONS_FORMAT);
    expect(file.package).toEqual({
      name: 'Acme-Claims',
      version: '1.0.0',
      commit: null,
      buildTime: null,
      bundle: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(file.package).toEqual(BUILD);
    expect([carried, notCarried]).toEqual([0, []]);
  });

  it('has an entry for every reported item and every proposal that takes a decision, once each, in the report’s order, and for nothing else', () => {
    expect(reported.length).toBeGreaterThan(10);
    const proposals = conversion.report.constructs.filter(
      (entry) => entry.outcome === 'proposed' && entry.proposal === true,
    );
    expect(proposals.map((entry) => entry.id)).toEqual([
      `condition:${UI}/document/claim/nuxeo-claim-view-layout.html#2`,
    ]);
    const decided = new Set([...reported, ...proposals].map((entry) => entry.id));
    expect(file.decisions.map((item) => item.id)).toEqual(
      conversion.report.constructs
        .filter((entry) => decided.has(entry.id))
        .map((entry) => entry.id),
    );
    // The field the condition guards is proposed with it, and takes no decision of its own.
    expect(
      conversion.report.constructs.find(
        (entry) => entry.id === `layout-field:${UI}/document/claim/nuxeo-claim-view-layout.html#5`,
      ),
    ).toMatchObject({ outcome: 'proposed', note: expect.stringMatching(/whose rule is proposed/) });
    expect(file.decisions.map((item) => item.id)).not.toContain(
      `layout-field:${UI}/document/claim/nuxeo-claim-view-layout.html#5`,
    );
  });

  it('copies what each was made on from the report, and its construct’s identity, and leaves the rest to a person', () => {
    const edit = file.decisions.find(
      (item) => item.id === `layout-field:${UI}/document/claim/nuxeo-claim-metadata-layout.html#4`,
    );
    expect(edit).toEqual({
      id: `layout-field:${UI}/document/claim/nuxeo-claim-metadata-layout.html#4`,
      identity: IDS.get(`layout-field:${UI}/document/claim/nuxeo-claim-metadata-layout.html#4`),
      label: 'cl:adjuster ("Adjuster")',
      property: 'cl:adjuster',
      outcome: 'reported',
      to: 'layouts/Claim/metadata.layout.json',
      note: expect.stringMatching(/version 1 cannot name the user widget/),
      owner: '',
      decision: '',
    });
    expect(edit?.identity).toMatch(/^layout-field:[0-9a-f]{16}$/);
    // Its keys in the order a person reads them: the item, what it was made on, then theirs.
    expect(Object.keys(edit ?? {})).toEqual([
      'id',
      'identity',
      'label',
      'property',
      'outcome',
      'to',
      'note',
      'owner',
      'decision',
    ]);
    // A proposal's: who decides it, accept or reject, and why.
    const proposal = file.decisions.find((item) => item.outcome === 'proposed');
    expect(proposal).toMatchObject({
      outcome: 'proposed',
      rule: { type: 'app.rules.hasFacet', parameters: ['Versionable'] },
      owner: '',
      decision: '',
      reason: '',
    });
    expect(Object.keys(proposal ?? {})).toEqual([
      'id',
      'identity',
      'label',
      'outcome',
      'note',
      'rule',
      'owner',
      'decision',
      'reason',
    ]);
  });

  it('lists an item the report lists twice once', () => {
    const [first] = reported;
    const twice = {
      ...conversion.report,
      constructs: [...conversion.report.constructs, first],
    };
    expect(carry(twice, BUILD).file.decisions.filter((item) => item.id === first.id)).toHaveLength(
      1,
    );
  });

  it('reads an item the report lists twice by its first entry, as readiness and the report do', () => {
    const converted = conversion.report.constructs.find((entry) => entry.outcome === 'converted');
    if (!converted) throw new Error('the made-up package converts');
    const later = { ...converted, outcome: 'reported' as const, note: 'A later entry' };
    const twice = { ...conversion.report, constructs: [...conversion.report.constructs, later] };
    expect(carry(twice, BUILD).file.decisions.map((item) => item.id)).not.toContain(converted.id);
    expect(hold(twice, undefined, BUILD).unowned).toBe(reported.length);
  });

  it('is taken as it is, and leaves every reported item without an owner', () => {
    expect(hold(conversion.report, clone(file), BUILD)).toMatchObject({
      findings: [],
      unowned: reported.length,
      undecided: 0,
    });
  });
});

describe('carrying the decisions of an earlier conversion', () => {
  const { conversion } = prepare();
  const [first, second] = reportedIn(conversion);

  it('carries each that still holds, offers one made on something else again, and says which did not, and why', () => {
    const earlier = changed(conversion, (_file, items) => {
      for (const item of items) if (item['id'] === second.id) item['note'] = 'An earlier reason';
      items.push({ id: 'file:gone.html#file', outcome: 'reported', owner: 'x', decision: 'y' });
    });
    const { file, carried, notCarried, reconfirm } = carry(conversion.report, BUILD, {
      raw: earlier,
      file: 'old.json',
    });
    // Every decided item but the one whose reason changed: the reported ones and the proposal.
    expect(carried).toBe(file.decisions.length - 1);
    expect(reconfirm).toBe(1);
    expect(notCarried).toEqual([
      `old.json: ${second.id} was made on another reason than the report gives now, so it is offered for re-confirmation, beside it`,
      'old.json: file:gone.html#file is not in the report',
    ]);
    const byId = new Map(file.decisions.map((item) => [item.id, item]));
    expect(byId.get(first.id)).toMatchObject({
      owner: 'Migration lead',
      decision: expect.stringMatching(/^Kept as reported/),
    });
    // Not carried: blank again, with the reason the report gives now, and the earlier beside it.
    expect(byId.get(second.id)).toMatchObject({
      owner: '',
      decision: '',
      note: second.note,
      earlier: {
        bundle: BUILD.bundle,
        owner: 'Migration lead',
        madeOn: { note: 'An earlier reason' },
        changed: ['reason'],
      },
    });
    // Offered, it is not taken until a person decides it.
    expect(hold(conversion.report, file, BUILD).unowned).toBe(1);
  });

  it('passes over an earlier entry that says nothing, and counts what is left to fill in', () => {
    const earlier = changed(conversion, (_file, items) => {
      // Blank, and on an item the report no longer gives as it was: nothing to carry, or to lose.
      items[0]['owner'] = '';
      items[0]['decision'] = ' ';
      items[0]['note'] = 'An earlier reason';
      items.push({ ...items[1], owner: '', decision: '' });
      items[2]['decision'] = '';
    });
    const result = carry(conversion.report, BUILD, { raw: earlier, file: 'old.json' });
    expect(result.notCarried).toEqual([]);
    expect(result.carried).toBe(result.file.decisions.length - 1);
    expect(result.blank).toBe(2);
    expect(carry(conversion.report, BUILD).blank).toBe(result.file.decisions.length);
  });

  it('carries the decisions of another version, Studio build or bundle by each construct’s identity, and never by place', () => {
    for (const change of [
      { version: '0.9.0' },
      { commit: 'abc123' },
      { buildTime: '2026-11-20T10:00:00Z' },
    ]) {
      const earlier = changed(conversion, (file) => {
        file['package'] = { ...(file['package'] as Json), ...change };
      });
      const result = carry(conversion.report, BUILD, { raw: earlier, file: 'old.json' });
      expect(result.carried).toBe(result.file.decisions.length);
      expect(result.otherBuild).toMatch(/^Acme-Claims /);
      expect(result.file.carriedFrom).toMatchObject({
        package: { ...BUILD, ...change },
        reconfirm: [],
        dropped: [],
      });
    }
    // A decision whose item now holds another construct, by place, is not carried to it: it is
    // carried to the construct of its identity, wherever that sits.
    const moved = changed(conversion, (file, items) => {
      file['package'] = { ...(file['package'] as Json), version: '0.9.0' };
      const [a, b] = [items[0], items[1]];
      items[0] = { ...a, identity: b['identity'], owner: 'Owner of b', decision: 'b' };
      items[1] = { ...b, identity: a['identity'], owner: 'Owner of a', decision: 'a' };
    });
    const result = carry(conversion.report, BUILD, { raw: moved, file: 'old.json' });
    const byId = new Map(result.file.decisions.map((item) => [item.id, item]));
    // Each was made on the other's label and reason, so each is offered, not carried.
    expect(byId.get(first.id)).toMatchObject({ owner: '', earlier: { owner: 'Owner of a' } });
    expect(byId.get(second.id)).toMatchObject({ owner: '', earlier: { owner: 'Owner of b' } });
  });

  it('drops a decision of another build whose construct is gone, or cannot be told apart, and says so', () => {
    const earlier = changed(conversion, (file, items) => {
      file['package'] = { ...(file['package'] as Json), version: '0.9.0' };
      items[0]['identity'] = 'layout-field:0000000000000000';
      delete items[1]['identity'];
      items.push({ ...items[2] });
    });
    // A construct this build holds more than once, as if two of its kind were alike.
    const alike = reportedIn(conversion)[5];
    const shared = new Set([IDS.get(alike.id) as string]);
    const result = carry(conversion.report, BUILD, { raw: earlier, file: 'old.json' }, IDS, shared);
    const dropped = result.file.carriedFrom?.dropped ?? [];
    expect(dropped.map((item) => item.why).sort()).toEqual(
      [
        'is of a construct this build no longer holds, or no longer asks a decision of, so it is dropped',
        "names no construct's identity, so it is carried to no other build",
        'is one of 2 decisions of one construct, and which is meant cannot be told, so none is carried',
        'is one of 2 decisions of one construct, and which is meant cannot be told, so none is carried',
        'is of a construct this build holds more than once, alike, so which one it was made on cannot be told, and it is not carried: decide each again',
      ].sort(),
    );
    expect(dropped.find((item) => item.why.includes('more than once'))?.id).toBe(alike.id);
    expect(result.carried).toBe(result.file.decisions.length - 4);
    // Each is said, for the report: the earlier decision, and why it was dropped.
    expect(dropped[0]).toMatchObject({ owner: 'Migration lead', decision: expect.any(String) });
  });

  it('refuses a first-format file of another build, whose items are their places alone', () => {
    const earlier = changed(conversion, (file) => {
      file['format'] = 'studio-migration-decisions/1';
      file['package'] = { ...(file['package'] as Json), version: '0.9.0' };
    });
    expect(() => carry(conversion.report, BUILD, { raw: earlier, file: 'old.json' })).toThrow(
      /^old\.json is for Acme-Claims 0\.9\.0, bundle [0-9a-f]{12}, and the package given is Acme-Claims 1\.0\.0, bundle [0-9a-f]{12}, so none of it is taken: a studio-migration-decisions\/1 file names each item by its place alone/,
    );
    // Of the same build, a first-format file is carried by its items, as before.
    const same = changed(conversion, (file, items) => {
      file['format'] = 'studio-migration-decisions/1';
      for (const item of items) delete item['identity'];
    });
    expect(carry(conversion.report, BUILD, { raw: same, file: 'old.json' }).carried).toBe(
      reportedIn(conversion).length + 1,
    );
  });

  it('holds another build’s decisions to nothing, though it carries them', () => {
    // The made-up package with M2's corpus is another build of Acme-Claims 1.0.0, and neither
    // manifest records a commit or a build time: only the bundle tells them apart.
    const other = CORPUS_INPUT;
    const theirs = packageBuildOf(other.pkg);
    expect([theirs.name, theirs.version, theirs.commit, theirs.buildTime]).toEqual([
      BUILD.name,
      BUILD.version,
      null,
      null,
    ]);
    expect(theirs.bundle).not.toBe(BUILD.bundle);
    const earlier = clone(decidedFile(conversion));
    expect(hold(other.conversion.report, earlier, theirs, CORPUS_IDS).findings[0]).toMatch(
      /^decisions\.json is for .*so none of it is taken$/,
    );
    const shared = sharedIdentities(constructsOf(other.inventory));
    const carried = carry(
      other.conversion.report,
      theirs,
      { raw: earlier, file: 'old.json' },
      CORPUS_IDS,
      shared,
    );
    expect(carried.carried).toBeGreaterThan(10);
    expect(hold(other.conversion.report, carried.file, theirs, CORPUS_IDS).findings).toEqual([]);
  });

  it('refuses the decisions of another package, or a file that is not one', () => {
    const other = changed(conversion, (file) => {
      file['package'] = { name: 'Other-Project', version: '1.0.0' };
    });
    expect(() => carry(conversion.report, BUILD, { raw: other, file: 'old.json' })).toThrow(
      new DecisionsError(
        `old.json is for Other-Project 1.0.0, bundle none, and the package given is Acme-Claims 1.0.0, bundle ${BUILD.bundle.slice(0, 12)}, so none of it is taken`,
      ),
    );
    expect(() => carry(conversion.report, BUILD, { raw: [], file: 'old.json' })).toThrow(
      /^old\.json is not a studio-migration-decisions\/2 file/,
    );
  });
});

describe('holding the decisions to the report', () => {
  const { conversion } = prepare();
  const reported = reportedIn(conversion);
  const [first, second] = reported;
  const findings = (raw: unknown, report = conversion.report) => hold(report, raw, BUILD).findings;

  it('takes every decision of a file filled in, and leaves nothing unowned or undecided', () => {
    const held = hold(conversion.report, clone(decidedFile(conversion)), BUILD);
    expect(held).toMatchObject({ findings: [], unowned: 0, undecided: 0, waiting: 0, unsigned: 0 });
    // The reported items, and the proposal, accepted; the field it guards follows it.
    expect([...held.taken.keys()].sort()).toEqual(
      [
        ...reported.map((entry) => entry.id),
        `condition:${UI}/document/claim/nuxeo-claim-view-layout.html#2`,
      ].sort(),
    );
    expect([...held.verdicts]).toEqual([
      [
        `condition:${UI}/document/claim/nuxeo-claim-view-layout.html#2`,
        {
          accepted: true,
          rule: { type: 'app.rules.hasFacet', parameters: ['Versionable'] },
          owner: 'Dana Reviewer',
          reason: 'The host has the function',
        },
      ],
    ]);
  });

  it('counts an owner with nothing decided, a decision with no owner, and spaces as nothing', () => {
    const raw = changed(conversion, (_file, all) => {
      const items = all.filter((item) => item['outcome'] === 'reported');
      items[0]['decision'] = '';
      items[1]['owner'] = '';
      items[2]['owner'] = '   ';
      delete items[3]['owner'];
      delete items[4]['decision'];
      items[5]['decision'] = ' \n ';
    });
    expect(hold(conversion.report, raw, BUILD)).toMatchObject({
      findings: [],
      unowned: 3,
      undecided: 3,
    });
  });

  it('leaves every reported item unowned when the conversion has no decisions', () => {
    expect(hold(conversion.report, undefined, BUILD)).toMatchObject({
      findings: [],
      unowned: reported.length,
      undecided: 0,
    });
  });

  it('takes none of a file that is not one, is for another package or version, or holds no list', () => {
    const cases: [unknown, string][] = [
      [null, 'decisions.json is not a studio-migration-decisions/2 file, so none of it is taken'],
      [
        { ...decidedFile(conversion), format: 'studio-migration-decisions/0' },
        'decisions.json is not a studio-migration-decisions/2 file, so none of it is taken',
      ],
      [
        changed(conversion, (file) => {
          file['package'] = { name: 'Acme-Claims', version: '0.9.0' };
        }),
        `decisions.json is for Acme-Claims 0.9.0, bundle none, and the package given is Acme-Claims 1.0.0, bundle ${BUILD.bundle.slice(0, 12)}, so none of it is taken`,
      ],
      [
        changed(conversion, (file) => {
          delete file['package'];
        }),
        `decisions.json is for undefined undefined, bundle none, and the package given is Acme-Claims 1.0.0, bundle ${BUILD.bundle.slice(0, 12)}, so none of it is taken`,
      ],
      [
        changed(conversion, (file) => {
          file['decisions'] = {};
        }),
        'decisions.json holds no list of decisions, so none of it is taken',
      ],
    ];
    for (const [raw, finding] of cases) {
      expect(hold(conversion.report, raw, BUILD)).toMatchObject({
        findings: [finding],
        unowned: reported.length,
      });
    }
  });

  it('names a key the file does not take, and takes its decisions', () => {
    const raw = changed(conversion, (file) => {
      file['approvedBy'] = 'Migration lead';
    });
    expect(hold(conversion.report, raw, BUILD)).toMatchObject({
      findings: ['decisions.json holds approvedBy, which the file does not take'],
      unowned: 0,
    });
  });

  it('names a decision of no item, and takes the others', () => {
    const raw = changed(conversion, (_file, items) => {
      items.push('a note to self' as unknown as Json, { owner: 'x' }, { id: '' });
    });
    const held = hold(conversion.report, raw, BUILD);
    // After the reported items and the proposal.
    const at = reported.length + 1;
    expect(held.findings).toEqual([
      `decisions.json: decision ${at + 1} names no item`,
      `decisions.json: decision ${at + 2} names no item`,
      `decisions.json: decision ${at + 3} names no item`,
    ]);
    expect(held.unowned).toBe(0);
  });

  it('takes neither of two decisions of one item', () => {
    const raw = changed(conversion, (_file, items) => {
      items.push({ ...items[0], owner: 'Someone else' }, { ...items[0] });
    });
    const held = hold(conversion.report, raw, BUILD);
    expect(held.findings).toEqual([`decisions.json: ${first.id} is decided 3 times`]);
    expect(held.taken.has(first.id)).toBe(false);
    expect(held.unowned).toBe(1);
  });

  it('takes no decision that holds what a decision does not, such as a verdict on a proposal', () => {
    const raw = changed(conversion, (_file, items) => {
      items[0]['verdict'] = 'accepted';
    });
    expect(findings(raw)).toEqual([
      `decisions.json: ${first.id} holds verdict, which a decision does not take`,
    ]);
  });

  it('takes no decision of an item the report does not list', () => {
    const raw = changed(conversion, (_file, items) => {
      items.push({ ...items[0], id: 'file:elsewhere.html#file' });
    });
    expect(findings(raw)).toEqual([
      'decisions.json: file:elsewhere.html#file is not in the report',
    ]);
  });

  it('takes a decision of a reported item or a proposal only, and none of what a proposal guards', () => {
    const converted = conversion.report.constructs.find((entry) => entry.outcome === 'converted');
    // A field the proposed condition guards: proposed with it, and decided with it.
    const proposed = conversion.report.constructs.find(
      (entry) => entry.outcome === 'proposed' && entry.proposal !== true,
    );
    if (!converted || !proposed) throw new Error('the made-up package converts and proposes');
    const pinned = ({ id, label, property, outcome, to, note, rule }: ReportEntry) =>
      Object.fromEntries(
        Object.entries({ id, label, property, outcome, to, note, rule }).filter(
          ([, value]) => value !== undefined,
        ),
      );
    const raw = changed(conversion, (_file, items) => {
      items.push(
        { ...pinned(converted), owner: 'x', decision: 'y' },
        { ...pinned(proposed), owner: 'x', decision: 'y' },
      );
    });
    expect(findings(raw)).toEqual([
      `decisions.json: ${converted.id} is converted in the report, and only a reported item or a proposal takes a decision`,
      `decisions.json: ${proposed.id} is proposed only because the condition it shows under is, and takes no decision of its own: decide the condition's proposal, and it follows`,
    ]);
  });

  it('takes no decision made on another label, property, place, reason or rule than the report gives now', () => {
    const edit = `layout-field:${UI}/document/claim/nuxeo-claim-metadata-layout.html#4`;
    const cases: [Partial<ReportEntry>, string][] = [
      [{ label: 'cl:adjuster ("Handler")' }, 'label'],
      [{ property: 'cl:handler' }, 'property'],
      [{ to: 'layouts/Claim/create.layout.json' }, 'place it was written to'],
      [{ to: undefined }, 'place it was written to'],
      [{ note: `${first.note} (changed)` }, 'reason'],
      [{ rule: 'core.true' }, 'rule'],
      [{ label: 'cl:handler', note: 'Another reason' }, 'label and reason'],
    ];
    for (const [change, words] of cases) {
      const now = withEntry(conversion, edit, change).report;
      const held = hold(now, clone(decidedFile(conversion)), BUILD);
      expect(held.findings).toEqual([
        `decisions.json: ${edit} was made on another ${words} than the report gives now, so it is not taken: decide it again`,
      ]);
      expect(held.unowned).toBe(1);
    }
  });

  it('takes a decision made on a rule the report still gives, read back from its file', () => {
    const rule = {
      type: 'core.every',
      parameters: [{ type: 'app.rules.isType', parameters: ['Claim'] }],
    };
    const now = withEntry(conversion, first.id, { rule }).report;
    // As the file is read: parsed from its text, so its rule is another object of the same JSON.
    const raw = JSON.parse(JSON.stringify(carry(now, BUILD).file)) as Json;
    for (const item of raw['decisions'] as Json[]) {
      item['owner'] = 'Migration lead';
      item['decision'] = item['outcome'] === 'proposed' ? 'reject' : 'Kept';
      if (item['outcome'] === 'proposed') item['reason'] = 'Not needed';
    }
    expect(hold(now, raw, BUILD)).toMatchObject({
      findings: [],
      unowned: 0,
      undecided: 0,
    });
  });

  it('takes no decision missing what it was made on', () => {
    const raw = changed(conversion, (_file, items) => {
      delete items[0]['note'];
    });
    expect(findings(raw)).toEqual([
      `decisions.json: ${first.id} was made on another reason than the report gives now, so it is not taken: decide it again`,
    ]);
  });

  it('takes no decision whose owner or decision is not text', () => {
    const raw = changed(conversion, (_file, items) => {
      items[0]['owner'] = { team: 'claims' };
      items[1]['decision'] = 42;
    });
    expect(findings(raw)).toEqual([
      `decisions.json: ${first.id}: its owner is not text`,
      `decisions.json: ${second.id}: its decision is not text`,
    ]);
  });
});

describe('readiness and the decisions', () => {
  const input = prepare();
  const reported = reportedIn(input.conversion).length;
  const blockers = (decisions: unknown) =>
    runHarness({ ...input, conversion: { ...input.conversion, decisions } }).blockers;
  const ownerLines = (lines: readonly string[]) =>
    lines.filter((line) => /reported items? ha(s|ve)|^decisions\.json/.test(line));

  it('stands in the way while a reported item has no owner, as with no decisions at all', () => {
    expect(ownerLines(blockers(undefined))).toEqual([`${reported} reported items have no owner`]);
    expect(ownerLines(blockers(carry(input.conversion.report, BUILD).file))).toEqual([
      `${reported} reported items have no owner`,
    ]);
  });

  it('no longer, once each has an owner and a decision', () => {
    expect(ownerLines(blockers(decidedFile(input.conversion)))).toEqual([]);
  });

  it('says how many have an owner and nothing decided, and names what it did not take', () => {
    const raw = changed(input.conversion, (_file, items) => {
      items[0]['owner'] = '';
      items[1]['decision'] = '';
      items[2]['decision'] = '';
      items.push({ ...items[3], id: 'file:elsewhere.html#file' });
    });
    expect(ownerLines(blockers(raw))).toEqual([
      '1 reported item has no owner',
      '2 reported items have an owner but no decision',
      'decisions.json: file:elsewhere.html#file is not in the report',
    ]);
  });

  it('stands in the way of a file it takes none of, even with nothing reported left', () => {
    expect(ownerLines(blockers({ format: 'something else' }))).toEqual([
      `${reported} reported items have no owner`,
      'decisions.json is not a studio-migration-decisions/2 file, so none of it is taken',
    ]);
    // Nothing reported: no item lacks an owner, and the file is still in the way.
    const none = {
      ...input.conversion,
      report: {
        ...input.conversion.report,
        constructs: input.conversion.report.constructs.filter(
          (entry) => entry.outcome !== 'reported',
        ),
      },
      decisions: { format: 'something else' },
    };
    expect(ownerLines(runHarness({ ...input, conversion: none }).blockers)).toEqual([
      'decisions.json is not a studio-migration-decisions/2 file, so none of it is taken',
    ]);
  });

  it('takes none of the decisions of another build of the package, by the package given', () => {
    // Another build of Acme-Claims 1.0.0, its conversion with this build's decisions copied in.
    const other = CORPUS_INPUT;
    const decisions = decidedFile(other.conversion, BUILD, CORPUS_IDS);
    expect(decisions.package).toEqual(BUILD);
    const lines = ownerLines(
      runHarness({ ...other, conversion: { ...other.conversion, decisions } }).blockers,
    );
    expect(lines).toEqual([
      `${reportedIn(other.conversion).length} reported items have no owner`,
      expect.stringMatching(
        /^decisions\.json is for .*, and the package given is .*, so none of it is taken$/,
      ),
    ]);
  });

  it('takes a copied rule whatever the order of its keys, as an editor that sorts them leaves it', () => {
    const rule = { type: 'core.every', parameters: ['x'] };
    const id = reportedIn(input.conversion)[0].id;
    const now = withEntry(input.conversion, id, { rule }).report;
    const raw = JSON.parse(JSON.stringify(carry(now, BUILD).file)) as Json;
    const items = raw['decisions'] as Json[];
    items[0]['rule'] = { parameters: ['x'], type: 'core.every' };
    for (const item of items)
      Object.assign(
        item,
        item['outcome'] === 'proposed'
          ? { owner: 'Migration lead', decision: 'reject', reason: 'Not needed' }
          : { owner: 'Migration lead', decision: 'Kept' },
      );
    expect(hold(now, raw, BUILD)).toMatchObject({ findings: [], unowned: 0 });
    items[0]['rule'] = { parameters: ['y'], type: 'core.every' };
    expect(hold(now, raw, BUILD).unowned).toBe(1);
  });
});

describe('decisions.json in a conversion directory', () => {
  const directory = () => join(mkdtempSync(join(tmpdir(), 'studio-decisions-')), 'out');

  it('is never written by a conversion', () => {
    const out = directory();
    writeConversion(out, prepare().conversion);
    expect(existsSync(join(out, DECISIONS_FILE))).toBe(false);
    expect('decisions' in readConversion(out)).toBe(false);
  });

  it('is read back beside the report, and copied with the conversion', () => {
    const input = prepare();
    const decisions = decidedFile(input.conversion);
    const out = directory();
    writeConversion(out, { ...input.conversion, decisions });
    expect(JSON.parse(readFileSync(join(out, DECISIONS_FILE), 'utf8'))).toEqual(decisions);
    expect(readConversion(out).decisions).toEqual(decisions);
  });
});

// The negative controls of the decisions: each breaks one decision of a file filled in, and the
// verdict must then name it among what stands in the way.
describe('each deliberate breakage of the decisions stands in the way of readiness', () => {
  const corpus = CORPUS_INPUT;
  const CORPUS = packageBuildOf(corpus.pkg);
  const input: HarnessInput = decidedInput(corpus, CORPUS, CORPUS_IDS);
  const pristine = JSON.stringify(input.conversion);
  const sound = runHarness(input).blockers;

  it('has nothing of the decisions in the way of a file filled in', () => {
    expect(sound.filter((line) => /reported item|decisions\.json/.test(line))).toEqual([]);
  });

  for (const mutation of DECISION_MUTATIONS) {
    it(`${mutation.name}: ${mutation.description}`, () => {
      const broken = mutation.apply(input.conversion).conversion;
      expect(JSON.stringify(input.conversion)).toBe(pristine);
      const added = runHarness({ ...input, conversion: broken }).blockers.filter(
        (line) => !sound.includes(line),
      );
      expect(added.length).toBeGreaterThan(0);
      // `stale-decision` changes the report under its decision, as a newer converter would: the
      // report then says otherwise than this converter does, and readiness says that too.
      expect(
        added.every(
          (line) =>
            /reported item|decisions\.json/.test(line) ||
            (mutation.name === 'stale-decision' && line.startsWith('report.json says otherwise')),
        ),
      ).toBe(true);
    });
  }

  it('says so when the conversion has no decisions, or none filled in, to break', () => {
    const blank = {
      ...corpus.conversion,
      decisions: carry(corpus.conversion.report, CORPUS, undefined, CORPUS_IDS).file,
    };
    for (const mutation of DECISION_MUTATIONS) {
      expect(() => mutation.apply(corpus.conversion)).toThrow(MutationError);
      expect(() => mutation.apply(blank)).toThrow(
        /no decision of decisions\.json names an owner and what they decided/,
      );
    }
  });

  it('breaks a decision readiness takes, never one it already leaves aside', () => {
    // The first decision filled in is of an item the report does not list: breaking it would
    // change nothing readiness reads.
    const decisions = changed(
      input.conversion,
      (_file, items) => {
        items.unshift({ ...items[0], id: 'file:elsewhere.html#file' });
      },
      CORPUS,
      CORPUS_IDS,
    );
    const conversion = { ...input.conversion, decisions };
    const before = runHarness({ ...corpus, conversion }).blockers;
    const broken = DECISION_MUTATIONS.find((candidate) => candidate.name === 'drop-owner')?.apply(
      conversion,
    );
    expect(broken?.changed).toBe(`took the owner off ${reportedIn(corpus.conversion)[0].id}`);
    expect(
      runHarness({ ...corpus, conversion: broken?.conversion ?? conversion }).blockers.filter(
        (line) => !before.includes(line),
      ),
    ).toEqual(['1 reported item has no owner']);
  });

  describe('names what broke', () => {
    const plain = PLAIN;
    const filled = decidedInput(plain).conversion;
    const id = `layout-field:${UI}/document/claim/nuxeo-claim-metadata-layout.html#3`;
    const converted = plain.conversion.report.constructs.find(
      (entry) => entry.outcome === 'converted',
    )?.id;
    it.each<[string, readonly string[]]>([
      ['drop-owner', ['1 reported item has no owner']],
      ['drop-decision', ['1 reported item has an owner but no decision']],
      [
        'stale-decision',
        [
          '1 reported item has no owner',
          `decisions.json: ${id} was made on another reason than the report gives now, so it is not taken: decide it again`,
        ],
      ],
      ['decide-unlisted', [`decisions.json: ${id}-unlisted is not in the report`]],
      [
        'decide-converted',
        [
          `decisions.json: ${converted} is converted in the report, and only a reported item or a proposal takes a decision`,
        ],
      ],
      [
        'decide-twice',
        ['1 reported item has no owner', `decisions.json: ${id} is decided 2 times`],
      ],
    ])('%s', (name, expected) => {
      const mutation = DECISION_MUTATIONS.find((candidate) => candidate.name === name);
      if (!mutation) throw new Error(name);
      const blockers = runHarness({
        ...plain,
        conversion: mutation.apply(filled).conversion,
      }).blockers.filter((line) => /reported item|decisions\.json/.test(line));
      expect(blockers).toEqual(expected);
    });
  });
});
