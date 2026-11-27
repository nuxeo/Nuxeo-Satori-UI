/**
 * Where check 9 meets the people's half of a migration (docs/business-apps/studio-migration.md,
 * sections 6 and 8), on the made-up corpus's two custom elements and their plugins:
 *
 * - **A plugin is a proposal,** as a condition's rule is: a person accepts or rejects it in
 *   `decisions.json`, held to its element by the element's identity, and the report records what
 *   the conversion was made with. A plugin no one accepted is not ready, whatever check 9 says.
 * - **The approval covers each accepted plugin's files,** `studio-plugin.json` among them, so a
 *   plugin changed after the approval voids it.
 *
 * Each control of these joins (`PLUGIN_JOIN_MUTATIONS`) is applied to a migration whose decisions
 * are made and whose report is approved, and readiness must name what broke.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { approvalOf, digestsOf, holdApproval } from './approval';
import { loadCatalogue } from './catalogue';
import { main } from './cli';
import { constructsOf, identitiesOf, sharedIdentities } from './constructs';
import {
  convert,
  convertWithDecisions,
  packageBuildOf,
  writeConversion,
  type Conversion,
} from './convert';
import { decisionsFor, holdDecisions, type DecisionsFile, type OwnerDecision } from './decisions';
import { runCheck, runHarness, type HarnessInput } from './harness';
import { inventory } from './inventory';
import { MutationError, PLUGIN_JOIN_MUTATIONS, type PluginSubject } from './mutations';
import { pluginFilesOf, readLibrary, readPlugins, WORKSPACE } from './plugins';
import { readStudioPackage } from './studio-package';
import { M3_CUSTOM_BUNDLE, M3_OBSERVED, m3CorpusFiles } from './testing/m3-corpus';
import { syntheticPackage } from './testing/synthetic-package';

const catalogue = loadCatalogue();
const ALLOW_LIST: ReadonlySet<string> = new Set(['Claim.Approve']);
const AT = new Date('2026-11-27T10:00:00.000Z');
const BY = 'Dana Reviewer';
const EXPOSURE = `custom-element:${M3_CUSTOM_BUNDLE}#1`;
const ESCALATE = `custom-element:${M3_CUSTOM_BUNDLE}#2`;
const TEMPLATE_CONFIG = 'apps/nuxeo-satori-template/src/app/app.config.ts';

type Input = HarnessInput & { plugins: NonNullable<HarnessInput['plugins']> };

afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

/** A person's decision of each item: every proposal accepted, unless `rejected` names it. */
function decide(file: DecisionsFile, rejected: readonly string[] = []): DecisionsFile {
  return {
    ...file,
    decisions: file.decisions.map((item): OwnerDecision =>
      item.outcome === 'proposed'
        ? {
            ...item,
            owner: BY,
            decision: rejected.includes(item.id) ? 'reject' : 'accept',
            reason: `Checked ${item.label}`,
          }
        : { ...item, owner: 'Migration lead', decision: `Decided on ${item.label}` },
    ),
  };
}

/** The package of `bundle`, read, with its plugins read from this repository. */
function packageOf(bundle: Record<string, string>) {
  const pkg = readStudioPackage(syntheticPackage({ bundle }));
  const read = inventory(pkg);
  return {
    pkg,
    read,
    plugins: readPlugins(WORKSPACE, read, { observed: M3_OBSERVED }),
    build: packageBuildOf(pkg),
    identities: identitiesOf(read),
    shared: sharedIdentities(constructsOf(read)),
  };
}

/**
 * The migration of `bundle` as `migrate --from` makes it from `earlier`, a decisions file: the
 * conversion made with those decisions, and the decisions carried beside it.
 */
function decided(bundle: Record<string, string>, earlier: DecisionsFile): Input {
  const { pkg, read, plugins, build, identities, shared } = packageOf(bundle);
  const raw = { raw: JSON.parse(JSON.stringify(earlier)) as unknown, file: 'earlier.json' };
  const conversion = convertWithDecisions(pkg, read, catalogue, { allowList: ALLOW_LIST }, raw);
  const { file } = decisionsFor(conversion.report, build, identities, shared, raw);
  return {
    pkg,
    inventory: read,
    catalogue,
    allowList: ALLOW_LIST,
    conversion: { ...conversion, decisions: file },
    plugins,
  };
}

