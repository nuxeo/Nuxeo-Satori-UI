/**
 * What the package pipeline checks of the page providers a package defines in its own components,
 * which only it reads (`scripts/app-package.mjs`, step 2), given the content model it holds the
 * package to (package-pipeline.md, section 2):
 *
 * - **The type a page provider lists** ({@link listedType}), read from its NXQL as `app-model`
 *   writes it: `ecm:primaryType = '<Type>'`, a condition every listed record meets. Only when the
 *   NXQL says so plainly; otherwise none, and nothing is checked.
 * - **What in its NXQL Nuxeo refuses** ({@link nxqlProblems}), by a check of its tokens, not a
 *   parse.
 * - **What its NXQL, its sorts and its aggregates name** ({@link nxqlNameProblems},
 *   {@link propertyNameProblem}): each property, down to a complex one's subfields, in a schema of
 *   the content model, and on the type it lists, when it says; and no type, facet or schema
 *   prefix that the model and Nuxeo's own lists lack but is a near miss of one they have. The
 *   vehicle kit's `vdocs:checklist/*\/don` and `vtitle:openOn` passed every check before this one.
 * - **The parameters a queue, a related list or a home's figure gives it** ({@link
 *   parameterFindings}): as many as its NXQL's `?`, which Nuxeo fills in order.
 * - **A queue's and a related list's columns and sorts** ({@link listedColumnFindings}), held to
 *   that type as a layout's fields are held to the type its path names (`layout-model.ts`): each
 *   property on the type or a facet it declares, and each column's widget showing its property's
 *   type. A page provider the package does not define is the server's, which the pipeline cannot
 *   read, and is not checked; nor are the server's own properties, `ecm:`, which no schema holds.
 *
 * Plain TypeScript, so that the pipeline runs it with Node alone, as it runs the validator.
 */
import { join, type Finding } from './checker';
import {
  propertiesOf,
  propertyTypeOf,
  type ContentModel,
  type PropertyModel,
  type SchemaModel,
} from './content-model';
import { linkedShowFindings } from './layout-model';
import { isRecord, PACKAGED_REGISTRIES, XPATH, type Registries } from './registries';

/** One piece of NXQL: its text, and how deep in parentheses it is, strings told apart. */
export interface NxqlToken {
  readonly kind: 'string' | 'number' | 'name' | 'symbol' | 'parameter' | 'open' | 'close';
  readonly text: string;
  readonly depth: number;
}

/**
 * NXQL in pieces, as its grammar reads it: strings in single or double quotes with `\` escaping a
 * character in them; numbers; names, which take the property paths NXQL writes, `dc:subjects/*`
 * and `files:files/*1/file/name` among them; `?` and `:name` parameters; parentheses; and runs of
 * the other characters, the operators among them. `unclosed` is set when a string is left open.
 */
