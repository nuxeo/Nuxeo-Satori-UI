/**
 * What the package pipeline checks of the page providers a package defines in its own components,
 * which only it reads (`scripts/app-package.mjs`, step 2), given the content model it holds the
 * package to (package-pipeline.md, section 2):
 *
 * - **The type a page provider lists** ({@link listedType}), read from its NXQL as `app-model`
 *   writes it: `ecm:primaryType = '<Type>'`, a condition every listed record meets, or a pattern
 *   `FROM <Type>`. Only when the NXQL says so plainly; otherwise none, and nothing is checked.
 * - **A queue's and a related list's columns and sorts** ({@link listedColumnFindings}), held to
 *   that type as a layout's fields are held to the type its path names (`layout-model.ts`): each
 *   property on the type or a facet it declares, and each column's widget showing its property's
 *   type. A page provider the package does not define is the server's, which the pipeline cannot
 *   read, and is not checked; nor are the server's own properties, `ecm:`, which no schema holds.
 *
 * Plain TypeScript, so that the pipeline runs it with Node alone, as it runs the validator.
 */
import { join, type Finding } from './checker';
import { propertiesOf, propertyTypeOf, type ContentModel } from './content-model';
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
    const match =
      /^(?:\d+(?:\.\d+)?)/.exec(rest) ??
      /^:[A-Za-z_]\w*/.exec(rest) ??
      /^[A-Za-z_][\w:./*-]*/.exec(rest) ??
      /^\?/.exec(rest) ??
      /^[^\s\w'"()?]+/.exec(rest);
    const text = match ? match[0] : character;
    const kind = /^\d/.test(text)
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
 * The one document type every record a page provider lists is of, from its NXQL, or `null`. Read
 * only where the NXQL says so plainly, so that a column is never held to a type the records may
 * not have: a where clause of conditions joined by `AND` alone at its top, one of them
 * `ecm:primaryType = '<Type>'`, not under a `NOT`, and no other mention of `ecm:primaryType`; or,
 * for a pattern, `FROM <Type>` other than `Document`, whose records have that type's schemas at
 * least.
 */
export function listedType(nxql: string, options: { readonly pattern: boolean }): string | null {
  const { tokens, unclosed } = tokenize(nxql);
  if (unclosed) return null;
  const where = whereOf(tokens, options.pattern);
  let primary: string | null = null;
  if (where !== null) {
    if (where.some((token) => token.depth === 0 && keyword(token, 'OR'))) return null;
    const mentions = where
      .map((token, index) => ({ token, index }))
      .filter(({ token }) => token.kind === 'name' && token.text === 'ecm:primaryType');
    if (mentions.length > 1) return null;
    if (mentions.length === 1) {
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
      primary = value.text.slice(1, -1);
    }
  }
  if (primary !== null) return primary;
  if (!options.pattern) return null;
  const from = tokens.findIndex((token) => token.depth === 0 && keyword(token, 'FROM'));
  const type = from === -1 ? undefined : tokens[from + 1];
  const after = from === -1 ? undefined : tokens[from + 2];
  if (type?.kind !== 'name' || type.text === 'Document' || (after && !keyword(after, 'WHERE')))
    return null;
  return type.text;
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
  if (path.startsWith('queues/')) list(content, '');
  else if (path.startsWith('layouts/')) {
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
