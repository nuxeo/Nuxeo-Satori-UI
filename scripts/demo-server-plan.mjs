/**
 * The plan for a demo server stood up from a release candidate (`scripts/demo-server.mjs`,
 * business-apps/demo-server/README.md): what it installs and in which order, what it places in
 * the server's configuration, which seeds it runs, which secrets it needs, and how each demo steps
 * file is run against it.
 *
 * Read from two places, and nowhere else:
 *
 * - **The candidate's output directory**, as `release-candidate.mjs` wrote it: every file held to
 *   its line in `SHA256SUMS`, and every package read from the zip it ships, not from the sources it
 *   came from. A file the checksums do not list, a digest that differs, or a link anywhere refuses
 *   the candidate.
 * - **The candidate's commit, in this clone,** for what a candidate does not carry: each kit's
 *   deployment configuration (`deployment/*-config.xml`, such as the operation buttons' allow-list,
 *   which the server's administrators place and no package may), its seed, and the files its demo's
 *   dev server serves. Read through git at that commit, so a working tree that has moved on cannot
 *   change what is installed. A candidate built with uncommitted changes in a kit is refused: its
 *   commit's seed is not the candidate's.
 *
 * Functions, so that `demo-server.selftest.mjs` can break each rule without Docker or a server.
 * Node, git and `unzip`, as the candidate needs; acorn, from `npm ci`, to read what a seed reads.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { join } from 'node:path';

import { readSource } from './release-candidate-demo.mjs';
import {
  descriptorOf,
  platformRange,
  platformVersion,
  rangeWithin,
  setProblems,
} from './release-candidate-set.mjs';

/** What `release-candidate.mjs` writes, and the only format this reads. */
export const CANDIDATE_FORMAT = 'nuxeo-satori-release-candidate/1';
/** A version `release-candidate.mjs` lets a candidate carry: digits, then a classifier. */
const CANDIDATE_VERSION = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

/**
 * The stack `business-apps/demo-server/compose.yml` declares. The selftest holds the file to these
 * names and images, so the plan cannot describe a stack the file does not.
 */
export const STACK = Object.freeze({
  services: ['nuxeo', 'opensearch'],
  volumes: ['nuxeo-data', 'nuxeo-logs', 'opensearch-data'],
  nuxeoImage: 'docker-private.packages.nuxeo.com/nuxeo/nuxeo:2025.10.18',
  nuxeoVersion: '2025.10.18',
  opensearchImage: 'opensearchproject/opensearch:2.13.0',
  /** Installed by the image from Nuxeo Connect at the first start, which needs NUXEO_CLID. */
  connectPackages: ['nuxeo-search-client-opensearch2', 'nuxeo-audit-opensearch2'],
});

/**
 * The label compose gives every container a run creates, with the run's own mark: a run touches no
 * container without it, so a second run of the same project at the same time cannot be cleaned up
 * by the first.
 */
export const RUN_LABEL = 'org.nuxeo.satori.demo-server.run';

/** The platform a Nuxeo LTS server is, to a package's `<target-platform><name>`. */
const PLATFORM_NAME = 'lts';

/** The secrets, by the environment variable each is read from. Never a value. */
export const CLID = 'NUXEO_CLID';
export const ADMIN_PASSWORD = 'DEMO_SERVER_ADMIN_PASSWORD';
/** The image's administrator, who signs the seeds in, and the password the image gives them. */
export const ADMINISTRATOR = 'Administrator';
export const IMAGE_DEFAULT_SECRET = 'Administrator';
const SHORTEST_ADMIN_SECRET = 12;
const SHORTEST_DEMO_SECRET = 8;

export const DEFAULTS = Object.freeze({
  project: 'satori-demo',
  port: 18080,
  bind: '127.0.0.1',
  wait: 1200,
});
/**
 * A project of this command is `satori-demo`, or `satori-demo-` and a name: so its containers,
 * `<project>-nuxeo-1` and `<project>-opensearch-1`, can never be the developer's `nuxeo` and
 * `nuxeo-opensearch`, and a reader of `docker ps` knows them for a demo server's.
 */
const PROJECT = /^satori-demo(?:-[a-z0-9]+)*$/;
/** Ports this command never publishes on, whatever is listening there now. */
export const RESERVED_PORTS = new Map([
  [8080, "the local Nuxeo's"],
  [4200, "the development server's"],
  [4300, "the development server's that the demo steps are run through"],
  [9200, "the local OpenSearch's"],
]);
/** The development server the printed demo steps run through, beside a developer's own on 4200. */
export const STEPS_DEV_SERVER_PORT = 4300;

export const USAGE =
  'usage: node scripts/demo-server.mjs --candidate <release candidate directory> ' +
  '[--project satori-demo[-<name>]] [--port <port>] [--bind <IPv4 address>] [--wait <seconds>] [--dry-run]';