export function tokenize(nxql: string): {
  readonly tokens: NxqlToken[];
  readonly unclosed: boolean;
} {
  const tokens: NxqlToken[] = [];
  let depth = 0;
  let at = 0;
  while (at < nxql.length) {
    const character = nxql[at];
    if (/\s/.test(character)) {
      at++;
      continue;
    }
    if (character === "'" || character === '"') {
      let end = at + 1;
      while (end < nxql.length && nxql[end] !== character) end += nxql[end] === '\\' ? 2 : 1;
      if (end >= nxql.length) return { tokens, unclosed: true };
      tokens.push({ kind: 'string', text: nxql.slice(at, end + 1), depth });
      at = end + 1;
      continue;
    }
    if (character === '(') {
      tokens.push({ kind: 'open', text: '(', depth });
      depth++;
      at++;
      continue;
    }
    if (character === ')') {
      depth--;
      tokens.push({ kind: 'close', text: ')', depth });
      at++;
      continue;
    }
    const rest = nxql.slice(at);
    // A number in any form a float may take, `1`, `1.5`, `.5`, `1.` or `1.5e3`: read wider than
    // the grammar, since a number read as one never makes a refusal.
    const match =
      /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest) ??
      /^:[A-Za-z_]\w*/.exec(rest) ??
      /^[A-Za-z_][\w:./*-]*/.exec(rest) ??
      /^\?/.exec(rest) ??
      /^[^\s\w'"()?]+/.exec(rest);
    const text = match ? match[0] : character;
    const kind = /^\.?\d/.test(text)
      ? 'number'
      : text === '?' || text.startsWith(':')
        ? 'parameter'
        : /^[A-Za-z_]/.test(text)
          ? 'name'
          : 'symbol';
    tokens.push({ kind, text, depth });
    at += text.length;
  }
  return { tokens, unclosed: false };
}

const keyword = (token: NxqlToken | undefined, word: string): boolean =>
  token?.kind === 'name' && token.text.toUpperCase() === word;

/**
 * The where clause of a page provider's NXQL, as tokens: a pattern's after its `WHERE`, up to its
 * `ORDER BY`, and a fixed part whole. A pattern with no `WHERE` has none.
 */
function whereOf(tokens: readonly NxqlToken[], pattern: boolean): readonly NxqlToken[] | null {
  if (!pattern) return tokens;
  const where = tokens.findIndex((token) => token.depth === 0 && keyword(token, 'WHERE'));
  if (where === -1) return null;
  const order = tokens.findIndex(
    (token, index) =>
      index > where &&
      token.depth === 0 &&
      keyword(token, 'ORDER') &&
      keyword(tokens[index + 1], 'BY'),
  );
  return tokens.slice(where + 1, order === -1 ? undefined : order);
}

/**
 * The one document type every record a page provider lists is of, and whose schemas are all the
 * ones each record has, from its NXQL, or `null`. Read only where the NXQL says so plainly, so
 * that a column is never held to a type the records may not have, or held to it when they have
 * more: a where clause of conditions joined by `AND` alone at its top, one of them
 * `ecm:primaryType = '<Type>'`, not under a `NOT`, no other mention of `ecm:primaryType`, and none
 * of `ecm:mixinType`, whose facet would bring schemas of its own. A pattern `FROM <Type>` is not
 * read: it lists the type's subtypes too, whose schemas may be more.
 */
export function listedType(nxql: string, options: { readonly pattern: boolean }): string | null {
  const { tokens, unclosed } = tokenize(nxql);
  if (unclosed) return null;
  const where = whereOf(tokens, options.pattern);
  if (where === null) return null;
  if (where.some((token) => token.depth === 0 && keyword(token, 'OR'))) return null;
  if (where.some((token) => token.kind === 'name' && token.text === 'ecm:mixinType')) return null;
  const mentions = where
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => token.kind === 'name' && token.text === 'ecm:primaryType');
  if (mentions.length !== 1) return null;
  const { token, index } = mentions[0];
  const operator = where[index + 1];
  const value = where[index + 2];
  if (
    token.depth !== 0 ||
    keyword(where[index - 1], 'NOT') ||
    operator?.text !== '=' ||
    value?.kind !== 'string'
  )
    return null;
  return value.text.slice(1, -1);
}

/** Runs of symbols no NXQL query holds outside a string, each with what NXQL writes instead. */
const NOT_NXQL: readonly (readonly [RegExp, string, string])[] = [
  [/==/, '==', 'which compares with ='],
  [/&&/, '&&', 'which joins conditions with AND'],
  [/\|\|/, '||', 'which joins conditions with OR'],
  [/;/, ';', 'and a page provider is one query'],
  [/!(?!=)/, '!', 'which negates with NOT, and writes "not equal" as <> or !='],
];

/** The literal a BETWEEN bound may be, from `at`: its length in tokens, or 0 when it is none. */
function boundAt(tokens: readonly NxqlToken[], at: number): number {
  const token = tokens[at];
  if (!token) return 0;
  if (token.kind === 'string' || token.kind === 'number' || token.kind === 'parameter') return 1;
  if ((token.text === '-' || token.text === '+') && tokens[at + 1]?.kind === 'number') return 2;
  // A parameter is given its value before the query is read: `DATE ?` is a date then.
  const next = tokens[at + 1]?.kind;
  if (
    (keyword(token, 'DATE') || keyword(token, 'TIMESTAMP')) &&
    (next === 'string' || next === 'parameter')
  )
    return 2;
  return 0;
}

