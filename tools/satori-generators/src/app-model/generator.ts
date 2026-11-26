import { formatFiles, type Tree } from '@nx/devkit';

import { NUXEO_SCHEMAS, TYPE } from '../app-layout/generator';
import {
  addLabels,
  attribute,
  contributeApp,
  humanize,
  isRecord,
  listOption,
  markupOnly,
  parseJson,
  readAppPackage,
  writeJson,
  XPATH,
  type AppPackage,
} from '../app-package/package-files';

export interface AppModelSchema {
  package: string;
  type: string;
  properties?: string | string[];
  schema?: string;
  prefix?: string;
  pageProvider?: string;
  where?: string;
  sort?: string;
  pageSize?: number;
  aggregates?: string | string[];
  attachments?: boolean;
  force?: boolean;
}

/**
 * Nuxeo's own document types, which a stand-in must not take the name of: contributed again, the
 * stand-in would replace the platform's on the server it is installed on.
 */
const NUXEO_TYPES = new Set([
  'Annotation',
  'Audio',
  'Collection',
  'Collections',
  'Comment',
  'DefaultSearch',
  'Document',
  'Domain',
  'Favorites',
  'File',
  'Folder',
  'Note',
  'OrderedFolder',
  'Picture',
  'Root',
  'Section',
  'SectionRoot',
  'TemplateRoot',
  'UserWorkspacesRoot',
  'Video',
  'Workspace',
  'WorkspaceRoot',
]);

/**
 * Schemas the platform's own types carry besides `NUXEO_SCHEMAS`, which a stand-in of the same
 * name would replace: a picture's, a note's, a task's, a collection's and the like.
 */
const PLATFORM_SCHEMAS = new Set([
  'audio',
  'collection',
  'collectionMember',
  'comment',
  'dublincore',
  'image_metadata',
  'note',
  'picture',
  'publishing',
  'task',
  'thumbnail',
  'video',
  'webcontainer',
]);

/** Prefixes Nuxeo's own schemas, or its system properties, write their properties with. */
const NUXEO_PREFIXES = new Set([
  'collection',
  'collectionMember',
  'comment',
  'common',
  'dc',
  'ecm',
  'file',
  'files',
  'note',
  'nt',
  'nxtag',
  'picture',
  'relatedtext',
  'thumb',
  'uid',
]);

/**
 * Whether `where` is one condition: its parentheses balanced outside its literals, quoted either
 * way with a backslash escaping, and none closed before it is opened. `x) OR (y` would break out
 * of the `AND (...)` it is written into, and with it the page provider's own conditions on
 * versions, proxies and the trash.
 */
function isOneCondition(where: string): boolean {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < where.length; i++) {
    const c = where[i];
    if (quote !== '') {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0 && quote === '';
}

/** A schema's name, and the prefix its properties are written with. */
const SCHEMA = /^[a-z][a-z0-9_]{0,63}$/;
const PREFIX = /^[a-z][a-z0-9]{0,31}$/;
/** A property's name in a schema. */
const PROPERTY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** A value an enumerated string may take: written in the schema and in the pages that test it. */
const VALUE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
/** A page provider's name, as a queue names it. */
const PAGE_PROVIDER = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
/** The simple types a stand-in property may have, and a list of each but `boolean`. */
const SIMPLE = ['string', 'long', 'double', 'boolean', 'date'];
/** The property types a terms aggregate groups by value: not a date or a double, which range. */
const BUCKETED = /^(?:string|long|integer|boolean)(?:\[\])?$/;
/** An aggregate's id, which a facet sends back as a parameter's name. */
const AGGREGATE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
/** The class the platform's `default_search` is replaced with: it reads the search index. */
const SEARCH_PAGE_PROVIDER = 'org.nuxeo.ecm.platform.query.nxql.SearchServicePageProvider';

interface Property {
  readonly name: string;
  readonly type: string;
  readonly list: boolean;
  readonly values: readonly string[];
}

/** `name[:type][=value|value...]`, as `--properties` writes each one. */
function parseProperty(text: string): Property {
  const match = /^([^:=]+)(?::([^=]+))?(?:=(.*))?$/.exec(text.trim());
  const name = match?.[1]?.trim() ?? '';
  if (!PROPERTY.test(name)) {
    throw new Error(
      `--properties: "${text}" must be <name>, <name>:<type> or <name>=<value>|<value>, its name letters, digits and "_".`,
    );
  }
  const written = (match?.[2] ?? 'string').trim();
  const list = written.endsWith('[]');
  const type = list ? written.slice(0, -2) : written;
  if (!SIMPLE.includes(type) || (list && type === 'boolean')) {
    throw new Error(
      `--properties: "${name}" has the type "${written}"; a stand-in property is ${SIMPLE.join(', ')}, or a list of one but boolean, such as string[].`,
    );
  }
  const values =
    match?.[3] === undefined
      ? []
      : match[3]
          .split('|')
          .map((value) => value.trim())
          .filter((value) => value !== '');
  if (match?.[3] !== undefined && (type !== 'string' || list || values.length === 0)) {
    throw new Error(
      `--properties: "${name}" lists values; only a single string may, such as status=Draft|Active.`,
    );
  }
  const badValue = values.find((value) => !VALUE.test(value));
  if (badValue !== undefined) {
    throw new Error(
      `--properties: "${badValue}", a value of "${name}", must be letters, digits, " ", ".", "_" and "-".`,
    );
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`--properties: "${name}" lists a value twice.`);
  }
  return { name, type, list, values };
}