/** A reason not to go on, said to the operator. Thrown before anything is made. */
export class Refusal extends Error {}

const VALUED = ['--candidate', '--project', '--port', '--bind', '--wait'];
const FLAGS = ['--dry-run'];

/**
 * The command's options, or `{ error }`. Every value is required where its option is given, and an
 * option given twice is refused rather than one of them taken: `--port "$PORT"` unset must not
 * fall back to the default in silence.
 */
export function parseArguments(argv) {
  const given = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (given[arg] !== undefined) return { error: `${arg} is given twice.` };
    if (FLAGS.includes(arg)) {
      given[arg] = true;
      continue;
    }
    if (!VALUED.includes(arg)) return { error: `${arg} is not an option of this command.` };
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--'))
      return { error: `${arg} needs a value.` };
    given[arg] = value;
    index += 1;
  }
  if (given['--candidate'] === undefined)
    return { error: '--candidate is required: the directory a release candidate was written to.' };
  const project = given['--project'] ?? DEFAULTS.project;
  if (!PROJECT.test(project) || project.length > 48)
    return {
      error:
        `--project ${project} is not a demo server's: it is satori-demo, or satori-demo- and ` +
        'lowercase letters and digits, so that none of its containers can be named as the developer’s.',
    };
  const integer = (option, fallback, low, high) => {
    const text = given[option];
    if (text === undefined) return fallback;
    if (!/^[0-9]+$/.test(text)) return null;
    const value = Number(text);
    return value >= low && value <= high ? value : null;
  };
  const port = integer('--port', DEFAULTS.port, 1024, 65535);
  if (port === null)
    return { error: `--port ${given['--port']} is not a port from 1024 to 65535.` };
  if (RESERVED_PORTS.has(port))
    return {
      error: `--port ${port} is ${RESERVED_PORTS.get(port)}: give the demo server another.`,
    };
  const bind = given['--bind'] ?? DEFAULTS.bind;
  if (!isIPv4(bind))
    return { error: `--bind ${bind} is not an IPv4 address, such as 127.0.0.1 or 0.0.0.0.` };
  const wait = integer('--wait', DEFAULTS.wait, 1, 86400);
  if (wait === null)
    return { error: `--wait ${given['--wait']} is not a number of seconds from 1 to 86400.` };
  return {
    options: {
      candidate: given['--candidate'],
      project,
      port,
      bind,
      wait,
      dryRun: given['--dry-run'] === true,
    },
  };
}

/** Where the server answers, from the machine that runs this: an address any client can reach. */
export function originOf({ bind, port }) {
  return `http://${bind === '0.0.0.0' ? '127.0.0.1' : bind}:${port}`;
}

/** The names the project's containers, volumes and network take, as Docker Compose names them. */
export function stackNames(project) {
  return {
    containers: Object.fromEntries(STACK.services.map((name) => [name, `${project}-${name}-1`])),
    volumes: STACK.volumes.map((name) => `${project}_${name}`),
    network: `${project}_default`,
  };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * `SHA256SUMS` as `sha256sum -c` reads it, `<digest>  <path>` a line, into a map. A path that
 * climbs out of the candidate, is absolute, or is listed twice is refused, not followed.
 */
export function parseSums(text) {
  const sums = new Map();
  for (const [number, line] of text.split('\n').entries()) {
    if (line === '') continue;
    const found = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (found === null)
      throw new Refusal(`SHA256SUMS line ${number + 1} is not "<sha256>  <path>".`);
    const path = found[2];
    if (
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').some((part) => part === '' || part === '.' || part === '..')
    )
      throw new Refusal(`SHA256SUMS line ${number + 1} names ${path}, outside the candidate.`);
    if (sums.has(path)) throw new Refusal(`SHA256SUMS lists ${path} twice.`);
    sums.set(path, found[1]);
  }
  return sums;
}

/** Every file under `directory`, relative, with `/` between its parts. A link is refused. */
function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink())
      throw new Refusal(`${path} in the candidate is a symbolic link, which no candidate holds.`);
    if (entry.isDirectory()) files.push(...filesUnder(directory, `${path}/`));
    else if (entry.isFile()) files.push(path);
    else throw new Refusal(`${path} in the candidate is not a file.`);
  }
  return files.sort();
}

/**
 * The candidate in `directory`, held to its own checksums: every file `SHA256SUMS` lists is there
 * with its digest, no file is there that it does not list, and every artifact `manifest.json`
 * names is one of them, with the digest the manifest gives. So what is installed is what was built.
 */
