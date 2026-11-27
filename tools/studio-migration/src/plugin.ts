/**
 * The `plugin` command: the code track's scaffold (docs/business-apps/studio-migration.md,
 * section 4). For one custom element of a package, it writes a Layer 2 plugin library from the
 * template a customer's own code is written from, `nx g ./tools/satori-generators:extension-library`,
 * and replaces that generator's samples with the element's:
 *
 * - a standalone component, registered by ID behind a lazy import, with an `input()` for each of
 *   the element's properties that is not its own state and an `output()` for each event it fires;
 * - a spec skeleton, an `it.todo` for each behaviour the inventory read from the element: what it
 *   shows, its conditions, its listeners, the events it fires and the operations it runs. Check 9
 *   fails while any is left, so each becomes a test before a person accepts the plugin;
 * - the element's texts, in the package's own language, as its `messages.json` gives them;
 * - `studio-plugin.json`, which names the element, the package and the element's definition it was
 *   written from, the component's ID and the provider, for check 9 to hold the plugin to them.
 *
 * It writes no behaviour: that is the Code agent's, following `.cursor/skills/studio-plugin/
 * SKILL.md`. Nothing from the package runs, and the element's code is not copied into the plugin's
 * code: its template and script are quoted in the plugin's README, for the person who writes it.
 *
 * Until decision 5's spike proves signed, pinned plugins, a plugin is built into the customer's app
 * from the template: one line in the fork's `app.config.ts`, which the command prints.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readCatalogue } from './convert';
import { pluginLibraryOf, PLUGIN_DIRECTORY } from './convert-elements';
import { pluginInterface, type CustomElement, type ElementProperty } from './elements';
import type { Inventory } from './inventory';
import type { StudioPackage } from './studio-package';

export const PLUGIN_FORMAT = 'studio-migration-plugin/1';
/** The file of a plugin library that says what it is the plugin of. */
export const PLUGIN_FILE = 'studio-plugin.json';
/** The template a customer's Layer 2 library is generated from. */
export const LIBRARY_GENERATOR = './tools/satori-generators:extension-library';

/** What `studio-plugin.json` holds. */
export interface PluginMetadata {
  readonly format: typeof PLUGIN_FORMAT;
  readonly element: string;
  /** The package it was written from, and the SHA-256 of the element's definition there. */
  readonly package: { readonly name: string; readonly version: string };
  readonly definition: string;
  readonly project: string;
  readonly importPath: string;
  /** The function the library's `index.ts` exports, which an app's providers call. */
  readonly provider: string;
  /** The ID the component is registered under. */
  readonly component: string;
}

export class PluginError extends Error {
  override readonly name = 'PluginError';
}

/** The names a plugin library is given, from its element and its owner. */
export interface PluginNames {
  readonly element: string;
  readonly owner: string;
  readonly library: string;
  readonly project: string;
  readonly importPath: string;
  /** `AcmeClaimExposure`. */
  readonly className: string;
  readonly provider: string;
  readonly idsConstant: string;
  readonly textsConstant: string;
  readonly componentId: string;
  readonly componentClass: string;
}

const pascal = (name: string): string =>
  name
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
const camel = (name: string): string => {
  const value = pascal(name);
  return value.charAt(0).toLowerCase() + value.slice(1);
};
const constant = (name: string): string => name.replace(/[-.]+/g, '_').toUpperCase();

/**
 * The owner prefix: the given one, or the element's own, the part of its name before its first
 * hyphen, as `acme` of `acme-claim-exposure`.
 */
export function pluginNames(element: string, owner?: string): PluginNames {
  const prefix = owner ?? element.slice(0, element.indexOf('-'));
  if (!/^[a-z][a-z0-9]*$/.test(prefix))
    throw new PluginError(
      `"${prefix}" cannot prefix the plugin's IDs: an owner is lower-case letters and digits, starting with a letter. Give one with --owner`,
    );
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(element))
    throw new PluginError(
      `"${element}" cannot name a library: the generator takes kebab-case names of letters and digits`,
    );
  const rest = element.startsWith(`${prefix}-`) ? element.slice(prefix.length + 1) : element;
  const className = pascal(element);
  return {
    element,
    owner: prefix,
    library: pluginLibraryOf({ name: element }),
    project: element,
    importPath: `@agentic-ui/${element}`,
    className,
    provider: `provide${className}Plugin`,
    idsConstant: `${constant(element)}_PLUGIN_IDS`,
    textsConstant: `${constant(element)}_TEXTS`,
    componentId: `${prefix}.components.${camel(rest)}`,
    componentClass: `${className}Component`,
  };
}

