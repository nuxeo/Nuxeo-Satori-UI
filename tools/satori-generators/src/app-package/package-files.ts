import { posix } from 'node:path';

import type { Tree } from '@nx/devkit';

/**
 * What the business-app generators share: finding the app definition package they add to, and the
 * two files more than one of them writes into, its labels and its component.
 *
 * A package is laid out as docs/business-apps/package-pipeline.md, section 1, says, and as the
 * Payers kit (`business-apps/packages/payers-claims-demo`) is: the app definition's root is
 * `bundle/agentic-ui-config/`, which holds `app.json`.
 *
 * Nothing here imports `libs/shared/app-definition`: `scripts/build-platform-generators.mjs`
 * compiles these sources with `src/` as their root, so an import from outside it would stop the
 * platform build. The validator is the judge of what these generators write instead, in their
 * specs, as the package pipeline is.
 */

/** Where the app definition's files sit in a package. */
export const CONFIG_ROOT = 'bundle/agentic-ui-config';

/** An id, as every app definition file writes one (app-definition-v2.md, section 2). */
export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** An app's id, `app.json`'s `id` (app-definition-v2.md, section 3). */
export const APP_ID = /^[a-z][a-z0-9-]{0,62}$/;

/** A property, `<prefix>:<name>`, as a layout writes one. */
export const XPATH = /^[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*$/;

/** A labels key (app-definition-v2.md, section 7). */
export const LABEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** The JSON Schemas of the app definition, in this repository. */
const SCHEMAS = 'libs/shared/app-definition/src';

export interface AppPackage {
  /** The package's directory, relative to the workspace root. */
  readonly root: string;
  /** Its app definition's root, `<root>/bundle/agentic-ui-config`. */
  readonly config: string;
  /** `app.json`'s `id`, which the generators begin label keys with. */
  readonly appId: string;
  /** The component that contributes its layouts: `bundle/OSGI-INF/<name>-config.xml`. */
  readonly component: string;
}

/** A path inside the workspace with no `..`, no `.` part and no leading `/`. */
function workspacePath(path: string, what: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const parts = trimmed.split('/');
  if (
    trimmed === '' ||
    trimmed.startsWith('/') ||
    trimmed.includes('\\') ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(
      `${what} "${path}" must be a path relative to the workspace root, with no "." or ".." part.`,
    );
  }
  return trimmed;
}

/**
 * The app definition package at `directory`: refused unless it has an `app.json` with an id, and
 * a component to contribute layouts with, the one `app-package` writes.
 */
export function readAppPackage(tree: Tree, directory: string): AppPackage {
  const root = workspacePath(directory, '--package');
  const config = `${root}/${CONFIG_ROOT}`;
  const appFile = `${config}/app.json`;
  const text = tree.read(appFile, 'utf-8');
  if (text === null) {
    throw new Error(
      `${root} is not an app definition package: it has no ${CONFIG_ROOT}/app.json. ` +
        'Scaffold one with the app-package generator first.',
    );
  }
  const app = parseJson(text, appFile);
  const appId = isRecord(app) ? app['id'] : undefined;
  if (typeof appId !== 'string' || !APP_ID.test(appId)) {
    throw new Error(`${appFile} has no "id" of lower-case letters, digits and "-".`);
  }
  const components = tree
    .children(`${root}/bundle/OSGI-INF`)
    .filter((file) => file.endsWith('-config.xml'));
  if (components.length !== 1) {
    throw new Error(
      `${root}/bundle/OSGI-INF/ has ${components.length === 0 ? 'no' : components.length} ` +
        '<name>-config.xml component; the generators add layouts to exactly one.',
    );
  }
  return { root, config, appId, component: `${root}/bundle/OSGI-INF/${components[0]}` };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `text` as JSON, a byte-order mark allowed, or an error naming the file. */
export function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`${file} is not JSON: ${(error as Error).message}`);
  }
}

/** `value` as the generators write JSON. `formatFiles` then formats it as the repository does. */
export function writeJson(tree: Tree, file: string, value: unknown): void {
  tree.write(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * The `$schema` a file at `file` gives its editor: the app definition's JSON Schema in this
 * repository, relative to the file, as the Payers kit writes it. The validator does not read it.
 */
export function schemaFor(file: string, schema: string): string {
  return posix.relative(posix.dirname(file), `${SCHEMAS}/${schema}`);
}

/** `billedAmount` → `Billed amount`; `claim_type` → `Claim type`; `ClaimDocument` → `Claim document`. */
export function humanize(name: string): string {
  const words = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/);
  return words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : /^[A-Z0-9]+$/.test(word)
          ? word
          : word.toLowerCase(),
    )
    .join(' ');
}

