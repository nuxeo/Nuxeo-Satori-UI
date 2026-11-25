#!/usr/bin/env node
/**
 * Controls for the release candidate (`release-candidate.mjs`, its set checks in
 * `release-candidate-set.mjs` and its demo listing in `release-candidate-demo.mjs`).
 *
 * The command runs on a set meant to pass, so every run of it is green, and a check only ever seen
 * green is an assertion. Each control here breaks one rule and must see it refused, for its own
 * reason; the sound set must pass. None builds the client or runs Maven. Stage 7's set checks and
 * stage 6's bundle comparison are the functions broken here; stage 6's other refusals, a Maven run
 * that fails, a module that built nothing, a zip with no `package.xml`, no package deploying the
 * client, are only reached by the command's own run (package-pipeline.md, section 11, says which of
 * those were seen failing).
 *
 * - **Nuxeo's rules.** The dependency and platform cases are what nuxeo-connect-client 1.8.3's own
 *   classes answered when run (`Version`, `PackageDependency`, `PlatformVersionRange`), so a port
 *   that drifts from Nuxeo fails here, not on a server.
 * - **The set.** A package named twice, a dependency the candidate does not hold, one held at a
 *   snapshot, an unstamped version, a conflict, and a target platform outside a dependency's.
 * - **The bundle.** A deployed bundle the same as the one built, and one with a file missing, one
 *   more, one of other bytes, or none at all.
 * - **The kits, from real zips.** Two kits built by the pipeline share nothing; the same two, one
 *   given the other's app id, share exactly that, and one given the other's document type share
 *   exactly that.
 * - **The command.** It refuses an output directory that exists, file or folder, and leaves it as it
 *   was; one inside the repository, under `business-apps/packages/` or elsewhere; one whose folder
 *   is not there, which it does not make; a `--since` that is no commit; and a version it could not
 *   carry. Each exits 2 having written nothing.
 * - **The demo listing.** The repository's kit demos are listed, with the users, seeds and
 *   environment each needs; a steps file that names a kit and declares no `serverRun`, or declares
 *   it for another kit, or a seed the kit does not have, is a problem that stops the listing.
 *
 * Node, git and `unzip`, as the pipeline needs; acorn, installed by `npm ci`, for the listing.
 *
 * Usage: node scripts/release-candidate.selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { demoSteps, readSource } from './release-candidate-demo.mjs';
import {
  allowListArguments,
  bundleDifferences,
  compareNuxeoVersions,
  dependencyMatches,
  descriptorOf,
  duplicatesAcross,
  nuxeoVersion,
  parseDependency,
  platformRange,
  rangeWithin,
  readKit,
  registrationsOf,
  setProblems,
  uncommittedPaths,
} from './release-candidate-set.mjs';
import { componentXmlOf } from './verify-package-zip.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'scripts', 'release-candidate.mjs');
const PACKAGES = join(REPO, 'business-apps', 'packages');
const PAYERS = join(PACKAGES, 'payers-claims-demo');
const CONTRACTS = join(PACKAGES, 'contracts-demo');

const failures = [];
let negative = 0;
let positive = 0;

/** One control: `ok` is whether it held, `refusal` whether it is a negative one. */
function check(name, ok, detail, refusal = true) {
  if (refusal) negative += 1;
  else positive += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${refusal ? '[-]' : '[+]'} ${name}\n`);
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

const scratch = mkdtempSync(join(tmpdir(), 'release-candidate-selftest-'));
try {
  nuxeoRules();
  platformRules();
  registrations();
  theSet();
  theBundle();
  theUncommittedPaths();
  kitsFromZips();
  theCommand();
  await theDemoListing();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(
  `\n${negative} negative and ${positive} positive controls, ${failures.length} failed.\n`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

// ── Nuxeo's dependency rules, as nuxeo-connect-client 1.8.3 answered them ────────────────────────
function nuxeoRules() {
  // [dependency, version, what Nuxeo answered]: `new PackageDependency(d).getVersionRange()
  // .matchVersion(new Version(v))`, run against the jar on 2026-11-25.
  const answered = [
    ['nuxeo-agentic-ui:2026.0.2', '2026.0.2-SNAPSHOT', false],
    ['nuxeo-agentic-ui:2026.0.2', '2026.0.2', true],
    ['nuxeo-agentic-ui:2026.0.2', '2026.0.3', true],
    ['nuxeo-agentic-ui:2026.0.2', '2026.0.2-rc.1', false],
    ['nuxeo-agentic-ui:2026.0.2', '2026.0.2-PR-12-BUILD-3', true],
    ['nuxeo-agentic-ui:2026.0.2', '2026.0.2-20261125-BUILD-3', true],
    ['nuxeo-agentic-ui:2026.0.2', '2026.0.1', false],
    ['nuxeo-agentic-ui:2026.0.2', '2027.0.0', true],
    ['nuxeo-agentic-ui:2026.0.2:2026.0.5', '2026.0.6', false],
    ['nuxeo-agentic-ui:2026.0.2:2026.0.5', '2026.0.5', true],
    ['nuxeo-agentic-ui', '0.0.1', true],
    ['nuxeo-agentic-ui:2026.0', '2026.0.0', true],
    ['nuxeo-agentic-ui:2026.0.2-SNAPSHOT', '2026.0.2-SNAPSHOT', true],
    ['nuxeo-agentic-ui:2026.0.2-SNAPSHOT', '2026.0.2', true],
    ['nuxeo-agentic-ui:2026.0.2', '2026.0.2-HF01', true],
    ['x:1.0.0-rc1', '1.0.0-rc2', true],
    ['x:1.0.0-rc2', '1.0.0-rc10', false],
    ['x:1.0.0', '1.0.0-rc1', false],
    ['x:1.0.0', '1.0', true],
    ['x:1.0.0', '1', true],
    ['x: 1.0.0 ', '1.0.0', false],
  ];
  const wrong = answered.filter(
    ([dependency, version, met]) => dependencyMatches(parseDependency(dependency), version) !== met,
  );
  check(
    `the ${answered.length} dependency cases Nuxeo answered, a snapshot and an rc below the release among them`,
    wrong.length === 0,
    wrong.map(([d, v, met]) => `${d} with ${v} should be ${met}`).join('; '),
  );
  // [a, b, the sign of `new Version(a).compareTo(new Version(b))`], run against the same jar.
  const ordered = [
    ['2026.0.2-RC1', '2026.0.2', -1],
    ['2026.0.2-rc-1', '2026.0.2', -1],
    ['2026.0.2-I20261125', '2026.0.2', -1],
    ['2026.0.2-PR-12-BUILD-3', '2026.0.3', -1],
    ['2026.0.2-SNAPSHOT', '2026.0.1', 1],
    ['2026.0.2-PR-12-BUILD-3-SNAPSHOT', '2026.0.2', 1],
  ];
  const misordered = ordered.filter(
    ([a, b, sign]) => Math.sign(compareNuxeoVersions(nuxeoVersion(a), nuxeoVersion(b))) !== sign,
  );
  check('the version orders Nuxeo answered', misordered.length === 0, JSON.stringify(misordered));
  check(
    'an unstamped @VERSION@ is 0.0.0 to Nuxeo, and meets nothing',
    !dependencyMatches(parseDependency('nuxeo-agentic-ui:2026.0.2'), '@VERSION@'),
  );
}

