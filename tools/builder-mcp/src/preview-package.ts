/**
 * `preview_package`: a package shown by the development server, in dev mode (phase 3 of
 * docs/business-apps/development-plan.md).
 *
 * 1. **Validated first.** The package pipeline runs on it as `validate_package` runs it. A package
 *    it refuses is not served, and the dev folder is left as it was.
 * 2. **Served through `config:dev`.** `scripts/dev-config.mjs`, the script `npm run config:dev`
 *    runs, is run with Node, as npm would run it, and given every file of the app definition the dev
 *    server can serve: its layouts, home, menu, queues, labels and task forms. It writes them into
 *    the gitignored `apps/nuxeo-ui/public/agentic-ui-config/`, where the dev server answers as the
 *    configuration servlet would, and removes what it served before. Each file the package holds
 *    that it cannot serve is named, with the reason.
 * 3. **Checked in the dev server.** Each file the dev folder holds is asked of the dev server and
 *    compared byte for byte, and each it removed is asked for again, and named when it is still
 *    answered as it was. The dev
 *    server's watcher takes a moment to see a new file, so it is given a few seconds; a file still
 *    not answered then is named, with a restart as the fix.
 * 4. **The addresses to open:** the home, each queue, the tasks page. A record page opens on a
 *    record of its type, which the tool does not look up: it reads no record.
 * 5. **A demo kit's stand-in:** a package with a stand-in model (`content-model.json`) has types no
 *    server holds, so the dev server alone shows its shell. `scripts/kit-stand-in.mjs --check`, the
 *    script `npm run kit:stand-in` runs,
 *    is run with Node as `config:dev` is, and says whether it reads the kit's data and what it
 *    answers; the answer gives the commands that show the kit's pages with no server holding it.
 *    The check reads the kit's files only: it starts no server and sends nothing.
 *
 * What it writes, and nothing else: the dev folder, through the script; and, inside the package's
 * `dist/`, a folder of its own for the pipeline's zip and what it unpacks, removed afterwards with
 * `dist/` itself when it made it. No credential: the pipeline and the script get only what finds
 * programs, a temporary folder (the pipeline's, inside that one) and the locale from the
 * environment. What it sends: `GET`s to the dev
 * server, on this machine, for the files of the dev folder, with no credential.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  REPO_ROOT,
  linkInside,
  pipelineEnvironment,
  runNode,
  validatePackage,
  within,
  type PackageCheck,
  type PackageRequest,
} from './validate-package.ts';
import { HOST } from './host.ts';

/** What `npm run config:dev` runs, and the folder it writes. */
export const DEV_CONFIG_SCRIPT = join(REPO_ROOT, 'scripts', 'dev-config.mjs');
export const DEV_FOLDER = join(REPO_ROOT, 'apps', 'nuxeo-ui', 'public', 'agentic-ui-config');
/** What `npm run kit:stand-in` runs, and the port it listens on by default. */
export const STAND_IN_SCRIPT = join(REPO_ROOT, 'scripts', 'kit-stand-in.mjs');
const STAND_IN_ORIGIN = 'http://localhost:8091';
const STAND_IN_TIMEOUT_MS = 30_000;
const DEV_CONFIG_TIMEOUT_MS = 60_000;
const DEV_SERVER_TIMEOUT_MS = 5_000;
/** How long the dev server's watcher is given to see what the script wrote, and how often it is asked. */
const DEV_SERVER_WAIT_MS = 5_000;
const DEV_SERVER_POLL_MS = 250;
/** Where the app definition sits in a configuration package. */
const ROOT = join('bundle', 'agentic-ui-config');

export interface PreviewOptions {
  /** The folders a package may be in. Default: the repository. */
  readonly roots?: readonly string[];
  readonly timeoutMs?: number;
  /** The script that serves the files, and the folder it writes. Default: config:dev's. */
  readonly devConfig?: { readonly script: string; readonly folder: string };
  /** The dev server's origin, such as `http://localhost:4200`, or why there is none to ask. */
  readonly devServer: string | { readonly problem: string };
  /** How long the dev server is given to answer what was written. Default: 5 seconds. */
  readonly devServerWaitMs?: number;
  /** The stand-in script asked what it reads of a demo kit. Default: `npm run kit:stand-in`'s. */
  readonly standInScript?: string;
}

