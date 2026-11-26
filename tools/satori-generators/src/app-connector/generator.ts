import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { formatFiles, workspaceRoot, type Tree } from '@nx/devkit';

import { readModel, schemasOf, type Model } from '../app-layout/content-model';
import {
  attribute,
  listOption,
  markupOnly,
  parseJson,
  readAppPackage,
  XPATH,
} from '../app-package/package-files';

export interface AppConnectorSchema {
  package: string;
  id: string;
  type?: string | string[];
  key?: string;
  path?: string;
  fields?: string | string[];
  permission?: string;
  credential?: boolean;
  header?: string;
  prefix?: string;
  connectTimeout?: number;
  timeout?: number;
  maxBytes?: number;
  maxConcurrent?: number;
  model?: string;
  remove?: boolean;
  force?: boolean;
}

/** Where a kit's connectors are, beside its bundle: not in it (the component's comment says why). */
export const CONNECTORS = 'connectors';
/** The connectors add-on's component, which a contribution requires, and its point. */
const TARGET = 'org.nuxeo.agentic.connectors';
const POINT = 'connectors';

/** The add-on's rules for what a contribution names (nuxeo-agentic-connectors/README.md). */
const ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
/** An id may not end so: the server's own settings for a connector are named there. */
const RESERVED_END = /\.(?:http|cache|events)$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** A JSON pointer into the other system's answer, `/policy/status`. */
const POINTER = /^(?:\/(?:[^~/]|~[01])*)+$/;
const TYPE = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const PERMISSION = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** A header that would change where the request goes, which the add-on refuses. */
const ROUTING_HEADER = /^(?:host|cookie|proxy-.*)$/i;
const HEADER = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const MAX_TYPES = 20;
const MAX_FIELDS = 50;

/** The numbers a connector may set, with the add-on's bounds. */
const LIMITS = {
  connectTimeout: [100, 10_000],
  timeout: [100, 30_000],
  maxBytes: [1024, 1_048_576],
  maxConcurrent: [1, 64],
} as const;

/**
 * A path on the other system: from `/`, with `{key}` once, and otherwise letters, digits, `/`,
 * `.`, `_`, `~` and `-`, no empty, `.` or `..` segment, and no query (the add-on's rule).
 */
function pathProblem(path: string): string | null {
  if (!path.startsWith('/')) return 'starts with /';
  if (path.split('{key}').length !== 2) return 'holds {key} once';
  if (
    !/^[A-Za-z0-9/._~{}-]*$/.test(path.replace('{key}', 'k')) ||
    /[{}]/.test(path.replace('{key}', ''))
  )
    return 'holds only letters, digits, "/", ".", "_", "~" and "-" besides {key}, and no query';
  const segments = path.slice(1).split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
    return 'has no empty, "." or ".." segment';
  return null;
}

/** The name the add-on's settings for a connector begin with, and its environment variables. */
export function connectorSettings(id: string): { property: string; env: string } {
  return {
    property: `nuxeo.agentic.connectors.${id}`,
    env: `NUXEO_CONNECTOR_${id.toUpperCase().replace(/[.-]/g, '_')}`,
  };
}

/** `text` safe inside an XML element or a double-quoted attribute. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The component as it starts: the kit's own, beside its bundle, requiring the add-on. */
function connectorsComponent(name: string, kit: string): string {
  return `<?xml version="1.0"?>
<!--
  The ${kit} kit's connectors, written by the app-connector generator: each reads fields of one
  record from another system, by a key the record holds, for a layout's external card
  (docs/business-apps/layout-v2.md, section 7).

  Not in the bundle, on purpose: it requires org.nuxeo.agentic.connectors, which has no Marketplace
  package yet, so carried by the bundle it would stay pending on every server without the add-on.
  For a server that has the add-on, drop this file into nxserver/config/, as the add-on's own demo
  connector is (nuxeo-agentic-connectors/README.md).

  No address and no credential is written here: each connector's address is the server property
  its <address> names, and its credential the property or the environment variable its
  <credential> names, set on the server. Without its address a connector sends nothing. The
  package pipeline holds each external card that names one of these to its fields.
-->
<component name="${name}" version="1.0">
  <require>${TARGET}</require>

  <extension target="${TARGET}" point="${POINT}">
  </extension>
</component>
`;
}

