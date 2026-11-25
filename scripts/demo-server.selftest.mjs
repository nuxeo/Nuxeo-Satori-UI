#!/usr/bin/env node
/**
 * Controls for the demo server's provisioning (`demo-server.mjs`, its plan in
 * `demo-server-plan.mjs` and what it asks of the machine in `demo-server-host.mjs`).
 *
 * Offline: no Docker, no Nuxeo, no network. Docker is a stand-in on the PATH and in
 * DEMO_SERVER_DOCKER that records every command and answers as Docker does; Nuxeo is a stand-in
 * HTTP server answering the few calls the command makes. A candidate is written here, its zips
 * built byte by byte, as `release-candidate.mjs` lays one out. The kits' seeds, deployment
 * configuration and app definitions are this clone's, at HEAD.
 *
 * - **The plan.** The packages in dependency order, the add-on with no package found by its bytes,
 *   the deployment's allow-list from the commit, the seeds and the passwords they read; refused: a
 *   candidate missing a dependency, one held at a version that does not meet it, a target platform
 *   that leaves the image's Nuxeo out, dependencies that go round, a changed, extra, missing or
 *   linked file, a zip whose descriptor is not the manifest's, a commit this clone does not have,
 *   and a kit built with uncommitted changes.
 * - **The arguments.** Each option's refusals, and the project and ports that could be the
 *   developer's.
 * - **The secrets.** Each one unset, the image's default, a short one, and the administrator's
 *   given to the demo users.
 * - **What the plan says.** The install script installs in the plan's order and stops at the first
 *   failure; each kit's `config:dev` command holds the arguments its README's does; the compose file
 *   declares the stack the plan describes.
 * - **The machine.** Docker's resources of the project, by label and by name; a port in use; the
 *   wait for the server, ended by its container stopping and by its deadline; the administrator's
 *   password changed and the default refused, against a stand-in that refuses the default first and
 *   one that keeps it; the Component Loading Status; a seed's environment.
 * - **The command.** Refused with nothing made and no Docker command that changes anything: each
 *   secret unset, an existing project, a candidate missing a dependency. A dry run that changes
 *   nothing. A run whose start fails, stopped; one whose copy fails, removed; one that comes up,
 *   with its calls in order. No run prints a secret or puts one on a command line, and no run pushes,
 *   builds, tags or logs in.
 *
 * Node at the version `.nvmrc` pins, git and `unzip`; acorn, installed by `npm ci`.
 *
 * Usage: node scripts/demo-server.selftest.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

import {
  componentStatus,
  existingResources,
  Failure,
  portInUse,
  quietEnvironment,
  seedEnvironment,
  setAdministratorPassword,
  waitForServer,
} from './demo-server-host.mjs';
import {
  ADMIN_PASSWORD,
  buildPlan,
  CLID,
  configDevCommand,
  DEFAULTS,
  fromCommit,
  initScript,
  installOrder,
  kitFolders,
  parseArguments,
  parseSums,
  readCandidate,
  readPackages,
  Refusal,
  requiredSecrets,
  secretProblems,
  STACK,
  stackNames,
  stepsText,
} from './demo-server-plan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'scripts', 'demo-server.mjs');

const pinned = readFileSync(join(REPO, '.nvmrc'), 'utf8').trim().replace(/^v/, '').split('.')[0];
if (process.versions.node.split('.')[0] !== pinned) {
  console.error(
    `The command runs on Node ${pinned}, which .nvmrc pins, and this is ${process.versions.node}.`,
  );
  process.exit(2);
}
const { parse } = await import('acorn');
const HEAD = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();

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

/** What `fn` threw, or `null`: a refusal is expected to be a `Refusal` or a `Failure`. */
function thrown(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}
async function thrownAsync(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}

/** Distinctive values, so that a print of any of them is found. */
const SECRETS = {
  [CLID]: 'clid-selftest-4f1e--9a7c2b5d8e6f0a13',
  [ADMIN_PASSWORD]: 'admin-selftest-Zq7vX2mPw9',
  PAYERS_DEMO_PASSWORD: 'demo-selftest-Kp3wR8nTq1',
};

const scratch = mkdtempSync(join(tmpdir(), 'demo-server-selftest-'));

// ── The candidate, written here ───────────────────────────────────────────────────────────────
/** A zip with every entry stored, as `unzip` reads one. */
function storedZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const title = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(title.length, 26);
    parts.push(local, title, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(title.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, title);
    offset += 30 + title.length + data.length;
  }
  const size = central.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

const packageXml = ({ name, version, dependencies = [], platform = '[2025.0,2026.0)' }) =>
  `<package type="addon" name="${name}" version="${version}">\n` +
  `  <target-platform>\n    <name>lts</name>\n    <version>${platform}</version>\n  </target-platform>\n` +
  (dependencies.length > 0
    ? `  <dependencies>\n${dependencies.map((each) => `    <package>${each}</package>`).join('\n')}\n  </dependencies>\n`
    : '') +
  '</package>\n';

const CORE = Buffer.from('the nuxeo-agentic-core bundle');
const ASSETS = Buffer.from('the nuxeo-agentic-assets bundle');
const CONNECTORS = Buffer.from('the nuxeo-agentic-connectors bundle');

