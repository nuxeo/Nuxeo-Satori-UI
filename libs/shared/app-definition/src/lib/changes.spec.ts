import {
  changesBetween,
  judgeVersion,
  packagedText,
  withoutVersion,
  type Change,
  type PackageFiles,
} from './changes';

const ROOT = 'bundle/agentic-ui-config/';
const APP = {
  version: 2,
  id: 'payers-claims',
  label: 'Claims',
  packageVersion: '1.0.0',
  platform: '>=0.2.0 <1.0.0',
  groups: ['members'],
};

/** A package: `app.json` and whatever else is given, each JSON written as the pipeline reads it. */
function files(
  extra: Record<string, unknown> = {},
  app: Record<string, unknown> = {},
): PackageFiles {
  const all: Record<string, unknown> = { [`${ROOT}app.json`]: { ...APP, ...app }, ...extra };
  return new Map(
    Object.entries(all)
      .filter(([, content]) => content !== undefined)
      .map(([path, content]) => [
        path,
        typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
      ]),
  );
}

const changes = (before: PackageFiles, after: PackageFiles): Change[] => [
  ...changesBetween(before, after).changes,
];
const levels = (before: PackageFiles, after: PackageFiles) =>
  changes(before, after).map((change) => change.level);

const LAYOUT = { version: 2, cards: [{ id: 'c', fields: ['dc:title'] }] };