/**
 * How to see a demo kit's pages with no server holding it: `npm run kit:stand-in`, a local
 * stand-in in front of the Nuxeo the dev server proxies, answering the kit's types, its records,
 * read-only, and its page providers from its own files.
 */
export interface StandIn {
  /** Whether the stand-in reads this kit's demo data: it knows the shape of some kits' only. */
  readonly reads: boolean;
  /** What to run, in order, when it does: the stand-in, then the dev server pointed at it. */
  readonly commands: readonly string[];
  /** The kit's page providers it answers from its demo data's `EXPECTED`. */
  readonly answers: readonly string[];
  /** Those it answers HTTP 501, saying so, since `EXPECTED` does not list them. */
  readonly notAnswered: readonly string[];
  /** A record page to open for each of the kit's types with records, on the dev server. */
  readonly records: readonly Page[];
  readonly note: string;
}

export interface ServedFile {
  /** The package's file, relative to `bundle/agentic-ui-config/`. */
  readonly file: string;
  /** Where the dev server answers it, under `/agentic-ui-config/`. */
  readonly servedAt: string;
  readonly what: string;
}

export interface NotServed {
  readonly file: string;
  readonly why: string;
}

export interface Page {
  readonly what: string;
  /** The address to open, when the tool can name it. */
  readonly url: string | null;
  readonly how: string;
}

export interface DevServerCheck {
  readonly origin: string;
  /** Whether the dev server answered at all. */
  readonly answering: boolean;
  /** Files of the dev folder the dev server does not answer as they are now. */
  readonly stale: readonly string[];
  /** Files removed from the dev folder that the dev server still answers as they were. */
  readonly stillServed: readonly string[];
  readonly note: string;
}

export interface Preview {
  readonly package: string;
  readonly served: boolean;
  readonly validation: PackageCheck;
  readonly files: readonly ServedFile[];
  readonly notServed: readonly NotServed[];
  readonly devFolder: string;
  readonly command: string | null;
  readonly output: readonly string[];
  readonly devServer: DevServerCheck | null;
  /**
   * The address to open first: the home, else the first queue, else the tasks page when there are
   * task forms, else the app's own first page.
   */
  readonly open: string | null;
  readonly pages: readonly Page[];
  /**
   * For a demo kit, a package with a `content-model.json`: how to see its pages with the stand-in,
   * or why it cannot. `null` for another package, whose types a server holds, and when not served.
   */
  readonly standIn: StandIn | null;
  readonly note: string;
}

/** One preview at a time: two runs of the script at once would each remove what the other wrote. */
let previous: Promise<unknown> = Promise.resolve();

export function previewPackage(request: PackageRequest, options: PreviewOptions): Promise<Preview> {
  const run = previous.then(() => preview(request, options));
  // The caller gets this run's failure through `run`; the chain only waits for it to end, so the
  // next preview starts whether this one passed or failed.
  previous = run.catch(() => undefined);
  return run;
}