/** The blank decisions file of `bundle`'s first conversion, as `decisions` writes it. */
function blank(bundle: Record<string, string>): { file: DecisionsFile; conversion: Conversion } {
  const { pkg, read, build, identities, shared } = packageOf(bundle);
  const conversion = convert(pkg, read, catalogue, { allowList: ALLOW_LIST });
  return { file: decisionsFor(conversion.report, build, identities, shared).file, conversion };
}

/** `input`, approved by a person as it is, its plugins' files as check 9 read them. */
function approved(input: Input): Input {
  const approval = approvalOf(
    input.conversion,
    packageBuildOf(input.pkg),
    BY,
    AT,
    pluginFilesOf(input.plugins),
  );
  return { ...input, conversion: { ...input.conversion, approval } };
}

const corpus = m3CorpusFiles();
const first = blank(corpus);
const accepted = approved(decided(corpus, decide(first.file)));

/** What stands in the way that has to do with the decisions or the approval. */
const peoples = (blockers: readonly string[]): string[] =>
  blockers.filter((line) =>
    /proposal|reported item|decisions\.json|approv|accepts the plugins/.test(line),
  );

describe('a plugin is a proposal a person decides', () => {
  it("is in decisions.json as each proposal is, by its element's identity", () => {
    const plugins = first.file.decisions.filter((item) => item.id.startsWith('custom-element:'));
    expect(plugins.map((item) => item.id)).toEqual([EXPOSURE, ESCALATE]);
    const identities = identitiesOf(
      inventory(readStudioPackage(syntheticPackage({ bundle: corpus }))),
    );
    for (const item of plugins)
      expect(item).toMatchObject({
        identity: identities.get(item.id),
        outcome: 'proposed',
        owner: '',
        decision: '',
        reason: '',
      });
  });

  it('waits for a person, whatever check 9 says: every other proposal decided, the plugins are not', () => {
    const others = decided(corpus, {
      ...first.file,
      decisions: decide(first.file).decisions.map((item) =>
        item.id.startsWith('custom-element:')
          ? { ...item, owner: '', decision: '', reason: '' }
          : item,
      ),
    });
    expect(peoples(runHarness(others).blockers)).toEqual([
      '2 proposals wait for a person to accept or reject them',
      'no one has approved the report and its decisions: a person does, with the approve command, once every decision is made',
    ]);
    // Check 9 passes what runs without the plugins run: what is in the way is the people's.
    expect(runCheck(others, 9)?.findings).toEqual([]);
  });

  it('records each accepted, and stands nothing of the decisions in the way once it is', () => {
    for (const id of [EXPOSURE, ESCALATE])
      expect(accepted.conversion.report.constructs.find((entry) => entry.id === id)).toMatchObject({
        outcome: 'proposed',
        proposal: true,
        applied: 'accept',
      });
    expect(peoples(runHarness(accepted).blockers)).toEqual([]);
    expect(runCheck(accepted, 9)?.findings).toEqual([]);
  });

  it('holds nothing of a rejected plugin to its element, and refuses one still there or built in', () => {
    const rejected = decided(corpus, decide(first.file, [ESCALATE]));
    expect(
      rejected.conversion.report.constructs.find((entry) => entry.id === ESCALATE),
    ).toMatchObject({ applied: 'reject' });
    expect(runCheck(rejected, 9)?.findings).toEqual([
      'libs/extensions/acme-claim-escalate, the plugin of acme-claim-escalate, which a person rejected, is still in the repository: remove it, with its import path and its provider, so that nothing builds it in',
      `${TEMPLATE_CONFIG} builds in libs/extensions/acme-claim-escalate, the plugin of acme-claim-escalate, which a person rejected: take it out of the template's providers`,
    ]);
    // Its library gone, no file of the app can build it in, whichever imports it; and the
    // template's line naming it is refused too.
    const gone: Input = {
      ...rejected,
      plugins: {
        ...rejected.plugins,
        sources: rejected.plugins.sources.filter(
          (source) => source.element !== 'acme-claim-escalate',
        ),
      },
    };
    expect(runCheck(gone, 9)?.findings).toEqual([
      `${TEMPLATE_CONFIG} builds in libs/extensions/acme-claim-escalate, the plugin of acme-claim-escalate, which a person rejected: take it out of the template's providers`,
    ]);
    const template = rejected.plugins.template?.text ?? '';
    const without = template
      .split('\n')
      .filter((line) => !/AcmeClaimEscalate|acme-claim-escalate/.test(line))
      .join('\n');
    expect(without).not.toBe(template);
    const out: Input = {
      ...gone,
      plugins: { ...gone.plugins, template: { path: TEMPLATE_CONFIG, text: without } },
    };
    expect(runCheck(out, 9)?.findings).toEqual([]);
    expect(peoples(runHarness(out).blockers).filter((line) => /proposal/.test(line))).toEqual([]);
  });

  it('builds an accepted plugin from its own library: an import path resolved elsewhere fails check 9', () => {
    const exposure = '@agentic-ui/acme-claim-exposure';
    expect(accepted.plugins.aliases?.[exposure]).toEqual([
      'libs/extensions/acme-claim-exposure/src/index.ts',
    ]);
    const elsewhere: Input = {
      ...accepted,
      plugins: {
        ...accepted.plugins,
        aliases: { ...accepted.plugins.aliases, [exposure]: ['libs/other/src/index.ts'] },
      },
    };
    expect(runCheck(elsewhere, 9)?.findings).toEqual([
      'apps/nuxeo-satori-template/tsconfig.app.json resolves @agentic-ui/acme-claim-exposure to libs/other/src/index.ts, not to libs/extensions/acme-claim-exposure/src/index.ts: the template builds the plugin from its own library',
    ]);
    // The approval still holds, as it covers the library: check 9 is what stands in the way.
    expect(runHarness(elsewhere).blockers).toContain('check 9 failed');
    expect(peoples(runHarness(elsewhere).blockers)).toEqual([]);
  });

  it('builds an accepted plugin in only by calling the provider it imports from the plugin', () => {
    const template = accepted.plugins.template?.text ?? '';
    const exposureImport =
      "import { provideAcmeClaimExposurePlugin } from '@agentic-ui/acme-claim-exposure';";
    expect(template).toContain(exposureImport);
    const withTemplate = (text: string): Input => ({
      ...accepted,
      plugins: { ...accepted.plugins, template: { path: TEMPLATE_CONFIG, text } },
    });
    const refused =
      'apps/nuxeo-satori-template/src/app/app.config.ts does not build libs/extensions/acme-claim-exposure in: import provideAcmeClaimExposurePlugin from @agentic-ui/acme-claim-exposure and call it among its providers';
    // Imported under another name, and a function of the same name from another module called.
    const renamed = template.replace(
      exposureImport,
      "import { provideAcmeClaimExposurePlugin as held } from '@agentic-ui/acme-claim-exposure';\nimport { provideAcmeClaimExposurePlugin } from '@agentic-ui/acme-extensions';",
    );
    // The plugin's import left in a comment, and the provider taken from elsewhere.
    const commented = template.replace(
      exposureImport,
      `// ${exposureImport}\nimport { provideAcmeClaimExposurePlugin } from '../../../../libs/other/src';`,
    );
    for (const text of [renamed, commented]) {
      expect(text).not.toBe(template);
      expect(runCheck(withTemplate(text), 9)?.findings).toEqual([refused]);
    }
    // Renamed and called by that name, it is built in.
    const calledRenamed = template
      .replace(
        exposureImport,
        "import { provideAcmeClaimExposurePlugin as exposure } from '@agentic-ui/acme-claim-exposure';",
      )
      .replace('provideAcmeClaimExposurePlugin(),', 'exposure(),');
    expect(calledRenamed).toContain('exposure(),');
    expect(runCheck(withTemplate(calledRenamed), 9)?.findings).toEqual([]);
  });

  it('reads the directories it does not read from the disk, and names them', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'studio-plugin-skipped-'));
    const library = join(workspace, 'libs', 'extensions', 'acme-claim-exposure');
    mkdirSync(join(library, 'src', 'node_modules', 'hidden'), { recursive: true });
    writeFileSync(join(library, 'src', 'index.ts'), 'export {};\n');
    writeFileSync(
      join(library, 'src', 'node_modules', 'hidden', 'index.js'),
      'module.exports = 1;\n',
    );
    const read = readPlugins(workspace, accepted.inventory);
    expect(read.sources).toEqual([
      {
        element: 'acme-claim-exposure',
        library: 'libs/extensions/acme-claim-exposure',
        files: { 'src/index.ts': 'export {};\n' },
        skipped: ['src/node_modules'],
      },
    ]);
  });

  it('refuses a directory it does not read in a plugin, installed packages or a repository', () => {
    const nested: Input = {
      ...accepted,
      plugins: {
        ...accepted.plugins,
        sources: accepted.plugins.sources.map((source) =>
          source.element === 'acme-claim-exposure'
            ? { ...source, skipped: ['src/node_modules'] }
            : source,
        ),
      },
    };
    expect(runCheck(nested, 9)?.findings).toEqual([
      'libs/extensions/acme-claim-exposure/src/node_modules is a directory check 9 does not read: a plugin holds no installed packages and no repository of its own',
    ]);
  });
});

