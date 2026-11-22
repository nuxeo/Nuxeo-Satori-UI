/**
 * The conversion of phase M0, and the report every conversion writes.
 *
 * M0 converts only what the harness can already check without a server: the translations, to
 * `labels/<locale>.json`, and each theme's mappable properties, to `themes/<name>.json` with its
 * assets beside it. Every other construct is listed in the report with an outcome and its reason:
 *
 * - **converted:** done, and where it went;
 * - **proposed:** an agent proposes it and a person accepts it;
 * - **reported:** it does not migrate, with why;
 * - **generated:** Studio's own packaging, records and templates;
 * - **server:** it stays on the server, where the new app reads it;
 * - **pending:** a later phase converts it, and the note says which.
 *
 * Check 1 counts every outcome as accounted for. A migration with anything pending is not ready.
 * The format is provisional, `studio-migration-report/m0`, until layout version 2 and the package
 * pipeline fix the shape of a migrated package.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mapThemeProperty, scriptEntry, slotEntry, type Catalogue } from './catalogue';
import { constructsOf, type Construct, type ConstructKind } from './constructs';
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

export const REPORT_FORMAT = 'studio-migration-report/m0';

export interface ReportEntry {
  readonly id: string;
  readonly kind: ConstructKind;
  readonly file: string;
  readonly label: string;
  readonly outcome: Outcome;
  /** Where a converted construct went in the conversion. */
  readonly to?: string;
  /** Why, for what is proposed, reported or pending. */
  readonly note?: string;
  /** Who decides, for what is reported. Unset until someone takes it on. */
  readonly owner?: string;
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
  readonly converter: { readonly name: string; readonly version: string; readonly phase: 'M0' };
  readonly constructs: readonly ReportEntry[];
}

export interface ConvertedTheme {
  readonly id: string;
  /** Token to value: the CSS custom properties a Layer 0 theme sets. */
  readonly tokens: Readonly<Record<string, string>>;
}

export interface Conversion {
  readonly report: MigrationReport;
  /** By locale, written as `labels/<locale>.json`. */
  readonly labels: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** By theme name, written as `themes/<name>.json`. */
  readonly themes: Readonly<Record<string, ConvertedTheme>>;
  /** Copied files, by their path in the conversion: `themes/<name>/<file>`. */
  readonly assets: Readonly<Record<string, Buffer>>;
}

export class ConversionError extends Error {
  override readonly name = 'ConversionError';
}

const M1 = 'Converted in M1, with layout version 2';
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
  image: { outcome: 'pending', note: 'Sign-in branding is converted in M1' },
  'theme-asset': { outcome: 'pending', note: 'A theme asset outside a theme is converted in M1' },
  'custom-bundle': { outcome: 'generated', note: "Studio's custom bundle, holding no code" },
  'document-layout': { outcome: 'generated', note: 'It holds nothing to convert' },
  'search-form': { outcome: 'generated', note: 'It holds nothing to convert' },
  'search-results': { outcome: 'generated', note: 'It holds nothing to convert' },
  'slot-contributions': { outcome: 'generated', note: 'It holds nothing to convert' },
  dashboard: { outcome: 'generated', note: 'It holds nothing to convert' },
  theme: { outcome: 'generated', note: 'It holds nothing to convert' },
  translations: { outcome: 'generated', note: 'It holds nothing to convert' },
  unrecognised: { outcome: 'reported', note: 'It is of no known kind' },
};

type Decision = Pick<ReportEntry, 'outcome' | 'to' | 'note'>;

