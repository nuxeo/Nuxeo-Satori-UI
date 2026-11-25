#!/usr/bin/env node
/**
 * A demo server, stood up from a release candidate's output directory, for whoever runs the shared
 * server (business-apps/demo-server/README.md; the development plan's phase 0, "the demo server is
 * up"). Docker Compose, with Nuxeo and OpenSearch at the local setup's versions
 * (`business-apps/demo-server/compose.yml`), in a compose project of its own.
 *
 *   node scripts/demo-server.mjs --candidate <release candidate directory> [--project satori-demo]
 *     [--port 18080] [--bind 127.0.0.1] [--wait 1200] [--dry-run]
 *
 * In order, each step stopping the run when it fails:
 *
 *   1. The command, and Node at the version `.nvmrc` pins, which the seeds need.
 *   2. The candidate, held to its own checksums, and its plan (`demo-server-plan.mjs`): every
 *      package read from its zip, put in dependency order with every dependency met in the
 *      candidate and every target platform admitting the image's Nuxeo; each kit's deployment
 *      configuration and seed read from the candidate's commit.
 *   3. The secrets, from the environment only: NUXEO_CLID, DEMO_SERVER_ADMIN_PASSWORD and the demo
 *      users' password each seed reads, such as PAYERS_DEMO_PASSWORD. Unset, the default, short,
 *      or the administrator's given to the demo users, the run is refused. Never printed: a child's
 *      output is printed with each of them taken out.
 *   4. Docker, and nothing of the project there yet: no container, volume or network compose labels
 *      as the project's or that has one of its names. And the port free. So it never touches a
 *      server it did not create, the developer's `nuxeo` among them.
 *   5. The images pulled, the containers created, not started, and into the Nuxeo container: the
 *      OpenSearch settings in `/etc/nuxeo/conf.d/`, the packages, bundles and configuration, and
 *      the one-off install script in `/docker-entrypoint-initnuxeo.d/`, which the image runs before
 *      the server's first start, as the kits' READMEs install them. One start.
 *   6. The server answering, the administrator's password changed from the image's default and the
 *      default checked refused, the server log's Component Loading Status clean, and each kit's
 *      seed run, in install order.
 *   7. How to run every demo steps file against it, printed.
 *
 * `--dry-run` does 1 to 4, changing nothing, and prints the plan: what a run would install and in
 * which order, the install script, the seeds, and how each demo steps file runs. It reports the
 * secrets as set or not and does not refuse for them, since it needs none.
 *
 * It builds, tags, pushes and publishes nothing, and logs in nowhere: the Nuxeo image is pulled
 * with the Docker login the operator already has. DEMO_SERVER_DOCKER names another Docker CLI, for
 * the controls' stand-in (`demo-server.selftest.mjs`).
 *
 * When a step after the containers are made fails, what was made is left as safe as it can be: not
 * started yet, it is removed; started with the image's default password, it is stopped and kept
 * for its logs; started and secured, it keeps running. Each way the command that removes it is
 * printed. An interruption is handled the same way.
 *
 * macOS and Linux. It has not been run against Docker yet (the README says what was checked).
 *
 * Exit codes: 0, the server is up, or the dry run printed its plan; 1, a step failed once something
 * was made, and what is left is said; 2, refused, and nothing was made; 128 and the signal's
 * number, interrupted.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  componentStatus,
  dockerCli,
  dockerProblem,
  existingResources,
  Failure,
  portInUse,
  quietEnvironment,
  seedEnvironment,
  setAdministratorPassword,
  waitForServer,
  why,
} from './demo-server-host.mjs';
import {
  ADMIN_PASSWORD,
  buildPlan,
  CLID,
  INIT_DIRECTORY,
  INIT_SCRIPT,
  initScript,
  parseArguments,
  planText,
  readCandidate,
  Refusal,
  secretProblems,
  stepsText,
  USAGE,
} from './demo-server-plan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_SHOWN = 'business-apps/demo-server/compose.yml';
const COMPOSE = join(REPO, ...COMPOSE_SHOWN.split('/'));
const OPENSEARCH_SETTINGS = join(REPO, 'business-apps', 'demo-server', '90-demo-server.conf');
const OUTPUT_LIMIT = 256 * 1024 * 1024;

/**
 * The environment as it was given, read once. This process keeps none of its secrets after, so a
 * child started without an environment of its own, the library's `unzip` or git, inherits none.
 */
const environment = { ...process.env };
const kept = quietEnvironment(environment);
for (const name of Object.keys(process.env)) if (!(name in kept)) delete process.env[name];

function refuse(message) {
  console.error(`\nRefused, and nothing was made: ${message}`);
  process.exit(2);
}

