/**
 * Validated writes: `write_package_file`, `apply_generator` and `apply_package_changes`. Each
 * writes to a package only what passes the package pipeline, and otherwise changes nothing. Phase
 * 3 of docs/business-apps/development-plan.md: "every write by the agent passes validation; an
 * agent asked to use an unregistered ID is refused".
 *
 * 1. **The package is one folder directly inside a package root:** `business-apps/packages/`, or
 *    bundled into `satori mcp` a configuration repository's `config-packages/` (host.ts), or the
 *    roots `BUILDER_PACKAGE_ROOTS` names instead (config.ts). It is reached through no link,
 *    holds no link, symbolic or hard, and is named as a Marketplace package is, in kebab case.
 * 2. **Each file is one a writer may write** (`fileKind`): the app definition's files, for
 *    `write_package_file` and for a `remove`, which takes one out but `app.json`; a configuration
 *    package's two layers, `bootstrap.json` and `manifest.json`, for `write_package_file` only, and
 *    only when the package's component names the file as that layer's fragment, so that step 2
 *    checks it and the server serves it; those and the files the generators write, for a generator. Anything
 *    else is refused before anything runs: a path that leaves the package, a hidden file, code, an
 *    asset, the build allow-list, the pipeline's own output.
 * 3. **The changes are made to a staging copy,** a private temporary folder: each write, and each
 *    generator run in a process of its own (`run-generator.ts`) on a tree that reads the staging
 *    copy and writes nothing.
 * 4. **The staging copy is validated as `validate_package` validates a folder alone, as CI does:**
 *    the pipeline's steps 1 to 6, with the package's own build allow-list when it names one, the
 *    platform's version, and its own `content-model.json` when it ships a stand-in model, its
 *    names compared with the other kits in the folder the package is in (`--kits`), as CI compares
 *    a kit in `business-apps/packages/`. No other allow-list, registered file or platform version
 *    is taken, so nothing the agent gives can register an id. Every app definition file the changes touch must be of version 2, since the
 *    validator does not check a layout of version 1.
 * 5. **Only with no finding and no refusing step** are the changes committed, under a lock in the
 *    package's own `dist/` that another process's write also takes: each file is written there,
 *    then renamed into its place. A failure part way puts back every file already moved, so the
 *    package is as it was. A package that changed since the staging copy was taken, or a path that
 *    differs from another only in case, is not written at all.
 *
 * What it never does: run package code (the generators are this repository's, their tree is rooted
 * in a folder that holds only the repository's formatting configuration, and the pipeline runs
 * `build.mjs` only once step 1 found it the generator's, byte for byte); write outside the
 * package, but for its own temporary folder; follow a link; give a credential to anything it runs.
 */
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { GeneratedChange, GeneratorAnswer, GeneratorRequest } from './generator-process.ts';
import { HOST } from './host.ts';
import { schemaHeadingWarnings } from './schema-headings.ts';
import {
  REPO_ROOT,
  inRepository,
  linkInside,
  pipelineEnvironment,
  runNode,
  validatePackage,
  within,
  type PackageCheck,
} from './validate-package.ts';

/** `business-apps/packages/` in this repository; bundled, a configuration repository's `config-packages/`. */
export const DEFAULT_PACKAGE_ROOT = HOST.packageRoot;
/** Where each generator's schema is: this repository's sources, or what the bundled tool carries. */
export const GENERATORS_SOURCE = HOST.generators;
/** The generators a package write may run: the app definition's, and nothing else. */
export const APP_GENERATORS = [
  'app-package',
  'app-layout',
  'app-form',
  'app-queue',
  'app-action',
  'app-registry',
  'app-model',
  'app-connector',
  'app-dependency',
] as const;
export type AppGenerator = (typeof APP_GENERATORS)[number];
export const MAX_CHANGES = 32;
/** The server refuses a fragment or a layout over 1 MiB (`build.mjs`'s `MAX_JSON_BYTES`). */
export const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const GENERATOR_TIMEOUT_MS = 120_000;
const RUNNER = HOST.runner;
/** What `formatFiles` reads to format a generator's files, copied to the tree's own root. */
const FORMATTING = ['.prettierrc', '.editorconfig'] as const;
/** `app-package`'s rule for a package's name, which is its folder's. */
const PACKAGE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const CONFIG = 'bundle/agentic-ui-config';
/** A demo kit's description of its stand-in model, beside `bundle/`, which `app-model` writes. */
const OWN_MODEL = 'content-model.json';

export type Change =
  | { readonly kind: 'write'; readonly path: string; readonly content: string }
  /** A file of the app definition taken out, as `write_package_file` could write it. */
  | { readonly kind: 'remove'; readonly path: string }
  | {
      readonly kind: 'generator';
      readonly generator: string;
      readonly options?: Readonly<Record<string, unknown>>;
    };

export interface WriteRequest {
  /** The package folder, relative to the repository unless absolute. */
  readonly package: string;
  readonly changes: readonly Change[];
}

/** A run of a generator, as the server asks for one. */
export interface GeneratorRun {
  readonly generator: AppGenerator;
  readonly request: Omit<GeneratorRequest, 'answer' | 'treeRoot'>;
  readonly work: string;
  readonly timeoutMs: number;
}

export interface WriteOptions {
  /** The folders a package may be directly inside. Default: `business-apps/packages/`. */
  readonly packageRoots?: readonly string[];
  /** Where a content model given to a generator may be. Default: the repository and the roots. */
  readonly modelRoots?: readonly string[];
  /** Where the staging copy is made. Default: the system's temporary folder. */
  readonly workIn?: string;
  readonly timeoutMs?: number;
  /**
   * The pipeline, as `validate_package` runs it on a folder alone, its names compared with the
   * other kits in `kits`, the folder the package is in. Replaced in some tests.
   */
  readonly validate?: (
    directory: string,
    roots: readonly string[],
    workIn: string,
    kits: string | null,
  ) => Promise<PackageCheck>;
  /**
   * The folder of the kits whose names the package's are compared with, by the pipeline's
   * `--kits`. Default: the folder the package is in, as CI compares a kit in
   * `business-apps/packages/` with the others there. `null` compares none: for tests that keep
   * several copies of one kit in one root.
   */
  readonly kits?: string | null;
  /** The generator's process. Replaced in some tests. */
  readonly generate?: (run: GeneratorRun) => Promise<GeneratorAnswer>;
  /** Called once the changes passed, before the package is read again and written. Tests only. */
  readonly beforeCommit?: () => void;
  /** Called before each file is moved into the package. Tests only. */
  readonly beforeMove?: (path: string, index: number) => void;
}