/**
 * Adds `labels` to the package's `labels/en.json`, creating it if it has none. A key the file has
 * already keeps its text, so a label someone corrected by hand is not put back; the keys kept that
 * way are returned, for the generator to say so.
 */
export function addLabels(
  tree: Tree,
  pkg: AppPackage,
  labels: Readonly<Record<string, string>>,
): string[] {
  const file = `${pkg.config}/labels/en.json`;
  const text = tree.read(file, 'utf-8');
  const current =
    text === null
      ? { $schema: schemaFor(file, 'labels.schema.json'), version: 2, labels: {} }
      : parseJson(text, file);
  if (!isRecord(current) || !isRecord(current['labels'])) {
    throw new Error(`${file} has no "labels" object to add to.`);
  }
  const entries = current['labels'] as Record<string, unknown>;
  const kept: string[] = [];
  for (const [key, value] of Object.entries(labels)) {
    if (!LABEL_KEY.test(key)) throw new Error(`"${key}" is not a label key.`);
    if (Object.hasOwn(entries, key)) {
      if (entries[key] !== value) kept.push(key);
      continue;
    }
    entries[key] = value;
  }
  writeJson(tree, file, current);
  return kept;
}

const CONFIGURATION =
  /<extension\s+target\s*=\s*"org\.nuxeo\.agentic\.ui\.config"\s+point\s*=\s*"configuration"\s*>/;

/**
 * Adds `<layout type mode src>` to the package's component, inside its
 * `org.nuxeo.agentic.ui.config` extension, which it adds before `</component>` when there is none.
 * The package pipeline refuses a layout contributed from anywhere but
 * `agentic-ui-config/layouts/<Type>/<mode>.layout.json` (package-pipeline.md, section 2), and the
 * server serves only what the component contributes, so a layout file the component does not
 * name is never seen.
 *
 * An entry for the type and mode already there is left alone when it names that file, and refused
 * when it names another: two contributions of one layout would leave the later to win.
 */
export function contributeLayout(tree: Tree, pkg: AppPackage, type: string, mode: string): void {
  const xml = tree.read(pkg.component, 'utf-8');
  if (xml === null) throw new Error(`Cannot read ${pkg.component}.`);
  const src = `agentic-ui-config/layouts/${type}/${mode}.layout.json`;
  const existing = [...xml.matchAll(/<layout\b[^>]*>/g)].find(
    ([tag]) => attribute(tag, 'type') === type && attribute(tag, 'mode') === mode,
  );
  if (existing) {
    if (attribute(existing[0], 'src') === src) return;
    throw new Error(
      `${pkg.component} already contributes the ${type}/${mode} layout, from ` +
        `${attribute(existing[0], 'src') ?? 'inline'}. Remove that entry first.`,
    );
  }
  const entry = `<layout type="${type}" mode="${mode}" src="${src}" />`;
  const opening = CONFIGURATION.exec(xml);
  if (opening) {
    const close = xml.indexOf('</extension>', opening.index);
    if (close < 0)
      throw new Error(`${pkg.component}: its configuration extension is never closed.`);
    const lineStart = xml.lastIndexOf('\n', close) + 1;
    const before = xml.slice(lineStart, close).trim() === '' ? lineStart : close;
    tree.write(pkg.component, `${xml.slice(0, before)}    ${entry}\n${xml.slice(before)}`);
    return;
  }
  const end = xml.lastIndexOf('</component>');
  if (end < 0) throw new Error(`${pkg.component} has no </component>.`);
  const extension =
    '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
    `    ${entry}\n` +
    '  </extension>\n';
  const lineStart = xml.lastIndexOf('\n', end) + 1;
  tree.write(pkg.component, `${xml.slice(0, lineStart)}\n${extension}${xml.slice(lineStart)}`);
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1];
}

/** A comma-separated option as a list, or a list as given; empty items dropped. */
export function listOption(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  const items = typeof value === 'string' ? value.split(',') : [...value];
  return items.map((item) => item.trim()).filter((item) => item !== '');
}
