/**
 * Running a plugin for check 9 (docs/business-apps/studio-migration.md, section 6): its own tests,
 * what it shows on the observed behaviour's records, and, when asked, the repository's gates.
 *
 * - **Its tests and what it shows** run in a copy of the library, made from the very files check 9
 *   scanned, under `tmp/` in the workspace, where the workspace's paths and packages resolve as they
 *   do for the library itself. Into the copy goes one more spec, the harness's own, which nothing
 *   of the plugin writes: it registers the plugin through its provider, resolves its component by
 *   ID as the host does, gives it each record, reads the text it shows, presses each button the
 *   observed behaviour presses, answers the request as the server did, and records what it asked
 *   and emitted. One Vitest run gives both, with the plugin's own configuration. The copy is removed
 *   after the run.
 * - **The gates** run through Nx on the library itself, once check 9 has made sure its files are
 *   those it scanned: `lint`, `test` and `typecheck` of the library, and `build` of the template
 *   app, which a plugin is built into until plugins load at run time (decision 5).
 *
 * Nothing of the customer's package runs here: only the plugin, which is code of this repository a
 * person reviews, and the harness's spec.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CustomElement } from './elements';
import type { ObservedBehaviour } from './observed';
import {
  childEnvironment,
  childNodeOptions,
  nxEntry,
  PLUGIN_FILE,
  templateConfiguration,
  type PluginMetadata,
} from './plugin';
import { readLibrary, type PluginSource } from './plugins';

/** One gate's verdict. */
export interface GateRun {
  readonly passed: boolean;
  /** The last lines it printed, for the finding. */
  readonly output: string;
}

/** A request the plugin sent, as the harness's spec read it. */
export interface SeenAsk {
  readonly operation: string | null;
  readonly method: string;
  readonly url: string;
  readonly input: unknown;
  readonly params: unknown;
}

/** What the plugin emitted, by the output's name. */
export interface SeenFire {
  readonly output: string;
  readonly detail: unknown;
}

/** What one record showed, asked and emitted as it was drawn, and what each press did. */
export interface SeenRecord {
  readonly record: string;
  readonly shows: string;
  /** The buttons it showed, each by its text, or its accessible name where it has no text. */
  readonly buttons?: readonly string[];
  readonly loads?: readonly SeenAsk[];
  readonly fires?: readonly SeenFire[];
  readonly error?: string;
  readonly clicks?: readonly SeenClick[];
}

export interface SeenClick {
  readonly button: string;
  readonly found: boolean;
  readonly asks: readonly SeenAsk[];
  readonly fires: readonly SeenFire[];
  readonly error?: string;
}

/** A plugin's run, as check 9 reads it. */
export interface PluginRun {
  /** The plugin's own specs, run with Vitest in a copy of its library. */
  readonly tests: {
    readonly passed: number;
    /** The titles of the tests that passed, as Vitest ran them. */
    readonly passedTitles?: readonly string[];
    readonly failed: readonly string[];
    /** Tests left `todo` or skipped. */
    readonly unwritten: readonly string[];
    /** Spec files Vitest ran in which no test ran. */
    readonly empty?: readonly string[];
    /** The run's own failure, when it could not run at all. */
    readonly error?: string;
  };
  /** What the plugin showed on each record of the observed behaviour; absent without one. */
  readonly seen?: readonly SeenRecord[];
  /**
   * What the plugin added to the app's registries, by registry: its components, rules, actions,
   * and each slot's entries, once registered and once drawn.
   */
  readonly registered?: Readonly<Record<string, readonly string[]>>;
  /** Why the harness's spec could not read what the plugin shows, or registers. */
  readonly seenError?: string;
  /** Lint, test, typecheck and build, through Nx, when they were run. */
  readonly gates?: Readonly<Record<string, GateRun>>;
}

export interface RunOptions {
  /** The observed behaviour, for what the plugin shows; without it, only its tests run. */
  readonly observed?: ObservedBehaviour;
  /** The custom element, for its name in the observed behaviour. */
  readonly element?: CustomElement;
  /** Run lint, test, typecheck and build through Nx too. */
  readonly gates?: boolean;
  /** The template app's Nx project, built with the plugin in it. */
  readonly templateProject?: string;
}