/**
 * What in a page provider's NXQL Nuxeo refuses, each said with why, as far as a check of its
 * tokens can tell: **not a parser, and not a validation of NXQL.** A query it passes may still be
 * refused, or answer nothing. It finds only constructs Nuxeo's grammar has no place for, meant to
 * refuse no query Nuxeo runs; the caller gives it only NXQL, not the pattern of an audit page
 * provider, say, which is another language:
 *
 * - a string left open, or a parenthesis that is not closed or closes nothing;
 * - `==`, `&&`, `||`, `;`, or a `!` that is not `!=`, outside a string;
 * - a `BETWEEN` whose bounds are not each a literal (a string, a number, `DATE '...'`,
 *   `TIMESTAMP '...'`) or a parameter: `BETWEEN NOW('-P1D') AND NOW('P7D')`, which a server
 *   answered 400 (the moves kit's README, step 1), is one;
 * - for a pattern, a query that does not start with `SELECT`.
 *
 * Not checked, among much else: that the properties exist (a column's are, by
 * {@link listedColumnFindings}), that an operator fits its operands, a function's name or its
 * arguments, `NOW()`'s duration among them, an `IN` list, what the parameters will be, the order
 * of the clauses, and what the search index's conversion of NXQL refuses that the repository
 * takes.
 */
export function nxqlProblems(nxql: string, options: { readonly pattern: boolean }): string[] {
  const problems: string[] = [];
  const say = (problem: string) => {
    if (!problems.includes(problem)) problems.push(problem);
  };
  const { tokens, unclosed } = tokenize(nxql);
  if (unclosed) say('a string is not closed, so Nuxeo cannot read the query');
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'open') depth++;
    if (token.kind !== 'close') continue;
    if (depth === 0) say('a ")" closes nothing, so Nuxeo cannot read the query');
    else depth--;
  }
  if (depth > 0 && !unclosed) say('a "(" is not closed, so Nuxeo cannot read the query');
  for (const token of tokens) {
    if (token.kind !== 'symbol') continue;
    for (const [pattern, text, instead] of NOT_NXQL)
      if (pattern.test(token.text)) say(`"${text}" is not NXQL, ${instead}`);
  }
  tokens.forEach((token, index) => {
    if (!keyword(token, 'BETWEEN')) return;
    const first = boundAt(tokens, index + 1);
    const and = index + 1 + first;
    const second = first > 0 && keyword(tokens[and], 'AND') ? boundAt(tokens, and + 1) : 0;
    if (first > 0 && second > 0) return;
    // The condition, to show the person what was refused: up to the end of its group, or the
    // AND or OR after its own AND.
    let end = index + 1;
    let ands = 0;
    for (; end < tokens.length; end++) {
      const next = tokens[end];
      if (next.depth < token.depth) break;
      if (next.depth !== token.depth) continue;
      if (keyword(next, 'OR') || (keyword(next, 'AND') && ++ands > 1)) break;
    }
    const shown = tokens
      .slice(index, end)
      .map((each) => each.text)
      .join(' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')')
      .replace(/(\w) \(/g, '$1(');
    say(
      `BETWEEN takes a literal on each side of its AND, a string, a number, DATE '...' or TIMESTAMP '...', or a parameter, and "${shown}" does not: Nuxeo refuses such a query, answering 400. Compare with >= and <= instead, which take NOW(...)`,
    );
  });
  if (options.pattern && tokens.length > 0 && !keyword(tokens[0], 'SELECT'))
    say(
      'a pattern is a whole query, SELECT * FROM <type> WHERE ..., and this one does not start with SELECT',
    );
  return problems;
}

/**
 * Nuxeo's own document types, which a kit's page provider may name though the kit's stand-in model
 * describes only its own: the platform's, and those of the add-ons a server runs by default. A
 * server's exported model holds them all, and its own besides.
 */
