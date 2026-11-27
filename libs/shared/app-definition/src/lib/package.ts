/**
 * A package as a whole (docs/business-apps/app-definition-v2.md, sections 1 and 11): which file of
 * an app definition a path is, and the checks that need more than one file. A file is always
 * checked with its package's `app.json`, `actions.json`, `assets/`, queues and English labels:
 *
 * - a queue's row and bulk actions may be the package's own, from `actions.json`;
 * - a module's settings must be for a module `app.json` turns on;
 * - a branding image in `assets/` must be in the package;
 * - a queue the home or the menu names must be in `queues/`;
 * - given the platform's catalogue, a label key a file names must have a text in the package's
 *   `labels/en.json` or in that catalogue;
 * - a language's labels, `labels/<locale>.json`, give a text only to keys `labels/en.json` has:
 *   a subset, since each key left out falls back to English.
 *
 * Reading files is the caller's: this stays plain TypeScript, for the browser as well as Node.
 */
import { validateActions, placementsOf } from './actions';
import { APP_ID, assetFile, validateApp } from './app';
import { ID, join, unreadable, type Finding } from './checker';
import type { ContentModel } from './content-model';
import { validateHome, validateNavigation } from './home';
import { describeLogoSrcForm } from './image-source';
import { validateLabels, validateModuleSettings } from './labels';
import { LAYOUT_MODES, validateLayoutV2, validateTaskForm, type LayoutMode } from './layout-v2';
import { validateQueue } from './queue';
import { isRecord, PACKAGED_REGISTRIES, withRegistered, type Registries } from './registries';

export type PackageFile =
  | { readonly kind: 'app' }
  | { readonly kind: 'navigation' }
  | { readonly kind: 'home' }
  | { readonly kind: 'layout'; readonly type: string; readonly mode: LayoutMode }
  | { readonly kind: 'queue'; readonly id: string }
  | { readonly kind: 'actions' }
  | { readonly kind: 'task'; readonly name: string }
  | { readonly kind: 'labels'; readonly locale: string }
  | { readonly kind: 'module'; readonly module: string };

export interface PlacedFile {
  readonly file: PackageFile;
  /** The package's directory: the one that holds, or would hold, its `app.json`. */
  readonly root: string;
}

const SEP = String.raw`[\\/]`;
const PART = String.raw`[^\\/]+`;
const at = (tail: string): RegExp => new RegExp(`^(?:(.*)${SEP})?${tail}$`);
// The files in a directory of their own come first: with no app.json to decide, `queues/app.json`
// is a queue.
const PLACES: readonly (readonly [RegExp, (match: RegExpExecArray) => PackageFile | null])[] = [
  [
    at(`layouts${SEP}(${PART})${SEP}(${PART})\\.layout\\.json`),
    (match) =>
      LAYOUT_MODES.includes(match[3] as LayoutMode)
        ? { kind: 'layout', type: match[2], mode: match[3] as LayoutMode }
        : null,
  ],
  [at(`tasks${SEP}(${PART})\\.layout\\.json`), (match) => ({ kind: 'task', name: match[2] })],
  [at(`queues${SEP}(${PART})\\.json`), (match) => ({ kind: 'queue', id: match[2] })],
  [at(`labels${SEP}(${PART})\\.json`), (match) => ({ kind: 'labels', locale: match[2] })],
  [at(`modules${SEP}(${PART})\\.json`), (match) => ({ kind: 'module', module: match[2] })],
  [at(String.raw`app\.json`), () => ({ kind: 'app' })],
  [at(String.raw`actions\.json`), () => ({ kind: 'actions' })],
  [at(String.raw`navigation\.json`), () => ({ kind: 'navigation' })],
  [at(String.raw`home\.json`), () => ({ kind: 'home' })],
];

/**
 * Which file of an app definition `path` is, from where it sits; `null` when its place does not say.
 *
 * A path can fit two places: `x/queues/app.json` is the queue `app` of the package `x`, or the
 * `app.json` of a package in a directory named `queues`. `hasApp`, which says whether a directory
 * holds an `app.json`, decides: the place whose package has one wins, and the first place when
 * neither does.
 */
export function placeFile(
  path: string,
  hasApp: (root: string) => boolean = () => false,
): PlacedFile | null {
  const candidates: PlacedFile[] = [];
  for (const [pattern, file] of PLACES) {
    const match = pattern.exec(path);
    const placed = match ? file(match) : null;
    if (match && placed) candidates.push({ file: placed, root: match[1] ?? '' });
  }
  return candidates.find((candidate) => hasApp(candidate.root)) ?? candidates[0] ?? null;
}

