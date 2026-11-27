/**
 * Check 9, plugins (docs/business-apps/studio-migration.md, section 6): each custom element of the
 * package has a plugin, and the plugin behaves like the element it replaces.
 *
 * - **The report** lists each element as its plugin, with the plugin's library.
 * - **The plugin** is the one the `plugin` command wrote for that element, from the element's
 *   definition as the package holds it now (`studio-plugin.json`), with the element's interface:
 *   an input for each property, an output for each event.
 * - **It is built in** to the customer's app from the template: the template's `app.config.ts`
 *   calls its provider, until plugins load at run time (decision 5).
 * - **Nothing unsafe** (`plugin-scan.ts`): no data written as HTML, no sanitiser bypassed, no text
 *   run as code, no Nuxeo URL bound to `[src]`, no network but through the app's services, no
 *   third-party type in its public API, this repository's conventions kept, and no code in the
 *   conversion's configuration or the plugin's.
 * - **Its own tests pass**, with none left `todo` or skipped.
 * - **It passes lint, test, build and typecheck,** through Nx.
 * - **It shows the same values as the element on the same records,** as check 6 compares them:
 *   the harness's own spec gives the plugin each record of the observed behaviour, and what it
 *   shows, what pressing each button asks the server, and what it then emits must be what the
 *   element did.
 *
 * The scan and the configuration need nothing but the files. The tests, the gates and the values
 * need the plugin run (`plugin-run.ts`), which `check --run-plugins` does, and the values the
 * observed behaviour, `--observed`: without them the check runs in part, and says what did not
 * run. A plugin not written yet is in part too, never a failure: an agent writes it next.
 *
 * **A person decides it.** Each element's plugin is a proposal of the report, as a condition's rule
 * is, which a person accepts or rejects in `decisions.json` (`decisions.ts`). Check 9 reads that
 * decision as the report records the conversion was made with it, `applied`, and readiness holds
 * that to `decisions.json`: a plugin passing check 9 is not ready until a person accepts it, and
 * the approval covers each accepted plugin's files (`approval.ts`). A rejected plugin is not held to
 * its element, so its library must be gone, and the template must not import it. An accepted one
 * is built from its own library, as the template's `tsconfig.app.json` resolves its import path.
 * Check 9 reads no other file of the template app: the rest of the fork is the customer's code.
 */
import { isDeepStrictEqual } from 'node:util';
import { pluginLibraryOf } from './convert-elements';
import { camelCase, pluginInterface, type CustomElement } from './elements';
import type { CheckOutcome, HarnessInput } from './harness';
import { detailOf, sameAsk, shown, type ObservedElement } from './observed';
import {
  behaviours,
  PLUGIN_FILE,
  PLUGIN_FORMAT,
  TEMPLATE_CONFIGURATION,
  templateConfiguration,
} from './plugin';
import { pluginMetadata, type PluginRun } from './plugin-run';
import { scanConfiguration, scanPlugin, scanPublicApi, shipped } from './plugin-scan';
import { TEMPLATE_TSCONFIG, type PluginSource, type PluginsInput } from './plugins';
import * as ts from 'typescript';