export const NUXEO_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  'AdministrativeStatus',
  'AdministrativeStatusContainer',
  'Annotation',
  'Audio',
  'Collection',
  'Collections',
  'Comment',
  'DefaultSearch',
  'Document',
  'DocumentRoute',
  'DocumentRouteInstancesRoot',
  'DocumentRouteModelsRoot',
  'Domain',
  'Favorites',
  'File',
  'Folder',
  'HiddenFolder',
  'Note',
  'OrderedFolder',
  'Picture',
  'Relation',
  'Root',
  'RouteNode',
  'Section',
  'SectionRoot',
  'TaskDoc',
  'TaskRoot',
  'TemplateRoot',
  'TemplateSource',
  'ThreeD',
  'UserProfile',
  'UserWorkspacesRoot',
  'Video',
  'Workspace',
  'WorkspaceRoot',
]);

/** Nuxeo's own facets, as {@link NUXEO_DOCUMENT_TYPES} are its types. */
export const NUXEO_FACETS: ReadonlySet<string> = new Set([
  'Asset',
  'Audio',
  'BigFolder',
  'ColdStorage',
  'Collection',
  'CollectionMember',
  'Commentable',
  'DocumentRoute',
  'Downloadable',
  'Folderish',
  'ForceAudit',
  'HasRelatedText',
  'HasStoryboard',
  'HasVideoPreview',
  'HiddenInNavigation',
  'Immutable',
  'MultiviewPicture',
  'NXTag',
  'NotCollectionMember',
  'NotFulltextIndexable',
  'Orderable',
  'Picture',
  'Publishable',
  'Record',
  'RoutingTask',
  'SuperSpace',
  'SystemDocument',
  'Task',
  'TemplateBased',
  'ThreeD',
  'Thumbnail',
  'Versionable',
  'Video',
]);

/**
 * What Nuxeo's own schemas write their properties with, their prefixes and their names, which a
 * kit's stand-in model may not describe: a property written so is looked for only when the model
 * describes the schema. Any other the model does not describe is refused.
 */
const NUXEO_SCHEMA_PREFIXES: ReadonlySet<string> = new Set([
  'audio',
  'aud',
  'collection',
  'collectionMember',
  'comment',
  'common',
  'coldstorage',
  'cs',
  'dc',
  'docri',
  'docrm',
  'domain',
  'dublincore',
  'facetedTag',
  'file',
  'files',
  'image_metadata',
  'imd',
  'iptc',
  'note',
  'nt',
  'nxtag',
  'picture',
  'pic',
  'publish',
  'publishing',
  'record',
  'relatedtext',
  'rend',
  'rnode',
  'storyboard',
  'strb',
  'task',
  'template',
  'threed',
  'thumb',
  'thumbnail',
  'tmpl',
  'uid',
  'userprofile',
  'vid',
  'video',
  'webc',
  'webcontainer',
]);

/**
 * How many edits apart `a` and `b` are: a letter added, dropped or changed, or two side by side
 * swapped.
 */
function editsApart(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  return rows[a.length][b.length];
}

/**
 * The name `name`, which is none of the model's (`own`) nor Nuxeo's (`nuxeo`), is likely a
 * misspelling of, said as a message says it: one the same but for case, or, for a name of four
 * letters or more, one edit apart, and two for one of more than five. A name of two or three
 * letters, such as a prefix, is near too many others to tell a misspelling from another schema's.
 * `null` when none is that near: then `name` may well be an add-on's that neither the model nor
 * Nuxeo's lists here describe, and is let be.
 */
function nearMiss(
  name: string,
  own: Iterable<string>,
  nuxeo: Iterable<string>,
  suffix = '',
): string | null {
  const allowed = name.length < 4 ? 0 : name.length > 5 ? 2 : 1;
  let best: { said: string; edits: number } | null = null;
  const look = (names: Iterable<string>, said: (each: string) => string) => {
    for (const each of names) {
      const edits = each.toLowerCase() === name.toLowerCase() ? 0 : editsApart(name, each);
      if (edits <= allowed && (best === null || edits < best.edits))
        best = { said: said(each), edits };
    }
  };
  look(own, (each) => `the model's "${each}${suffix}"`);
  look(nuxeo, (each) => `Nuxeo's own "${each}${suffix}"`);
  return (best as { said: string } | null)?.said ?? null;
}