// ── Target platforms, as PlatformVersionRange answered them ───────────────────────────────────
function platformRules() {
  // `PlatformVersionRange.fromRangeSpec(range).containsVersion(new PlatformVersion(v))`, run against
  // the jar. A bare version is the range of that version alone, so containing one is `rangeWithin`.
  const answered = {
    '[2025.0,2026.0)': {
      '2025.0': true,
      '2025.0.0': true,
      2025.12: true,
      '2025.99.1': true,
      '2026.0': false,
      2024.9: false,
      '2025.0-RC1': true,
      2025: true,
      2026: false,
      '2025.0.1-HF02': true,
    },
    '[2025.0,2026.0]': { '2026.0': true, 2026: true, 2024.9: false },
    '(2025.0,2026.0)': {
      '2025.0': false,
      '2025.0.0': false,
      2025.12: true,
      '2025.0-RC1': true,
      2025: false,
      '2026.0': false,
    },
    '[2025.0,)': { '2026.0': true, 2024.9: false, 2026: true },
    '(,2026.0)': { 2024.9: true, '2026.0': false },
    '2025.0': { '2025.0': true, '2025.0.0': true, 2025.12: false, '2025.0-RC1': false, 2025: true },
    '[2025.3,2026.0)': {
      '2025.0': false,
      2025.12: true,
      '2025.0-RC1': false,
      '2025.0.1-HF02': false,
    },
  };
  const wrong = [];
  for (const [range, versions] of Object.entries(answered))
    for (const [version, contained] of Object.entries(versions))
      if (rangeWithin(platformRange(version), platformRange(range)) !== contained)
        wrong.push(`${version} in ${range}`);
  check('the target platform cases Nuxeo answered', wrong.length === 0, wrong.join('; '));
  const within = [
    ['[2025.3,2026.0)', '[2025.0,2026.0)', true],
    ['(2025.0,2026.0)', '[2025.0,2026.0)', true],
    ['[2025.0,2026.0)', '[2025.0,2026.0)', true],
    ['[2025.0,2027.0)', '[2025.0,2026.0)', false],
    ['[2025.0,2026.0]', '[2025.0,2026.0)', false],
    ['[2025.0,)', '[2025.0,2026.0)', false],
    ['[2024.0,2026.0)', '[2025.0,2026.0)', false],
  ];
  const misjudged = within.filter(
    ([inner, outer, held]) => rangeWithin(platformRange(inner), platformRange(outer)) !== held,
  );
  check(
    'a range wider than its dependency is outside it, a narrower one within',
    misjudged.length === 0,
    JSON.stringify(misjudged),
  );
  check(
    'a range this port cannot read is not read',
    platformRange('2025.x') === null && platformRange('[a,b)') === null,
  );
}

