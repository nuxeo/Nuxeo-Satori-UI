/**
 * Many Studio packages in one run, for a customer with several projects: `migrate <package.zip or
 * folder>... --out <new-directory> [--allow-list <file>] [--from <earlier run of them>]`. Phase
 * 10's migration M4 (docs/business-apps/studio-migration.md, section 10), and section 8 of
 * docs/business-apps/studio-migration-guide.md for the customer.
 *
 * - **Each package runs as one does.** Each is given to `migrateOne`, the very run `migrate` makes
 *   of one package, into a folder of its own, `<out>/packages/<name>`, with the same allow-list.
 *   What that run prints is kept in `<out>/printed/<name>.txt`, beside its folder rather than in it,
 *   so that the folder holds exactly what a run of that package on its own holds.
 * - **Isolated.** Each package's run is given only its own package, its own folder and the
 *   allow-list; a package that cannot be read, is refused at a step, fails a check, or meets a
 *   defect of the tool, ends that package's run alone, and the next one runs as it would have
 *   without it. Nothing one run finds is given to another.
 * - **Asynchronous, between packages.** After each package the event loop turns, so that what its
 *   run parsed is freed before the next: jsdom keeps every document until the job that made it
 *   ends, and a run of one package holds about a hundred and seventy megabytes of the made-up
 *   package's, which a run of many in one job would add up until the heap ran out.
 * - **The summary,** `<out>/summary.txt`, is what the run prints: a line for each package with its
 *   result, the counts of its constructs by outcome, as its report gives them, and the full path of
 *   its report; then how many ended each way, the worst, and what to do next. `<out>/summary.json`
 *   says the same as data, with paths under `<out>`.
 * - **The same package twice,** the same bytes however it is named, runs once: the second is listed
 *   as the same package as the first, and not run again. **Two files of one name,** from two
 *   folders, get two folders, the second numbered (`claims`, `claims-2`), told apart as a file
 *   system that ignores case would. Two packages that declare **the same name and version** from
 *   different bytes are two builds, and both run; the summary says so, as decisions are for one
 *   build.
 * - **A folder** gives the `.zip` files directly in it, in the order of their names; anything else
 *   in it is listed as left out. A folder with no `.zip` file in it is refused.
 * - **`--from` an earlier run of several** carries each package's decisions from that run's folder
 *   for the same build, as `--from` holds one package's decisions to it; a package that
 *   run did not hold, or holds no decisions for, starts its decisions again, and its line says so.
 * - **It never writes over anything,** as for one package: `--out` must be new or empty, and each
 *   file is written only where none is.
 *
 * Exit codes, as one package's are, of the worst: 0 every package ran every step and no check
 * failed in any of them, whatever their verdicts; 1 a package's run stopped, or a check failed in
 * one, or the run of them all was refused before it wrote anything; 2 the command was wrong, which
 * `main` decides.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { CliIo } from './cli';
import { allowListOf, packageBuildOf } from './convert';
import { DECISIONS_FILE } from './decisions';
import {
  CONVERSION_DIRECTORY,
  migrateOne,
  nextOut,
  shell,
  STEP_FILES,
  type Command,
} from './migrate';
import { TALLIES, type MigrationSummary, type Tally } from './report';
import { readStudioPackage } from './studio-package';

export interface BatchRequest {
  /** Each a Studio package, or a folder of them, as given. */
  readonly packages: readonly string[];
  /** A new or empty directory, for everything the run writes. */
  readonly out: string;
  /** The deployment's operations, `{ "operations": [...] }`, for every package. */
  readonly allowList?: string;
  /** An earlier run of several packages: its `--out`. */
  readonly from?: string;
}

/** The folder of `--out` each package's run is written into, and the one what it printed is kept in. */
export const PACKAGES_DIRECTORY = 'packages';
export const PRINTED_DIRECTORY = 'printed';
export const SUMMARY_FILES = { text: 'summary.txt', data: 'summary.json' } as const;
/** What `summary.json` says it is, which `--from` holds an earlier run to. */
export const SUMMARY_FORMAT = 'studio-migration-batch/1';

