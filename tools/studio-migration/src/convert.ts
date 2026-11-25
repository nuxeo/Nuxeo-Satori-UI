/**
 * The conversion of phase M1, the declarative track, and the report every conversion writes.
 *
 * M1 writes an app definition under `app/` (docs/business-apps/app-definition-v2.md), which the
 * package pipeline's validator checks (harness check 10):
 *
 * - `app.json`, naming the app and its theme;
 * - `layouts/<Type>/<mode>.layout.json`, from the document layouts (`convert-layouts.ts`);
 * - `queues/<id>.json`, from the search screens and the dashboard's lists (`convert-lists.ts`);
 * - `actions.json`, from the operation buttons (`convert-slots.ts`);
 * - `tasks/<workflow>.<step>.layout.json`, from the workflow task layouts (`convert-tasks.ts`), in
 *   M2, which also writes the layout blocks a layout uses as its cards (`blocks.ts`) and the tabs
 *   of a type's view file (`convert-tabs.ts`);
 * - `labels/<locale>.json`, from the translations.
 *
 * Beside it, as M0 did, `themes/<name>.json` holds the tokens of each theme's mappable properties
 * for the bootstrap configuration (Layer 0), and `themes/<name>/<file>` its files.
 *
 * Every construct is listed in the report with an outcome and, where it needs one, its reason:
 *
 * - **converted:** done, and where it went;
 * - **proposed:** an agent proposes it and a person accepts it;
 * - **reported:** it does not migrate, or not as Web UI shows it, with why;
 * - **generated:** Studio's own packaging, records and templates;
 * - **server:** it stays on the server, where the new app reads it;
 * - **pending:** a later phase converts it, and the note says which.
 *
 * Check 1 counts every outcome as accounted for. A migration with anything pending is not ready.
 * The format is provisional, `studio-migration-report/m1`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateLabels } from '@agentic-ui/shared/app-definition';
import { appIdOf, labelsPath, labelTexts } from './app-files';
import { mapThemeProperty, scriptEntry, type Catalogue } from './catalogue';
import { decideCondition } from './conditions';
import { constructsOf, type Construct, type ConstructKind } from './constructs';
import { convertBlocks } from './convert-blocks';
import { convertLayouts } from './convert-layouts';
import { convertDashboard, convertSearches } from './convert-lists';
import { convertSlots } from './convert-slots';
import { convertTasks } from './convert-tasks';
import { DECISIONS_FILE } from './decisions';
import type { FileKind, Inventory } from './inventory';
import type { StudioPackage, StudioPackageDescriptor } from './studio-package';
import { resolveThemeProperty } from './theme';

export const OUTCOMES = [
  'converted',
  'proposed',
  'reported',
  'generated',
  'server',
  'pending',
] as const;
export type Outcome = (typeof OUTCOMES)[number];
/** The outcomes that must say why. */
export const EXPLAINED: ReadonlySet<string> = new Set<Outcome>(['proposed', 'reported', 'pending']);

export const REPORT_FORMAT = 'studio-migration-report/m1';

export interface ReportEntry {
  readonly id: string;
  readonly kind: ConstructKind;
  readonly file: string;
  readonly label: string;
  /** For a field or a column: the property it shows. */
  readonly property?: string;
  readonly outcome: Outcome;
  /** Where a converted construct went in the conversion, and where a reported one was written. */
  readonly to?: string;
  /** Why, for what is proposed, reported or pending. */
  readonly note?: string;
  /** For a condition: the registered rule it becomes, or is proposed to become. */
  readonly rule?: unknown;
}

export interface MigrationReport {
  readonly format: typeof REPORT_FORMAT;
  readonly package: StudioPackageDescriptor & { readonly bundle: string };
  /** From the bundle's manifest: the Studio project's branch, commit and build time. */
  readonly studio: {
    readonly branch: string | null;
    readonly commit: string | null;
    readonly buildTime: string | null;
  };
  readonly converter: { readonly name: string; readonly version: string; readonly phase: 'M1' };
  /** The operations the deployment allowed when it was converted (decision 3). */
  readonly allowList: readonly string[];
  readonly constructs: readonly ReportEntry[];
}