export interface PackageContext {
  /** The package's `app.json`, parsed; `undefined` when it has none. */
  readonly app?: unknown;
  /** Its `actions.json`, parsed; `undefined` when it has none. */
  readonly actions?: unknown;
  /** Every file under its `assets/`, as `assets/<path>`. */
  readonly assets: ReadonlySet<string>;
  /**
   * The ids of its queues, from the names of its `queues/<id>.json` files. Left out, the queues
   * the home and the menu name are not checked: the app reads `home.json` without its package.
   */
  readonly queues?: ReadonlySet<string>;
  /**
   * The keys its `labels/en.json` gives a text, none when it has no such file. Left out, as for a
   * file read without its package, its label keys are not checked.
   */
  readonly labels?: ReadonlySet<string>;
}

export interface PackageOptions {
  readonly registries?: Registries;
  /** The deployment's allow-list of operations (decision 3). Empty, every operation is refused. */
  readonly operations?: ReadonlySet<string>;
  /** The platform version `app.json`'s range must hold. */
  readonly platformVersion?: string;
  /** Read every layout in this mode, whatever its path says. */
  readonly mode?: LayoutMode;
  /** The server's content model: each layout is held to the type its path names. */
  readonly model?: ContentModel;
  /** With a model, what a layout's rules read held to it too (`ValidationOptions.references`). */
  readonly references?: boolean;
  /**
   * The keys of the platform's English catalogue. Given, with the package's labels, every
   * `labelKey` a file names must have a text in one or the other: a key with neither shows a
   * heading's id made readable, or nothing (section 7).
   */
  readonly catalogue?: ReadonlySet<string>;
}

const TASK = /^([A-Za-z][A-Za-z0-9_-]{0,127})\.([A-Za-z][A-Za-z0-9_-]{0,127})$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** One file's findings, its own and those across its package. */
export function validateFile(
  file: PackageFile,
  content: unknown,
  context: PackageContext,
  options: PackageOptions = {},
): Finding[] {
  const findings = findingsOf(file, content, context, options);
  // A labels file and a module's settings name no label key; a file that is not a version 2 object
  // is read no further (section 2), so its keys are not looked up either.
  if (
    options.catalogue === undefined ||
    context.labels === undefined ||
    file.kind === 'labels' ||
    file.kind === 'module' ||
    unreadable(content, 'a file') !== null
  )
    return findings;
  return [...findings, ...untranslated(content, context.labels, options.catalogue)];
}

/**
 * Every `labelKey` in a file, wherever it is, that has a text in neither the package's English
 * labels nor the platform's catalogue: looked up in the package first, then in the platform's
 * (section 7), English being the language every other falls back to. One beside a literal `label`
 * is never looked up, since the `label` wins (section 2), so it is not held to a text.
 */
function untranslated(
  content: unknown,
  labels: ReadonlySet<string>,
  catalogue: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, join(path, index)));
    else if (isRecord(value))
      for (const [key, item] of Object.entries(value)) {
        const at = join(path, key);
        if (key === 'labelKey' && typeof item === 'string') {
          const shown = typeof value['label'] === 'string';
          if (!shown && !labels.has(item) && !catalogue.has(item))
            findings.push({
              path: at,
              kind: 'unknown',
              message: `the label key "${item}" has no text in labels/en.json, or in the platform's catalogue`,
            });
        } else visit(item, at);
      }
  };
  visit(content, '');
  return findings;
}

