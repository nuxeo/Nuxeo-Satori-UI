/**
 * npm run app-definition:validate -- <file or directory>... [--mode <mode>] [--allow-list <file>]
 *   [--registered <file>] [--platform <version>] [--model <file>]
 * node libs/shared/app-definition/src/bin.mjs model <file>
 * node libs/shared/app-definition/src/bin.mjs changes <previous package> <package>
 *
 * The check behind phase 0's demo step 1, which the package pipeline is to run first. A layout file
 * that names a widget the platform does not have is refused, and the message names the widget.
 *
 * - **Files checked:** given a directory, every file of an app definition under it
 *   (docs/business-apps/app-definition-v2.md, section 1), so a whole package is checked at once.
 *   Given a file, that file.
 * - **Inside a package**, a directory that holds an `app.json`:
 *   - a JSON file out of place is refused rather than passed over;
 *   - `demo/` and `assets/` are not checked;
 *   - version 1's `bootstrap.json`, `manifest.json` and `layouts.json` are left alone.
 * - **With its package:** a file is checked with the `app.json`, `actions.json`, `assets/` and
 *   `queues/` of the package it sits in, whether or not they were named. One of them that cannot
 *   be read is reported, and fails the run.
 * - **A layout's mode** is read from its path, `layouts/<Type>/<mode>.layout.json`, unless
 *   `--mode` names it.
 * - **Operations** are refused unless `--allow-list` names a file that lists them (decision 3).
 * - **What the deployment registers in code**, a customer's own rules, actions and pages, and the
 *   domain modules it has, come from `--registered`.
 * - **`app.json`'s platform range** is held to `--platform`, when it is given.
 * - **The server's content model**, from `--model`, holds each version 2 layout to the document
 *   type its path names: its properties, and the property types its widgets show. The file is
 *   `{ doctypes, facets, schemas }`, as `scripts/app-package-model.mjs` exports it from a server.
 *   The run says how many layouts it held to the model, and says so when there were none.
 * - **`model <file>`** reads a content model alone, as `--model` does, and exits 0 when the whole
 *   of it can be read, 1 with every problem when it cannot: the export checks its file with it.
 * - **Version 1 layouts** are left to the version 1 reader in `libs/shared/document-layouts`, and
 *   counted.
 * - **`changes <previous package> <package>`** compares two versions of one configuration package,
 *   each a folder holding `bundle/` and `package/`, as `lib/changes.ts` says, and prints, as JSON,
 *   every change, the version part they need raised, the part that was raised, why the version is
 *   refused if it is, and the changelog. Nothing is followed through a link: a package holding one
 *   is refused, exit 2. Exits 0 when the version moved as far as the changes need, 1 when not.
 *
 * Exit codes:
 * - 0: every file has no finding;
 * - 1: a file has a finding or cannot be read, or there was nothing to check;
 * - 2: the command was wrong.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { addressTakenById } from './lib/app';
import { changesBetween, DEFINITION_ROOT, judgeVersion, type PackageFiles } from './lib/changes';
import { readContentModel, type ContentModel } from './lib/content-model';
import { heldToModel, LAYOUT_MODES, type LayoutMode } from './lib/layout-v2';
import { placeFile, validateFile, type PackageContext, type PlacedFile } from './lib/package';
import { isRecord, PACKAGED_REGISTRIES, withRegistered, type Registries } from './lib/registries';
import { parseVersion } from './lib/semver';

export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const USAGE =
  'usage: app-definition validate <file or directory>... [--mode view|metadata|edit|create]' +
  ' [--allow-list <file>] [--registered <file>] [--platform <version>] [--model <file>]\n' +
  '       app-definition model <file>\n' +
  '       app-definition changes <previous package> <package>\n';
const CANNOT_TELL =
  'cannot tell which file of an app definition it is; name it as a package places it,' +
  ' such as layouts/<Type>/<mode>.layout.json or queues/<id>.json, or pass --mode for a layout';
/** Version 1's own files, which a package may hold beside version 2's. */
const VERSION_ONE_FILES = ['bootstrap.json', 'manifest.json', 'layouts.json'];

