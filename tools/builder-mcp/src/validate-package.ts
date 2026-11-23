/**
 * `validate_package`: the package pipeline's checks on a package folder, as CI runs them.
 *
 * It runs `scripts/app-package.mjs` as a command, the way `npm run app-package` and the
 * `app-packages.yml` workflow do, rather than calling the validator's functions: so the answer is
 * the pipeline's own, steps 1 to 6 of docs/business-apps/package-pipeline.md, and cannot drift
 * from what CI refuses. The workflow's flag is passed the same way: `--platform` is the version of
 * `libs/platform` unless another is given.
 *
 * - **Nothing in the package is written.** The zip and its checksum go to a temporary directory,
 *   which is removed afterwards; the package's own `dist/` is not touched.
 * - **No package code runs** that this repository did not review: step 1 refuses a `build.mjs`
 *   that is not the generator's byte for byte, before step 4 runs it.
 * - **No network.** The pipeline needs Node and the system's `unzip`, and no credential.
 *
 * The run's output is returned whole, and parsed where its form is known: each validator finding,
 * the step that refused the package, and the zip's digest when it was built.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const PIPELINE = join(REPO_ROOT, 'scripts', 'app-package.mjs');
export const RUN_TIMEOUT_MS = 180_000;
const OUTPUT_LIMIT = 16 * 1024 * 1024;

export interface PackageRequest {
  /** The package folder, holding `build.mjs`, `bundle/` and `package/`. Relative to the repository. */
  readonly directory: string;
  readonly allowList?: string;
  readonly registered?: string;
  readonly platform?: string;
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

export function platformVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(REPO_ROOT, 'libs', 'platform', 'package.json'), 'utf8'),
  );
  const version =
    manifest && typeof manifest === 'object' && 'version' in manifest ? manifest.version : null;
  if (typeof version !== 'string') throw new Error('libs/platform/package.json has no version');
  return version;
}

export async function validatePackage(request: PackageRequest): Promise<PackageCheck> {
  const directory = inRepository(request.directory);
  if (!existsSync(directory) || !statSync(directory).isDirectory())
    throw new Error(`${request.directory} is not a folder (read as ${directory}).`);
  for (const [flag, file] of [
    ['allowList', request.allowList],
    ['registered', request.registered],
  ] as const)
    if (file !== undefined && !existsSync(inRepository(file)))
      throw new Error(`${flag}: ${file} does not exist (read as ${inRepository(file)}).`);
  const platform = request.platform ?? platformVersion();
  const out = mkdtempSync(join(tmpdir(), 'builder-mcp-package-'));
  const args = [
    PIPELINE,
    directory,
    '--out',
    out,
    '--platform',
    platform,
    ...(request.allowList ? ['--allow-list', inRepository(request.allowList)] : []),
    ...(request.registered ? ['--registered', inRepository(request.registered)] : []),
  ];
  try {
    const run = await runNode(args);
    return interpret(directory, run, platform);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

interface Run {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly failure: string | null;
}

function runNode(args: readonly string[]): Promise<Run> {
  return new Promise((done) => {
    // The Node running this server, as the pipeline expects: no shell, no npm.
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: RUN_TIMEOUT_MS,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let failure: string | null = null;
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > OUTPUT_LIMIT) {
        failure ??= `the pipeline printed more than ${OUTPUT_LIMIT} bytes, and was stopped`;
        child.kill();
      } else into.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.on('error', (error) => {
      failure ??= `the pipeline could not be run: ${error.message}`;
    });
    child.on('close', (code, signal) => {
      if (signal && failure === null)
        failure = `the pipeline was stopped by ${signal}, after at most ${RUN_TIMEOUT_MS / 1000}s`;
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

function interpret(directory: string, run: Run, platform: string): PackageCheck {
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
    exitCode: run.exitCode,
    refusedAt,
    findings,
    zip,
    command: `node scripts/app-package.mjs <package> --out <temporary> --platform ${platform}`,
    stdout,
    stderr: run.failure ? [...stderr, run.failure] : stderr,
    note: passed
      ? 'Steps 1 to 6 passed. The zip was built in a temporary folder and removed; nothing was' +
        ' published. Signing and publishing run only in CI, for a tag.'
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
