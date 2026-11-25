/**
 * `validate_package`: the package pipeline's checks on a package folder.
 *
 * It runs `scripts/app-package.mjs` as a command, the way `npm run app-package` and the
 * `app-packages.yml` workflow do, rather than calling the validator's functions: so the answer is
 * the pipeline's own, steps 1 to 6 of docs/business-apps/package-pipeline.md.
 *
 * - **As CI runs it, unless told otherwise.** Given the folder alone, it passes what the workflow
 *   passes: `--out` and `--platform`, the version of `libs/platform`, and the allow-list the package
 *   names beside its bundle, `deployment/build-allow-list.json`, when it has one. Another
 *   allow-list, a registered file or another platform version are the deployment's to give, and
 *   change what is checked, so the answer lists each one it was given under `departsFromCi`, and
 *   `asCi` is then false. It gives no content model, as CI gives none: the pipeline holds a package
 *   that ships a stand-in model to its own `content-model.json`, and a package on a server's model
 *   to none.
 * - **Inside the repository only** (`within`): no link followed, in the path or anywhere in the
 *   package, no hidden folder or file, and the allow-list and the registered file are JSON files.
 *   The pipeline's messages can quote what it read, and they go to the agent.
 * - **Nothing in the package is written.** The zip, its checksum and what the pipeline unpacks to
 *   read the zip back go to a folder of the run's own, in the system's temporary directory unless
 *   `workIn` names another, which is removed afterwards; the package's own `dist/` is not touched.
 * - **No package code runs** that this repository did not review: step 1 refuses a `build.mjs`
 *   that is not the generator's byte for byte, before step 4 runs it.
 * - **No network and no credential.** The pipeline gets only what finds `unzip`, the run's own
 *   temporary folder and the locale from the environment: not `NUXEO_PASS`, not a registry token.
 * - **Stopped whole.** Past {@link RUN_TIMEOUT_MS} or its output limit, the pipeline and every
 *   process it started are killed before the temporary directory is removed, and so they are when
 *   the server exits or is stopped by a signal it can catch (on Windows, only the pipeline's own
 *   process, and only on a timeout).
 *
 * The run's output is returned whole, and parsed where its form is known: each validator finding,
 * the step that refused the package, and the zip's digest when it was built.
 */
import { spawn } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const PIPELINE = join(REPO_ROOT, 'scripts', 'app-package.mjs');
export const RUN_TIMEOUT_MS = 180_000;
/** Where a package names the allow-list it is built against, which CI gives the pipeline. */
export const BUILD_ALLOW_LIST = ['deployment', 'build-allow-list.json'] as const;
const OUTPUT_LIMIT = 16 * 1024 * 1024;
/** What the pipeline's processes may see of the environment: where programs and temporary files are. */
const PASSED_ENVIRONMENT = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
];

export interface PackageRequest {
  /** The package folder, holding `build.mjs`, `bundle/` and `package/`. Relative to the repository. */
  readonly directory: string;
  readonly allowList?: string;
  readonly registered?: string;
  readonly platform?: string;
}

export interface PackageOptions {
  /** The folders a package and its files may be in. Default: the repository. */
  readonly roots?: readonly string[];
  readonly timeoutMs?: number;
  /**
   * Where the run works: a folder is made inside it for the zip, its checksum and the pipeline's
   * own temporary files, and removed afterwards. Default: the system's temporary folder.
   */
  readonly workIn?: string;
}

export interface Finding {
  /** The file, relative to the package folder. */
  readonly file: string;
  /** The place in the file, such as `cards[0].fields[1].widget`. */
  readonly place: string;
  readonly message: string;
  readonly kind: string;
}

export interface PackageCheck {
  readonly package: string;
  readonly passed: boolean;
  /** Whether it ran with what CI passes and nothing more. */
  readonly asCi: boolean;
  readonly departsFromCi: readonly string[];
  readonly exitCode: number | null;
  readonly refusedAt: { readonly step: number; readonly reason: string } | null;
  readonly findings: readonly Finding[];
  readonly zip: { readonly name: string; readonly sha256: string } | null;
  readonly command: string;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
  readonly note: string;
}

/** A path the caller gave, relative to the repository unless absolute. */
export function inRepository(path: string): string {
  return isAbsolute(path) ? path : resolve(REPO_ROOT, path);
}

/**
 * The path, when it is inside one of `roots`, through no link and no hidden folder or file;
 * otherwise why not. The pipeline's messages can quote what it read, and they go to the agent, so:
 *
 * - **Outside is decided from the path alone,** before the file system is asked anything, so the
 *   answer for a path outside is the same whether or not it exists.
 * - **No link is followed.** Each part of the path below its root is read with `lstat`, and one
 *   that is a link is refused, rather than resolved: a link inside can point anywhere. A file with
 *   more than one name, a hard link, is refused too.
 * - **No hidden part**, such as `.git`, `.env` or `.claude`, which a repository keeps out of
 *   version control.
 */