export function readCandidate(directory) {
  // The directory itself may be reached through a link; nothing inside it may be one.
  const stat = statSync(directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory())
    throw new Refusal(
      `${directory} is not a directory: give --candidate the directory release-candidate wrote.`,
    );
  const read = (name) => {
    const entry = lstatSync(join(directory, name), { throwIfNoEntry: false });
    if (!entry?.isFile())
      throw new Refusal(`${directory} has no ${name}, so it is not a release candidate's output.`);
    return readFileSync(join(directory, name));
  };
  let manifest;
  try {
    manifest = JSON.parse(read('manifest.json').toString('utf8'));
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new Refusal(`${directory}/manifest.json is not JSON: ${error.message}`);
  }
  if (manifest?.format !== CANDIDATE_FORMAT)
    throw new Refusal(
      `${directory}/manifest.json is in the format ${JSON.stringify(manifest?.format)}, and this reads ${CANDIDATE_FORMAT}.`,
    );
  const sums = parseSums(read('SHA256SUMS').toString('utf8'));
  const present = filesUnder(directory).filter((file) => file !== 'SHA256SUMS');
  const unlisted = present.filter((file) => !sums.has(file));
  if (unlisted.length > 0)
    throw new Refusal(
      `the candidate holds ${unlisted.length} file(s) SHA256SUMS does not list, the first ${unlisted[0]}: it is not as it was written.`,
    );
  for (const [path, digest] of sums) {
    const entry = lstatSync(join(directory, ...path.split('/')), { throwIfNoEntry: false });
    if (!entry?.isFile())
      throw new Refusal(`SHA256SUMS lists ${path}, which the candidate does not hold.`);
    if (sha256(readFileSync(join(directory, ...path.split('/')))) !== digest)
      throw new Refusal(`${path} does not have the digest SHA256SUMS gives it: it has changed.`);
  }
  if (!Array.isArray(manifest.artifacts) || !Array.isArray(manifest.kits))
    throw new Refusal('manifest.json lists no artifacts or no kits.');
  // The version is written into the install script and the containers' labels: a release
  // candidate's, as `release-candidate.mjs` accepts one, and nothing a shell would read as more.
  if (typeof manifest.version !== 'string' || !CANDIDATE_VERSION.test(manifest.version))
    throw new Refusal(
      `manifest.json's version ${JSON.stringify(manifest.version)} is not a release candidate's.`,
    );
  for (const artifact of manifest.artifacts) {
    if (typeof artifact?.path !== 'string' || sums.get(artifact.path) !== artifact.sha256)
      throw new Refusal(
        `manifest.json's ${artifact?.kind} ${artifact?.name} is ${artifact?.path}, which SHA256SUMS does not list with the same digest.`,
      );
  }
  return { directory, manifest, files: sums.size };
}

const OUTPUT_LIMIT = 256 * 1024 * 1024;

/** One entry of a zip, its bytes, or `null` when the zip has no such entry. */
function zipEntry(zip, entry) {
  const result = spawnSync('unzip', ['-p', zip, entry], { maxBuffer: OUTPUT_LIMIT });
  if (result.error) throw new Refusal(`unzip could not be run: ${result.error.message}`);
  return result.status === 0 ? result.stdout : null;
}

/** The names of a zip's entries. */
function zipEntries(zip) {
  const result = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: OUTPUT_LIMIT });
  if (result.error) throw new Refusal(`unzip could not be run: ${result.error.message}`);
  if (result.status !== 0) throw new Refusal(`${zip} cannot be read as a zip.`);
  return result.stdout.split('\n').filter(Boolean);
}

/**
 * The Nuxeo packages the candidate ships, server packages and kits, each read from its zip's
 * `package.xml`, and the bundles no package carries, which are the add-ons that have no package
 * yet: their bytes are in no zip's `install/bundles/`. A zip whose descriptor disagrees with the
 * manifest is refused: the manifest is what the plan prints.
 */
export function readPackages({ directory, manifest }) {
  const packages = [];
  const carried = new Set();
  for (const artifact of manifest.artifacts) {
    if (artifact.kind !== 'server package' && artifact.kind !== 'kit') continue;
    const zip = join(directory, ...artifact.path.split('/'));
    const xml = zipEntry(zip, 'package.xml');
    if (xml === null)
      throw new Refusal(`${artifact.path} has no package.xml, so it is not a Nuxeo package.`);
    const descriptor = descriptorOf(xml.toString('utf8'));
    if (descriptor.name !== artifact.name || descriptor.version !== artifact.version)
      throw new Refusal(
        `${artifact.path} is ${descriptor.name} ${descriptor.version} to its package.xml, and ${artifact.name} ${artifact.version} to manifest.json.`,
      );
    for (const entry of zipEntries(zip))
      if (/^install\/bundles\/[^/]+\.jar$/.test(entry)) carried.add(sha256(zipEntry(zip, entry)));
    packages.push({ ...descriptor, kind: artifact.kind, artifact: artifact.path });
  }
  const bundles = manifest.artifacts
    .filter((artifact) => artifact.kind === 'bundle' && !carried.has(artifact.sha256))
    .map((artifact) => ({
      name: artifact.name,
      version: artifact.version,
      artifact: artifact.path,
    }));
  return { packages, bundles };
}