// ── What a component registers ────────────────────────────────────────────────────────────────
function registrations() {
  const component = (file) =>
    registrationsOf(componentXmlOf(readFileSync(join(PAYERS, 'bundle', 'OSGI-INF', file), 'utf8')));
  const model = component('payers-claims-demo-model.xml');
  const workflow = component('payers-claims-demo-workflow.xml');
  const keys = (read, kind) =>
    read.registrations
      .filter((each) => each.kind === kind)
      .map((each) => each.key)
      .sort();
  check(
    "the Payers model's document types, and none of the schemas and facets a doctype only names",
    JSON.stringify(keys(model, 'document type')) ===
      JSON.stringify([
        'Case',
        'Claim',
        'ClaimDocument',
        'Member',
        'PayersClaimSearch',
        'Provider',
      ]) &&
      !keys(model, 'schema').includes('common') &&
      !keys(model, 'facet').includes('HiddenInNavigation'),
    JSON.stringify(model.registrations),
    false,
  );
  check(
    "the Payers model's schemas, lifecycle, chain, page providers and component",
    keys(model, 'schema').includes('claim') &&
      keys(model, 'lifecycle').includes('payersClaim') &&
      keys(model, "document type's lifecycle").includes('Claim') &&
      keys(model, 'automation chain').includes('PayersClaim.KeepStatus') &&
      keys(model, 'page provider').includes('member_claims') &&
      keys(model, 'component').includes('nuxeo.config.payers-claims-demo.model') &&
      model.unknown.length === 0,
    JSON.stringify(model),
    false,
  );
  check(
    "the Payers workflow's route model, directory, filter, facets and chains, its event handlers known",
    keys(workflow, 'workflow').includes('PayersClaimReview') &&
      keys(workflow, 'directory').includes('PayersClaimDecision') &&
      keys(workflow, 'action filter').includes('filter@PayersClaimReview') &&
      keys(workflow, 'facet').includes('facet-var_PayersClaimReview') &&
      keys(workflow, 'automation chain').includes('PayersClaimReview.Approve') &&
      workflow.unknown.length === 0,
    JSON.stringify(workflow),
    false,
  );
  const fixture = registrationsOf(
    componentXmlOf(
      '<component name="x"><extension target="org.nuxeo.ecm.core.schema.TypeService" point="doctype">' +
        '<doctype name="Gone" enabled="false"/><doctype name="Kept"/></extension>' +
        '<extension target="org.example.Unknown" point="things"><thing name="t"/></extension>' +
        '<extension target="org.nuxeo.agentic.ui.config" point="configuration"><layout type="File" mode="view" src="a"/></extension>' +
        '<!-- <extension target="org.nuxeo.ecm.core.schema.TypeService" point="doctype"><doctype name="Commented"/></extension> --></component>',
    ),
  );
  check(
    'a disabled contribution and a commented one register nothing; an unknown point is listed, not passed',
    JSON.stringify(fixture.registrations.map((each) => `${each.kind}:${each.key}`)) ===
      JSON.stringify(['component:x', 'document type:Kept', 'layout:File/view']) &&
      JSON.stringify(fixture.unknown) === JSON.stringify(['org.example.Unknown#things']),
    JSON.stringify(fixture),
  );
}

