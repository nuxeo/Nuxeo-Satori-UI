/**
 * npx tsx tools/studio-migration/src/cli.ts <command> …
 *
 *   inventory <package.zip> [--json]                          what the package holds, and becomes
 *   convert   <package.zip> <new-directory> [--allow-list <file>]
 *                                                             the M1 conversion, with its report
 *   check     <package.zip> <conversion-directory> [--json] [--allow-list <file>]
 *                                                             the harness
 *   mutate    <conversion-directory> <mutation> <new-directory> [--package <zip>]   a deliberately broken copy
 *   mutate    --list                                          the mutations, and what must refuse each
 *   decisions <package.zip> <conversion-directory> [--from <decisions.json>]
 *                                                             the decisions file, for people to fill in
 *   report    <package.zip> <conversion-directory> [--json] [--allow-list <file>]
 *                                                             the report, for the person who approves it
 *   migrate   <package.zip> --out <new-directory> [--allow-list <file>] [--from <earlier run>]
 *                                                             all of them in order, for a customer's own
 *                                                             package (migrate.ts)
 *   migrate   <package.zip or folder>... --out <new-directory> [--allow-list <file>] [--from <earlier run>]
 *                                                             the same for each of several packages, each
 *                                                             into its own folder, with a summary (batch.ts)
 *   lab       <document>... --out <new-directory> [--app <url>] [--web-ui <url>] [--nuxeo <url>]
 *             [--package <package.zip> --conversion <conversion-directory>] [--control <control>]
 *                                                             lab mode: the documents in Web UI and the
 *                                                             new app, on a real server (lab-cli.ts)
 *
 * `--allow-list` names the deployment's operations, `{ "operations": [...] }` (decision 3): a button
 * becomes an action only when its operation is on it. `check` and `report` read the list the
 * conversion was made with unless they are given one.
 *
 * `decisions` writes the conversion's `decisions.json` for the package given, an entry for each
 * reported item, for people to say who owns it and what they decided; `--from` carries each
 * decision of an earlier file, for the same build of the package, that still holds. `check` and
 * `report` read it from the conversion, and take it only for the package they are given.
 *
 * `migrate` runs `inventory`, `convert`, `check`, `report` and `decisions` on one package, as a
 * person would by hand, keeping what each prints in a file of `--out`, and says what to do next
 * (`migrate.ts`, and docs/business-apps/studio-migration-guide.md for the customer). Given several
 * packages, or a folder, on the command line (`commandLine`), it runs each so into a folder of
 * `--out` of its own, and writes a summary of them all (`batch.ts`); one package file is run as it
 * always was. `main` runs one command, and one package.
 *
 * Exit codes: 0 done, and for `check` and `migrate`, no check failed (for several packages: in any
 * of them); 1 a check failed, or something could not be read or written, with the reason (for
 * several packages: in any of them); 2 the command was wrong. `report` exits 0 once it
 * has printed the report, whatever the report says. Nothing in a package is ever run, and nothing is
 * ever written over: `convert` and `mutate` write only into a new or empty directory, `decisions`
 * only a `decisions.json` the conversion does not hold yet, and `migrate` only into a new or empty
 * `--out`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { account, type Accounting } from './account';
import { CatalogueError, loadCatalogue, type How } from './catalogue';
import {
  allowListOf,
  convert,
  ConversionError,
  labelsOf,
  OUTCOMES,
  packageBuildOf,
  readConversion,
  writeConversion,
  type Conversion,
  type Outcome,
} from './convert';
import { DECISIONS_FILE, decisionsFor, DecisionsError } from './decisions';
import { checkResultLines, runHarness, type HarnessResult } from './harness';
import { inventory, type FileKind, type Inventory } from './inventory';
import { isDirectory, migrateMany } from './batch';
import { migrate, type Command } from './migrate';
import {
  DECISION_MUTATIONS,
  MUTATIONS,
  MutationError,
  mutation,
  type DecisionMutation,
  type Mutation,
} from './mutations';
import { summarise, TALLIES, type MigrationSummary } from './report';
import { readStudioPackage, StudioPackageError, type StudioPackage } from './studio-package';
import { ZipError } from './zip';

export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly readFile: (path: string) => Buffer;
  /**
   * Given the harness's result once `check` has printed it: how `migrate` reads, as data, the
   * result its `check` step printed, and knows the harness ran. Nothing else sets it.
   */
  readonly checked?: (result: HarnessResult) => void;
  /**
   * Given the report's summary once `report` has printed it: how a run of several packages reads,
   * as data, each package's counts of constructs by outcome. Nothing else sets it.
   */
  readonly reported?: (summary: MigrationSummary) => void;
}

