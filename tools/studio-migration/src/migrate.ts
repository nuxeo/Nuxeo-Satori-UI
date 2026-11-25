/**
 * The guided migration of one Studio package, for a customer who runs it on their own package:
 * `migrate <package.zip> --out <new-directory> [--allow-list <file>] [--from <earlier run>]`.
 * docs/business-apps/studio-migration-guide.md is written for them.
 *
 * It runs the tool's own commands, as a person would type them, and keeps what each prints in a
 * file of `--out`:
 *
 * 1. **the inventory,** `inventory <package>`, in `inventory.txt`;
 * 2. **the conversion,** `convert <package> <out>/conversion`, in `conversion/`, and what it prints
 *    in `conversion.txt`;
 * 3. **the checks that need no server,** `check <package> <out>/conversion`, in `check.txt`;
 * 4. **the report,** `report <package> <out>/conversion`, in `report.txt`;
 * 5. **the decisions,** `decisions <package> <out>/conversion`: the scaffold `decisions.json` in
 *    `conversion/`, an entry for each reported item for a person to name its owner and what they
 *    decided, and what it prints in `decisions.txt`.
 *
 * Each step is `main` itself, given those arguments, so each file holds what the command prints by
 * hand, byte for byte. `--allow-list` goes to `convert`, `check` and `report`, as by hand.
 *
 * **A run that carries decisions.** With `--from`, an earlier run (its `--out`), a conversion
 * directory or a `decisions.json`, the decisions step carries each decision that still holds
 * (`decisions --from`), and runs third, before the checks, so that the checks and the report count
 * them: inventory, conversion, decisions, checks, report. A first run has none to count, and a
 * scaffold of blank entries changes nothing they print, so it keeps the decisions for last.
 *
 * - **It stops at the first step that refuses,** prints why and what to do in plain words, and runs
 *   nothing after it. A check that fails is not a refusal: the harness ran and found something,
 *   which the report shows, so the run carries on, and exits 1 at its end.
 * - **It never writes over anything.** Before it writes, `--out` must be new or an empty
 *   directory, and the files `--allow-list` and `--from` name must be readable. Each file it writes
 *   is written only where none is (`wx`), `convert` writes only into a new directory, and
 *   `decisions` never over a `decisions.json`. An earlier run, its decisions among them, is read
 *   and never changed.
 * - **It only reads the package,** and reads it once: every step is given the same bytes, so a file
 *   replaced during the run cannot give two steps two packages.
 * - **It says which checks still need a server,** the migration lab server, with the Studio
 *   package installed and Web UI beside the new app, and why: the halves of checks 3, 5, 6 and 7
 *   that compare the new app with Web UI as it runs the package. It reads that from the `check`
 *   step's own result, through `CliIo.checked`, rather than from its text.
 *
 * Exit codes: 0 every step ran and no check failed; 1 a step refused, or a check failed; 2 the
 * command was wrong, which `main` decides.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CliIo } from './cli';
import { DECISIONS_FILE } from './decisions';
import type { CheckResult, HarnessResult } from './harness';

/** A command of the tool, as `main` runs it: `migrate` is given `main` itself. */
export type Command = (argv: readonly string[], io: CliIo) => number;

export interface MigrateRequest {
  /** The Studio package, as Studio builds it. */
  readonly package: string;
  /** A new or empty directory, for everything the run writes. */
  readonly out: string;
  /** The deployment's operations, `{ "operations": [...] }`, for `convert`, `check` and `report`. */
  readonly allowList?: string;
  /** An earlier run, its `--out`, a conversion directory or a `decisions.json`. */
  readonly from?: string;
}

/** The directory of `--out` the conversion is written to. */
export const CONVERSION_DIRECTORY = 'conversion';

/** Where each step keeps what it prints, in `--out`. */
export const STEP_FILES = {
  inventory: 'inventory.txt',
  conversion: 'conversion.txt',
  checks: 'check.txt',
  report: 'report.txt',
  decisions: 'decisions.txt',
} as const;

type StepName = keyof typeof STEP_FILES;

interface Step {
  readonly name: StepName;
  readonly title: string;
  readonly argv: readonly string[];
  /** What to do when it refuses, in plain words. */
  readonly whenRefused: string;
}

/** What a step printed, and how it ended. */
interface Ran {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  /** The harness's result, when the step is `check` and the harness ran. */
  readonly harness?: HarnessResult;
}