/** The packages of a candidate like staging's, each `{ kind, name, version, dependencies, path, entries }`. */
function soundPackages() {
  const ui = 'nuxeo-agentic-ui:2026.0.2';
  const kit = (name, version, dependencies = [ui]) => ({
    kind: 'kit',
    name,
    version,
    dependencies,
    path: `kits/${name}-${version}.zip`,
    entries: [
      { name: `install/bundles/${name}-${version}.jar`, data: Buffer.from(`${name} bundle`) },
    ],
  });
  return [
    {
      kind: 'server package',
      name: 'nuxeo-agentic-ui',
      version: '2026.0.2',
      dependencies: [],
      path: 'server/nuxeo-agentic-ui-package-2026.0.2.zip',
      entries: [{ name: 'install/bundles/nuxeo-agentic-core.jar', data: CORE }],
    },
    {
      kind: 'server package',
      name: 'nuxeo-agentic-assets',
      version: '0.1.0',
      dependencies: [],
      path: 'server/nuxeo-agentic-assets-0.1.0.zip',
      entries: [{ name: 'install/bundles/nuxeo-agentic-assets.jar', data: ASSETS }],
    },
    kit('brand-assets-demo', '0.2.0', [ui, 'nuxeo-agentic-assets:0.1.0']),
    kit('contracts-demo', '0.2.0'),
    kit('facilities-demo', '0.1.0'),
    kit('payers-claims-demo', '0.5.0'),
  ];
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * A release candidate in a new folder, as `release-candidate.mjs` writes one: the packages' zips,
 * the bundles, a client listing, `manifest.json` and `SHA256SUMS`. `packages` and `bundles` say
 * what it holds; `manifest` changes the manifest before the checksums are written.
 */
function writeCandidate(
  name,
  { packages = soundPackages(), bundles = null, manifest = (each) => each } = {},
) {
  const out = join(scratch, name);
  const write = (path, bytes) => {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), bytes);
    return { path, sha256: sha256(bytes), bytes: bytes.length };
  };
  const artifacts = [
    write('client/nuxeo-ui-2026.0.2.sha256', Buffer.from('0  nuxeo-ui/browser/index.html\n')),
  ];
  artifacts[0] = { kind: 'client bundle', name: 'nuxeo-ui', version: '2026.0.2', ...artifacts[0] };
  const loose =
    bundles ??
    [
      { name: 'nuxeo-agentic-core', data: CORE },
      { name: 'nuxeo-agentic-assets', data: ASSETS },
      { name: 'nuxeo-agentic-connectors', data: CONNECTORS },
    ].filter(
      (each) =>
        each.name !== 'nuxeo-agentic-assets' ||
        packages.some((pkg) => pkg.name === 'nuxeo-agentic-assets'),
    );
  for (const each of loose)
    artifacts.push({
      kind: 'bundle',
      name: each.name,
      version: '2026.0.2',
      ...write(`server/${each.name}-2026.0.2.jar`, each.data),
    });
  for (const pkg of packages) {
    const zip = storedZip([
      { name: 'package.xml', data: Buffer.from(pkg.xml ?? packageXml(pkg)) },
      { name: 'install.xml', data: Buffer.from('<install/>\n') },
      ...pkg.entries,
    ]);
    artifacts.push({
      kind: pkg.kind,
      name: pkg.name,
      version: pkg.version,
      ...write(pkg.path, zip),
    });
  }
  const kits = packages.filter((pkg) => pkg.kind === 'kit');
  const body = manifest({
    format: 'nuxeo-satori-release-candidate/1',
    version: '2026.0.2',
    commit: HEAD,
    uncommitted: [],
    since: { ref: 'HEAD', commit: HEAD },
    platform: { name: '@nuxeo/satori-platform', version: '0.2.0' },
    artifacts,
    kits: kits.map((kit) => ({
      name: kit.name,
      version: kit.version,
      dependencies: kit.dependencies,
      targetPlatform: { name: 'lts', version: '[2025.0,2026.0)' },
    })),
    removedSince: [],
    notCompared: [],
    demoSteps: kits.map((kit) => ({
      kit: kit.name,
      name: kit.name,
      version: kit.version,
      files:
        kit.name === 'payers-claims-demo'
          ? [
              {
                kit: kit.name,
                file: 'scripts/beta-harness/steps/payers-operations.mjs',
                seeds: [],
                runAs: { users: ['dana.lee'], who: 'an adjuster' },
                signsInAs: ['riley.brooks'],
                environment: ['NUXEO_PASS', 'NUXEO_USER', 'PAYERS_DEMO_PASSWORD'],
                needs: ['the kit 0.5.0 or later installed'],
                steps: ['One'],
              },
            ]
          : [],
    })),
  });
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(body, null, 2)}\n`);
  const listed = [];
  const walk = (prefix = '') => {
    for (const entry of readdirSync(join(out, prefix), { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(`${path}/`);
      else if (path !== 'SHA256SUMS')
        listed.push(`${sha256(readFileSync(join(out, path)))}  ${path}\n`);
    }
  };
  walk();
  writeFileSync(join(out, 'SHA256SUMS'), listed.join(''));
  return out;
}

const OPTIONS = {
  project: 'satori-demo-selftest',
  port: 18080,
  bind: '127.0.0.1',
  wait: 5,
  dryRun: true,
};

// ── The plan ──────────────────────────────────────────────────────────────────────────────────
function thePlan() {
  const sound = writeCandidate('sound');
  const candidate = readCandidate(sound);
  check('a sound candidate is read, every file held to SHA256SUMS', candidate.files > 0, '', false);
  const plan = buildPlan({ repo: REPO, candidate, options: OPTIONS, parse });
  const order = plan.install.map((each) => each.name);
  check(
    'the packages in dependency order: the server packages first, each kit after what it depends on',
    JSON.stringify(order) ===
      JSON.stringify([
        'nuxeo-agentic-assets',
        'nuxeo-agentic-ui',
        'brand-assets-demo',
        'contracts-demo',
        'facilities-demo',
        'payers-claims-demo',
      ]),
    order.join(', '),
    false,
  );
  check(
    'the add-on with no package is found by its bytes: the connectors, not the bundles the packages carry',
    JSON.stringify(plan.bundles.map((each) => each.name)) ===
      JSON.stringify(['nuxeo-agentic-connectors']),
    JSON.stringify(plan.bundles),
    false,
  );
  check(
    "the operation buttons' allow-list is the deployment configuration, read from the commit",
    plan.config.length === 1 &&
      plan.config[0].name === 'payers-claims-demo-operations-config.xml' &&
      plan.config[0].text ===
        spawnSync(
          'git',
          [
            'show',
            `${HEAD}:business-apps/packages/payers-claims-demo/deployment/payers-claims-demo-operations-config.xml`,
          ],
          { cwd: REPO, encoding: 'utf8' },
        ).stdout,
    JSON.stringify(plan.config.map((each) => each.source)),
    false,
  );
  check(
    'a seed for each kit that has one, in install order, with the passwords each reads',
    JSON.stringify(plan.seeds.map((each) => [each.kit, each.passwords])) ===
      JSON.stringify([
        ['brand-assets-demo', []],
        ['contracts-demo', []],
        ['payers-claims-demo', ['PAYERS_DEMO_PASSWORD']],
      ]),
    JSON.stringify(plan.seeds.map((each) => [each.kit, each.passwords])),
    false,
  );
  check(
    'the secrets a run needs, by name',
    JSON.stringify(plan.secrets) === JSON.stringify([CLID, ADMIN_PASSWORD, 'PAYERS_DEMO_PASSWORD']),
    plan.secrets.join(', '),
    false,
  );

  // A candidate missing a dependency: the brand kit's add-on left out, the checksums still whole.
  const missing = writeCandidate('missing-dependency', {
    packages: soundPackages().filter((each) => each.name !== 'nuxeo-agentic-assets'),
  });
  const short = thrown(() =>
    buildPlan({ repo: REPO, candidate: readCandidate(missing), options: OPTIONS, parse }),
  );
  check(
    'refused: a candidate missing a dependency, naming the kit and the package',
    short instanceof Refusal &&
      /brand-assets-demo 0\.2\.0 depends on nuxeo-agentic-assets:0\.1\.0, and the candidate has no package nuxeo-agentic-assets/.test(
        short.message,
      ),
    short?.message,
  );
  const below = soundPackages();
  below.find((each) => each.name === 'contracts-demo').dependencies = ['nuxeo-agentic-ui:2026.0.3'];
  const unmet = thrown(() =>
    installOrder(
      readPackages(readCandidate(writeCandidate('unmet', { packages: below }))).packages,
    ),
  );
  check(
    'refused: a dependency held at a version that does not meet it',
    unmet instanceof Refusal &&
      /contracts-demo 0\.2\.0 depends on nuxeo-agentic-ui:2026\.0\.3/.test(unmet.message),
    unmet?.message,
  );
  const elsewhere = soundPackages();
  for (const each of elsewhere) each.platform = '[2023.0,2024.0)';
  const platform = thrown(() =>
    installOrder(
      readPackages(readCandidate(writeCandidate('platform', { packages: elsewhere }))).packages,
    ),
  );
  check(
    "refused: a target platform that leaves the image's Nuxeo out",
    platform instanceof Refusal &&
      /leaves out the demo server's Nuxeo 2025\.10\.18/.test(platform.message),
    platform?.message,
  );
  const round = [
    {
      kind: 'kit',
      name: 'a',
      version: '1.0.0',
      dependencies: ['b:1.0.0'],
      conflicts: [],
      targetPlatform: null,
      artifact: 'a',
    },
    {
      kind: 'kit',
      name: 'b',
      version: '1.0.0',
      dependencies: ['a:1.0.0'],
      conflicts: [],
      targetPlatform: null,
      artifact: 'b',
    },
  ];
  const cycle = thrown(() => installOrder(round));
  check(
    'refused: dependencies that go round',
    cycle instanceof Refusal && /go round, between a, b/.test(cycle.message),
    cycle?.message,
  );
  const conflicting = soundPackages();
  conflicting.find((each) => each.name === 'facilities-demo').xml = packageXml({
    name: 'facilities-demo',
    version: '0.1.0',
    dependencies: ['nuxeo-agentic-ui:2026.0.2'],
  }).replace(
    '</package>',
    '  <conflicts>\n    <package>contracts-demo</package>\n  </conflicts>\n</package>',
  );
  const conflict = thrown(() =>
    installOrder(
      readPackages(readCandidate(writeCandidate('conflict', { packages: conflicting }))).packages,
    ),
  );
  check(
    'refused: a package that conflicts with another',
    conflict instanceof Refusal && /conflicts with contracts-demo/.test(conflict.message),
    conflict?.message,
  );

  // The candidate is what was built: a byte, a file, a link.
  const changed = writeCandidate('changed');
  appendFileSync(join(changed, 'kits', 'contracts-demo-0.2.0.zip'), 'x');
  const different = thrown(() => readCandidate(changed));
  check(
    'refused: a file whose digest is not the one SHA256SUMS gives',
    different instanceof Refusal &&
      /contracts-demo-0\.2\.0\.zip does not have the digest/.test(different.message),
    different?.message,
  );
  const extra = writeCandidate('extra');
  writeFileSync(join(extra, 'kits', 'smuggled-1.0.0.zip'), 'x');
  const added = thrown(() => readCandidate(extra));
  check(
    'refused: a file SHA256SUMS does not list',
    added instanceof Refusal &&
      /does not list, the first kits\/smuggled-1\.0\.0\.zip/.test(added.message),
    added?.message,
  );
  const gone = writeCandidate('gone');
  rmSync(join(gone, 'server', 'nuxeo-agentic-connectors-2026.0.2.jar'));
  const absent = thrown(() => readCandidate(gone));
  check(
    'refused: a file SHA256SUMS lists and the candidate does not hold',
    absent instanceof Refusal &&
      /nuxeo-agentic-connectors-2026\.0\.2\.jar, which the candidate does not hold/.test(
        absent.message,
      ),
    absent?.message,
  );
  const linked = writeCandidate('linked');
  symlinkSync('/etc/hosts', join(linked, 'server', 'hosts'));
  const link = thrown(() => readCandidate(linked));
  check(
    'refused: a symbolic link in the candidate',
    link instanceof Refusal &&
      /server\/hosts in the candidate is a symbolic link/.test(link.message),
    link?.message,
  );
  const format = thrown(() =>
    readCandidate(
      writeCandidate('format', { manifest: (each) => ({ ...each, format: 'something-else/1' }) }),
    ),
  );
  check(
    'refused: a manifest in another format',
    format instanceof Refusal && /in the format "something-else\/1"/.test(format.message),
    format?.message,
  );
  const renamed = soundPackages();
  renamed.find((each) => each.name === 'payers-claims-demo').xml = packageXml({
    name: 'payers-claims-demo',
    version: '0.4.1',
    dependencies: ['nuxeo-agentic-ui:2026.0.2'],
  });
  const descriptor = thrown(() =>
    readPackages(readCandidate(writeCandidate('descriptor', { packages: renamed }))),
  );
  check(
    "refused: a zip whose package.xml is not the manifest's package",
    descriptor instanceof Refusal &&
      /is payers-claims-demo 0\.4\.1 to its package\.xml, and payers-claims-demo 0\.5\.0 to manifest\.json/.test(
        descriptor.message,
      ),
    descriptor?.message,
  );
  for (const [line, why] of [
    ['../etc/passwd', 'outside the candidate'],
    ['/etc/passwd', 'outside the candidate'],
    ['kits//a.zip', 'outside the candidate'],
  ]) {
    const error = thrown(() => parseSums(`${'0'.repeat(64)}  ${line}\n`));
    check(
      `refused: a SHA256SUMS path ${line}`,
      error instanceof Refusal && error.message.includes(why),
      error?.message,
    );
  }
  const twice = thrown(() => parseSums(`${'0'.repeat(64)}  a\n${'1'.repeat(64)}  a\n`));
  check(
    'refused: a SHA256SUMS path listed twice',
    twice instanceof Refusal && /lists a twice/.test(twice.message),
    twice?.message,
  );

  // The commit holds the seeds and the configuration.
  const kits = kitFolders(candidate.manifest);
  const nowhere = thrown(() =>
    fromCommit({
      repo: REPO,
      manifest: { ...candidate.manifest, commit: 'f'.repeat(40) },
      kits,
      parse,
    }),
  );
  check(
    'refused: a commit this clone does not have',
    nowhere instanceof Refusal && /which this clone does not have/.test(nowhere.message),
    nowhere?.message,
  );
  const dirty = thrown(() =>
    fromCommit({
      repo: REPO,
      manifest: {
        ...candidate.manifest,
        uncommitted: ['business-apps/packages/payers-claims-demo/demo/seed.mjs'],
      },
      kits,
      parse,
    }),
  );
  check(
    "refused: a kit built with uncommitted changes, whose commit's seed is not the candidate's",
    dirty instanceof Refusal &&
      /1 uncommitted change\(s\) in business-apps\/packages\/payers-claims-demo/.test(
        dirty.message,
      ),
    dirty?.message,
  );
  const elsewhereChange = fromCommit({
    repo: REPO,
    manifest: { ...candidate.manifest, uncommitted: ['docs/business-apps/README.md'] },
    kits,
    parse,
  });
  check(
    'an uncommitted change outside every kit is not a refusal',
    elsewhereChange.seeds.length === 3,
    '',
    false,
  );
  const strange = thrown(() =>
    kitFolders({ kits: [{ name: 'x' }], demoSteps: [{ name: 'x', kit: '../../etc' }] }),
  );
  check(
    'refused: a kit folder that climbs out of business-apps/packages',
    strange instanceof Refusal,
    strange?.message,
  );
  return plan;
}

// ── The arguments ─────────────────────────────────────────────────────────────────────────────
function theArguments() {
  const sound = parseArguments(['--candidate', '/tmp/x']);
  check(
    'the defaults: project satori-demo, port 18080 on 127.0.0.1, a real run',
    sound.options?.project === DEFAULTS.project &&
      sound.options.port === 18080 &&
      sound.options.bind === '127.0.0.1' &&
      sound.options.dryRun === false,
    JSON.stringify(sound),
    false,
  );
  const given = parseArguments([
    '--candidate',
    'c',
    '--project',
    'satori-demo-payers',
    '--port',
    '18090',
    '--bind',
    '0.0.0.0',
    '--wait',
    '60',
    '--dry-run',
  ]);
  check(
    'every option taken as given',
    given.options?.project === 'satori-demo-payers' &&
      given.options.port === 18090 &&
      given.options.bind === '0.0.0.0' &&
      given.options.wait === 60 &&
      given.options.dryRun,
    JSON.stringify(given),
    false,
  );
  for (const [args, pattern, what] of [
    [[], /--candidate is required/, 'no --candidate'],
    [['--candidate'], /--candidate needs a value/, '--candidate with no value'],
    [['--candidate', ''], /--candidate needs a value/, 'an empty --candidate'],
    [['--candidate', '--dry-run'], /--candidate needs a value/, 'an option taken for a value'],
    [
      ['--candidate', 'a', '--candidate', 'b'],
      /--candidate is given twice/,
      'an option given twice',
    ],
    [['--candidate', 'a', '--force'], /--force is not an option/, 'an option it does not take'],
    [
      ['--candidate', 'a', '--project', 'nuxeo'],
      /--project nuxeo is not a demo server's/,
      "the project nuxeo, whose OpenSearch container would be the developer's",
    ],
    [
      ['--candidate', 'a', '--project', 'satori-demo_x'],
      /is not a demo server's/,
      'a project of another form',
    ],
    [
      ['--candidate', 'a', '--project', 'Satori-Demo'],
      /is not a demo server's/,
      'a project in capitals',
    ],
    [
      ['--candidate', 'a', '--port', '8080'],
      /--port 8080 is the local Nuxeo's/,
      "the local Nuxeo's port",
    ],
    [
      ['--candidate', 'a', '--port', '4300'],
      /--port 4300 is the development server's/,
      "the steps' development server's port",
    ],
    [['--candidate', 'a', '--port', '80'], /is not a port from 1024/, 'a port below 1024'],
    [['--candidate', 'a', '--port', '18080x'], /is not a port/, 'a port that is not a number'],
    [
      ['--candidate', 'a', '--bind', 'localhost'],
      /is not an IPv4 address/,
      'an address that is a name',
    ],
    [['--candidate', 'a', '--wait', '0'], /is not a number of seconds/, 'a wait of none'],
  ]) {
    const result = parseArguments(args);
    check(
      `refused: ${what}`,
      typeof result.error === 'string' && pattern.test(result.error),
      result.error ?? JSON.stringify(result),
    );
  }
  const names = stackNames('satori-demo');
  check(
    "the project's containers can be neither of the developer's",
    !Object.values(names.containers).includes('nuxeo') &&
      !Object.values(names.containers).includes('nuxeo-opensearch'),
    JSON.stringify(names),
    false,
  );
}

// ── The secrets ───────────────────────────────────────────────────────────────────────────────
function theSecrets() {
  const required = requiredSecrets([{ passwords: ['PAYERS_DEMO_PASSWORD'] }, { passwords: [] }]);
  check(
    'none refused when each is set',
    secretProblems(SECRETS, required).length === 0,
    secretProblems(SECRETS, required).join('; '),
    false,
  );
  for (const name of required) {
    const problems = secretProblems({ ...SECRETS, [name]: undefined }, required);
    check(
      `refused: ${name} unset`,
      problems.length === 1 && problems[0].startsWith(`${name} is not set`),
      problems.join('; '),
    );
    const empty = secretProblems({ ...SECRETS, [name]: '' }, required);
    check(
      `refused: ${name} empty`,
      empty.length === 1 && empty[0].startsWith(`${name} is not set`),
      empty.join('; '),
    );
  }
  const fallback = secretProblems({ ...SECRETS, [ADMIN_PASSWORD]: 'Administrator' }, required);
  check(
    "refused: the administrator's password left as the image's default",
    fallback.some((each) => /the image's default/.test(each)),
    fallback.join('; '),
  );
  const weak = secretProblems({ ...SECRETS, [ADMIN_PASSWORD]: 'short-one' }, required);
  check(
    "refused: an administrator's password shorter than 12 characters",
    weak.some((each) => /shorter than 12/.test(each)),
    weak.join('; '),
  );
  const shared = secretProblems(
    { ...SECRETS, PAYERS_DEMO_PASSWORD: SECRETS[ADMIN_PASSWORD] },
    required,
  );
  check(
    "refused: the demo users given the administrator's password",
    shared.some((each) => /PAYERS_DEMO_PASSWORD is the administrator's password/.test(each)),
    shared.join('; '),
  );
  const all = [
    ...required.flatMap((name) => secretProblems({ ...SECRETS, [name]: undefined }, required)),
    ...fallback,
    ...weak,
    ...shared,
  ].join('\n');
  check(
    'no refusal names a value',
    !Object.values(SECRETS).some((value) => all.includes(value)),
    '',
    false,
  );
}

// ── What the plan says ────────────────────────────────────────────────────────────────────────
function whatThePlanSays(plan) {
  const script = initScript(plan);
  const install = script.split('\n').find((line) => line.startsWith('nuxeoctl mp-install '));
  const zips = [...(install ?? '').matchAll(/"\$payload\/packages\/"'([^']+)'/g)].map(
    ([, file]) => file,
  );
  check(
    'the install script installs every package in one nuxeoctl mp-install, in the plan’s order',
    JSON.stringify(zips) ===
      JSON.stringify(plan.install.map((each) => each.artifact.split('/').pop())) &&
      /--accept=true --relax=false/.test(install),
    install,
    false,
  );
  const lines = script.split('\n').filter((line) => /^(nuxeoctl|cp|mkdir) /.test(line));
  check(
    'each of its steps stops the start when it fails',
    lines.length >= 4 && lines.every((line) => / \|\| fail '/.test(line)),
    lines.join('\n'),
  );
  const removes = script.indexOf('rm -f "$0"');
  check(
    'it removes itself only after its last step, and places the configuration after the packages',
    removes > script.indexOf('nuxeoctl mp-list') &&
      script.indexOf('nxserver/config/') > script.indexOf('nuxeoctl mp-install') &&
      script.indexOf('nxserver/bundles/') > script.indexOf('nuxeoctl mp-install'),
    '',
  );
  check(
    'it holds no secret, by value or by name',
    !Object.values(SECRETS).some((value) => script.includes(value)) &&
      !script.includes(CLID) &&
      !script.includes(ADMIN_PASSWORD),
    '',
  );

  // Each kit's config:dev command holds the arguments its README's "Seeing it under nx serve" does.
  for (const kit of ['payers-claims-demo', 'brand-assets-demo', 'contracts-demo']) {
    const folder = `business-apps/packages/${kit}`;
    const readme = readFileSync(join(REPO, folder, 'README.md'), 'utf8');
    const prefix = `C=${folder}/bundle/agentic-ui-config && npm run config:dev -- `;
    const documented = readme.split('\n').find((line) => line.startsWith(prefix));
    const files = spawnSync(
      'git',
      ['ls-tree', '-r', '--name-only', HEAD, '--', `${folder}/bundle/agentic-ui-config/`],
      { cwd: REPO, encoding: 'utf8' },
    )
      .stdout.split('\n')
      .filter(Boolean)
      .map((path) => path.slice(`${folder}/bundle/agentic-ui-config/`.length));
    const pairs = (line) =>
      [...line.slice(prefix.length).matchAll(/(--[a-z]+) (\S+)/g)]
        .map(([, flag, value]) => `${flag} ${value}`)
        .sort();
    const generated = configDevCommand(folder, files);
    check(
      `${kit}: the config:dev command serves what its README's does`,
      documented !== undefined &&
        JSON.stringify(pairs(generated)) === JSON.stringify(pairs(documented)),
      `generated ${pairs(generated).join(' ')}; README ${documented ? pairs(documented).join(' ') : 'none'}`,
      false,
    );
  }

  // The compose file declares the stack the plan describes.
  const compose = readFileSync(join(REPO, 'business-apps', 'demo-server', 'compose.yml'), 'utf8');
  const images = [...compose.matchAll(/^ {4}image: (\S+)$/gm)].map(([, image]) => image).sort();
  check(
    "the compose file's images are the plan's: Nuxeo 2025.10.18 and OpenSearch 2.13.0",
    JSON.stringify(images) === JSON.stringify([STACK.nuxeoImage, STACK.opensearchImage].sort()) &&
      STACK.nuxeoImage.endsWith(`:${STACK.nuxeoVersion}`),
    images.join(', '),
    false,
  );
  const services = [...compose.matchAll(/^ {2}([a-z-]+):$/gm)].map(([, name]) => name);
  check(
    "its services and volumes are the plan's",
    JSON.stringify([...services].sort()) ===
      JSON.stringify([...STACK.services, ...STACK.volumes].sort()),
    services.join(', '),
    false,
  );
  check(
    "the Connect packages are the plan's, and NUXEO_CLID passes by name with no value",
    compose.includes(`- NUXEO_PACKAGES=${STACK.connectPackages.join(' ')}`) &&
      /^ {6}- NUXEO_CLID$/m.test(compose) &&
      !/NUXEO_CLID[=:]/.test(compose),
    '',
  );
  const ports = [...compose.matchAll(/^ {4}ports:\n {6}(?:#.*\n {6})*- '([^']+)'/gm)].map(
    ([, port]) => port,
  );
  check(
    'one port is published, Nuxeo’s, on the address and port the command gives',
    JSON.stringify(ports) ===
      JSON.stringify(['${DEMO_SERVER_BIND:-127.0.0.1}:${DEMO_SERVER_PORT:-18080}:8080']),
    ports.join(', '),
  );

  const steps = stepsText(plan);
  check(
    'the demo steps: each file run against this server, by the variable that holds its password',
    steps.includes(
      `NUXEO_URL=${plan.origin} NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-operations`,
    ) &&
      steps.includes(
        `NUXEO_PROXY_TARGET=${plan.origin} npx ng serve nuxeo-ui --configuration=development,remote --port 4300`,
      ) &&
      steps.includes('contracts-demo 0.2.0: no steps file names this kit'),
    steps,
    false,
  );
}

// ── The machine ───────────────────────────────────────────────────────────────────────────────
/** A stand-in Nuxeo: runningstatus, the administrator's user and `/me`, with Basic credentials. */
function standInNuxeo({ refuseDefault = false, keepDefault = false } = {}) {
  let secret = 'Administrator';
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body });
      const send = (status, json) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(json === undefined ? '' : JSON.stringify(json));
      };
      if (request.url === '/nuxeo/runningstatus') return send(200, { status: 'ok' });
      const [user, pass] = Buffer.from(
        (request.headers.authorization ?? '').replace(/^Basic /, ''),
        'base64',
      )
        .toString('utf8')
        .split(':');
      const signedIn =
        user === 'Administrator' &&
        !(refuseDefault && pass === 'Administrator') &&
        (pass === secret || (keepDefault && pass === 'Administrator'));
      if (!signedIn) return send(401);
      if (request.url === '/nuxeo/api/v1/user/Administrator' && request.method === 'GET')
        return send(200, {
          'entity-type': 'user',
          id: 'Administrator',
          properties: {
            username: 'Administrator',
            firstName: 'Admin',
            groups: ['administrators'],
            password: '',
          },
        });
      if (request.url === '/nuxeo/api/v1/user/Administrator' && request.method === 'PUT') {
        secret = JSON.parse(body).properties.password;
        return send(200, JSON.parse(body));
      }
      if (request.url === '/nuxeo/api/v1/me')
        return send(200, { 'entity-type': 'user', id: 'Administrator' });
      return send(404);
    });
  });
  return {
    requests,
    listen: (port = 0) =>
      new Promise((resolveNow) =>
        server.listen(port, '127.0.0.1', () => resolveNow(server.address().port)),
      ),
    close: () => new Promise((resolveNow) => server.close(resolveNow)),
  };
}