async function preview(request: PackageRequest, options: PreviewOptions): Promise<Preview> {
  // Bundled into @nuxeo/satori-cli there is no development server of Nuxeo Satori UI's to serve
  // to, and no config:dev: a preview against the customer's own development server is not built.
  if (HOST.kind !== 'repository')
    throw new Error(
      "preview_package serves a package to Nuxeo Satori UI's development server, from a checkout of" +
        ' its repository, and does not run from @nuxeo/satori-cli: nothing was served. Check the' +
        ' package with validate_package; a preview against your own development server is not' +
        ' built yet.',
    );
  const roots = options.roots ?? [REPO_ROOT];
  const { script, folder } = options.devConfig ?? { script: DEV_CONFIG_SCRIPT, folder: DEV_FOLDER };
  // Refused before anything runs: a preview whose addresses cannot be checked or named is not one.
  if (typeof options.devServer !== 'string') throw new Error(options.devServer.problem);
  const origin = options.devServer;

  const found = within(request.directory, roots);
  if (typeof found !== 'string') throw new Error(`directory: ${found.problem}`);
  const directory = found;
  if (!lstatSync(directory).isDirectory())
    throw new Error(`directory: ${request.directory} is not a folder.`);
  const link = linkInside(directory);
  if (link)
    throw new Error(
      `directory: ${request.directory} holds a link, ${relative(directory, link)}, which is not` +
        ' followed. A package holds its files.',
    );
  const root = join(directory, ROOT);
  if (!existsSync(root) || !lstatSync(root).isDirectory())
    throw new Error(`directory: ${request.directory} has no ${ROOT.split(sep).join('/')}/.`);

  // What was validated is what is served: the files are read before the pipeline and again after
  // the script, and a change between the two is refused.
  const before = fingerprint(root);
  const validation = await validateInPackage(request, directory, roots, options.timeoutMs);
  const shown = validation.package;
  const devFolder = shownFromRepository(folder);
  if (!validation.passed)
    return {
      package: shown,
      served: false,
      validation,
      files: [],
      notServed: [],
      devFolder,
      command: null,
      output: [],
      devServer: null,
      open: null,
      pages: [],
      standIn: null,
      note:
        'Not served: the package pipeline refused it, so the dev folder is as it was. Fix what' +
        ' validation names, then preview again.',
    };

  const { files, notServed, flags } = place(root);
  const servedBefore = readFolder(folder);
  const command = ['node', shownFromRepository(script), ...flags.map(shownFlag)].join(' ');
  const result = await runNode(
    [script, ...flags],
    DEV_CONFIG_TIMEOUT_MS,
    pipelineEnvironment(process.env),
  );
  const output = [...lines(result.stdout), ...lines(result.stderr)];
  if (result.failure !== null || result.exitCode !== 0) {
    const reset = await clear(script);
    throw new Error(
      `config:dev did not serve ${shown} (${result.failure ?? `exit ${result.exitCode}`}):\n` +
        `${output.join('\n')}\n${reset}`,
    );
  }
  if (fingerprint(root) !== before) {
    const reset = await clear(script);
    throw new Error(
      `${shown} changed while it was being previewed, so what was served is not what was` +
        ` validated. ${reset} Preview it again once nothing is writing to it.`,
    );
  }

  const devServer = await askDevServer(
    origin,
    folder,
    servedBefore,
    options.devServerWaitMs ?? DEV_SERVER_WAIT_MS,
  );
  const pages = pagesOf(origin, files);
  const standIn = await standInFor(directory, origin, options.standInScript ?? STAND_IN_SCRIPT);
  return {
    package: shown,
    served: true,
    validation,
    files,
    notServed,
    devFolder,
    command,
    output,
    devServer,
    open: pages.find((page) => page.url !== null)?.url ?? `${origin}/`,
    pages,
    standIn,
    note:
      `Served to the dev server from ${devFolder}, replacing what it served before.` +
      ` ${devServer.note} The app asks you to sign in to the Nuxeo server the dev server proxies` +
      ' to, and draws what that server holds: the records, page providers and workflows the' +
      ' package names must be there. Each preview replaces the last; npm run config:dev with no' +
      " option serves the platform's defaults alone again.",
  };
}

/**
 * The pipeline, as `validate_package` runs it, working inside the package's `dist/` rather than
 * the system's temporary folder, so that nothing is written outside the package and the dev
 * folder. `dist/` is the pipeline's own output folder, which a package's `.gitignore` keeps out of
 * version control; made here, it is removed here.
 */
async function validateInPackage(
  request: PackageRequest,
  directory: string,
  roots: readonly string[],
  timeoutMs: number | undefined,
): Promise<PackageCheck> {
  const dist = join(directory, 'dist');
  const entry = lstatSync(dist, { throwIfNoEntry: false });
  if (entry && !entry.isDirectory())
    throw new Error(
      `directory: ${request.directory}/dist is not a folder, and the check works in it.`,
    );
  const made = entry === undefined;
  if (made) mkdirSync(dist);
  try {
    return await validatePackage(request, { roots, timeoutMs, workIn: dist });
  } finally {
    if (made) {
      try {
        rmdirSync(dist);
      } catch {
        // Something else wrote there meanwhile; it is left as it is.
      }
    }
  }
}