/**
 * What the half of a check that needs the lab server adds, in plain words, by check number
 * (docs/business-apps/studio-migration.md, section 6).
 */
export const SERVER_HALVES: Readonly<Record<number, string>> = {
  3: "reads the server's own definitions of types, schemas, vocabularies and page providers, and confirms that everything the conversion names on the platform's model exists there",
  5: "evaluates each of the package's conditions in Web UI itself, for test users in and out of each group and documents of each type, facet, state and permission, and holds the new app's rule to it",
  6: 'opens the same documents in Web UI and in the new app, as the same user, compares every label and value, and takes screenshots side by side for the reviewer',
  7: 'records the requests both apps send for each button and each list, and compares the operations, page providers, parameters and result counts',
};

/**
 * What to do about a check that did not run whole for another reason than the lab server. Check
 * 10 is never one: migrate gives `check` the allow-list `convert` was given, and without one the
 * conversion makes no action to hold to a list.
 */
const OTHER_GAPS: Readonly<Record<number, string>> = {
  9: 'Nothing to do now: a later version of this tool brings it, with the plugins (phase M3).',
};

export function migrate(request: MigrateRequest, io: CliIo, run: Command): number {
  const { out } = request;
  const conversion = join(out, CONVERSION_DIRECTORY);

  // Each file is read once, and every step is given those bytes: the package among them.
  const cache = new Map<string, Buffer>();
  const readFile = (path: string): Buffer => {
    const held = cache.get(path);
    if (held !== undefined) return held;
    const data = io.readFile(path);
    cache.set(path, data);
    return data;
  };

  // Before anything is written: where it goes, and what it is given beside the package.
  const refused = (problem: string, todo: string): number => {
    io.err(`migrate: ${problem}. Nothing was written.\n\nWhat to do: ${todo}\n`);
    return 1;
  };
  if (out.trim() === '') return refused('--out names no directory', 'give --out a new directory.');
  if (existsSync(out)) {
    if (!statSync(out).isDirectory())
      return refused(`${out} is a file, not a directory`, 'give --out a new directory.');
    if (readdirSync(out).length > 0)
      return refused(
        `${out} already holds files, perhaps an earlier run, and migrate never writes over one`,
        `give --out a new directory, such as ${nextOut(out)}. To carry the decisions you made in ${out}, add --from ${shell(out)}.`,
      );
  }
  if (request.allowList !== undefined) {
    try {
      readFile(request.allowList);
    } catch (error) {
      return refused(
        `the allow-list ${request.allowList} cannot be read: ${(error as Error).message}`,
        'check the path given to --allow-list.',
      );
    }
  }
  const from = request.from === undefined ? undefined : decisionsIn(request.from);
  if (from !== undefined) {
    try {
      readFile(from);
    } catch (error) {
      return refused(
        `${request.from} holds no decisions.json migrate can read: ${(error as Error).message}`,
        'give --from the directory of an earlier run, or its conversion/decisions.json.',
      );
    }
  }

  const allow = request.allowList === undefined ? [] : ['--allow-list', request.allowList];
  const pkg = request.package;
  const defect = `This is a defect in this tool, not a mistake in your package: send this message and ${out} to your Nuxeo contact.`;
  const steps: readonly Step[] = [
    {
      name: 'inventory',
      title: 'The inventory',
      argv: ['inventory', pkg],
      whenRefused:
        'give migrate the package exactly as Studio builds it for your project: the .zip whose package.xml declares a "studio" package, holding the project\'s bundle, a .jar. Do not unzip it or zip it again. If the reason names a limit of the archive, such as its size, send it to your Nuxeo contact.',
    },
    {
      name: 'conversion',
      title: 'The conversion',
      argv: ['convert', pkg, conversion, ...allow],
      whenRefused: `where the reason is about the allow-list, give --allow-list a file of the form { "operations": [ "Operation.Id", ... ] }. Where it names a file, something in your package has a name that cannot be a file name on every system, a limit of this tool rather than a mistake of yours: send ${join(out, STEP_FILES.inventory)} and this message to your Nuxeo contact.`,
    },
    {
      name: 'checks',
      title: 'The checks that need no server',
      argv: ['check', pkg, conversion, ...allow],
      whenRefused: `the conversion migrate had just written could not be read back. ${defect}`,
    },
    {
      name: 'report',
      title: 'The report',
      argv: ['report', pkg, conversion, ...allow],
      whenRefused: `the conversion migrate had just written could not be read back. ${defect}`,
    },
    {
      name: 'decisions',
      title: from === undefined ? 'The decisions to fill in' : 'The decisions, carried',
      argv: ['decisions', pkg, conversion, ...(from === undefined ? [] : ['--from', from])],
      whenRefused:
        from === undefined
          ? `the decisions file could not be written. ${defect}`
          : `the decisions in ${from} cannot be carried to this package, for the reason above: they are for another build of it, or the file is not one migrate wrote. Give --from an earlier run of this same build, or leave --from out and fill in the decisions again.`,
    },
  ];
  const order: readonly StepName[] =
    from === undefined
      ? ['inventory', 'conversion', 'checks', 'report', 'decisions']
      : ['inventory', 'conversion', 'decisions', 'checks', 'report'];

  io.out(`Migrating ${pkg} into ${out}\n\n`);
  let harness: HarnessResult | undefined;
  for (const [index, name] of order.entries()) {
    const step = steps.find((candidate) => candidate.name === name) as Step;
    const number = index + 1;
    const ran = runStep(step, run, readFile);
    // `check` exits 1 when a check fails, and that is a finding: it refused only if the harness
    // never ran.
    const stopped = step.name === 'checks' ? ran.harness === undefined : ran.code !== 0;
    const file = join(out, STEP_FILES[step.name]);
    let kept: string | undefined;
    if (!stopped) {
      try {
        mkdirSync(out, { recursive: true });
        // `wx`: written only where no file is.
        writeFileSync(file, ran.out, { flag: 'wx' });
      } catch (error) {
        kept = (error as Error).message;
      }
    }
    if (stopped || kept !== undefined) {
      io.out(`${number}. ${step.title}: refused\n`);
      const reason = kept !== undefined ? `${file} cannot be written: ${kept}\n` : ran.err;
      const after = order.slice(index + 1);
      // What the directory holds now, the part of a conversion that stopped half-way included.
      const written = existsSync(out) ? readdirSync(out).map((entry) => join(out, entry)) : [];
      io.err(
        [
          '',
          indent(reason.trimEnd()),
          '',
          `Stopped at step ${number}, ${step.title.toLowerCase()}${after.length > 0 ? `: ${after.length === 1 ? 'the step' : `the ${after.length} steps`} after it did not run` : ''}.`,
          written.length === 0
            ? `Nothing was written, so ${out} can be given to --out again.`
            : `Written before it stopped: ${written.join(', ')}. migrate never writes over a run, so to run again give --out a new directory, such as ${nextOut(out)}, or delete ${out} first.`,
          '',
          `What to do: ${kept !== undefined ? `check that ${out} can be written to, and run again with a new --out.` : step.whenRefused}`,
          '',
        ].join('\n'),
      );
      return 1;
    }
    if (step.name === 'checks') harness = ran.harness;
    io.out(`${number}. ${step.title}: ${done(step.name, ran, file, conversion)}\n`);
    if (step.name === 'conversion' || step.name === 'decisions') io.out(`${indent(ran.out)}`);
  }

  // Every step ran, so the harness did.
  const result = harness as HarnessResult;
  const failed = result.checks.filter((check) => check.status === 'fail');
  const lines: string[] = [
    '',
    `Verdict: ${result.ready ? 'ready' : 'not ready'}${result.blockers.length > 0 ? '. What stands in the way:' : ''}`,
    ...result.blockers.map((blocker) => `  - ${blocker}`),
  ];

  const server = result.checks.filter(
    (check) => Object.hasOwn(SERVER_HALVES, check.number) && check.reason !== undefined,
  );
  if (server.length > 0) {
    lines.push(
      '',
      'Checks that still need the migration lab server:',
      '  The lab server is a Nuxeo server with your Studio package installed, and Web UI running beside the new app on the same documents. Each check below has a half that needs what only that server holds: its model, and Web UI as it runs your package. This tool does not run those halves: none of it talks to a server yet.',
    );
    for (const check of server)
      lines.push(
        `  - ${check.number} ${check.name}: its server half ${SERVER_HALVES[check.number]}.`,
        `      This run: ${check.reason}.`,
      );
  }
  const others = result.checks.filter(
    (check) =>
      !Object.hasOwn(SERVER_HALVES, check.number) &&
      (check.status === 'not run' || check.status === 'partial'),
  );
  if (others.length > 0) {
    lines.push('', 'Checks that did not run whole, for another reason:');
    for (const check of others)
      lines.push(
        `  - ${check.number} ${check.name}: ${check.status === 'not run' ? 'not run' : 'ran in part'}: ${check.reason ?? ''}.`,
        ...(Object.hasOwn(OTHER_GAPS, check.number) ? [`      ${OTHER_GAPS[check.number]}`] : []),
      );
  }

  const decisions = join(conversion, DECISIONS_FILE);
  const again = [
    'npm run studio-migration -- migrate',
    shell(pkg),
    '--out',
    shell(nextOut(out)),
    ...(request.allowList === undefined ? [] : ['--allow-list', shell(request.allowList)]),
    '--from',
    shell(out),
  ].join(' ');
  const todo: string[] = [];
  if (failed.length > 0)
    todo.push(
      `${failed.length === 1 ? 'Check' : 'Checks'} ${failed.map((check) => `${check.number} (${check.name})`).join(', ')} failed: the conversion is not right as it stands. What ${failed.length === 1 ? 'it' : 'each'} found is in ${join(out, STEP_FILES.checks)}. A finding about your package's own content, such as a colour below WCAG 2.1 AA contrast, is changed in Studio: build the package again and migrate it into a new directory. Send any other to your Nuxeo contact, with ${out}.`,
    );
  todo.push(
    `Read the report, ${join(out, STEP_FILES.report)}: what the package holds and what each part became, what the checks found, and every item that needs a decision.`,
    `In ${decisions}, write for each reported item that has none yet who owns it, in "owner", and what they decided, in "decision". Change nothing else in it.`,
    `To see your decisions counted, run again into a new directory, carrying them: ${again}`,
  );
  if (server.length > 0)
    todo.push(
      'The checks that need the lab server cannot be run from here: ask your Nuxeo contact about running them, and keep this run for them.',
    );
  todo.push(
    'docs/business-apps/studio-migration-guide.md says what each line of the verdict means.',
  );
  lines.push('', 'What to do next:', ...todo.map((item, index) => `  ${index + 1}. ${item}`), '');
  io.out(lines.join('\n'));
  return failed.length > 0 ? 1 : 0;
}