/** A property's TypeScript type, as an input of the plugin. */
function inputType(property: ElementProperty): string {
  if (property.name === 'document') return 'NuxeoDocument | null';
  switch (property.type) {
    case 'String':
      return 'string';
    case 'Number':
      return 'number';
    case 'Boolean':
      return 'boolean';
    case 'Array':
      return 'readonly unknown[]';
    case 'Date':
      return 'Date | null';
    default:
      return 'unknown';
  }
}

/**
 * A property's default, when the element writes it as a literal the input can take as it is: a
 * number, a quoted string, `true` or `false`. Anything else is not evaluated: the input starts
 * empty, and the README says what the element wrote.
 */
function literalDefault(property: ElementProperty): string | null {
  const value = property.value?.trim() ?? null;
  if (value === null) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value) || value === 'true' || value === 'false') return value;
  if (/^'[^'\\\n]*'$/.test(value) || /^"[^"\\\n]*"$/.test(value)) return `'${value.slice(1, -1)}'`;
  return null;
}

const quoted = (text: string): string => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The element's template and script, as the custom bundle holds them, for the README. */
export function elementSource(pkg: StudioPackage, element: CustomElement): string {
  const text = pkg.bundleFiles.get(element.path)?.toString('utf8') ?? '';
  const start = text.search(
    new RegExp(`<dom-module\\s[^>]*id\\s*=\\s*["']${element.name.replace(/[.]/g, '\\.')}["']`),
  );
  if (start === -1) return '';
  const end = text.indexOf('</dom-module>', start);
  return text.slice(start, end === -1 ? undefined : end + '</dom-module>'.length);
}

/**
 * Every file the command writes over the library the generator wrote, by its path under the
 * library. `texts` are the package's own language's, for the keys the element translates.
 */