export interface FileChange {
  /** The file, relative to the package, with `/`. */
  readonly path: string;
  readonly change: 'created' | 'updated' | 'removed';
}

export interface WriteResult {
  readonly package: string;
  /** Whether the package now holds the changes. */
  readonly written: boolean;
  /** What was written, or would have been. */
  readonly changes: readonly FileChange[];
  /** The pipeline's answer on the staging copy; `null` when there was nothing to check. */
  readonly validation: PackageCheck | null;
  /** What each generator printed, in order. */
  readonly generatorOutput: readonly string[];
  /**
   * What the package, as written, still lacks that no check refuses: each of a demo kit's own
   * schemas whose Properties heading has no text (`schema-headings.ts`). Only when written, and
   * only when there is one.
   */
  readonly warnings?: readonly string[];
  readonly note: string;
}

// ------------------------------------------------------------------------------- what is written

/**
 * Who may write a file: `write_package_file` and the generators (`definition`), `write_package_file`
 * alone, a configuration's Layer 0 or Layer 1 (`layer`), or the generators only (`generated`).
 */
export type FileKind = 'definition' | 'layer' | 'generated';

const PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEFINITION = [
  /^app\.json$/,
  /^(?:home|navigation|actions)\.json$/,
  /^queues\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.json$/,
  /^labels\/[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\.json$/,
  /^tasks\/[A-Za-z][A-Za-z0-9_-]{0,127}\.[A-Za-z][A-Za-z0-9_-]{0,127}\.layout\.json$/,
  /^layouts\/[A-Za-z][A-Za-z0-9_-]{0,127}\/[a-z][a-z0-9-]{0,31}\.layout\.json$/,
];
/** A configuration package's two layers, each by the layer its component's fragment names. */
const LAYER_FILES: Readonly<Record<string, 'bootstrap' | 'manifest'>> = {
  'bootstrap.json': 'bootstrap',
  'manifest.json': 'manifest',
};
const GENERATED = [
  /^\.gitignore$/,
  /^README\.md$/,
  /^build\.mjs$/,
  /^content-model\.json$/,
  /^package\/(?:package|install)\.xml$/,
  /^bundle\/META-INF\/MANIFEST\.MF$/,
  /^bundle\/OSGI-INF\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.xml$/,
  /^bundle\/schemas\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.xsd$/,
  // A kit's connectors, beside its bundle and not in it: app-connector's.
  /^connectors\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}-connectors-config\.xml$/,
];
/** The names Windows keeps for devices, which no file there may have. */
const DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;

const WRITABLE =
  'app.json, home.json, navigation.json, actions.json, queues/<id>.json, labels/<language>.json,' +
  ' tasks/<workflow>.<step>.layout.json or layouts/<Type>/<mode>.layout.json, and a' +
  " configuration package's bootstrap.json and manifest.json, which its component names, under" +
  ` ${CONFIG}/`;

/**
 * What a path inside a package is, or why no writer here may write it. The path is the one given,
 * relative to the package with `/`, judged as a string before the file system is asked anything.
 */
export function fileKind(path: string): FileKind | { readonly problem: string } {
  const refuse = (why: string) => ({ problem: `${JSON.stringify(path)} ${why}` });
  if (path.length === 0 || path.length > 512) return refuse('is not a file path.');
  if (path.includes('\\') || path.includes('\0') || path.includes(':'))
    return refuse('is not a path inside the package: write it with "/" between its parts.');
  if (path.startsWith('/') || isAbsolute(path))
    return refuse(
      'is absolute. Give it relative to the package, such as bundle/agentic-ui-config/app.json.',
    );
  const parts = path.split('/');
  if (parts.some((part) => part === '..' || part === '.' || part === ''))
    return refuse(
      'leaves the package, or has an empty or "." part. Nothing outside it is written.',
    );
  if (path === '.gitignore') return 'generated';
  if (parts.some((part) => part.startsWith('.')))
    return refuse('is a hidden file, or in a hidden folder, and is not written.');
  const bad = parts.find((part) => !PART.test(part) || DEVICE.test(part));
  if (bad !== undefined)
    return refuse(
      `has the part "${bad}", which is not a file name of letters, digits, ".", "_" and "-".`,
    );
  if (path.startsWith(`${CONFIG}/`)) {
    const inside = path.slice(CONFIG.length + 1);
    if (DEFINITION.some((place) => place.test(inside))) return 'definition';
    if (Object.hasOwn(LAYER_FILES, inside)) return 'layer';
    if (inside.startsWith('assets/'))
      return refuse(
        'is an asset. These tools write no asset: one is served without authentication, and its' +
          ' bytes are not something the validator checks. A person adds it.',
      );
    return refuse(`is not a file of the app definition the pipeline accepts. One is ${WRITABLE}.`);
  }
  if (GENERATED.some((place) => place.test(path))) return 'generated';
  if (parts[0] === 'deployment')
    return refuse(
      "is the deployment's: the build allow-list there is what CI gives the pipeline, and an" +
        ' agent that wrote it could allow its own operations (decision 3). A person writes it.',
    );
  if (parts[0] === 'dist') return refuse("is the pipeline's output, which is never written here.");
  if (/\.(?:[cm]?[jt]sx?|java|sh|ps1|py|rb|groovy|jar|class)$/i.test(path))
    return refuse('is code. A package is configuration only, and these tools write no code.');
  return refuse(
    `is not a file these tools write. write_package_file writes ${WRITABLE}; the generators` +
      ' also write the component, the manifest, package/, build.mjs, the schemas,' +
      ' content-model.json and the connectors, connectors/<package>-connectors-config.xml.',
  );
}

/** Where a file the generators alone write comes from, for the refusal. */
function writtenBy(path: string): string {
  if (path === 'content-model.json' || path.startsWith('bundle/schemas/'))
    return 'app-model writes it, for a demo kit';
  if (path.startsWith('connectors/')) return 'app-connector writes it, and takes a connector out';
  if (path.startsWith('bundle/OSGI-INF/'))
    return 'the generator of what it contributes writes it: app-layout, app-form, app-queue, app-action, app-registry or app-model';
  if (path === 'package/package.xml')
    return 'app-package writes it, and app-dependency a dependency in it. A version is raised by a person, in package.xml, app.json and the manifest together';
  return 'app-package writes it. A version is raised by a person, in package.xml, app.json and the manifest together';
}