/** A port nothing listens on, as the system gives one. */
function freePort() {
  return new Promise((resolveNow) => {
    const server = createTcpServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolveNow(port));
    });
  });
}

async function theMachine() {
  const answers = (outputs) => (args) => ({
    status: 0,
    stdout: outputs[args[0]] ?? '',
    stderr: '',
  });
  const labelled = existingResources(
    answers({ ps: 'nuxeo\t\nsomething-else\tsatori-demo-selftest\n', volume: '', network: '' }),
    'satori-demo-selftest',
  );
  check(
    'a container compose labels as the project’s is found',
    JSON.stringify(labelled) === JSON.stringify(['container something-else']),
    labelled.join(', '),
  );
  const named = existingResources(
    answers({
      ps: '',
      volume: 'satori-demo-selftest_nuxeo-data\t\n',
      network: 'satori-demo-selftest_default\t\n',
    }),
    'satori-demo-selftest',
  );
  check(
    'a volume and a network with the project’s names, unlabelled, are found',
    named.length === 2,
    named.join(', '),
  );
  const others = existingResources(
    answers({
      ps: 'nuxeo\t\nnuxeo-opensearch\t\nsatori-demo-selftest-other-nuxeo-1\tsatori-demo-selftest-other\n',
      volume: 'nuxeo-data\t\n',
      network: 'nuxeo-net\t\n',
    }),
    'satori-demo-selftest',
  );
  check(
    'the developer’s containers and another demo project’s are not this project’s',
    others.length === 0,
    others.join(', '),
    false,
  );
  const blind = thrown(() =>
    existingResources(
      () => ({ status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' }),
      'satori-demo-selftest',
    ),
  );
  check(
    'refused: Docker that cannot list its containers, which is not taken as none',
    blind instanceof Failure,
    blind?.message,
  );

  const holder = createTcpServer();
  const held = await new Promise((resolveNow) =>
    holder.listen(0, '127.0.0.1', () => resolveNow(holder.address().port)),
  );
  check('a port something listens on is in use', (await portInUse(held, '127.0.0.1')) === true, '');
  await new Promise((resolveNow) => holder.close(resolveNow));
  check(
    'a free port is not',
    (await portInUse(await freePort(), '127.0.0.1')) === false,
    '',
    false,
  );

  const nuxeo = standInNuxeo();
  const port = await nuxeo.listen();
  const origin = `http://127.0.0.1:${port}`;
  await waitForServer({ origin, deadline: Date.now() + 5000, stopped: () => null, interval: 10 });
  check('the wait ends when runningstatus answers 200', true, '', false);
  const exited = await thrownAsync(async () =>
    waitForServer({
      origin: `http://127.0.0.1:${await freePort()}`,
      deadline: Date.now() + 60_000,
      stopped: () => 'the Nuxeo container stopped',
      interval: 10,
    }),
  );
  check(
    'the wait is ended by the container stopping',
    exited instanceof Failure && /container stopped/.test(exited.message),
    exited?.message,
  );
  const late = await thrownAsync(async () =>
    waitForServer({
      origin: `http://127.0.0.1:${await freePort()}`,
      deadline: Date.now() + 50,
      stopped: () => null,
      interval: 10,
    }),
  );
  check(
    'the wait is a failure past its deadline',
    late instanceof Failure && /did not answer 200/.test(late.message),
    late?.message,
  );

  await setAdministratorPassword({ origin, secret: SECRETS[ADMIN_PASSWORD] });
  const put = nuxeo.requests.find((each) => each.method === 'PUT');
  const written = put ? JSON.parse(put.body) : null;
  check(
    "the administrator's password changed, the user written back whole",
    written?.properties.password === SECRETS[ADMIN_PASSWORD] &&
      written.properties.firstName === 'Admin' &&
      JSON.stringify(written.properties.groups) === '["administrators"]',
    put?.body,
    false,
  );
  check(
    'no secret in any address it asked',
    !nuxeo.requests.some((each) =>
      Object.values(SECRETS).some((value) => each.url.includes(value)),
    ),
    '',
    false,
  );
  const meCalls = nuxeo.requests.filter((each) => each.url === '/nuxeo/api/v1/me').length;
  check(
    'checked both ways, the new password and the default',
    meCalls === 2,
    `${meCalls} calls to /me`,
    false,
  );
  await nuxeo.close();
  const changedFirst = standInNuxeo({ refuseDefault: true });
  const first = await thrownAsync(async () =>
    setAdministratorPassword({
      origin: `http://127.0.0.1:${await changedFirst.listen()}`,
      secret: SECRETS[ADMIN_PASSWORD],
    }),
  );
  check(
    'refused: a server that refuses the default before the change, which this run did not start',
    first instanceof Failure && /not a server this run started fresh/.test(first.message),
    first?.message,
  );
  check(
    'and nothing is written to it',
    !changedFirst.requests.some((each) => each.method === 'PUT'),
    '',
  );
  await changedFirst.close();
  const keeps = standInNuxeo({ keepDefault: true });
  const kept = await thrownAsync(async () =>
    setAdministratorPassword({
      origin: `http://127.0.0.1:${await keeps.listen()}`,
      secret: SECRETS[ADMIN_PASSWORD],
    }),
  );
  check(
    'a failure: the default still signing in after the change',
    kept instanceof Failure && /still signs in/.test(kept.message),
    kept?.message,
  );
  await keeps.close();

  const log =
    '= Component Loading Status: Pending: 2 / Missing: 1 / Unstarted: 0 / Total: 3300\n...\n= Component Loading Status: Pending: 0 / Missing: 0 / Unstarted: 0 / Total: 3301\n';
  check(
    'the last Component Loading Status is read',
    JSON.stringify(componentStatus(log)) === '{"pending":0,"missing":0,"unstarted":0}',
    JSON.stringify(componentStatus(log)),
    false,
  );
  check(
    'one with something missing is read as missing',
    componentStatus(log.split('...')[0]).missing === 1,
    '',
  );
  check('a log with none is said to have none', componentStatus('started') === null, '');

  const env = seedEnvironment(
    {
      PATH: '/bin',
      ...SECRETS,
      NUXEO_USER: 'someone',
      NUXEO_PASS: 'theirs',
      SATORI_GH_READONLY_TOKEN: 'token-value',
      OTHER_DEMO_PASSWORD: 'other',
    },
    {
      origin,
      secret: SECRETS[ADMIN_PASSWORD],
      passwords: ['PAYERS_DEMO_PASSWORD'],
      app: `${origin}/nuxeo/agentic-ui`,
    },
  );
  check(
    "a seed is given the server, the administrator and its own demo users' password, and no other secret",
    env.NUXEO_URL === origin &&
      env.NUXEO_USER === 'Administrator' &&
      env.NUXEO_PASS === SECRETS[ADMIN_PASSWORD] &&
      env.PAYERS_DEMO_PASSWORD === SECRETS.PAYERS_DEMO_PASSWORD &&
      env.APP_URL === `${origin}/nuxeo/agentic-ui` &&
      !(CLID in env) &&
      !(ADMIN_PASSWORD in env) &&
      !('SATORI_GH_READONLY_TOKEN' in env) &&
      !('OTHER_DEMO_PASSWORD' in env) &&
      env.PATH === '/bin',
    JSON.stringify(Object.keys(env)),
  );
  const quiet = quietEnvironment({
    PATH: '/bin',
    HOME: '/h',
    DOCKER_HOST: 'unix:///x',
    ...SECRETS,
    GH_TOKEN: 'x',
    NUXEO_PASS: 'y',
  });
  check(
    'Docker, git and tar are started with no secret and with what Docker needs',
    JSON.stringify(Object.keys(quiet).sort()) === JSON.stringify(['DOCKER_HOST', 'HOME', 'PATH']),
    JSON.stringify(Object.keys(quiet)),
  );
}

// ── The command ───────────────────────────────────────────────────────────────────────────────
const bin = join(scratch, 'bin');
mkdirSync(bin);
const FAKE = join(bin, 'fake-docker.mjs');
/**
 * The stand-in Docker: every call recorded with whether NUXEO_CLID was in its environment and the
 * names of any password there; a copy's source recorded with its files, and a file's text. It
 * answers the commands the command makes and fails, with 99, any other: a push or a build is seen.
 */
writeFileSync(
  FAKE,
  `import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const config = JSON.parse(readFileSync(process.env.FAKE_DOCKER_CONFIG, 'utf8'));
const verb = args[0] === 'compose' ? 'compose ' + (args[args.indexOf('-p') + 2] ?? args[1]) : args[0];
const record = { args, verb, clid: 'NUXEO_CLID' in process.env, secrets: Object.keys(process.env).filter((name) => /PASSWORD|TOKEN|_PASS$/.test(name)) };
if (verb === 'cp') {
  const files = (dir, prefix = '') => readdirSync(dir).flatMap((name) => statSync(join(dir, name)).isDirectory() ? files(join(dir, name), prefix + name + '/') : [prefix + name]);
  record.copied = statSync(args[1]).isDirectory() ? files(args[1]) : readFileSync(args[1], 'utf8');
}
appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(record) + '\\n');
if ((config.fail ?? []).includes(verb)) { process.stderr.write('stand-in failure of ' + verb + '\\n'); process.exit(1); }
const out = {
  version: '27.0.0', 'compose version': '2.30.0',
  ps: config.containers ?? 'nuxeo\\t\\nnuxeo-opensearch\\t\\n', volume: config.volumes ?? 'nuxeo-data\\t\\n', network: 'nuxeo-net\\t\\nbridge\\t\\n',
  'compose pull': '', 'compose create': '', 'compose ps': 'a'.repeat(64), cp: '', inspect: config.inspect ?? 'running 0',
  'compose logs': 'nuxeo-1  | the stand-in log\\n', exec: config.exec ?? '= Component Loading Status: Pending: 0 / Missing: 0 / Unstarted: 0 / Total: 3301\\n',
  'compose stop': '', 'compose down': '',
};
if (verb === 'compose up') { out['compose up'] = ''; if (config.upMarker) writeFileSync(config.upMarker, 'up'); }
if (!(verb in out)) { process.stderr.write('the stand-in Docker does not answer ' + verb + '\\n'); process.exit(99); }
process.stdout.write(out[verb]);
`,
);
writeFileSync(join(bin, 'docker'), `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`, {
  mode: 0o755,
});

/** The environment a command is run with: no credential of this shell's, the stand-in Docker first. */
function commandEnv(name, { secrets = SECRETS, config = {} } = {}) {
  const log = join(scratch, `${name}.docker.jsonl`);
  const configFile = join(scratch, `${name}.docker.json`);
  writeFileSync(configFile, JSON.stringify(config));
  writeFileSync(log, '');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/(TOKEN|PASSWORD|SECRET|_PASS$|_CLID$|^NUXEO_USER$)/i.test(key),
    ),
  );
  for (const [key, value] of Object.entries(secrets)) if (value !== undefined) env[key] = value;
  return {
    env: {
      ...env,
      PATH: `${bin}:${process.env.PATH}`,
      DEMO_SERVER_DOCKER: join(bin, 'docker'),
      FAKE_DOCKER_LOG: log,
      FAKE_DOCKER_CONFIG: configFile,
    },
    calls: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

/** The command, run to its end: its exit, its output, and the Docker calls it made. */
function command(name, args, options) {
  const { env, calls } = commandEnv(name, options);
  // A command broken so that it goes on where it should refuse must fail its control, not hang it:
  // the run against the stand-in is killed after a minute, and every run passes a short --wait.
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
    killSignal: 'SIGKILL',
  });
  return {
    status: result.signal ? `killed by ${result.signal}` : result.status,
    output: `${result.stdout}${result.stderr}`,
    calls: calls(),
  };
}