export function pluginFiles(
  pkg: StudioPackage,
  inventory: Inventory,
  element: CustomElement,
  names: PluginNames,
): Record<string, string> {
  const { inputs, outputs } = pluginInterface(element);
  const properties = element.properties.filter(
    (property) => !property.internal && property.computed === null,
  );
  const texts = elementTexts(pkg, inventory, element);
  const dir = `src/lib/${names.element}`;
  const metadata: PluginMetadata = {
    format: PLUGIN_FORMAT,
    element: element.name,
    package: { name: pkg.descriptor.name, version: pkg.descriptor.version },
    definition: element.sha256,
    project: names.project,
    importPath: names.importPath,
    provider: names.provider,
    component: names.componentId,
  };

  const inputLines = properties.flatMap((property) => {
    const fallback = literalDefault(property);
    const type = inputType(property);
    const initial = fallback ?? (type.endsWith('| null') ? 'null' : 'undefined');
    const typed = fallback === null && !type.endsWith('| null') ? `${type} | undefined` : type;
    return [
      `  /** The element's \`${property.name}\`${property.type ? ` (${property.type})` : ''}${
        property.value !== null ? `, by default \`${property.value}\` in the element` : ''
      }. */`,
      `  readonly ${inputs[properties.indexOf(property)]} = input<${typed}>(${initial});`,
    ];
  });
  // One output per event, in the order the element first fires each: `outputs` is in that order.
  const events = element.events.filter(
    (event, index, all) => all.findIndex((other) => other.name === event.name) === index,
  );
  const outputLines = events.flatMap((event, index) => [
    `  /** Fired as the element fires \`${event.name}\`${
      event.detail ? `, with ${event.detail.replace(/\*\//g, '* /').replace(/\s+/g, ' ')}` : ''
    }. */`,
    `  readonly ${outputs[index]} = output<unknown>();`,
  ]);
  const usesDocument = properties.some((property) => property.name === 'document');

  const component = [
    `import { ChangeDetectionStrategy, Component${inputLines.length ? ', input' : ''}${outputLines.length ? ', output' : ''} } from '@angular/core';`,
    ...(usesDocument
      ? [`import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';`]
      : []),
    '',
    `import { ${names.textsConstant} } from '../texts';`,
    '',
    '/**',
    ` * \`${names.componentId}\`: the plugin of the custom element \`${element.name}\`, from`,
    ` * ${pkg.descriptor.name} ${pkg.descriptor.version}'s custom bundle (${element.path}).`,
    ' *',
    ' * Registered by ID behind a lazy import, so nothing in the host imports this class: a manifest',
    ' * places it, and `ExtensionOutletComponent` resolves it. Its inputs and outputs are the',
    " * element's interface, as the inventory read it. What it shows and does is still to write, from",
    ' * the element, following .cursor/skills/studio-plugin/SKILL.md: the README quotes the element.',
    ' */',
    '@Component({',
    `  selector: '${element.name}',`,
    '  standalone: true,',
    `  templateUrl: './${names.element}.html',`,
    `  styleUrl: './${names.element}.scss',`,
    '  changeDetection: ChangeDetectionStrategy.OnPush,',
    '})',
    `export class ${names.componentClass} {`,
    ...inputLines,
    ...outputLines,
    '',
    "  /** A text of the element, in the package's language; the key itself for one it does not hold, as Web UI's `i18n` shows it. */",
    '  protected text(key: string): string {',
    `    return ${names.textsConstant}[key] ?? key;`,
    '  }',
    '}',
    '',
  ].join('\n');

  const todos = (group: Behaviour['group']): string[] =>
    behaviours(element)
      .filter((behaviour) => behaviour.group === group)
      .map((behaviour) => `  it.todo(${quoted(behaviour.title)});`);
  const shows = todos('shows');
  const attributes = todos('gives');
  const conditions = todos('conditions');
  const listeners = todos('listens');
  const fires = todos('fires');
  const runs = todos('runs');
  const spec = [
    `import { TestBed } from '@angular/core/testing';`,
    `import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';`,
    '',
    `import { ${names.idsConstant}, ${names.provider} } from '../extensions';`,
    '',
    '/**',
    ` * The plugin held to what the custom element \`${element.name}\` does, as the inventory read it`,
    ' * from the package. Each `it.todo` is one of its behaviours: write it as a test of the plugin, on',
    ' * the records of the observed behaviour where it shows something, and check 9 fails while any is',
    " * left. A behaviour the plugin does not keep is a person's decision, written in the README.",
    ' */',
    `describe('${element.name}, as a plugin', () => {`,
    `  beforeEach(() => TestBed.configureTestingModule({ providers: [${names.provider}()] }));`,
    '',
    "  it('is registered under its component ID, and resolves', async () => {",
    `    const registry = TestBed.inject(ExtensionComponentRegistry);`,
    `    expect(await registry.resolve(${names.idsConstant}.components[0])).not.toBeNull();`,
    '  });',
    '',
    ...(shows.length
      ? ['  // What it shows: the text bindings of its template.', ...shows, '']
      : []),
    ...(attributes.length
      ? ['  // What its template gives the elements it holds.', ...attributes, '']
      : []),
    ...(conditions.length ? ['  // Its conditions.', ...conditions, ''] : []),
    ...(listeners.length ? ['  // What it listens to.', ...listeners, ''] : []),
    ...(fires.length ? ['  // The events it fires, each an output.', ...fires, ''] : []),
    ...(runs.length ? ['  // The operations it runs.', ...runs, ''] : []),
    '});',
    '',
  ].join('\n');

  const extensions = [
    `import type { EnvironmentProviders } from '@angular/core';`,
    '',
    `import { provideSatoriExtensions } from '@nuxeo/satori-platform/extensions';`,
    '',
    '/**',
    ` * Every ID this plugin registers. IDs are a public contract: once a manifest places`,
    ` * \`${names.componentId}\`, renaming it is a breaking change.`,
    ' */',
    `export const ${names.idsConstant} = Object.freeze({`,
    '  components: [',
    `    '${names.componentId}',`,
    '    // satori:ids:components — `nx g ...:extension-component` inserts here. Keep the marker.',
    '  ],',
    '} as const);',
    '',
    '/**',
    ` * The plugin of the custom element \`${element.name}\`: add it to an app's providers. Nothing`,
    ' * here runs until then, and the component shows only where a manifest places it.',
    ' */',
    `export function ${names.provider}(): EnvironmentProviders {`,
    '  return provideSatoriExtensions({',
    '    components: {',
    `      [${names.idsConstant}.components[0]]: () =>`,
    `        import('./${names.element}/${names.element}').then((m) => m.${names.componentClass}),`,
    '      // satori:register:components',
    '    },',
    '  });',
    '}',
    '',
  ].join('\n');

  const registration = [
    `import { TestBed } from '@angular/core/testing';`,
    '',
    `import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';`,
    '',
    `import { ${names.idsConstant}, ${names.provider} } from './extensions';`,
    '',
    '/** Asserted against the registry, so a registration that does nothing fails. */',
    `describe('${names.provider}', () => {`,
    `  beforeEach(() => TestBed.configureTestingModule({ providers: [${names.provider}()] }));`,
    '',
    "  it('registers its component, and nothing it does not list', () => {",
    '    const registry = TestBed.inject(ExtensionComponentRegistry);',
    `    for (const id of ${names.idsConstant}.components) expect(registry.has(id)).toBe(true);`,
    `    expect(registry.registeredComponentIds().filter((id) => id.startsWith('${names.owner}.'))).toEqual([`,
    `      ...${names.idsConstant}.components,`,
    '    ]);',
    '  });',
    '});',
    '',
  ].join('\n');

  const textEntries = Object.entries(texts);
  const textsFile = [
    '/**',
    ` * The texts the custom element \`${element.name}\` translates with \`i18n\`, in the package's own`,
    ' * language, as its messages.json gives them. A key it does not hold is shown as the key, as Web',
    ' * UI shows it. Another language is not carried: the template provides no translation service.',
    ' */',
    `export const ${names.textsConstant}: Readonly<Record<string, string>> = Object.freeze({`,
    ...textEntries.map(([key, value]) => `  ${quoted(key)}: ${quoted(value)},`),
    '});',
    '',
  ].join('\n');

  const markup = elementSource(pkg, element);
  const readme = [
    `# ${names.importPath}`,
    '',
    `The Layer 2 plugin of the custom element \`${element.name}\`, from the custom bundle of`,
    `${pkg.descriptor.name} ${pkg.descriptor.version} (\`${element.path}\`), written by the Studio`,
    `migration's code track (\`npm run studio-migration -- plugin\`, M3 in`,
    '[docs/business-apps/studio-migration.md](../../../docs/business-apps/studio-migration.md)).',
    '',
    `It registers one component, \`${names.componentId}\`, and nothing else. It is inert until an`,
    'app adds its provider, and the component shows only where a manifest places it.',
    '',
    '## Built in from the template',
    '',
    'Until decision 5 proves signed, pinned plugins loaded at run time, a plugin is built into the',
    "customer's app from the template. Add one line to the fork's `app.config.ts`:",
    '',
    '```ts',
    `import { ${names.provider} } from '${names.importPath}';`,
    `// providers: [ ..., ${names.provider}() ]`,
    '```',
    '',
    '## Where it shows',
    '',
    `In Web UI, the package used it in: ${element.uses.length ? element.uses.map((use) => `\`${use}\``).join(', ') : 'nothing'}.`,
    "Where the plugin shows in the app is a person's call, made when they accept it: a manifest",
    'entry naming the component, in a slot that draws components (docs/extension-reference.md:',
    '`tabs`, `documentView`, `sidebar`, or a route).',
    '',
    '## The element it replaces',
    '',
    `Its interface, as a plugin: inputs ${inputs.map((name) => `\`${name}\``).join(', ') || 'none'}; outputs ${outputs.map((name) => `\`${name}\``).join(', ') || 'none'}.`,
    `Behaviours it used: ${element.behaviours.map((name) => `\`${name}\``).join(', ') || 'none'}.`,
    '',
    'As the package defines it, quoted for the person who writes the plugin. It is never run, and',
    "none of it is copied into the plugin's code:",
    '',
    '```html',
    markup,
    '```',
    '',
    '## Check 9',
    '',
    'Before a person accepts it, the harness holds it to the element: its own tests pass, with no',
    '`it.todo` left; it passes lint, test, build and typecheck; a scan finds no unsafe pattern; and it',
    'shows the same values as the element on the same records, from the observed behaviour.',
    '',
    '```bash',
    'npm run studio-migration -- check <package.zip> <conversion> --run-plugins --observed <observed.json>',
    '```',
    '',
  ].join('\n');

  return {
    [PLUGIN_FILE]: `${JSON.stringify(metadata, null, 2)}\n`,
    'README.md': readme,
    'src/index.ts': [
      '/**',
      ` * \`${names.importPath}\`: the plugin of the custom element \`${element.name}\`. An app needs its`,
      ' * provider, and nothing else: the component is reached by its ID.',
      ' */',
      `export { ${names.idsConstant}, ${names.provider} } from './lib/extensions';`,
      '',
    ].join('\n'),
    'src/lib/extensions.ts': extensions,
    'src/lib/extensions.spec.ts': registration,
    'src/lib/texts.ts': textsFile,
    [`${dir}/${names.element}.ts`]: component,
    [`${dir}/${names.element}.html`]: `<!-- What ${element.name} shows: still to write, from the element (README.md). -->\n`,
    [`${dir}/${names.element}.scss`]: ':host {\n  display: block;\n}\n',
    [`${dir}/${names.element}.spec.ts`]: spec,
  };
}