export interface ConvertedTheme {
  readonly id: string;
  /** Token to value: the CSS custom properties a Layer 0 theme sets. */
  readonly tokens: Readonly<Record<string, string>>;
}

export interface Conversion {
  readonly report: MigrationReport;
  /** The app definition, each file parsed, by its path under `app/`. */
  readonly app: Readonly<Record<string, unknown>>;
  /** Files under `app/` that are not JSON, by their path there. */
  readonly appAssets: Readonly<Record<string, Buffer>>;
  /** By theme name, written as `themes/<name>.json`. */
  readonly themes: Readonly<Record<string, ConvertedTheme>>;
  /** Copied files, by their path in the conversion: `themes/<name>/<file>`. */
  readonly assets: Readonly<Record<string, Buffer>>;
  /**
   * `decisions.json` as read, which people write and no conversion does: who owns each reported
   * item, and what they decided (`decisions.ts`). Absent when the directory holds none.
   */
  readonly decisions?: unknown;
}

export interface ConvertOptions {
  /** The deployment's allow-list of operations (decision 3). Empty, no button becomes an action. */
  readonly allowList?: ReadonlySet<string>;
  /** The platform version the app is written for; the platform's own when left out. */
  readonly platformVersion?: string;
}

export class ConversionError extends Error {
  override readonly name = 'ConversionError';
}

export type Decision = Pick<ReportEntry, 'outcome' | 'to' | 'note' | 'rule'>;

/** What the parts of the conversion share: what they read, and what they write and decide. */
export interface ConvertContext {
  readonly pkg: StudioPackage;
  readonly inventory: Inventory;
  readonly catalogue: Catalogue;
  readonly appId: string;
  readonly allowList: ReadonlySet<string>;
  /** The app definition being written, by path under `app/`. */
  readonly files: Record<string, unknown>;
  /** The theme `app.json` names, once a contribution to `THEMES` sets it. */
  theme: string | null;
  /** Where each condition's rule was written, by `<file>#<index>`: what the report says it became. */
  readonly carried: Map<string, string[]>;
  readonly decide: (id: string, decision: Decision) => void;
  /** What has been decided for a construct so far. */
  readonly decision: (id: string) => Decision | undefined;
}

const FILE_OUTCOMES: Readonly<
  Record<FileKind, { readonly outcome: Outcome; readonly note?: string }>
> = {
  'package-descriptor': { outcome: 'generated' },
  'package-install': { outcome: 'generated' },
  'package-registries': { outcome: 'generated' },
  bundle: { outcome: 'generated' },
  'bundle-manifest': { outcome: 'generated' },
  'deployment-fragment': { outcome: 'generated' },
  'studio-metadata': { outcome: 'generated' },
  'model-contributions': { outcome: 'server' },
  'model-schema': { outcome: 'server' },
  'translations-jsf': {
    outcome: 'reported',
    note: 'It is for the JSF UI, which Studio is retiring',
  },
  image: {
    outcome: 'reported',
    note: "Nothing in the package's model names it, and the app has no image of its own to set from it: app.json's branding takes a logo and a favicon only (app-definition-v2.md, section 3)",
  },
  'theme-asset': {
    outcome: 'reported',
    note: 'It sits in a theme folder with no theme.html, so no theme of the package uses it',
  },
  'custom-bundle': { outcome: 'generated', note: "Studio's custom bundle, holding no code" },
  'document-layout': { outcome: 'generated', note: 'It holds nothing to convert' },
  'task-layout': { outcome: 'generated', note: 'It holds nothing to convert' },
  'layout-block': { outcome: 'generated', note: 'It holds nothing to convert' },
  'search-form': { outcome: 'generated', note: 'It holds nothing to convert' },
  'search-results': { outcome: 'generated', note: 'It holds nothing to convert' },
  'slot-contributions': { outcome: 'generated', note: 'It holds nothing to convert' },
  dashboard: { outcome: 'generated', note: 'It holds nothing to convert' },
  theme: { outcome: 'generated', note: 'It holds nothing to convert' },
  translations: { outcome: 'generated', note: 'It holds nothing to convert' },
  unrecognised: { outcome: 'reported', note: 'It is of no known kind' },
};

