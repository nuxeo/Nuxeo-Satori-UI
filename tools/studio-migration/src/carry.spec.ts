/**
 * Carrying decisions to a new build of the package (docs/business-apps/studio-migration.md,
 * section 8): a construct has an identity beyond its place in its file, a fingerprint of its kind,
 * its file and what it is there, the same in every build where it is unchanged. A decision carries
 * to the construct of its identity when what it was made on is unchanged; it is offered for
 * re-confirmation when that changed, and dropped when the construct is gone; never carried to
 * another construct. Its controls, `CARRY_MUTATIONS`, are seen failing.
 */
import { loadCatalogue } from './catalogue';
import {
  constructsOf,
  identitiesOf,
  identityOf,
  sharedIdentities,
  type Construct,
} from './constructs';
import { convertWithDecisions, packageBuildOf } from './convert';
import { decisionsFor, holdDecisions, type DecisionsFile } from './decisions';
import { runHarness, type HarnessInput } from './harness';
import { inventory } from './inventory';
import { CARRY_MUTATIONS, MutationError } from './mutations';
import { summarise } from './report';
import { readStudioPackage } from './studio-package';
import { syntheticBundleFiles, syntheticPackage } from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const catalogue = loadCatalogue();
const ALLOW_LIST: ReadonlySet<string> = new Set(['Claim.Approve']);
const FILES = syntheticBundleFiles();
const EDIT = `${UI}/document/claim/nuxeo-claim-edit-layout.html`;
const VIEW = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
const FORM = `${UI}/search/claims/nuxeo-claims-search-form.html`;
const THEME = `${UI}/themes/acme/theme.html`;

/**
 * A new build of the made-up package: a field added at the top of its edit layout, so that every
 * field after it has another place; a search field relabelled; a theme property removed, so the
 * one after it moves up; and the view layout's `dom-if` testing another facet.
 */
const NEW_BUILD: Readonly<Record<string, string>> = {
  'META-INF/MANIFEST.MF':
    'Manifest-Version: 1.0\nBundle-SymbolicName: studio.extensions.Acme-Claims\nStudio-Git-Commit-Hash: 2b1f\n',
  [EDIT]: (FILES[EDIT] ?? '').replace(
    '<template>\n',
    '<template>\n    <nuxeo-input role="widget" value="{{document.properties.dc:title}}" label="Title"></nuxeo-input>\n',
  ),
  [FORM]: (FILES[FORM] ?? '').replace('label="Status"', 'label="Claim status"'),
  [THEME]: (FILES[THEME] ?? '').replace(
    '      --paper-input-container: { color: #1d1d1f; };\n',
    '',
  ),
  [VIEW]: (FILES[VIEW] ?? '').replace(
    "hasFacet(document, 'Versionable')",
    "hasFacet(document, 'Folderish')",
  ),
};

function prepare(bundle?: Record<string, string>): HarnessInput {
  const pkg = readStudioPackage(syntheticPackage(bundle ? { bundle } : {}));
  const read = inventory(pkg);
  return {
    pkg,
    inventory: read,
    catalogue,
    allowList: ALLOW_LIST,
    conversion: convertWithDecisions(pkg, read, catalogue, { allowList: ALLOW_LIST }),
  };
}

/** The decisions of a conversion, every one filled in by name, so each can be followed. */
function filled(input: HarnessInput): DecisionsFile {
  const constructs = constructsOf(input.inventory);
  const { file } = decisionsFor(
    input.conversion.report,
    packageBuildOf(input.pkg),
    identitiesOf(input.inventory),
    sharedIdentities(constructs),
  );
  return {
    ...file,
    decisions: file.decisions.map((item) =>
      item.outcome === 'proposed'
        ? { ...item, owner: 'Dana Reviewer', decision: 'accept', reason: `For ${item.label}` }
        : { ...item, owner: 'Migration lead', decision: `Decided on ${item.label}` },
    ),
  };
}