/** Why `nuxeoVersion` is not a platform `pkg` installs on, or `null`. */
function targetProblem(pkg, nuxeoVersion) {
  const target = pkg.targetPlatform;
  if (target === null || target.version === null) return null;
  const who = `${pkg.name} ${pkg.version}`;
  if (target.name !== PLATFORM_NAME)
    return `${who} targets the platform ${target.name}, and the demo server is Nuxeo ${PLATFORM_NAME} ${nuxeoVersion}.`;
  const range = platformRange(target.version);
  const server = platformRange(nuxeoVersion);
  if (range === null || server === null || platformVersion(nuxeoVersion) === null)
    return `${who}'s target platform ${target.version} is not a range this reads.`;
  return rangeWithin(server, range)
    ? null
    : `${who} installs on ${PLATFORM_NAME} ${target.version}, which leaves out the demo server's Nuxeo ${nuxeoVersion}.`;
}

/** Server packages before kits, then by name: the order when dependencies leave a choice. */
const RANK = { 'server package': 0, kit: 1 };
const before = (a, b) =>
  RANK[a.kind] - RANK[b.kind] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The packages in an order Nuxeo can install them in, each after every package it depends on, or a
 * refusal naming every problem: what `release-candidate.mjs` holds the set to (a dependency the
 * candidate does not hold, or holds at a version Nuxeo does not count as meeting it, a conflict, a
 * package named twice, a target platform outside a dependency's), a target platform that leaves out
 * the demo server's Nuxeo, and dependencies that go round.
 */
export function installOrder(packages, nuxeoVersion = STACK.nuxeoVersion) {
  const problems = [
    ...setProblems(packages),
    ...packages.map((each) => targetProblem(each, nuxeoVersion)).filter(Boolean),
  ];
  if (problems.length > 0)
    throw new Refusal(
      `the candidate cannot be installed as it is:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
    );
  const byName = new Map(packages.map((each) => [each.name, each]));
  const needs = new Map(
    packages.map((each) => [
      each.name,
      new Set(
        each.dependencies.map((text) => text.split(':')[0]).filter((name) => byName.has(name)),
      ),
    ]),
  );
  const order = [];
  const left = new Set(packages.map((each) => each.name));
  while (left.size > 0) {
    const ready = [...left]
      .map((name) => byName.get(name))
      .filter((each) => [...needs.get(each.name)].every((name) => !left.has(name)))
      .sort(before);
    if (ready.length === 0)
      throw new Refusal(
        `the candidate's dependencies go round, between ${[...left].sort().join(', ')}: no order installs them.`,
      );
    order.push(ready[0]);
    left.delete(ready[0].name);
  }
  return order;
}

/** `git`'s answer as bytes, or `null` when it refused. */
function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, maxBuffer: OUTPUT_LIMIT });
  return result.status === 0 ? result.stdout : null;
}

/** Each file of a kit's folder at `commit`: `{ path, mode, object }`, its path from the folder. */
function kitTree(repo, commit, folder) {
  const listed = git(repo, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', folder]);
  if (listed === null) throw new Refusal(`git could not list ${folder} at ${commit}.`);
  return listed
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split('\t');
      const [mode, type, object] = meta.split(' ');
      return { path: file.slice(folder.length + 1), mode, type, object };
    });
}

/**
 * What the candidate's commit holds for each kit that the candidate does not: its deployment
 * configuration, its seed and the environment that reads, and the files of its app definition the
 * demo's dev server serves. `kits` is `[{ name, folder }]`, `folder` from the repository's root.
 * `parse` is acorn's.
 */