// ------------------------------------------------------------------------------- the package

export interface Target {
  readonly directory: string;
  readonly name: string;
  /** As the answers name it: from the repository when inside it. */
  readonly shown: string;
  /** Its path in the generators' tree, from the repository's root. */
  readonly treePath: string;
  readonly exists: boolean;
}

function fromRepository(path: string): string | null {
  const from = relative(REPO_ROOT, path);
  return from === '' || from.startsWith('..') || isAbsolute(from)
    ? null
    : from.split(sep).join('/');
}

/** The package folder a request names, or why it is not one the tools write. */
export function packageFolder(path: string, roots: readonly string[]): Target {
  // A `..` is refused rather than resolved: the file system follows a link before it, and the
  // text does not, so `<root>/link/../x` names one folder to `relative` and another to `lstat`.
  if (path.split(/[\\/]/).some((part) => part === '..' || part === '.'))
    throw new Error(`package: ${path} has a "." or ".." part. Name the package folder itself.`);
  const absolute = resolve(inRepository(path));
  const shownRoots = roots.map((root) => fromRepository(root) ?? root).join(', ');
  for (const root of roots.map((candidate) => resolve(candidate))) {
    const from = relative(root, absolute);
    if (from === '' || from.startsWith('..') || isAbsolute(from) || from.includes(sep)) continue;
    if (!PACKAGE_NAME.test(from))
      throw new Error(
        `package: ${path} is not a package's name: lower-case letters and digits, in parts joined by "-", as app-package names one.`,
      );
    // The root itself, when it is in the repository, is reached through no link and no hidden folder.
    const inside = fromRepository(root);
    if (inside !== null) {
      const reached = within(root, [REPO_ROOT]);
      if (typeof reached !== 'string') throw new Error(`package: ${reached.problem}`);
    }
    const rootEntry = lstatSync(root, { throwIfNoEntry: false });
    if (!rootEntry?.isDirectory())
      throw new Error(`package: the package root ${fromRepository(root) ?? root} is not a folder.`);
    const entry = lstatSync(absolute, { throwIfNoEntry: false });
    if (entry?.isSymbolicLink())
      throw new Error(`package: ${path} is a link, which is not followed. A package is a folder.`);
    if (entry && !entry.isDirectory()) throw new Error(`package: ${path} is not a folder.`);
    if (entry) {
      // Resolved, the folder is the root's own: nothing on the way to it is a link.
      if (realpathSync(absolute) !== join(realpathSync(root), from))
        throw new Error(
          `package: ${path} is reached through a link, which is not followed. A package is a folder of its root.`,
        );
      const link = linkInside(absolute);
      if (link)
        throw new Error(
          `package: ${path} holds a link, ${relative(absolute, link).split(sep).join('/')}, which is not followed. A package holds its files; nothing is written to one that holds a link.`,
        );
    }
    const repositoryPath = fromRepository(absolute);
    return {
      directory: absolute,
      name: from,
      shown: repositoryPath ?? absolute,
      // A package outside the repository is shown to the generators where one would be inside it.
      treePath:
        repositoryPath ?? `${fromRepository(HOST.packageRoot) ?? 'business-apps/packages'}/${from}`,
      exists: entry !== undefined,
    };
  }
  throw new Error(
    `package: ${path} is not a package folder directly inside ${shownRoots}, the folders the` +
      ` write tools are scoped to, such as ${fromRepository(HOST.packageRoot) ?? HOST.packageRoot}/acme-contracts. Nothing outside` +
      ' them is written.',
  );
}

/** Every file of a package, by its path with `/`, but for the pipeline's own `dist/`. */
type Files = ReadonlyMap<string, Buffer>;

/**
 * The package's files. A link, a file with a second name, or anything that is neither a file nor a
 * folder is refused rather than read: the copy holds only what the package holds.
 */
function readFiles(directory: string): Files {
  // The folder itself, before and after: one swapped for a link meanwhile is not read as the
  // package, since what was read could be quoted back.
  const folder = () => {
    const entry = lstatSync(directory);
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error('the package folder is no longer a folder.');
    return realpathSync(directory);
  };
  const real = folder();
  const files = new Map<string, Buffer>();
  let total = 0;
  const walk = (folder: string, prefix: string) => {
    for (const name of readdirSync(folder).sort()) {
      if (prefix === '' && name === 'dist') continue;
      const path = join(folder, name);
      const shown = `${prefix}${name}`;
      const entry = lstatSync(path);
      if (entry.isSymbolicLink())
        throw new Error(`${shown} is a symbolic link, which is not followed.`);
      if (entry.isDirectory()) {
        walk(path, `${shown}/`);
        continue;
      }
      if (!entry.isFile()) throw new Error(`${shown} is neither a file nor a folder.`);
      if (entry.nlink > 1)
        throw new Error(`${shown} has a second name, a hard link, which is not followed.`);
      total += entry.size;
      if (total > MAX_PACKAGE_BYTES)
        throw new Error(`the package holds more than ${MAX_PACKAGE_BYTES} bytes.`);
      files.set(shown, readFileSync(path));
    }
  };
  walk(directory, '');
  if (folder() !== real) throw new Error('the package folder was moved while it was read.');
  return files;
}

function sameFiles(a: Files, b: Files): boolean {
  if (a.size !== b.size) return false;
  for (const [path, data] of a) {
    const other = b.get(path);
    if (!other || !other.equals(data)) return false;
  }
  return true;
}

/**
 * The file a package path names inside `directory`, or an error. `fileKind` has already refused
 * any path that could leave it; this holds every write and removal to it a second time, since a
 * path that left the staging copy would be written outside the package and then missed by the
 * comparison of the copy with the package.
 */
function inside(directory: string, path: string): string {
  const file = resolve(directory, ...path.split('/'));
  const from = relative(directory, file);
  if (from === '' || from.startsWith('..') || isAbsolute(from))
    throw new Error(`${path} is not inside the package.`);
  return file;
}