/** `migrate --from` an earlier build's decisions: converted with them, and carried beside. */
function carriedTo(input: HarnessInput, earlier: DecisionsFile) {
  const raw = { raw: JSON.parse(JSON.stringify(earlier)) as unknown, file: 'earlier.json' };
  const conversion = convertWithDecisions(
    input.pkg,
    input.inventory,
    catalogue,
    { allowList: ALLOW_LIST },
    raw,
  );
  const carried = decisionsFor(
    conversion.report,
    packageBuildOf(input.pkg),
    identitiesOf(input.inventory),
    sharedIdentities(constructsOf(input.inventory)),
    raw,
  );
  return {
    ...carried,
    input: { ...input, conversion: { ...conversion, decisions: carried.file } },
  };
}

const byLabel = (constructs: readonly Construct[], file: string, property: string) =>
  constructs.find((construct) => construct.file === file && construct.property === property);

describe("a construct's identity", () => {
  const before = constructsOf(prepare().inventory);
  const after = constructsOf(prepare(NEW_BUILD).inventory);

  it('is a fingerprint of its kind, its file and what it is there, not of its place', () => {
    expect(identityOf('layout-field', EDIT, ['nuxeo-input', 'cl:number', null])).toMatch(
      /^layout-field:[0-9a-f]{16}$/,
    );
    expect(identityOf('layout-field', EDIT, ['a'])).not.toBe(
      identityOf('layout-field', VIEW, ['a']),
    );
    expect(identityOf('layout-field', EDIT, ['a'])).not.toBe(identityOf('task-field', EDIT, ['a']));
    expect(identityOf('layout-field', EDIT, ['a'])).not.toBe(
      identityOf('layout-field', EDIT, ['b']),
    );
    // The adjuster field moved from the third place to the fourth: another id, the same identity.
    const adjuster = [byLabel(before, EDIT, 'cl:adjuster'), byLabel(after, EDIT, 'cl:adjuster')];
    expect(adjuster.map((construct) => construct?.id)).toEqual([
      `layout-field:${EDIT}#3`,
      `layout-field:${EDIT}#4`,
    ]);
    expect(adjuster[0]?.identity).toBe(adjuster[1]?.identity);
    // What holds its old place now is another construct, of another identity.
    expect(after.find((construct) => construct.id === `layout-field:${EDIT}#3`)?.identity).not.toBe(
      adjuster[0]?.identity,
    );
  });

  it('is the same for every construct a build left unchanged', () => {
    const changed = new Set([EDIT, FORM, THEME, VIEW, 'META-INF/MANIFEST.MF']);
    const kept = before.filter((construct) => !changed.has(construct.file));
    const identities = new Set(after.map((construct) => construct.identity));
    expect(kept.length).toBeGreaterThan(20);
    expect(kept.filter((construct) => !identities.has(construct.identity))).toEqual([]);
  });

  it('is shared by constructs a build cannot tell apart, and only by those', () => {
    const shared = sharedIdentities(before);
    // The dashboard's repeated card is told from the card it repeats.
    expect(
      before
        .filter((construct) => construct.kind === 'dashboard-card')
        .map((construct) => shared.has(construct.identity)),
    ).toEqual([false, false, false]);
    const twice = constructsOf(
      prepare({
        [EDIT]: (FILES[EDIT] ?? '').replace(
          '</template>',
          '  <nuxeo-input role="widget" value="{{document.properties.cl:number}}" label="Again"></nuxeo-input>\n  </template>',
        ),
      }).inventory,
    );
    const numbers = twice.filter(
      (construct) => construct.file === EDIT && construct.property === 'cl:number',
    );
    expect(numbers).toHaveLength(2);
    expect(numbers.every((construct) => sharedIdentities(twice).has(construct.identity))).toBe(
      true,
    );
  });
});