export function convert(
  pkg: StudioPackage,
  inventory: Inventory,
  catalogue: Catalogue,
): Conversion {
  const decided = new Map<string, Decision>();

  const labels: Record<string, Record<string, string>> = {};
  for (const translations of inventory.translations) {
    const texts = readCatalogue(pkg, translations.path);
    const target = (labels[translations.locale] ??= {});
    for (const key of translations.keys) {
      const id = `translation:${translations.path}#${key}`;
      const text = Object.hasOwn(texts, key) ? texts[key] : undefined;
      if (typeof text === 'string') {
        target[key] = text;
        decided.set(id, { outcome: 'converted', to: `labels/${translations.locale}.json` });
      } else {
        decided.set(id, { outcome: 'reported', note: 'Its value is not a text' });
      }
    }
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

  const constructs = constructsOf(inventory);
  const entries: ReportEntry[] = constructs.map((construct) => ({
    id: construct.id,
    kind: construct.kind,
    file: construct.file,
    label: construct.label,
    ...(decided.get(construct.id) ?? decide(construct, inventory, catalogue)),
  }));

  const manifest = readManifest(
    pkg.bundleFiles.get('META-INF/MANIFEST.MF')?.toString('utf8') ?? '',
  );
  return {
    report: {
      format: REPORT_FORMAT,
      package: { ...inventory.descriptor, bundle: pkg.bundlePath },
      studio: {
        branch: manifest.get('Studio-Git-Branch-Name') ?? null,
        commit: manifest.get('Studio-Git-Commit-Hash') ?? null,
        buildTime: manifest.get('Studio-Build-Time') ?? null,
      },
      converter: converterIdentity(),
      constructs: entries,
    },
    labels,
    themes,
    assets,
  };
}

/** The outcome of a construct the M0 conversion does not convert. */
function decide(construct: Construct, inventory: Inventory, catalogue: Catalogue): Decision {
  const key = Number(construct.id.slice(construct.id.lastIndexOf('#') + 1));
  switch (construct.kind) {
    case 'file': {
      const kind =
        inventory.files.find((file) => file.path === construct.file)?.kind ?? 'unrecognised';
      return FILE_OUTCOMES[kind];
    }
    case 'layout':
    case 'search':
    case 'search-field':
    case 'search-column':
      return { outcome: 'pending', note: M1 };
    case 'layout-field': {
      const layout = inventory.layouts.find((candidate) => candidate.path === construct.file);
      const binding = layout?.fields[key - 1]?.binding;
      const first = layout?.fields.findIndex((field) => field.binding === binding);
      return binding && first !== undefined && first !== key - 1
        ? { outcome: 'reported', note: `It binds ${binding} again, and is kept once` }
        : { outcome: 'pending', note: M1 };
    }
    case 'slot-contribution': {
      const contribution = inventory.slotContributions.filter((c) => c.path === construct.file)[
        key - 1
      ];
      const entry = contribution ? slotEntry(catalogue, contribution.slot) : null;
      if (!contribution || !entry)
        return { outcome: 'reported', note: 'Its slot is not in the catalogue' };
      if (entry.how === 'reported')
        return { outcome: 'reported', note: entry.note ?? catalogue.reportedBecause };
      if (contribution.operations.includes(null)) {
        return { outcome: 'reported', note: 'Its operation button runs no operation' };
      }
      return {
        outcome: 'pending',
        note: entry.how === 'agent-proposes' ? 'An agent proposes it, in M1' : M1,
      };
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
    case 'dashboard-card': {
      const card = inventory.dashboard?.cards[key - 1];
      return card && card.repeatOf !== null
        ? { outcome: 'reported', note: `It repeats card ${card.repeatOf + 1}, and is kept once` }
        : { outcome: 'pending', note: 'Converted in M1, as a home card' };
    }
    case 'theme-property':
    case 'translation':
      // Decided as they are converted; reaching here means the conversion skipped one.
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
  return { name: manifest.name, version: manifest.version, phase: 'M0' };
}

/** A name that is a safe file name on every system: letters, digits, `.`, `_` and `-`. */
const SAFE_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

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
  const names = [...Object.keys(conversion.labels), ...Object.keys(conversion.themes)];
  const unsafe = names.find((name) => !SAFE_NAME.test(name));
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
  for (const [locale, texts] of Object.entries(conversion.labels)) {
    write(`labels/${locale}.json`, `${JSON.stringify(texts, null, 2)}\n`);
  }
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
    throw new ConversionError(`report.json is not a ${REPORT_FORMAT} report`);
  }
  const entries = (folder: string): string[] =>
    existsSync(join(directory, folder)) ? readdirSync(join(directory, folder)) : [];
  const labels: Record<string, Record<string, string>> = {};
  for (const file of entries('labels').filter((name) => name.endsWith('.json'))) {
    labels[file.slice(0, -'.json'.length)] = json(`labels/${file}`) as Record<string, string>;
  }
  const themes: Record<string, ConvertedTheme> = {};
  const assets: Record<string, Buffer> = {};
  for (const file of entries('themes')) {
    const path = join(directory, 'themes', file);
    if (file.endsWith('.json') && statSync(path).isFile()) {
      themes[file.slice(0, -'.json'.length)] = json(`themes/${file}`) as ConvertedTheme;
    } else if (statSync(path).isDirectory()) {
      for (const asset of readdirSync(path))
        assets[`themes/${file}/${asset}`] = readFileSync(join(path, asset));
    }
  }
  return { report, labels, themes, assets };
}