export function fromCommit({ repo, manifest, kits, parse }) {
  const commit = manifest.commit;
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit))
    throw new Refusal(
      'manifest.json names no commit, so its seeds and configuration cannot be read.',
    );
  if (git(repo, ['cat-file', '-e', `${commit}^{commit}`]) === null)
    throw new Refusal(
      `the candidate was built from ${commit}, which this clone does not have: fetch it, or run this from a clone that does.`,
    );
  const uncommitted = Array.isArray(manifest.uncommitted) ? manifest.uncommitted : [];
  const config = [];
  const seeds = [];
  const served = new Map();
  for (const { name, folder } of kits) {
    const changed = uncommitted.filter((path) => path === folder || path.startsWith(`${folder}/`));
    if (changed.length > 0)
      throw new Refusal(
        `the candidate was built with ${changed.length} uncommitted change(s) in ${folder}, the first ${changed[0]}, so ${commit.slice(0, 12)}'s seed and deployment configuration are not the candidate's. Build it again from a commit.`,
      );
    const tree = kitTree(repo, commit, folder);
    const link = tree.find((entry) => entry.mode === '120000' || entry.type !== 'blob');
    if (link)
      throw new Refusal(
        `${folder}/${link.path} at ${commit.slice(0, 12)} is a link or a submodule.`,
      );
    const blob = (entry) => git(repo, ['cat-file', 'blob', entry.object]);
    for (const entry of tree.filter((each) => /^deployment\/[^/]+-config\.xml$/.test(each.path))) {
      const text = blob(entry)?.toString('utf8') ?? '';
      if (!/<component[\s>]/.test(text))
        throw new Refusal(
          `${folder}/${entry.path} holds no <component>, so it contributes nothing.`,
        );
      config.push({
        kit: name,
        name: entry.path.slice('deployment/'.length),
        source: `${folder}/${entry.path}`,
        text,
      });
    }
    const seed = tree.find((each) => each.path === 'demo/seed.mjs');
    if (seed) {
      const { environment } = readSource(blob(seed).toString('utf8'), parse);
      seeds.push({
        kit: name,
        folder,
        file: `${folder}/demo/seed.mjs`,
        passwords: environment.filter((each) => /_PASSWORD$/.test(each) && each !== 'NUXEO_PASS'),
      });
    }
    served.set(
      name,
      tree
        .filter((each) => each.path.startsWith('bundle/agentic-ui-config/'))
        .map((each) => each.path.slice('bundle/agentic-ui-config/'.length))
        .sort(),
    );
  }
  const names = new Map();
  for (const each of config) {
    if (names.has(each.name))
      throw new Refusal(
        `${names.get(each.name)} and ${each.source} are both nxserver/config/${each.name}: one would replace the other.`,
      );
    names.set(each.name, each.source);
  }
  return { commit, config, seeds, served };
}

/** Each kit's folder, as the candidate's own demo listing names it, beside its package name. */
export function kitFolders(manifest) {
  const listing = Array.isArray(manifest.demoSteps) ? manifest.demoSteps : [];
  return manifest.kits.map((kit) => {
    const listed = listing.find((each) => each.name === kit.name);
    const folder = listed?.kit ?? kit.name;
    if (!/^[A-Za-z0-9._-]+$/.test(folder) || folder.startsWith('.'))
      throw new Refusal(`manifest.json names the kit folder ${JSON.stringify(folder)}.`);
    return { name: kit.name, folder: `business-apps/packages/${folder}` };
  });
}

/** Every secret a run needs, by its variable: the Connect registration, the administrator's, each seed's. */
export function requiredSecrets(seeds) {
  return [CLID, ADMIN_PASSWORD, ...[...new Set(seeds.flatMap((seed) => seed.passwords))].sort()];
}

/**
 * Why the environment's secrets will not do, each a sentence that names the variable and never its
 * value. The administrator's must not be the image's default, which every fresh Nuxeo answers to,
 * nor short; a demo users' password must not be the administrator's, since it is given to whoever
 * presents.
 */
export function secretProblems(env, required) {
  const problems = [];
  for (const name of required)
    if (typeof env[name] !== 'string' || env[name] === '')
      problems.push(
        `${name} is not set${name === CLID ? ': the image installs the OpenSearch packages from Nuxeo Connect with it' : ''}.`,
      );
  const admin = env[ADMIN_PASSWORD];
  if (admin) {
    if (admin === IMAGE_DEFAULT_SECRET)
      problems.push(`${ADMIN_PASSWORD} is the image's default, which every new Nuxeo answers to.`);
    else if (admin.length < SHORTEST_ADMIN_SECRET)
      problems.push(`${ADMIN_PASSWORD} is shorter than ${SHORTEST_ADMIN_SECRET} characters.`);
  }
  for (const name of required.filter((each) => each !== CLID && each !== ADMIN_PASSWORD)) {
    const value = env[name];
    if (!value) continue;
    if (admin && value === admin)
      problems.push(
        `${name} is the administrator's password, and the demo users' is given to whoever presents.`,
      );
    // The demo users may change the claims on a server others can reach; and a value this short
    // could not be taken out of what is printed without taking out ordinary words.
    else if (value.length < SHORTEST_DEMO_SECRET)
      problems.push(`${name} is shorter than ${SHORTEST_DEMO_SECRET} characters.`);
  }
  return problems;
}