describe('carrying decisions to a new build of the package', () => {
  const earlierInput = prepare();
  const earlier = filled(earlierInput);
  const later = prepare(NEW_BUILD);
  const carried = carriedTo(later, earlier);
  const byId = new Map(carried.file.decisions.map((item) => [item.id, item]));

  it('carries each decision to the construct of its identity, wherever it sits now', () => {
    expect(packageBuildOf(later.pkg).commit).toBe('2b1f');
    expect(carried.otherBuild).toMatch(/^Acme-Claims 1\.0\.0, bundle [0-9a-f]{12}$/);
    // The adjuster's decision, made at #3, is carried to #4, where the field is now.
    expect(byId.get(`layout-field:${EDIT}#4`)).toMatchObject({
      label: 'cl:adjuster ("Adjuster")',
      owner: 'Migration lead',
      decision: 'Decided on cl:adjuster ("Adjuster")',
    });
    // The new field at #3 is converted, and takes no decision: nothing landed on it.
    expect(byId.has(`layout-field:${EDIT}#3`)).toBe(false);
    // The theme property after the one removed moved up a place, and kept its decision.
    const primary = carried.file.decisions.find((item) => item.label === '--primary-text-color');
    expect(primary).toMatchObject({
      id: `theme-property:${THEME}#4`,
      decision: 'Decided on --primary-text-color',
    });
    expect(carried.carried).toBeGreaterThan(10);
  });

  it('never carries a decision to the construct its place holds now, by its id', () => {
    for (const item of carried.file.decisions) {
      if (!item.owner) continue;
      // Each carried decision was made on the construct of the same identity, and label.
      const before = earlier.decisions.find((decision) => decision.identity === item.identity);
      expect([item.id, before?.label, before?.decision]).toEqual([
        item.id,
        item.label,
        item.decision,
      ]);
    }
  });

  it('offers a decision whose construct changed for re-confirmation, beside a blank one', () => {
    const status = byId.get(`search-field:${FORM}#2`);
    expect(status).toMatchObject({
      label: 'cl_status ("Claim status")',
      owner: '',
      decision: '',
      earlier: {
        owner: 'Migration lead',
        decision: 'Decided on cl_status ("Status")',
        madeOn: { label: 'cl_status ("Status")' },
        changed: ['label'],
      },
    });
    expect(carried.reconfirm).toBe(1);
    expect(carried.notCarried).toContain(
      `earlier.json: search-field:${FORM}#2 was made on another label than this build's report gives search-field:${FORM}#2, so it is offered for re-confirmation, beside it`,
    );
    // Not taken until a person fills it in; then taken, as their decision.
    const held = (file: unknown) =>
      holdDecisions(
        carried.input.conversion.report,
        file,
        packageBuildOf(later.pkg),
        identitiesOf(later.inventory),
      );
    expect(held(carried.file).taken.get(`search-field:${FORM}#2`)?.owner).toBe('');
    expect(held(carried.file).unowned).toBe(1);
    const confirmed = {
      ...carried.file,
      decisions: carried.file.decisions.map((item) =>
        item.id === `search-field:${FORM}#2`
          ? { ...item, owner: 'Migration lead', decision: 'Confirmed' }
          : item,
      ),
    };
    expect(held(confirmed).taken.get(`search-field:${FORM}#2`)).toMatchObject({
      decision: 'Confirmed',
    });
  });

  it('drops a decision whose construct is gone, and a changed condition’s acceptance with it', () => {
    const dropped = carried.file.carriedFrom?.dropped ?? [];
    expect(dropped.map((item) => [item.id, item.why])).toEqual([
      [
        `condition:${VIEW}#2`,
        'is of a construct this build no longer holds, or no longer asks a decision of, so it is dropped',
      ],
      [
        `theme-property:${THEME}#4`,
        'is of a construct this build no longer holds, or no longer asks a decision of, so it is dropped',
      ],
    ]);
    // The condition tests another facet now: its proposal waits for a person, and its field is
    // not written under the rule accepted for the old one.
    expect(byId.get(`condition:${VIEW}#2`)).toMatchObject({
      outcome: 'proposed',
      rule: { type: 'app.rules.hasFacet', parameters: ['Folderish'] },
      decision: '',
    });
    expect(JSON.stringify(carried.input.conversion.app)).not.toContain('Folderish');
    expect(JSON.stringify(carried.input.conversion.app)).not.toContain('cl:tags');
  });

  it('says in the report what it carried, offered and dropped', () => {
    const summary = summarise(carried.input);
    expect(summary.carried).toMatchObject({
      from: packageBuildOf(earlierInput.pkg),
      carried: carried.carried,
      reconfirm: [
        {
          id: `search-field:${FORM}#2`,
          confirmed: false,
          earlier: { owner: 'Migration lead', changed: ['label'] },
        },
      ],
    });
    expect(summary.carried?.dropped).toHaveLength(2);
    expect(runHarness(carried.input).blockers).toEqual(
      expect.arrayContaining([
        '1 reported item has no owner',
        '1 proposal waits for a person to accept or reject it',
      ]),
    );
  });
});