/** The `<connector>` elements of `markup`, by id, with where each starts and ends. */
function connectorsIn(markup: string): { id: string; start: number; end: number }[] {
  const found: { id: string; start: number; end: number }[] = [];
  for (const match of markup.matchAll(/<connector(?=[ \t\r\n/>])(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    const start = match.index ?? 0;
    const close = match[0].endsWith('/>')
      ? start + match[0].length
      : (() => {
          const end = /<\/connector[ \t\r\n]*>/.exec(markup.slice(start));
          return end === null ? -1 : start + end.index + end[0].length;
        })();
    if (close < 0) throw new Error(`a <connector> is never closed.`);
    found.push({ id: attribute(match[0], 'id') ?? '', start, end: close });
  }
  return found;
}

/** The content model the types and the key are held to: `--model`, else the kit's own, if any. */
function modelFor(tree: Tree, root: string, given: string | undefined): Model | null {
  if (given !== undefined) {
    const file = isAbsolute(given) ? given : resolve(workspaceRoot, given);
    if (!existsSync(file)) throw new Error(`--model ${given} does not exist.`);
    return readModel(parseJson(readFileSync(file, 'utf-8'), given), given);
  }
  const own = `${root}/content-model.json`;
  const text = tree.read(own, 'utf-8');
  return text === null ? null : readModel(parseJson(text, own), own);
}

/**
 * Write a connector of a kit's own (nuxeo-agentic-connectors/README.md, "The contribution"), into
 * `connectors/<package>-connectors-config.xml`, beside the bundle, for an `external` card of a
 * layout to read another system's fields through (layout-v2.md, section 7):
 *
 * - **What it reads:** `--type`, the document types it reads a key from; `--key`, the property
 *   that holds the key, `<prefix>:<name>`, a single value of each type, given a content model;
 *   `--path`, where on the other system, with `{key}` once, such as `/claims/{key}`; and
 *   `--fields`, what it returns, each `name` or `name=/json/pointer`, `/<name>` by default.
 * - **What it never holds:** an address or a credential. The address is the server property
 *   `nuxeo.agentic.connectors.<id>.address`, and the credential, unless `--credential=false`, a
 *   bearer token from `nuxeo.agentic.connectors.<id>.token`, else the environment variable
 *   `NUXEO_CONNECTOR_<ID>_TOKEN`, each set on the server.
 * - **Held to the model:** each type and the key, against `--model`, else the kit's own
 *   `content-model.json` when it has one; with neither, as on a customer's server, they are the
 *   server's, and the pipeline does not see them either.
 * - **One file for the kit's connectors,** its own component, which no zip carries: the add-on has
 *   no Marketplace package yet, so a bundle carrying it would leave it pending on a server without
 *   the add-on. A server with the add-on takes it in `nxserver/config/`.
 * - **`--force`** writes a connector the file has again; **`--remove`** takes it out, and the file
 *   with it when it was the last.
 *
 * The package pipeline reads the file: each `external` card naming one of these connectors is held
 * to its fields and its types, as `--registered` holds a card to a server's (package-pipeline.md,
 * section 2). Nothing here is installed, and nothing reaches the other system.
 */
export default async function appConnectorGenerator(tree: Tree, options: AppConnectorSchema) {
  const pkg = readAppPackage(tree, options.package);
  const id = options.id ?? '';
  if (!ID.test(id) || RESERVED_END.test(id)) {
    throw new Error(
      `--id "${options.id}" must be 1 to 64 letters, digits, ".", "_" or "-", starting with a letter, and not end in .http, .cache or .events, which name the server's own settings for a connector.`,
    );
  }
  const pkgName = pkg.component
    .slice(pkg.component.lastIndexOf('/') + 1)
    .replace(/-config\.xml$/, '');
  const file = `${pkg.root}/${CONNECTORS}/${pkgName}-connectors-config.xml`;
  const markupNow = () => markupOnly(tree.read(file, 'utf-8') ?? '');

  if (options.remove) {
    const extra = (['type', 'key', 'path', 'fields'] as const).filter(
      (option) => options[option] !== undefined,
    );
    if (extra.length > 0 || options.force) {
      throw new Error(
        `--remove takes the connector ${id} out: give it alone, without ${extra.length > 0 ? extra.map((option) => `--${option}`).join(', ') : '--force'}.`,
      );
    }
    const text = tree.read(file, 'utf-8');
    const found = text === null ? [] : connectorsIn(markupOnly(text)).filter((c) => c.id === id);
    if (text === null || found.length === 0)
      throw new Error(`${file} has no connector ${id} to take out.`);
    const [connector] = found;
    const markup = markupOnly(text);
    const lineStart = markup.lastIndexOf('\n', connector.start - 1) + 1;
    const next = markup.indexOf('\n', connector.end);
    const lineEnd = next < 0 ? markup.length : next + 1;
    const left = `${text.slice(0, lineStart)}${text.slice(lineEnd)}`;
    const others = connectorsIn(markupOnly(left));
    if (others.length === 0) tree.delete(file);
    else tree.write(file, left);
    await formatFiles(tree);
    return () => {
      console.log(`
Took the connector ${id} out of ${file}${others.length === 0 ? ', and the file with it, the last' : ''}.

An external card that names it now names a connector of the server's, which the pipeline does not
read: take the card out, or write it with another connector.
`);
    };
  }

  const types = listOption(options.type);
  if (types.length === 0 || types.length > MAX_TYPES)
    throw new Error(`--type: 1 to ${MAX_TYPES} document types the connector reads a key from.`);
  const badType = types.find((type) => !TYPE.test(type));
  if (badType !== undefined) throw new Error(`--type: "${badType}" is not a document type's name.`);
  if (new Set(types).size !== types.length) throw new Error('--type lists a type twice.');
  const key = options.key ?? '';
  if (!XPATH.test(key) || /^(?:ecm|var):/.test(key))
    throw new Error(
      `--key "${options.key}" must be the property that holds the key, <prefix>:<name>, such as claim:number.`,
    );
  const path = options.path ?? '';
  const problem = pathProblem(path);
  if (problem !== null)
    throw new Error(
      `--path "${options.path}" must be a path on the other system that ${problem}, such as /claims/{key}.`,
    );
  const fields = listOption(options.fields).map((entry) => {
    const at = entry.indexOf('=');
    const name = (at < 0 ? entry : entry.slice(0, at)).trim();
    const pointer = (at < 0 ? `/${name}` : entry.slice(at + 1)).trim();
    if (!FIELD.test(name))
      throw new Error(
        `--fields: "${name}" is not a field's name: letters, digits and "_", starting with a letter, as an external card names it.`,
      );
    if (!POINTER.test(pointer) || pointer.length > 256)
      throw new Error(
        `--fields: "${pointer}", ${name}'s, is not a JSON pointer into the other system's answer, such as /policy/status.`,
      );
    return { name, pointer };
  });
  if (fields.length === 0 || fields.length > MAX_FIELDS)
    throw new Error(`--fields: 1 to ${MAX_FIELDS} fields the connector returns.`);
  const twice = fields.find(
    (field, i) => fields.findIndex((other) => other.name === field.name) !== i,
  );
  if (twice !== undefined) throw new Error(`--fields lists "${twice.name}" twice.`);
  const permission = options.permission ?? 'Read';
  if (!PERMISSION.test(permission))
    throw new Error(`--permission "${permission}" is not a Nuxeo permission's name, such as Read.`);
  const credential = options.credential ?? true;
  const header = options.header ?? 'Authorization';
  const prefix = options.prefix ?? 'Bearer ';
  if (!credential && (options.header ?? options.prefix) !== undefined)
    throw new Error('--header and --prefix describe the credential: not with --credential=false.');
  if (!HEADER.test(header) || ROUTING_HEADER.test(header))
    throw new Error(
      `--header "${header}" is not a header the credential may go in: a header's name, and not Host, Cookie or Proxy-*, which change where the request goes.`,
    );
  if (prefix.length > 32 || !/^[\x20-\x7e]*$/.test(prefix))
    throw new Error('--prefix is at most 32 printable characters, such as "Bearer ".');
  for (const [option, [least, most]] of Object.entries(LIMITS)) {
    const value = options[option as keyof typeof LIMITS];
    if (value !== undefined && !(Number.isInteger(value) && value >= least && value <= most))
      throw new Error(`--${option} ${value} must be a whole number from ${least} to ${most}.`);
  }

  // The types and the key, held to the content model when there is one.
  const model = modelFor(tree, pkg.root, options.model);
  if (model !== null) {
    for (const type of types) {
      const definition = model.types.get(type);
      if (!definition) throw new Error(`--type: the content model has no document type "${type}".`);
      const [prefixOf, name] = key.split(':');
      const property = schemasOf(model, definition)
        .map((schema) => model.schemas.get(schema))
        .find((schema) => schema?.prefix === prefixOf)
        ?.properties.get(name);
      if (!property)
        throw new Error(`--key: "${key}" is not a property of ${type} in the content model.`);
      if (property.list || property.type === 'complex' || property.type === 'blob')
        throw new Error(
          `--key: "${key}" holds ${property.list ? 'a list' : `a ${property.type} value`} on ${type}, and a key is one value, put into the path.`,
        );
    }
  }

  const settings = connectorSettings(id);
  const optional = (Object.keys(LIMITS) as (keyof typeof LIMITS)[])
    .filter((option) => options[option] !== undefined)
    .map((option) => `  <${option}>${options[option]}</${option}>\n`)
    .join('');
  const element =
    `<connector id="${id}">\n` +
    types.map((type) => `  <type>${type}</type>\n`).join('') +
    `  <address property="${settings.property}.address" />\n` +
    `  <path>${escapeXml(path)}</path>\n` +
    `  <key xpath="${key}" />\n` +
    `  <permission>${permission}</permission>\n` +
    (credential
      ? `  <credential header="${escapeXml(header)}" prefix="${escapeXml(prefix)}" property="${settings.property}.token"\n` +
        `              env="${settings.env}_TOKEN" />\n`
      : '') +
    optional +
    fields
      .map((field) => `  <field name="${field.name}" pointer="${escapeXml(field.pointer)}" />\n`)
      .join('') +
    '</connector>';

  const component = (() => {
    const markup = markupOnly(tree.read(pkg.component, 'utf-8') ?? '');
    const tag = /<component(?=[ \t\r\n/>])(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(markup)?.[0];
    const name = tag === undefined ? undefined : attribute(tag, 'name');
    if (!name) throw new Error(`${pkg.component} has no <component name="...">.`);
    return `${name}.connectors`;
  })();
  let xml = tree.read(file, 'utf-8') ?? connectorsComponent(component, pkgName);
  const markup = markupOnly(xml);
  const existing = connectorsIn(markup).find((connector) => connector.id === id);
  if (existing && !options.force)
    throw new Error(`${file} has the connector ${id} already. Pass --force to write it again.`);
  const indent = '    ';
  const indented = element
    .split('\n')
    .map((line) => (line === '' ? '' : `${indent}${line}`))
    .join('\n');
  if (existing) {
    const lineStart = markup.lastIndexOf('\n', existing.start - 1) + 1;
    xml = `${xml.slice(0, lineStart)}${indented}${xml.slice(existing.end)}`;
  } else {
    const opening = [
      ...markup.matchAll(/<extension(?=[ \t\r\n/>])(?:[^>"']|"[^"]*"|'[^']*')*>/g),
    ].find(([tag]) => attribute(tag, 'target') === TARGET && attribute(tag, 'point') === POINT);
    if (opening === undefined)
      throw new Error(`${file} has no extension of ${TARGET}'s ${POINT} point.`);
    const end = /<\/extension[ \t\r\n]*>/.exec(markup.slice(opening.index ?? 0));
    if (end === null) throw new Error(`${file}: its ${POINT} extension is never closed.`);
    const close = (opening.index ?? 0) + end.index;
    const lineStart = markup.lastIndexOf('\n', close - 1) + 1;
    const before = markup.slice(lineStart, close).trim() === '' ? lineStart : close;
    // A blank line between two connectors, as the add-on's own demo writes them.
    const separator = connectorsIn(markup).length > 0 ? '\n' : '';
    xml = `${xml.slice(0, before)}${separator}${indented}\n${xml.slice(before)}`;
  }
  tree.write(file, xml);
  await formatFiles(tree);

  return () => {
    console.log(`
Wrote the connector ${id} to ${file}${existing ? ', again' : ''}:

  Reads:        ${types.join(', ')}, by ${key}, at ${path}
  Returns:      ${fields.map((field) => field.name).join(', ')}
  Address:      the server property ${settings.property}.address
  Credential:   ${credential ? `${header}: ${prefix.trim()} <token>, from ${settings.property}.token or ${settings.env}_TOKEN` : 'none'}
  Held to:      ${model === null ? "no content model: the types and the key are the server's" : 'the content model, its types and key'}

An external card names it, with the fields it shows:

  { "id": "core", "labelKey": "<key>", "external": { "connector": "${id}", "fields": ["${fields[0].name}"] } }

The pipeline holds each such card to these fields and types. On a server with the add-on, drop
${file.slice(pkg.root.length + 1)} into nxserver/config/, and set the address and the credential there:
nothing is installed here, and nothing reaches the other system.
`);
  };
}