/** The harness's spec, in the copy. */
export const PROBE_SPEC = 'src/studio-check-9.probe.spec.ts';
/** The gates, by Nx target, run on the library; `build` is the template app's. */
export const GATES = ['lint', 'test', 'typecheck', 'build'] as const;
/** The Nx project of the template app, which a plugin is built into. */
export const TEMPLATE_PROJECT = 'nuxeo-satori-template';

interface Ran {
  readonly status: number | null;
  readonly output: string;
}

/** Runs Node on a JavaScript entry point, with no shell, and collects what it prints. */
function runNode(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout = 600_000,
): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...args], { cwd, env, shell: false });
    let output = '';
    const keep = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-20_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: null, output: `${output}\n${error.message}` });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, output });
    });
  });
}

/**
 * The environment of a child run: this one's, less what a Vitest runner sets for its own workers,
 * which would make a Vitest started from the harness's tests think it is one of them.
 */
function runEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(childEnvironment()))
    if (!/^(?:VITEST|TINYPOOL|__VITEST)/.test(name) && name !== 'NODE_ENV') env[name] = value;
  env['NODE_OPTIONS'] = childNodeOptions();
  env['NX_DAEMON'] = 'false';
  return env;
}

function lastLines(text: string, count = 25): string {
  return text
    .split('\n')
    .filter(
      (line) =>
        !/^\s*$/.test(line) && !/analogjs|deprecated|configLoader|VITE_CONFIG|__dirname/.test(line),
    )
    .slice(-count)
    .join('\n');
}