/** `text` safe inside an XML element or a double-quoted attribute. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The schema file: each property an element, a list through a named list type. */
function schemaFile(
  pkgName: string,
  schema: string,
  type: string,
  properties: readonly Property[],
): string {
  const namespace = `http://www.nuxeo.org/ecm/project/schemas/${pkgName}/${schema}`;
  const lists = [...new Set(properties.filter((p) => p.list).map((p) => p.type))];
  const listTypes = lists.map(
    (item) =>
      `  <xs:simpleType name="${item}List">\n    <xs:list itemType="xs:${item}" />\n  </xs:simpleType>\n`,
  );
  const elements = properties.map((property) => {
    if (property.values.length > 0) {
      return (
        `  <xs:element name="${property.name}">\n` +
        '    <xs:simpleType>\n' +
        '      <xs:restriction base="xs:string">\n' +
        property.values
          .map((value) => `        <xs:enumeration value="${escapeXml(value)}" />\n`)
          .join('') +
        '      </xs:restriction>\n' +
        '    </xs:simpleType>\n' +
        '  </xs:element>\n'
      );
    }
    const written = property.list ? `nxs:${property.type}List` : `xs:${property.type}`;
    return `  <xs:element name="${property.name}" type="${written}" />\n`;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<!-- STAND-IN, until a real model arrives: the fictional ${schema} schema of the ${type} type,\n` +
    '     written by the app-model generator. Replace it with the real one, and the layouts and the\n' +
    '     queues follow its property names. -->\n' +
    '<xs:schema\n' +
    `  targetNamespace="${namespace}"\n` +
    '  xmlns:xs="http://www.w3.org/2001/XMLSchema"\n' +
    `  xmlns:nxs="${namespace}">\n\n` +
    (listTypes.length > 0 ? `${listTypes.join('\n')}\n` : '') +
    elements.join('') +
    '</xs:schema>\n'
  );
}

/**
 * The search document's schema: one list of texts per aggregate, named exactly as the aggregate is.
 * A facet's chosen buckets come back as named parameters, each named after its aggregate, such as
 * `wo_priority_agg=["Urgent"]`; the server writes each into the field of that name, and the
 * aggregate reads its selection from it.
 */
function searchSchemaFile(
  pkgName: string,
  schema: string,
  type: string,
  fields: readonly string[],
): string {
  const namespace = `http://www.nuxeo.org/ecm/project/schemas/${pkgName}/${schema}`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<!-- STAND-IN, written by the app-model generator: the search document of the ${type} type's\n` +
    '     page providers of the search index. It is never saved. Each field holds the buckets a\n' +
    "     person chose in a facet, and is named exactly as its aggregate is, in the page provider's\n" +
    '     aggregates. -->\n' +
    '<xs:schema\n' +
    `  targetNamespace="${namespace}"\n` +
    '  xmlns:xs="http://www.w3.org/2001/XMLSchema"\n' +
    `  xmlns:nxs="${namespace}">\n\n` +
    '  <xs:simpleType name="stringList">\n    <xs:list itemType="xs:string" />\n  </xs:simpleType>\n\n' +
    fields.map((field) => `  <xs:element name="${field}" type="nxs:stringList" />\n`).join('') +
    '</xs:schema>\n'
  );
}

/** The model component as it starts: its own, so that it can be replaced whole. */
function modelComponent(name: string): string {
  return `<?xml version="1.0"?>
<!--
  STAND-IN MODEL, written by the app-model generator for a demo, until a real model arrives.

  Everything here is fictional: the document types, schemas and page providers the package's
  layouts, queues and home name, and nothing more. When a real model arrives, from Studio or a
  model package, this file and schemas/ are replaced by it, and the layouts follow its property
  names. Records of these types must be deleted from a server before its model goes: a document
  whose type is gone cannot be read.

  Its own component, apart from the configuration one, so that it can be replaced whole. It
  contributes nothing to org.nuxeo.agentic.ui.config, so it needs none of Satori's defaults.
-->
<component name="${name}" version="1.0">
  <!-- Registers after the platform's own types, as a Studio project's bundle does. -->
  <require>org.nuxeo.runtime.started</require>
</component>
`;
}

/**
 * `xml` with `entry` added to its extension of `target`'s `point`, which is added before
 * `</component>` when there is none. Read as the pipeline reads a component (`markupOnly`).
 */
function addToExtension(
  xml: string,
  file: string,
  target: string,
  point: string,
  entry: string,
): string {
  const markup = markupOnly(xml);
  const lines = entry
    .split('\n')
    .map((line) => (line === '' ? '' : `    ${line}`))
    .join('\n');
  for (const match of markup.matchAll(/<extension\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    const [tag] = match;
    if (
      tag.endsWith('/>') ||
      attribute(tag, 'target') !== target ||
      attribute(tag, 'point') !== point
    )
      continue;
    const start = match.index ?? 0;
    // `</extension >` closes it too, as the pipeline reads an end tag.
    const found = /<\/extension[ \t\r\n]*>/.exec(markup.slice(start));
    const close = found === null ? -1 : start + found.index;
    if (close < 0) throw new Error(`${file}: its ${point} extension is never closed.`);
    const lineStart = markup.lastIndexOf('\n', close) + 1;
    const before = markup.slice(lineStart, close).trim() === '' ? lineStart : close;
    return `${xml.slice(0, before)}${lines}\n${xml.slice(before)}`;
  }
  const end = markup.lastIndexOf('</component>');
  if (end < 0) throw new Error(`${file} has no </component>.`);
  const lineStart = markup.lastIndexOf('\n', end) + 1;
  return (
    `${xml.slice(0, lineStart)}\n` +
    `  <extension target="${target}" point="${point}">\n${lines}\n  </extension>\n` +
    xml.slice(lineStart)
  );
}

/** The start tags named `element` in `markup` whose `name` is `name`. */
function named(markup: string, element: string, name: string): RegExpMatchArray[] {
  return [
    ...markup.matchAll(
      new RegExp(`<${element}(?=[ \\t\\r\\n/>])(?:[^>"']|"[^"]*"|'[^']*')*>`, 'g'),
    ),
  ].filter(([tag]) => attribute(tag, 'name') === name);
}

/**
 * The manifest with `component` first in its `Nuxeo-Component` header, before the configuration
 * component, as the kits list theirs; unchanged when it names it already.
 */
function withComponent(manifest: string, file: string, component: string): string {
  const eol = manifest.includes('\r\n') ? '\r\n' : '\n';
  const lines = manifest.split(/\r?\n/);
  const at = lines.findIndex((line) => /^Nuxeo-Component:/i.test(line));
  if (at < 0) throw new Error(`${file} has no Nuxeo-Component header to add ${component} to.`);
  let end = at + 1;
  while (end < lines.length && lines[end].startsWith(' ')) end++;
  const value =
    lines[at].slice(lines[at].indexOf(':') + 1) +
    lines
      .slice(at + 1, end)
      .map((line) => line.slice(1))
      .join('');
  const components = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (components.includes(component)) return manifest;
  lines.splice(at, end - at, `Nuxeo-Component: ${[component, ...components].join(',')}`);
  return lines.join(eol);
}

/** A page provider of the search index over a type: its search document, and its aggregates. */
interface Search {
  /** `<Type>Search`, never saved, as `DefaultSearch` is `default_search`'s. */
  readonly document: string;
  /** Its schema, `<schema>_search`, with its prefix and its file. */
  readonly schema: string;
  readonly prefix: string;
  readonly file: string;
  /** Each aggregate's id, `<prefix>_<name>_agg`, and the property it groups by. */
  readonly aggregates: readonly { readonly id: string; readonly property: string }[];
}

/**
 * What a page provider of the search index over `type` needs: a search document, that document's
 * schema, named after the type's own, and a terms aggregate for each property `--aggregates` names.
 * The properties are the type's, from this run's `--properties` or from `content-model.json`, so
 * an aggregate on a property the type does not have is refused here rather than answered empty.
 */
function searchOf(
  tree: Tree,
  options: {
    readonly type: string;
    readonly written?: {
      readonly schema: string;
      readonly prefix: string;
      readonly properties: readonly Property[];
    };
    readonly aggregated: readonly string[];
    readonly modelJson: string;
  },
): Search {
  const { type, written, aggregated, modelJson } = options;
  const fields = new Map<string, string>();
  let own: { schema: string; prefix: string } | undefined;
  if (written) {
    own = { schema: written.schema, prefix: written.prefix };
    for (const property of written.properties)
      fields.set(
        `${written.prefix}:${property.name}`,
        `${property.type}${property.list ? '[]' : ''}`,
      );
  }
  const text = tree.read(modelJson, 'utf-8');
  const model = text === null ? undefined : parseJson(text, modelJson);
  const doctypes = isRecord(model) && isRecord(model['doctypes']) ? model['doctypes'] : {};
  const schemas = isRecord(model) && Array.isArray(model['schemas']) ? model['schemas'] : [];
  const doctype = doctypes[type];
  if (isRecord(doctype) && Array.isArray(doctype['schemas'])) {
    for (const name of doctype['schemas']) {
      const entry = schemas.find((each) => isRecord(each) && each['name'] === name);
      if (typeof name !== 'string' || !isRecord(entry) || !isRecord(entry['fields'])) continue;
      const declared = [entry['prefix'], entry['@prefix']].find(
        (prefix): prefix is string => typeof prefix === 'string' && prefix !== '',
      );
      const prefix = declared ?? name;
      for (const [field, kind] of Object.entries(entry['fields'])) {
        const xpath = `${prefix}:${field}`;
        if (!fields.has(xpath)) fields.set(xpath, typeof kind === 'string' ? kind : 'complex');
      }
      if (own === undefined && !NUXEO_SCHEMAS.includes(name)) own = { schema: name, prefix };
    }
  }
  if (own === undefined) {
    throw new Error(
      `--aggregates name ${type}'s properties, and ${modelJson} does not describe ${type} with a schema of its own: write its --properties first.`,
    );
  }
  const aggregates = aggregated.map((property) => {
    const kind = fields.get(property);
    if (kind === undefined) {
      throw new Error(`--aggregates: "${property}" is not a property of ${type}.`);
    }
    if (!BUCKETED.test(kind)) {
      throw new Error(
        `--aggregates: "${property}" is a ${kind} property, and a terms aggregate groups by value: give a text, a whole number or a yes or no, or a list of one.`,
      );
    }
    return { id: `${property.replace(':', '_')}_agg`, property };
  });
  // A facet's chosen buckets go back as a parameter named after the aggregate, which a "." or a
  // "-" cannot be (app-definition-v2.md, section 4).
  const badId = aggregates.find((aggregate) => !AGGREGATE.test(aggregate.id));
  if (badId !== undefined) {
    throw new Error(
      `--aggregates: "${badId.property}" would make the aggregate "${badId.id}", which a facet cannot send back: an aggregate is a letter, then letters, digits and "_".`,
    );
  }
  const search: Search = {
    document: `${type}Search`,
    schema: `${own.schema}_search`,
    prefix: `${own.prefix}search`,
    file: `${own.schema}search.xsd`,
    aggregates,
  };
  if (!TYPE.test(search.document) || NUXEO_TYPES.has(search.document)) {
    throw new Error(
      `The search document of ${type} would be ${search.document}, which is not a type a stand-in may write: choose another --type.`,
    );
  }
  if (!SCHEMA.test(search.schema) || !PREFIX.test(search.prefix)) {
    throw new Error(
      `The search document's schema would be ${search.schema}, written ${search.prefix}:, longer than a schema's name or prefix may be: give ${type} a shorter --schema and --prefix.`,
    );
  }
  return search;
}

/**
 * A page provider that reads the search index, as the platform's `default_search` is replaced
 * with, so that it answers the aggregates a queue's facets and a home's figures name. Its
 * condition is `app-model`'s other page providers' own.
 */
function searchPageProvider(
  name: string,
  type: string,
  where: string | undefined,
  sort: { readonly column: string; readonly ascending: boolean },
  pageSize: number,
  search: Search,
): string {
  return (
    `<genericPageProvider name="${name}"\n    class="${SEARCH_PAGE_PROVIDER}">\n` +
    `  <searchDocumentType>${search.document}</searchDocumentType>\n` +
    '  <whereClause>\n' +
    '    <fixedPart>\n' +
    `      ecm:primaryType = '${type}'${where ? ` AND (${escapeXml(where)})` : ''}\n` +
    '      AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0\n' +
    '    </fixedPart>\n' +
    '  </whereClause>\n' +
    '  <aggregates>\n' +
    search.aggregates
      .map(
        (aggregate) =>
          `    <aggregate id="${aggregate.id}" type="terms" parameter="${aggregate.property}">\n` +
          `      <field schema="${search.schema}" name="${aggregate.id}" />\n` +
          '      <properties>\n' +
          '        <property name="size">10</property>\n' +
          '      </properties>\n' +
          '    </aggregate>\n',
      )
      .join('') +
    '  </aggregates>\n' +
    `  <sort column="${sort.column}" ascending="${sort.ascending}" />\n` +
    `  <pageSize>${pageSize}</pageSize>\n` +
    '  <maxPageSize>100</maxPageSize>\n' +
    '</genericPageProvider>'
  );
}

/** The configuration component's `name`, which the model component's is made from. */
function componentName(tree: Tree, pkg: AppPackage): string {
  const markup = markupOnly(tree.read(pkg.component, 'utf-8') ?? '');
  const tag = /<component(?=[ \t\r\n/>])(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(markup)?.[0];
  const name = tag === undefined ? undefined : attribute(tag, 'name');
  if (!name) throw new Error(`${pkg.component} has no <component name="...">.`);
  return name;
}

/** Nuxeo's own schemas, as a server describes them, for a stand-in type's content model. */
const COMMON = { name: 'common', fields: { icon: 'string', 'icon-expanded': 'string' } };
const DUBLIN_CORE = {
  name: 'dublincore',
  prefix: 'dc',
  '@prefix': 'dc',
  fields: {
    contributors: 'string[]',
    coverage: 'string',
    created: 'date',
    creator: 'string',
    description: 'string',
    expired: 'date',
    format: 'string',
    issued: 'date',
    language: 'string',
    lastContributor: 'string',
    modified: 'date',
    nature: 'string',
    publisher: 'string',
    rights: 'string',
    source: 'string',
    subjects: 'string[]',
    title: 'string',
    valid: 'date',
  },
};
/** Nuxeo's own `files` schema, a record's attachments, as the export describes it: no prefix. */
const FILES = { name: 'files', fields: { files: { type: 'complex[]', fields: { file: 'blob' } } } };

/**
 * Write a stand-in model into an app definition package: the document type, its schema and its
 * page providers that a demo's layouts and queues name, for a server that has none of them yet,
 * as the Payers, brand assets and contracts kits carry theirs. **For a demo only.** A customer's
 * model is Studio's or a model package's, already on their server; the app builder skill writes
 * configuration, and reads the model.
 *
 * - **`--properties`** writes the type: `bundle/schemas/<schema>.xsd`, with each property an
 *   element (`name`, `name:long`, `name:string[]`, or `status=Draft|Active` for a string of those
 *   values), and in the model component, `bundle/OSGI-INF/<name>-model.xml`, the schema, the type
 *   (extending `Document`, with `common`, `dublincore` and its schema, so it opens as a record
 *   page) and the default lifecycle. **`--attachments`** gives a new type Nuxeo's `files` schema
 *   too, `files:files`, where the document page's Attachments panel adds a record's files: it
 *   still opens as a record page, since only `file` and `note` keep a record's own view.
 * - **`--pageProvider`** writes a page provider over the type, reading the repository so that it
 *   lists a write at once: `SELECT * FROM Document WHERE ecm:primaryType = '<Type>'`, `--where`'s
 *   condition, and no version, proxy or trashed record. A `?` in it is a parameter, bound as a
 *   quoted, escaped literal. A queue has no open record, so a queue's needs none.
 * - **`--aggregates`**, with `--pageProvider`, writes it from the search index instead, as the
 *   platform's `default_search` is, since only the index answers aggregates, which a queue's
 *   facets and a home's figures name. Each property, `<prefix>:<name>`, one of the type's, gets a
 *   terms aggregate, `<prefix>_<name>_agg`; the type gets a search document, `<Type>Search`, never
 *   saved, whose schema holds each aggregate's chosen buckets in a field of the same name. The
 *   index lags a write by about a second.
 * - **The model component** is the bundle's own, apart from the configuration one, so that it can
 *   be replaced whole; it is listed first in the manifest's `Nuxeo-Component`.
 * - **`content-model.json`**, beside `bundle/`, describes the type in the shape
 *   `npm run app-package:model` exports, so that `app-layout`, `app-form` and the pipeline's
 *   `--model` can be given it before any server has the package. A server's own export replaces it
 *   once the package is installed.
 * - **The schema's heading in the Properties panel,** `layout.schema.<schema>` in `labels/en.json`,
 *   the type's name made readable, "Damage claim": without it the panel heads the section with the
 *   schema's name, "Damageclaim", and `kit-schema-labels.spec.ts` fails the kit. A text there
 *   already is kept.
 *
 * Nothing here is installed. Installing the package into a Nuxeo is the person's decision.
 */
export default async function appModelGenerator(tree: Tree, options: AppModelSchema) {
  const pkg = readAppPackage(tree, options.package);
  const type = options.type ?? '';
  if (!TYPE.test(type)) {
    throw new Error(`--type "${options.type}" must be a document type's name, such as Contract.`);
  }
  if (NUXEO_TYPES.has(type)) {
    throw new Error(
      `--type "${type}" is one of Nuxeo's own types: a stand-in of that name would replace the platform's. Choose another, such as Acme${type}.`,
    );
  }
  const properties = listOption(options.properties).map(parseProperty);
  if (properties.length === 0 && options.pageProvider === undefined) {
    throw new Error(
      'Give the type its properties with --properties, a page provider over it with --pageProvider, or both.',
    );
  }
  const repeated = properties.find((p, i) => properties.findIndex((q) => q.name === p.name) !== i);
  if (repeated) throw new Error(`--properties lists "${repeated.name}" twice.`);
  const schema = options.schema ?? type.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!SCHEMA.test(schema) || NUXEO_SCHEMAS.includes(schema) || PLATFORM_SCHEMAS.has(schema)) {
    throw new Error(
      `--schema "${schema}" must be lower-case letters, digits and "_", starting with a letter, and not one of Nuxeo's own schemas.`,
    );
  }
  // A prefix has no "_", which a schema's name may.
  const prefix = options.prefix ?? schema.replace(/_/g, '');
  if (!PREFIX.test(prefix) || NUXEO_PREFIXES.has(prefix)) {
    throw new Error(
      `--prefix "${prefix}" must be lower-case letters and digits, starting with a letter, at most 32, and not a prefix Nuxeo's own schemas write with.`,
    );
  }
  if (properties.length === 0 && (options.schema ?? options.prefix) !== undefined) {
    throw new Error('--schema and --prefix name the schema --properties writes: give those too.');
  }
  if (properties.length === 0 && options.attachments) {
    throw new Error(
      '--attachments gives the type --properties writes the files schema: give those too.',
    );
  }
  const pageProvider = options.pageProvider;
  if (pageProvider !== undefined && !PAGE_PROVIDER.test(pageProvider)) {
    throw new Error(`--pageProvider "${pageProvider}" is not a page provider's name.`);
  }
  if (
    pageProvider === undefined &&
    (options.where ?? options.sort ?? options.pageSize) !== undefined
  ) {
    throw new Error(
      '--where, --sort and --pageSize describe a page provider: give its --pageProvider too.',
    );
  }
  const where = options.where?.replace(/\s+/g, ' ').trim();
  if (
    where !== undefined &&
    (where === '' ||
      /\border\s+by\b/i.test(where) ||
      where.includes(']]>') ||
      !isOneCondition(where))
  ) {
    throw new Error(
      `--where "${options.where}" must be one NXQL condition, such as contract:status = 'Active', its parentheses and quotes closed, with no ORDER BY: the order is --sort's.`,
    );
  }
  let sort = { column: 'dc:modified', ascending: false };
  if (options.sort !== undefined) {
    const match = /^([^:\s]+:[^:\s]+)(?::(asc|desc))?$/.exec(options.sort.trim());
    if (!match || !XPATH.test(match[1])) {
      throw new Error(`--sort "${options.sort}" must be <prefix>:<name>, or <prefix>:<name>:desc.`);
    }
    sort = { column: match[1], ascending: match[2] !== 'desc' };
  }
  const pageSize = options.pageSize ?? 50;
  if (!(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100)) {
    throw new Error(`--pageSize ${pageSize} must be a whole number from 1 to 100.`);
  }
  const aggregated = listOption(options.aggregates);
  if (aggregated.length > 0 && pageProvider === undefined) {
    throw new Error('--aggregates describe a page provider: give its --pageProvider too.');
  }
  if (aggregated.length > 0 && where?.includes('?')) {
    throw new Error(
      `--where "${options.where}" takes a parameter, and a page provider with --aggregates is a queue's, which has no record to fill it.`,
    );
  }
  const badAggregate = aggregated.find((xpath) => !XPATH.test(xpath));
  if (badAggregate !== undefined) {
    throw new Error(`--aggregates: "${badAggregate}" must be a property, <prefix>:<name>.`);
  }
  const twice = aggregated.find((xpath, i) => aggregated.indexOf(xpath) !== i);
  if (twice !== undefined) throw new Error(`--aggregates lists "${twice}" twice.`);

  const pkgName = pkg.component
    .slice(pkg.component.lastIndexOf('/') + 1)
    .replace(/-config\.xml$/, '');
  const modelFile = `${pkg.root}/bundle/OSGI-INF/${pkgName}-model.xml`;
  const manifestFile = `${pkg.root}/bundle/META-INF/MANIFEST.MF`;
  const schemaPath = `${pkg.root}/bundle/schemas/${schema}.xsd`;
  const modelName = `${componentName(tree, pkg)}.model`;
  const modelJson = `${pkg.root}/content-model.json`;
  const search =
    aggregated.length > 0
      ? searchOf(tree, {
          type,
          written: properties.length > 0 ? { schema, prefix, properties } : undefined,
          aggregated,
          modelJson,
        })
      : undefined;
  let xml = tree.read(modelFile, 'utf-8') ?? modelComponent(modelName);
  const markup = markupOnly(xml);
  const written: string[] = [];
  // The search schema's file is the search document's alone: another schema read from it, such as
  // a type's own schema that happens to be named so, would be written over.
  // A file there already is written again only when it is this search schema's, as an earlier run
  // registered it: one no entry reads, or one written by hand for something else, is left alone.
  const schemaTags = search
    ? [...markup.matchAll(/<schema(?=[ \t\r\n/>])(?:[^>"']|"[^"]*"|'[^']*')*>/g)]
    : [];
  const readFrom = (tag: string) => attribute(tag, 'src') === `schemas/${search?.file}`;
  const taken = schemaTags.some(
    ([tag]) => readFrom(tag) && attribute(tag, 'name') !== search?.schema,
  );
  const ours = schemaTags.some(
    ([tag]) => readFrom(tag) && attribute(tag, 'name') === search?.schema,
  );
  if (
    search &&
    (taken ||
      schemaPath === `${pkg.root}/bundle/schemas/${search.file}` ||
      (!ours && tree.exists(`${pkg.root}/bundle/schemas/${search.file}`)))
  ) {
    throw new Error(
      `schemas/${search.file}, where the search document's schema ${search.schema} goes, is another schema's, or a file no entry of ${modelFile} registers as ${search.schema}: give the type another --schema, or register or remove the file.`,
    );
  }

  // Whether the type has Nuxeo's files schema, its attachments: given when it is first written,
  // and kept, as the component has it, when its own schema is written again.
  let attachments = options.attachments === true;
  if (properties.length > 0) {
    const hasType = named(markup, 'doctype', type).length > 0;
    if (hasType && !options.force) {
      throw new Error(
        `${modelFile} has the type ${type} already. Pass --force to write its schema again from --properties.`,
      );
    }
    if (hasType) {
      // Written again only as the schema the type already has: another would be a schema no type
      // lists.
      const [doctype] = named(markup, 'doctype', type);
      const close = markup.indexOf('</doctype>', doctype.index ?? 0);
      const body = close < 0 ? '' : markup.slice(doctype.index ?? 0, close);
      if (named(body, 'schema', schema).length === 0) {
        throw new Error(
          `The type ${type} in ${modelFile} has no schema ${schema}: give its --schema.`,
        );
      }
      const hasFiles = named(body, 'schema', 'files').length > 0;
      if (attachments && !hasFiles) {
        throw new Error(
          `The type ${type} in ${modelFile} has no files schema, and --force writes its own schema only: give --attachments when the type is first written.`,
        );
      }
      attachments = hasFiles;
    }
    const schemaEntries = named(markup, 'schema', schema).filter(
      ([tag]) => attribute(tag, 'src') !== undefined,
    );
    if (!hasType && (schemaEntries.length > 0 || tree.exists(schemaPath))) {
      throw new Error(
        `The schema ${schema} is in ${pkg.root} already, for another type. Give this one --schema.`,
      );
    }
    if (schemaEntries.length === 0) {
      xml = addToExtension(
        xml,
        modelFile,
        'org.nuxeo.ecm.core.schema.TypeService',
        'schema',
        `<schema name="${schema}" prefix="${prefix}" src="schemas/${schema}.xsd" />`,
      );
    } else if (schemaEntries.some(([tag]) => attribute(tag, 'prefix') !== prefix)) {
      throw new Error(
        `${modelFile} registers the schema ${schema} with another prefix. Give the same --prefix, or change it there.`,
      );
    }
    if (!hasType) {
      xml = addToExtension(
        xml,
        modelFile,
        'org.nuxeo.ecm.core.schema.TypeService',
        'doctype',
        (attachments
          ? `<!-- Not a folder, and holds no file of its own: its attachments are files:files. So it\n` +
            `     opens as a record page. -->\n`
          : `<!-- Not a folder and holds no file, so it opens as a record page. -->\n`) +
          `<doctype name="${type}" extends="Document">\n` +
          '  <schema name="common" />\n' +
          '  <schema name="dublincore" />\n' +
          (attachments ? '  <schema name="files" />\n' : '') +
          `  <schema name="${schema}" />\n` +
          '</doctype>',
      );
      xml = addToExtension(
        xml,
        modelFile,
        'org.nuxeo.ecm.core.lifecycle.LifeCycleService',
        'types',
        `<types>\n  <type name="${type}">default</type>\n</types>`,
      );
    }
    tree.write(schemaPath, schemaFile(pkgName, schema, type, properties));
    written.push(schemaPath);
  }

  if (pageProvider !== undefined) {
    const existing = [
      ...named(markupOnly(xml), 'coreQueryPageProvider', pageProvider),
      ...named(markupOnly(xml), 'genericPageProvider', pageProvider),
    ];
    if (existing.length > 0 && !options.force) {
      throw new Error(
        `${modelFile} has the page provider ${pageProvider} already. Pass --force to write it again.`,
      );
    }
    const parameters = where?.includes('?') ?? false;
    const element = search
      ? searchPageProvider(pageProvider, type, where, sort, pageSize, search)
      : `<coreQueryPageProvider name="${pageProvider}">\n` +
        `  <pattern${parameters ? ' quoteParameters="true" escapeParameters="true"' : ''}>\n` +
        `    SELECT * FROM Document WHERE ecm:primaryType = '${type}'${where ? ` AND (${escapeXml(where)})` : ''}\n` +
        '    AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0\n' +
        '  </pattern>\n' +
        `  <sort column="${sort.column}" ascending="${sort.ascending}" />\n` +
        `  <pageSize>${pageSize}</pageSize>\n` +
        '  <maxPageSize>100</maxPageSize>\n' +
        '</coreQueryPageProvider>';
    if (existing.length > 0) {
      // Written again in its place: from its start tag to its end tag, its own line kept.
      const current = markupOnly(xml);
      const at = existing[0].index ?? 0;
      const tagName = existing[0][0].startsWith('<coreQueryPageProvider')
        ? 'coreQueryPageProvider'
        : 'genericPageProvider';
      // An empty element ends at its own tag; else at its end tag, `</name >` included.
      const end = existing[0][0].endsWith('/>')
        ? { at: at + existing[0][0].length, length: 0 }
        : (() => {
            const found = new RegExp(`</${tagName}[ \\t\\r\\n]*>`).exec(current.slice(at));
            return found === null ? null : { at: at + found.index, length: found[0].length };
          })();
      if (end === null)
        throw new Error(`${modelFile}: the page provider ${pageProvider} is never closed.`);
      const indent = current.slice(current.lastIndexOf('\n', at) + 1, at);
      const replaced = element.split('\n').join(`\n${/^[ \t]*$/.test(indent) ? indent : '    '}`);
      xml = `${xml.slice(0, at)}${replaced}${xml.slice(end.at + end.length)}`;
    } else {
      xml = addToExtension(
        xml,
        modelFile,
        'org.nuxeo.ecm.platform.query.api.PageProviderService',
        'providers',
        element,
      );
    }
  }
  if (search) {
    // The search document's schema holds a field for each aggregate of every page provider of the
    // type's that reads the index, so the fields it had are kept.
    const searchPath = `${pkg.root}/bundle/schemas/${search.file}`;
    const had = [
      ...(tree.read(searchPath, 'utf-8') ?? '').matchAll(/<xs:element name="([^"]+)"/g),
    ].map(([, field]) => field);
    const fields = [...new Set([...had, ...search.aggregates.map((aggregate) => aggregate.id)])];
    tree.write(searchPath, searchSchemaFile(pkgName, search.schema, type, fields));
    written.push(searchPath);
    const registered = named(markupOnly(xml), 'schema', search.schema).filter(
      ([tag]) => attribute(tag, 'src') !== undefined,
    );
    if (registered.length === 0) {
      xml = addToExtension(
        xml,
        modelFile,
        'org.nuxeo.ecm.core.schema.TypeService',
        'schema',
        `<schema name="${search.schema}" prefix="${search.prefix}" src="schemas/${search.file}" />`,
      );
    } else if (
      registered.some(
        ([tag]) =>
          attribute(tag, 'src') !== `schemas/${search.file}` ||
          attribute(tag, 'prefix') !== search.prefix,
      )
    ) {
      throw new Error(
        `${modelFile} registers the schema ${search.schema} otherwise than as ${search.prefix}, from schemas/${search.file}: change it there.`,
      );
    }
    if (named(markupOnly(xml), 'doctype', search.document).length === 0) {
      xml = addToExtension(
        xml,
        modelFile,
        'org.nuxeo.ecm.core.schema.TypeService',
        'doctype',
        `<!-- The search document of ${type}'s page providers of the search index, as DefaultSearch\n` +
          "     is default_search's. Never saved: it holds the buckets a queue's facets send back. No\n" +
          '     folder lists it among its subtypes, and it is hidden from navigation. -->\n' +
          `<doctype name="${search.document}" extends="Document">\n` +
          '  <facet name="HiddenInNavigation" />\n' +
          `  <schema name="${search.schema}" />\n` +
          '</doctype>',
      );
    }
  }
  tree.write(modelFile, xml);
  written.unshift(modelFile);

  const manifest = tree.read(manifestFile, 'utf-8');
  if (manifest === null) throw new Error(`${pkg.root} has no ${manifestFile}.`);
  const listed = withComponent(manifest, manifestFile, `OSGI-INF/${pkgName}-model.xml`);
  if (listed !== manifest) {
    tree.write(manifestFile, listed);
    written.push(manifestFile);
  }

  // The content model, in the shape the export writes, for the generators and the pipeline.
  if (properties.length > 0) {
    const text = tree.read(modelJson, 'utf-8');
    const current =
      text === null ? { doctypes: {}, facets: [], schemas: [] } : parseJson(text, modelJson);
    if (
      !isRecord(current) ||
      !isRecord(current['doctypes']) ||
      !Array.isArray(current['schemas'])
    ) {
      throw new Error(
        `${modelJson} is not a content model, { doctypes, facets, schemas }, to add ${type} to.`,
      );
    }
    if (!Array.isArray(current['facets'])) current['facets'] = [];
    (current['doctypes'] as Record<string, unknown>)[type] = {
      parent: 'Document',
      facets: [],
      schemas: ['common', 'dublincore', ...(attachments ? ['files'] : []), schema],
    };
    const schemas = current['schemas'] as unknown[];
    const nameOf = (entry: unknown) => (isRecord(entry) ? entry['name'] : undefined);
    for (const own of [COMMON, DUBLIN_CORE, ...(attachments ? [FILES] : [])]) {
      if (!schemas.some((entry) => nameOf(entry) === own.name)) schemas.push(own);
    }
    const described = {
      name: schema,
      prefix,
      '@prefix': prefix,
      fields: Object.fromEntries(
        properties.map((property) => [
          property.name,
          `${property.type}${property.list ? '[]' : ''}`,
        ]),
      ),
    };
    const at = schemas.findIndex((entry) => nameOf(entry) === schema);
    if (at >= 0) schemas[at] = described;
    else schemas.push(described);
    writeJson(tree, modelJson, current);
    written.push(modelJson);
  }

  // The heading of the schema's section in the Properties panel, which a type with no `metadata`
  // layout generates: `layout.schema.<schema>`, by the schema's name, else the name made readable,
  // "Damageclaim" (layout-v2.md, section 1). From the type's name; a text the kit gave is kept.
  const heading = `layout.schema.${schema}`;
  const keptHeading =
    properties.length > 0 && addLabels(tree, pkg, { [heading]: humanize(type) }).length > 0;
  if (properties.length > 0) {
    written.push(`${pkg.config}/labels/en.json`);
    // labels/en.json is a file the app registry serves: named, if the component contributes the app.
    contributeApp(tree, pkg, { create: false });
  }

  await formatFiles(tree);

  return () => {
    console.log(`
Wrote the stand-in model, for a demo:

  ${written.join('\n  ')}

  Type:           ${properties.length > 0 ? `${type}, schema ${schema} (${prefix}:), ${properties.length} properties${attachments ? ', and its attachments, files:files' : ''}` : `${type}, unchanged`}
  Page provider:  ${pageProvider === undefined ? 'none' : search ? `${pageProvider}, of the search index, with the aggregates ${search.aggregates.map((aggregate) => aggregate.id).join(', ')}` : pageProvider}
${properties.length > 0 ? `  Heading:        ${heading} in labels/en.json, the Properties panel's heading for the schema${keptHeading ? ', its text kept as labels/en.json had it' : `, "${humanize(type)}"`}\n` : ''}
${search ? `\nA queue on ${pageProvider} filters by these aggregates: give it "facets", each\n{ "aggregate": "<id>", "labelKey": "<key>" }, and each key a text in labels/en.json. A home's\nfigure may count one's buckets.\n` : ''}
Lay the type out against the content model beside it:

  npx nx g ./tools/satori-generators:app-layout --package=${pkg.root} --type=${type} --model=${modelJson}
  npm run app-package -- ${pkg.root} --platform <platform version> --model ${modelJson}

Nothing is installed: installing the package into a Nuxeo is the person's decision. Once it is,
export the server's own model with npm run app-package:model, and use that.
`);
  };
}