function writeInto(directory: string, path: string, data: Buffer | string): void {
  const file = inside(directory, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

// ------------------------------------------------------------------------------- a generator

/** A generator's options, checked against its schema, with the package's own put in. */
function generatorOptions(
  generator: AppGenerator,
  given: Readonly<Record<string, unknown>>,
  target: Target,
  staging: string,
  modelRoots: readonly string[],
  work: string,
  shown: Map<string, string>,
): Record<string, unknown> {
  const schema = JSON.parse(
    readFileSync(join(GENERATORS_SOURCE, generator, 'schema.json'), 'utf8'),
  ) as {
    properties: Record<
      string,
      { type?: string; enum?: unknown[]; pattern?: string; default?: unknown }
    >;
    required?: string[];
  };
  const own = generator === 'app-package' ? ['name', 'directory'] : ['package'];
  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(given)) {
    const property = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
    if (property === undefined)
      throw new Error(
        `options.${key}: ${generator} has no such option. It takes ${Object.keys(schema.properties)
          .filter((name) => !own.includes(name) && name !== 'modelServer')
          .join(', ')}.`,
      );
    if (own.includes(key))
      throw new Error(
        `options.${key}: the package argument names the package; leave ${key} out of the options.`,
      );
    if (key === 'modelServer')
      throw new Error(
        `options.modelServer: the write tools read no server: the generator would send NUXEO_USER and NUXEO_PASS to the address it is given. Give the model as a file, the package's own content-model.json or one written by ${HOST.modelExport}.`,
      );
    const type = property.type;
    const fits =
      type === 'string'
        ? typeof value === 'string'
        : type === 'boolean'
          ? typeof value === 'boolean'
          : type === 'integer'
            ? Number.isInteger(value)
            : type === 'number'
              ? typeof value === 'number' && Number.isFinite(value)
              : false;
    if (!fits) throw new Error(`options.${key}: ${generator} takes a ${type ?? 'value'} here.`);
    if (property.enum && !property.enum.includes(value))
      throw new Error(`options.${key}: one of ${property.enum.join(', ')}.`);
    if (
      property.pattern !== undefined &&
      typeof value === 'string' &&
      !new RegExp(property.pattern).test(value)
    )
      throw new Error(
        `options.${key}: ${JSON.stringify(value)} is not of the form ${generator} takes there, ${property.pattern}.`,
      );
    options[key] =
      key === 'model'
        ? modelFile(value as string, target, staging, modelRoots, work, shown)
        : value;
  }
  for (const [key, property] of Object.entries(schema.properties))
    if (options[key] === undefined && property.default !== undefined)
      options[key] = property.default;
  if (generator === 'app-package') {
    options['name'] = target.name;
    options['directory'] = target.treePath.slice(0, target.treePath.lastIndexOf('/'));
  } else options['package'] = target.treePath;
  const missing = (schema.required ?? []).filter((key) => options[key] === undefined);
  if (missing.length > 0) throw new Error(`options: ${generator} needs ${missing.join(', ')}.`);
  return options;
}

/**
 * The content model a generator reads, as a path it can open: the staging copy's, for one inside
 * the package, so that a model an earlier step wrote is the one read; otherwise a JSON file inside
 * the repository or a package root, through no link and no hidden folder, as `validate_package`
 * reads its allow-list. A generator can quote what it read, and that goes to the agent, so the
 * file is read here, opened without following a link, and the generator is given that copy: a
 * link put in its place after the check is not followed. `shown` learns the copy's name, so that
 * messages name the file given.
 */
function modelFile(
  path: string,
  target: Target,
  staging: string,
  roots: readonly string[],
  work: string,
  shown: Map<string, string>,
): string {
  const absolute = inRepository(path);
  const inPackage = relative(target.directory, absolute);
  if (inPackage !== '' && !inPackage.startsWith('..') && !isAbsolute(inPackage)) {
    const parts = inPackage.split(sep);
    if (parts.some((part) => part.startsWith('.')) || !inPackage.endsWith('.json'))
      throw new Error(`options.model: ${path} is not a JSON file of the package.`);
    return join(staging, ...parts);
  }
  const found = within(path, roots);
  if (typeof found !== 'string') throw new Error(`options.model: ${found.problem}`);
  if (!found.endsWith('.json')) throw new Error(`options.model: ${path} is not a JSON file.`);
  let data: Buffer;
  let descriptor: number | null = null;
  try {
    // A file, checked before it is opened: opening a FIFO waits for a writer, and would hold every
    // write. Opened without waiting all the same, and without following a link.
    if (!lstatSync(found).isFile()) throw new Error('not a file');
    descriptor = openSync(
      found,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const entry = fstatSync(descriptor);
    if (!entry.isFile() || entry.nlink > 1 || entry.size > MAX_PACKAGE_BYTES)
      throw new Error('not one file');
    data = readFileSync(descriptor);
  } catch {
    throw new Error(`options.model: ${path} is not a JSON file, or goes through a link.`);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  const copy = join(work, `model-${randomBytes(6).toString('hex')}.json`);
  writeFileSync(copy, data, { flag: 'wx' });
  shown.set(copy, path);
  return copy;
}

/** The generator, run in a process of its own (`run-generator.ts`), with no credential. */
export async function runGenerator(run: GeneratorRun): Promise<GeneratorAnswer> {
  const answer = join(run.work, `answer-${randomBytes(6).toString('hex')}.json`);
  const requestFile = join(run.work, `request-${randomBytes(6).toString('hex')}.json`);
  // The tree's root: the repository's formatting configuration, and nothing else
  // (run-generator.ts says why).
  const treeRoot = mkdtempSync(join(run.work, 'tree-'));
  for (const file of FORMATTING) {
    const from = join(run.request.root, file);
    if (lstatSync(from, { throwIfNoEntry: false })?.isFile())
      writeFileSync(join(treeRoot, file), readFileSync(from));
  }
  const request: GeneratorRequest = { ...run.request, treeRoot, answer };
  writeFileSync(requestFile, JSON.stringify(request));
  const temporary = mkdtempSync(join(run.work, 'tmp-'));
  const result = await runNode(
    [RUNNER, requestFile],
    run.timeoutMs,
    pipelineEnvironment(process.env, temporary),
  );
  const printed = [result.stdout, result.stderr].join('\n');
  let read: GeneratorAnswer | null = null;
  try {
    read = JSON.parse(readFileSync(answer, 'utf8')) as GeneratorAnswer;
  } catch {
    // Said below.
  }
  if (result.failure !== null || read === null)
    throw new Error(
      `${run.generator} did not answer (${result.failure ?? `exit ${result.exitCode}`}):\n${printed.trim()}`,
    );
  return read;
}

/** A generator's changes, each one checked, as the files to write into the staging copy. */
function generatedFiles(
  generator: string,
  changes: readonly GeneratedChange[],
  target: Target,
): { path: string; data: Buffer | null }[] {
  return changes.map((change) => {
    const prefix = `${target.treePath}/`;
    if (typeof change.path !== 'string' || !change.path.startsWith(prefix))
      throw new Error(`${generator} wrote ${String(change.path)}, which is outside the package.`);
    const path = change.path.slice(prefix.length);
    const kind = fileKind(path);
    if (typeof kind !== 'string') throw new Error(`${generator} wrote ${kind.problem}`);
    if (change.type === 'DELETE') return { path, data: null };
    if (
      (change.type !== 'CREATE' && change.type !== 'UPDATE') ||
      typeof change.content !== 'string'
    )
      throw new Error(`${generator} answered a change to ${path} that is not one.`);
    return { path, data: Buffer.from(change.content, 'base64') };
  });
}

// ------------------------------------------------------------------------------- the write

/** One write at a time: two would each be validated against a package the other then changed. */
let writing: Promise<unknown> = Promise.resolve();

export function writePackage(
  request: WriteRequest,
  options: WriteOptions = {},
): Promise<WriteResult> {
  const run = writing.then(() => write(request, options));
  // The caller gets this write's failure through `run`; the chain only waits for it to end, so the
  // next write starts whether this one passed or failed. Nothing is lost here.
  writing = run.catch(() => undefined);
  return run;
}

async function write(request: WriteRequest, options: WriteOptions): Promise<WriteResult> {
  const roots = options.packageRoots ?? [DEFAULT_PACKAGE_ROOT];
  if (request.changes.length === 0) throw new Error('changes: there is nothing to write.');
  if (request.changes.length > MAX_CHANGES)
    throw new Error(`changes: at most ${MAX_CHANGES} in one call.`);
  const target = packageFolder(request.package, roots);
  // Everything that can be judged from the request alone, before anything is copied or run.
  for (const [index, change] of request.changes.entries()) {
    const at = `changes[${index}]`;
    if (change.kind === 'write') {
      const kind = fileKind(change.path);
      if (typeof kind !== 'string') throw new Error(`${at}.path: ${kind.problem}`);
      if (kind === 'generated')
        throw new Error(
          `${at}.path: ${change.path} is written by the generators only: ${writtenBy(change.path)}. Use apply_generator.`,
        );
      if (Buffer.byteLength(change.content) > MAX_FILE_BYTES)
        throw new Error(
          `${at}.content: more than ${MAX_FILE_BYTES} bytes, which the server refuses for a file of the app definition.`,
        );
    } else if (change.kind === 'remove') {
      const kind = fileKind(change.path);
      if (typeof kind !== 'string') throw new Error(`${at}.path: ${kind.problem}`);
      if (kind === 'generated')
        throw new Error(
          `${at}.path: ${change.path} is written by the generators only, and taken out by them: ${writtenBy(change.path)}.`,
        );
      if (kind === 'layer')
        throw new Error(
          `${at}.path: ${change.path} is a layer of the package's configuration, which its component names: write it whole instead, with what it should hold.`,
        );
      if (change.path === `${CONFIG}/app.json`)
        throw new Error(
          `${at}.path: ${change.path} is the app itself: a package without it is no app definition, and is refused. Remove the package's folder by hand, if that is what the person asks.`,
        );
    } else if (!(APP_GENERATORS as readonly string[]).includes(change.generator))
      throw new Error(
        `${at}.generator: ${change.generator} is not one the write tools run. They run ${APP_GENERATORS.join(', ')}.`,
      );
  }
  const first = request.changes[0];
  if (!target.exists && !(first.kind === 'generator' && first.generator === 'app-package'))
    throw new Error(
      `package: ${target.shown} does not exist. A new package starts with apply_generator's app-package.`,
    );

  const work = mkdtempSync(join(options.workIn ?? tmpdir(), 'builder-mcp-write-'));
  try {
    const stagingRoot = join(work, 'staging');
    const staging = join(stagingRoot, target.name);
    mkdirSync(stagingRoot);
    let before: Files;
    try {
      before = target.exists ? readFiles(target.directory) : new Map();
    } catch (error) {
      throw new Error(`package: ${target.shown}: ${(error as Error).message}`);
    }
    if (target.exists) mkdirSync(staging);
    for (const [path, data] of before) writeInto(staging, path, data);
    // A file the package holds, named in another case: on a file system that ignores case it is
    // that file, and the write would land on it under a name it was not given.
    const held = new Set<string>();
    for (const name of before.keys()) for (const prefix of prefixesOf(name)) held.add(prefix);
    for (const [index, change] of request.changes.entries()) {
      if (change.kind === 'generator') continue;
      for (const prefix of prefixesOf(change.path)) {
        const other = sameButCase(prefix, held);
        if (other !== undefined)
          throw new Error(
            `changes[${index}].path: ${prefix} differs only in case from ${other}, which the package holds. Write it as ${other}. Nothing was written.`,
          );
      }
    }

    const said: string[] = [];
    /** Each path of the write's own, and the name the answer gives it instead. */
    const shown = new Map<string, string>();
    const shownPaths = (text: string) => {
      let said = text;
      for (const [path, as] of shown) said = said.split(path).join(as);
      return said.split(staging).join(target.shown).split(work).join('<temporary>');
    };
    /** A change that cannot be made to the staging copy, said of the package. */
    const unmade = (index: number, error: unknown) =>
      new Error(`changes[${index}]: ${shownPaths((error as Error).message)} Nothing was written.`);
    for (const [index, change] of request.changes.entries()) {
      if (change.kind === 'write') {
        try {
          writeInto(staging, change.path, change.content);
        } catch (error) {
          throw unmade(index, error);
        }
        continue;
      }
      if (change.kind === 'remove') {
        // A file the package holds, or an earlier change of the same call wrote: never a folder.
        const file = inside(staging, change.path);
        if (!lstatSync(file, { throwIfNoEntry: false })?.isFile())
          throw new Error(
            `changes[${index}].path: ${change.path} is not a file of ${target.shown}, as the earlier changes of this call left it. Nothing was written.`,
          );
        rmSync(file);
        continue;
      }
      const generator = change.generator as AppGenerator;
      // A stand-in model is a demo kit's only: one made in this call, or one that ships its own
      // content-model.json already, which only app-model writes. A package on a customer's model
      // gets no types, schemas or page providers of its own, which installed would replace the
      // server's, and would then hold it to a model the agent wrote.
      if (
        generator === 'app-model' &&
        target.exists &&
        !lstatSync(join(staging, OWN_MODEL), { throwIfNoEntry: false })?.isFile()
      )
        throw new Error(
          `changes[${index}].generator: app-model is for a demo kit only, and ${target.shown} ships no stand-in model (no ${OWN_MODEL}): its types are the server's, which a package does not write. Nothing was written.`,
        );
      let given: Record<string, unknown>;
      try {
        given = generatorOptions(
          generator,
          change.options ?? {},
          target,
          staging,
          options.modelRoots ?? [REPO_ROOT, ...roots],
          work,
          shown,
        );
      } catch (error) {
        throw new Error(`changes[${index}].${(error as Error).message}`);
      }
      const answer = await (options.generate ?? runGenerator)({
        generator,
        request: {
          generator,
          factory: join(GENERATORS_SOURCE, generator, 'generator.ts'),
          options: given,
          root: HOST.generatorRoot,
          packagePath: target.treePath,
          staging,
        },
        work,
        timeoutMs: options.timeoutMs ?? GENERATOR_TIMEOUT_MS,
      });
      const printed = answer.said.map((line) => shownPaths(withoutColour(line)));
      if ('error' in answer)
        throw new Error(
          `changes[${index}]: ${generator} refused: ${shownPaths(answer.error)}${
            printed.length ? `\n${printed.join('\n')}` : ''
          }\nNothing was written.`,
        );
      said.push(...printed);
      try {
        for (const file of generatedFiles(generator, answer.changes, target)) {
          if (file.data === null) rmSync(inside(staging, file.path), { force: true });
          else writeInto(staging, file.path, file.data);
        }
      } catch (error) {
        throw unmade(index, error);
      }
    }

    const after = readFiles(staging);
    const changes = differences(before, after);
    if (changes.length === 0)
      return {
        package: target.shown,
        written: false,
        changes,
        validation: null,
        generatorOutput: said,
        note: 'Nothing to write: the package already holds exactly this.',
      };
    // Checked again on what the changes came to: what a generator wrote is held to the same rules.
    for (const { path } of changes) {
      const kind = fileKind(path);
      if (typeof kind !== 'string') throw new Error(`${kind.problem} Nothing was written.`);
    }
    // Two names of one file or folder where case is ignored, as the package's volume may ignore it
    // though the staging copy's does not: what was validated as two would be written as one.
    const names = new Set<string>();
    for (const name of [...before.keys(), ...after.keys()])
      for (const prefix of prefixesOf(name)) names.add(prefix);
    for (const { path } of changes)
      for (const prefix of prefixesOf(path)) {
        const other = sameButCase(prefix, names);
        if (other !== undefined)
          throw new Error(
            `${prefix} and ${other} differ only in case, and are one where case is ignored. Nothing was written.`,
          );
      }
    // A layer the component does not name as its fragment: step 2 would not check it, nor the
    // server serve it, so a write to it would be kept unchecked and change nothing.
    for (const { path, change } of changes) {
      if (change === 'removed' || fileKind(path) !== 'layer') continue;
      const layer = LAYER_FILES[path.slice(CONFIG.length + 1)];
      if (!namesFragment(after, path.slice('bundle/'.length), layer))
        throw new Error(
          `${path} is named by no component of the package as its ${layer} fragment, <fragment layer="${layer}" src="${path.slice('bundle/'.length)}">, so no step would check it and the server would not serve it. Nothing was written.`,
        );
    }
    const versionOne = changes.filter(
      ({ path, change }) => change !== 'removed' && !isVersionTwo(after.get(path), path),
    );
    if (versionOne.length > 0)
      throw new Error(
        `${versionOne.map(({ path }) => path).join(', ')} ${versionOne.length === 1 ? 'is' : 'are'} not a JSON object of "version": 2. The validator does not check a file of version 1, so a write to one could not be validated; nothing was written.`,
      );

    const check = shownCheck(
      await (options.validate ?? defaultValidate(options.timeoutMs))(
        staging,
        [stagingRoot],
        work,
        options.kits === undefined ? dirname(target.directory) : options.kits,
      ),
      target.shown,
      shownPaths,
    );
    if (!check.passed || check.findings.length > 0)
      return {
        package: target.shown,
        written: false,
        changes,
        validation: check,
        generatorOutput: said,
        note:
          'Refused: the package would not pass the pipeline, so nothing was written, and the' +
          ' package is as it was. Fix what the findings and the refusing step name, and write again.',
      };

    options.beforeCommit?.();
    // What was validated is what is written: a package that changed meanwhile is not written.
    let again: Target;
    try {
      again = packageFolder(request.package, roots);
    } catch (error) {
      throw new Error(`${(error as Error).message} Nothing was written.`);
    }
    const changedMeanwhile: WriteResult = {
      package: target.shown,
      written: false,
      changes,
      validation: check,
      generatorOutput: said,
      note:
        'Not written: the package changed while the changes were being checked, so what passed' +
        ' is not what would be written. Nothing was written; read it again and write again.',
    };
    if (again.exists !== target.exists) return changedMeanwhile;
    // A new package's folder is made only when there is none, so a second write making the same
    // package at once finds it there, and is refused.
    let madePackage = false;
    if (!target.exists) {
      try {
        mkdirSync(target.directory);
        madePackage = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return changedMeanwhile;
        throw error;
      }
    }
    // One commit to a package at a time, across processes too, such as two servers on one
    // checkout: the lock is taken before the package is read again, and held until every file is
    // in place, so that a second commit reads the first one's result, and refuses it as a change.
    let lock: PackageLock;
    try {
      lock = lockPackage(target);
    } catch (error) {
      if (madePackage) removeIfEmpty(target.directory);
      throw error;
    }
    const left: string[] = [];
    let committed = false;
    try {
      let now: Files;
      try {
        now = readFiles(target.directory);
      } catch (error) {
        throw new Error(
          `package: ${target.shown}: ${(error as Error).message} Nothing was written.`,
        );
      }
      if (!sameFiles(before, now)) return changedMeanwhile;
      left.push(...commit(target, changes, after, before, options.beforeMove, lock.dist));
      committed = true;
    } finally {
      const unreleased = lock.release();
      if (unreleased !== null) left.push(unreleased);
      if (madePackage && !committed) removeIfEmpty(target.directory);
    }
    const warnings = schemaHeadingWarnings((path) => after.get(path)?.toString('utf8'));
    return {
      package: target.shown,
      written: true,
      changes,
      validation: check,
      generatorOutput: said,
      ...(warnings.length > 0 ? { warnings } : {}),
      note:
        `Written: ${changes.length} ${changes.length === 1 ? 'file' : 'files'}, after the pipeline's` +
        " steps 1 to 6 passed on the package as it now is, as CI runs them on the package's files" +
        " (CI's checkout holds only those committed). Nothing was published." +
        (left.length > 0 ? ` Left behind, to remove by hand: ${left.join('; ')}.` : ''),
    };
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      // The write's own temporary folder, in the system's: what it holds was never the package's,
      // and the answer, written or not, stands without it.
    }
  }
}

/** Removes a folder the write made, when nothing else is in it. */
function removeIfEmpty(folder: string): void {
  try {
    rmdirSync(folder);
  } catch {
    // Not empty, or gone: either way nothing of the write's is left in it.
  }
}

function defaultValidate(timeoutMs: number | undefined): NonNullable<WriteOptions['validate']> {
  return (directory, roots, workIn, kits) =>
    validatePackage({ directory }, { roots, workIn, timeoutMs, kits: kits ?? undefined });
}

function differences(before: Files, after: Files): FileChange[] {
  const changes: FileChange[] = [];
  for (const [path, data] of after) {
    const was = before.get(path);
    if (!was) changes.push({ path, change: 'created' });
    else if (!was.equals(data)) changes.push({ path, change: 'updated' });
  }
  for (const path of before.keys()) if (!after.has(path)) changes.push({ path, change: 'removed' });
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Whether a component of the package, a `bundle/OSGI-INF/*.xml` of `files`, names `src` as the
 * body of a fragment of `layer`, enabled, as `configuration.mjs` reads one for step 2.
 */
function namesFragment(files: Files, src: string, layer: string): boolean {
  for (const [path, data] of files) {
    if (!/^bundle\/OSGI-INF\/[^/]+\.xml$/.test(path)) continue;
    const xml = withoutComments(data.toString('utf8'));
    for (const match of xml.matchAll(/<fragment\b([^>]*)>/g)) {
      const attributes = new Map(
        [...match[1].matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)].map(
          (pair) => [pair[1], pair[3] ?? pair[4] ?? ''],
        ),
      );
      const enabled = attributes.get('enabled');
      if (
        attributes.get('layer') === layer &&
        attributes.get('src') === src &&
        (enabled === undefined || enabled.toLowerCase() === 'true')
      )
        return true;
    }
  }
  return false;
}

/**
 * `xml` without its comments, each skipped whole from its `<!--` to the first `-->` after it, and an
 * unclosed one to the end: a scan rather than a replace, which could leave a `<!--` that two
 * comments' halves make.
 */
function withoutComments(xml: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = xml.indexOf('<!--', at);
    if (open < 0) return out + xml.slice(at);
    out += xml.slice(at, open);
    const close = xml.indexOf('-->', open + 4);
    if (close < 0) return out;
    at = close + 3;
  }
}

/** A file of the app definition is a JSON object of version 2; any other file is not held to it. */
function isVersionTwo(data: Buffer | undefined, path: string): boolean {
  if (fileKind(path) !== 'definition') return true;
  try {
    const text = (data ?? Buffer.alloc(0)).toString('utf8').replace(/^\uFEFF/, '');
    const value: unknown = JSON.parse(text);
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as { version?: unknown }).version === 2
    );
  } catch {
    // Not JSON: the validator refuses it, naming why.
    return true;
  }
}

