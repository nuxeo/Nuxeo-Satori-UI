/**
 * `satori connect [<directory>] [--server <origin>] [--user <name>] [--password-stdin] [--check]`:
 * gives the MCP server `satori mcp` the development server's address and an account to read it
 * with, for an AI IDE that does not start it from a shell, as the Claude desktop app does not.
 *
 * The server reads `NUXEO_URL`, `NUXEO_USER` and `NUXEO_PASS` from its environment, and nothing
 * else (`tools/builder-mcp/src/config.ts`). Claude Code gives a server the `env` of
 * `.claude/settings.local.json`, the repository's settings that are the developer's own. So this
 * writes the three there, and only there:
 *
 * - **Asked for, never given on a command line.** The address and the user are asked for, or given
 *   with `--server` and `--user`; the password is read from the terminal without being shown, or
 *   from standard input with `--password-stdin`, for a script. With neither a terminal nor
 *   `--password-stdin`, it refuses: an agent does not run this, a person does.
 * - **Checked before it is kept.** The address is held to the MCP server's own rule (an origin,
 *   https unless it is this machine, no credentials in it), and the server must answer
 *   `GET /nuxeo/api/v1/me` with the account, 200. Nothing is written otherwise.
 * - **Kept out of the repository.** The file must be one git ignores, and does not track, in a git
 *   repository; it is written with mode 0600, every other key in it kept, renamed into place.
 * - **Never printed.** The password is in no message, no argument and no address.
 *
 * `--check` writes nothing: the file is ignored and untracked, holds the three, and the server
 * answers with them. It prints the user's name, not the password. Exit codes: 0, done or in step;
 * 1, refused; 2, the command was wrong.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { LOCAL_SETTINGS } from './agents.mjs';

const USAGE =
  'usage: satori connect [<directory>] [--server <origin>] [--user <name>] [--password-stdin] [--check]';
const VARIABLES = { url: 'NUXEO_URL', user: 'NUXEO_USER', password: 'NUXEO_PASS' };

export async function connectCommand(args) {
  const options = { check: false, passwordStdin: false, server: undefined, user: undefined };
  const positionals = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--password-stdin') options.passwordStdin = true;
    else if (arg === '--server' || arg === '--user') {
      const value = args[++index];
      if (value === undefined || value.startsWith('--')) return usage(`${arg} takes a value.`);
      options[arg.slice(2)] = value;
    } else if (arg.startsWith('-')) return usage(`${arg} is not an option of connect.`);
    else positionals.push(arg);
  }
  if (positionals.length > 1) return usage('connect takes one folder at most.');
  const directory = resolve(positionals[0] ?? '.');
  if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory())
    return usage(`${positionals[0] ?? '.'} is not a folder.`);

  const kept = keptOut(directory);
  if (kept !== null) return refuse(kept);
  const file = join(directory, ...LOCAL_SETTINGS.split('/'));
  const settings = readSettings(file);
  if ('problem' in settings) return refuse(settings.problem);

  if (options.check) {
    const env = settings.value.env ?? {};
    const missing = Object.values(VARIABLES).filter((name) => typeof env[name] !== 'string');
    if (missing.length > 0)
      return refuse(
        `${LOCAL_SETTINGS} does not hold ${missing.join(', ')}: run satori connect in a terminal.`,
      );
    const mode = lstatSync(file).mode & 0o777;
    if (process.platform !== 'win32' && (mode & 0o077) !== 0)
      return refuse(
        `${LOCAL_SETTINGS} can be read by others (mode ${mode.toString(8)}): chmod 600 it.`,
      );
    const origin = readOrigin(env[VARIABLES.url]);
    if (typeof origin !== 'string') return refuse(origin.problem);
    const answer = await signIn(origin, env[VARIABLES.user], env[VARIABLES.password]);
    if ('problem' in answer) return refuse(answer.problem);
    process.stdout.write(
      `satori connect --check: ${origin} answers as ${answer.user}, from ${LOCAL_SETTINGS}, which git ignores.\n`,
    );
    return 0;
  }

  if (!options.passwordStdin && !process.stdin.isTTY)
    return refuse(
      'it asks for the password in a terminal, and there is none here. Run satori connect yourself, in a terminal (in the Claude app, its terminal pane), not through the agent; or give the password on standard input with --password-stdin, from a script.',
    );
  const server =
    options.server ??
    (await ask('The development server, such as https://nuxeo-dev.example.com: '));
  const origin = readOrigin(server.trim());
  if (typeof origin !== 'string') return refuse(origin.problem);
  const user = (options.user ?? (await ask('The user to read its model as: '))).trim();
  if (user === '') return refuse('no user was given.');
  const password = options.passwordStdin
    ? readFileSync(0, 'utf8').replace(/\r?\n$/, '')
    : await askHidden(`${user}'s password (not shown): `);
  if (password === '') return refuse('no password was given.');
  const answer = await signIn(origin, user, password);
  if ('problem' in answer) return refuse(answer.problem);

  const value = settings.value;
  value.env = {
    ...(value.env ?? {}),
    [VARIABLES.url]: origin,
    [VARIABLES.user]: user,
    [VARIABLES.password]: password,
  };
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.satori-${process.pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    return refuse(`${LOCAL_SETTINGS} could not be written (${error.code ?? error.message}).`);
  }
  process.stdout.write(
    `satori connect: ${origin} answers as ${answer.user}. Its address and the account are in ${LOCAL_SETTINGS}, readable by you alone, which git ignores and the agent may not read. Restart the MCP server to use them: in Claude, /mcp.\n`,
  );
  return 0;
}

function usage(why) {
  console.error(`satori connect: ${why}\n${USAGE}`);
  return 2;
}

function refuse(why) {
  console.error(`satori connect: nothing was written: ${why}`);
  return 1;
}

/**
 * Why the local settings could end up in the repository, or `null`: it is not a git repository,
 * git tracks the file, or does not ignore it.
 */