const USAGE = `usage:
  studio-migration inventory <package.zip> [--json]
  studio-migration convert <package.zip> <new-directory> [--allow-list <file>]
  studio-migration check <package.zip> <conversion-directory> [--json] [--allow-list <file>]
  studio-migration mutate <conversion-directory> <mutation> <new-directory> [--package <package.zip>]
  studio-migration mutate --list
  studio-migration decisions <package.zip> <conversion-directory> [--from <decisions.json>]
  studio-migration report <package.zip> <conversion-directory> [--json] [--allow-list <file>]
  studio-migration migrate <package.zip> --out <new-directory> [--allow-list <file>] [--from <earlier run>]
  studio-migration migrate <package.zip or folder>... --out <new-directory> [--allow-list <file>] [--from <earlier run of them>]
  studio-migration lab <document>... --out <new-directory> [--app <url>] [--web-ui <url>] [--nuxeo <url>] [--package <package.zip> --conversion <conversion-directory>] [--control <control>]
`;

/** What a command expects: its positional arguments, the flags it takes, and those with a value. */
const COMMANDS: Readonly<
  Record<
    string,
    {
      readonly args: number;
      readonly flags: readonly string[];
      readonly valued?: readonly string[];
    }
  >
> = {
  inventory: { args: 1, flags: ['--json'] },
  convert: { args: 2, flags: [], valued: ['--allow-list'] },
  check: { args: 2, flags: ['--json'], valued: ['--allow-list'] },
  mutate: { args: 3, flags: [], valued: ['--package'] },
  decisions: { args: 2, flags: [], valued: ['--from'] },
  report: { args: 2, flags: ['--json'], valued: ['--allow-list'] },
  migrate: { args: 1, flags: [], valued: ['--out', '--allow-list', '--from'] },
};

/** A command line read against {@link COMMANDS}: its arguments, flags and values. */
interface Parsed {
  readonly command: string | undefined;
  readonly spec: (typeof COMMANDS)[string] | undefined;
  readonly args: readonly string[];
  readonly flags: readonly string[];
  readonly values: ReadonlyMap<string, string>;
  /** A flag the command does not take, or a value missing or given twice. */
  readonly wrong: boolean;
}

function parse(argv: readonly string[]): Parsed {
  const [command, ...rest] = argv;
  const spec =
    command !== undefined && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  const flags: string[] = [];
  const args: string[] = [];
  const values = new Map<string, string>();
  let wrong = !spec;
  for (let index = 0; index < rest.length && spec; index++) {
    const arg = rest[index];
    if (spec.valued?.includes(arg)) {
      const value = rest[++index];
      if (value === undefined || value.startsWith('--') || values.has(arg)) wrong = true;
      else values.set(arg, value);
    } else if (arg.startsWith('--')) {
      if (!spec.flags.includes(arg)) wrong = true;
      flags.push(arg);
    } else args.push(arg);
  }
  return { command, spec, args, flags, values, wrong };
}

/**
 * The command line: `main`, but for `migrate` given several packages, or a folder, which runs
 * them all (`batch.ts`) and is asynchronous. It lets the event loop turn after each package, so
 * that what one package's run parsed is freed before the next: jsdom keeps a document it made
 * until the job that made it ends. Every other command, one package's `migrate` among them, is
 * `main` itself, run as it always was, and its code is given as `main` gives it.
 */