/** One behaviour the inventory read from an element, which a test of its plugin is named after. */
export interface Behaviour {
  readonly group: 'shows' | 'gives' | 'conditions' | 'listens' | 'fires' | 'runs';
  readonly title: string;
}

/**
 * Each behaviour of an element, as the plugin's spec skeleton names its `it.todo`: what its
 * template shows, what it gives the elements it holds, its conditions, its listeners, the events it
 * fires and the operations it runs. Check 9 holds the plugin's specs to a test of each title, or to
 * a line of its README's "Not kept" saying why not. A condition's own `if` is its condition's.
 */
export function behaviours(element: CustomElement): Behaviour[] {
  const ifs = new Set(
    element.conditions.map((condition) => condition.replace(/^dom-if /, '')).filter(Boolean),
  );
  const list: Behaviour[] = [];
  const add = (group: Behaviour['group'], title: string): void => {
    if (!list.some((behaviour) => behaviour.title === title)) list.push({ group, title });
  };
  for (const binding of element.bindings.filter((bound) => bound.attribute === null))
    add('shows', `shows [[${binding.expression}]] as the element does, on each record`);
  for (const binding of element.bindings) {
    if (binding.attribute === null || binding.element === 'nuxeo-operation') continue;
    if (binding.attribute === 'if' && ifs.has(`[[${binding.expression}]]`)) continue;
    add(
      'gives',
      `gives ${binding.element} ${binding.attribute} [[${binding.expression}]] as the element does`,
    );
  }
  for (const condition of element.conditions)
    add('conditions', `shows what ${condition} holds only while it passes`);
  for (const listener of element.listeners)
    add('listens', `on ${listener.replace(' → ', ', does what ')} does`);
  for (const event of element.events)
    add(
      'fires',
      `emits ${event.name} as the element fires it${event.detail ? `, with ${event.detail.replace(/\s+/g, ' ')}` : ''}`,
    );
  for (const operation of element.operations)
    add(
      'runs',
      `runs ${operation.operation} through the app's HTTP service, as ${operation.element} does with ${Object.entries(
        operation.attributes,
      )
        .filter(([name]) => name !== 'id')
        .map(([name, value]) => `${name}="${value}"`)
        .join(' ')}`,
    );
  return list;
}

