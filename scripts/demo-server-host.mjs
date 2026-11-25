/**
 * What `scripts/demo-server.mjs` asks of the machine it runs on, and of the server it made: Docker,
 * a free port, the server's REST API, its log, and the seeds. Functions, each given what it talks
 * to, so that `demo-server.selftest.mjs` can answer for Docker and for Nuxeo without either.
 *
 * Every Docker command is named, with `-p <project>` for every compose command, so nothing here
 * can reach a container, volume or network the run did not make. None builds, tags, pushes or
 * logs in.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { join } from 'node:path';

import { ADMINISTRATOR, CLID, IMAGE_DEFAULT_SECRET, stackNames } from './demo-server-plan.mjs';

const OUTPUT_LIMIT = 256 * 1024 * 1024;

/** A failure once something was made: what failed, said to the operator. */
export class Failure extends Error {}

/** An interruption, by the signal's name: Ctrl-C, or a stop sent to this process. */
export class Interrupted extends Error {}
export const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * What a child of this command is given of its environment: what Docker, git, tar and Node need to
 * run, and nothing else. A list of what may pass rather than of what may not, so a credential under
 * a name nobody thought of, `*_API_KEY` say, passes to no child. `COMPOSE_*` is left out too: the
 * operator's COMPOSE_FILE or COMPOSE_PROJECT_NAME must not change which project a command reaches.
 */
const PASSED = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'TERM',
  'TZ',
]);
const PASSED_PREFIXES = ['LC_', 'DOCKER_', 'XDG_'];

/** `env` reduced to what may pass to a child, and the `extra` names a child of one kind needs. */
export function quietEnvironment(env, extra = []) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) =>
        typeof value === 'string' &&
        (PASSED.has(name) ||
          extra.includes(name) ||
          PASSED_PREFIXES.some((prefix) => name.startsWith(prefix))),
    ),
  );
}

/**
 * The Docker CLI, as a function: `docker(args)` runs it and returns spawnSync's result, its output
 * as text. `command` is `docker`, or the stand-in the controls give in DEMO_SERVER_DOCKER.
 * `compose` is what compose interpolates the file with: the port, the address, the candidate and
 * this run's mark. NUXEO_CLID goes to `compose create` alone, which writes it into the container's
 * environment; no other command, compose's or Docker's, is given it.
 */
export function dockerCli({ command, env, compose, clid }) {
  return (args) => {
    const sub = args[0] === 'compose' ? args[args.indexOf('-p') + 2] : null;
    return spawnSync(command, args, {
      encoding: 'utf8',
      maxBuffer: OUTPUT_LIMIT,
      env: {
        ...quietEnvironment(env),
        ...(args[0] === 'compose' ? compose : {}),
        ...(sub === 'create' && clid ? { [CLID]: clid } : {}),
      },
    });
  };
}

/** Whether a child ended because this process, or its terminal's group, was sent a stop. */
export const stoppedBySignal = (result) =>
  SIGNALS.includes(result.signal) || [130, 143, 129].includes(result.status);

/**
 * A function that takes every secret's value out of a text, and the forms a child may print it in:
 * a NUXEO_CLID's lines, which the image joins with `--`, and the Basic header of each person who
 * signs in with one. `people` is `[[user, secret]]`. A secret shorter than the shortest the run
 * accepts is never one, since the run refuses it first.
 */
export function redactor(secrets, people = []) {
  const values = secrets.filter((value) => typeof value === 'string' && value.length >= 8);
  const forms = [
    ...values,
    ...values.flatMap((value) => value.split('--').filter((part) => part.length >= 8)),
    ...people
      .filter(([, secret]) => typeof secret === 'string' && secret.length >= 8)
      .map(([user, secret]) => Buffer.from(`${user}:${secret}`).toString('base64')),
  ].sort((a, b) => b.length - a.length);
  return (text) =>
    forms.reduce((out, form) => out.split(form).join('<a secret, not printed>'), `${text ?? ''}`);
}

/**
 * Sets every file of the staged payload readable by anyone, and its folders and the install script
 * searchable too, whatever this machine's umask and whatever modes the candidate's files came
 * with: `docker cp` keeps the modes, and in the container the files are not the `nuxeo` user's.
 * `chmod` is not masked by the umask, as a file's creation is.
 */
export function readableByAnyone(path, executable = []) {
  const entry = statSync(path);
  if (entry.isDirectory()) {
    chmodSync(path, 0o755);
    for (const name of readdirSync(path)) readableByAnyone(join(path, name), executable);
  } else chmodSync(path, executable.includes(path) ? 0o755 : 0o644);
}