export function checkPlugins(input: HarnessInput): CheckOutcome {
  const findings: string[] = [];
  const waiting: string[] = [];
  const plugins = input.plugins;
  // No configuration holds code, whether or not the package has custom elements.
  findings.push(...scanConfiguration(input.conversion.app, plugins?.sources ?? []));
  const elements = input.inventory.customElements;
  const entries = input.conversion.report.constructs ?? [];
  for (const element of elements) {
    const id = `custom-element:${element.path}#${element.index + 1}`;
    const library = pluginLibraryOf(element);
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry)
      findings.push(`the report lists no plugin for the custom element ${element.name} (${id})`);
    else if (entry.outcome !== 'proposed' || entry.proposal !== true)
      findings.push(
        `the report gives the custom element ${element.name} as ${entry.outcome}${entry.outcome === 'proposed' ? ' with no decision of its own' : ''}, not as a plugin a person accepts or rejects`,
      );
    else if (entry.to !== library)
      findings.push(
        `the report puts the plugin of ${element.name} at ${String(entry.to)}, not at ${library}, where the plugin command writes it`,
      );
    if (!plugins) continue;
    const source = plugins.sources.find((candidate) => candidate.element === element.name);
    if (entry?.proposal === true && entry.applied === 'reject') {
      // Rejected: nothing of it is held to the element, so nothing of it may stay where it can be
      // built in. Its library gone, no import of it builds, whichever file of the app holds it.
      if (source)
        findings.push(
          `${library}, the plugin of ${element.name}, which a person rejected, is still in the repository: remove it, with its import path and its provider, so that nothing builds it in`,
        );
      if (builtIn(plugins.template?.text ?? '', element, source))
        findings.push(
          `${plugins.template?.path ?? 'the template'} builds in ${library}, the plugin of ${element.name}, which a person rejected: take it out of the template's providers`,
        );
      continue;
    }
    if (!source) {
      waiting.push(`the plugin of ${element.name}, ${library}, is not written yet`);
      continue;
    }
    findings.push(...holdPlugin(input, element, source, plugins));
    const run = plugins.runs?.[element.name];
    findings.push(...holdTitles(element, source, run));
    if (!run) {
      waiting.push(`${element.name}'s tests, gates and values were not run`);
      continue;
    }
    findings.push(...holdRun(element, source, run), ...holdRegistered(source, run));
    if (!run.gates) waiting.push(`${element.name}'s lint, test, build and typecheck were not run`);
    const observed = plugins.observed?.elements[element.name];
    if (!observed) {
      waiting.push(`no observed behaviour of ${element.name} was given`);
      continue;
    }
    findings.push(...holdValues(element, observed, run));
    // An input the observed behaviour never gives a value is not held to the element.
    const given = new Set([
      observed.recordInput ?? 'document',
      ...Object.keys(observed.inputs),
      ...observed.records.flatMap((record) => Object.keys(record.inputs ?? {})),
    ]);
    const unheld = pluginInterface(element).inputs.filter((name) => !given.has(name));
    if (unheld.length > 0)
      waiting.push(
        `the observed behaviour of ${element.name} gives no value to ${unheld.join(', ')}, so the plugin is not held to the element there`,
      );
  }
  if (elements.length > 0 && !plugins) waiting.push('the plugins were not read');
  return {
    findings,
    ...(waiting.length > 0
      ? {
          rest: `${waiting.join('; ')}. A plugin is written with the plugin command, and run with check --run-plugins and the observed behaviour, --observed, which lab mode does not record yet`,
        }
      : {}),
  };
}