export function within(
  path: string,
  roots: readonly string[],
): string | { readonly problem: string } {
  const absolute = inRepository(path);
  for (const root of roots.map((candidate) => resolve(candidate))) {
    const from = relative(root, absolute);
    if (from.startsWith('..') || isAbsolute(from)) continue;
    const parts = from === '' ? [] : from.split(sep);
    if (parts.some((part) => part.startsWith('.')))
      return { problem: `${path} is a hidden folder or file, or is in one, and is not read.` };
    let current = root;
    for (const part of parts) {
      current = join(current, part);
      let entry;
      try {
        entry = lstatSync(current);
      } catch {
        return { problem: `${path} does not exist.` };
      }
      if (entry.isSymbolicLink() || (entry.isFile() && entry.nlink > 1))
        return { problem: `${path} goes through a link, which is not followed.` };
    }
    return current;
  }
  return { problem: `${path} is outside the repository, and is not read.` };
}

/**
 * The first link inside a folder, or `null`: the validator would follow one wherever it points. A
 * file with more than one name is a hard link, whose other name can be anywhere on the volume, so
 * it counts as one.
 */
export function linkInside(directory: string): string | null {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink() || (entry.isFile() && lstatSync(path).nlink > 1)) return path;
    if (entry.isDirectory()) {
      const found = linkInside(path);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Only what finds programs and a temporary directory: no credential reaches the pipeline. Given
 * `temporary`, that is the temporary directory, on every system's name for it, so what the
 * pipeline unpacks goes there and nowhere else.
 */
export function pipelineEnvironment(env: NodeJS.ProcessEnv, temporary?: string): NodeJS.ProcessEnv {
  const passed = Object.fromEntries(
    PASSED_ENVIRONMENT.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]),
  );
  return temporary === undefined
    ? passed
    : { ...passed, TMPDIR: temporary, TEMP: temporary, TMP: temporary };
}

export function platformVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(REPO_ROOT, 'libs', 'platform', 'package.json'), 'utf8'),
  );
  const version =
    manifest && typeof manifest === 'object' && 'version' in manifest ? manifest.version : null;
  if (typeof version !== 'string') throw new Error('libs/platform/package.json has no version');
  return version;
}