/**
 * The kit's folder as the candidate's commit has it, unpacked under `into` with `git archive`, so
 * that what runs is the commit's whatever the working tree holds. Returns nothing; throws a
 * Failure when git or tar refuses.
 */
export function unpackAtCommit({ repo, commit, folder, into, env }) {
  mkdirSync(into, { recursive: true });
  const archive = spawnSync('git', ['archive', '--format=tar', commit, '--', folder], {
    cwd: repo,
    maxBuffer: OUTPUT_LIMIT,
    env: quietEnvironment(env),
  });
  if (archive.status !== 0) throw new Failure(`git archive could not read ${folder} at ${commit}.`);
  const unpacked = spawnSync('tar', ['-x', '-f', '-', '-C', into], {
    input: archive.stdout,
    env: quietEnvironment(env),
  });
  if (unpacked.status !== 0) throw new Failure(`tar could not unpack ${folder}.`);
}

/** A seed run to its end, with `env`, from `cwd`: spawnSync's result, its output as text. */
export function runSeed({ file, cwd, env }) {
  return spawnSync(process.execPath, [file], {
    cwd,
    encoding: 'utf8',
    maxBuffer: OUTPUT_LIMIT,
    env,
  });
}

/** Why a Docker command failed, in a line, from its result. Never its environment. */
export function why(result) {
  if (result.error) return `could not be run (${result.error.code ?? result.error.message})`;
  const said = `${result.stderr ?? ''}`.trim().split('\n').slice(-3).join(' ').trim();
  return `exited ${result.status}${said ? `: ${said}` : ''}`;
}

/** Why Docker cannot run the stack here, or `null`: the CLI, its daemon, and Compose v2. */
export function dockerProblem(docker) {
  const server = docker(['version', '--format', '{{.Server.Version}}']);
  if (server.error) return `the Docker CLI ${why(server)}: install Docker, with Compose v2.`;
  if (server.status !== 0) return `Docker's daemon did not answer: docker version ${why(server)}.`;
  const compose = docker(['compose', 'version', '--short']);
  if (compose.status !== 0)
    return `Docker Compose v2 did not answer: docker compose version ${why(compose)}.`;
  return null;
}

/**
 * Everything of `project` Docker already has: a container, volume or network that compose labels
 * as the project's, or that has one of the names the project would give its own. Listed whole and
 * compared here, rather than with Docker's name filters, which match by pattern. Throws when Docker
 * cannot list one of them: what cannot be seen is not taken as absent.
 */
export function existingResources(docker, project) {
  const names = stackNames(project);
  const list = (what, args) => {
    const result = docker(args);
    if (result.status !== 0)
      throw new Failure(`docker ${args.slice(0, 2).join(' ')} ${why(result)}.`);
    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, label = ''] = line.split('\t');
        return { what, name, label };
      });
  };
  const label = '{{.Label "com.docker.compose.project"}}';
  const all = [
    ...list('container', ['ps', '--all', '--no-trunc', '--format', `{{.Names}}\t${label}`]),
    ...list('volume', ['volume', 'ls', '--format', `{{.Name}}\t${label}`]),
    ...list('network', ['network', 'ls', '--format', `{{.Name}}\t${label}`]),
  ];
  const own = new Set([...Object.values(names.containers), ...names.volumes, names.network]);
  return all
    .filter((each) => each.label === project || own.has(each.name))
    .map((each) => `${each.what} ${each.name}`);
}

/**
 * Whether something holds `port` on `host`: it answers a connection, or the port cannot be
 * listened on. Both, since on macOS a listener on 0.0.0.0 leaves 127.0.0.1 free to bind.
 */
export async function portInUse(port, host) {
  const answers = await new Promise((resolve) => {
    const socket = connect({ port, host: host === '0.0.0.0' ? '127.0.0.1' : host });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
  if (answers) return true;
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(true));
    server.listen(port, host, () => server.close(() => resolve(false)));
  });
}