function keptOut(directory) {
  const git = (...args) => spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  const inside = git('rev-parse', '--is-inside-work-tree');
  if (inside.status !== 0 || inside.stdout.trim() !== 'true')
    return `${directory} is not a git repository, so ${LOCAL_SETTINGS} could not be held out of it: run git init first.`;
  if (git('ls-files', '--error-unmatch', LOCAL_SETTINGS).status === 0)
    return `git tracks ${LOCAL_SETTINGS}, so the password would be committed: git rm --cached it, and add it to .gitignore.`;
  if (git('check-ignore', '-q', LOCAL_SETTINGS).status !== 0)
    return `.gitignore does not ignore ${LOCAL_SETTINGS}, so the password could be committed: add the line ${LOCAL_SETTINGS} to it.`;
  return null;
}

/** The local settings as an object, `{}` when there are none, or why they cannot be kept. */
function readSettings(file) {
  const entry = lstatSync(file, { throwIfNoEntry: false });
  if (entry === undefined) return { value: {} };
  if (!entry.isFile()) return { problem: `${LOCAL_SETTINGS} is not a file.` };
  try {
    const value = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return { problem: `${LOCAL_SETTINGS} is not a JSON object.` };
    if (
      value.env !== undefined &&
      (value.env === null || typeof value.env !== 'object' || Array.isArray(value.env))
    )
      return { problem: `"env" in ${LOCAL_SETTINGS} is not an object.` };
    return { value };
  } catch (error) {
    return { problem: `${LOCAL_SETTINGS} is not JSON (${error.message}).` };
  }
}

/** The MCP server's rule for `NUXEO_URL` (`readOrigin`, config.ts): an origin, https off this machine. */
export function readOrigin(text) {
  const refuse = (why) => ({
    problem: `${JSON.stringify(text)} ${why}. Give the server's origin, such as https://nuxeo-dev.example.com, without /nuxeo.`,
  });
  let url;
  try {
    url = new URL(text);
  } catch {
    return refuse('is not an address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return refuse('is not http or https');
  if (url.username !== '' || url.password !== '') return refuse('holds credentials');
  if (url.pathname.replace(/\/+$/, '') === '/nuxeo') url.pathname = '/';
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '')
    return refuse('has a path, a query or a fragment');
  const local =
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.hostname.endsWith('.localhost');
  if (url.protocol === 'http:' && !local)
    return refuse(
      `uses http to ${url.hostname}, which would send the password in clear text; use https`,
    );
  return url.origin;
}

/** Signs in as `user`: `{ user }`, the id the server answers, or `{ problem }`, never the password. */
async function signIn(origin, user, password) {
  let response;
  try {
    response = await fetch(`${origin}/nuxeo/api/v1/me`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
        accept: 'application/json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return { problem: `${origin} did not answer (${error.cause?.code ?? error.name}).` };
  }
  if (response.status === 401 || response.status === 403)
    return {
      problem: `${origin} refused ${user} with HTTP ${response.status}: the user or the password is wrong.`,
    };
  if (response.status !== 200)
    return {
      problem: `${origin} answered GET /nuxeo/api/v1/me with HTTP ${response.status}, not 200: is it a Nuxeo server?`,
    };
  try {
    const me = await response.json();
    return { user: typeof me?.id === 'string' ? me.id : user };
  } catch {
    return {
      problem: `${origin} answered GET /nuxeo/api/v1/me with something that is not Nuxeo's JSON.`,
    };
  }
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

/** Reads a line from the terminal without showing it. */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    const done = (error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return done();
        if (char === '\u0003') return done(new Error('cancelled'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    input.on('data', onData);
  });
}