/**
 * How a package's run ended, best first: the worst of them is the run's. `the same package` is a
 * package given again, which is not run, and counts for nothing.
 */
export const RESULTS = ['ready', 'not ready', 'check failed', 'stopped'] as const;
export type Result = (typeof RESULTS)[number];
export type Outcome = Result | 'the same package';

/** Each result in plain words, as the summary prints it. */
export const RESULT_WORDS: Readonly<Record<Outcome, string>> = {
  ready: 'ready',
  'not ready': 'not ready, and no check failed',
  'check failed': 'a check failed',
  stopped: 'stopped',
  'the same package': 'the same package as another, not run again',
};

/** One package of the run, as `summary.json` gives it. */
export interface PackageEntry {
  /** Its place in the run, from 1. */
  readonly number: number;
  /** As given, or its folder's path as given and its name. */
  readonly given: string;
  /** Its bytes' SHA-256, or `null` when it could not be read. */
  readonly sha256: string | null;
  /** What its `package.xml` declares, or `null` when it could not be read as a Studio package. */
  readonly package: { readonly name: string; readonly version: string } | null;
  /**
   * The build its decisions are held to, as `decisions.json` names it: its name, version, Studio
   * commit and build time, and its bundle's SHA-256. `null` when it is not a package it can read.
   */
  readonly build: ReturnType<typeof packageBuildOf> | null;
  readonly result: Outcome;
  /** For `the same package`: the number of the one that ran. */
  readonly sameAs?: number;
  /** What its run exited with, or `null` when it did not run. */
  readonly exitCode: number | null;
  /** Under `<out>`, its run's folder and what it printed; `null` when it did not run. */
  readonly folder: string | null;
  readonly printed: string | null;
  /** Under `<out>`, its report, when its run wrote one. */
  readonly report: string | null;
  /**
   * Where its run stopped: the step's number and title; 0 and `null` before its first step, or
   * where a defect of the tool stopped it outside every step.
   */
  readonly stoppedAt: { readonly step: number; readonly title: string | null } | null;
  /** True when a defect of the tool ended its run, rather than a step that refused. */
  readonly defect?: true;
  /** The numbers of the checks that failed. */
  readonly checksFailed: readonly number[];
  /** What stands in the way of readiness, as its verdict gives it, once its checks ran. */
  readonly blockers: readonly string[];
  /** Its constructs by outcome, as its report counts them, once its report was printed. */
  readonly constructs:
    (Readonly<Record<Tally, number>> & { readonly total: number; readonly decided: number }) | null;
  /**
   * With `--from`: under the earlier run, `/`-separated, the folder whose decisions it was given to
   * carry, or `null` when that run held none for it.
   */
  readonly carriedFrom?: string | null;
}

export interface BatchSummary {
  readonly format: typeof SUMMARY_FORMAT;
  readonly out: string;
  readonly allowList: string | null;
  readonly from: string | null;
  /** The worst result of the packages that ran. */
  readonly worst: Result;
  readonly exitCode: number;
  readonly packages: readonly PackageEntry[];
  /** What a folder given held that is not a `.zip` file. */
  readonly leftOut: readonly { readonly folder: string; readonly entries: readonly string[] }[];
  /** The packages that declare one name and version from different bytes: builds of one version. */
  readonly sameNameAndVersion: readonly {
    readonly package: string;
    readonly numbers: readonly number[];
  }[];
}

/** Whether a path names a directory. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

interface Given {
  readonly given: string;
  readonly path: string;
}

/** A turn of the event loop, which frees what the run before it parsed. */
const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * The run of several packages. `one` is the run of one package, given only so that a test can
 * stand a defect in its place.
 */