describe("the approval covers each accepted plugin's files", () => {
  const build = packageBuildOf(accepted.pkg);

  it('approves the plugins as check 9 read them, and as approve reads them from the repository', () => {
    const digests = digestsOf(accepted.conversion, pluginFilesOf(accepted.plugins));
    expect(digests.plugins).toMatch(/^[0-9a-f]{64}$/);
    expect(digestsOf(accepted.conversion, (library) => readLibrary(WORKSPACE, library))).toEqual(
      digests,
    );
    expect(holdApproval(accepted.conversion, build, pluginFilesOf(accepted.plugins))).toMatchObject(
      { approved: true, findings: [] },
    );
  });

  it('covers studio-plugin.json, and every file of the library', () => {
    for (const path of ['studio-plugin.json', 'README.md', 'project.json']) {
      const changed = accepted.plugins.sources.map((source) =>
        source.element === 'acme-claim-exposure'
          ? { ...source, files: { ...source.files, [path]: `${source.files[path]} ` } }
          : source,
      );
      expect([
        path,
        holdApproval(
          accepted.conversion,
          build,
          pluginFilesOf({ ...accepted.plugins, sources: changed }),
        ).findings,
      ]).toEqual([
        path,
        [
          `the approval by ${BY} at ${AT.toISOString()} is void: the accepted plugins have changed since, so a person approves again`,
        ],
      ]);
    }
  });

  it('is not held to plugins no one read, and makes no digest of them', () => {
    expect(holdApproval(accepted.conversion, build).findings).toEqual([
      'the report accepts the plugins libs/extensions/acme-claim-escalate, libs/extensions/acme-claim-exposure, which were not read, so the approval is not held to them: check or report reads them from the repository',
    ]);
    expect(() => digestsOf(accepted.conversion)).toThrow(/were not read, so no digest of them/);
    const { plugins: _plugins, ...unread } = accepted;
    expect(peoples(runHarness(unread).blockers)).toContain(
      'the report accepts the plugins libs/extensions/acme-claim-escalate, libs/extensions/acme-claim-exposure, which were not read, so the approval is not held to them: check or report reads them from the repository',
    );
  });

  it('names no plugin of a conversion that accepts none', () => {
    const none = decided(corpus, decide(first.file, [EXPOSURE, ESCALATE]));
    expect(digestsOf(none.conversion).plugins).toBeNull();
  });

  it("covers a plugin of every element name the inventory takes, and none outside a plugin's library", () => {
    // A name the plugin command would not write, but the inventory reads: still covered.
    const odd = (files: Record<string, string>): string | null =>
      digestsOf(
        {
          ...accepted.conversion,
          report: {
            ...accepted.conversion.report,
            constructs: accepted.conversion.report.constructs.map((entry) =>
              entry.id === EXPOSURE ? { ...entry, to: 'libs/extensions/acme_claim-x.v2' } : entry,
            ),
          },
        },
        (library) => (library === 'libs/extensions/acme_claim-x.v2' ? files : null),
      ).plugins;
    expect(odd({ 'src/index.ts': 'a' })).not.toBe(odd({ 'src/index.ts': 'b' }));
    const outside: Conversion = {
      ...accepted.conversion,
      report: {
        ...accepted.conversion.report,
        constructs: accepted.conversion.report.constructs.map((entry) =>
          entry.id === EXPOSURE ? { ...entry, to: 'libs/extensions/../../tools' } : entry,
        ),
      },
    };
    expect(holdApproval(outside, build, pluginFilesOf(accepted.plugins)).findings).toContain(
      "the report accepts a plugin at libs/extensions/../../tools, which is no plugin's library, so the approval covers nothing of it",
    );
  });

  it('voids the approval for a file added to an accepted plugin, or taken away', () => {
    const withFiles = (change: (files: Record<string, string>) => Record<string, string>) =>
      holdApproval(
        accepted.conversion,
        build,
        pluginFilesOf({
          ...accepted.plugins,
          sources: accepted.plugins.sources.map((source) =>
            source.element === 'acme-claim-escalate'
              ? { ...source, files: change({ ...source.files }) }
              : source,
          ),
        }),
      ).approved;
    expect(withFiles((files) => files)).toBe(true);
    expect(withFiles((files) => ({ ...files, 'src/lib/extra.ts': 'export const x = 1;\n' }))).toBe(
      false,
    );
    expect(
      withFiles((files) => {
        const { 'README.md': _readme, ...rest } = files;
        return rest;
      }),
    ).toBe(false);
  });

  it('reads no directory but a plugin library, whatever the report names', () => {
    const elsewhere: Conversion = {
      ...accepted.conversion,
      report: {
        ...accepted.conversion.report,
        constructs: accepted.conversion.report.constructs.map((entry) =>
          entry.id === EXPOSURE ? { ...entry, to: 'libs/extensions/../../tools' } : entry,
        ),
      },
    };
    const read: string[] = [];
    digestsOf(elsewhere, (library) => {
      read.push(library);
      return readLibrary(WORKSPACE, library);
    });
    expect(read).toEqual(['libs/extensions/acme-claim-escalate']);
  });

  it('is written by approve with the plugins it reads from the repository', () => {
    const directory = join(mkdtempSync(join(tmpdir(), 'studio-plugin-approve-')), 'run');
    writeConversion(directory, { ...accepted.conversion, approval: undefined });
    const zip = syntheticPackage({ bundle: corpus });
    let out = '';
    let err = '';
    const code = main(['approve', 'acme.zip', directory, '--by', BY], {
      out: (text) => (out += text),
      err: (text) => (err += text),
      readFile: (path) => (path === 'acme.zip' ? zip : readFileSync(path)),
      now: () => AT,
      terminal: {
        ask: () => /together\s+([0-9a-f]{8})/.exec(out)?.[1] ?? null,
      },
    });
    expect([code, err]).toEqual([0, '']);
    expect(out).toMatch(
      /\n {2}its plugins {5}SHA-256 [0-9a-f]{64}, of libs\/extensions\/acme-claim-escalate, libs\/extensions\/acme-claim-exposure\n/,
    );
    const written = JSON.parse(readFileSync(join(directory, 'approval.json'), 'utf8'));
    expect(written.plugins).toBe(
      digestsOf(accepted.conversion, pluginFilesOf(accepted.plugins)).plugins,
    );
  });
});