export function commandLine(argv: readonly string[], io: CliIo): number | Promise<number> {
  const { command, args, values, wrong } = parse(argv);
  const out = values.get('--out');
  if (
    command === 'migrate' &&
    !wrong &&
    out !== undefined &&
    args.length > 0 &&
    (args.length > 1 || isDirectory(args[0]))
  ) {
    const allowList = values.get('--allow-list');
    const from = values.get('--from');
    return migrateMany(
      {
        packages: args,
        out,
        ...(allowList !== undefined ? { allowList } : {}),
        ...(from !== undefined ? { from } : {}),
      },
      io,
      step,
    );
  }
  return main(argv, io);
}

/** `main` as a step of `migrate`: one command, whose code is a number. */
const step: Command = (argv, io) => main(argv, io);

export function main(argv: readonly string[], io: CliIo): number {
  const { command, spec, args, flags, values, wrong } = parse(argv);
  if (command === 'mutate' && argv.length === 2 && argv[1] === '--list') {
    for (const m of [...MUTATIONS, ...DECISION_MUTATIONS])
      io.out(`${m.name.padEnd(22)} ${catcher(m).padEnd(10)} ${m.description}\n`);
    return 0;
  }
  if (!spec || wrong || args.length !== spec.args) {
    io.err(USAGE);
    return 2;
  }
  const json = flags.includes('--json');
  const allowListFile = values.get('--allow-list');
  try {
    switch (command) {
      case 'inventory': {
        const result = inventory(readPackage(io, args[0]));
        const accounting = account(result, loadCatalogue());
        io.out(
          json
            ? `${JSON.stringify(toJson(result, accounting), null, 2)}\n`
            : summary(result, accounting),
        );
        return 0;
      }
      case 'convert': {
        const pkg = readPackage(io, args[0]);
        const conversion = convert(pkg, inventory(pkg), loadCatalogue(), {
          allowList: readAllowList(io, allowListFile) ?? new Set(),
        });
        writeConversion(args[1], conversion);
        io.out(conversionSummary(conversion, args[1]));
        return 0;
      }
      case 'check': {
        const pkg = readPackage(io, args[0]);
        const conversion = readConversion(args[1]);
        const allowList = readAllowList(io, allowListFile);
        const result = runHarness({
          pkg,
          inventory: inventory(pkg),
          catalogue: loadCatalogue(),
          conversion,
          ...(allowList ? { allowList } : {}),
        });
        io.out(
          json ? `${JSON.stringify(result, null, 2)}\n` : harnessSummary(result, pkg, args[1]),
        );
        io.checked?.(result);
        return result.checks.some((check) => check.status === 'fail') ? 1 : 0;
      }
      case 'mutate': {
        const chosen = mutation(args[1]);
        if (!chosen) {
          io.err(`${args[1]} is not a mutation; \`mutate --list\` lists them\n`);
          return 2;
        }
        // A control that writes what the package's Web UI leaves out reads the package too.
        const packageFile = values.get('--package');
        const source =
          packageFile === undefined
            ? undefined
            : (() => {
                const pkg = readPackage(io, packageFile);
                return { pkg, inventory: inventory(pkg), catalogue: loadCatalogue() };
              })();
        const { conversion, changed } = chosen.apply(readConversion(args[0]), source);
        writeConversion(args[2], conversion);
        io.out(
          `${chosen.name}: ${changed}. Written to ${args[2]}; ${
            chosen.caughtBy === 'decisions'
              ? 'what stands in the way of readiness must now show it'
              : `check ${chosen.caughtBy} must now fail`
          }.\n`,
        );
        return 0;
      }
      case 'decisions': {
        const pkg = readPackage(io, args[0]);
        const conversion = readConversion(args[1]);
        const from = values.get('--from');
        const earlier = from === undefined ? undefined : { raw: readJson(io, from), file: from };
        const { file, carried, notCarried, blank } = decisionsFor(
          conversion.report,
          packageBuildOf(pkg),
          earlier,
        );
        const path = join(args[1], DECISIONS_FILE);
        try {
          // `wx`: written only where no file is, so a person's decisions are never written over.
          writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { flag: 'wx' });
        } catch (error) {
          throw new DecisionsError(
            (error as NodeJS.ErrnoException).code === 'EEXIST'
              ? `${path} exists, and is never written over`
              : `${path}: ${(error as Error).message}`,
          );
        }
        const lines = [
          `Wrote ${path}: ${plural(file.decisions.length, 'reported item')}, ${blank} of them still without an owner or a decision`,
        ];
        if (from !== undefined) {
          lines.push(`  carried from ${from}: ${carried}`);
          if (notCarried.length > 0) {
            // Printed once: the earlier file is read, never changed, so it still holds each.
            lines.push(`  not carried, and still in ${from}: ${notCarried.length}`);
            for (const line of notCarried) lines.push(`    - ${line}`);
          }
        }
        io.out(`${lines.join('\n')}\n`);
        return 0;
      }
      case 'report': {
        const pkg = readPackage(io, args[0]);
        const allowList = readAllowList(io, allowListFile);
        const summary = summarise({
          pkg,
          inventory: inventory(pkg),
          catalogue: loadCatalogue(),
          conversion: readConversion(args[1]),
          ...(allowList ? { allowList } : {}),
        });
        io.out(json ? `${JSON.stringify(summary, null, 2)}\n` : reportSummary(summary));
        io.reported?.(summary);
        return 0;
      }
      case 'migrate': {
        const out = values.get('--out');
        if (out === undefined) {
          io.err(USAGE);
          return 2;
        }
        const from = values.get('--from');
        // Each step is this very function, so each prints what the command prints by hand.
        return migrate(
          {
            package: args[0],
            out,
            ...(allowListFile !== undefined ? { allowList: allowListFile } : {}),
            ...(from !== undefined ? { from } : {}),
          },
          io,
          main,
        );
      }
    }
  } catch (error) {
    if (
      error instanceof ZipError ||
      error instanceof StudioPackageError ||
      error instanceof CatalogueError ||
      error instanceof ConversionError ||
      error instanceof MutationError ||
      error instanceof DecisionsError
    ) {
      io.err(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
  return 2;
}

/** Which part of the harness must refuse what a control breaks. */
function catcher(control: Mutation | DecisionMutation): string {
  return control.caughtBy === 'decisions' ? 'decisions' : `check ${control.caughtBy}`;
}

function readJson(io: CliIo, path: string): unknown {
  try {
    return JSON.parse(io.readFile(path).toString('utf8'));
  } catch (error) {
    throw new ConversionError(`${path}: ${(error as Error).message}`);
  }
}

/** The deployment's allow-list, `{ "operations": [...] }`, as app-definition's command line reads it. */
function readAllowList(io: CliIo, path: string | undefined): ReadonlySet<string> | undefined {
  return path === undefined ? undefined : allowListOf(readJson(io, path), path);
}

export function readPackage(io: CliIo, path: string): StudioPackage {
  let archive: Buffer;
  try {
    archive = io.readFile(path);
  } catch (error) {
    throw new StudioPackageError(`${path}: ${(error as Error).message}`);
  }
  try {
    return readStudioPackage(archive);
  } catch (error) {
    if (error instanceof ZipError) throw new ZipError(`${path}: ${error.message}`);
    if (error instanceof StudioPackageError)
      throw new StudioPackageError(`${path}: ${error.message}`);
    throw error;
  }
}

export function conversionSummary(conversion: Conversion, directory: string): string {
  const { report } = conversion;
  const counts = new Map<Outcome, number>(OUTCOMES.map((outcome) => [outcome, 0]));
  for (const entry of report.constructs)
    counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);
  const labels = Object.entries(labelsOf(conversion)).map(
    ([locale, texts]) => `${locale} (${Object.keys(texts).length})`,
  );
  const files = Object.keys(conversion.app);
  const count = (prefix: string): number => files.filter((path) => path.startsWith(prefix)).length;
  const themes = Object.entries(conversion.themes).map(
    ([name, theme]) =>
      `${name} (${plural(Object.keys(theme.tokens).length, 'token')}, ${plural(Object.keys(conversion.assets).filter((path) => path.startsWith(`themes/${name}/`)).length, 'file')})`,
  );
  return [
    `Converted ${report.package.name} ${report.package.version} into ${directory}`,
    `  ${report.constructs.length} constructs: ${[...counts]
      .filter(([, n]) => n > 0)
      .map(([outcome, n]) => `${outcome} ${n}`)
      .join(', ')}`,
    `  app/: ${plural(files.length, 'file')}: app.json, ${plural(count('layouts/'), 'layout')}, ${plural(count('queues/'), 'queue')}, ${count('home.json') ? 'home.json, ' : ''}${count('navigation.json') ? 'navigation.json, ' : ''}${count('actions.json') ? 'actions.json, ' : ''}${plural(count('labels/'), 'labels file')}`,
    `  labels: ${labels.join(', ') || 'none'}`,
    `  themes: ${themes.join(', ') || 'none'}`,
    '',
  ].join('\n');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function harnessSummary(
  result: HarnessResult,
  pkg: StudioPackage,
  directory: string,
): string {
  const lines = [
    `${pkg.descriptor.name} ${pkg.descriptor.version}, against the conversion in ${directory}`,
    '',
    ...checkLines(result),
  ];
  return `${lines.join('\n')}\n`;
}

/** The ten checks, each with what it found, then the verdict and what stands in its way. */
function checkLines(result: Pick<HarnessResult, 'checks' | 'ready' | 'blockers'>): string[] {
  const lines = checkResultLines(result.checks);
  lines.push('', `Verdict: ${result.ready ? 'ready' : 'not ready'}`);
  for (const blocker of result.blockers) lines.push(`  - ${blocker}`);
  return lines;
}

/** The report of section 8 as text, which `report` prints. */
export function reportSummary(summary: MigrationSummary): string {
  const { header, all } = summary;
  const { package: pkg, studio } = header;
  const lines = [
    `Migration report: ${pkg.name} ${pkg.version}`,
    '',
    `Package: ${pkg.name} ${pkg.version}, for ${pkg.targetPlatform ?? 'any platform'}` +
      `${pkg.targetPlatformName ? ` (${pkg.targetPlatformName})` : ''}; its bundle ${pkg.bundle}`,
    `Studio: branch ${studio.branch ?? 'not recorded'}, commit ${studio.commit ?? 'not recorded'}, built ${studio.buildTime ?? 'at a time not recorded'}`,
    `App: ${header.app.id ?? 'no app.json'}${header.app.platform ? `, for platform ${header.app.platform}` : ''}`,
    `Converter: ${header.converter.name} ${header.converter.version}, phase ${header.converter.phase}`,
    `Allow-list: ${header.allowList.operations.join(', ') || 'none'}, ${
      header.allowList.from === 'deployment'
        ? "the deployment's, as given"
        : "as the conversion recorded it, not the deployment's word for it"
    }`,
    '',
    `Summary: ${plural(all.total, 'construct')}, by kind and outcome`,
  ];
  // A column for each tally a construct has, and `missing` always: its 0 is what coverage means.
  const tallies = TALLIES.filter((tally) => tally === 'missing' || all.tallies[tally] > 0);
  const headings = [
    'total',
    ...tallies.flatMap((tally) => (tally === 'reported' ? ['reported', 'decided'] : [tally])),
  ];
  const first = Math.max('kind'.length, ...summary.kinds.map((count) => count.kind.length));
  const row = (name: string, cells: readonly string[]): string =>
    `  ${name.padEnd(first)}${cells.map((cell, index) => cell.padStart(Math.max(5, headings[index].length) + 2)).join('')}`;
  lines.push(row('kind', headings));
  for (const count of [...summary.kinds, all]) {
    lines.push(
      row(count.kind, [
        String(count.total),
        ...tallies.flatMap((tally) =>
          tally === 'reported'
            ? [String(count.tallies.reported), String(count.decided)]
            : [String(count.tallies[tally])],
        ),
      ]),
    );
  }
  const { coverage } = summary;
  lines.push(
    `Coverage: ${coverage.percent}%, ${coverage.accounted} of the package's ${coverage.constructs} constructs in the report`,
    '',
    'What the harness found:',
    ...checkLines(summary).map((line) => (line === '' ? line : `  ${line}`)),
    '',
  );

  const decided = summary.reported.filter((item) => item.owner && item.decision).length;
  lines.push(
    `Decisions needed: ${plural(summary.reported.length, 'reported item')}, ${decided} of them decided`,
  );
  // Each on one line: an owner's words, or a package's, cannot make a line of their own, such as
  // an item that looks decided.
  for (const item of summary.reported) {
    lines.push(
      `  - ${oneLine(item.label)}, in ${oneLine(item.file)}`,
      `      id: ${oneLine(item.id)}`,
      `      why: ${oneLine(item.note)}`,
    );
    if (item.to !== undefined) lines.push(`      written to: ${oneLine(item.to)}`);
    lines.push(
      `      owner: ${item.owner === null ? 'none' : oneLine(item.owner)}; decided: ${item.decision === null ? 'nothing yet' : oneLine(item.decision)}`,
    );
  }
  if (summary.decisionFindings.length > 0) {
    lines.push('  Not taken from decisions.json:');
    for (const finding of summary.decisionFindings) lines.push(`    - ${oneLine(finding)}`);
  }
  lines.push(
    '',
    summary.proposed.length === 0
      ? 'Proposals: none'
      : `Proposals: ${summary.proposed.length}, each waiting for a person to accept or reject it`,
  );
  for (const item of summary.proposed)
    lines.push(
      `  - ${oneLine(item.label)}, in ${oneLine(item.file)}`,
      `      id: ${oneLine(item.id)}`,
      `      why: ${oneLine(item.note)}`,
    );

  lines.push('', `Files: ${summary.files.length}`);
  for (const file of summary.files) {
    const counted = TALLIES.filter((tally) => file.tallies[tally])
      .map((tally) => `${tally} ${file.tallies[tally]}`)
      .join(', ');
    lines.push(`  ${oneLine(file.path)} (${file.kind}): ${counted}`);
    for (const place of file.became) lines.push(`      became: ${oneLine(place)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Text on one line: each control character, a line break among them, written as an escape. */
function oneLine(text: string): string {
  const named: Readonly<Record<string, string>> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, (character) =>
    Object.hasOwn(named, character)
      ? named[character]
      : `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export function summary(result: Inventory, accounting: Accounting): string {
  const lines: string[] = [];
  const { descriptor } = result;
  lines.push(
    `${descriptor.name} ${descriptor.version}: a ${descriptor.type} package for ${descriptor.targetPlatform ?? 'any platform'}` +
      (descriptor.targetPlatformName ? ` (${descriptor.targetPlatformName})` : '') +
      (descriptor.dependencies.length
        ? `, depending on ${descriptor.dependencies.join(', ')}`
        : ''),
    '',
  );

  const inPackage = result.files.filter((file) => file.location === 'package').length;
  lines.push(
    `Files: ${result.files.length}, ${inPackage} in the package and ${result.files.length - inPackage} in its bundle`,
  );
  const kinds = new Map<FileKind, number>();
  for (const file of result.files) kinds.set(file.kind, (kinds.get(file.kind) ?? 0) + 1);
  lines.push(`  ${[...kinds].map(([kind, count]) => `${kind} ${count}`).join(', ')}`);

  const contributions = result.model.reduce((total, m) => total + m.contributions, 0);
  lines.push(
    `Model: ${contributions} contributions to ${result.model.length} extension points. They stay on the server; nothing to convert.`,
  );

  lines.push(`Document layouts: ${result.layouts.length}`);
  const byType = new Map<string, string[]>();
  for (const layout of result.layouts) {
    const type = layout.docType ?? '(no @doctype)';
    byType.set(type, [
      ...(byType.get(type) ?? []),
      `${layout.mode} (${layout.fields.length} fields)`,
    ]);
  }
  for (const [type, modes] of byType) lines.push(`  ${type}: ${modes.join(', ')}`);

  const providers = [
    ...new Set(result.searches.map((search) => search.provider ?? '(no @search)')),
  ];
  lines.push(`Search screens: ${providers.length}`);
  for (const provider of providers) {
    const parts = result.searches.filter(
      (search) => (search.provider ?? '(no @search)') === provider,
    );
    const described = parts.map((part) =>
      part.part === 'form'
        ? `a form with ${part.fields.length} fields`
        : `results with ${part.columns} columns, shown as ${part.views.join(', ') || 'nothing'}`,
    );
    lines.push(`  ${provider}: ${described.join('; ')}`);
  }

  lines.push(`Slot contributions: ${accounting.slots.length}`);
  for (const { contribution, entry } of accounting.slots) {
    const target = !entry
      ? 'not in the catalogue'
      : entry.slot
        ? `${entry.how} → ${entry.slot}`
        : entry.layer0
          ? `${entry.how} → Layer 0 ${entry.layer0}`
          : entry.how;
    lines.push(`  ${contribution.slot.padEnd(26)} ${contribution.name.padEnd(24)} ${target}`);
  }

  lines.push(
    `Conditions: ${result.conditions.length ? `${result.conditions.length}, converted in M2 with truth tables` : 'none'}`,
  );

  const withCode = result.customCode.filter((custom) => custom.hasCode);
  lines.push(
    `Custom code: ${withCode.length ? withCode.map((custom) => custom.path).join(', ') : 'none'}`,
  );

  const known = accounting.scripts.filter((outcome) => outcome.entry !== null).length;
  lines.push(
    `Scripts: ${accounting.scripts.length}, ${known} of them generated by Studio or Web UI` +
      (known < accounting.scripts.length ? `, ${accounting.scripts.length - known} not` : ''),
  );

  if (result.dashboard) {
    const repeats = result.dashboard.cards.filter((card) => card.repeatOf !== null).length;
    lines.push(
      `Dashboard: ${result.dashboard.cards.length} cards${repeats ? `, ${repeats} of them a repeat` : ''}`,
    );
  }

  for (const theme of accounting.themes) {
    const mapped = theme.mappings.filter((mapping) => mapping.token !== null).length;
    lines.push(
      `Theme ${theme.theme}: ${theme.mappings.length} properties, ${mapped} set a token and ${theme.mappings.length - mapped} are reported`,
    );
  }

  lines.push(
    `Translations: ${result.translations.map((t) => `${t.locale} ${t.keys.length} keys`).join(', ') || 'none'}`,
  );

  const byHow = new Map<How | 'not in the catalogue', number>();
  for (const outcome of accounting.elements) {
    const how = outcome.entry?.how ?? 'not in the catalogue';
    byHow.set(how, (byHow.get(how) ?? 0) + 1);
  }
  lines.push(
    `Elements: ${accounting.elements.length} distinct: ${[...byHow].map(([how, count]) => `${how} ${count}`).join(', ')}`,
  );

  lines.push('', `Decisions needed: ${accounting.decisions.length || 'none'}`);
  for (const decision of accounting.decisions) lines.push(`  - ${decision}`);
  return `${lines.join('\n')}\n`;
}

function toJson(result: Inventory, accounting: Accounting): unknown {
  return {
    inventory: { ...result, elements: Object.fromEntries(result.elements) },
    accounting,
  };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const io: CliIo = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    readFile: (path) => readFileSync(path),
  };
  // `lab` drives a browser, so it is asynchronous, and loaded only when it runs (lab-cli.ts).
  if (argv[0] === 'lab')
    void import('./lab-cli').then(async ({ lab }) => {
      process.exitCode = await lab(argv.slice(1), io);
    });
  else {
    const code = commandLine(argv, io);
    if (typeof code === 'number') process.exitCode = code;
    else
      void code.then((ended) => {
        process.exitCode = ended;
      });
  }
}
