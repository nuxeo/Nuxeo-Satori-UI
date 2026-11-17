/**
 * Reading a rule out of a stylesheet's source, for a spec that checks what the stylesheet
 * declares. Pure string work, so it runs in any test environment; the spec reads its own file.
 *
 * It follows nesting by braces and reads selectors as written. It does not evaluate Sass: a
 * selector built with interpolation (`#{...}`) is not matched by name.
 */

/** The stylesheet without its `/* ... *\/` and `// ...` comments. */
export function withoutScssComments(scss: string): string {
  return scss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** A rule found at one level of the source: its selector list, and where its braces are. */
interface Rule {
  readonly selectors: readonly string[];
  readonly open: number;
  readonly close: number;
}

/** The index of the `}` that closes the `{` at `open`, or -1 when it never closes. */
function closingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The rules that sit directly in `source[from, to)`, not those nested inside them. A rule's
 * selector is what precedes its `{`, after the last `;` or `}` before it.
 */
function directRules(source: string, from: number, to: number): Rule[] {
  const rules: Rule[] = [];
  let headerStart = from;
  for (let i = from; i < to; i += 1) {
    const ch = source[i];
    if (ch === ';' || ch === '}') headerStart = i + 1;
    else if (ch === '{') {
      const close = closingBrace(source, i);
      if (close === -1 || close >= to) break;
      const header = source.slice(headerStart, i).trim();
      rules.push({ selectors: header.split(',').map((s) => s.trim()), open: i, close });
      i = close;
      headerStart = close + 1;
    }
  }
  return rules;
}

/** The text of the braces at `open`, without the rules nested inside them. */
function ownDeclarations(source: string, open: number, close: number): string {
  let depth = 0;
  let own = '';
  for (let i = open; i <= close; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (depth === 1) own += ch;
  }
  return own;
}

/**
 * The declarations of the rule reached by following `path` from the top of the file
 * (`['.viewer-toolbar', 'button']` is `button` written directly inside `.viewer-toolbar`). Each
 * selector is looked for only among the direct children of the rule the one before it matched, so
 * a rule of that name elsewhere in the file, in a later sibling or deeper down, is never read as
 * it. Only the rule's own declarations are returned, not those of rules nested inside it. `null`
 * when a selector on the path is not found, so a renamed rule cannot pass by being absent.
 */
export function ruleDeclarations(scss: string, path: readonly string[]): string | null {
  const source = withoutScssComments(scss);
  let from = 0;
  let to = source.length;
  let found: Rule | undefined;
  for (const selector of path) {
    found = directRules(source, from, to).find((rule) => rule.selectors.includes(selector));
    if (!found) return null;
    from = found.open + 1;
    to = found.close;
  }
  return found ? ownDeclarations(source, found.open, found.close) : null;
}

/**
 * What a rule is missing to centre the icon of a Material icon button it has resized: the button
 * must lay its icon out itself (`inline-flex`, centred on both axes) and drop Material's padding,
 * which is sized for a 40px button. Empty when the rule centres it.
 */
export function iconCentringProblems(declarations: string): string[] {
  const missing: string[] = [];
  if (!/display:\s*inline-flex/.test(declarations)) missing.push('display: inline-flex');
  if (!/align-items:\s*center/.test(declarations)) missing.push('align-items: center');
  if (!/justify-content:\s*center/.test(declarations)) missing.push('justify-content: center');
  if (!/(^|[;\s])padding:\s*0\s*;/.test(declarations)) missing.push('padding: 0');
  return missing;
}