/** Runs one step through `main`, given the files migrate read, and keeps what it printed. */
function runStep(step: Step, run: Command, readFile: (path: string) => Buffer): Ran {
  let out = '';
  let err = '';
  let harness: HarnessResult | undefined;
  try {
    const code = run(step.argv, {
      out: (text) => (out += text),
      err: (text) => (err += text),
      readFile,
      checked: (result) => (harness = result),
    });
    return { code, out, err, ...(harness ? { harness } : {}) };
  } catch (error) {
    // Something no command refuses on purpose: a defect, which stops the run like a refusal.
    return {
      code: 1,
      out: '',
      err: `${err}${(error as Error).stack ?? String(error)}\nThis is a defect in this tool, not a mistake in your package: send this message to your Nuxeo contact.\n`,
    };
  }
}

/** The line a step that ran prints, after its title. */
function done(name: StepName, ran: Ran, file: string, conversion: string): string {
  switch (name) {
    case 'conversion':
      return `done, into ${conversion}; what it printed is in ${file}`;
    case 'checks': {
      const failed = (ran.harness?.checks ?? []).filter((check) => check.status === 'fail');
      return `done, ${failed.length === 0 ? 'and no check failed' : `and ${failed.length === 1 ? 'check' : 'checks'} ${failed.map((check: CheckResult) => check.number).join(', ')} failed`}; in ${file}`;
    }
    case 'decisions':
      return `done; what it printed is in ${file}`;
    default:
      return `done, in ${file}`;
  }
}

/** Where an earlier run, a conversion directory or a file keeps its decisions. */
function decisionsIn(from: string): string {
  if (!existsSync(from) || !statSync(from).isDirectory()) return from;
  const inRun = join(from, CONVERSION_DIRECTORY, DECISIONS_FILE);
  return existsSync(inRun) ? inRun : join(from, DECISIONS_FILE);
}

/** A directory for the next run: `<out>-2`, or the next number free. */
export function nextOut(out: string): string {
  const base = out.replace(/[\\/]+$/, '');
  const numbered = /^(.*)-(\d+)$/.exec(base);
  const stem = numbered ? numbered[1] : base;
  let number = numbered ? Number(numbered[2]) + 1 : 2;
  while (existsSync(`${stem}-${number}`)) number++;
  return `${stem}-${number}`;
}

/** A path as a shell reads it: as it is when it holds nothing a shell would split or expand. */
function shell(path: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? line : `   ${line}`))
    .join('\n');
}