/** A part of a property's path that steps into a list's items: `*`, `*1`, or an index. */
const ITEM = /^(?:\*\d*|\d+)$/;

/** `a`, `a and b`, `a, b and c`, each quoted. */
function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  return quoted.length < 2
    ? (quoted[0] ?? '')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * Why `xpath`, a property a page provider names as NXQL writes one (`vdocs:checklist/*\/done`,
 * `files:files/*\/file/name`), is not one of `model`, or `null` when it is, or when the model
 * cannot tell: the server's own `ecm:` properties, one of Nuxeo's own schemas the model does not
 * describe, and a prefix that no schema the model or Nuxeo's lists know is written with and that
 * is near none of them (`nearMiss`), which may be an add-on's. A near miss is a misspelling, and
 * refused. The schema is found by its prefix or its name, as Nuxeo finds it; then each part
 * of the path: a subfield of a complex value, or an item of a list. What a file holds, its name or
 * length, and a complex value whose subfields the model does not list, are taken as written.
 * Given `type`, the type the page provider lists, the property is also held to that type, its
 * facets, or a facet of the model a record may be given at run time.
 */
export function propertyNameProblem(
  xpath: string,
  model: ContentModel,
  type: string | null = null,
): string | null {
  const [head, ...path] = xpath.split('/');
  const colon = head.indexOf(':');
  if (colon <= 0 || head.startsWith('ecm:')) return null;
  const prefix = head.slice(0, colon);
  const name = head.slice(colon + 1);
  if (!/^[A-Za-z_][\w-]*$/.test(name)) return null;
  const schema: SchemaModel | undefined =
    [...model.schemas.values()].find((each) => each.prefix === prefix) ?? model.schemas.get(prefix);
  if (!schema) {
    if (NUXEO_SCHEMA_PREFIXES.has(prefix)) return null;
    const near = nearMiss(
      prefix,
      [...model.schemas.values()].flatMap((each) => [each.prefix, each.name]),
      NUXEO_SCHEMA_PREFIXES,
      ':',
    );
    return near === null
      ? null
      : `"${xpath}": no schema of the content model is written "${prefix}:", by its prefix or its name, and ${near} is near it: a misspelling, which Nuxeo refuses`;
  }
  let property: PropertyModel | undefined = schema.properties.get(name);
  if (!property) {
    return `"${xpath}" is not a property of the schema "${schema.name}" (${schema.prefix}:) in the content model, so Nuxeo refuses the query`;
  }
  // The path so far, its items' steps left out: what a message names.
  let at = head;
  let inItem = false;
  for (const part of path) {
    if (property.list && !inItem && ITEM.test(part)) {
      inItem = true;
      continue;
    }
    // A file's own parts, its name, length or type, are Nuxeo's; and what a complex value holds is
    // taken as written when the model lists none of it.
    if (property.type === 'blob' || ITEM.test(part)) return null;
    if (property.type === 'complex' && (property.fields?.size ?? 0) === 0) return null;
    if (property.type !== 'complex' || !property.fields) {
      return `"${xpath}": "${at}" is a ${propertyTypeOf(property)} property, with no subfield "${part}", so Nuxeo refuses the query`;
    }
    const subfield: PropertyModel | undefined = property.fields.get(part);
    if (!subfield) {
      const whose = property.list ? `the entries of "${at}" have` : `"${at}" has`;
      return `"${xpath}": ${whose} no subfield "${part}", only ${quotedList([...property.fields.keys()])}, so Nuxeo refuses the query`;
    }
    property = subfield;
    inItem = false;
    at = `${at}/${part}`;
  }
  if (type === null || !model.types.has(type)) return null;
  const own = new Set(model.types.get(type)?.schemas ?? []);
  for (const facet of model.types.get(type)?.facets ?? [])
    for (const each of model.facets.get(facet)?.schemas ?? []) own.add(each);
  if (own.has(schema.name)) return null;
  // A record may be given a facet at run time, and with it the facet's schemas.
  if ([...model.facets.values()].some((facet) => facet.schemas.includes(schema.name))) return null;
  return `"${xpath}" is a property of the schema "${schema.name}", which the type "${type}" the page provider lists does not have, nor a facet of the model: no record it lists has it`;
}

