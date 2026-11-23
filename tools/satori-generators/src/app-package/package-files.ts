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

const CLOSING: Readonly<Record<string, string>> = { '<!--': '-->', '<?': '?>', '<![CDATA[': ']]>' };

/** `text` as spaces, its line breaks kept, so that offsets into it stay offsets into the original. */
const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/**
 * `xml` with what the server does not register blanked, character for character, as the
 * pipeline's `componentXmlOf` (`scripts/verify-package-zip.mjs`) reads a component: comments,
 * processing instructions and CDATA sections, then the `<documentation>` of the component and of
 * its extension points, which may hold examples of real markup. A search of it finds only what the
 * server would register, and an index into it is an index into `xml`. One left unterminated is
 * blanked to the end, as the pipeline drops it; `build.mjs` refuses it.
 */
function markupOnly(xml: string): string {
  const next = /<!--|<\?|<!\[CDATA\[/g;
  let out = '';
  let at = 0;
  for (;;) {
    next.lastIndex = at;
    const match = next.exec(xml);
    if (!match) break;
    const end = xml.indexOf(CLOSING[match[0]], match.index + match[0].length);
    const stop = end < 0 ? xml.length : end + CLOSING[match[0]].length;
    out += xml.slice(at, match.index) + blank(xml.slice(match.index, stop));
    at = stop;
  }
  return withoutDocumentation(out + xml.slice(at));
}

/** The pipeline's `withoutDocumentation`, ported: documentation inside a descriptor is not read. */
function withoutDocumentation(xml: string): string {
  const parents: string[] = [];
  let start: number | undefined;
  let depth = 0;
  let at = 0;
  let out = '';
  for (const match of xml.matchAll(/<(\/)?([^\s/>]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const [tag, close, name, tail] = match;
    const index = match.index ?? 0;
    const empty = tail.trimEnd().endsWith('/');
    if (
      !close &&
      name === 'documentation' &&
      start === undefined &&
      parents[0] === 'component' &&
      (parents.length === 1 || (parents.length === 2 && parents[1] === 'extension-point'))
    ) {
      start = index;
      depth = parents.length;
    }
    if (
      start !== undefined &&
      ((close && parents.length === depth + 1) || (empty && index === start))
    ) {
      const end = index + tag.length;
      out += xml.slice(at, start) + blank(xml.slice(start, end));
      at = end;
      start = undefined;
    }
    if (close) parents.pop();
    else if (!empty) parents.push(name);
  }
  return out + xml.slice(at);
}

/**
 * Adds `<layout type mode src>` to the package's component, inside its
 * `org.nuxeo.agentic.ui.config` extension, which it adds before `</component>` when there is none.
 * The package pipeline refuses a layout contributed from anywhere but
 * `agentic-ui-config/layouts/<Type>/<mode>.layout.json` (package-pipeline.md, section 2), and the
 * server serves only what the component contributes, so a layout file the component does not
 * name is never seen.
 *
 * The component is read as the pipeline reads it (`markupOnly`, `attribute`): what a comment, a
 * processing instruction, a CDATA section or a component's documentation holds is not an entry. An
 * entry for the type and mode already there is left alone when it names that file, and refused when
 * it names another, since two contributions of one layout leave the later to win, or when it is
 * disabled, since the server would then serve nothing.
 */
export function contributeLayout(tree: Tree, pkg: AppPackage, type: string, mode: string): void {
  const xml = tree.read(pkg.component, 'utf-8');
  if (xml === null) throw new Error(`Cannot read ${pkg.component}.`);
  const markup = markupOnly(xml);
  const src = `agentic-ui-config/layouts/${type}/${mode}.layout.json`;
  const existing = [...markup.matchAll(/<layout\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => attribute(tag, 'type') === type && attribute(tag, 'mode') === mode);
  for (const tag of existing) {
    const enabled = attribute(tag, 'enabled');
    if (enabled !== undefined && enabled.toLowerCase() !== 'true') {
      throw new Error(
        `${pkg.component} has the ${type}/${mode} layout disabled (enabled="${enabled}"), so the server serves none. Remove that entry, or enable it.`,
      );
    }
    if (attribute(tag, 'src') !== src) {
      throw new Error(
        `${pkg.component} already contributes the ${type}/${mode} layout, from ` +
          `${attribute(tag, 'src') ?? 'inline'}. Remove that entry first.`,
      );
    }
  }
  if (existing.length > 0) return;
  const entry = `<layout type="${type}" mode="${mode}" src="${src}" />`;
  const opening = [...markup.matchAll(/<extension\b[^>]*>/g)].find(
    ([tag]) =>
      !tag.endsWith('/>') &&
      attribute(tag, 'target') === 'org.nuxeo.agentic.ui.config' &&
      attribute(tag, 'point') === 'configuration',
  );
  if (opening) {
    const close = markup.indexOf('</extension>', opening.index);
    if (close < 0)
      throw new Error(`${pkg.component}: its configuration extension is never closed.`);
    const lineStart = markup.lastIndexOf('\n', close) + 1;
    const before = markup.slice(lineStart, close).trim() === '' ? lineStart : close;
    tree.write(pkg.component, `${xml.slice(0, before)}    ${entry}\n${xml.slice(before)}`);
    return;
  }
  const end = markup.lastIndexOf('</component>');
  if (end < 0) throw new Error(`${pkg.component} has no </component>.`);
  const extension =
    '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
    `    ${entry}\n` +
    '  </extension>\n';
  const lineStart = markup.lastIndexOf('\n', end) + 1;
  tree.write(pkg.component, `${xml.slice(0, lineStart)}\n${extension}${xml.slice(lineStart)}`);
}

const ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/**
 * An attribute's value as the pipeline's `attributesOf` reads it: quoted either way, its character
 * and predefined entity references resolved, and trimmed.
 */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}[ \\t\\r\\n]*=[ \\t\\r\\n]*(?:"([^"]*)"|'([^']*)')`).exec(
    tag,
  );
  if (!match) return undefined;
  return (match[1] ?? match[2])
    .replace(
      /&(?:#x([0-9A-Fa-f]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g,
      (reference, hex, decimal, named) => {
        if (named) return ENTITIES[named];
        const codePoint = hex ? parseInt(hex, 16) : Number(decimal);
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : reference;
      },
    )
    .trim();
}

/** A comma-separated option as a list, or a list as given; empty items dropped. */
export function listOption(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  const items = typeof value === 'string' ? value.split(',') : [...value];
  return items.map((item) => item.trim()).filter((item) => item !== '');
}