/** Where the install's payload goes in the container, beside the script the image runs. */
export const INIT_DIRECTORY = '/docker-entrypoint-initnuxeo.d';
export const PAYLOAD = `${INIT_DIRECTORY}/demo-server`;
export const INIT_SCRIPT = 'zz-demo-server-install.sh';
export const INSTALL_LOG = '/var/log/nuxeo/demo-server-install.log';
/** `mp-list`'s answer, kept beside the log: the `nuxeo` user may write in /var/log/nuxeo. */
export const INSTALL_LIST = '/var/log/nuxeo/demo-server-packages.txt';

/**
 * A word for bash, single-quoted, so nothing in it is read as more: every file name, package name
 * and version the script holds goes through this. The commit is forty hexadecimal digits and the
 * candidate's version is checked as `readCandidate` reads it, and both are quoted all the same.
 */
const quoted = (text) => `'${String(text).replaceAll("'", "'\\''")}'`;
const fileName = (path) => path.split('/').pop();

/**
 * The one-off script the image runs before the server's first start, as the kits' READMEs install
 * them: one `nuxeoctl mp-install` of every package in dependency order, then the bundles of the
 * add-ons that have no package into `nxserver/bundles/`, then the deployment's configuration into
 * `nxserver/config/`. It stops the start at the first step that fails, so a server never runs with
 * half of a candidate: last, `nuxeoctl mp-list` must list every package of the candidate, by its
 * id, as started or installed. It removes itself only once every step passed. It holds no secret:
 * the image writes NUXEO_CLID itself, from the container's environment.
 *
 * `mp-install` is given `--accept=true` alone, as the kits' READMEs ran it. The plan has already
 * held every package's target platform to the image's Nuxeo.
 */
export function initScript(plan) {
  const step = (command, what) => `${command} >> "$log" 2>&1 || fail ${quoted(what)}`;
  const lines = [
    '#!/bin/bash',
    "# The demo server's one-off install, written by scripts/demo-server.mjs for a release candidate.",
    '# The image runs it before the server starts; it stops that start at the first step that fails,',
    '# and removes itself once every step passed.',
    'set -u',
    `version=${quoted(plan.candidate.version)}`,
    `commit=${quoted(plan.candidate.commit)}`,
    `payload=${PAYLOAD}`,
    `log=${INSTALL_LOG}`,
    `list=${INSTALL_LIST}`,
    'fail() { echo "demo server: $1, see $log"; cat "$log"; exit 1; }',
    'echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ) release candidate $version, from $commit" >> "$log"',
    step(
      `nuxeoctl mp-install ${plan.install.map((each) => `"$payload/packages/"${quoted(fileName(each.artifact))}`).join(' ')} --accept=true`,
      'the packages could not be installed',
    ),
  ];
  if (plan.bundles.length > 0)
    lines.push(
      ...plan.bundles.map((each) =>
        step(
          `cp "$payload/bundles/"${quoted(fileName(each.artifact))} "$NUXEO_HOME/nxserver/bundles/"`,
          `the bundle of ${each.name} could not be placed`,
        ),
      ),
    );
  if (plan.config.length > 0)
    lines.push(
      step('mkdir -p "$NUXEO_HOME/nxserver/config"', 'nxserver/config could not be made'),
      ...plan.config.map((each) =>
        step(
          `cp "$payload/config/"${quoted(each.name)} "$NUXEO_HOME/nxserver/config/"`,
          `${each.name} could not be placed`,
        ),
      ),
    );
  lines.push(
    'nuxeoctl mp-list > "$list" 2>&1 || fail \'the installed packages could not be listed\'',
    'cat "$list" >> "$log"',
    ...plan.install.map(
      (each) =>
        `grep -F ${quoted(`id: ${each.name}-${each.version})`)} "$list" | grep -Eq 'started|installed' || fail ${quoted(`${each.name} ${each.version} is not installed, by nuxeoctl mp-list`)}`,
    ),
    'rm -f "$0"',
    'echo "demo server: installed, see $log"',
    '',
  );
  return lines.join('\n');
}

/** `config:dev`'s argument for one file of an app definition, or `null` for one it does not serve. */
function servedArgument(path) {
  const at = `$C/${path}`;
  let found = /^layouts\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.layout\.json$/.exec(path);
  if (found) return `--layout ${found[1]}/${found[2]}=${at}`;
  if (path === 'home.json') return `--home ${at}`;
  if (path === 'navigation.json') return `--navigation ${at}`;
  found = /^labels\/([A-Za-z-]+)\.json$/.exec(path);
  if (found) return `--labels ${found[1]}=${at}`;
  found = /^queues\/([A-Za-z0-9_-]+)\.json$/.exec(path);
  if (found) return `--queue ${at}`;
  found = /^tasks\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\.layout\.json$/.exec(path);
  if (found) return `--task ${found[1]}=${at}`;
  return null;
}