/** The pipeline's answer, naming the package rather than its staging copy. */
function shownCheck(
  check: PackageCheck,
  shown: string,
  shownPaths: (text: string) => string,
): PackageCheck {
  return {
    ...check,
    package: shown,
    stdout: check.stdout.map(shownPaths),
    stderr: check.stderr.map(shownPaths),
    refusedAt: check.refusedAt && {
      ...check.refusedAt,
      reason: shownPaths(check.refusedAt.reason),
    },
    findings: check.findings.map((finding) => ({ ...finding, file: shownPaths(finding.file) })),
    note: check.passed
      ? "The pipeline's steps 1 to 6 passed on the staging copy, as CI runs them."
      : check.note,
  };
}

function withoutColour(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** Each folder a path goes through, and the path: `a`, `a/b`, `a/b/c.json`. */
function prefixesOf(path: string): string[] {
  const parts = path.split('/');
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/** The first of `names` that is `path` but for case, or `undefined`. */
function sameButCase(path: string, names: Iterable<string>): string | undefined {
  const folded = path.toLowerCase();
  for (const name of names) if (name !== path && name.toLowerCase() === folded) return name;
  return undefined;
}

// ------------------------------------------------------------------------------- the commit

/** The lock's name, in the package's `dist/`. */
const LOCK = 'builder-mcp-write.lock';

interface PackageLock {
  readonly dist: string;
  /** Lets the lock go; what could not be removed, or `null`. Never throws. */
  release(): string | null;
}

/**
 * The package's write lock, taken, in the package's `dist/`, which is made when there is none and
 * removed with the lock:
 *
 * - **Made whole or not at all.** This process's id goes into a file of the write's own first,
 *   which is then linked to the lock's name: a link is made only when the name is free, and the
 *   lock it makes already holds the id, so no other process reads it empty.
 * - **One a running process holds refuses this write.** One whose holder is no longer running is
 *   moved aside under a name of this write's own, and taken over only when what was moved holds
 *   the id that was judged: had another process taken it over in between, its lock is linked back
 *   and this write refused. Three writes at once on one stale lock could still both pass, in the
 *   moment between moving a live lock aside and linking it back.
 */
function lockPackage(target: Target): PackageLock {
  const dist = join(target.directory, 'dist');
  const entry = lstatSync(dist, { throwIfNoEntry: false });
  if (entry && (entry.isSymbolicLink() || !entry.isDirectory()))
    throw new Error(
      `${target.shown}/dist is not a folder, and the write works in it. Nothing was written.`,
    );
  const made = entry === undefined;
  if (made) mkdirSync(dist);
  const lock = join(dist, LOCK);
  const own = (what: string) => join(dist, `${LOCK}.${what}-${randomBytes(6).toString('hex')}`);
  const mine = own(String(process.pid));
  const held = (holder: number | null) =>
    new Error(
      `another write to ${target.shown} is being committed, by process ${holder ?? 'unknown'}.` +
        ` Nothing was written; write again once it is done. If no write is running, remove` +
        ` ${target.shown}/dist/${LOCK}.`,
    );
  const removeDist = () => {
    if (made) removeIfEmpty(dist);
  };
  try {
    writeFileSync(mine, `${process.pid}\n`, { flag: 'wx' });
    try {
      linkSync(mine, lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = pidIn(lock);
      if (holder === null || running(holder)) throw held(holder);
      const aside = own('stale');
      try {
        renameSync(lock, aside);
      } catch {
        // Moved by another write first: that one is taking it over.
        throw held(null);
      }
      const moved = pidIn(aside);
      if (moved !== holder) {
        try {
          linkSync(aside, lock);
        } catch {
          // Taken again already: the lock is that write's.
        }
        rmSync(aside, { force: true });
        throw held(moved);
      }
      rmSync(aside, { force: true });
      try {
        linkSync(mine, lock);
      } catch {
        throw held(pidIn(lock));
      }
    }
  } catch (error) {
    rmSync(mine, { force: true });
    removeDist();
    throw error;
  }
  // The lock has one name again: a second would read as a hard link to every check that walks the
  // package.
  rmSync(mine, { force: true });
  return {
    dist,
    release: () => {
      try {
        if (pidIn(lock) === process.pid) rmSync(lock, { force: true });
        removeDist();
        return null;
      } catch (error) {
        return `${target.shown}/dist/${LOCK} (${(error as Error).message})`;
      }
    },
  };
}

/** The process id a lock holds, or `null` when it holds none or cannot be read. */
function pidIn(file: string): number | null {
  try {
    const pid = Number(readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    // Gone or unreadable: it names no holder.
    return null;
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface Moved {
  readonly change: FileChange;
  readonly file: string;
  /** The mode the file had, when it had one. */
  readonly mode: number | undefined;
}

/**
 * The changes, into the package. Each new file is written first into a folder of the write's own
 * inside the package's `dist/`, which is on the package's volume and which git and the builder
 * leave out; then each is renamed into its place, which replaces a file whole and keeps its mode.
 * Before each move, the folder it goes to is found to be where it was, through no link. Should a
 * move fail, every file already moved is put back as it was, and every folder made is removed, so
 * that the package is left as it was. A process killed outright part way cannot do that.
 *
 * `dist` is the package's `dist/`, where the lock is. The answer is what was left behind once the
 * package holds the changes, such as a scratch folder that could not be removed; a failure part
 * way throws.
 */
function commit(
  target: Target,
  changes: readonly FileChange[],
  after: Files,
  before: Files,
  beforeMove: WriteOptions['beforeMove'],
  dist: string,
): string[] {
  const made: string[] = [];
  const makeFolder = (folder: string) => {
    mkdirSync(folder);
    made.push(folder);
  };
  const moved: Moved[] = [];
  let scratch: string | null = null;
  let failure: unknown = null;
  try {
    const into = mkdtempSync(join(dist, 'builder-mcp-commit-'));
    scratch = into;
    const real = realpathSync(target.directory);
    const prepared = changes.map((change, index) => {
      if (change.change === 'removed') return null;
      const file = join(into, String(index));
      writeFileSync(file, after.get(change.path) as Buffer, { flag: 'wx' });
      return file;
    });
    for (const [index, change] of changes.entries()) {
      beforeMove?.(change.path, index);
      const { file, mode } = placeOf(target.directory, real, change.path, makeFolder);
      if (change.change === 'removed') unlinkSync(file);
      else {
        if (mode !== undefined) chmodSync(prepared[index] as string, mode);
        renameSync(prepared[index] as string, file);
      }
      moved.push({ change, file, mode });
    }
  } catch (error) {
    failure = error;
  }
  const unrestored = failure === null || scratch === null ? [] : putBack(moved, before, scratch);
  const left: string[] = [];
  if (scratch !== null) {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch (error) {
      left.push(`${relative(target.directory, scratch)} (${(error as Error).message})`);
    }
  }
  // On a failure, every folder the moves made, deepest first, when it is empty again.
  if (failure !== null) for (const folder of made.reverse()) removeIfEmpty(folder);
  if (failure !== null)
    throw new Error(
      `Writing ${target.shown} failed part way (${(failure as Error).message}). ` +
        (unrestored.length === 0
          ? 'Every file already written was put back, so the package is as it was.'
          : `These could not be put back, and must be restored by hand, from version control where the package is in it: ${unrestored.join(', ')}.`),
    );
  return left;
}

/**
 * The file a change goes to, and the mode it has, making the folders it needs: each part of the
 * way is a folder, not a link, as it was when the package was read, and the folder the file goes
 * in is, resolved, where the package's real path says it is.
 */
function placeOf(
  directory: string,
  real: string,
  path: string,
  makeFolder: (folder: string) => void,
): { readonly file: string; readonly mode: number | undefined } {
  inside(directory, path);
  const parts = path.split('/');
  let current = directory;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (!entry) makeFolder(current);
    else if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error(`${path} goes through ${part}, which is not a folder`);
  }
  if (realpathSync(current) !== join(real, ...parts.slice(0, -1)))
    throw new Error(`${path} no longer leads into the package: a folder on its way was replaced`);
  const file = join(current, parts[parts.length - 1]);
  const entry = lstatSync(file, { throwIfNoEntry: false });
  if (entry && (entry.isSymbolicLink() || !entry.isFile() || entry.nlink > 1))
    throw new Error(`${path} is no longer a plain file`);
  return { file, mode: entry === undefined ? undefined : entry.mode & 0o7777 };
}

/** Puts back each file already moved, as it was, with its mode; the paths that could not be. */
function putBack(moved: readonly Moved[], before: Files, scratch: string): string[] {
  const unrestored: string[] = [];
  for (const [index, { change, file, mode }] of [...moved].reverse().entries()) {
    try {
      const was = before.get(change.path);
      if (was === undefined) unlinkSync(file);
      else {
        const back = join(scratch, `back-${index}`);
        writeFileSync(back, was, { flag: 'wx' });
        if (mode !== undefined) chmodSync(back, mode);
        renameSync(back, file);
      }
    } catch {
      unrestored.push(change.path);
    }
  }
  return unrestored;
}