/** The files of a plugin library its build and tests read, as the template writes them. */
export const TEMPLATE_CONFIGURATION = [
  'vite.config.mts',
  'tsconfig.json',
  'tsconfig.lib.json',
  'tsconfig.spec.json',
  'src/test-setup.ts',
] as const;

/**
 * Those files as the generator writes them for a library at `library`, from its own templates:
 * what check 9 runs a plugin's tests with, and holds the plugin's own to, so that a plugin cannot
 * change how it is tested. `null` for a file the generator does not hold.
 */
export function templateConfiguration(
  workspace: string,
  library: string,
): Record<string, string | null> {
  const offsetFromRoot = '../'.repeat(library.split('/').length);
  const substitutions: Record<string, string> = {
    offsetFromRoot,
    rootDir: offsetFromRoot.replace(/\/$/, ''),
    projectRoot: library,
    projectName: library.slice(library.lastIndexOf('/') + 1),
  };
  const files: Record<string, string | null> = {};
  for (const path of TEMPLATE_CONFIGURATION) {
    const template = join(
      workspace,
      'tools',
      'satori-generators',
      'src',
      'extension-library',
      'files',
      ...`${path}__tmpl__`.split('/'),
    );
    files[path] = existsSync(template)
      ? readFileSync(template, 'utf8').replace(/<%=\s*(\w+)\s*%>/g, (whole, key: string) =>
          Object.hasOwn(substitutions, key) ? substitutions[key] : whole,
        )
      : null;
  }
  return files;
}