/** The strings a condition on `ecm:primaryType` or `ecm:mixinType` at `at` compares it with. */
function comparedWith(tokens: readonly NxqlToken[], at: number): NxqlToken[] {
  let next = at + 1;
  if (keyword(tokens[next], 'NOT')) next++;
  const operator = tokens[next];
  if (operator?.kind === 'symbol' && ['=', '<>', '!='].includes(operator.text))
    return tokens[next + 1]?.kind === 'string' ? [tokens[next + 1]] : [];
  if (!keyword(operator, 'IN') || tokens[next + 1]?.kind !== 'open') return [];
  const depth = tokens[next + 1].depth;
  const values: NxqlToken[] = [];
  for (let index = next + 2; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === 'close' && token.depth === depth) break;
    if (token.kind === 'string') values.push(token);
  }
  return values;
}

/**
 * What a page provider's NXQL names that the content model does not have, each said with why:
 * each property ({@link propertyNameProblem}, held to the type it lists when {@link listedType}
 * can tell); each type, in a pattern's `FROM` or compared with `ecm:primaryType`; and each facet
 * compared with `ecm:mixinType`, when it is in neither the model nor Nuxeo's own lists
 * ({@link NUXEO_DOCUMENT_TYPES}, {@link NUXEO_FACETS}) and is a near miss of a name that is
 * (`nearMiss`): a misspelling. One near none may be an add-on's, which a stand-in model does not
 * describe, and is let be. What `nxqlProblems` finds is not said again: a query it cannot read has
 * nothing here.
 */
export function nxqlNameProblems(
  nxql: string,
  options: { readonly pattern: boolean },
  model: ContentModel,
): string[] {
  const problems: string[] = [];
  const say = (problem: string) => {
    if (!problems.includes(problem)) problems.push(problem);
  };
  const { tokens, unclosed } = tokenize(nxql);
  if (unclosed) return problems;
  const type = listedType(nxql, options);
  const typeProblem = (name: string, from: boolean) => {
    if (model.types.has(name) || NUXEO_DOCUMENT_TYPES.has(name)) return;
    const near = nearMiss(name, model.types.keys(), NUXEO_DOCUMENT_TYPES);
    if (near !== null)
      say(
        `the type "${name}" is not in the content model, and ${near} is near it: a misspelling, so ${from ? 'Nuxeo refuses a query from it' : 'the query lists no record of it'}`,
      );
  };
  tokens.forEach((token, index) => {
    if (token.kind !== 'name') return;
    if (token.text === 'ecm:primaryType' || token.text === 'ecm:mixinType') {
      for (const value of comparedWith(tokens, index)) {
        const name = value.text.slice(1, -1);
        if (token.text === 'ecm:primaryType') typeProblem(name, false);
        else if (!model.facets.has(name) && !NUXEO_FACETS.has(name)) {
          const near = nearMiss(name, model.facets.keys(), NUXEO_FACETS);
          if (near !== null)
            say(
              `the facet "${name}" is not in the content model, and ${near} is near it: a misspelling, so no record has it`,
            );
        }
      }
      return;
    }
    if (token.text.includes(':')) {
      const problem = propertyNameProblem(token.text, model, type);
      if (problem !== null) say(problem);
    }
  });
  if (options.pattern) {
    // The types it lists, separated by commas: what comes after, WHERE, ORDER BY or LIMIT, is not.
    const from = tokens.findIndex((token) => token.depth === 0 && keyword(token, 'FROM'));
    for (let index = from + 1; from >= 0 && index < tokens.length; index += 2) {
      const token = tokens[index];
      if (token.kind !== 'name' || token.text.includes(':')) break;
      if (['WHERE', 'ORDER', 'LIMIT', 'OFFSET'].some((word) => keyword(token, word))) break;
      typeProblem(token.text, true);
      if (tokens[index + 1]?.text !== ',') break;
    }
  }
  return problems;
}