/** The metadata a plugin's `studio-plugin.json` holds, or `null` when it holds none that reads. */
export function pluginMetadata(source: PluginSource): PluginMetadata | null {
  const text = source.files[PLUGIN_FILE];
  if (text === undefined) return null;
  try {
    const parsed = JSON.parse(text) as PluginMetadata;
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** The harness's spec: what it reads of the plugin, given `input` as JSON at `inputPath`. */
export function probeSource(inputPath: string): string {
  return `/* The Studio migration harness's own spec, for check 9: written into a copy of the plugin, never into the plugin. */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { reflectComponentType, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionComponentRegistry,
  ExtensionRuleRegistry,
  ExtensionSlotRegistry,
} from '@nuxeo/satori-platform/extensions';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import * as plugin from './index';

interface Answer { answer?: unknown; failure?: number }
interface ProbeRecord { record: string; inputs?: Record<string, unknown>; loads?: Answer[]; clicks?: (Answer & { button: string })[] }
interface ProbeInput {
  provider: string;
  component: string;
  recordInput: string;
  inputs: Record<string, unknown>;
  records: Record<string, unknown>[];
  seen: ProbeRecord[];
  out: string;
}

const input = JSON.parse(readFileSync(${JSON.stringify(inputPath)}, 'utf8')) as ProbeInput;

function shown(root: Node): string {
  const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pieces: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement?.localName;
    if (parent === 'style' || parent === 'script') continue;
    const text = (node.textContent ?? '').replace(/\\s+/g, ' ').trim();
    if (text) pieces.push(text);
  }
  return pieces.join(' ');
}

/** A button by its text, or else by its accessible name. */
function labelOf(button: Element): string {
  return shown(button) || (button.getAttribute('aria-label') ?? button.getAttribute('title') ?? '').trim();
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split('\\n')[0];

/** Everything the app's registries hold, by registry. */
function registered(): Record<string, string[]> {
  const slots = TestBed.inject(ExtensionSlotRegistry);
  const held: Record<string, string[]> = {
    components: [...TestBed.inject(ExtensionComponentRegistry).registeredComponentIds()],
    rules: [...TestBed.inject(ExtensionRuleRegistry).registeredRuleIds()],
    actions: [...TestBed.inject(ExtensionActionRegistry).registeredActionIds()],
  };
  for (const slot of new Set([...Object.values(EXTENSION_SLOTS), ...slots.registeredSlotIds()]))
    held['slot ' + slot] = [...slots.registeredIds(slot)];
  return held;
}

function read(request: TestRequest) {
  const body = (request.request.body ?? {}) as Record<string, unknown>;
  const url = request.request.urlWithParams;
  return {
    operation: /\\/automation\\/([^/?]+)/.exec(url)?.[1] ?? null,
    method: request.request.method,
    url,
    input: body['input'] ?? null,
    params: body['params'] ?? null,
  };
}

/** Every request the plugin sends until it settles, each answered as the element's was, in order. */
async function settle(fixture: ComponentFixture<unknown>, http: HttpTestingController, answers: Answer[]) {
  const asked: ReturnType<typeof read>[] = [];
  for (let round = 0; round < 10; round++) {
    fixture.detectChanges();
    await fixture.whenStable();
    const pending = http.match(() => true);
    if (pending.length === 0) break;
    for (const request of pending) {
      const answer = answers[asked.length];
      asked.push(read(request));
      if (answer?.failure !== undefined) request.flush('failed', { status: answer.failure, statusText: 'Failed' });
      else if (answer) request.flush((answer.answer ?? {}) as object);
      else request.flush('not asked for', { status: 404, statusText: 'Not Found' });
    }
  }
  fixture.detectChanges();
  return asked;
}

let before: Record<string, string[]> = {};

describe('check 9, what the plugin shows', () => {
  it('reads what the registries hold without the plugin', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    before = registered();
    expect(before['components']).toBeDefined();
  });

  it('reads it on each record', async () => {
    const provider = (plugin as Record<string, unknown>)[input.provider];
    if (typeof provider !== 'function') throw new Error('the library exports no ' + input.provider);
    TestBed.configureTestingModule({
      providers: [
        (provider as () => never)(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    const added: Record<string, string[]> = {};
    const note = (held: Record<string, string[]>): void => {
      for (const [registry, ids] of Object.entries(held))
        for (const id of ids)
          if (!(before[registry] ?? []).includes(id) && !(added[registry] ?? []).includes(id))
            (added[registry] ??= []).push(id);
    };
    note(registered());
    const component = (await TestBed.inject(ExtensionComponentRegistry).resolve(input.component)) as Type<unknown> | null;
    if (!component) throw new Error('nothing resolves ' + input.component);
    const outputs = (reflectComponentType(component)?.outputs ?? []).map((output) => output.propName);
    const http = TestBed.inject(HttpTestingController);
    const results: unknown[] = [];
    for (const seen of input.seen) {
      const record = input.records.find((candidate) => candidate['uid'] === seen.record);
      try {
        const fixture = TestBed.createComponent(component);
        const fires: { output: string; detail: unknown }[] = [];
        const instance = fixture.componentInstance as Record<string, unknown>;
        for (const name of outputs) {
          const emitter = instance[name] as { subscribe?: (next: (value: unknown) => void) => unknown } | undefined;
          emitter?.subscribe?.((detail: unknown) => fires.push({ output: name, detail: detail === undefined ? null : detail }));
        }
        fixture.componentRef.setInput(input.recordInput, record ?? null);
        for (const [name, value] of Object.entries({ ...input.inputs, ...(seen.inputs ?? {}) }))
          fixture.componentRef.setInput(name, value);
        const loads = await settle(fixture, http, seen.loads ?? []);
        const host = fixture.nativeElement as HTMLElement;
        const shows = shown(host);
        const buttons = Array.from(host.querySelectorAll('button, [role="button"], a[href]')).map(labelOf);
        const drawn = fires.splice(0);
        const clicks: unknown[] = [];
        for (const click of seen.clicks ?? []) {
          const button = Array.from(host.querySelectorAll('button, [role="button"]')).find((candidate) => labelOf(candidate) === click.button) as HTMLElement | undefined;
          if (!button) {
            clicks.push({ button: click.button, found: false, asks: [], fires: [] });
            continue;
          }
          button.click();
          const asks = await settle(fixture, http, [click]);
          clicks.push({ button: click.button, found: true, asks, fires: fires.splice(0) });
        }
        results.push({ record: seen.record, shows, buttons, loads, fires: drawn, clicks });
        note(registered());
        fixture.destroy();
      } catch (error) {
        results.push({ record: seen.record, shows: '', error: message(error) });
      }
    }
    note(registered());
    writeFileSync(input.out, JSON.stringify({ seen: results, registered: added }));
    expect(results.length).toBe(input.seen.length);
  }, 120_000);
});
`;
}

/** The harness's own setup: every test of the plugin asserts something, or it fails. */
export const PROBE_SETUP = 'src/studio-check-9.setup.ts';
const PROBE_SETUP_SOURCE = `/* The Studio migration harness's own setup, for check 9: a test that asserts nothing fails. */
beforeEach(() => {
  expect.hasAssertions();
});
`;

interface VitestReport {
  readonly testResults?: readonly {
    readonly name: string;
    readonly status: string;
    readonly message?: string;
    readonly assertionResults?: readonly {
      readonly title: string;
      readonly fullName: string;
      readonly status: string;
      readonly failureMessages?: readonly string[];
    }[];
  }[];
}

/**
 * Runs a plugin's own tests and, with an observed behaviour, what it shows, in a copy of its files;
 * then, when asked, the gates through Nx on the library itself.
 */
export async function runPlugin(
  workspace: string,
  source: PluginSource,
  options: RunOptions = {},
): Promise<PluginRun> {
  const name = source.library.slice(source.library.lastIndexOf('/') + 1);
  // Under `tmp/`, which the repository ignores, at the depth of `libs/extensions/<name>`, so that
  // the library's relative paths to the workspace's root hold in the copy.
  const scratch = join(
    workspace,
    'tmp',
    `studio-check-9-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  const copy = join(scratch, name);
  const out = join(scratch, 'seen.json');
  const report = join(scratch, 'vitest.json');
  const env = runEnvironment();
  try {
    // Its build and test configuration as the template writes it, never its own: a plugin does
    // not choose how it is tested. Check 9 holds its own to the template's apart.
    const configuration = templateConfiguration(workspace, source.library);
    const files: Record<string, string> = { ...source.files };
    for (const [path, text] of Object.entries(configuration)) if (text !== null) files[path] = text;
    // And the harness's setup beside the template's, so that a test that asserts nothing fails.
    const vite = files['vite.config.mts'] ?? '';
    const setupFiles = "setupFiles: ['src/test-setup.ts']";
    if (!vite.includes(setupFiles))
      throw new Error(
        `the template's vite.config.mts names no ${setupFiles}, which check 9 adds its own setup beside`,
      );
    files['vite.config.mts'] = vite.replace(
      setupFiles,
      `setupFiles: ['src/test-setup.ts', '${PROBE_SETUP}']`,
    );
    files[PROBE_SETUP] = PROBE_SETUP_SOURCE;
    for (const [path, text] of Object.entries(files)) {
      // Not the project file: Nx would find a second project of the same name.
      if (path === 'project.json') continue;
      const full = join(copy, ...path.split('/'));
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
    // The harness's spec runs whenever the plugin does: what it registers needs only its provider,
    // and what it shows, the observed behaviour.
    const metadata = pluginMetadata(source);
    const observed = options.observed?.elements[options.element?.name ?? source.element];
    const probing = metadata !== null;
    if (metadata !== null) {
      const inputPath = join(scratch, 'probe-input.json');
      writeFileSync(
        inputPath,
        JSON.stringify({
          provider: metadata.provider,
          component: metadata.component,
          recordInput: observed?.recordInput ?? 'document',
          inputs: observed?.inputs ?? {},
          records: options.observed?.records ?? [],
          seen: (observed?.records ?? []).map((record) => ({
            record: record.record,
            ...(record.inputs ? { inputs: record.inputs } : {}),
            loads: record.loads ?? [],
            clicks: record.clicks ?? [],
          })),
          out,
        }),
      );
      writeFileSync(join(copy, ...PROBE_SPEC.split('/')), probeSource(inputPath));
    }
    const vitest = join(workspace, 'node_modules', 'vitest', 'vitest.mjs');
    const ran = await runNode(
      [
        vitest,
        'run',
        '--config',
        join(copy, 'vite.config.mts'),
        '--reporter=json',
        `--outputFile=${report}`,
        // Vitest's five seconds are a test's own; on a busy machine an Angular library's first
        // render takes longer, and a timeout would read as a plugin that fails.
        '--testTimeout=120000',
        '--hookTimeout=120000',
      ],
      workspace,
      env,
    );
    const tests = readTests(report, ran);
    let seen: readonly SeenRecord[] | undefined;
    let registered: Record<string, readonly string[]> | undefined;
    let seenError: string | undefined;
    if (probing) {
      if (existsSync(out)) {
        const read = JSON.parse(readFileSync(out, 'utf8')) as {
          seen: SeenRecord[];
          registered: Record<string, readonly string[]>;
        };
        if (observed !== undefined) seen = read.seen;
        registered = read.registered;
      } else seenError = probeFailure(report) ?? lastLines(ran.output, 8);
    }
    let gates: Record<string, GateRun> | undefined;
    if (options.gates) {
      // The gates read the library on disk: only when it is still the files check 9 read.
      const onDisk = readLibrary(workspace, source.library);
      gates =
        onDisk !== null && sameFiles(onDisk, source.files)
          ? await runGates(workspace, name, options)
          : {
              files: {
                passed: false,
                output: `${source.library} changed on disk while check 9 read it, so its gates were not run`,
              },
            };
    }
    return {
      tests,
      ...(seen !== undefined ? { seen } : {}),
      ...(registered !== undefined ? { registered } : {}),
      ...(seenError !== undefined ? { seenError } : {}),
      ...(gates !== undefined ? { gates } : {}),
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function sameFiles(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(a).sort();
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  );
}

/** The plugin's own tests, from Vitest's report: every spec file but the harness's. */
function readTests(path: string, ran: Ran): PluginRun['tests'] {
  if (!existsSync(path))
    return {
      passed: 0,
      failed: [],
      unwritten: [],
      error: lastLines(ran.output) || `exit ${String(ran.status)}`,
    };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as VitestReport;
  const own = (parsed.testResults ?? []).filter(
    (file) => !file.name.endsWith('studio-check-9.probe.spec.ts'),
  );
  const failed: string[] = [];
  const unwritten: string[] = [];
  const passedTitles: string[] = [];
  const empty: string[] = [];
  let passed = 0;
  for (const file of own) {
    const results = file.assertionResults ?? [];
    const where = file.name.slice(file.name.lastIndexOf('/src/') + 1);
    if (file.status === 'failed' && results.every((result) => result.status !== 'failed'))
      failed.push(`${where}: ${(file.message ?? 'it did not run').split('\n')[0]}`);
    // A file whose tests a `describe.skip` or the like took away runs nothing and passes.
    if (results.length === 0 && file.status !== 'failed') empty.push(where);
    for (const result of results) {
      if (result.status === 'passed') {
        passed++;
        passedTitles.push(result.title);
      } else if (result.status === 'failed') failed.push(result.fullName);
      else unwritten.push(result.fullName);
    }
  }
  return own.length === 0
    ? {
        passed,
        passedTitles,
        failed,
        unwritten,
        empty,
        error: 'Vitest found none of its spec files',
      }
    : { passed, passedTitles, failed, unwritten, empty };
}

/** Why the harness's spec failed, from Vitest's report. */
function probeFailure(path: string): string | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as VitestReport;
  const probe = (parsed.testResults ?? []).find((file) =>
    file.name.endsWith('studio-check-9.probe.spec.ts'),
  );
  const failure =
    probe?.assertionResults?.flatMap((result) => result.failureMessages ?? [])[0] ?? probe?.message;
  return failure ? failure.split('\n')[0] : null;
}

/** Lint, test and typecheck of the library, and build of the template app, through Nx. */
async function runGates(
  workspace: string,
  project: string,
  options: RunOptions,
): Promise<Record<string, GateRun>> {
  const nx = nxEntry(workspace);
  const env = { ...runEnvironment(), NX_TUI: 'false' };
  const gates: Record<string, GateRun> = {};
  for (const gate of GATES) {
    const target =
      gate === 'build'
        ? `${options.templateProject ?? TEMPLATE_PROJECT}:build`
        : `${project}:${gate}`;
    const ran = await runNode([nx, 'run', target, '--output-style=static'], workspace, env);
    gates[gate] = {
      passed: ran.status === 0,
      output: ran.status === 0 ? '' : lastLines(ran.output),
    };
  }
  return gates;
}