export async function validatePackage(
  request: PackageRequest,
  options: PackageOptions = {},
): Promise<PackageCheck> {
  const roots = options.roots ?? [REPO_ROOT];
  const resolved = (path: string, what: string): string => {
    const found = within(path, roots);
    if (typeof found !== 'string') throw new Error(`${what}: ${found.problem}`);
    return found;
  };
  const directory = resolved(request.directory, 'directory');
  if (!statSync(directory).isDirectory())
    throw new Error(`directory: ${request.directory} is not a folder.`);
  const link = linkInside(directory);
  if (link)
    throw new Error(
      `directory: ${request.directory} holds a link, ${relative(directory, link)}, which is not` +
        ' followed. A package holds its files.',
    );
  const file = (path: string | undefined, what: string): string | undefined => {
    if (path === undefined) return undefined;
    const found = resolved(path, what);
    if (!found.endsWith('.json') || !statSync(found).isFile())
      throw new Error(`${what}: ${path} is not a JSON file.`);
    return found;
  };
  // As CI gives it (`app-packages.yml`): the build allow-list a package names beside its bundle,
  // `deployment/build-allow-list.json`, unless the request gives another. Inside the package, which
  // holds no link (above).
  const builds = join(directory, ...BUILD_ALLOW_LIST);
  const asBuilt =
    request.allowList === undefined && lstatSync(builds, { throwIfNoEntry: false })?.isFile()
      ? builds
      : undefined;
  const allowList = file(request.allowList, 'allowList') ?? asBuilt;
  const registered = file(request.registered, 'registered');
  // An empty version would reach the pipeline as no version, and its range would go unchecked.
  if (
    request.platform !== undefined &&
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]*)?$/.test(request.platform)
  )
    throw new Error(`platform: "${request.platform}" is not a version, such as 1.0.0.`);
  const platform = request.platform ?? platformVersion();
  const departsFromCi = [
    ...(allowList && !asBuilt ? ['allowList'] : []),
    ...(registered ? ['registered'] : []),
    ...(request.platform !== undefined && request.platform !== platformVersion()
      ? ['platform']
      : []),
  ];
  // The zip goes to `out`, and what the pipeline unpacks to read it back to `temporary`: both in a
  // folder of this run's own, removed whatever happens.
  const work = mkdtempSync(join(options.workIn ?? tmpdir(), 'builder-mcp-package-'));
  const out = join(work, 'out');
  const temporary = join(work, 'tmp');
  const args = [
    PIPELINE,
    directory,
    '--out',
    out,
    '--platform',
    platform,
    ...(allowList ? ['--allow-list', allowList] : []),
    ...(registered ? ['--registered', registered] : []),
  ];
  try {
    mkdirSync(temporary);
    const run = await runNode(
      args,
      options.timeoutMs ?? RUN_TIMEOUT_MS,
      pipelineEnvironment(process.env, temporary),
    );
    return interpret(directory, run, platform, departsFromCi, asBuilt !== undefined);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export interface Run {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly failure: string | null;
}

/**
 * The process groups of the pipelines running now. A group of its own is what lets a timeout stop
 * the pipeline whole, and is also what keeps a signal sent to the server's group, such as a
 * terminal's Ctrl-C, from reaching it; so when the server exits, or is stopped by a signal it can
 * catch, it stops them first. A server killed outright (`SIGKILL`) cannot, and a pipeline it had
 * started runs on to its end.
 */
const RUNNING = new Set<number>();
let stopsWithServer = false;

function stopRunning(): void {
  for (const pid of RUNNING) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  RUNNING.clear();
}

function stopWithServer(): void {
  if (stopsWithServer) return;
  stopsWithServer = true;
  process.on('exit', stopRunning);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.once(signal, () => {
      stopRunning();
      // Then as the signal would have, had nothing caught it.
      process.kill(process.pid, signal);
    });
}

/**
 * Runs Node with `args`, as the pipeline runs: its own environment, `pipelineEnvironment`'s unless
 * given another, from the repository's root, stopped whole.
 */
export function runNode(
  args: readonly string[],
  timeoutMs: number,
  env: NodeJS.ProcessEnv = pipelineEnvironment(process.env),
): Promise<Run> {
  return new Promise((done) => {
    // The Node running this server, as the pipeline expects: no shell, no npm. On POSIX it leads a
    // process group of its own, so that stopping it stops what it started: the validator, the
    // builder and `unzip`.
    const group = process.platform !== 'win32';
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: group,
    });
    if (group && child.pid !== undefined) {
      stopWithServer();
      RUNNING.add(child.pid);
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let failure: string | null = null;
    const stop = (why: string) => {
      failure ??= why;
      try {
        if (group && child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(
      () => stop(`the pipeline took more than ${timeoutMs / 1000}s, and was stopped`),
      timeoutMs,
    );
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > OUTPUT_LIMIT)
        stop(`the pipeline printed more than ${OUTPUT_LIMIT} bytes, and was stopped`);
      else into.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.on('error', (error) => {
      failure ??= `the pipeline could not be run: ${error.message}`;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (child.pid !== undefined) RUNNING.delete(child.pid);
      if (signal && failure === null) failure = `the pipeline was stopped by ${signal}`;
      done({
        exitCode: code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        failure,
      });
    });
  });
}

const FINDING = /^(.*?\.json): (.*?): (.*) \[([\w-]+)\]$/;
const REFUSED = /^.*: step (\d+) refused it: (.*)$/;
const BUILT = /^\S+ \S+: checked, built and verified: (.*), sha256 ([0-9a-f]{64})$/;

function interpret(
  directory: string,
  run: Run,
  platform: string,
  departsFromCi: readonly string[],
  asBuilt = false,
): PackageCheck {
  const stdout = lines(run.stdout);
  const stderr = lines(run.stderr);
  const near = (path: string) => {
    const from = relative(directory, path);
    return from.startsWith('..') || isAbsolute(from) ? path : from.split(sep).join('/');
  };
  const findings: Finding[] = [];
  let zip: PackageCheck['zip'] = null;
  for (const line of stdout) {
    const finding = FINDING.exec(line);
    if (finding)
      findings.push({
        file: near(finding[1]),
        place: finding[2],
        message: finding[3],
        kind: finding[4],
      });
    const built = BUILT.exec(line);
    if (built) zip = { name: built[1].split(/[\\/]/).pop() ?? built[1], sha256: built[2] };
  }
  let refusedAt: PackageCheck['refusedAt'] = null;
  for (const line of stderr) {
    const refused = REFUSED.exec(line);
    if (refused && refusedAt === null) refusedAt = { step: Number(refused[1]), reason: refused[2] };
  }
  const passed = run.failure === null && run.exitCode === 0;
  return {
    package: shownFromRepository(directory),
    passed,
    asCi: departsFromCi.length === 0,
    departsFromCi,
    exitCode: run.exitCode,
    refusedAt,
    findings,
    zip,
    command:
      `node scripts/app-package.mjs <package> --out <temporary> --platform ${platform}` +
      (departsFromCi.includes('allowList')
        ? ' --allow-list <file>'
        : asBuilt
          ? ' --allow-list <package>/deployment/build-allow-list.json'
          : '') +
      (departsFromCi.includes('registered') ? ' --registered <file>' : ''),
    stdout,
    stderr: run.failure ? [...stderr, run.failure] : stderr,
    note: passed
      ? 'Steps 1 to 6 passed' +
        (departsFromCi.length
          ? `, with the deployment's ${departsFromCi.join(', ')}, which CI does not pass`
          : ', as CI runs them') +
        '. The zip was built in a temporary folder and removed; nothing was published. Signing' +
        ' and publishing run only in CI, for a tag.'
      : run.exitCode === 2
        ? 'The pipeline was called wrongly (exit 2); stderr says how.'
        : 'Refused: fix what the findings and the refusing step name, and validate again.',
  };
}

function shownFromRepository(path: string): string {
  const from = relative(REPO_ROOT, path);
  return from === '' || from.startsWith('..') || isAbsolute(from)
    ? path
    : from.split(sep).join('/');
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line !== '');
}