/**
 * The command that serves a kit's app definition on the development server, as each kit's README,
 * "Seeing it under nx serve", writes it: every layout, the home, the menu, the labels, the queues
 * and the task forms. The steps files declare they need it (`serverRun.needs`).
 */
export function configDevCommand(folder, files) {
  const order = ['--layout', '--home', '--navigation', '--labels', '--queue', '--task'];
  const args = files
    .map(servedArgument)
    .filter(Boolean)
    .sort(
      (a, b) => order.indexOf(a.split(' ')[0]) - order.indexOf(b.split(' ')[0]) || (a < b ? -1 : 1),
    );
  return `C=${folder}/bundle/agentic-ui-config && npm run config:dev -- ${args.join(' ')}`;
}

/**
 * How to run every demo steps file the candidate lists against this server, as shell lines with
 * every secret by its variable. The steps files are written against the development server, which
 * serves the kit's files (`config:dev`) and proxies `/nuxeo` to the server named by
 * NUXEO_PROXY_TARGET (`proxy.remote.conf.mjs`), on a port of its own beside a developer's 4200.
 */
export function stepsText(plan) {
  const origin = plan.origin;
  const app = `http://localhost:${STEPS_DEV_SERVER_PORT}`;
  const lines = [
    `From a checkout at ${plan.candidate.commit.slice(0, 12)}, the candidate's commit, with npm ci run, and the secrets above exported:`,
    '',
  ];
  for (const kit of plan.steps) {
    const title = `${kit.name} ${kit.version}`;
    if (kit.files.length === 0) {
      lines.push(`${title}: no steps file names this kit, so it has no demo steps to run.`, '');
      continue;
    }
    const seed = plan.seeds.find((each) => each.kit === kit.name);
    lines.push(
      `${title}: ${kit.files.length} steps file(s). Serve the kit's files, then start the development server, or restart it:`,
      `  ${configDevCommand(plan.kits.find((each) => each.name === kit.name).folder, plan.served.get(kit.name) ?? [])}`,
      `  NUXEO_PROXY_TARGET=${origin} npx ng serve nuxeo-ui --configuration=development,remote --port ${STEPS_DEV_SERVER_PORT}`,
    );
    for (const file of kit.files) {
      const user = file.runAs.users[0] ?? ADMINISTRATOR;
      const secret = file.runAs.users.length === 0 ? ADMIN_PASSWORD : (seed?.passwords[0] ?? null);
      const name = fileName(file.file).replace(/\.mjs$/, '');
      const others = file.runAs.users.slice(1);
      lines.push(
        `  ${file.file}: as ${user}${others.length > 0 ? ` (or ${others.join(', ')})` : ''}, ${file.runAs.who}.`,
        `    APP_URL=${app} NUXEO_URL=${origin} NUXEO_USER=${user} NUXEO_PASS=${secret ? `"$${secret}"` : '<their password>'} npm run beta:evidence -- ${name}`,
      );
      const reads = file.environment.filter(
        (each) => !['APP_URL', 'NUXEO_URL', 'NUXEO_USER', 'NUXEO_PASS'].includes(each),
      );
      if (reads.length > 0)
        lines.push(`    It also reads ${reads.join(', ')} from the environment.`);
      if (file.signsInAs.length > 0)
        lines.push(`    It also signs in as ${file.signsInAs.join(', ')}.`);
      if (file.needs.length > 0) lines.push(`    It needs ${file.needs.join('; ')}.`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The plan, from the candidate and its commit: everything a run does, in order, with nothing it
 * would need to ask anyone. `docker` is what the operator's Docker answered, or `null`; `secrets`
 * which of the required variables are set, never their values.
 */
export function buildPlan({ repo, candidate, options, parse }) {
  const { manifest } = candidate;
  const { packages, bundles } = readPackages(candidate);
  const install = installOrder(packages);
  // The kits the manifest lists are the kits it ships: a kit listed with no zip would be seeded
  // and never installed, and a zip not listed would be installed and never seeded.
  const listed = manifest.kits.map((kit) => kit.name).sort();
  const shipped = packages
    .filter((each) => each.kind === 'kit')
    .map((each) => each.name)
    .sort();
  if (JSON.stringify(listed) !== JSON.stringify(shipped))
    throw new Refusal(
      `manifest.json lists the kits ${listed.join(', ') || 'none'}, and ships the kits ${shipped.join(', ') || 'none'}.`,
    );
  // Every file goes into one folder of the payload by its name: two of one name would be one.
  const names = [...install, ...bundles].map((each) => each.artifact.split('/').pop());
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined)
    throw new Refusal(
      `the candidate ships two files named ${twice}, which the payload cannot hold both of.`,
    );
  const kits = kitFolders(manifest);
  const { commit, config, seeds, served } = fromCommit({ repo, manifest, kits, parse });
  const order = install.map((each) => each.name);
  seeds.sort((a, b) => order.indexOf(a.kit) - order.indexOf(b.kit));
  return {
    candidate: {
      directory: candidate.directory,
      version: manifest.version,
      commit,
      files: candidate.files,
      uncommitted: manifest.uncommitted ?? [],
    },
    project: options.project,
    names: stackNames(options.project),
    bind: options.bind,
    port: options.port,
    origin: originOf(options),
    install,
    bundles,
    config,
    seeds,
    served,
    kits,
    secrets: requiredSecrets(seeds),
    steps: Array.isArray(manifest.demoSteps) ? manifest.demoSteps : [],
  };
}

/** What the run will do, in order, as the dry run prints it and the run prints it first. */
export function planText(plan, { secretsSet, existing, portFree, compose }) {
  const { names } = plan;
  const kitsWithout = plan.install
    .filter((each) => each.kind === 'kit' && !plan.seeds.some((seed) => seed.kit === each.name))
    .map((each) => each.name);
  const lines = [
    `Release candidate ${plan.candidate.version}, from ${plan.candidate.commit.slice(0, 12)}, in ${plan.candidate.directory}: ${plan.candidate.files} files, each with the digest SHA256SUMS gives it.`,
    '',
    `The stack, compose project ${plan.project}, from ${compose}:`,
    `  - ${names.containers.nuxeo}: ${STACK.nuxeoImage}, published on ${plan.bind}:${plan.port}, ${plan.origin}/nuxeo`,
    `  - ${names.containers.opensearch}: ${STACK.opensearchImage}, on the project's network only`,
    `  - volumes ${names.volumes.join(', ')}; network ${names.network}`,
    `  ${existing === null ? 'Not checked: Docker did not answer.' : existing.length === 0 ? 'None of these exists yet.' : `Already there, so a run is refused: ${existing.join(', ')}.`}`,
    `  ${portFree === null ? 'The port was not checked.' : portFree ? `Nothing answers on ${plan.bind}:${plan.port}.` : `${plan.bind}:${plan.port} is in use, so a run is refused.`}`,
    '',
    'At its first start, once, before the server runs:',
    `  1. The image installs from Nuxeo Connect, with NUXEO_CLID: ${STACK.connectPackages.join(', ')}.`,
    '  2. One nuxeoctl mp-install of every package of the candidate, in dependency order:',
    ...plan.install.map(
      (each, index) =>
        `       ${index + 1}. ${each.name} ${each.version}, ${each.kind}, ${each.artifact}; depends on ${each.dependencies.join(', ') || 'nothing'}`,
    ),
    `     Every dependency is met in the candidate, and every target platform admits Nuxeo ${STACK.nuxeoVersion}.`,
    `  3. The bundles of the add-ons with no package, into nxserver/bundles/: ${plan.bundles.map((each) => `${each.name} ${each.version} (${each.artifact})`).join(', ') || 'none'}.`,
    `  4. The deployment's configuration, into nxserver/config/, from ${plan.candidate.commit.slice(0, 12)}: ${plan.config.map((each) => `${each.name} (${each.source})`).join(', ') || 'none'}.`,
    '',
    'Once it answers:',
    `  5. The ${ADMINISTRATOR} password changed from the image's default to ${ADMIN_PASSWORD}, and the default checked refused.`,
    "  6. The server log's Component Loading Status: nothing pending, missing or unstarted.",
    `  7. Each kit's seed, from ${plan.candidate.commit.slice(0, 12)}, as ${ADMINISTRATOR}, in the order above:`,
    ...plan.seeds.map(
      (seed) =>
        `       - ${seed.kit}: node ${seed.file}${seed.passwords.length > 0 ? `, its demo users given ${seed.passwords.join(', ')}` : ''}`,
    ),
    ...(kitsWithout.length > 0 ? [`     No seed: ${kitsWithout.join(', ')}.`] : []),
    '',
    'Secrets, from the environment only, never printed:',
    ...plan.secrets.map(
      (name) =>
        `  - ${name}: ${secretsSet === null ? 'not checked' : secretsSet.has(name) ? 'set' : 'NOT SET'}`,
    ),
    '',
    `The install script, ${INIT_DIRECTORY}/${INIT_SCRIPT}:`,
    ...initScript(plan)
      .trimEnd()
      .split('\n')
      .map((line) => `  | ${line}`),
    '',
    'The demo steps, against this server.',
    stepsText(plan),
    `Afterwards, from the repository's root: docker compose -f ${compose} -p ${plan.project} stop, start, or down --volumes to remove it and its data.`,
  ];
  return `${lines.join('\n')}\n`;
}
