/**
 * The custom properties a Web UI theme declares.
 *
 * A theme is a `<custom-style>` block of CSS custom properties: Web UI's own (`--nuxeo-*`), and
 * Polymer's (`--paper-*`, `--primary-text-color`, …), some of them Polymer mixins whose value is a
 * block of declarations (`--paper-input-container: { color: red; };`). A CSS parser drops or
 * rejects the mixins, so this scanner reads the text itself: it skips comments and strings, tracks
 * braces, and takes each `--name:` that starts a declaration inside a block.
 */

export interface ThemeProperty {
  /** With its leading `--`. */
  readonly name: string;
  /** As written, trimmed. A mixin's value is its block, braces included. */
  readonly value: string;
  /** A Polymer mixin: a block of declarations, not a value. */
  readonly mixin: boolean;
}

export function themeProperties(css: string): ThemeProperty[] {
  const properties: ThemeProperty[] = [];
  let depth = 0;
  // True where a declaration may start: just inside a block, or after a `;`.
  let declarationStart = false;
  let at = 0;
  while (at < css.length) {
    const char = css[at];
    if (char === '/' && css[at + 1] === '*') {
      at = skipComment(css, at);
      continue;
    }
    if (char === '"' || char === "'") {
      at = skipString(css, at);
      declarationStart = false;
      continue;
    }
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    if (char === '{') {
      depth++;
      declarationStart = true;
      at++;
      continue;
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1);
      declarationStart = true;
      at++;
      continue;
    }
    if (char === ';') {
      declarationStart = true;
      at++;
      continue;
    }
    if (depth > 0 && declarationStart && css.startsWith('--', at)) {
      const declaration = readDeclaration(css, at);
      if (declaration) {
        properties.push(declaration.property);
        at = declaration.end;
        declarationStart = true;
        continue;
      }
    }
    declarationStart = false;
    at++;
  }
  return properties;
}

function readDeclaration(
  css: string,
  start: number,
): { property: ThemeProperty; end: number } | null {
  const name = /^--[A-Za-z0-9_-]+/.exec(css.slice(start))?.[0];
  if (!name) return null;
  let at = start + name.length;
  while (at < css.length && /\s/.test(css[at])) at++;
  if (css[at] !== ':') return null;
  at++;
  while (at < css.length && /\s/.test(css[at])) at++;

  if (css[at] === '{') {
    const close = matchingBrace(css, at);
    const property = { name, value: css.slice(at, close + 1).trim(), mixin: true };
    at = close + 1;
    while (at < css.length && /\s/.test(css[at])) at++;
    if (css[at] === ';') at++;
    return { property, end: at };
  }

  // A value runs to the `;` or `}` that ends the declaration, outside strings, comments and
  // parentheses: `var(--x)`, `'Inter', Arial` and `url("a;b")` all stay whole.
  const valueStart = at;
  let parentheses = 0;
  while (at < css.length) {
    const char = css[at];
    if (char === '/' && css[at + 1] === '*') {
      at = skipComment(css, at);
      continue;
    }
    if (char === '"' || char === "'") {
      at = skipString(css, at);
      continue;
    }
    if (char === '(') parentheses++;
    if (char === ')') parentheses = Math.max(0, parentheses - 1);
    if (parentheses === 0 && (char === ';' || char === '}')) break;
    at++;
  }
  const value = stripComments(css.slice(valueStart, at)).trim();
  if (css[at] === ';') at++;
  return { property: { name, value, mixin: false }, end: at };
}

/** The index of the `}` that closes the block opening at `open`. */
function matchingBrace(css: string, open: number): number {
  let depth = 0;
  let at = open;
  while (at < css.length) {
    const char = css[at];
    if (char === '/' && css[at + 1] === '*') {
      at = skipComment(css, at);
      continue;
    }
    if (char === '"' || char === "'") {
      at = skipString(css, at);
      continue;
    }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return at;
    }
    at++;
  }
  return css.length - 1;
}

/** The index just past the comment opening at `start`, or the end of the text if it is never closed. */
function skipComment(css: string, start: number): number {
  const close = css.indexOf('*/', start + 2);
  return close === -1 ? css.length : close + 2;
}

/** The index just past the string opening at `start`, honouring backslash escapes. */
function skipString(css: string, start: number): number {
  const quote = css[start];
  let at = start + 1;
  while (at < css.length && css[at] !== quote) {
    at += css[at] === '\\' ? 2 : 1;
  }
  return at + 1;
}

/** The text without its comments. What a string holds is kept, `/*` and all. */
function stripComments(text: string): string {
  let kept = '';
  let at = 0;
  while (at < text.length) {
    if (text[at] === '/' && text[at + 1] === '*') {
      at = skipComment(text, at);
      continue;
    }
    if (text[at] === '"' || text[at] === "'") {
      const end = skipString(text, at);
      kept += text.slice(at, end);
      at = end;
      continue;
    }
    kept += text[at];
    at++;
  }
  return kept;
}