interface Placed {
  readonly files: ServedFile[];
  readonly notServed: NotServed[];
  readonly flags: string[];
}

/** Each file of the app definition: the option that serves it, or why none does. */
function place(root: string): Placed {
  const files: ServedFile[] = [];
  const notServed: NotServed[] = [];
  const flags: string[] = [];
  const serve = (file: string, flag: string, value: string, servedAt: string, what: string) => {
    flags.push(flag, value);
    files.push({ file, servedAt, what });
  };
  // A name the validator accepts and config:dev does not would stop the script whole; such a file
  // is named, not passed.
  const refuse = (file: string, why: string) => notServed.push({ file, why });
  for (const file of filesUnder(root)) {
    const path = join(root, ...file.split('/'));
    let match: RegExpExecArray | null;
    if ((match = /^layouts\/([^/]+)\/([^/]+)\.layout\.json$/.exec(file))) {
      if (!SERVED.layoutType.test(match[1]) || !SERVED.layoutMode.test(match[2]))
        refuse(file, 'config:dev serves a layout only for a type and a mode the server accepts.');
      else
        serve(
          file,
          '--layout',
          `${match[1]}/${match[2]}=${path}`,
          `layouts/${match[1]}/${match[2]}.layout.json`,
          `the ${match[2]} layout of ${match[1]} records, listed in layouts.json`,
        );
    } else if (file === 'home.json') serve(file, '--home', path, file, "the app's home, at /home");
    else if (file === 'navigation.json') serve(file, '--navigation', path, file, "the app's menu");
    else if ((match = /^queues\/([^/]+)\.json$/.exec(file))) {
      if (!SERVED.queue.test(match[1]))
        refuse(
          file,
          'config:dev serves a queue only under an id of 1 to 64 letters, digits, ".", "_" or "-".',
        );
      else serve(file, '--queue', path, file, `the queue ${match[1]}, at /queues/${match[1]}`);
    } else if ((match = /^labels\/([^/]+)\.json$/.exec(file))) {
      if (!SERVED.language.test(match[1]))
        refuse(
          file,
          `config:dev serves labels for a language named as the platform's catalogues are, such as` +
            ` en or pt-BR, and ${match[1]} is not one, so the app would never ask for them.`,
        );
      else serve(file, '--labels', `${match[1]}=${path}`, file, `the labels in ${match[1]}`);
    } else if ((match = /^tasks\/([^/]+)\.layout\.json$/.exec(file))) {
      if (!SERVED.task.test(match[1]))
        refuse(
          file,
          'config:dev serves a task form only as <workflow>.<step>, each a letter then letters,' +
            ' digits, "_" or "-".',
        );
      else
        serve(
          file,
          '--task',
          `${match[1]}=${path}`,
          file,
          `the task form of the workflow step ${match[1]}`,
        );
    } else notServed.push({ file, why: whyNotServed(file) });
  }
  return { files, notServed, flags };
}

/**
 * The names `scripts/dev-config.mjs` accepts, as it states them: one it refuses stops the whole
 * run, so a file named otherwise is left out and named instead. Kept beside the script's own; a
 * name the script refuses all the same is reported as its refusal.
 */
export const SERVED = {
  layoutType: /^[A-Za-z][A-Za-z0-9_-]{0,127}$/,
  layoutMode: /^[a-z][a-z0-9-]{0,31}$/,
  queue: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  language: /^[a-z]{2,3}(?:-[A-Z]{2})?$/,
  task: /^[A-Za-z][A-Za-z0-9_-]{0,127}\.[A-Za-z][A-Za-z0-9_-]{0,127}$/,
};