// ── 1. The command ──────────────────────────────────────────────────────────────────────────────
const parsed = parseArguments(process.argv.slice(2));
if (parsed.error) {
  console.error(`${parsed.error}\n${USAGE}`);
  process.exit(2);
}
const { options } = parsed;
const pinned = readFileSync(join(REPO, '.nvmrc'), 'utf8').trim().replace(/^v/, '').split('.')[0];
if (process.versions.node.split('.')[0] !== pinned)
  refuse(
    `this is Node ${process.versions.node}, and .nvmrc pins Node ${pinned}, which the seeds run on.`,
  );
let parse;
try {
  ({ parse } = await import('acorn'));
} catch {
  refuse('acorn is not installed, so the seeds cannot be read: run npm ci first.');
}

// ── 2. The candidate and its plan ───────────────────────────────────────────────────────────────
let plan;
try {
  plan = buildPlan({
    repo: REPO,
    candidate: readCandidate(resolve(options.candidate)),
    options,
    parse,
  });
} catch (error) {
  if (error instanceof Refusal) refuse(error.message);
  throw error;
}

/**
 * Every secret's value, and the forms a child might print it in, to take out of what is printed.
 * A NUXEO_CLID's lines are joined by `--`, which the image splits.
 */
const secretValues = plan.secrets
  .map((name) => environment[name])
  .filter((value) => typeof value === 'string' && value.length >= 4);
const redactions = [
  ...secretValues,
  ...secretValues.flatMap((value) => value.split('--').filter((part) => part.length >= 8)),
  ...(environment[ADMIN_PASSWORD]
    ? [Buffer.from(`Administrator:${environment[ADMIN_PASSWORD]}`).toString('base64')]
    : []),
].sort((a, b) => b.length - a.length);
const redact = (text) =>
  redactions.reduce(
    (out, value) => out.split(value).join('<a secret, not printed>'),
    `${text ?? ''}`,
  );
const say = (text) => process.stdout.write(redact(text));

// ── 3. The secrets ──────────────────────────────────────────────────────────────────────────────
const secretsSet = new Set(plan.secrets.filter((name) => environment[name]));
const secretsRefused = secretProblems(environment, plan.secrets);
if (!options.dryRun && secretsRefused.length > 0)
  refuse(
    `the secrets are not right, so no server is made:\n${secretsRefused.map((problem) => `  - ${problem}`).join('\n')}\n` +
      'Export each one in this shell; none is read from a file, and none is printed.',
  );

// ── 4. Docker, the project and the port ─────────────────────────────────────────────────────────
const docker = dockerCli({
  command: environment.DEMO_SERVER_DOCKER || 'docker',
  env: environment,
  compose: {
    DEMO_SERVER_BIND: options.bind,
    DEMO_SERVER_PORT: String(options.port),
    DEMO_SERVER_CANDIDATE: `${plan.candidate.version}@${plan.candidate.commit}`,
    ...(environment[CLID] ? { [CLID]: environment[CLID] } : {}),
  },
});
const compose = (...args) => ['compose', '-f', COMPOSE, '-p', options.project, ...args];
const dockerSays = dockerProblem(docker);
let existing = null;
let dockerRefused = dockerSays;
if (dockerSays === null) {
  try {
    existing = existingResources(docker, options.project);
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    dockerRefused = error.message;
  }
}
const portTaken = await portInUse(options.port, options.bind);
const refusals = [
  ...(dockerRefused ? [dockerRefused] : []),
  ...(existing?.length > 0
    ? [
        `the compose project ${options.project} is already there (${existing.join(', ')}). This never touches a server it did not create: give another --project, or remove that one if it is yours, with docker compose -f ${COMPOSE_SHOWN} -p ${options.project} down --volumes.`,
      ]
    : []),
  ...(portTaken ? [`${options.bind}:${options.port} is in use: give another --port.`] : []),
];

if (options.dryRun) {
  say(planText(plan, { secretsSet, existing, portFree: !portTaken, compose: COMPOSE_SHOWN }));
  if (secretsRefused.length > 0)
    say(
      `\nA run would refuse these secrets, which the dry run does not need:\n${secretsRefused.map((problem) => `  - ${problem}`).join('\n')}\n`,
    );
  if (refusals.length > 0)
    refuse(`a run would be refused:\n${refusals.map((each) => `  - ${each}`).join('\n')}`);
  say('\nDry run: nothing was pulled, made or started.\n');
  process.exit(0);
}
if (refusals.length > 0) refuse(refusals.join('\n'));

// ── 5 to 7. The run ─────────────────────────────────────────────────────────────────────────────
say(planText(plan, { secretsSet, existing, portFree: true, compose: COMPOSE_SHOWN }));

/** How far the run got, for what a failure leaves: made, started, secured. */
const state = { made: false, started: false, secured: false };
class Interrupted extends Error {}
let interruptedBy = null;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(signal, () => {
    interruptedBy ??= signal;
  });