/** What the plugin's own files must say and hold. */
function holdPlugin(
  input: HarnessInput,
  element: CustomElement,
  source: PluginSource,
  plugins: PluginsInput,
): string[] {
  const findings: string[] = [];
  const metadata = pluginMetadata(source);
  const file = `${source.library}/${PLUGIN_FILE}`;
  if (metadata === null) {
    findings.push(
      `${file} is missing, or is not JSON: the plugin command writes it, and check 9 reads the plugin by it`,
    );
    return findings;
  }
  if (metadata.format !== PLUGIN_FORMAT) findings.push(`${file} is not a ${PLUGIN_FORMAT} file`);
  if (metadata.element !== element.name)
    findings.push(`${file} is the plugin of ${String(metadata.element)}, not of ${element.name}`);
  // Another version of the same package is fine while the element's definition is the same.
  const { name } = input.pkg.descriptor;
  if (metadata.package?.name !== name)
    findings.push(
      `${file} was written from ${String(metadata.package?.name)}, not from the package given, ${name}`,
    );
  else if (metadata.definition !== element.sha256)
    findings.push(
      `the custom element ${element.name} has changed since its plugin was written: change the plugin to do what the element does now, then record the element it was written from with plugin --restamp`,
    );

  // The element's interface, on the component the plugin registers.
  const component = componentOf(source, element.name);
  if (component === null)
    findings.push(
      `${source.library}: no component of the plugin has the selector ${element.name}, the element's name`,
    );
  else {
    const { inputs, models, outputs } = pluginInterface(element);
    for (const wanted of models)
      if (component.inputs.includes(wanted) && !component.models.includes(wanted))
        findings.push(
          `${source.library}/${component.path}: ${wanted} is an input, where the element writes it back: make it a model()`,
        );
    for (const wanted of inputs)
      if (!component.inputs.includes(wanted))
        findings.push(
          `${source.library}/${component.path}: the component has no input ${wanted}, a property of the element`,
        );
    for (const wanted of outputs)
      if (!component.outputs.includes(wanted))
        findings.push(
          `${source.library}/${component.path}: the component has no output ${wanted}, for the element's ${element.events.find((event) => camelCase(event.name) === wanted)?.name ?? wanted} event`,
        );
    // A model's own `<name>Change` is the model's.
    for (const declared of component.outputs)
      if (!outputs.includes(declared))
        findings.push(
          `${source.library}/${component.path}: the component has an output ${declared}, which the element does not fire`,
        );
  }
  const project = source.library.slice(source.library.lastIndexOf('/') + 1);
  if (metadata.project !== project)
    findings.push(
      `${file} names the project ${String(metadata.project)}, not ${project}, whose library it is in`,
    );
  findings.push(...holdProject(source, project));

  // Built in from the template.
  const template = plugins.template;
  if (template === null)
    findings.push(`the repository holds no template app to build ${source.library} into`);
  else if (
    !callsImported(template, String(metadata.importPath ?? ''), String(metadata.provider ?? ''))
  )
    findings.push(
      `${template.path} does not build ${source.library} in: import ${String(metadata.provider)} from ${String(metadata.importPath)} and call it among its providers`,
    );
  // From its own library: the import path resolves, for the template, to the library's entry point.
  const entryPoint = `${source.library}/src/index.ts`;
  const resolved =
    typeof metadata.importPath === 'string' ? plugins.aliases?.[metadata.importPath] : undefined;
  if (plugins.aliases === null || plugins.aliases === undefined)
    findings.push(
      `${TEMPLATE_TSCONFIG} could not be read, so where the template builds ${source.library} from is not known`,
    );
  else if (resolved?.length !== 1 || resolved[0] !== entryPoint)
    findings.push(
      `${TEMPLATE_TSCONFIG} resolves ${String(metadata.importPath)} to ${resolved?.join(', ') || 'nothing'}, not to ${entryPoint}: the template builds the plugin from its own library`,
    );
  // What is not read is held by nothing.
  for (const path of source.skipped ?? [])
    findings.push(
      `${source.library}/${path} is a directory check 9 does not read: a plugin holds no installed packages and no repository of its own`,
    );

  // Tested and built as the template sets a library up, which the run uses whatever these say.
  const expected = templateConfiguration(plugins.workspace, source.library);
  for (const path of TEMPLATE_CONFIGURATION) {
    const want = expected[path];
    const have = source.files[path];
    if (want === null || want === undefined) continue;
    if (have === undefined)
      findings.push(`${source.library}/${path} is missing: the template writes it`);
    else if (have.replace(/\s+/g, '') !== want.replace(/\s+/g, ''))
      findings.push(
        `${source.library}/${path} is not the template's: a plugin is built and tested as the template sets a library up`,
      );
  }

  findings.push(...scanPlugin(source), ...scanPublicApi(source));
  return findings;
}

/**
 * A test of each behaviour the inventory read, or a line of the README's "Not kept" saying why
 * not. Once the plugin has run, the test must be one that passed, as Vitest ran it: a test in a
 * file Vitest never reads, or one a `describe.skip` took away, is no test.
 */