describe('changesBetween', () => {
  it('finds nothing between a package and itself, nor when only the version moved', () => {
    const package1 = files({
      'package/package.xml': '<package name="x" version="1.0.0"><title>X</title></package>',
      'bundle/META-INF/MANIFEST.MF': 'Bundle-SymbolicName: x\nBundle-Version: 1.0.0\n',
    });
    expect(changes(package1, package1)).toEqual([]);
    const package2 = files(
      {
        'package/package.xml': '<package name="x" version="1.0.1"><title>X</title></package>',
        'bundle/META-INF/MANIFEST.MF': 'Bundle-SymbolicName: x\nBundle-Version: 1.0.1\n',
      },
      { packageVersion: '1.0.1' },
    );
    expect(changes(package1, package2)).toEqual([]);
  });

  it("blanks package.xml's own version, not one a comment holds, nor a dependency's", () => {
    const xml = (version: string, dependency: string) =>
      `<!-- <package version="9.9.9"> -->\n<package name="x" version="${version}"><dependencies><package>y:${dependency}</package></dependencies></package>`;
    expect(withoutVersion('package/package.xml', xml('1.0.0', '2.0.0'))).toBe(
      withoutVersion('package/package.xml', xml('1.2.0', '2.0.0')),
    );
    expect(withoutVersion('package/package.xml', xml('1.0.0', '2.0.0'))).not.toBe(
      withoutVersion('package/package.xml', xml('1.0.0', '2.1.0')),
    );
  });

  it('reads a removed layout, queue, task form, module, image, home or menu as breaking', () => {
    const whole = {
      [`${ROOT}layouts/Claim/view.layout.json`]: LAYOUT,
      [`${ROOT}queues/open.json`]: { version: 2 },
      [`${ROOT}tasks/review.check.layout.json`]: LAYOUT,
      [`${ROOT}modules/cases.json`]: { version: 2, settings: {} },
      [`${ROOT}assets/logo.svg`]: '<svg/>',
      [`${ROOT}home.json`]: { version: 2, cards: [] },
      [`${ROOT}navigation.json`]: { version: 2, entries: [] },
    };
    const removed = changes(files(whole), files());
    expect(removed.map((change) => change.level)).toEqual(Array(7).fill('breaking'));
    expect(removed.map((change) => change.what)).toEqual([
      'The image assets/logo.svg is removed: a file that names it shows nothing.',
      "The app's home is removed: its address shows nothing.",
      'The view layout of Claim records is removed: a server stops serving it, and a package that leant on it loses it.',
      'The settings of the module cases is removed: the module loses them.',
      "The app's menu is removed: its entries are gone.",
      'The queue open is removed: a link to it, a menu entry or a home card naming it stops working.',
      "The task form of review.check is removed: the step's tasks fall back to the form generated from its variables.",
    ]);
    expect(levels(files(), files(whole))).toEqual(Array(7).fill('addition'));
  });

  it('reads anything else in a file that stays as a change', () => {
    const before = files({ [`${ROOT}layouts/Claim/view.layout.json`]: LAYOUT });
    const after = files({
      [`${ROOT}layouts/Claim/view.layout.json`]: { ...LAYOUT, cards: [{ id: 'd', fields: [] }] },
    });
    expect(changes(before, after)).toEqual([
      {
        level: 'change',
        file: `${ROOT}layouts/Claim/view.layout.json`,
        what: 'The view layout of Claim records changed.',
      },
    ]);
    // Compared as the builder zips it: spacing and $schema are not in the zip; the keys' order is.
    const respaced = files({
      [`${ROOT}layouts/Claim/view.layout.json`]: JSON.stringify({
        $schema: '../x.json',
        ...LAYOUT,
      }),
    });
    expect(levels(before, respaced)).toEqual([]);
    const reordered = files({
      [`${ROOT}layouts/Claim/view.layout.json`]: { cards: LAYOUT.cards, version: 2 },
    });
    expect(levels(before, reordered)).toEqual(['change']);
  });

  it("leaves the manifest's Bundle-Version out while it is the package's version", () => {
    const manifest = (version: string) =>
      `Manifest-Version: 1.0\r\nBundle-SymbolicName: x\r\nBundle-Version: ${version}\r\n`;
    const at = (version: string, bundle: string) =>
      files({ 'bundle/META-INF/MANIFEST.MF': manifest(bundle) }, { packageVersion: version });
    expect(changes(at('1.0.0', '1.0.0'), at('1.0.1', '1.0.1'))).toEqual([]);
    // Moved alone, it is the zip's bytes changing under one version.
    expect(levels(at('1.0.0', '1.0.0'), at('1.0.0', '9.9.9'))).toEqual(['judge']);
    // A Bundle-Version that never followed the package's is compared as it is.
    expect(levels(at('1.0.0', '7.0.0'), at('1.0.1', '7.0.0'))).toEqual([]);
    // One left behind when the version moved is no change of content: step 3 refuses it.
    expect(levels(at('1.0.0', '1.0.0'), at('1.0.1', '1.0.0'))).toEqual([]);
    // Its lines as the builder writes them: unfolded, one kind of line end.
    expect(packagedText('bundle/META-INF/MANIFEST.MF', '\uFEFFA: b\r\n c\r\nD: e\n\n')).toBe(
      'A: bc\nD: e',
    );
    // A body a src names is packaged compact whatever the file is called; other files as they are.
    expect(
      packagedText('bundle/fragments/acme.manifest', '{\n  "$schema": "x",\n  "a": 1\n}\n'),
    ).toBe('{"a":1}');
    expect(packagedText('bundle/OSGI-INF/acme.xml', '<component />\n')).toBe('<component />\n');
  });

  it('reads labels and actions by key: removed, added or changed', () => {
    const labels = (entries: Record<string, string>) => ({ version: 2, labels: entries });
    const before = files({
      [`${ROOT}labels/en.json`]: labels({ a: 'A', b: 'B', c: 'C' }),
      [`${ROOT}actions.json`]: {
        version: 2,
        actions: [
          { id: 'x.approve', label: 'Approve', transition: 'approve' },
          { id: 'x.reject', label: 'Reject', transition: 'reject' },
        ],
      },
    });
    const after = files({
      [`${ROOT}labels/en.json`]: labels({ a: 'A', b: 'Bee', d: 'D' }),
      [`${ROOT}actions.json`]: {
        version: 2,
        actions: [
          { id: 'x.approve', label: 'Approve it', transition: 'approve' },
          { id: 'x.reopen', label: 'Reopen', transition: 'backToProject' },
        ],
      },
    });
    expect(changes(before, after).map((change) => [change.level, change.what])).toEqual([
      ['change', 'The action x.approve changed.'],
      [
        'breaking',
        'The action x.reject is removed: a queue or a record page that names one of its actions loses the button.',
      ],
      ['addition', 'The action x.reopen is added.'],
      ['change', 'The label b, in en, changed.'],
      [
        'breaking',
        'The label c, in en, is removed: a file that names one of its keys shows the key instead.',
      ],
      ['addition', 'The label d, in en, is added.'],
    ]);
    // A whole labels file goes as one change, not one per key.
    expect(changes(before, files({ [`${ROOT}actions.json`]: undefined }))).toHaveLength(2);
    expect(levels(files({ [`${ROOT}labels/en.json`]: labels({ a: 'A' }) }), files())).toEqual([
      'breaking',
    ]);
  });

  it("reads app.json's address, groups, modules and platform range for what they promise", () => {
    const of = (app: Record<string, unknown>) => (other: Record<string, unknown>) =>
      changes(files({}, app), files({}, other)).map((change) => change.level);
    expect(of({})({ address: 'claims' })).toEqual(['breaking']);
    expect(of({ groups: ['members', 'adjusters'] })({})).toEqual(['breaking']);
    expect(of({})({ groups: ['members', 'adjusters'] })).toEqual(['addition']);
    expect(of({})({ modules: ['cases'] })).toEqual(['breaking']);
    expect(of({ modules: ['cases'] })({})).toEqual(['change']);
    expect(of({})({ label: 'Claims desk', branding: { applicationTitle: 'Desk' } })).toEqual([
      'change',
    ]);
    // The platform range: narrower at either end is breaking, wider an addition.
    expect(of({ platform: '>=0.2.0 <1.0.0' })({ platform: '>=0.3.0 <1.0.0' })).toEqual([
      'breaking',
    ]);
    expect(of({ platform: '>=0.2.0 <1.0.0' })({ platform: '>=0.2.0 <0.9.0' })).toEqual([
      'breaking',
    ]);
    expect(of({ platform: '>=0.2.0 <1.0.0' })({ platform: '>0.2.0 <1.0.0' })).toEqual(['breaking']);
    expect(of({ platform: '>=0.2.0 <1.0.0' })({ platform: '>=0.1.0 <1.0.0' })).toEqual([
      'addition',
    ]);
    expect(of({ platform: '^1.2.0' })({ platform: '>=1.2.0' })).toEqual(['addition']);
    // The same releases, written another way: npm's `^1.2.0` stops below 2.0.0's prereleases.
    expect(of({ platform: '^1.2.0' })({ platform: '>=1.2.0 <2.0.0' })).toEqual(['change']);
    expect(of({ platform: '~1.2.0' })({ platform: '>=1.2.0 <1.3.0-0' })).toEqual(['change']);
    expect(of({ platform: '1.2.0' })({ platform: '>=1.2.0 <=1.2.0' })).toEqual(['change']);
  });

  it('refuses an app whose id changed, which is another app', () => {
    const { refusals } = changesBetween(files(), files({}, { id: 'payers-claims-two' }));
    expect(refusals).toEqual([
      expect.stringContaining("app.json's id is payers-claims-two, and was payers-claims."),
    ]);
  });

  it('leaves a change outside the app definition for a person to judge', () => {
    const before = files({ 'bundle/schemas/claim.xsd': '<xs:schema/>' });
    expect(changes(before, files({ 'bundle/schemas/claim.xsd': '<xs:schema a="b"/>' }))).toEqual([
      {
        level: 'judge',
        file: 'bundle/schemas/claim.xsd',
        what: 'bundle/schemas/claim.xsd changed.',
      },
    ]);
    expect(levels(files({ [`${ROOT}bootstrap.json`]: {} }), files())).toEqual(['judge']);
    expect(levels(files(), files({ [`${ROOT}demo/data.json`]: {} }))).toEqual(['change']);
  });
});