export function convert(
  pkg: StudioPackage,
  inventory: Inventory,
  catalogue: Catalogue,
  options: ConvertOptions = {},
): Conversion {
  const decided = new Map<string, Decision>();
  const files: Record<string, unknown> = {};
  const allowList = options.allowList ?? new Set<string>();
  const context: ConvertContext = {
    pkg,
    inventory,
    catalogue,
    appId: appIdOf(pkg),
    allowList,
    files,
    theme: null,
    carried: new Map(),
    decide: (id, decision) => decided.set(id, decision),
    decision: (id) => decided.get(id),
  };

  convertLayouts(context);
  convertTasks(context);
  convertSearches(context);
  convertDashboard(context);
  convertSlots(context);
  // Last: a block is decided by its uses, which the parts above decide.
  convertBlocks(context);

  for (const translations of inventory.translations) {
    const texts = readCatalogue(pkg, translations.path);
    const path = labelsPath(translations.locale);
    const labels: Record<string, string> = { ...labelTexts(files[path]) };
    for (const key of translations.keys) {
      const id = `translation:${translations.path}#${key}`;
      const text = Object.hasOwn(texts, key) ? texts[key] : undefined;
      if (typeof text !== 'string') {
        decided.set(id, { outcome: 'reported', note: 'Its value is not a text' });
        continue;
      }
      // The labels file's own rules decide: a key it refuses, or an empty text, is reported.
      const [refused] = validateLabels({ version: 2, labels: { [key]: text } });
      if (refused) {
        decided.set(id, {
          outcome: 'reported',
          note: `The app's labels refuse it: ${refused.message}`,
        });
        continue;
      }
      Object.defineProperty(labels, key, {
        value: text,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      decided.set(id, { outcome: 'converted', to: `app/${path}` });
    }
    files[path] = { version: 2, labels };
  }

  const themes: Record<string, ConvertedTheme> = {};
  const assets: Record<string, Buffer> = {};
  for (const theme of inventory.themes) {
    const tokens: Record<string, string> = {};
    const last = new Map(theme.properties.map((property, index) => [property.name, index]));
    theme.properties.forEach((property, index) => {
      const id = `theme-property:${theme.path}#${index + 1}`;
      const mapping = mapThemeProperty(catalogue, property.name);
      if (mapping.token === null) {
        decided.set(id, { outcome: 'reported', note: mapping.reason });
        return;
      }
      if (last.get(property.name) !== index) {
        decided.set(id, {
          outcome: 'reported',
          note: 'The theme sets it again further on, and the last one counts',
        });
        return;
      }
      const value = resolveThemeProperty(theme.properties, property.name);
      if (value === null) {
        decided.set(id, {
          outcome: 'reported',
          note: `Its value, ${property.value}, refers to a property the theme does not set`,
        });
        return;
      }
      tokens[mapping.token] = value;
      decided.set(id, { outcome: 'converted', to: `themes/${theme.name}.json ${mapping.token}` });
    });
    themes[theme.name] = { id: theme.name, tokens };
    for (const asset of theme.assets) {
      const to = `themes/${theme.name}/${asset.slice(asset.lastIndexOf('/') + 1)}`;
      assets[to] = pkg.bundleFiles.get(asset) ?? Buffer.alloc(0);
      decided.set(`file:${asset}#file`, { outcome: 'converted', to });
    }
  }

  // An image the model names, such as a type's icon, is served by the server from the package.
  const modelText = inventory.model
    .map((contribution) => contribution.path)
    .filter((path, index, all) => all.indexOf(path) === index)
    .map((path) => pkg.bundleFiles.get(path)?.toString('utf8') ?? '')
    .join('\n');
  for (const file of inventory.files.filter((candidate) => candidate.kind === 'image')) {
    const served = `/${file.path.slice('web/nuxeo.war/'.length)}`;
    if (modelText.includes(served))
      decided.set(`file:${file.path}#file`, {
        outcome: 'server',
        note: `The model names it (${served}), as a type's icon, and the server keeps serving it from the Studio package`,
      });
  }

  files['app.json'] = {
    version: 2,
    id: context.appId,
    label: pkg.descriptor.name,
    packageVersion: pkg.descriptor.version,
    platform: `>=${options.platformVersion ?? platformVersion()} <1.0.0`,
    // Web UI shows a Studio project's screens to everyone who signs in.
    groups: ['members'],
    ...(context.theme !== null ? { branding: { theme: context.theme } } : {}),
  };

  const constructs = constructsOf(inventory);
  const entries: ReportEntry[] = constructs.map((construct) => ({
    id: construct.id,
    kind: construct.kind,
    file: construct.file,
    label: construct.label,
    ...(construct.property ? { property: construct.property } : {}),
    ...(decided.get(construct.id) ?? decide(construct, inventory, catalogue, context.carried)),
  }));

  return {
    report: {
      format: REPORT_FORMAT,
      package: { ...inventory.descriptor, bundle: pkg.bundlePath },
      studio: studioBuildOf(pkg),
      converter: converterIdentity(),
      allowList: [...allowList].sort(),
      constructs: entries,
    },
    app: sorted(files),
    appAssets: {},
    themes,
    assets,
  };
}

/** The outcome of a construct no part of the conversion decided. */
function decide(
  construct: Construct,
  inventory: Inventory,
  catalogue: Catalogue,
  carried: ReadonlyMap<string, readonly string[]>,
): Decision {
  const key = Number(construct.id.slice(construct.id.lastIndexOf('#') + 1));
  switch (construct.kind) {
    case 'file': {
      const kind =
        inventory.files.find((file) => file.path === construct.file)?.kind ?? 'unrecognised';
      return FILE_OUTCOMES[kind];
    }
    case 'custom-code':
      return { outcome: 'pending', note: 'An agent proposes a Layer 2 plugin for it, in M3' };
    case 'script': {
      const script = inventory.scripts.find(
        (candidate) => candidate.path === construct.file && candidate.index === key - 1,
      );
      const known = script ? scriptEntry(catalogue, script.shape) : null;
      return known
        ? { outcome: 'generated', note: known.name }
        : {
            outcome: 'pending',
            note: 'Customer code: an agent proposes a Layer 2 plugin for it, in M3',
          };
    }
    case 'condition': {
      const condition = inventory.conditions.find(
        (candidate) => candidate.path === construct.file && candidate.index === key - 1,
      );
      if (!condition) return { outcome: 'reported', note: 'The conversion did not reach it' };
      const decision = decideCondition(condition);
      if (decision.kind === 'reported') return { outcome: 'reported', note: decision.note };
      if (decision.kind === 'proposed')
        return { outcome: 'proposed', note: decision.note, rule: decision.rule };
      // Converted only where a rule was written: what it guards says why it was not otherwise.
      const where = carried.get(`${condition.path}#${condition.index}`) ?? [];
      return where.length > 0
        ? {
            outcome: 'converted',
            to: `the visibleWhen of ${where.join(', ')}`,
            rule: decision.rule,
          }
        : {
            outcome: 'pending',
            note: 'Its rule is decided, but nothing it guards carries one yet: each says why',
            rule: decision.rule,
          };
    }
    default:
      // Each part decides its own constructs; reaching here means one skipped a construct.
      return { outcome: 'reported', note: 'The conversion did not reach it' };
  }
}

/** A translation catalogue's texts, as the package holds them. */
export function readCatalogue(pkg: StudioPackage, path: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(pkg.bundleFiles.get(path)?.toString('utf8') ?? '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The allow-list the conversion was made with, as its report records it. It says which buttons
 * the converter made actions of, so the checks can tell whose each action is; whether those
 * operations are allowed is check 10's, against the deployment's own list.
 */
export function recordedAllowList(conversion: Pick<Conversion, 'report'>): ReadonlySet<string> {
  return new Set(conversion.report.allowList ?? []);
}

/**
 * A deployment's allow-list, `{ "operations": [...] }`, as app-definition's command line reads it,
 * from `parsed`, the JSON of the file `path` names.
 */
export function allowListOf(parsed: unknown, path: string): ReadonlySet<string> {
  const operations =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)['operations']
      : undefined;
  if (!Array.isArray(operations) || !operations.every((item) => typeof item === 'string'))
    throw new ConversionError(
      `${path}: an allow-list is { "operations": [ <operation id>, ... ] }`,
    );
  return new Set(operations as string[]);
}

/** Each language's translations as the conversion holds them, in its labels files. */
export function labelsOf(
  conversion: Pick<Conversion, 'app'>,
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  const labels: Record<string, Readonly<Record<string, string>>> = {};
  for (const [path, content] of Object.entries(conversion.app)) {
    const locale = /^labels\/([^/]+)\.json$/.exec(path)?.[1];
    if (locale !== undefined) labels[locale] = labelTexts(content);
  }
  return labels;
}

/** The Studio project's branch, commit and build time, from the bundle's manifest. */
export function studioBuildOf(pkg: StudioPackage): MigrationReport['studio'] {
  const manifest = readManifest(
    pkg.bundleFiles.get('META-INF/MANIFEST.MF')?.toString('utf8') ?? '',
  );
  return {
    branch: manifest.get('Studio-Git-Branch-Name') ?? null,
    commit: manifest.get('Studio-Git-Commit-Hash') ?? null,
    buildTime: manifest.get('Studio-Build-Time') ?? null,
  };
}

/**
 * One build of a package, as decisions are held to it: its name and version, Studio's commit and
 * build time, and the SHA-256 of its bundle, which tells two builds apart where the manifest
 * records neither, as when a project keeps its version from one build to the next.
 */
export function packageBuildOf(pkg: StudioPackage): {
  readonly name: string;
  readonly version: string;
  readonly commit: string | null;
  readonly buildTime: string | null;
  readonly bundle: string;
} {
  const { commit, buildTime } = studioBuildOf(pkg);
  return {
    name: pkg.descriptor.name,
    version: pkg.descriptor.version,
    commit,
    buildTime,
    bundle: createHash('sha256')
      .update(pkg.packageFiles.get(pkg.bundlePath) ?? Buffer.alloc(0))
      .digest('hex'),
  };
}

/** A JAR manifest's main attributes. A line that starts with a space carries on the one before. */
function readManifest(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  let last: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(' ') && last) {
      attributes.set(last, (attributes.get(last) ?? '') + line.slice(1));
      continue;
    }
    if (line.trim() === '') break;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    last = line.slice(0, colon).trim();
    attributes.set(last, line.slice(colon + 1).trim());
  }
  return attributes;
}

function converterIdentity(): MigrationReport['converter'] {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  return { name: manifest.name, version: manifest.version, phase: 'M1' };
}

/** The platform's own version, from `libs/platform/package.json`, which `app.json`'s range holds. */
export function platformVersion(): string {
  const manifest = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'libs', 'platform', 'package.json'), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/** A name that is a safe file name on every system: letters, digits, `.`, `_` and `-`. */
const SAFE_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

function safePath(path: string): boolean {
  return path.split('/').every((part) => SAFE_NAME.test(part));
}

/** Writes the conversion into a directory that does not exist yet, or is empty. */
export function writeConversion(directory: string, conversion: Conversion): void {
  if (
    existsSync(directory) &&
    (!statSync(directory).isDirectory() || readdirSync(directory).length > 0)
  ) {
    throw new ConversionError(
      `${directory} is not an empty directory; a conversion is written only into a new one`,
    );
  }
  const paths = [
    ...Object.keys(conversion.app).map((path) => `app/${path}`),
    ...Object.keys(conversion.appAssets).map((path) => `app/${path}`),
    ...Object.keys(conversion.themes).map((name) => `themes/${name}.json`),
    ...Object.keys(conversion.assets),
  ];
  const unsafe = paths.find((path) => !safePath(path));
  if (unsafe !== undefined) {
    throw new ConversionError(
      `"${unsafe}" cannot be a file name on every system, so the conversion cannot be written`,
    );
  }
  const write = (path: string, content: string | Buffer): void => {
    const full = join(directory, ...path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  write('report.json', `${JSON.stringify(conversion.report, null, 2)}\n`);
  if (conversion.decisions !== undefined)
    write(DECISIONS_FILE, `${JSON.stringify(conversion.decisions, null, 2)}\n`);
  for (const [path, content] of Object.entries(conversion.app))
    write(`app/${path}`, `${JSON.stringify(content, null, 2)}\n`);
  for (const [path, content] of Object.entries(conversion.appAssets)) write(`app/${path}`, content);
  for (const [name, theme] of Object.entries(conversion.themes)) {
    write(`themes/${name}.json`, `${JSON.stringify(theme, null, 2)}\n`);
  }
  for (const [path, content] of Object.entries(conversion.assets)) write(path, content);
}

/** Reads a conversion back, as the harness checks it. */
export function readConversion(directory: string): Conversion {
  const json = (path: string): unknown => {
    try {
      return JSON.parse(readFileSync(join(directory, ...path.split('/')), 'utf8'));
    } catch (error) {
      throw new ConversionError(`${path} cannot be read: ${(error as Error).message}`);
    }
  };
  if (!existsSync(join(directory, 'report.json'))) {
    throw new ConversionError(`${directory} holds no report.json, so it is not a conversion`);
  }
  const report = json('report.json') as MigrationReport;
  if (report?.format !== REPORT_FORMAT || !Array.isArray(report.constructs)) {
    throw new ConversionError(
      `report.json is not a ${REPORT_FORMAT} report; a conversion of an earlier phase is converted again`,
    );
  }
  const app: Record<string, unknown> = {};
  const appAssets: Record<string, Buffer> = {};
  const walk = (folder: string): void => {
    const full = join(directory, ...folder.split('/'));
    if (!existsSync(full)) return;
    for (const name of readdirSync(full).sort()) {
      const path = `${folder}/${name}`;
      if (statSync(join(full, name)).isDirectory()) walk(path);
      else if (name.endsWith('.json')) app[path.slice('app/'.length)] = json(path);
      else appAssets[path.slice('app/'.length)] = readFileSync(join(full, name));
    }
  };
  walk('app');
  const themes: Record<string, ConvertedTheme> = {};
  const assets: Record<string, Buffer> = {};
  const themeFolder = join(directory, 'themes');
  for (const file of existsSync(themeFolder) ? readdirSync(themeFolder) : []) {
    const path = join(themeFolder, file);
    if (file.endsWith('.json') && statSync(path).isFile()) {
      themes[file.slice(0, -'.json'.length)] = json(`themes/${file}`) as ConvertedTheme;
    } else if (statSync(path).isDirectory()) {
      for (const asset of readdirSync(path))
        assets[`themes/${file}/${asset}`] = readFileSync(join(path, asset));
    }
  }
  // People write it, beside the report, and no conversion does.
  const decisions = existsSync(join(directory, DECISIONS_FILE))
    ? { decisions: json(DECISIONS_FILE) }
    : {};
  return { report, app, appAssets, themes, assets, ...decisions };
}