export function main(argv: readonly string[], io: CliIo): number {
  const [command, ...rest] = argv;
  if (command === 'model') return checkModel(rest, io);
  if (command === 'changes') return compare(rest, io);
  const paths: string[] = [];
  let mode: LayoutMode | undefined;
  let allowList: string | undefined;
  let registeredFile: string | undefined;
  let platformVersion: string | undefined;
  let modelFile: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--mode') {
      const value = rest[++index];
      if (!LAYOUT_MODES.includes(value as LayoutMode)) {
        io.err(`--mode is one of ${LAYOUT_MODES.join(', ')}\n${USAGE}`);
        return 2;
      }
      mode = value as LayoutMode;
    } else if (arg === '--allow-list' && rest[index + 1] !== undefined) {
      allowList = rest[++index];
    } else if (arg === '--registered' && rest[index + 1] !== undefined) {
      registeredFile = rest[++index];
    } else if (arg === '--model' && rest[index + 1] !== undefined) {
      modelFile = rest[++index];
    } else if (arg === '--platform') {
      const value = rest[++index];
      if (value === undefined || !parseVersion(value)) {
        io.err(`--platform is a version, such as 1.0.0\n${USAGE}`);
        return 2;
      }
      platformVersion = value;
    } else if (arg.startsWith('--')) {
      io.err(USAGE);
      return 2;
    } else paths.push(arg);
  }
  if (command !== 'validate' || paths.length === 0) {
    io.err(USAGE);
    return 2;
  }
  let operations: ReadonlySet<string> = new Set();
  if (allowList !== undefined) {
    const read = readAllowList(allowList);
    if (typeof read === 'string') {
      io.err(`${allowList}: ${read}\n${USAGE}`);
      return 2;
    }
    operations = read;
  }
  let registries: Registries = PACKAGED_REGISTRIES;
  if (registeredFile !== undefined) {
    const read = readRegistered(registeredFile);
    if (typeof read === 'string') {
      io.err(`${registeredFile}: ${read}\n${USAGE}`);
      return 2;
    }
    registries = read;
  }
  let model: ContentModel | undefined;
  if (modelFile !== undefined) {
    const read = readModel(modelFile);
    if (typeof read === 'string') {
      io.err(`${modelFile}: ${read}\n${USAGE}`);
      return 2;
    }
    model = read;
  }

  const apps = new Map<string, boolean>();
  const hasApp = (root: string): boolean => {
    const known = apps.get(root);
    if (known !== undefined) return known;
    const found = existsSync(join(root || '.', 'app.json'));
    apps.set(root, found);
    return found;
  };
  const found: Found[] = [];
  for (const path of paths) {
    try {
      if (statSync(path).isDirectory()) walk(path, null, found);
      else found.push({ path, root: null, named: true });
    } catch (error) {
      io.err(`${path}: ${(error as Error).message}\n`);
      return 1;
    }
  }

  const contexts = new Map<string, PackageContext>();
  const problems = new Map<string, string>();
  let refused = 0;
  let passed = 0;
  let versionOne = 0;
  let held = 0;
  let operationRefused = false;
  const checked = new Set<string>();
  for (const { path, root, named } of found) {
    const placed: PlacedFile | null =
      placeFile(path, hasApp) ??
      (mode && (named || path.endsWith('.layout.json'))
        ? { file: { kind: 'layout', type: '', mode }, root: dirname(path) }
        : null);
    // Inside a package, a file is the package's at its place, version 1's own, or out of place.
    const inPackage = root !== null;
    // Compared as directories, not as spellings: `./pkg` and `/tmp/pkg/` are the package too.
    const atItsPlace =
      placed !== null && (!inPackage || resolve(placed.root || '.') === resolve(root));
    if (!atItsPlace) {
      const versionOneFile =
        inPackage && VERSION_ONE_FILES.includes(relative(root, path).split(sep).join('/'));
      if (versionOneFile || (!inPackage && !named && !path.endsWith('.layout.json'))) continue;
    }
    checked.add(path);
    let content: unknown;
    try {
      content = readJson(path);
    } catch (error) {
      io.out(`${path}: cannot be read as JSON: ${(error as Error).message}\n`);
      refused++;
      continue;
    }
    if (!placed || !atItsPlace) {
      io.out(`${path}: ${CANNOT_TELL}\n`);
      refused++;
      continue;
    }
    if (placed.file.kind === 'layout' && isRecord(content) && content['version'] === 1) {
      versionOne++;
      continue;
    }
    // Counted as the validator holds them: one it stops before the model's checks is not.
    if (
      model &&
      placed.file.kind === 'layout' &&
      heldToModel(content, { mode: mode ?? placed.file.mode, type: placed.file.type })
    )
      held++;
    // Said, not refused: an app whose id, with no address, is a platform route.
    const taken = placed.file.kind === 'app' ? addressTakenById(content) : undefined;
    if (taken !== undefined) io.out(`${path}: note: ${taken}\n`);
    const findings = validateFile(
      placed.file,
      content,
      contextOf(placed.root, contexts, problems),
      { registries, operations, platformVersion, mode, model },
    );
    if (findings.length === 0) {
      passed++;
      continue;
    }
    refused++;
    for (const finding of findings) {
      io.out(`${path}: ${finding.path || 'the file'}: ${finding.message} [${finding.kind}]\n`);
      if (finding.message.endsWith("is not on this deployment's allow-list"))
        operationRefused = true;
    }
  }
  if (checked.size === 0) {
    io.out(`No app definition files in ${paths.join(', ')}: nothing was checked.\n`);
    return 1;
  }
  // A package file the checks leant on that could not be read, and was not itself checked.
  const unread = [...problems].filter(([path]) => !checked.has(path));
  for (const [path, problem] of unread) io.out(`${path}: ${problem}\n`);
  if (operationRefused && allowList === undefined)
    io.out('No --allow-list was given, so every operation is refused.\n');
  if (model)
    io.out(
      held > 0
        ? `${held} ${held === 1 ? 'layout was' : 'layouts were'} held to the content model in ${modelFile}.\n`
        : `No layout was held to the content model in ${modelFile}: none is of version 2, in a mode, for a type its path names.\n`,
    );
  const total = checked.size;
  io.out(
    `${total} ${total === 1 ? 'file' : 'files'}: ${passed} passed, ${refused} refused` +
      (versionOne ? `, ${versionOne} in version 1, which this does not check` : '') +
      '.\n',
  );
  return refused > 0 || unread.length > 0 ? 1 : 0;
}