export async function migrateMany(
  request: BatchRequest,
  io: CliIo,
  run: Command,
  one: typeof migrateOne = migrateOne,
): Promise<number> {
  const out = resolve(request.out);
  const refused = (problem: string, todo: string): number => {
    io.err(`migrate: ${problem}. Nothing was written.\n\nWhat to do: ${todo}\n`);
    return 1;
  };

  // Before anything is written: where it goes, what it is given, and what it carries.
  if (request.out.trim() === '')
    return refused('--out names no directory', 'give --out a new directory.');
  if (existsSync(out)) {
    if (!statSync(out).isDirectory())
      return refused(`${out} is a file, not a directory`, 'give --out a new directory.');
    if (readdirSync(out).length > 0)
      return refused(
        `${out} already holds files, perhaps an earlier run, and migrate never writes over one`,
        `give --out a new directory, such as ${nextOut(out)}. To carry the decisions you made in ${out}, add --from ${shell(out)}.`,
      );
  }
  const given: Given[] = [];
  const leftOut: { folder: string; entries: string[] }[] = [];
  const folders = new Set<string>();
  for (const argument of request.packages) {
    if (!isDirectory(argument)) {
      given.push({ given: argument, path: resolve(argument) });
      continue;
    }
    // A folder given twice gives its packages twice, each the same package as before, and is
    // listed once.
    const seen = folders.has(resolve(argument));
    folders.add(resolve(argument));
    // A name that starts with a dot is the system's, such as `.DS_Store`, or the `._claims.zip` a
    // Mac leaves beside a file on a drive that cannot hold its attributes: passed over.
    const names = readdirSync(argument)
      .filter((name) => !name.startsWith('.'))
      .sort();
    const packages = names.filter(
      (name) => /\.zip$/i.test(name) && !isDirectory(join(argument, name)),
    );
    if (packages.length === 0)
      return refused(
        `the folder ${argument} holds no .zip file`,
        'give migrate the folder that holds your Studio packages, each a .zip as Studio builds it, or the packages themselves.',
      );
    for (const name of packages)
      given.push({ given: join(argument, name), path: resolve(argument, name) });
    const others = names.filter((name) => !packages.includes(name));
    if (others.length > 0 && !seen) leftOut.push({ folder: argument, entries: others });
  }
  // Each file is read once, and every run is given those bytes: each package, and the allow-list.
  const cache = new Map<string, Buffer>();
  const readFile = (path: string): Buffer => {
    const held = cache.get(path);
    if (held !== undefined) return held;
    const data = io.readFile(path);
    cache.set(path, data);
    return data;
  };

  if (request.allowList !== undefined) {
    try {
      allowListOf(JSON.parse(readFile(request.allowList).toString('utf8')), request.allowList);
    } catch (error) {
      return refused(
        `the allow-list ${request.allowList} is not one it can use: ${(error as Error).message}`,
        'give --allow-list a file of the form { "operations": [ "Operation.Id", ... ] }, naming the operations your deployment allows.',
      );
    }
  }
  let earlier: ReadonlyMap<string, string> | undefined;
  if (request.from !== undefined) {
    try {
      earlier = earlierRuns(request.from);
    } catch (error) {
      return refused(
        `${request.from} is not an earlier run of several packages migrate can read: ${(error as Error).message}`,
        `give --from the --out of an earlier run of several packages, which holds its ${SUMMARY_FILES.data}. To carry the decisions of a run of one package, run that package on its own with --from.`,
      );
    }
  }

  const packagesOut = join(out, PACKAGES_DIRECTORY);
  const printedOut = join(out, PRINTED_DIRECTORY);
  try {
    mkdirSync(packagesOut, { recursive: true });
    mkdirSync(printedOut, { recursive: true });
  } catch (error) {
    return refused(
      `${out} cannot be written to: ${(error as Error).message}`,
      'give --out a new directory in a folder you can write to.',
    );
  }
  const taken = new Set<string>();
  const bySha = new Map<string, number>();
  const entries: PackageEntry[] = [];
  const text: string[] = [];
  const say = (line: string): void => {
    text.push(line);
    io.out(`${line}\n`);
  };
  say(
    `Migrating ${plural(given.length, 'package')} into ${out}, each into a folder of its own in ${packagesOut}`,
  );
  say('');

  for (const [index, { given: as, path }] of given.entries()) {
    const number = index + 1;
    let data: Buffer | undefined;
    try {
      data = readFile(as);
    } catch {
      // Its own run says it cannot be read, as for one package, and the others run.
    }
    const sha256 = data === undefined ? null : createHash('sha256').update(data).digest('hex');
    const build = data === undefined ? null : buildOf(data);
    const declared = build === null ? null : { name: build.name, version: build.version };
    const first = sha256 === null ? undefined : bySha.get(sha256);
    if (first !== undefined) {
      entries.push({
        number,
        given: as,
        sha256,
        package: declared,
        build,
        result: 'the same package',
        sameAs: first,
        exitCode: null,
        folder: null,
        printed: null,
        report: null,
        stoppedAt: null,
        checksFailed: [],
        blockers: [],
        constructs: null,
      });
      say(`${number}. ${as}: the same package as ${first}, byte for byte, so it was not run again`);
      continue;
    }
    if (sha256 !== null) bySha.set(sha256, number);

    const name = folderName(path, taken);
    const folder = join(packagesOut, name);
    const printed = join(printedOut, `${name}.txt`);
    const carried =
      earlier === undefined || build === null ? undefined : earlier.get(buildKey(build));
    const from =
      carried !== undefined && request.from !== undefined
        ? join(request.from, PACKAGES_DIRECTORY, carried)
        : undefined;

    let kept = '';
    const own: CliIo = {
      out: (line) => (kept += line),
      err: (line) => (kept += line),
      readFile,
    };
    let ended: ReturnType<typeof migrateOne>;
    let defect = false;
    try {
      ended = one(
        {
          package: as,
          out: folder,
          ...(request.allowList !== undefined ? { allowList: request.allowList } : {}),
          ...(from !== undefined ? { from } : {}),
        },
        own,
        run,
      );
    } catch (error) {
      // Something no run refuses on purpose: a defect, which ends this package's run alone.
      kept += `${(error as Error).stack ?? String(error)}\nThis is a defect in this tool, not a mistake in your package: send this message to your Nuxeo contact.\n`;
      ended = { code: 1, stopped: { number: 0, title: null } };
      defect = true;
    }
    // Its bytes are its run's alone: the next package's run does not need them.
    cache.delete(as);
    let printedAt: string | null = printed;
    try {
      writeFileSync(printed, kept, { flag: 'wx' });
    } catch {
      printedAt = null;
    }

    const failed = (ended.harness?.checks ?? [])
      .filter((check) => check.status === 'fail')
      .map((check) => check.number);
    const result: Result =
      ended.stopped !== undefined
        ? 'stopped'
        : failed.length > 0
          ? 'check failed'
          : ended.harness?.ready
            ? 'ready'
            : 'not ready';
    const reportFile = join(folder, STEP_FILES.report);
    const entry: PackageEntry = {
      number,
      given: as,
      sha256,
      package: declared,
      build,
      result,
      exitCode: ended.code,
      folder: existsSync(folder) ? under(out, folder) : null,
      printed: printedAt === null ? null : under(out, printedAt),
      report: existsSync(reportFile) ? under(out, reportFile) : null,
      stoppedAt:
        ended.stopped === undefined
          ? null
          : { step: ended.stopped.number, title: ended.stopped.title },
      ...(defect ? { defect: true as const } : {}),
      checksFailed: failed,
      blockers: ended.harness?.blockers ?? [],
      constructs: ended.summary ? constructsOf(ended.summary) : null,
      ...(request.from !== undefined
        ? { carriedFrom: from === undefined ? null : `${PACKAGES_DIRECTORY}/${carried as string}` }
        : {}),
    };
    entries.push(entry);
    for (const line of packageLines(entry, out, request.from, data !== undefined)) say(line);
    // What its run parsed is freed before the next package's runs.
    await turn();
  }

  const ran = entries.filter(
    (entry): entry is PackageEntry & { result: Result } => entry.result !== 'the same package',
  );
  const worst = ran.reduce<Result>(
    (bad, entry) => (RESULTS.indexOf(entry.result) > RESULTS.indexOf(bad) ? entry.result : bad),
    'ready',
  );
  const exitCode = ran.some((entry) => entry.exitCode !== 0) ? 1 : 0;
  const builds = sameNameAndVersion(entries);
  const summary: BatchSummary = {
    format: SUMMARY_FORMAT,
    out,
    allowList: request.allowList ?? null,
    from: request.from === undefined ? null : resolve(request.from),
    worst,
    exitCode,
    packages: entries,
    leftOut,
    sameNameAndVersion: builds,
  };
  for (const line of closingLines(summary, request)) say(line);

  // Written last, each only where no file is: the summary is of the run as it ended.
  const lines = `${text.join('\n')}\n`;
  try {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, SUMMARY_FILES.data), `${JSON.stringify(summary, null, 2)}\n`, {
      flag: 'wx',
    });
    writeFileSync(join(out, SUMMARY_FILES.text), lines, { flag: 'wx' });
  } catch (error) {
    io.err(
      `\nmigrate: the summary cannot be written: ${(error as Error).message}. Each package's run is in ${packagesOut}, and what each printed in ${printedOut}.\n`,
    );
    return 1;
  }
  return exitCode;
}