/** The element's texts, by key, in the package's own language: English, or else the first. */
export function elementTexts(
  pkg: StudioPackage,
  inventory: Inventory,
  element: CustomElement,
): Record<string, string> {
  const locale =
    inventory.translations.find((translations) => translations.locale === 'en') ??
    inventory.translations[0];
  const catalogue = locale ? readCatalogue(pkg, locale.path) : {};
  const texts: Record<string, string> = {};
  for (const key of element.texts) {
    const value = Object.hasOwn(catalogue, key) ? catalogue[key] : undefined;
    if (typeof value === 'string')
      Object.defineProperty(texts, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return texts;
}

/** The generator's samples, which a plugin of one element does not keep. */
export const GENERATED_SAMPLES = ['src/lib/rules.service.ts', 'src/lib/panel/'] as const;

/** What runs a command for the `plugin` command, as `spawnSync` does: injected by the tests. */
export type Spawn = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr' | 'error'>;

const spawnTool: Spawn = (command, args, options) =>
  spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    env: {
      ...childEnvironment(),
      NX_DAEMON: 'false',
      NX_INTERACTIVE: 'false',
      // The generators are TypeScript whose imports name no extension: Node 24's own type
      // stripping loads them as ES modules and cannot resolve those imports, so it is turned off
      // and Nx's swc-node loader, which this workspace installs, reads them. Seen failing without.
      NODE_OPTIONS: childNodeOptions('--no-experimental-strip-types'),
    },
  });

/**
 * The environment a child tool is given: this one, less `_`, the path of the program the shell
 * ran. Nx reads it to tell how it was started, and given tsx's, which `npm run studio-migration`
 * runs this tool with, it loaded the generators as plain JavaScript and failed on their types: seen,
 * and found by taking the variables away one at a time.
 */
export function childEnvironment(): NodeJS.ProcessEnv {
  const { _: _ran, ...rest } = process.env;
  return rest;
}

/**
 * `NODE_OPTIONS` for a child Node process: the caller's, less any loader a TypeScript runner such
 * as tsx put there for itself, which would make the child load its TypeScript a third way, plus
 * `extra`. `--no-experimental-webstorage`, which Node 25 needs here, is kept.
 */