/** A JSON file found under a directory, with the package it is inside, or one named on its own. */
interface Found {
  readonly path: string;
  /** The outermost directory above it, within the walk, that holds an `app.json`. */
  readonly root: string | null;
  readonly named: boolean;
}

/**
 * Every JSON file under a directory, in a stable order, each with the package it is inside. Beside
 * an `app.json`, `demo/` and `assets/` are the package's own, and not app definition files.
 */
function walk(directory: string, root: string | null, found: Found[]): void {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const app = entries.some((entry) => entry.isFile() && entry.name === 'app.json');
  const packageRoot = root ?? (app ? directory : null);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      // Dependencies are passed over, but not inside a package: there `node_modules` is a name like
      // any other, a layout's type for one, and what the package holds is what it ships.
      if (entry.name === 'node_modules' && packageRoot === null) continue;
      if (app && (entry.name === 'demo' || entry.name === 'assets')) continue;
      walk(path, packageRoot, found);
    } else if (entry.isFile() && entry.name.endsWith('.json'))
      found.push({ path, root: packageRoot, named: false });
  }
}

/** JSON, read as a browser reads it: a leading byte-order mark is not part of the text. */
function readJson(path: string): unknown {
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

/** The deployment's operations, from `{ "operations": [...] }`, or what is wrong with the file. */
function readAllowList(path: string): ReadonlySet<string> | string {
  let content: unknown;
  try {
    content = readJson(path);
  } catch (error) {
    return `cannot be read as JSON: ${(error as Error).message}`;
  }
  const operations = isRecord(content) ? content['operations'] : undefined;
  if (
    !isRecord(content) ||
    Object.keys(content).some((key) => key !== 'operations') ||
    !Array.isArray(operations) ||
    !operations.every((operation) => typeof operation === 'string')
  )
    return 'an allow-list is { "operations": [<operation or chain ID>, ...] }';
  return new Set(operations as string[]);
}

/**
 * A server's content model, `{ doctypes, facets, schemas }`, or what is wrong with the file: every
 * problem, since a model read in part would refuse a layout for what it left out.
 */
function readModel(path: string): ContentModel | string {
  let content: unknown;
  try {
    content = readJson(path);
  } catch (error) {
    return `cannot be read as JSON: ${(error as Error).message}`;
  }
  const reading = readContentModel(content);
  if (reading.model) return reading.model;
  return `is not a content model:\n${reading.problems.map((problem) => `  - ${problem}`).join('\n')}`;
}

/** `model <file>`: whether the whole of a content model can be read, and every problem if not. */
function checkModel(rest: readonly string[], io: CliIo): number {
  const [path, ...more] = rest;
  if (path === undefined || path.startsWith('--') || more.length > 0) {
    io.err(USAGE);
    return 2;
  }
  const read = readModel(path);
  if (typeof read === 'string') {
    io.out(`${path}: ${read}\n`);
    return 1;
  }
  const count = (size: number, noun: string): string => `${size} ${noun}${size === 1 ? '' : 's'}`;
  io.out(
    `${path}: a content model of ${count(read.types.size, 'document type')}, ` +
      `${count(read.facets.size, 'facet')} and ${count(read.schemas.size, 'schema')}.\n`,
  );
  return 0;
}

/**
 * `changes <previous package> <package>`: the two versions of a package compared, and whether its
 * version moved as far as the changes need, printed as JSON.
 */
function compare(rest: readonly string[], io: CliIo): number {
  const [previous, current, ...more] = rest;
  if (
    previous === undefined ||
    current === undefined ||
    previous.startsWith('--') ||
    current.startsWith('--') ||
    more.length > 0
  ) {
    io.err(USAGE);
    return 2;
  }
  const read = [previous, current].map(packageFiles);
  const [before, after] = read;
  for (const [index, files] of read.entries())
    if (typeof files === 'string') {
      io.err(`${index === 0 ? previous : current}: ${files}\n`);
      return 2;
    }
  const versionOf = (files: PackageFiles, name: string): string | null => {
    const text = files.get(`${DEFINITION_ROOT}app.json`);
    let app: unknown;
    try {
      app = text === undefined ? undefined : JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      return null;
    }
    const version = isRecord(app) ? app['packageVersion'] : undefined;
    if (typeof version === 'string') return version;
    io.err(`${name}: ${DEFINITION_ROOT}app.json names no packageVersion\n`);
    return null;
  };
  const was = versionOf(before as PackageFiles, previous);
  const is = versionOf(after as PackageFiles, current);
  if (was === null || is === null) {
    io.err(USAGE);
    return 2;
  }
  const { changes, refusals } = changesBetween(before as PackageFiles, after as PackageFiles);
  const judgement = judgeVersion(was, is, changes, refusals);
  io.out(`${JSON.stringify(judgement, null, 2)}\n`);
  return judgement.refused === null ? 0 : 1;
}

/**
 * What `build.mjs`, the generator's, puts into the zip: every file of `bundle/` but its Markdown,
 * and `package/`'s `package.xml` and `install.xml`. Anything else in the package is not shipped, so
 * changing it changes no version.
 */
const PACKAGED = (name: string): boolean =>
  name.startsWith('bundle/')
    ? !name.endsWith('.md')
    : name === 'package/package.xml' || name === 'package/install.xml';

/**
 * The files of a configuration package that its zip holds (`PACKAGED`), each by its path with
 * `/`: its text, or, for a file that is not UTF-8 text, such as an image, its digest. A link is
 * not followed, anywhere in `bundle/` or `package/`, and the package is refused rather than read
 * in part.
 */
function packageFiles(directory: string): PackageFiles | string {
  const files = new Map<string, string>();
  const visit = (path: string, name: string): string | null => {
    const entry = lstatSync(path, { throwIfNoEntry: false });
    if (!entry) return null;
    if (entry.isSymbolicLink()) return `${name} is a symbolic link, which is not followed`;
    if (entry.isDirectory()) {
      for (const child of readdirSync(path).sort()) {
        const problem = visit(join(path, child), `${name}/${child}`);
        if (problem) return problem;
      }
      return null;
    }
    if (!entry.isFile()) return `${name} is neither a file nor a folder`;
    if (!PACKAGED(name)) return null;
    const bytes = readFileSync(path);
    const text = bytes.toString('utf8');
    files.set(
      name,
      Buffer.from(text, 'utf8').equals(bytes)
        ? text
        : `\u0000sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    );
    return null;
  };
  try {
    if (!statSync(directory).isDirectory()) return 'is not a folder';
    for (const part of ['bundle', 'package']) {
      const problem = visit(join(directory, part), part);
      if (problem) return problem;
    }
  } catch (error) {
    return `cannot be read: ${(error as Error).message}`;
  }
  if (!files.has(`${DEFINITION_ROOT}app.json`)) return `has no ${DEFINITION_ROOT}app.json`;
  return files;
}

const REGISTERED_KEYS = [
  'rules',
  'rowActions',
  'bulkActions',
  'actions',
  'modules',
  'pages',
] as const;

/**
 * What a deployment registers in code beyond the platform's own, from
 * `{ "rules", "rowActions", "bulkActions", "actions", "modules", "pages" }`, each a list of ids, or
 * what is wrong. `actions` are the others a deployment registers in code, in any other slot.
 * `pages` are the menu entries of its own a menu may open, by ID.
 */
function readRegistered(path: string): Registries | string {
  let content: unknown;
  try {
    content = readJson(path);
  } catch (error) {
    return `cannot be read as JSON: ${(error as Error).message}`;
  }
  const wrong =
    'a registered file is { "rules", "rowActions", "bulkActions", "actions", "modules", "pages" }, each a list of ids';
  if (!isRecord(content)) return wrong;
  const lists: Partial<Record<(typeof REGISTERED_KEYS)[number], string[]>> = {};
  for (const [key, value] of Object.entries(content)) {
    if (
      !REGISTERED_KEYS.includes(key as (typeof REGISTERED_KEYS)[number]) ||
      !Array.isArray(value) ||
      !value.every((id) => typeof id === 'string' && id !== '')
    )
      return wrong;
    lists[key as (typeof REGISTERED_KEYS)[number]] = value as string[];
  }
  return withRegistered(PACKAGED_REGISTRIES, lists);
}

/**
 * A package's `app.json`, `actions.json`, assets and queues, read once for all its files. One that
 * exists and cannot be read goes into `problems`, so that the run reports it rather than leaning on
 * nothing in silence. Its queues are the names of its `queues/<id>.json` files; a directory with
 * neither an `app.json` nor a `queues/` is no package, and its home's queues are not checked.
 */
function contextOf(
  root: string,
  cache: Map<string, PackageContext>,
  problems: Map<string, string>,
): PackageContext {
  const cached = cache.get(root);
  if (cached) return cached;
  const read = (name: string): unknown => {
    const path = join(root || '.', name);
    if (!existsSync(path)) return undefined;
    try {
      return readJson(path);
    } catch (error) {
      problems.set(path, `cannot be read as JSON: ${(error as Error).message}`);
      return null;
    }
  };
  const assetsRoot = join(root || '.', 'assets');
  let assets: string[] = [];
  if (existsSync(assetsRoot)) {
    try {
      assets = everyFile(assetsRoot).map((path) =>
        relative(root || '.', path)
          .split(sep)
          .join('/'),
      );
    } catch (error) {
      problems.set(assetsRoot, `cannot be read: ${(error as Error).message}`);
    }
  }
  const queuesRoot = join(root || '.', 'queues');
  let queues: ReadonlySet<string> | undefined;
  if (existsSync(queuesRoot)) {
    try {
      queues = new Set(
        readdirSync(queuesRoot, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => entry.name.slice(0, -'.json'.length)),
      );
    } catch (error) {
      problems.set(queuesRoot, `cannot be read: ${(error as Error).message}`);
    }
  } else if (existsSync(join(root || '.', 'app.json'))) queues = new Set();
  const context = {
    app: read('app.json'),
    actions: read('actions.json'),
    assets: new Set(assets),
    queues,
  };
  cache.set(root, context);
  return context;
}

function everyFile(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...everyFile(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