/** Lets a noted signal stop the run between steps: spawnSync does not let a listener run. */
async function checkpoint() {
  await new Promise((resolveNow) => setImmediate(resolveNow));
  if (interruptedBy !== null) throw new Interrupted(interruptedBy);
}
const step = (text) => say(`\n== ${text}\n`);
/** A Docker command that must succeed, its output printed with every secret taken out. */
function must(args, what) {
  const result = docker(args);
  if (result.stdout?.trim()) say(`${result.stdout.trimEnd()}\n`);
  if (result.status !== 0)
    throw new Failure(
      `${what}: docker ${args.slice(0, args[0] === 'compose' ? 6 : 1).join(' ')} ${redact(why(result))}`,
    );
  return result;
}

const scratch = mkdtempSync(join(tmpdir(), 'demo-server-'));
let code = 0;
try {
  // The payload, staged: the candidate's packages and bundles, the commit's configuration, a record.
  const payload = join(scratch, 'demo-server');
  for (const folder of ['packages', 'bundles', 'config'])
    mkdirSync(join(payload, folder), { recursive: true });
  for (const each of [
    ...plan.install.map((pkg) => ({ ...pkg, into: 'packages' })),
    ...plan.bundles.map((bundle) => ({ ...bundle, into: 'bundles' })),
  ])
    copyFileSync(
      join(plan.candidate.directory, ...each.artifact.split('/')),
      join(payload, each.into, each.artifact.split('/').pop()),
    );
  for (const each of plan.config) writeFileSync(join(payload, 'config', each.name), each.text);
  writeFileSync(
    join(payload, 'plan.json'),
    `${JSON.stringify(
      {
        candidate: plan.candidate,
        install: plan.install.map(({ name, version, artifact }) => ({ name, version, artifact })),
        bundles: plan.bundles,
        config: plan.config.map(({ name, source }) => ({ name, source })),
        seeds: plan.seeds.map(({ kit, file }) => ({ kit, file })),
      },
      null,
      2,
    )}\n`,
  );
  // Readable by the image's `nuxeo` user, whatever this machine's umask: docker cp keeps the modes.
  for (const folder of ['', 'packages', 'bundles', 'config'])
    chmodSync(join(payload, folder), 0o755);
  const script = join(scratch, INIT_SCRIPT);
  writeFileSync(script, initScript(plan), { mode: 0o755 });

  step(
    `Pulling ${COMPOSE_SHOWN}'s images, with this machine's Docker login: minutes, the first time`,
  );
  must(
    compose('pull', '--quiet'),
    'the images could not be pulled; for the Nuxeo image, docker login docker-private.packages.nuxeo.com with your own account',
  );
  await checkpoint();

  step(`Creating the project ${options.project}, not starting it`);
  state.made = true;
  must(compose('create'), 'the containers could not be created');
  const id = must(
    compose('ps', '--all', '--quiet', 'nuxeo'),
    'the Nuxeo container could not be found',
  ).stdout.trim();
  if (!/^[0-9a-f]{12,64}$/.test(id))
    throw new Failure(`compose named no single Nuxeo container (${JSON.stringify(id)}).`);
  must(
    ['cp', OPENSEARCH_SETTINGS, `${id}:/etc/nuxeo/conf.d/90-demo-server.conf`],
    'the OpenSearch settings could not be copied in',
  );
  must(['cp', payload, `${id}:${INIT_DIRECTORY}/`], 'the packages could not be copied in');
  must(
    ['cp', script, `${id}:${INIT_DIRECTORY}/${INIT_SCRIPT}`],
    'the install script could not be copied in',
  );
  await checkpoint();

  step(`Starting it: the image installs everything, then starts the server, once`);
  state.started = true;
  must(
    compose('up', '--detach', '--no-recreate', '--no-build'),
    'the project could not be started',
  );
  const exited = () => {
    if (interruptedBy !== null) return `interrupted (${interruptedBy})`;
    const status = docker(['inspect', '--format', '{{.State.Status}} {{.State.ExitCode}}', id]);
    const [now, exit] = status.stdout.trim().split(' ');
    if (status.status === 0 && (now === 'exited' || now === 'dead')) {
      const logs = docker(compose('logs', '--no-color', '--tail', '80', 'nuxeo'));
      say(`${logs.stdout ?? ''}${logs.stderr ?? ''}`);
      return `the Nuxeo container stopped with exit ${exit} before the server answered: the install script or the server failed, as its log above says`;
    }
    return null;
  };
  await waitForServer({
    origin: plan.origin,
    deadline: Date.now() + options.wait * 1000,
    stopped: exited,
  });
  say(`${plan.origin}/nuxeo/runningstatus answers 200.\n`);

  step(`Changing the Administrator's password to ${ADMIN_PASSWORD}`);
  await setAdministratorPassword({ origin: plan.origin, secret: environment[ADMIN_PASSWORD] });
  state.secured = true;
  say("Changed: the new one signs in as Administrator, and the image's default is refused.\n");

  step("Checking the server log's Component Loading Status");
  const grep = docker([
    'exec',
    id,
    'grep',
    '-h',
    'Component Loading Status',
    '/var/log/nuxeo/server.log',
  ]);
  const status = componentStatus(grep.stdout ?? '');
  if (status === null)
    throw new Failure(
      `the server log has no Component Loading Status line: docker exec ${id} grep -A20 "Component Loading Status" /var/log/nuxeo/server.log`,
    );
  if (status.pending + status.missing + status.unstarted > 0)
    throw new Failure(
      `the server started with ${status.pending} pending, ${status.missing} missing and ${status.unstarted} unstarted component(s), which a package's contribution or <require> left: docker exec ${id} grep -A30 "Component Loading Status" /var/log/nuxeo/server.log`,
    );
  say('Nothing pending, missing or unstarted.\n');
  await checkpoint();

  const commitTree = join(scratch, 'commit');
  for (const seed of plan.seeds) {
    step(`Seeding ${seed.kit}: ${seed.file}, at ${plan.candidate.commit.slice(0, 12)}`);
    mkdirSync(commitTree, { recursive: true });
    const archive = spawnSync(
      'git',
      ['archive', '--format=tar', plan.candidate.commit, '--', seed.folder],
      {
        cwd: REPO,
        maxBuffer: OUTPUT_LIMIT,
        env: quietEnvironment(environment),
      },
    );
    if (archive.status !== 0)
      throw new Failure(`git archive could not read ${seed.folder} at ${plan.candidate.commit}.`);
    const unpacked = spawnSync('tar', ['-x', '-f', '-', '-C', commitTree], {
      input: archive.stdout,
      env: quietEnvironment(environment),
    });
    if (unpacked.status !== 0) throw new Failure(`tar could not unpack ${seed.folder}.`);
    const ran = spawnSync(process.execPath, [join(commitTree, ...seed.file.split('/'))], {
      cwd: commitTree,
      encoding: 'utf8',
      maxBuffer: OUTPUT_LIMIT,
      env: seedEnvironment(environment, {
        origin: plan.origin,
        secret: environment[ADMIN_PASSWORD],
        passwords: seed.passwords,
        app: `${plan.origin}/nuxeo/agentic-ui`,
      }),
    });
    say(`${ran.stdout ?? ''}${ran.stderr ?? ''}`);
    await checkpoint();
    if (ran.status !== 0)
      throw new Failure(
        `the seed of ${seed.kit} ${ran.signal ? `was stopped by ${ran.signal}` : `exited ${ran.status}`}; it is safe to run again, once its message above is dealt with.`,
      );
  }

  say(
    `\nThe demo server is up: ${plan.origin}/nuxeo, the app at ${plan.origin}/nuxeo/agentic-ui/, from release candidate ${plan.candidate.version} (${plan.candidate.commit.slice(0, 12)}).\n` +
      `Install log: docker exec ${id} cat /var/log/nuxeo/demo-server-install.log\n\n` +
      `The demo steps, against it.\n${stepsText(plan)}` +
      `Stop, start or remove it, with its data, from the repository's root: docker compose -f ${COMPOSE_SHOWN} -p ${options.project} stop | start | down --volumes\n`,
  );
} catch (error) {
  const interrupted = error instanceof Interrupted;
  if (!(error instanceof Failure) && !interrupted && !(error instanceof Refusal))
    console.error(error.stack ?? error);
  console.error(
    `\n${interrupted ? `Interrupted (${error.message})` : `Failed: ${redact(error.message)}`}`,
  );
  const removal = `docker compose -f ${COMPOSE_SHOWN} -p ${options.project} down --volumes`;
  if (!state.made) {
    console.error('Nothing was made.');
    code = interrupted ? 128 + constants.signals[error.message] : 2;
  } else {
    if (!state.started) {
      const removed = docker(compose('down', '--volumes'));
      console.error(
        removed.status === 0
          ? `What it made, never started, is removed.`
          : `What it made, never started, could not be removed (${redact(why(removed))}): ${removal}`,
      );
    } else if (!state.secured) {
      const stopped = docker(compose('stop'));
      console.error(
        `${stopped.status === 0 ? 'The project is stopped' : `The project could not be stopped (${redact(why(stopped))})`}, with the image's default Administrator password, and kept for its logs: docker compose -f ${COMPOSE_SHOWN} -p ${options.project} logs nuxeo. Remove it with ${removal}.`,
      );
    } else {
      console.error(
        `The server keeps running, with the Administrator password changed. Remove it with ${removal}.`,
      );
    }
    code = interrupted ? 128 + constants.signals[error.message] : 1;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(code);