export function childNodeOptions(...extra: readonly string[]): string {
  const given = (process.env['NODE_OPTIONS'] ?? '').split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (let index = 0; index < given.length; index++) {
    const option = given[index];
    if (/^--(?:require|import|loader|experimental-loader)$/.test(option)) {
      index++;
      continue;
    }
    if (/^(?:--(?:require|import|loader|experimental-loader)=|-r)/.test(option)) continue;
    kept.push(option);
  }
  return [...kept, ...extra].join(' ');
}

/** Nx's own entry point, run with Node and no shell, as scripts/beta-harness/package-command.mjs does. */
export function nxEntry(workspace: string): string {
  const manifest = join(workspace, 'node_modules', 'nx', 'package.json');
  if (!existsSync(manifest))
    throw new PluginError(
      `${workspace} has no node_modules/nx: run the command from a copy of the repository after \`npm ci\``,
    );
  const bin = (JSON.parse(readFileSync(manifest, 'utf8')) as { bin: { nx: string } }).bin.nx;
  return resolve(dirname(manifest), bin);
}

export interface PluginRequest {
  readonly workspace: string;
  readonly owner?: string;
}

/**
 * Writes the plugin library of `elementName` into the workspace: the generator first, then the
 * element's files over its samples. Refuses an element the package does not define, and a library
 * that is already there, so it never writes over a plugin someone has worked on.
 */
export function scaffoldPlugin(
  pkg: StudioPackage,
  inventory: Inventory,
  elementName: string,
  request: PluginRequest,
  spawn: Spawn = spawnTool,
): { readonly names: PluginNames; readonly written: readonly string[] } {
  const element = inventory.customElements.find((candidate) => candidate.name === elementName);
  if (!element)
    throw new PluginError(
      `the package defines no custom element ${elementName}; its custom elements are ${
        inventory.customElements.map((candidate) => candidate.name).join(', ') || 'none'
      }`,
    );
  const names = pluginNames(element.name, request.owner);
  const root = join(request.workspace, ...names.library.split('/'));
  if (existsSync(root))
    throw new PluginError(
      `${names.library} already exists, and the plugin command never writes over a library: remove it, or give the plugin another owner`,
    );
  const ran = spawn(
    process.execPath,
    [
      nxEntry(request.workspace),
      'g',
      LIBRARY_GENERATOR,
      names.project,
      `--owner=${names.owner}`,
      `--directory=${PLUGIN_DIRECTORY}`,
      '--no-interactive',
    ],
    { cwd: request.workspace },
  );
  if (ran.error || ran.status !== 0 || !existsSync(root))
    throw new PluginError(
      `the generator did not write ${names.library}: ${(ran.error?.message ?? `${ran.stderr ?? ''}${ran.stdout ?? ''}`).trim() || `exit ${String(ran.status)}`}`,
    );
  for (const sample of GENERATED_SAMPLES)
    rmSync(join(root, ...sample.split('/')), { recursive: true, force: true });
  const files = pluginFiles(pkg, inventory, element, names);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, ...path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  // Laid out as the repository's Prettier lays out the generator's own files.
  const prettier = join(request.workspace, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
  if (existsSync(prettier))
    spawn(process.execPath, [prettier, '--write', '--log-level=warn', names.library], {
      cwd: request.workspace,
    });
  return { names, written: Object.keys(files).sort() };
}

/** What the command prints once it has written the library. */
export function nextSteps(names: PluginNames): string {
  return `Wrote ${names.library}, the plugin of ${names.element}, from the template (${LIBRARY_GENERATOR}).

  component  ${names.componentId}, in src/lib/${names.element}/
  provider   ${names.provider}, from ${names.importPath}

It registers the component and nothing else, and shows nothing yet. Next:

  1. Write the component and its tests from the element, following
     .cursor/skills/studio-plugin/SKILL.md: README.md quotes the element, and each it.todo in
     src/lib/${names.element}/${names.element}.spec.ts is one of its behaviours.
  2. Build it into the app from the template: add ${names.provider}() to the providers of the
     fork's apps/nuxeo-satori-template/src/app/app.config.ts.
  3. Run check 9 on it:
       npm run studio-migration -- check <package.zip> <conversion> --run-plugins --observed <observed.json>
  4. A person reviews it, places it with a manifest entry, and accepts it.
`;
}