const READS = new Set(['version', 'compose version', 'ps', 'volume', 'network']);
const printsNoSecret = (output) =>
  !Object.values(SECRETS).some((value) => output.includes(value)) &&
  !SECRETS[CLID].split('--').some((part) => output.includes(part));
const noSecretOnACommandLine = (calls) =>
  !calls.some((call) =>
    Object.values(SECRETS).some((value) => call.args.join(' ').includes(value)),
  );

async function theCommand() {
  const candidate = writeCandidate('command');
  const port = String(await freePort());
  const base = [
    '--candidate',
    candidate,
    '--project',
    'satori-demo-selftest',
    '--port',
    port,
    '--wait',
    '3',
  ];

  for (const name of Object.keys(SECRETS)) {
    const run = command(`unset-${name}`, base, { secrets: { ...SECRETS, [name]: undefined } });
    check(
      `refused: ${name} unset, with exit 2, before Docker is asked anything`,
      run.status === 2 &&
        run.output.includes(`${name} is not set`) &&
        /Refused, and nothing was made/.test(run.output) &&
        run.calls.length === 0,
      `exit ${run.status}, ${run.calls.length} Docker call(s): ${run.output.slice(-400)}`,
    );
    check(`and ${name} unset, nothing printed of the others`, printsNoSecret(run.output), '');
  }

  const existing = command('existing', base, {
    config: { containers: 'nuxeo\t\nsatori-demo-selftest-nuxeo-1\tsatori-demo-selftest\n' },
  });
  check(
    'refused: an existing project, with exit 2, Docker asked only what it has',
    existing.status === 2 &&
      /the compose project satori-demo-selftest is already there \(container satori-demo-selftest-nuxeo-1\)/.test(
        existing.output,
      ) &&
      existing.calls.length > 0 &&
      existing.calls.every((call) => READS.has(call.verb)),
    `exit ${existing.status}; ${existing.calls.map((call) => call.verb).join(', ')}; ${existing.output.slice(-400)}`,
  );

  const missing = writeCandidate('command-missing', {
    packages: soundPackages().filter((each) => each.name !== 'nuxeo-agentic-assets'),
  });
  const short = command('missing', [
    '--candidate',
    missing,
    '--project',
    'satori-demo-selftest',
    '--port',
    port,
    '--wait',
    '3',
  ]);
  check(
    'refused: a candidate missing a dependency, with exit 2, before Docker is asked anything',
    short.status === 2 &&
      /depends on nuxeo-agentic-assets:0\.1\.0, and the candidate has no package nuxeo-agentic-assets/.test(
        short.output,
      ) &&
      short.calls.length === 0,
    `exit ${short.status}, ${short.calls.length} Docker call(s): ${short.output.slice(-400)}`,
  );

  const dry = command('dry-run', [...base, '--dry-run']);
  check(
    'a dry run prints the plan and exits 0, Docker asked only what it has',
    dry.status === 0 &&
      dry.output.includes(
        'One nuxeoctl mp-install of every package of the candidate, in dependency order',
      ) &&
      /Dry run: nothing was pulled, made or started/.test(dry.output) &&
      dry.calls.every((call) => READS.has(call.verb)),
    `exit ${dry.status}; ${dry.calls.map((call) => call.verb).join(', ')}`,
    false,
  );
  check('a dry run prints no secret', printsNoSecret(dry.output), '', false);
  const unsetDry = command('dry-run-unset', [...base, '--dry-run'], { secrets: {} });
  check(
    'a dry run with no secret set says so, and still prints its plan',
    unsetDry.status === 0 &&
      unsetDry.output.includes(`${CLID}: NOT SET`) &&
      unsetDry.output.includes('A run would refuse these secrets'),
    unsetDry.output.slice(-400),
    false,
  );
  const dryExisting = command('dry-run-existing', [...base, '--dry-run'], {
    config: { volumes: 'satori-demo-selftest_nuxeo-data\t\n' },
  });
  check(
    'a dry run on an existing project exits 2, as the run would be refused',
    dryExisting.status === 2 && /a run would be refused/.test(dryExisting.output),
    dryExisting.output.slice(-300),
  );

  const startFails = command('start-fails', base, { config: { fail: ['compose up'] } });
  const verbs = startFails.calls.map((call) => call.verb);
  const changing = verbs.filter((verb) => !READS.has(verb));
  check(
    'a run whose start fails: pulled, created, copied in, started, then stopped and kept, exit 1',
    startFails.status === 1 &&
      JSON.stringify(changing) ===
        JSON.stringify([
          'compose pull',
          'compose create',
          'compose ps',
          'cp',
          'cp',
          'cp',
          'compose up',
          'compose stop',
        ]) &&
      /The project is stopped, with the image's default Administrator password, and kept for its logs/.test(
        startFails.output,
      ),
    `exit ${startFails.status}; ${changing.join(', ')}; ${startFails.output.slice(-300)}`,
  );
  const copies = startFails.calls.filter((call) => call.verb === 'cp');
  const payload = copies.find((call) => Array.isArray(call.copied))?.copied ?? [];
  const script =
    copies.find((call) => typeof call.copied === 'string' && call.copied.startsWith('#!/bin/bash'))
      ?.copied ?? '';
  check(
    'into the container before it starts: the OpenSearch settings, the packages, bundle, configuration and plan, and the install script',
    copies[0]?.args[2]?.endsWith(':/etc/nuxeo/conf.d/90-demo-server.conf') &&
      JSON.stringify(payload.slice().sort()) ===
        JSON.stringify(
          [
            'bundles/nuxeo-agentic-connectors-2026.0.2.jar',
            'config/payers-claims-demo-operations-config.xml',
            'packages/brand-assets-demo-0.2.0.zip',
            'packages/contracts-demo-0.2.0.zip',
            'packages/facilities-demo-0.1.0.zip',
            'packages/nuxeo-agentic-assets-0.1.0.zip',
            'packages/nuxeo-agentic-ui-package-2026.0.2.zip',
            'packages/payers-claims-demo-0.5.0.zip',
            'plan.json',
          ].sort(),
        ) &&
      copies[2]?.args[2]?.endsWith(':/docker-entrypoint-initnuxeo.d/zz-demo-server-install.sh') &&
      script.includes('nuxeoctl mp-install'),
    JSON.stringify(copies.map((call) => call.args.slice(1))),
    false,
  );
  // Every one but `compose version`, which asks about Compose itself, not a project.
  const composeCalls = startFails.calls.filter(
    (call) => call.verb.startsWith('compose ') && call.verb !== 'compose version',
  );
  check(
    'every compose command names the project and the file, and only compose is given NUXEO_CLID',
    composeCalls.every(
      (call) =>
        call.args.includes('-p') &&
        call.args[call.args.indexOf('-p') + 1] === 'satori-demo-selftest' &&
        call.args.includes('-f'),
    ) && startFails.calls.every((call) => call.clid === call.verb.startsWith('compose ')),
    JSON.stringify(startFails.calls.map((call) => [call.verb, call.clid])),
  );
  check(
    'no Docker command is given a password',
    startFails.calls.every((call) => call.secrets.length === 0),
    JSON.stringify(startFails.calls.map((call) => call.secrets)),
  );
  check(
    'no secret on a command line, and none printed',
    noSecretOnACommandLine(startFails.calls) && printsNoSecret(startFails.output),
    '',
  );

  const copyFails = command('copy-fails', base, { config: { fail: ['cp'] } });
  const copyVerbs = copyFails.calls.map((call) => call.verb).filter((verb) => !READS.has(verb));
  check(
    'a run whose copy fails, never started: what it made is removed, exit 1',
    copyFails.status === 1 &&
      JSON.stringify(copyVerbs) ===
        JSON.stringify(['compose pull', 'compose create', 'compose ps', 'cp', 'compose down']) &&
      /never started, is removed/.test(copyFails.output),
    `exit ${copyFails.status}; ${copyVerbs.join(', ')}`,
  );
  const pullFails = command('pull-fails', base, { config: { fail: ['compose pull'] } });
  check(
    'a run whose pull fails made nothing, and removes nothing: exit 2',
    pullFails.status === 2 &&
      !pullFails.calls.some((call) =>
        ['compose create', 'compose down', 'compose stop'].includes(call.verb),
      ) &&
      /docker login docker-private\.packages\.nuxeo\.com/.test(pullFails.output),
    `exit ${pullFails.status}; ${pullFails.output.slice(-300)}`,
  );
  const exits = command('container-exits', base, { config: { inspect: 'exited 1' } });
  check(
    'a run whose container stops before the server answers: its log printed, the project stopped, exit 1',
    exits.status === 1 &&
      /the stand-in log/.test(exits.output) &&
      /stopped with exit 1 before the server answered/.test(exits.output) &&
      exits.calls.at(-1)?.verb === 'compose stop',
    `exit ${exits.status}; ${exits.output.slice(-400)}`,
  );

  // A run that comes up: a candidate whose one kit has no seed, and the stand-in Nuxeo listening
  // once the stand-in Docker has been asked to start it.
  const small = writeCandidate('command-up', {
    packages: soundPackages().filter((each) =>
      ['nuxeo-agentic-ui', 'facilities-demo'].includes(each.name),
    ),
  });
  const upPort = await freePort();
  const marker = join(scratch, 'up.marker');
  const { env, calls } = commandEnv('up', { config: { upMarker: marker } });
  const nuxeo = standInNuxeo();
  const child = spawn(
    process.execPath,
    [
      SCRIPT,
      '--candidate',
      small,
      '--project',
      'satori-demo-selftest',
      '--port',
      String(upPort),
      '--wait',
      '30',
    ],
    { cwd: REPO, env },
  );
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const exited = new Promise((resolveNow) => child.on('exit', (status) => resolveNow(status)));
  const killer = setTimeout(() => child.kill('SIGKILL'), 90_000);
  let listening = false;
  const watching = setInterval(async () => {
    if (!listening && existsSync(marker)) {
      listening = true;
      await nuxeo.listen(upPort);
    }
  }, 50);
  const status = await exited;
  clearTimeout(killer);
  clearInterval(watching);
  if (listening) await nuxeo.close();
  // The wait asks whether the container stopped before each try, so once or more.
  const upVerbs = calls()
    .map((call) => call.verb)
    .filter(
      (verb, index, verbs) =>
        !READS.has(verb) && !(verb === 'inspect' && verbs[index - 1] === 'inspect'),
    );
  check(
    'a run that comes up: started once, the password changed, the log checked, exit 0, and its steps printed',
    status === 0 &&
      JSON.stringify(upVerbs) ===
        JSON.stringify([
          'compose pull',
          'compose create',
          'compose ps',
          'cp',
          'cp',
          'cp',
          'compose up',
          'inspect',
          'exec',
        ]) &&
      nuxeo.requests.some((each) => each.method === 'PUT') &&
      /The demo server is up: http:\/\/127\.0\.0\.1:\d+\/nuxeo/.test(output) &&
      output.includes('facilities-demo 0.1.0: no steps file names this kit'),
    `exit ${status}; ${upVerbs.join(', ')}; ${output.slice(-600)}`,
    false,
  );
  check(
    'a run that comes up prints no secret',
    printsNoSecret(output) && noSecretOnACommandLine(calls()),
    '',
    false,
  );
  const all = [
    ...startFails.calls,
    ...copyFails.calls,
    ...exits.calls,
    ...calls(),
    ...dry.calls,
    ...existing.calls,
  ];
  check(
    'no run pushes, builds, tags or logs in, or names a container that is not its own',
    !all.some((call) =>
      ['push', 'build', 'tag', 'login', 'compose push', 'compose build'].includes(call.verb),
    ) &&
      !all.some((call) =>
        call.args.some(
          (arg) => arg === 'nuxeo' && call.verb !== 'compose ps' && call.verb !== 'compose logs',
        ),
      ),
    JSON.stringify(all.map((call) => call.args.join(' '))),
  );
}

try {
  const plan = thePlan();
  theArguments();
  theSecrets();
  whatThePlanSays(plan);
  await theMachine();
  await theCommand();
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
