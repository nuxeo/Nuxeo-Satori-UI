import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { workspaceRoot, type Tree } from '@nx/devkit';

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
export function markupOnly(xml: string): string {
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
  const extensions = configurationExtensions(pkg, markup);
  const existing = [...markup.matchAll(/<layout\b[^>]*>/g)].filter(
    ([tag]) => attribute(tag, 'type') === type && attribute(tag, 'mode') === mode,
  );
  for (const [tag, at = 0] of existing.map((match) => [match[0], match.index] as const)) {
    // One outside the configuration's point is registered by nothing: the pipeline refuses it,
    // and an entry added beside it would leave two to read.
    if (!extensions.some(({ start, close }) => at > start && at < close)) {
      throw new Error(
        `${pkg.component} has the ${type}/${mode} layout outside an extension of org.nuxeo.agentic.ui.config's "configuration" point, where nothing registers it. Move it into one, or remove it.`,
      );
    }
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
  // The layouts go in a configuration extension of their own, not in the one that holds the app,
  // as the kits write them: the app's element stays whole, and is the last thing in its extension.
  const opening = extensions.find(({ body }) => !APP_TAG().test(body));
  if (opening) {
    const lineStart = markup.lastIndexOf('\n', opening.close) + 1;
    const before = markup.slice(lineStart, opening.close).trim() === '' ? lineStart : opening.close;
    tree.write(pkg.component, `${xml.slice(0, before)}    ${entry}\n${xml.slice(before)}`);
    return;
  }
  const extension =
    '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
    `    ${entry}\n` +
    '  </extension>\n';
  // Before the app's extension when there is one, so the app stays the component's last word.
  const app = extensions.find(({ body }) => APP_TAG().test(body));
  if (app) {
    const lineStart = markup.lastIndexOf('\n', app.start) + 1;
    tree.write(pkg.component, `${xml.slice(0, lineStart)}${extension}\n${xml.slice(lineStart)}`);
    return;
  }
  const end = markup.lastIndexOf('</component>');
  if (end < 0) throw new Error(`${pkg.component} has no </component>.`);
  const lineStart = markup.lastIndexOf('\n', end) + 1;
  tree.write(pkg.component, `${xml.slice(0, lineStart)}\n${extension}${xml.slice(lineStart)}`);
}

/** An element's start tag, as the pipeline's `TAG` reads one: its attributes, quoted either way. */
const startTag = (name: string): RegExp =>
  new RegExp(`<${name}(?=[ \\t\\r\\n/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'g');
/** A fresh `<app>` start tag pattern: a global pattern keeps its place between searches. */
const APP_TAG = (): RegExp => startTag('app');

interface Extension {
  /** Where its start tag begins, and where its `</extension>` does. */
  readonly start: number;
  readonly close: number;
  /** What it holds, blanked as `markupOnly` blanks it. */
  readonly body: string;
}

/**
 * The component's extensions to `org.nuxeo.agentic.ui.config`'s "configuration" point, in order,
 * read from `markup`: where the server registers a layout and an app. One never closed is refused.
 */
function configurationExtensions(pkg: AppPackage, markup: string): Extension[] {
  const found: Extension[] = [];
  for (const match of markup.matchAll(startTag('extension'))) {
    const [tag] = match;
    if (
      tag.endsWith('/>') ||
      attribute(tag, 'target') !== 'org.nuxeo.agentic.ui.config' ||
      attribute(tag, 'point') !== 'configuration'
    )
      continue;
    const start = match.index ?? 0;
    // `</extension >` closes it too, as the pipeline reads an end tag.
    const end = /<\/extension[ \t\r\n]*>/.exec(markup.slice(start));
    const close = end === null ? -1 : start + end.index;
    if (close < 0)
      throw new Error(`${pkg.component}: its configuration extension is never closed.`);
    found.push({ start, close, body: markup.slice(start + tag.length, close) });
  }
  return found;
}

/**
 * The files of an app definition the app registry serves besides `app.json`, each at its place,
 * in the order the generators name them: app-definition-v2.md, section 10's example. They are the
 * package pipeline's `REGISTRY_FILES` (`scripts/app-package.mjs`), which judges what is written
 * with them, as `app-package/pipeline.spec.ts` checks.
 */
const REGISTRY_FILES: readonly RegExp[] = [
  /^home\.json$/,
  /^navigation\.json$/,
  /^queues\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.json$/,
  /^labels\/[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\.json$/,
  /^tasks\/[A-Za-z][A-Za-z0-9_-]{0,127}\.[A-Za-z][A-Za-z0-9_-]{0,127}\.layout\.json$/,
  /^actions\.json$/,
];

/** More files than this, and the server refuses the app: `ContributionRegistry.MAX_APP_FILES`. */
export const MAX_APP_FILES = 256;

/** Every file under `directory` in the tree, relative to it, with `/` between its parts. */
function filesIn(tree: Tree, directory: string, prefix = ''): string[] {
  return tree.children(directory).flatMap((name) => {
    const path = `${directory}/${name}`;
    return tree.isFile(path) ? [`${prefix}${name}`] : filesIn(tree, path, `${prefix}${name}/`);
  });
}

/** The files of the package's app definition the registry serves, in the order they are named. */
export function registryFiles(tree: Tree, pkg: AppPackage): string[] {
  const rank = (path: string): number => REGISTRY_FILES.findIndex((place) => place.test(path));
  return filesIn(tree, pkg.config)
    .filter((path) => rank(path) >= 0)
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** What `contributeApp` did to the component's `<app>`. */
export interface AppContribution {
  /** `absent`: there is no app to keep in step, and none was asked for. */
  readonly status: 'written' | 'refreshed' | 'unchanged' | 'absent';
  /** The files it names now, and those it named and no longer does. */
  readonly files: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

const APP_SRC = 'agentic-ui-config/app.json';

/**
 * Has the package's component contribute its app to the app registry (app-definition-v2.md,
 * section 10): `<app id src>`, from `agentic-ui-config/app.json`, under `app.json`'s id, naming
 * every file of the app definition the registry serves (`registryFiles`), as the pipeline's step 2
 * requires. A file the package holds and the element does not name would never be served; one it
 * names and the package does not hold, the pipeline refuses.
 *
 * With `create`, an element is written in a configuration extension of its own, before
 * `</component>`, when there is none. Without it, only an element already there is kept in step:
 * the generators that add a file call it so, and `app-registry` and `app-package` create one.
 *
 * The component is read as the pipeline reads it (`markupOnly`): an `<app>` in a comment is not
 * one. An element there is kept, its `<file>` lines in their order: those for a file the package
 * no longer holds are removed, and those for a file it does not name yet are added before
 * `</app>`. Refused rather than guessed: two enabled apps, one disabled only (when `create`), and
 * one with another id or `src`, which the pipeline refuses too.
 */
export function contributeApp(
  tree: Tree,
  pkg: AppPackage,
  { create }: { readonly create: boolean },
): AppContribution {
  const xml = tree.read(pkg.component, 'utf-8');
  if (xml === null) throw new Error(`Cannot read ${pkg.component}.`);
  const markup = markupOnly(xml);
  const files = registryFiles(tree, pkg);
  if (files.length > MAX_APP_FILES) {
    throw new Error(
      `${pkg.config} has ${files.length} files the app registry would serve; it serves at most ${MAX_APP_FILES} (ContributionRegistry.MAX_APP_FILES).`,
    );
  }
  const element = `<app id="${pkg.appId}" src="${APP_SRC}">`;
  const apps = [...markup.matchAll(APP_TAG())];
  const enabled = apps.filter(([tag]) => {
    const value = attribute(tag, 'enabled');
    return value === undefined || value.toLowerCase() === 'true';
  });
  if (enabled.length > 1) {
    throw new Error(
      `${pkg.component} contributes ${enabled.length} apps; a package is one app. Remove all but one.`,
    );
  }
  const fileLine = (indent: string, path: string) => `${indent}<file path="${path}" />\n`;

  if (enabled.length === 0) {
    if (!create) return { status: 'absent', files: [], added: [], removed: [] };
    if (apps.length > 0) {
      throw new Error(
        `${pkg.component} has the app disabled (enabled="${attribute(apps[0][0], 'enabled')}"), so the registry serves none. Remove that entry, or enable it.`,
      );
    }
    const end = markup.lastIndexOf('</component>');
    if (end < 0) throw new Error(`${pkg.component} has no </component>.`);
    const extension =
      '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
      `    ${element}\n` +
      files.map((path) => fileLine('      ', path)).join('') +
      '    </app>\n' +
      '  </extension>\n';
    const lineStart = markup.lastIndexOf('\n', end) + 1;
    tree.write(pkg.component, `${xml.slice(0, lineStart)}\n${extension}${xml.slice(lineStart)}`);
    return { status: 'written', files, added: files, removed: [] };
  }

  const [match] = enabled;
  const [tag, inside] = match;
  const at = match.index ?? 0;
  const id = attribute(tag, 'id');
  if (id !== pkg.appId) {
    throw new Error(
      `${pkg.component} contributes the app "${id ?? ''}", and app.json's id is "${pkg.appId}". Contribute it as ${element}.`,
    );
  }
  const src = attribute(tag, 'src');
  if (src !== APP_SRC) {
    throw new Error(
      `${pkg.component} contributes the app ${id} from ${src ?? 'no src'}. Contribute it from ${APP_SRC}, which the validator reads.`,
    );
  }
  const appLine = markup.lastIndexOf('\n', at) + 1;
  const indent = /^[ \t]*$/.test(markup.slice(appLine, at)) ? markup.slice(appLine, at) : '    ';
  if (inside.trimEnd().endsWith('/')) {
    // `<app ... />`, which names no file: written whole, with them.
    const written =
      `${tag.replace(/\s*\/>$/, '>')}\n` +
      files.map((path) => fileLine(`${indent}  `, path)).join('') +
      `${indent}</app>`;
    tree.write(pkg.component, `${xml.slice(0, at)}${written}${xml.slice(at + tag.length)}`);
    return { status: 'refreshed', files, added: files, removed: [] };
  }
  const bodyStart = at + tag.length;
  const close = markup.indexOf('</app', bodyStart);
  if (close < 0) throw new Error(`${pkg.component}: its <app> is never closed.`);
  const entries = [...markup.slice(bodyStart, close).matchAll(startTag('file'))].map((entry) => ({
    path: attribute(entry[0], 'path') ?? '',
    start: bodyStart + (entry.index ?? 0),
    end: bodyStart + (entry.index ?? 0) + entry[0].length,
  }));
  const kept = new Set<string>();
  const stale = entries.filter((entry) => {
    if (!files.includes(entry.path) || kept.has(entry.path)) return true;
    kept.add(entry.path);
    return false;
  });
  const missing = files.filter((path) => !kept.has(path));
  if (stale.length === 0 && missing.length === 0) {
    return { status: 'unchanged', files, added: [], removed: [] };
  }
  // From the end, so each offset still holds: the new lines before `</app>`, then each stale entry
  // taken out, its line with it when it is alone on the line.
  let out = xml;
  const fileIndent = (() => {
    const first = entries[0];
    if (!first) return `${indent}  `;
    const line = markup.lastIndexOf('\n', first.start) + 1;
    const before = markup.slice(line, first.start);
    return /^[ \t]*$/.test(before) ? before : `${indent}  `;
  })();
  const closeLine = markup.lastIndexOf('\n', close) + 1;
  if (missing.length > 0) {
    const lines = missing.map((path) => fileLine(fileIndent, path)).join('');
    out =
      markup.slice(closeLine, close).trim() === '' && closeLine > bodyStart
        ? `${out.slice(0, closeLine)}${lines}${out.slice(closeLine)}`
        : `${out.slice(0, close)}\n${lines}${indent}${out.slice(close)}`;
  }
  for (const entry of [...stale].reverse()) {
    const line = markup.lastIndexOf('\n', entry.start - 1) + 1;
    const next = markup.indexOf('\n', entry.end);
    const lineEnd = next < 0 ? markup.length : next + 1;
    const alone =
      markup.slice(line, entry.start).trim() === '' &&
      markup.slice(entry.end, lineEnd).trim() === '';
    out = alone
      ? `${out.slice(0, line)}${out.slice(lineEnd)}`
      : `${out.slice(0, entry.start)}${out.slice(entry.end)}`;
  }
  tree.write(pkg.component, out);
  return {
    status: 'refreshed',
    files,
    added: missing,
    removed: stale.map((entry) => entry.path),
  };
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
export function attribute(tag: string, name: string): string | undefined {
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

/**
 * What a generator that added a file says of the app's contribution, `contributeApp`'s `result`:
 * the files it now names or no longer does, or, when the component contributes no app and `absent`
 * is not false, how to add it. Empty when nothing changed.
 */
export function appContributionSaid(
  pkg: AppPackage,
  result: AppContribution,
  { absent = true }: { readonly absent?: boolean } = {},
): string {
  if (result.status === 'absent') {
    if (!absent) return '';
    return (
      `\n  ${pkg.component} contributes no app, so the app registry will not serve these files ` +
      `on a server. Add it with:\n\n    npx nx g ./tools/satori-generators:app-registry --package=${pkg.root}\n`
    );
  }
  const lines = [
    ...(result.added.length > 0 ? [`now names ${result.added.join(', ')}`] : []),
    ...(result.removed.length > 0 ? [`no longer names ${result.removed.join(', ')}`] : []),
  ];
  return lines.length === 0
    ? ''
    : `\n  The app's <app> in ${pkg.component} ${lines.join(', and ')}.\n`;
}

/** Where the platform's own routes are listed, once: the validator's `PLATFORM_ROUTES`. */
export const PLATFORM_ROUTES_FILE = 'libs/shared/app-definition/src/lib/platform-routes.ts';

/**
 * The platform's own routes, which no app's address may be, read from the one place they are
 * listed (`PLATFORM_ROUTES_FILE`), which these sources cannot import (the top of this file says
 * why). Read strictly: the list must hold quoted names and nothing else, so that a change of its
 * form is refused rather than read in part. `app-package/generator.spec.ts` holds what this reads
 * to the validator, run as a command.
 */
export function platformRoutes(root: string = workspaceRoot): readonly string[] {
  let text: string;
  try {
    text = readFileSync(join(root, PLATFORM_ROUTES_FILE), 'utf-8');
  } catch (error) {
    throw new Error(
      `Cannot read the platform's routes from ${PLATFORM_ROUTES_FILE}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}.`,
    );
  }
  const body = /export const PLATFORM_ROUTES: readonly string\[\] = \[([^\]]*)\];/.exec(text)?.[1];
  const items = (body ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (items.length === 0 || !items.every((item) => /^'[a-z][a-z0-9-]*'$/.test(item))) {
    throw new Error(
      `Cannot read the platform's routes from ${PLATFORM_ROUTES_FILE}: PLATFORM_ROUTES is not a list of quoted names there.`,
    );
  }
  return items.map((item) => item.slice(1, -1));
}

/** A comma-separated option as a list, or a list as given; empty items dropped. */
export function listOption(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  const items = typeof value === 'string' ? value.split(',') : [...value];
  return items.map((item) => item.trim()).filter((item) => item !== '');
}