/** A Basic `Authorization` header. Built where it is sent, and never printed. */
const basic = (user, secret) => `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;

async function ask(url, { method = 'GET', authorization, json, timeout = 10_000 } = {}) {
  const headers = { Accept: 'application/json' };
  if (authorization) headers.Authorization = authorization;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(url, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeout),
  });
}

/**
 * Until the server answers `/nuxeo/runningstatus` with 200. `stopped()` is asked before every try
 * and ends the wait with its answer when it has one: the container exited, or the run was
 * interrupted. A wait past `deadline` (ms since the epoch) is a failure.
 */
export async function waitForServer({ origin, deadline, stopped, interval = 2000 }) {
  for (;;) {
    const reason = stopped();
    if (reason) throw new Failure(reason);
    try {
      const response = await ask(`${origin}/nuxeo/runningstatus`, { timeout: 5000 });
      if (response.status === 200) return;
    } catch {
      // Not answering yet: the server is still installing or starting.
    }
    if (Date.now() > deadline)
      throw new Failure(
        `${origin}/nuxeo/runningstatus did not answer 200 in the time --wait gives.`,
      );
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/** Who `/me` says the request ran as, or `null` for a refusal. */
async function whoAmI(api, authorization) {
  const response = await ask(`${api}/me`, { authorization });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Failure(`GET /me answered ${response.status}.`);
  const body = await response.json();
  return typeof body?.id === 'string' ? body.id : '';
}

/**
 * The administrator's password, changed from the image's default to `secret`: the user read and
 * written back whole with the new password, as the Payers seed writes its people. Then checked
 * both ways: `/me` answers the new password as the administrator, and refuses the default. A server
 * that refuses the default before the change was changed by someone else since it started, and
 * nothing is written to it; the run stops it, as it stops any it could not show secured.
 */
export async function setAdministratorPassword({ origin, secret }) {
  const api = `${origin}/nuxeo/api/v1`;
  const before = basic(ADMINISTRATOR, IMAGE_DEFAULT_SECRET);
  const read = await ask(`${api}/user/${ADMINISTRATOR}`, { authorization: before });
  if (read.status === 401 || read.status === 403)
    throw new Failure(
      `the server refused the image's default ${ADMINISTRATOR} password before this run changed it, so someone changed it first, and nothing is written to it.`,
    );
  if (!read.ok) throw new Failure(`GET /user/${ADMINISTRATOR} answered ${read.status}.`);
  const user = await read.json();
  if (user?.['entity-type'] !== 'user' || user.id !== ADMINISTRATOR)
    throw new Failure(`GET /user/${ADMINISTRATOR} did not answer the ${ADMINISTRATOR} user.`);
  const written = await ask(`${api}/user/${ADMINISTRATOR}`, {
    method: 'PUT',
    authorization: before,
    json: {
      'entity-type': 'user',
      id: ADMINISTRATOR,
      properties: { ...user.properties, password: secret },
    },
  });
  if (!written.ok) throw new Failure(`PUT /user/${ADMINISTRATOR} answered ${written.status}.`);
  const now = await whoAmI(api, basic(ADMINISTRATOR, secret));
  if (now !== ADMINISTRATOR)
    throw new Failure(
      `/me did not answer the new password as ${ADMINISTRATOR} (${now ?? 'refused'}).`,
    );
  const old = await whoAmI(api, before);
  if (old === ADMINISTRATOR)
    throw new Failure(
      `the image's default ${ADMINISTRATOR} password still signs in after the change.`,
    );
}

/**
 * The last Component Loading Status the server's log holds, `{ pending, missing, unstarted }`, or
 * `null` when it holds none. Nuxeo prints one at every start:
 * `= Component Loading Status: Pending: 0 / Missing: 0 / Unstarted: 0 / Total: 3323`.
 */
export function componentStatus(log) {
  const all = [
    ...log.matchAll(
      /Component Loading Status: Pending: (\d+) \/ Missing: (\d+) \/ Unstarted: (\d+)/g,
    ),
  ];
  if (all.length === 0) return null;
  const [, pending, missing, unstarted] = all.at(-1);
  return { pending: Number(pending), missing: Number(missing), unstarted: Number(unstarted) };
}

/**
 * The environment a seed runs with: what any child may have and the two timings the seeds read,
 * then the server, the administrator, the app its links point at, and the demo users' passwords it
 * reads, by name. No token, and no other secret.
 */
export function seedEnvironment(env, { origin, secret, passwords, app }) {
  return {
    ...quietEnvironment(env, ['NUXEO_INDEX_WAIT_MS', 'NUXEO_TIMEOUT_MS']),
    NUXEO_URL: origin,
    NUXEO_USER: ADMINISTRATOR,
    NUXEO_PASS: secret,
    APP_URL: app,
    ...Object.fromEntries(passwords.map((name) => [name, env[name]])),
  };
}
