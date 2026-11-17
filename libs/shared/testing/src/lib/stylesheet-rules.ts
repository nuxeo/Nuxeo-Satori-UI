/**
 * Reading a rule out of a stylesheet's source, for a spec that checks what the stylesheet
 * declares. Pure string work, so it runs in any test environment; the spec reads its own file.
 */

/** The stylesheet without its `/* ... *\/` and `// ...` comments. */
export function withoutScssComments(scss: string): string {
  return scss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** `text` as a regular expression that matches it literally, backslashes included. */
export function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The text between the braces that open at `open`, with nested blocks removed. */
function topLevelDeclarations(scss: string, open: number): string | null {
  let depth = 0;
  let top = '';
  for (let i = open; i < scss.length; i += 1) {
    const ch = scss[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return top;
    } else if (depth === 1) top += ch;
  }
  return null;
}

/**
 * The declarations of the rule reached by following `path` from the top of the file, nested
 * rules included (`['.viewer-toolbar', 'button']` is `button` inside `.viewer-toolbar`). Only the
 * rule's own declarations are returned, not those of rules nested inside it. `null` when a
 * selector on the path is not found, so a renamed rule cannot pass by being absent.
 */
export function ruleDeclarations(scss: string, path: readonly string[]): string | null {
  const source = withoutScssComments(scss);
  let from = 0;
  for (const selector of path) {
    const found = new RegExp(`(^|[\\s}])${escapeForRegExp(selector)}\\s*\\{`, 'm').exec(
      source.slice(from),
    );
    if (!found) return null;
    from += found.index + found[0].length - 1;
  }
  return topLevelDeclarations(source, from);
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