function whyNotServed(file: string): string {
  if (file === 'app.json')
    return (
      'The app registry serves it on a server, after sign-in; the dev server has none. The' +
      " shell keeps the platform's name and branding."
    );
  if (file === 'actions.json')
    return "Carried, not read: nothing in the app reads a package's actions.json yet.";
  if (file.startsWith('modules/'))
    return "No domain module exists yet, and nothing reads a module's settings.";
  if (file.startsWith('assets/'))
    return 'config:dev serves no image: one a file names is not shown in dev mode.';
  if (file.startsWith('demo/')) return "A kit's demo data, not part of the app definition.";
  if (file === 'bootstrap.json' || file === 'manifest.json' || file === 'layouts.json')
    return (
      "Version 1's file. An app definition package has no bootstrap fragment" +
      ' (package-pipeline.md, section 1), and the preview passes config:dev no fragment.'
    );
  return 'Not a file of an app definition that config:dev serves.';
}

/** The files under `folder`, relative to it with `/`, sorted. No link: the package was checked. */
function filesUnder(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/** Each file's path and digest, in one string. */
function fingerprint(root: string): string {
  return filesUnder(root)
    .map((file) => {
      const digest = createHash('sha256')
        .update(readFileSync(join(root, ...file.split('/'))))
        .digest('hex');
      return `${file}\u0000${digest}`;
    })
    .join('\n');
}

/** What the dev folder holds now: each file's bytes, by its path under the folder. */
function readFolder(folder: string): Map<string, Buffer> {
  const held = new Map<string, Buffer>();
  if (!existsSync(folder)) return held;
  for (const file of filesUnder(folder))
    held.set(file, readFileSync(join(folder, ...file.split('/'))));
  return held;
}

/** The script with no option: the platform's defaults alone, and none of the package. */
async function clear(script: string): Promise<string> {
  const reset = await runNode([script], DEV_CONFIG_TIMEOUT_MS, pipelineEnvironment(process.env));
  return reset.failure === null && reset.exitCode === 0
    ? "The dev folder now serves the platform's defaults alone."
    : `The dev folder could not be reset either (${reset.failure ?? `exit ${reset.exitCode}`}):` +
        ` run npm run config:dev.`;
}

/**
 * Whether the dev server answers each file of the dev folder as the folder holds it now, and no
 * longer answers one the run removed. Its watcher takes a moment to see a file written after it
 * started (measured: under a second on Angular 22's dev server), so each file is asked again until
 * it is answered as it is, for `waitMs` at most. `GET` only, to the dev server's origin on this
 * machine, with no credential, no redirect followed, and no more read of an answer than the file it
 * is compared with, plus a byte.
 */
async function askDevServer(
  origin: string,
  folder: string,
  servedBefore: ReadonlyMap<string, Buffer>,
  waitMs: number,
): Promise<DevServerCheck> {
  const now = readFolder(folder);
  const ask = async (file: string, bytes: Buffer): Promise<boolean> => {
    const path = file.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${origin}/agentic-ui-config/${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(DEV_SERVER_TIMEOUT_MS),
    });
    const body = await readAtMost(response, bytes.length + 1);
    return response.status === 200 && body.equals(bytes);
  };
  let stale = [...now.keys()];
  let stillServed = [...servedBefore.keys()].filter((file) => !now.has(file));
  const until = Date.now() + waitMs;
  try {
    for (;;) {
      const next: string[] = [];
      for (const file of stale) if (!(await ask(file, now.get(file) as Buffer))) next.push(file);
      const held: string[] = [];
      for (const file of stillServed)
        if (await ask(file, servedBefore.get(file) as Buffer)) held.push(file);
      [stale, stillServed] = [next, held];
      if ((stale.length === 0 && stillServed.length === 0) || Date.now() >= until) break;
      await new Promise((resolve) => setTimeout(resolve, DEV_SERVER_POLL_MS));
    }
  } catch (error) {
    return {
      origin,
      answering: false,
      stale: [],
      stillServed: [],
      note:
        `Nothing answered at ${origin} (${reason(error)}). Start the dev server, npx nx serve` +
        ' nuxeo-ui, then open the address.',
    };
  }
  const behind = [...stale, ...stillServed];
  return {
    origin,
    answering: true,
    stale,
    stillServed,
    note:
      behind.length === 0
        ? `The dev server at ${origin} answers every file as the dev folder holds it.`
        : `The dev server at ${origin} still does not answer ${behind.join(', ')} as the dev` +
          ` folder holds them, ${waitMs / 1000}s after they were written. If it runs` +
          ' from this checkout, restart it (npx nx serve nuxeo-ui), then open the address. If' +
          " it runs from another checkout or worktree, it serves that one's folder: stop it, and" +
          " start this one's.",
  };
}