describe('judgeVersion', () => {
  const change = (level: Change['level']): Change => ({ level, file: 'f', what: `A ${level}.` });

  it('passes a version that did not move when nothing changed, and one raised for nothing', () => {
    expect(judgeVersion('1.0.0', '1.0.0', [])).toMatchObject({ refused: null, required: null });
    expect(judgeVersion('1.0.0', '1.0.1', [])).toMatchObject({
      refused: null,
      raised: 'patch',
      changelog: 'No change since 1.0.0; the version moved to 1.0.1 all the same.\n',
    });
  });

  it('refuses a version that did not move when something changed, naming the least raise', () => {
    expect(judgeVersion('1.2.3', '1.2.3', [change('change')]).refused).toBe(
      'the content changed since 1.2.3 (1 change), and the version is still 1.2.3. Raise it to' +
        " 1.2.4 at least, a patch version, in package.xml and app.json's packageVersion together.",
    );
    expect(judgeVersion('1.2.3', '1.2.3', [change('breaking')]).refused).toContain(
      'Raise it to 2.0.0 at least, a major version',
    );
  });

  it('refuses a version lower than the previous one, changed or not', () => {
    expect(judgeVersion('1.2.0', '1.1.9', []).refused).toBe(
      '1.1.9 is lower than the previous version, 1.2.0. A version only rises.',
    );
    expect(judgeVersion('1.0.0', '1.0.0-rc.1', [change('change')]).refused).toContain('is lower');
  });

  it('from 1.0.0: breaking raises the major, an addition or a change to judge the minor, a change the patch', () => {
    const needs = (level: Change['level']) => judgeVersion('1.2.3', '9.0.0', [change(level)]);
    expect(needs('breaking').required).toBe('major');
    expect(needs('addition').required).toBe('minor');
    expect(needs('judge').required).toBe('minor');
    expect(needs('change').required).toBe('patch');
    expect(judgeVersion('1.2.3', '1.3.0', [change('breaking')]).refused).toBe(
      'the changes since 1.2.3 need a major version, and 1.3.0 raises the minor. For one: A' +
        ' breaking. Raise it to 2.0.0 at least.',
    );
    expect(judgeVersion('1.2.3', '1.2.4', [change('addition')]).refused).toContain(
      'need a minor version, and 1.2.4 raises the patch',
    );
    expect(judgeVersion('1.2.3', '1.2.4', [change('judge')]).refused).toContain(
      'Raise it to 1.3.0',
    );
    expect(judgeVersion('1.2.3', '1.2.4', [change('change')]).refused).toBeNull();
    // Raising more than needed is the author's choice.
    expect(judgeVersion('1.2.3', '2.0.0', [change('change')]).refused).toBeNull();
  });

  it('below 1.0.0: breaking raises the minor, anything else the patch', () => {
    expect(judgeVersion('0.2.0', '0.9.9', [change('breaking')]).required).toBe('minor');
    expect(judgeVersion('0.2.0', '0.9.9', [change('addition')]).required).toBe('patch');
    expect(judgeVersion('0.2.0', '0.9.9', [change('judge')]).required).toBe('patch');
    expect(judgeVersion('0.2.0', '0.2.1', [change('breaking')]).refused).toContain(
      'need a minor version (below 1.0.0, a breaking change raises the minor, and anything else the patch), and 0.2.1 raises the patch',
    );
    expect(judgeVersion('0.2.0', '0.2.1', [change('addition')]).refused).toBeNull();
    expect(judgeVersion('0.2.0', '1.0.0', [change('breaking')]).refused).toBeNull();
  });

  it("holds a later prerelease of a version, or its release, to what that version's release may carry", () => {
    // 1.0.0's prereleases are on the way to a major: they may break.
    expect(judgeVersion('1.0.0-rc.1', '1.0.0-rc.2', [change('breaking')])).toMatchObject({
      refused: null,
      raised: 'prerelease',
      changelog: expect.stringContaining('1.0.0-rc.2 is a later prerelease of the same version.'),
    });
    expect(judgeVersion('1.0.0-rc.1', '1.0.0', [change('breaking')])).toMatchObject({
      refused: null,
      changelog: expect.stringContaining('1.0.0 is the release 1.0.0-rc.1 was a prerelease of.'),
    });
    // 1.0.1's are on the way to a patch: a breaking change cannot reach a patch release through them.
    expect(judgeVersion('1.0.1-rc.1', '1.0.1-rc.2', [change('breaking')]).refused).toBe(
      'the changes since 1.0.1-rc.1 need a major version, and 1.0.1-rc.2 is a prerelease of 1.0.1,' +
        ' which raises the patch. For one: A breaking. Make it 2.0.0 or a prerelease of it, at least.',
    );
    expect(judgeVersion('1.0.1-rc.2', '1.0.1', [change('breaking')]).refused).toContain(
      '1.0.1, the release 1.0.1-rc.2 was a prerelease of, raises the patch.',
    );
    expect(judgeVersion('1.0.1-rc.2', '1.0.1', [change('addition')]).refused).toContain(
      'Make it 1.1.0 or a prerelease of it',
    );
    expect(judgeVersion('1.0.1-rc.1', '1.0.1-rc.2', [change('change')]).refused).toBeNull();
    expect(judgeVersion('1.1.0-rc.1', '1.1.0', [change('addition')]).refused).toBeNull();
    // Below 1.0.0, 0.3.0 is a minor, which is what a breaking change needs there.
    expect(judgeVersion('0.3.0-rc.1', '0.3.0-rc.2', [change('breaking')]).refused).toBeNull();
    expect(judgeVersion('0.2.1-rc.1', '0.2.1', [change('breaking')]).refused).toContain(
      'Make it 0.3.0 or a prerelease of it',
    );
    // A prerelease of a higher core is a raise of that core.
    expect(judgeVersion('1.0.0', '2.0.0-rc.1', [change('breaking')]).refused).toBeNull();
    expect(judgeVersion('1.0.0', '1.0.1-rc.1', [change('breaking')]).refused).toContain(
      'raises the patch',
    );
    // From a prerelease, the least patch is its own release.
    expect(judgeVersion('1.0.1-rc.1', '1.0.1-rc.1', [change('change')]).refused).toContain(
      'Raise it to 1.0.1 at least',
    );
  });

  it('refuses whatever the versions say when told to, and a version that is not one', () => {
    expect(judgeVersion('1.0.0', '2.0.0', [], ['another app']).refused).toBe('another app');
    expect(judgeVersion('1.0', '2.0.0', []).refused).toContain('is not a semantic version');
    expect(judgeVersion('1.0.0', 'two', []).refused).toContain('two is not a semantic version');
  });

  it('writes the changelog by kind of change', () => {
    const judged = judgeVersion('1.0.0', '2.0.0', [
      change('judge'),
      change('breaking'),
      change('addition'),
      change('change'),
    ]);
    expect(judged.changelog).toBe(
      [
        'Since 1.0.0: 4 changes, which need a major version. 2.0.0 raises the major.',
        '',
        '## Breaking',
        '',
        '- A breaking.',
        '',
        '## Added',
        '',
        '- A addition.',
        '',
        '## Changed',
        '',
        '- A change.',
        '',
        '## To judge',
        '',
        '- A judge.',
        '',
        "The pipeline cannot tell whether these break anything. If one does, the version needs a breaking change's raise, which a person decides.",
        '',
      ].join('\n'),
    );
  });
});