function holdTitles(
  element: CustomElement,
  source: PluginSource,
  run: PluginRun | undefined,
): string[] {
  const findings: string[] = [];
  const passed = run?.tests.passedTitles;
  const titles = passed === undefined ? testTitles(source) : new Set(passed);
  const notKept = notKeptOf(source.files['README.md'] ?? '');
  for (const behaviour of behaviours(element)) {
    if (titles.has(behaviour.title)) continue;
    const reason = notKept.find((line) => line.includes(behaviour.title));
    if (
      reason !== undefined &&
      reason
        .replace(behaviour.title, '')
        .replace(/[\s`*:,.–-]+/g, ' ')
        .trim()
        .split(' ').length >= 3
    )
      continue;
    findings.push(
      passed === undefined
        ? `${source.library} has no test of the element's behaviour ${JSON.stringify(behaviour.title)}, and its README's "Not kept" does not say why`
        : `${source.library} has no passing test of the element's behaviour ${JSON.stringify(behaviour.title)}, and its README's "Not kept" does not say why`,
    );
  }
  return findings;
}

/**
 * The project file the generator writes: its targets run the library's lint, tests and type check
 * as every library's do, so that a gate cannot pass by running something else.
 */
function holdProject(source: PluginSource, project: string): string[] {
  const findings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.files['project.json'] ?? 'null');
  } catch {
    parsed = null;
  }
  const config = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >;
  const want = expectedTargets(source.library);
  if (config['name'] !== project || !isDeepStrictEqual(config['targets'], want))
    findings.push(
      `${source.library}/project.json is not the generator's: its name and its lint, test and typecheck targets are every library's`,
    );
  return findings;
}

/** The targets `extension-library` writes for a library at `library`. */
function expectedTargets(library: string): Record<string, unknown> {
  return {
    test: {
      executor: '@nx/vitest:test',
      outputs: ['{options.reportsDirectory}'],
      options: { reportsDirectory: `coverage/${library}` },
    },
    lint: { executor: '@nx/eslint:lint' },
    typecheck: {
      executor: 'nx:run-commands',
      cache: true,
      inputs: ['default', '^default'],
      outputs: [`{workspaceRoot}/dist/out-tsc/${library}`],
      options: {
        cwd: '{workspaceRoot}',
        command: `ngc -p ${library}/tsconfig.lib.json --outDir dist/out-tsc/${library}`,
      },
    },
  };
}

/** The titles of the tests the plugin's specs hold, `it.todo` and skipped ones apart. */
function testTitles(source: PluginSource): Set<string> {
  const titles = new Set<string>();
  for (const [path, text] of Object.entries(source.files)) {
    if (!/\.spec\.ts$/.test(path)) continue;
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'it' || node.expression.text === 'test') &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        node.arguments.length > 1
      )
        titles.add(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return titles;
}

/** The lines of a README's "Not kept" section, where a behaviour left out is named, with why. */
function notKeptOf(readme: string): string[] {
  const section = /^## Not kept\s*\n([^]*?)(?=^## |(?![^]))/m.exec(readme)?.[1] ?? '';
  return section.split('\n');
}

/** What registering the plugin added to the app's registries: its one component, and nothing else. */
function holdRegistered(source: PluginSource, run: PluginRun): string[] {
  const findings: string[] = [];
  if (run.registered === undefined) return findings;
  const component = pluginMetadata(source)?.component;
  for (const [registry, ids] of Object.entries(run.registered))
    for (const id of ids)
      if (!(registry === 'components' && id === component))
        findings.push(
          `${source.library} registers ${id} among the ${registry}, beside its component: the plugin of one element registers its component alone`,
        );
  if (!(run.registered['components'] ?? []).includes(component ?? ''))
    findings.push(
      `${source.library} does not register its component, ${String(component)}, through its provider`,
    );
  return findings;
}

/** What the plugin's run must have found: its own tests passing, and every gate. */
function holdRun(element: CustomElement, source: PluginSource, run: PluginRun): string[] {
  const findings: string[] = [];
  const { tests } = run;
  if (tests.error !== undefined)
    findings.push(`${source.library}'s own tests did not run: ${firstLine(tests.error)}`);
  for (const failed of tests.failed.slice(0, 10))
    findings.push(`${source.library}'s own test fails: ${failed}`);
  if (tests.failed.length > 10)
    findings.push(`${source.library} has ${tests.failed.length - 10} more failing tests`);
  for (const unwritten of tests.unwritten.slice(0, 10))
    findings.push(`${source.library}'s own test is still to write, or skipped: ${unwritten}`);
  if (tests.unwritten.length > 10)
    findings.push(`${source.library} has ${tests.unwritten.length - 10} more tests still to write`);
  if (tests.error === undefined && tests.passed === 0)
    findings.push(`${source.library}'s own tests hold no test that passes`);
  for (const file of tests.empty ?? [])
    findings.push(
      `${source.library}/${file} ran no test: a describe.skip, or the like, takes them all away`,
    );
  if (run.seenError !== undefined)
    findings.push(
      `the harness could not read what the plugin of ${element.name} shows and registers: ${firstLine(run.seenError)}`,
    );
  // A spec of the element's behaviour, not only of its registration.
  const specs = Object.keys(source.files).filter(
    (path) => /\.spec\.ts$/.test(path) && path !== 'src/lib/extensions.spec.ts',
  );
  if (specs.length === 0)
    findings.push(
      `${source.library} has no spec of ${element.name}'s behaviour, only of its registration`,
    );
  if (run.guardrail && !run.guardrail.passed)
    findings.push(
      `${source.library} fails the platform's customer guardrail, check-extension-library.mjs: ${firstLine(run.guardrail.output) || 'it exited with a failure'}`,
    );
  for (const [gate, result] of Object.entries(run.gates ?? {}))
    if (!result.passed)
      findings.push(
        `${source.library} fails ${gate}: ${firstLine(result.output) || 'it exited with a failure'}`,
      );
  return findings;
}

/** What the plugin showed, asked and emitted on each record, against what the element did. */
function holdValues(element: CustomElement, observed: ObservedElement, run: PluginRun): string[] {
  const findings: string[] = [];
  const name = element.name;
  if (run.seen === undefined) {
    if (run.seenError === undefined)
      findings.push(
        `the harness could not read what the plugin of ${name} shows: its spec wrote nothing`,
      );
    return findings;
  }
  const events = (fired: readonly { event: string; detail: unknown }[]) =>
    fired.map((one) => ({ output: camelCase(one.event), detail: detailOf(one.detail) }));
  const outputs = (emitted: readonly { output: string; detail: unknown }[]) =>
    emitted.map((one) => ({ output: one.output, detail: detailOf(one.detail) }));
  for (const record of observed.records) {
    const seen = run.seen.find((candidate) => candidate.record === record.record);
    const where = `${name}, on ${record.record}`;
    if (!seen) {
      findings.push(`${where}: the plugin was not shown the record`);
      continue;
    }
    if (seen.error !== undefined) {
      findings.push(`${where}: the plugin could not be drawn: ${firstLine(seen.error)}`);
      continue;
    }
    if (shown(seen.shows) !== shown(record.shows))
      findings.push(
        `${where}: the plugin shows ${JSON.stringify(shown(seen.shows))}, where the element shows ${JSON.stringify(shown(record.shows))}`,
      );
    // As it is drawn: the requests, each the element's, and the events.
    const loads = record.loads ?? [];
    const asked = seen.loads ?? [];
    if (asked.length !== loads.length || !asked.every((ask, index) => sameAsk(ask, loads[index])))
      findings.push(
        `${where}: as it is drawn, the plugin asks ${asked.map(describeAsk).join('; ') || 'nothing'}, where the element asks ${loads.map(describeAsk).join('; ') || 'nothing'}`,
      );
    if (!isDeepStrictEqual(outputs(seen.fires ?? []), events(record.fires ?? [])))
      findings.push(
        `${where}: as it is drawn, the plugin emits ${JSON.stringify(outputs(seen.fires ?? []))}, where the element fires ${JSON.stringify(events(record.fires ?? []))}`,
      );
    // Every button it shows is one the observed behaviour presses, so none goes unheld.
    const pressedHere = new Set((record.clicks ?? []).map((click) => click.button));
    for (const button of seen.buttons ?? [])
      if (!pressedHere.has(button))
        findings.push(
          `${where}: the plugin shows a button ${JSON.stringify(button)}, which the observed behaviour never presses`,
        );
    for (const click of record.clicks ?? []) {
      const pressed = seen.clicks?.find((candidate) => candidate.button === click.button);
      if (!pressed || !pressed.found) {
        findings.push(
          `${where}: the plugin offers no button ${JSON.stringify(click.button)}, where the element does`,
        );
        continue;
      }
      if (click.asks === null && pressed.asks.length > 0)
        findings.push(
          `${where}: pressing ${JSON.stringify(click.button)} asks the server ${describeAsk(pressed.asks[0])}, where the element asks nothing`,
        );
      else if (click.asks !== null && pressed.asks.length !== 1)
        findings.push(
          `${where}: pressing ${JSON.stringify(click.button)} sends ${pressed.asks.length} requests, where the element sends one, ${describeAsk(click.asks)}`,
        );
      else if (click.asks !== null && !sameAsk(pressed.asks[0], click.asks))
        findings.push(
          `${where}: pressing ${JSON.stringify(click.button)} asks ${describeAsk(pressed.asks[0])}, where the element asks ${describeAsk(click.asks)}`,
        );
      const expected = events(click.fires);
      const emitted = outputs(pressed.fires);
      if (!isDeepStrictEqual(emitted, expected))
        findings.push(
          `${where}: pressing ${JSON.stringify(click.button)} emits ${JSON.stringify(emitted)}, where the element fires ${JSON.stringify(expected)}`,
        );
    }
  }
  return findings;
}

function describeAsk(ask: {
  readonly operation: string | null;
  readonly input: unknown;
  readonly params: unknown;
}): string {
  return `${ask.operation ?? 'no operation'} on ${JSON.stringify(ask.input ?? null)} with ${JSON.stringify(ask.params ?? {})}`;
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => /error|fail|cannot|not /i.test(line)) ??
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)[0] ??
    ''
  ).slice(0, 300);
}

/**
 * Whether the template calls `provider` as it imports it from `importPath`: a call of a name the
 * file binds to that export of that module, by its syntax tree, so that a comment, another module's
 * function of the same name, or the import renamed and another function called, is not taken.
 */
function callsImported(
  template: { readonly path: string; readonly text: string },
  importPath: string,
  provider: string,
): boolean {
  const file = ts.createSourceFile(template.path, template.text, ts.ScriptTarget.Latest, true);
  const bound = new Set<string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== importPath ||
      statement.importClause?.isTypeOnly
    )
      continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements)
      if (!element.isTypeOnly && (element.propertyName ?? element.name).text === provider)
        bound.add(element.name.text);
  }
  let called = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      bound.has(node.expression.text)
    )
      called = true;
    if (!called) ts.forEachChild(node, visit);
  };
  visit(file);
  return called;
}