/** At most `limit` bytes of the answer's body; the rest is not read. */
async function readAtMost(response: Response, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      size += value.byteLength;
    }
  } finally {
    // Stops the rest of the body being read. Cancelling a body already read to its end, or one
    // the server closed, can reject, and there is nothing to report: what was read is compared.
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).subarray(0, limit);
}

function reason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  const code =
    cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : undefined;
  return code ?? error.message;
}

/** The addresses the app draws the package at. The app routes with a hash: `/#/home`. */
export function pagesOf(origin: string, files: readonly ServedFile[]): Page[] {
  const pages: Page[] = [];
  const at = (path: string) => `${origin}/#/${path}`;
  if (files.some((file) => file.file === 'home.json'))
    pages.push({ what: 'the home', url: at('home'), how: "The app's home.json, drawn." });
  for (const file of files) {
    const queue = /^queues\/([^/]+)\.json$/.exec(file.file);
    if (queue)
      pages.push({
        what: `the queue ${queue[1]}`,
        url: at(`queues/${encodeURIComponent(queue[1])}`),
        how: 'Its page provider is asked on the Nuxeo server, as the person signed in.',
      });
  }
  if (files.some((file) => file.file === 'navigation.json'))
    pages.push({
      what: 'the menu',
      url: null,
      how: "Its entries show in the app's menu, on any page.",
    });
  const tasks = files.filter((file) => file.file.startsWith('tasks/'));
  if (tasks.length > 0)
    pages.push({
      what: 'the task forms',
      url: at('tasks'),
      how:
        'Open a task of the step a form is named after: its form replaces the one generated from' +
        ` the step's variables. Forms: ${tasks.map((file) => file.file.slice('tasks/'.length, -'.layout.json'.length)).join(', ')}.`,
    });
  for (const file of files) {
    const layout = /^layouts\/([^/]+)\/([^/]+)\.layout\.json$/.exec(file.file);
    if (layout) pages.push(layoutPage(layout[1], layout[2], at('doc/')));
  }
  return pages;
}

/**
 * Where a layout is drawn, by its mode (layout-v2.md, section 1): `view` is the record page,
 * `metadata` the Properties panel beside it, `edit` and `create` the Edit and Create forms. Each
 * opens from a record of its type, which `doc` and its id reach.
 */
function layoutPage(type: string, mode: string, doc: string): Page {
  const open = `a ${type} record, from a queue, a search or ${doc}<its id>`;
  switch (mode) {
    case 'view':
      return { what: `the ${type} record page`, url: null, how: `Open ${open}.` };
    case 'metadata':
      return {
        what: `the ${type} record page's Properties panel`,
        url: null,
        how: `Open ${open}: the panel is beside its page.`,
      };
    case 'edit':
      return { what: `the ${type} Edit form`, url: null, how: `Open ${open}, and choose Edit.` };
    case 'create':
      return {
        what: `the ${type} Create form`,
        url: null,
        how: `Create a new ${type} record, in a folder whose type may hold one.`,
      };
    default:
      return { what: `the ${type} layout in ${mode} mode`, url: null, how: `Open ${open}.` };
  }
}

/** What `kit-stand-in.mjs --check` prints, as far as the answer reads it. */
interface StandInCheck {
  readonly records: Readonly<Record<string, readonly { key: string; id: string }[]>>;
  readonly answered: readonly string[];
  readonly notAnswered: readonly string[];
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((each) => typeof each === 'string');

function readStandInCheck(stdout: string): StandInCheck | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { records, pageProviders } = parsed as { records?: unknown; pageProviders?: unknown };
  if (typeof records !== 'object' || records === null || Array.isArray(records)) return null;
  if (typeof pageProviders !== 'object' || pageProviders === null) return null;
  const { answered, notAnswered } = pageProviders as { answered?: unknown; notAnswered?: unknown };
  if (!isStrings(answered) || !isStrings(notAnswered)) return null;
  const read: Record<string, { key: string; id: string }[]> = {};
  for (const [type, list] of Object.entries(records)) {
    if (!Array.isArray(list)) return null;
    read[type] = [];
    for (const entry of list as unknown[]) {
      const { key, id } = (entry ?? {}) as { key?: unknown; id?: unknown };
      if (typeof key !== 'string' || typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id))
        return null;
      read[type].push({ key, id });
    }
  }
  return { records: read, answered, notAnswered };
}