function findingsOf(
  file: PackageFile,
  content: unknown,
  context: PackageContext,
  options: PackageOptions,
): Finding[] {
  const registries = options.registries ?? PACKAGED_REGISTRIES;
  // Findings about the file's name, which the file itself cannot see.
  const add = (path: string, kind: Finding['kind'], message: string): Finding[] => [
    { path, kind, message },
  ];
  switch (file.kind) {
    case 'app':
      return [
        ...validateApp(content, { registries, platformVersion: options.platformVersion }),
        ...missingAssets(content, context),
      ];
    case 'layout':
      return validateLayoutV2(content, {
        mode: options.mode ?? file.mode,
        registries,
        model: options.model,
        type: file.type,
        references: options.references,
      });
    case 'queue':
      return [
        ...(ID.test(file.id)
          ? []
          : add(
              '',
              'structure',
              `the file name is the queue's id: 1 to 64 letters, digits, ".", "_" or "-"`,
            )),
        ...validateQueue(content, { registries: withPackageActions(registries, context.actions) }),
      ];
    case 'actions':
      return validateActions(content, { registries, operations: options.operations });
    case 'navigation':
      return validateNavigation(content, { registries, queues: context.queues });
    case 'home':
      return validateHome(content, { registries, queues: context.queues });
    case 'task':
      return [
        ...(TASK.test(file.name)
          ? []
          : add(
              '',
              'structure',
              'the file name is <workflow>.<step>.layout.json, each of the two letters, digits, "_" or "-"',
            )),
        ...validateTaskForm(content, { registries }),
      ];
    case 'labels':
      return [
        ...(LOCALE.test(file.locale)
          ? []
          : add('', 'structure', 'the file name is a language tag, such as "en" or "pt-BR"')),
        ...validateLabels(content),
        ...notInEnglish(file.locale, content, context.labels),
      ];
    case 'module':
      return [
        ...(APP_ID.test(file.module)
          ? []
          : add(
              '',
              'structure',
              `the file name is the module's id: lower-case letters, digits and "-"`,
            )),
        ...validateModuleSettings(content, { module: file.module, registries }),
        ...turnedOn(file.module, context.app),
      ];
  }
}

/**
 * Each key of a language's labels that the package's `labels/en.json` does not give a text
 * (section 7). A language other than English may leave keys out, since each one it leaves out
 * falls back to English, key by key; it may not add one, since a key English lacks is a misspelt
 * or stale key that no file names and no translator is ever asked for: Crowdin writes a language's
 * file from `labels/en.json`, and only with its keys. Not checked without the package's English
 * labels, as for a file read on its own.
 */
function notInEnglish(
  locale: string,
  content: unknown,
  english: ReadonlySet<string> | undefined,
): Finding[] {
  if (locale === 'en' || english === undefined || !isRecord(content)) return [];
  const labels = content['labels'];
  if (!isRecord(labels)) return [];
  return Object.keys(labels)
    .filter((key) => !english.has(key))
    .map((key) => ({
      path: `labels[${JSON.stringify(key)}]`,
      kind: 'unknown' as const,
      message: `labels/en.json has no text for "${key}": a language's labels give a text only to a key English has`,
    }));
}

/**
 * The registries with the package's own actions added, from its `actions.json`: those that show
 * on rows as row actions, those that show in bulk as bulk actions.
 */
export function withPackageActions(registries: Registries, actions: unknown): Registries {
  if (!isRecord(actions) || !Array.isArray(actions['actions'])) return registries;
  const row: string[] = [];
  const bulk: string[] = [];
  for (const action of actions['actions']) {
    if (!isRecord(action) || typeof action['id'] !== 'string') continue;
    const on = placementsOf(action);
    if (on.includes('row')) row.push(action['id']);
    if (on.includes('bulk')) bulk.push(action['id']);
  }
  return withRegistered(registries, { rowActions: row, bulkActions: bulk });
}

function missingAssets(content: unknown, context: PackageContext): Finding[] {
  if (!isRecord(content) || !isRecord(content['branding'])) return [];
  const branding = content['branding'];
  const findings: Finding[] = [];
  for (const key of ['logo', 'favicon']) {
    const image = branding[key];
    const src = isRecord(image) ? image['src'] : undefined;
    // Only a source whose form is accepted: one that is refused already has its own finding.
    const file =
      typeof src === 'string' && describeLogoSrcForm(src) === null ? assetFile(src) : null;
    if (file !== null && !context.assets.has(file))
      findings.push({
        path: `branding.${key}.src`,
        kind: 'unknown',
        message: `the asset "${file}" is not in the package`,
      });
  }
  return findings;
}

function turnedOn(module: string, app: unknown): Finding[] {
  if (app === undefined)
    return [{ path: '', kind: 'unknown', message: `no app.json turns the module "${module}" on` }];
  const modules = isRecord(app) && Array.isArray(app['modules']) ? app['modules'] : [];
  return modules.includes(module)
    ? []
    : [
        {
          path: '',
          kind: 'unknown',
          message: `app.json does not turn the module "${module}" on`,
        },
      ];
}