/** The build of a package, as its decisions are held to it, or `null` when it cannot be read. */
function buildOf(data: Buffer): ReturnType<typeof packageBuildOf> | null {
  try {
    return packageBuildOf(readStudioPackage(data));
  } catch {
    return null;
  }
}

/** A build as one text, for matching an earlier run's. */
function buildKey(build: ReturnType<typeof packageBuildOf>): string {
  return JSON.stringify([build.name, build.version, build.commit, build.buildTime, build.bundle]);
}

/**
 * A folder name for a package, one every system can hold: its file's name less `.zip`, each
 * character but a letter, a digit, `.`, `_` and `-` written `-`, less the dots Windows drops from
 * the end of a name, a name Windows keeps for a device, such as `CON`, written after `_`, and
 * numbered when another package of the run has it, told apart as a file system that ignores case
 * would.
 */
export function folderName(path: string, taken: Set<string>): string {
  const stem = basename(path)
    .replace(/\.zip$/i, '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/\.+$/, '');
  const base =
    stem === ''
      ? 'package'
      : /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(stem)
        ? `_${stem}`
        : stem;
  let name = base;
  for (let number = 2; taken.has(name.toLowerCase()); number++) name = `${base}-${number}`;
  taken.add(name.toLowerCase());
  return name;
}

/**
 * The earlier run's folder of each package by its build, as `decisions.json` names it, for those
 * whose run holds decisions to carry: the same bytes are the same build, and a package zipped again
 * is too, as a run of one package carries it. Throws when `from` holds no summary of a run of
 * several.
 */
function earlierRuns(from: string): ReadonlyMap<string, string> {
  const file = join(from, SUMMARY_FILES.data);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<BatchSummary> | null;
  if (raw === null || typeof raw !== 'object' || raw.format !== SUMMARY_FORMAT)
    throw new Error(`${file} is not a ${SUMMARY_FORMAT} summary`);
  if (!Array.isArray(raw.packages)) throw new Error(`${file} lists no packages`);
  const byBuild = new Map<string, string>();
  for (const entry of raw.packages) {
    const folder =
      typeof entry?.folder === 'string' && entry.folder.startsWith(`${PACKAGES_DIRECTORY}/`)
        ? entry.folder.slice(PACKAGES_DIRECTORY.length + 1)
        : undefined;
    // A name of the run's own making, never a path that leaves it.
    const build = entry?.build;
    if (
      folder === undefined ||
      !/^(?!\.{1,2}$)[A-Za-z0-9._-]+$/.test(folder) ||
      build === null ||
      typeof build !== 'object'
    )
      continue;
    if (!existsSync(join(from, PACKAGES_DIRECTORY, folder, CONVERSION_DIRECTORY, DECISIONS_FILE)))
      continue;
    if (!byBuild.has(buildKey(build))) byBuild.set(buildKey(build), folder);
  }
  return byBuild;
}

/** A path under `<out>`, `/`-separated, as `summary.json` gives it. */
function under(out: string, path: string): string {
  return path
    .slice(out.length + 1)
    .split(/[\\/]/)
    .join('/');
}

function constructsOf(summary: MigrationSummary): NonNullable<PackageEntry['constructs']> {
  return { total: summary.all.total, ...summary.all.tallies, decided: summary.all.decided };
}

/** What the summary says of one package that ran. */
function packageLines(
  entry: PackageEntry,
  out: string,
  from: string | undefined,
  read: boolean,
): string[] {
  const at = (path: string | null): string => (path === null ? '' : join(out, path));
  const head = `${entry.number}. ${entry.given}: `;
  const lines: string[] = [];
  if (entry.result === 'stopped') {
    const where = entry.stoppedAt;
    lines.push(
      `${head}stopped ${entry.defect ? 'by a defect of the tool' : where === null || where.step === 0 ? 'before its first step' : `at step ${where.step}, ${(where.title ?? '').toLowerCase()}`}`,
    );
  } else if (entry.result === 'check failed')
    lines.push(
      `${head}${entry.checksFailed.length === 1 ? 'check' : 'checks'} ${entry.checksFailed.join(', ')} failed`,
    );
  else lines.push(`${head}${RESULT_WORDS[entry.result]}`);
  lines.push(
    `     ${entry.package ? `${entry.package.name} ${entry.package.version}` : read ? 'Not a Studio package it can read' : 'It cannot be read'}, ${entry.folder === null ? 'and nothing was written for it' : `in ${at(entry.folder)}`}`,
  );
  if (from !== undefined) {
    const earlier = entry.carriedFrom ? join(from, ...entry.carriedFrom.split('/')) : null;
    lines.push(
      earlier === null
        ? `     Nothing carried: ${from} holds no decisions for this package as it is now, so they start again`
        : entry.stoppedAt?.title === 'The decisions, carried'
          ? `     The decisions of ${earlier} could not be carried: what it printed says why`
          : `     Carried what still holds of the decisions of ${earlier}`,
    );
  }
  if (entry.constructs) {
    const counts = entry.constructs;
    const shown = TALLIES.filter((tally) => tally === 'missing' || counts[tally] > 0).map(
      (tally) =>
        tally === 'reported'
          ? `reported ${counts.reported} (${counts.decided} decided)`
          : `${tally} ${counts[tally]}`,
    );
    lines.push(`     ${counts.total} constructs: ${shown.join(', ')}`);
  }
  if (entry.report !== null) lines.push(`     The report: ${at(entry.report)}`);
  if (entry.result === 'stopped' && entry.checksFailed.length > 0)
    lines.push(`     Before it stopped, these checks failed: ${entry.checksFailed.join(', ')}`);
  if (entry.checksFailed.length > 0 && entry.folder !== null)
    lines.push(`     What the checks found: ${join(at(entry.folder), STEP_FILES.checks)}`);
  lines.push(
    entry.printed === null
      ? '     What it printed could not be kept'
      : `     What it printed${entry.result === 'stopped' ? ', with why it stopped and what to do' : ''}: ${at(entry.printed)}`,
  );
  return lines;
}

/** The packages that declare one name and version from different bytes, each group once. */
function sameNameAndVersion(entries: readonly PackageEntry[]): BatchSummary['sameNameAndVersion'] {
  const groups = new Map<string, number[]>();
  for (const entry of entries) {
    if (entry.result === 'the same package' || entry.package === null) continue;
    const key = `${entry.package.name} ${entry.package.version}`;
    groups.set(key, [...(groups.get(key) ?? []), entry.number]);
  }
  return [...groups]
    .filter(([, numbers]) => numbers.length > 1)
    .map(([key, numbers]) => ({ package: key, numbers }));
}

/** The summary's end: how many ended each way, the worst, and what to do next. */
function closingLines(summary: BatchSummary, request: BatchRequest): string[] {
  const { packages } = summary;
  const ran = packages.filter((entry) => entry.result !== 'the same package');
  const again = packages.length - ran.length;
  const lines = [
    '',
    `Summary: ${plural(packages.length, 'package')} given, ${ran.length} run${again > 0 ? `, and ${again} the same as another` : ''}`,
  ];
  const width = Math.max(...RESULTS.map((result) => RESULT_WORDS[result].length));
  for (const result of RESULTS)
    lines.push(
      `  ${RESULT_WORDS[result].padEnd(width)}  ${ran.filter((entry) => entry.result === result).length}`,
    );
  lines.push(`The worst: ${RESULT_WORDS[summary.worst]}. Exit code ${summary.exitCode}.`);
  for (const { package: pkg, numbers } of summary.sameNameAndVersion)
    lines.push(
      '',
      `Two builds of one version: ${listed(numbers)} each declare ${pkg}, from different bytes. Decisions are for one build, so each has its own.`,
    );
  for (const { folder, entries } of summary.leftOut)
    lines.push('', `Left out of ${folder}, as no .zip file: ${entries.join(', ')}`);

  const todo: string[] = [];
  /** `Package 4`, or `Packages 2 and 4`, of those that ended so. */
  const named = (result: Result): { readonly words: string; readonly one: boolean } => {
    const numbers = ran.filter((entry) => entry.result === result).map((entry) => entry.number);
    return {
      words: `${numbers.length === 1 ? 'Package' : 'Packages'} ${listed(numbers)}`,
      one: numbers.length === 1,
    };
  };
  if (ran.some((entry) => entry.result === 'stopped')) {
    const { words, one } = named('stopped');
    todo.push(
      `${words} stopped: read what ${one ? 'it' : 'each'} printed, which says why, and what to do. Once it is fixed, run it again into a new folder, on its own or with the others.`,
    );
  }
  if (ran.some((entry) => entry.result === 'check failed')) {
    const { words, one } = named('check failed');
    todo.push(
      `${words} failed a check: read what the checks found, in ${one ? 'its' : 'each'} check.txt. A finding about a package's own content, such as a colour below WCAG 2.1 AA contrast, is changed in Studio; send any other to your Nuxeo contact, with that package's folder and what it printed.`,
    );
  }
  const undecided = ran.some(
    (entry) => entry.constructs !== null && entry.constructs.reported > entry.constructs.decided,
  );
  if (ran.some((entry) => entry.report !== null) && !undecided)
    todo.push(
      "Read each package's report. Every reported item of every package that reached its report has an owner and a decision: none is left to fill in.",
    );
  if (undecided) {
    todo.push(
      "Read each package's report, and fill in its decisions, in its folder's conversion/decisions.json, as for one package.",
      `To see the decisions counted, run them all again into a new directory, carrying them: ${[
        'npm run studio-migration -- migrate',
        ...request.packages.map(shell),
        '--out',
        shell(nextOut(summary.out)),
        ...(request.allowList === undefined ? [] : ['--allow-list', shell(request.allowList)]),
        '--from',
        shell(summary.out),
      ].join(' ')}`,
    );
  }
  todo.push(
    'docs/business-apps/studio-migration-guide.md, section 8, says what this summary means, and section 4 what each line of a verdict means.',
  );
  lines.push('', 'What to do next:', ...todo.map((item, index) => `  ${index + 1}. ${item}`));
  return lines;
}

/** `4`, `2 and 4`, `1, 2 and 4`. */
function listed(numbers: readonly number[]): string {
  return numbers.length === 1
    ? String(numbers[0])
    : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