/** Whether the template imports the plugin, by its import path or its directory. */
function builtIn(
  template: string,
  element: CustomElement,
  source: PluginSource | undefined,
): boolean {
  const metadata = source ? pluginMetadata(source) : null;
  const paths = [
    `@agentic-ui/${element.name}`,
    ...(typeof metadata?.importPath === 'string' ? [metadata.importPath] : []),
  ];
  const code = withoutComments(template);
  return (
    paths.some((path) => new RegExp(`['"]${escape(path)}['"]`).test(code)) ||
    code.includes(pluginLibraryOf(element))
  );
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The component of a plugin whose selector is the element's name, with its inputs and outputs. */
export function componentOf(
  source: PluginSource,
  selector: string,
): {
  readonly path: string;
  readonly inputs: readonly string[];
  readonly models: readonly string[];
  readonly outputs: readonly string[];
} | null {
  for (const [path, text] of Object.entries(source.files)) {
    if (!shipped(path) || !path.endsWith('.ts')) continue;
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
      if (!ts.isClassDeclaration(statement)) continue;
      const options = ts
        .getDecorators(statement)
        ?.map((decorator) => decorator.expression)
        .find(
          (call): call is ts.CallExpression =>
            ts.isCallExpression(call) &&
            ts.isIdentifier(call.expression) &&
            call.expression.text === 'Component',
        )?.arguments[0];
      if (!options || !ts.isObjectLiteralExpression(options)) continue;
      const declared = options.properties.find(
        (property) =>
          property.name && ts.isIdentifier(property.name) && property.name.text === 'selector',
      );
      if (
        !declared ||
        !ts.isPropertyAssignment(declared) ||
        !ts.isStringLiteralLike(declared.initializer) ||
        declared.initializer.text !== selector
      )
        continue;
      const members = (kinds: readonly string[]): string[] =>
        statement.members.flatMap((member) => {
          if (
            !ts.isPropertyDeclaration(member) ||
            !member.initializer ||
            !ts.isIdentifier(member.name)
          )
            return [];
          const call = member.initializer;
          if (!ts.isCallExpression(call)) return [];
          const callee = call.expression.getText(file);
          return kinds.includes(callee) ? [member.name.text] : [];
        });
      return {
        path,
        inputs: members(['input', 'input.required', 'model', 'model.required']),
        models: members(['model', 'model.required']),
        outputs: members(['output', 'outputFromObservable']),
      };
    }
  }
  return null;
}