/**
 * How many parameters a page provider's NXQL takes, each a `?` Nuxeo fills in order with what a
 * queue, a related list or a home's figure gives it; `null` when it names one, `:name`, too, which
 * a search document fills, when a string holds a `?`, which Nuxeo may count as one, or when a
 * string is left open, which `nxqlProblems` says.
 */
export function positionalParameters(nxql: string): number | null {
  const { tokens, unclosed } = tokenize(nxql);
  if (
    unclosed ||
    tokens.some(
      (token, index) =>
        (token.kind === 'parameter' && token.text !== '?') ||
        // `=:name`, written against its operator, reads as the symbol `=:` and a name.
        (token.kind === 'symbol' &&
          token.text.endsWith(':') &&
          tokens[index + 1]?.kind === 'name') ||
        // Nuxeo may count a ? in a string as a parameter, and this cannot tell.
        (token.kind === 'string' && token.text.includes('?')),
    )
  )
    return null;
  return tokens.filter((token) => token.kind === 'parameter').length;
}

/** A page provider of the package's own, with the parameters its NXQL takes, when it can tell. */
export interface ParameterProvider {
  readonly component: string;
  /** {@link positionalParameters}'s answer: `null` when it cannot tell. */
  readonly parameters: number | null;
}

/**
 * Each queue, related list and home figure that gives a page provider of the package's own other
 * than as many parameters as its NXQL takes. Nuxeo puts each in the next `?` of the query, so with
 * too few or too many the query fails on the server, or runs otherwise than it is written: one
 * written for a queue's search, which is its last parameter, after its own, and has no `?` for
 * it, never searches. `path` is the file's, inside `agentic-ui-config/`: `queues/<id>.json`, a layout, or
 * `home.json`. A page provider not in `providers`, or whose count is `null`, is not checked; an
 * entry already malformed has its finding from the validator, and is passed over here.
 */
export function parameterFindings(
  path: string,
  content: unknown,
  providers: ReadonlyMap<string, ParameterProvider>,
): Finding[] {
  const findings: Finding[] = [];
  if (!isRecord(content)) return findings;
  const check = (item: Record<string, unknown>, at: string, what: string, search: boolean) => {
    const name = item['pageProvider'];
    const provider = typeof name === 'string' ? providers.get(name) : undefined;
    if (!provider || provider.parameters === null) return;
    const given = item['parameters'] === undefined ? [] : item['parameters'];
    if (!Array.isArray(given)) return;
    const count = given.length + (search ? 1 : 0);
    if (count === provider.parameters) return;
    const takes = `the page provider "${name}" (${provider.component}) takes ${provider.parameters} ${provider.parameters === 1 ? 'parameter' : 'parameters'}, each a ? filled in order`;
    const gives = `${what} gives ${count}${search ? `, its search's text last` : ''}`;
    findings.push({
      path: join(at, item['parameters'] === undefined ? 'pageProvider' : 'parameters'),
      kind: 'parameter',
      message: `${takes}, and ${gives}: with ${count < provider.parameters ? 'fewer' : 'more'}, the query fails on the server, or runs otherwise than it is written`,
    });
  };
  if (path.startsWith('queues/')) check(content, '', 'the queue', isRecord(content['search']));
  else if (path === 'home.json' && Array.isArray(content['cards'])) {
    content['cards'].forEach((card, index) => {
      if (isRecord(card) && isRecord(card['kpi']))
        check(card['kpi'], join(join('cards', index), 'kpi'), 'the figure', false);
    });
  } else if (path.startsWith('layouts/')) {
    const cards = (value: unknown, at: string): void => {
      if (!Array.isArray(value)) return;
      value.forEach((card, index) => {
        if (isRecord(card) && isRecord(card['related']))
          check(
            card['related'],
            join(join(join(at, 'cards'), index), 'related'),
            'the related list',
            false,
          );
      });
    };
    cards(content['cards'], '');
    if (Array.isArray(content['tabs']))
      content['tabs'].forEach((tab, index) => {
        if (isRecord(tab)) cards(tab['cards'], join('tabs', index));
      });
  }
  return findings;
}

