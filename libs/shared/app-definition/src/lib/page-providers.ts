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