// The controls of carrying: each carries a decision as a carry blind to identity, or to what it
// was made on, would, and readiness must name it among what stands in the way.
describe('each deliberate breakage of carrying stands in the way of readiness', () => {
  const later = prepare(NEW_BUILD);
  const { input } = carriedTo(later, filled(prepare()));
  const sound = runHarness(input).blockers;
  const pristine = JSON.stringify(input.conversion);

  for (const mutation of CARRY_MUTATIONS) {
    it(`${mutation.name}: ${mutation.description}`, () => {
      const broken = mutation.apply(input.conversion).conversion;
      expect(JSON.stringify(input.conversion)).toBe(pristine);
      const added = runHarness({ ...input, conversion: broken }).blockers.filter(
        (line) => !sound.includes(line),
      );
      expect(added.length).toBeGreaterThan(0);
      expect(added.every((line) => /reported item|decisions\.json/.test(line))).toBe(true);
    });
  }

  it.each([
    [
      'carry-to-other-construct',
      /^decisions\.json: .* was made on another construct than the package holds there now, whose identity is .*, so it is not taken: decide it again$/,
    ],
    [
      'carry-changed-silently',
      new RegExp(
        `^decisions\\.json: search-field:${FORM.replace(/[.]/g, '\\.')}#2 was made on another label than the report gives now, so it is not taken: decide it again$`,
      ),
    ],
  ])('%s names what broke', (name, line) => {
    const mutation = CARRY_MUTATIONS.find((candidate) => candidate.name === name);
    if (!mutation) throw new Error(name);
    const added = runHarness({
      ...input,
      conversion: mutation.apply(input.conversion).conversion,
    }).blockers.filter(
      (blocker) => !sound.includes(blocker) && blocker.startsWith('decisions.json'),
    );
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(line);
  });

  it('says so when there is no decision offered for re-confirmation, or none taken, to break', () => {
    const plain = prepare();
    expect(() =>
      CARRY_MUTATIONS.find((m) => m.name === 'carry-changed-silently')?.apply({
        ...plain.conversion,
        decisions: filled(plain),
      }),
    ).toThrow(MutationError);
    expect(() =>
      CARRY_MUTATIONS.find((m) => m.name === 'carry-to-other-construct')?.apply(plain.conversion),
    ).toThrow(MutationError);
  });
});