/** A page provider of the package's own, as the pipeline read it from its component. */
export interface ListingProvider {
  /** The type it lists, {@link listedType}'s answer: `null` when its NXQL does not say. */
  readonly listed: string | null;
  /** The component that defines it, as the findings name it. */
  readonly component: string;
}

/** The server's own properties, which no schema holds; and a task form's variables. */
const UNCHECKED = /^(?:ecm|var):/;

/**
 * Each column and sort of a queue, or of a layout's related lists, that names a property the type
 * its page provider lists does not have, or a widget that does not show its property's type.
 * `path` is the file's, inside `agentic-ui-config/`: `queues/<id>.json` or a layout. A list on a
 * page provider not in `providers`, or whose type is `null` or not in the model, is not checked.
 * An entry already malformed has its finding from the validator, and is passed over here.
 */
export function listedColumnFindings(
  path: string,
  content: unknown,
  providers: ReadonlyMap<string, ListingProvider>,
  model: ContentModel,
  registries: Registries = PACKAGED_REGISTRIES,
): Finding[] {
  const findings: Finding[] = [];
  if (!isRecord(content)) return findings;
  const list = (item: Record<string, unknown>, at: string): void => {
    const name = item['pageProvider'];
    const provider = typeof name === 'string' ? providers.get(name) : undefined;
    if (!provider || provider.listed === null) return;
    const type = provider.listed;
    const properties = propertiesOf(model, type);
    if (!properties) return;
    const whose = `the type "${type}", which the page provider "${name}" (${provider.component}) lists`;
    const property = (xpath: unknown, where: string) => {
      if (typeof xpath !== 'string' || !XPATH.test(xpath) || UNCHECKED.test(xpath)) return null;
      const found = properties.get(xpath);
      if (!found)
        findings.push({
          path: where,
          kind: 'unknown',
          message: `"${xpath}" is not a property of ${whose}, or of its facets`,
        });
      return found ?? null;
    };
    const columns = item['columns'];
    if (Array.isArray(columns))
      columns.forEach((column, index) => {
        const at2 = join(join(at, 'columns'), index);
        if (typeof column === 'string') {
          property(column, at2);
          return;
        }
        if (!isRecord(column) || 'computed' in column) return;
        const found = property(column['field'], join(at2, 'field'));
        const widget = column['widget'];
        if (!found || typeof widget !== 'string' || !Object.hasOwn(registries.widgets, widget))
          return;
        const shown = propertyTypeOf(found);
        const accepts = registries.widgets[widget].accepts as readonly string[];
        if (!accepts.includes(shown))
          findings.push({
            path: join(at2, 'widget'),
            kind: 'parameter',
            message: `the widget "${widget}" does not show "${column['field']}", a ${shown} property of ${whose}: it takes ${accepts.join(' or ')}`,
          });
      });
    const sort = item['sort'];
    if (Array.isArray(sort))
      sort.forEach((entry, index) => {
        if (isRecord(entry)) property(entry['field'], join(join(join(at, 'sort'), index), 'field'));
      });
  };
  if (path.startsWith('queues/')) {
    // A column's `show` names a property of the records it links to, whose types it says: checked
    // whatever page provider lists the rows.
    if (Array.isArray(content['columns']))
      content['columns'].forEach((column, index) =>
        findings.push(...linkedShowFindings(column, join('columns', index), model)),
      );
    list(content, '');
  } else if (path.startsWith('layouts/')) {
    const cards = (value: unknown, at: string): void => {
      if (!Array.isArray(value)) return;
      value.forEach((card, index) => {
        if (isRecord(card) && isRecord(card['related']))
          list(card['related'], join(join(join(at, 'cards'), index), 'related'));
      });
    };
    cards(content['cards'], '');
    if (Array.isArray(content['tabs']))
      content['tabs'].forEach((tab, index) => {
        if (isRecord(tab)) cards(tab['cards'], join('tabs', index));
      });
  }
  return findings;
}