// ── The packages as a set ─────────────────────────────────────────────────────────────────────
function theSet() {
  const lts = { name: 'lts', version: '[2025.0,2026.0)' };
  const ui = (version, extra = {}) => ({
    name: 'nuxeo-agentic-ui',
    version,
    dependencies: [],
    conflicts: [],
    targetPlatform: lts,
    artifact: 'server/ui.zip',
    ...extra,
  });
  const kit = (extra = {}) => ({
    name: 'kit',
    version: '0.1.0',
    dependencies: ['nuxeo-agentic-ui:2026.0.2'],
    conflicts: [],
    targetPlatform: lts,
    artifact: 'kits/kit.zip',
    ...extra,
  });
  const sound = setProblems([ui('2026.0.2'), kit()]);
  check(
    'a kit whose dependency and platform the candidate meets',
    sound.length === 0,
    sound.join('; '),
    false,
  );
  const cases = [
    [
      'a dependency at a snapshot of its release',
      [ui('2026.0.2-SNAPSHOT'), kit()],
      /2026\.0\.2-SNAPSHOT, which Nuxeo puts below 2026\.0\.2: a snapshot/,
    ],
    [
      'a dependency at an rc of its release',
      [ui('2026.0.2-rc.1'), kit()],
      /classifier starting rc/,
    ],
    ['a dependency below its least', [ui('2026.0.1'), kit()], /which is below 2026\.0\.2/],
    [
      'a dependency above its most',
      [ui('2026.0.9'), kit({ dependencies: ['nuxeo-agentic-ui:2026.0.2:2026.0.5'] })],
      /above its most, 2026\.0\.5/,
    ],
    [
      'a dependency the candidate does not hold',
      [ui('2026.0.2'), kit({ dependencies: ['nuxeo-agentic-assets:0.1.0'] })],
      /has no package nuxeo-agentic-assets/,
    ],
    [
      'a package named twice',
      [ui('2026.0.2'), kit(), kit({ artifact: 'kits/other.zip' })],
      /are both the package kit/,
    ],
    // Alone: a kit depending on it would add the unmet dependency as a second problem.
    ['a version never stamped', [ui('@VERSION@')], /no version Nuxeo can read/],
    [
      'two packages that conflict',
      [ui('2026.0.2'), kit({ conflicts: ['nuxeo-agentic-ui'] })],
      /cannot be installed together/,
    ],
    [
      'a target platform wider than its dependency',
      [ui('2026.0.2'), kit({ targetPlatform: { name: 'lts', version: '[2025.0,2027.0)' } })],
      /claims platforms its dependency does not install on/,
    ],
    [
      'a target platform of another name',
      [ui('2026.0.2'), kit({ targetPlatform: { name: 'cap', version: '[2025.0,2026.0)' } })],
      /targets the platform cap/,
    ],
    [
      'no target platform, under a dependency with one',
      [ui('2026.0.2'), kit({ targetPlatform: null })],
      /names no target platform/,
    ],
  ];
  for (const [name, packages, says] of cases) {
    const problems = setProblems(packages);
    check(
      `refused: ${name}`,
      problems.length === 1 && says.test(problems[0]),
      problems.join('; ') || 'no problem',
    );
  }
  const descriptor = descriptorOf(
    '<?xml version="1.0"?><!-- <package name="commented" version="9"/> --><package type="addon" name="k" version="1.2.3">' +
      '<target-platform><name> lts </name><version>[2025.0,2026.0)</version></target-platform>' +
      '<dependencies><package> nuxeo-agentic-ui:2026.0.2 </package><package>other</package></dependencies>' +
      '<conflicts><package>old-kit</package></conflicts></package>',
  );
  check(
    "a package.xml's name, version, dependencies, conflicts and target platform, its comments left out",
    descriptor.name === 'k' &&
      descriptor.version === '1.2.3' &&
      JSON.stringify(descriptor.dependencies) ===
        JSON.stringify(['nuxeo-agentic-ui:2026.0.2', 'other']) &&
      JSON.stringify(descriptor.conflicts) === JSON.stringify(['old-kit']) &&
      descriptor.targetPlatform?.name === 'lts' &&
      descriptor.targetPlatform?.version === '[2025.0,2026.0)',
    JSON.stringify(descriptor),
    false,
  );
}

