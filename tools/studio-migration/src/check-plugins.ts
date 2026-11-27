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
 * run. A plugin not written yet is in part too, never a failure: an agent writes it next. A plugin
 * passing check 9 is still only proposed, in the report, until a person accepts it.
 */
import { isDeepStrictEqual } from 'node:util';
import { pluginLibraryOf } from './convert-elements';
import { camelCase, pluginInterface, type CustomElement } from './elements';
import type { CheckOutcome, HarnessInput } from './harness';
import { shown, type ObservedElement } from './observed';
import {
  behaviours,
  PLUGIN_FILE,
  PLUGIN_FORMAT,
  TEMPLATE_CONFIGURATION,
  templateConfiguration,
} from './plugin';
import { pluginMetadata, type PluginRun } from './plugin-run';
import { scanConfiguration, scanPlugin, scanPublicApi, shipped } from './plugin-scan';
import type { PluginSource, PluginsInput } from './plugins';
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
    else if (entry.outcome !== 'proposed' && entry.outcome !== 'converted')
      findings.push(
        `the report gives the custom element ${element.name} as ${entry.outcome}, not as a plugin`,
      );
    else if (entry.to !== library)
      findings.push(
        `the report puts the plugin of ${element.name} at ${String(entry.to)}, not at ${library}, where the plugin command writes it`,
      );
    if (!plugins) continue;
    const source = plugins.sources.find((candidate) => candidate.element === element.name);
    if (!source) {
      waiting.push(`the plugin of ${element.name}, ${library}, is not written yet`);
      continue;
    }
    findings.push(...holdPlugin(input, element, source, plugins));
    const run = plugins.runs?.[element.name];
    if (!run) {
      waiting.push(`${element.name}'s tests, gates and values were not run`);
      continue;
    }
    findings.push(...holdRun(element, source, run));
    if (!run.gates) waiting.push(`${element.name}'s lint, test, build and typecheck were not run`);
    const observed = plugins.observed?.elements[element.name];
    if (!observed) waiting.push(`no observed behaviour of ${element.name} was given`);
    else findings.push(...holdValues(element, observed, run), ...holdRegistered(source, run));
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
  const { name, version } = input.pkg.descriptor;
  if (metadata.package?.name !== name || metadata.package?.version !== version)
    findings.push(
      `${file} was written from ${String(metadata.package?.name)} ${String(metadata.package?.version)}, not from the package given, ${name} ${version}`,
    );
  else if (metadata.definition !== element.sha256)
    findings.push(
      `the custom element ${element.name} has changed since its plugin was written: write the plugin again from the element as the package holds it now`,
    );

  // The element's interface, on the component the plugin registers.
  const component = componentOf(source, element.name);
  if (component === null)
    findings.push(
      `${source.library}: no component of the plugin has the selector ${element.name}, the element's name`,
    );
  else {
    const { inputs, outputs } = pluginInterface(element);
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
  }

  // Built in from the template.
  const template = plugins.template;
  if (template === null)
    findings.push(`the repository holds no template app to build ${source.library} into`);
  else if (
    !new RegExp(`from\\s+['"]${escape(metadata.importPath ?? '')}['"]`).test(template.text) ||
    !new RegExp(`\\b${escape(metadata.provider ?? '')}\\s*\\(`).test(withoutComments(template.text))
  )
    findings.push(
      `${template.path} does not build ${source.library} in: import ${String(metadata.provider)} from ${String(metadata.importPath)} and call it among its providers`,
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

  // A test of each behaviour the inventory read, or a reason in the README for leaving it.
  const titles = testTitles(source);
  const notKept = notKeptOf(source.files['README.md'] ?? '');
  for (const behaviour of behaviours(element))
    if (!titles.has(behaviour.title) && !notKept.includes(behaviour.title))
      findings.push(
        `${source.library} has no test of the element's behaviour ${JSON.stringify(behaviour.title)}, and its README's "Not kept" does not say why`,
      );

  findings.push(...scanPlugin(source), ...scanPublicApi(source));
  return findings;
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

/** The text of a README's "Not kept" section, where a behaviour left out is named, with why. */
function notKeptOf(readme: string): string {
  return /^## Not kept\s*\n([^]*?)(?=^## |(?![^]))/m.exec(readme)?.[1] ?? '';
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
  // A spec of the element's behaviour, not only of its registration.
  const specs = Object.keys(source.files).filter(
    (path) => /\.spec\.ts$/.test(path) && path !== 'src/lib/extensions.spec.ts',
  );
  if (specs.length === 0)
    findings.push(
      `${source.library} has no spec of ${element.name}'s behaviour, only of its registration`,
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
    findings.push(
      `the harness could not read what the plugin of ${name} shows: ${firstLine(run.seenError ?? 'its spec wrote nothing')}`,
    );
    return findings;
  }
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
      else if (click.asks !== null) {
        const [ask] = pressed.asks;
        if (
          ask.operation !== click.asks.operation ||
          !isDeepStrictEqual(ask.input ?? null, click.asks.input) ||
          !isDeepStrictEqual(ask.params ?? {}, click.asks.params)
        )
          findings.push(
            `${where}: pressing ${JSON.stringify(click.button)} asks ${describeAsk(ask)}, where the element asks ${describeAsk(click.asks)}`,
          );
      }
      const expected = click.fires.map((fired) => ({
        output: camelCase(fired.event),
        detail: fired.detail,
      }));
      const emitted = pressed.fires.map((fired) => ({
        output: fired.output,
        detail: fired.detail ?? null,
      }));
      if (!isDeepStrictEqual(emitted, expected))
        findings.push(
          `${where}: pressing ${JSON.stringify(click.button)} emits ${JSON.stringify(emitted)}, where the element fires ${JSON.stringify(expected)}`,
        );
    }
  }
  return findings;
}

function describeAsk(ask: { operation: string | null; input: unknown; params: unknown }): string {
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
        outputs: members(['output', 'outputFromObservable']),
      };
    }
  }
  return null;
}