// What the independent reviews found, each now held.
describe('carrying, as the reviews found it', () => {
  it('carries nothing of a construct the earlier build held more than once, whichever was decided', () => {
    // The view's dom-if written twice, alike: one identity for two conditions.
    const twice = {
      [VIEW]: (FILES[VIEW] ?? '')
        .replace('<div role="widget"><label>Tags</label>', '<div role="widget"><label>Tags</label>')
        .replace(
          '  </template>\n  <script>',
          `    <template is="dom-if" if="[[hasFacet(document, 'Versionable')]]">\n      <div role="widget"><label>Number again</label><div>[[document.properties.cl:number]]</div></div>\n    </template>\n  </template>\n  <script>`,
        ),
    };
    const earlierInput = prepare(twice);
    const conditions = constructsOf(earlierInput.inventory).filter(
      (construct) => construct.kind === 'condition' && construct.file === VIEW,
    );
    expect(sharedIdentities(conditions).size).toBe(1);
    const file = filled(earlierInput);
    expect(file.shared).toEqual([...sharedIdentities(constructsOf(earlierInput.inventory))].sort());
    // Only the first decided: the second left blank, as a person might.
    const second = conditions.find((construct) => construct.id === `condition:${VIEW}#3`)?.id;
    const earlier = {
      ...file,
      decisions: file.decisions.map((item) =>
        item.id === second ? { ...item, owner: '', decision: '', reason: '' } : item,
      ),
    };
    const later = prepare({ ...NEW_BUILD, [VIEW]: FILES[VIEW] ?? '' });
    const carried = carriedTo(later, earlier);
    const dropped = new Map(
      (carried.file.carriedFrom?.dropped ?? []).map((item) => [item.id, item.why]),
    );
    // The condition decided once and left blank once: two entries of one identity, neither taken.
    expect(dropped.get(`condition:${VIEW}#2`)).toBe(
      'is one of 2 decisions of one construct, and which is meant cannot be told, so none is carried',
    );
    // The field that binds cl:number again, under it: the only one of its identity the file decides,
    // and still one the earlier build held twice, which the file names.
    expect(dropped.get(`layout-field:${VIEW}#6`)).toBe(
      'is of a construct the earlier build held more than once, alike, so which one it was made on cannot be told, and it is not carried: decide it again',
    );
    expect(carried.file.decisions.find((item) => item.id === `condition:${VIEW}#2`)).toMatchObject({
      decision: '',
    });
  });

  it('offers an unconfirmed decision again on a run of the same build, and keeps saying what was carried', () => {
    const first = carriedTo(prepare(NEW_BUILD), filled(prepare()));
    expect(first.reconfirm).toBe(1);
    // The same build again, from that file, nothing confirmed.
    const again = carriedTo(prepare(NEW_BUILD), first.file);
    expect(again.reconfirm).toBe(1);
    const offered = again.file.decisions.find((item) => item.id === `search-field:${FORM}#2`);
    expect(offered).toMatchObject({
      owner: '',
      decision: '',
      earlier: { owner: 'Migration lead' },
    });
    expect(again.file.carriedFrom).toEqual(first.file.carriedFrom);
    expect(summarise(again.input).carried?.reconfirm.map((item) => item.id)).toEqual([
      `search-field:${FORM}#2`,
    ]);
  });

  it('names no one by spaces or characters that show nothing', () => {
    const input = prepare();
    const file = filled(input);
    const invisible = '​ ​';
    const blank = {
      ...file,
      decisions: file.decisions.map((item, index) =>
        item.outcome === 'proposed'
          ? { ...item, owner: invisible, reason: invisible }
          : index === 0
            ? { ...item, owner: invisible }
            : item,
      ),
    };
    const held = holdDecisions(
      input.conversion.report,
      blank,
      packageBuildOf(input.pkg),
      identitiesOf(input.inventory),
    );
    expect(held).toMatchObject({ unowned: 1, unsigned: 1 });
    expect(held.verdicts.size).toBe(0);
  });
});

describe('what the report says it carried', () => {
  it('counts an offered proposal confirmed only once accepted or rejected by someone named, for a reason', () => {
    const input = prepare();
    const earlier = filled(input);
    // The proposal decided on an earlier reason: offered again, beside a blank decision.
    const changed = {
      ...earlier,
      decisions: earlier.decisions.map((item) =>
        item.id === `condition:${VIEW}#2` ? { ...item, note: 'An earlier reason' } : item,
      ),
    };
    const offered = carriedTo(input, changed);
    expect(offered.file.decisions.find((item) => item.id === `condition:${VIEW}#2`)).toMatchObject({
      decision: '',
      earlier: { decision: 'accept', changed: ['reason'] },
    });
    const confirm = (reason: string) => ({
      ...offered.input,
      conversion: {
        ...offered.input.conversion,
        decisions: {
          ...offered.file,
          decisions: offered.file.decisions.map((item) =>
            item.id === `condition:${VIEW}#2`
              ? { ...item, owner: 'Dana Reviewer', decision: 'accept', reason }
              : item,
          ),
        },
      },
    });
    const confirmedOf = (reason: string) =>
      summarise(confirm(reason)).carried?.reconfirm.find(
        (item) => item.id === `condition:${VIEW}#2`,
      )?.confirmed;
    // The same build: its offers are said beside the entry, and the report finds them there.
    expect(confirmedOf('')).toBe(false);
    expect(confirmedOf('Checked again')).toBe(true);
  });

  it('says nothing was carried from a file it takes none of', () => {
    const later = prepare(NEW_BUILD);
    const carried = carriedTo(later, filled(prepare()));
    expect(summarise(carried.input).carried).not.toBeNull();
    // The same file, held to another build than its own: none of it is taken, nor what it carried.
    const other = {
      ...carried.input,
      conversion: {
        ...carried.input.conversion,
        decisions: {
          ...carried.file,
          package: { ...carried.file.package, bundle: 'f'.repeat(64) },
        },
      },
    };
    const summary = summarise(other);
    expect(summary.decisionFindings[0]).toMatch(/so none of it is taken$/);
    expect(summary.carried).toBeNull();
  });
});