// ── The uncommitted paths the manifest lists, from a real git ─────────────────────────────────
function theUncommittedPaths() {
  const repository = join(scratch, 'status-repository');
  mkdirSync(repository);
  const inIt = (...args) =>
    spawnSync(
      'git',
      ['-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...args],
      {
        cwd: repository,
        encoding: 'utf8',
      },
    );
  inIt('init', '-q');
  writeFileSync(join(repository, 'alpha-file.txt'), 'a\n');
  writeFileSync(join(repository, 'kept.txt'), 'k\n');
  inIt('add', '.');
  inIt('commit', '-q', '-m', 'first');
  inIt('mv', 'alpha-file.txt', 'renamed-file.txt');
  writeFileSync(join(repository, 'kept.txt'), 'changed\n');
  writeFileSync(join(repository, 'new.txt'), 'n\n');
  const status = inIt('status', '--porcelain=v1', '-z', '--untracked-files=all').stdout;
  const paths = uncommittedPaths(status).sort();
  check(
    "a rename's two names, a change and a new file, each whole, as git status names them",
    JSON.stringify(paths) ===
      JSON.stringify(['alpha-file.txt', 'kept.txt', 'new.txt', 'renamed-file.txt']),
    JSON.stringify({ status, paths }),
    false,
  );
}

// ── The bundle the package deploys, against the one built ─────────────────────────────────────
function theBundle() {
  const tree = (label, files) => {
    const root = join(scratch, 'bundles', label);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    return root;
  };
  const built = { 'index.html': '<html>', 'main.js': 'one', 'assets/logo.svg': '<svg/>' };
  const builtRoot = tree('built', built);
  const files = Object.keys(built).sort();
  const same = bundleDifferences(tree('same', built), builtRoot, files);
  check(
    'a deployed bundle the same as the one built, file for file and byte for byte',
    same === null,
    same,
    false,
  );
  const cases = [
    [
      'a file missing',
      tree('missing', { 'index.html': '<html>', 'main.js': 'one' }),
      /^1 file\(s\) missing \(assets\/logo\.svg\)$/,
    ],
    [
      'a file it was not built with',
      tree('extra', { ...built, 'stale.js': 'old' }),
      /^1 file\(s\) it was not built with \(stale\.js\)$/,
    ],
    [
      'a file of other bytes',
      tree('other', { ...built, 'main.js': 'two' }),
      /^1 file\(s\) with other bytes \(main\.js\)$/,
    ],
    ['no bundle deployed at all', join(scratch, 'bundles', 'none'), /^3 file\(s\) missing/],
  ];
  for (const [name, deployed, says] of cases) {
    const said = bundleDifferences(deployed, builtRoot, files);
    check(
      `refused: a deployed bundle with ${name}`,
      said !== null && says.test(said),
      said ?? 'no difference',
    );
  }
}

// ── The kits, read from zips the pipeline built ───────────────────────────────────────────────
/** A kit copied into the scratch folder without its build output, then changed by `change`. */
function kitCopy(source, label, change) {
  const directory = join(scratch, 'kits', label, basename(source));
  cpSync(source, directory, { recursive: true, filter: (path) => basename(path) !== 'dist' });
  change?.((file, from, to) => {
    const path = join(directory, file);
    const text = readFileSync(path, 'utf8');
    if (!text.includes(from))
      throw new Error(`the control's edit does not apply to ${file}: ${from}`);
    writeFileSync(path, text.replace(from, to));
  });
  return directory;
}

/**
 * A kit through the pipeline and read back as the candidate reads it, or why it was not. Built
 * against its deployment's allow-list as the command builds it, with the same function.
 */
function builtKit(directory, label) {
  const out = join(scratch, 'zips', label);
  const built = spawnSync(
    process.execPath,
    [
      join(REPO, 'scripts', 'app-package.mjs'),
      directory,
      '--out',
      out,
      '--platform',
      platformVersion(),
      ...allowListArguments(directory),
    ],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (built.status !== 0)
    return { problem: `the pipeline refused ${label}: ${built.stdout}${built.stderr}` };
  const zip = readdirSync(out).find((name) => name.endsWith('.zip'));
  return { name: basename(directory), read: readKit(join(out, zip), join(scratch, 'read', label)) };
}

function platformVersion() {
  return JSON.parse(readFileSync(join(REPO, 'libs', 'platform', 'package.json'), 'utf8')).version;
}

function kitsFromZips() {
  // The allow-list is what passes the kit's operation buttons, not a step skipped: the same kit
  // with its deployment folder taken away is refused for the operations its buttons run.
  const noAllowList = kitCopy(PAYERS, 'no-allow-list');
  rmSync(join(noAllowList, 'deployment'), { recursive: true, force: true });
  const unlisted = builtKit(noAllowList, 'no-allow-list');
  check(
    "refused: the Payers kit built with no deployment allow-list, for its buttons' operations",
    unlisted.problem !== undefined &&
      /is not on this deployment's allow-list/.test(unlisted.problem) &&
      /step 2 refused it/.test(unlisted.problem),
    unlisted.problem ?? 'built',
  );
  const payers = builtKit(PAYERS, 'payers');
  const contracts = builtKit(CONTRACTS, 'contracts');
  if (payers.problem || contracts.problem) {
    check(
      'the Payers and Contracts kits through the pipeline',
      false,
      payers.problem ?? contracts.problem,
      false,
    );
    return;
  }
  const sets = (...kits) =>
    duplicatesAcross(kits.map((kit) => ({ name: kit.name, contributes: kit.read.contributes })));
  const sound = sets(payers, contracts);
  check(
    'two kits from the repository, read from their zips, contribute no name in common',
    sound.length === 0 &&
      payers.read.contributes.some(
        (each) => each.kind === 'queue' && each.key === 'unassigned-claims',
      ) &&
      payers.read.contributes.some(
        (each) => each.kind === 'action' && each.key === 'payers.claim.pay',
      ) &&
      contracts.read.contributes.some(
        (each) => each.kind === 'address' && each.key === 'contract-desk',
      ),
    JSON.stringify(sound),
    false,
  );
  const sameApp = builtKit(
    kitCopy(CONTRACTS, 'same-app', (edit) => {
      edit('bundle/agentic-ui-config/app.json', '"id": "contracts"', '"id": "payers-claims"');
      edit(
        'bundle/OSGI-INF/contracts-demo-config.xml',
        '<app id="contracts"',
        '<app id="payers-claims"',
      );
    }),
    'same-app',
  );
  const appDuplicates = sameApp.problem ? null : sets(payers, sameApp);
  check(
    "refused: a kit given another's app id, and only that",
    appDuplicates !== null &&
      appDuplicates.length === 1 &&
      appDuplicates[0].kind === 'app id' &&
      appDuplicates[0].key === 'payers-claims',
    sameApp.problem ?? JSON.stringify(appDuplicates),
  );
  const sameType = builtKit(
    kitCopy(CONTRACTS, 'same-type', (edit) =>
      edit(
        'bundle/OSGI-INF/contracts-demo-model.xml',
        'point="doctype">',
        'point="doctype">\n    <doctype name="Claim" extends="Document" />',
      ),
    ),
    'same-type',
  );
  const typeDuplicates = sameType.problem ? null : sets(payers, sameType);
  check(
    "refused: a kit given another's document type, and only that",
    typeDuplicates !== null &&
      typeDuplicates.length === 1 &&
      typeDuplicates[0].kind === 'document type' &&
      typeDuplicates[0].key === 'Claim',
    sameType.problem ?? JSON.stringify(typeDuplicates),
  );
}

// ── The command's refusals ────────────────────────────────────────────────────────────────────
function command(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function theCommand() {
  const usage = command([]);
  check(
    'refused: no --out and no --since, exit 2',
    usage.status === 2 && /usage:/.test(usage.stderr),
    usage.stderr,
  );

  const earlier = join(scratch, 'earlier');
  mkdirSync(earlier);
  writeFileSync(join(earlier, 'manifest.json'), '{"an earlier candidate": true}\n');
  const overwrite = command(['--out', earlier, '--since', 'HEAD']);
  check(
    'refused: an earlier output directory, exit 2, and left as it was',
    overwrite.status === 2 &&
      /never overwrites an earlier one/.test(overwrite.stderr) &&
      JSON.stringify(readdirSync(earlier)) === JSON.stringify(['manifest.json']) &&
      readFileSync(join(earlier, 'manifest.json'), 'utf8') === '{"an earlier candidate": true}\n',
    `${overwrite.status} ${overwrite.stderr}`,
  );
  const file = join(scratch, 'a-file');
  writeFileSync(file, 'x');
  const onFile = command(['--out', file, '--since', 'HEAD']);
  check(
    'refused: an output that is a file, exit 2',
    onFile.status === 2 &&
      /never overwrites/.test(onFile.stderr) &&
      readFileSync(file, 'utf8') === 'x',
    onFile.stderr,
  );

  const asKit = join(PACKAGES, `release-candidate-selftest-${process.pid}`);
  const underPackages = command(['--out', asKit, '--since', 'HEAD']);
  check(
    'refused: an output under business-apps/packages/, exit 2, nothing made',
    underPackages.status === 2 &&
      /is inside the repository/.test(underPackages.stderr) &&
      !existsSync(asKit),
    underPackages.stderr,
  );
  // Elsewhere in the repository, given relative to it, where the command runs.
  const inRepository = join(REPO, `release-candidate-selftest-${process.pid}`);
  const inside = command(['--out', basename(inRepository), '--since', 'HEAD']);
  check(
    'refused: an output elsewhere inside the repository, exit 2, nothing made',
    inside.status === 2 &&
      /is inside the repository/.test(inside.stderr) &&
      !existsSync(inRepository),
    inside.stderr,
  );
  const noParent = join(scratch, 'no-such-folder', 'candidate');
  const orphan = command(['--out', noParent, '--since', 'HEAD']);
  check(
    'refused: an output whose folder is not there, exit 2, and the folder not made',
    orphan.status === 2 && /is not a folder/.test(orphan.stderr) && !existsSync(dirname(noParent)),
    orphan.stderr,
  );
  // A folder reached through a link, as macOS's /tmp is, is a folder: the run goes on to --since.
  mkdirSync(join(scratch, 'real-folder'));
  symlinkSync(join(scratch, 'real-folder'), join(scratch, 'linked-folder'));
  const throughLink = command([
    '--out',
    join(scratch, 'linked-folder', 'candidate'),
    '--since',
    'refs/heads/no-such-branch-for-the-selftest',
  ]);
  check(
    'an output in a folder reached through a link is taken, and nothing is made before --since is read',
    throughLink.status === 2 &&
      /is not a commit/.test(throughLink.stderr) &&
      readdirSync(join(scratch, 'real-folder')).length === 0,
    throughLink.stderr,
    false,
  );
  const fresh = join(scratch, 'fresh');
  const noCommit = command([
    '--out',
    fresh,
    '--since',
    'refs/heads/no-such-branch-for-the-selftest',
  ]);
  check(
    'refused: a --since that is no commit, exit 2, nothing made',
    noCommit.status === 2 && /is not a commit/.test(noCommit.stderr) && !existsSync(fresh),
    noCommit.stderr,
  );
  const twice = command(['--out', fresh, '--out', join(scratch, 'other'), '--since', 'HEAD']);
  check(
    'refused: --out given twice, exit 2',
    twice.status === 2 && /usage:/.test(twice.stderr) && !existsSync(fresh),
    twice.stderr,
  );
  const badVersion = command(['--out', fresh, '--since', 'HEAD', '--version', '../2026']);
  check(
    'refused: a version a candidate cannot carry, exit 2, nothing made',
    badVersion.status === 2 &&
      /is not a version a release candidate can carry/.test(badVersion.stderr) &&
      !existsSync(fresh),
    badVersion.stderr,
  );
}

// ── The demo listing ──────────────────────────────────────────────────────────────────────────
async function theDemoListing() {
  const kits = readdirSync(PACKAGES)
    .sort()
    .map((name) => ({ name, version: 'x', directory: join(PACKAGES, name) }));
  const { problems, listing } = await demoSteps({
    repo: REPO,
    stepsDir: join(REPO, 'scripts', 'beta-harness', 'steps'),
    kits,
  });
  const of = (kit) => listing.find((each) => each.kit === kit)?.files ?? [];
  const demo = of('payers-claims-demo').find((each) =>
    each.file.endsWith('/payers-claims-demo.mjs'),
  );
  check(
    "the repository's kit demos listed, with their people, seeds and environment",
    problems.length === 0 &&
      of('payers-claims-demo').length === 4 &&
      of('brand-assets-demo').length === 3 &&
      demo?.runAs.users.includes('dana.lee') &&
      demo?.signsInAs.length === 1 &&
      demo?.environment.includes('PAYERS_DEMO_PASSWORD') &&
      demo?.seeds[0]?.file === 'business-apps/packages/payers-claims-demo/demo/seed.mjs' &&
      demo?.seeds[0]?.environment.includes('PAYERS_DEMO_PASSWORD') &&
      demo?.steps[0]?.startsWith('Preconditions') &&
      demo?.steps.at(-1) === 'Health',
    `${problems.join('; ')} ${JSON.stringify(demo)}`,
    false,
  );
  // The operation buttons' demo: its adjuster, the member services person it signs in through the
  // REST API, and the deployment contribution a server run needs beside the kit.
  const operations = of('payers-claims-demo').find((each) =>
    each.file.endsWith('/payers-operations.mjs'),
  );
  check(
    "the operation buttons' demo listed, with its people and the deployment's allow-list it needs",
    JSON.stringify(operations?.runAs.users) === JSON.stringify(['dana.lee']) &&
      JSON.stringify(operations?.signsInAs) === JSON.stringify(['riley.brooks']) &&
      operations?.environment.includes('PAYERS_DEMO_PASSWORD') &&
      operations?.needs.some((need) => need.includes('payers-claims-demo-operations-config.xml')) &&
      operations?.steps.at(-1) === 'Health',
    JSON.stringify(operations),
    false,
  );

  let parse;
  try {
    ({ parse } = await import('acorn'));
  } catch {
    check('acorn, for reading a steps file', false, 'not installed: run npm ci');
    return;
  }
  const read = readSource(
    "await h.step('One');\nconst a = process.env['A'] ?? process.env.B;\n" +
      "requireStepCredentials('x');\n// await h.step('commented');\nawait h.step(`Two ${n}`);\n",
    parse,
  );
  check(
    "a source's step labels, a template's substitution shown, a comment's left out, and the environment it reads",
    JSON.stringify(read.steps) === JSON.stringify(['One', 'Two ${n}']) &&
      JSON.stringify(read.environment) === JSON.stringify(['A', 'B']) &&
      read.credentials,
    JSON.stringify(read),
    false,
  );

  const steps = join(scratch, 'steps');
  mkdirSync(steps);
  const kitPath = "join('', 'business-apps', 'packages', 'payers-claims-demo')";
  const write = (name, body) =>
    writeFileSync(
      join(steps, name),
      `import { join } from 'node:path';\nconst KIT = ${kitPath};\n${body}\nexport default async function run(page, h) { await h.step('One'); }\n`,
    );
  write('no-declaration.mjs', '');
  const undeclared = await demoSteps({ repo: REPO, stepsDir: steps, kits });
  check(
    'refused: a steps file that names a kit and declares no serverRun',
    undeclared.problems.length === 1 && /exports no serverRun/.test(undeclared.problems[0]),
    undeclared.problems.join('; '),
  );
  rmSync(join(steps, 'no-declaration.mjs'));
  write(
    'another-kit.mjs',
    "export const serverRun = { kit: 'contracts-demo', seeds: [], runAs: { users: [], who: 'x' }, signsInAs: [], needs: [] };",
  );
  const another = await demoSteps({ repo: REPO, stepsDir: steps, kits });
  check(
    'refused: a steps file that declares its serverRun for a kit it does not name',
    another.problems.length === 1 && /declares the kit "contracts-demo"/.test(another.problems[0]),
    another.problems.join('; '),
  );
  rmSync(join(steps, 'another-kit.mjs'));
  write(
    'no-seed.mjs',
    "export const serverRun = { kit: 'payers-claims-demo', seeds: ['demo/no-such-seed.mjs'], runAs: { users: [], who: 'x' }, signsInAs: [], needs: [] };",
  );
  const noSeed = await demoSteps({ repo: REPO, stepsDir: steps, kits });
  check(
    'refused: a steps file that needs a seed its kit does not have',
    noSeed.problems.length === 1 &&
      /needs the seed demo\/no-such-seed\.mjs/.test(noSeed.problems[0]),
    noSeed.problems.join('; '),
  );
}