describe('each deliberate breakage of the joins stands in the way of readiness', () => {
  const subjectOf = (input: Input): PluginSubject => ({
    conversion: input.conversion,
    plugins: input.plugins.sources,
    source: input,
    template: input.plugins.template,
  });
  const inputOf = (input: Input, broken: PluginSubject): Input => ({
    ...input,
    conversion: broken.conversion,
    plugins: { ...input.plugins, sources: broken.plugins },
  });

  /**
   * A new build of the made-up package, in which the exposure element shows its threshold under
   * another label, with the decisions of the approved build carried to it: the exposure plugin's
   * acceptance is dropped, as its element is another.
   */
  const changedBuild = (): Input => {
    const bundle = {
      ...corpus,
      [M3_CUSTOM_BUNDLE]: (corpus[M3_CUSTOM_BUNDLE] ?? '').replace(
        '<dom-module id="acme-claim-exposure">',
        '<dom-module id="acme-claim-exposure">\n  <!-- Changed in the new build. -->',
      ),
    };
    expect(bundle[M3_CUSTOM_BUNDLE]).not.toBe(corpus[M3_CUSTOM_BUNDLE]);
    return decided(bundle, accepted.conversion.decisions as DecisionsFile);
  };

  it('makes an element another when what it can reach in the package changes, not its slot contribution', () => {
    const bundleText = corpus[M3_CUSTOM_BUNDLE] ?? '';
    const identities = (bundle: Record<string, string>) => {
      const read = identitiesOf(inventory(readStudioPackage(syntheticPackage({ bundle }))));
      return [read.get(EXPOSURE), read.get(ESCALATE)];
    };
    const [exposure, escalate] = identities(corpus);
    // The bundle's code outside its elements, where a behaviour either uses may be defined.
    const scripted = {
      ...corpus,
      [M3_CUSTOM_BUNDLE]: `${bundleText}\n<script>window.Acme = { ClaimBehavior: {} };</script>\n`,
    };
    const [exposure2, escalate2] = identities(scripted);
    expect([exposure2 === exposure, escalate2 === escalate]).toEqual([false, false]);
    // A file the element names, by its bytes.
    const naming = (code: string) => ({
      ...corpus,
      [M3_CUSTOM_BUNDLE]: bundleText.replace(
        '<dom-module id="acme-claim-exposure">',
        '<dom-module id="acme-claim-exposure">\n  <script src="acme-claim-helpers.js"></script>',
      ),
      'web/nuxeo.war/ui/acme-claim-helpers.js': code,
    });
    expect(identities(naming('var a = 1;'))[0]).not.toBe(identities(naming('var a = 2;'))[0]);
    // A slot contribution is configuration, not code an element runs.
    const reordered = {
      ...corpus,
      [M3_CUSTOM_BUNDLE]: bundleText.replace('order="30"', 'order="40"'),
    };
    expect(reordered[M3_CUSTOM_BUNDLE]).not.toBe(bundleText);
    expect(identities(reordered)).toEqual([exposure, escalate]);
  });

  it('carries no acceptance of a plugin to its element changed in a new build', () => {
    const later = changedBuild();
    const file = later.conversion.decisions as DecisionsFile;
    expect(file.carriedFrom?.dropped.map((item) => item.id)).toEqual([EXPOSURE]);
    expect(file.decisions.find((item) => item.id === EXPOSURE)).toMatchObject({
      owner: '',
      decision: '',
    });
    expect(file.decisions.find((item) => item.id === ESCALATE)).toMatchObject({
      decision: 'accept',
    });
    expect(peoples(runHarness(later).blockers)).toContain(
      '1 proposal waits for a person to accept or reject it',
    );
  });

  const named: Record<string, { readonly subject: () => Input; readonly line: RegExp }> = {
    'accept-plugin-undecided': {
      subject: () => accepted,
      line: new RegExp(
        `^the conversion was made with 1 of its proposals decided otherwise than decisions\\.json decides them now, such as ${EXPOSURE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}: `,
      ),
    },
    'carry-plugin-to-changed-element': {
      subject: changedBuild,
      line: new RegExp(
        `^decisions\\.json: ${EXPOSURE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} was made on another construct than the package holds there now, whose identity is custom-element:[0-9a-f]{16}, not custom-element:[0-9a-f]{16}, so it is not taken: decide it again$`,
      ),
    },
    'change-plugin-after-approval': {
      subject: () => accepted,
      line: new RegExp(
        `^the approval by ${BY} at ${AT.toISOString().replace(/\./g, '\\.')} is void: the accepted plugins have changed since, so a person approves again$`,
      ),
    },
  };

  it('has a control of each join the code track asks for', () => {
    expect(PLUGIN_JOIN_MUTATIONS.map((mutation) => mutation.name).sort()).toEqual(
      Object.keys(named).sort(),
    );
  });

  for (const mutation of PLUGIN_JOIN_MUTATIONS) {
    it(`${mutation.name}: ${mutation.description}`, () => {
      const input = named[mutation.name].subject();
      const sound = runHarness(input).blockers;
      const pristine = JSON.stringify(input.conversion);
      const broken = inputOf(input, mutation.apply(subjectOf(input)).subject);
      expect(JSON.stringify(input.conversion)).toBe(pristine);
      const added = runHarness(broken).blockers.filter((line) => !sound.includes(line));
      expect(added).toEqual(
        expect.arrayContaining([expect.stringMatching(named[mutation.name].line)]),
      );
      expect(added.every((line) => peoples([line]).length === 1)).toBe(true);
      // Check 9 still passes it: what stands in the way is the people's half.
      expect(runCheck(broken, 9)?.findings).toEqual(runCheck(input, 9)?.findings);
    });
  }

  it('says so, rather than failing some other way, when there is nothing of its kind to break', () => {
    const undecided = decided(corpus, first.file);
    for (const mutation of PLUGIN_JOIN_MUTATIONS)
      expect(() => mutation.apply(subjectOf(undecided))).toThrow(MutationError);
  });

  it('decides as holdDecisions takes it: the changed build takes the escalate plugin, not the exposure one', () => {
    const later = changedBuild();
    const { verdicts } = holdDecisions(
      later.conversion.report,
      later.conversion.decisions,
      packageBuildOf(later.pkg),
      identitiesOf(later.inventory),
    );
    expect([verdicts.has(EXPOSURE), verdicts.get(ESCALATE)?.accepted]).toEqual([false, true]);
  });
});