/**
 * How to see a demo kit's pages with the stand-in, from `kit-stand-in.mjs --check`, which reads the
 * kit's files and nothing else: it starts no server and sends nothing, and is given no credential.
 * `null` for a package with no `content-model.json`, whose types are a server's. A kit with a model
 * and no demo data the stand-in reads, such as the tutorial's, is told why it is not read.
 */
export async function standInFor(
  directory: string,
  origin: string,
  script: string = STAND_IN_SCRIPT,
): Promise<StandIn | null> {
  if (!existsSync(join(directory, 'content-model.json'))) return null;
  const run = await runNode(
    [script, directory, '--check'],
    STAND_IN_TIMEOUT_MS,
    pipelineEnvironment(process.env),
  );
  const checked = run.failure === null && run.exitCode === 0 ? readStandInCheck(run.stdout) : null;
  if (checked === null) {
    const why = lines(run.stderr)[0] ?? run.failure ?? `exit ${String(run.exitCode)}`;
    return {
      reads: false,
      commands: [],
      answers: [],
      notAnswered: [],
      records: [],
      note:
        `npm run kit:stand-in does not read this kit's demo data: ${why} So its record pages,` +
        ' queues and home show what the server the dev server proxies holds.',
    };
  }
  const port = new URL(origin).port;
  const commands = [
    `npm run kit:stand-in -- ${shownFromRepository(directory)}`,
    `NUXEO_PROXY_TARGET=${STAND_IN_ORIGIN} npx ng serve nuxeo-ui --configuration=development,remote` +
      (port !== '' && port !== '4200' ? ` --port ${port}` : ''),
  ];
  const records: Page[] = Object.entries(checked.records)
    .filter(([, list]) => list.length > 0)
    .map(([type, list]) => ({
      what: `the ${type} record page, on ${list[0].key}`,
      url: `${origin}/#/doc/${list[0].id}`,
      how: 'A stand-in record, read-only: it opens once the stand-in runs and the dev server is pointed at it.',
    }));
  const unanswered =
    checked.notAnswered.length > 0
      ? ` It answers ${checked.notAnswered.join(', ')} HTTP 501, saying so, since the kit's` +
        ' EXPECTED does not list them: their pages show their error.'
      : '';
  return {
    reads: true,
    commands,
    answers: checked.answered,
    notAnswered: checked.notAnswered,
    records,
    note:
      "No server holds this kit's model or records, so the dev server alone shows its shell: the" +
      " home's figures Unavailable, each queue's error, no record page. The stand-in answers them" +
      ' from content-model.json and demo/data.mjs, read-only, and forwards everything else, sign-in' +
      ' included, to the Nuxeo behind it (--upstream, default http://localhost:8080). Run the first' +
      ' command, then start the dev server with the second in place of npx nx serve nuxeo-ui: what' +
      ' this preview served is served as before. Sign in with your own account.' +
      `${unanswered} A write to a stand-in record is refused, so nothing a write changes is seen.`,
  };
}

function shownFromRepository(path: string): string {
  const from = relative(REPO_ROOT, path);
  return from === '' || from.startsWith('..') ? path : from.split(sep).join('/');
}

/** A flag's value as the command is shown: its file relative to the repository. */
function shownFlag(value: string): string {
  const at = value.indexOf('=');
  if (value.startsWith('--')) return value;
  return at === -1
    ? shownFromRepository(value)
    : `${value.slice(0, at + 1)}${shownFromRepository(value.slice(at + 1))}`;
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line !== '');
}
