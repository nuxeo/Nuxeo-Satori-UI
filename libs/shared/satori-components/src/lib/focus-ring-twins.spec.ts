// @vitest-environment node
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import postcss, { type Container, type Rule } from 'postcss';
import { compile } from 'sass';

/**
 * Every focus ring in the library is also drawn on a standalone `:focus` (AGENTS/08, pattern 17).
 * IBM Equal Access's `style_focus_visible` reads `:focus` only and does not resolve a selector
 * list, so a ring declared on `:focus-visible` alone, or on `:focus, :focus-visible`, reads to it
 * as no indicator at all (NXSAT-547).
 *
 * A ring is a rule whose selector names `:focus-visible` and which sets an `outline` other than
 * `none` or `0`. Its twin is a rule of one selector, the same with `:focus` in place of
 * `:focus-visible`, under the same parent, setting the same declarations.
 */
function focusRingsWithoutTwin(css: string): string[] {
  const root = postcss.parse(css);
  const declarations = (rule: Rule): string =>
    rule.nodes
      .filter((node) => node.type === 'decl')
      .map((decl) => `${decl.prop}:${decl.value}`)
      .sort()
      .join(';');
  const missing: string[] = [];
  root.walkRules((rule) => {
    const outline = rule.nodes.find(
      (node) => node.type === 'decl' && (node.prop === 'outline' || node.prop === 'outline-style'),
    );
    if (!outline || outline.type !== 'decl' || /^(none|0)\b/.test(outline.value.trim())) return;
    const siblings = (rule.parent as Container | undefined)?.nodes ?? [];
    for (const selector of rule.selectors.filter((s) => s.includes(':focus-visible'))) {
      const twin = selector.replace(/:focus-visible/g, ':focus');
      const found = siblings.some(
        (node) =>
          node.type === 'rule' &&
          node.selectors.length === 1 &&
          node.selectors[0] === twin &&
          declarations(node) === declarations(rule),
      );
      if (!found) missing.push(selector);
    }
  });
  return missing;
}

const RING = 'outline: 2px solid red; outline-offset: -2px;';

describe('a focus ring without a standalone :focus twin', () => {
  it.each([
    ['a standalone twin', `.a:focus { ${RING} } .a:focus-visible { ${RING} }`, []],
    [
      'a twin for a descendant ring',
      `.a:focus > .b { ${RING} } .a:focus-visible > .b { ${RING} }`,
      [],
    ],
    ['no twin', `.a:focus-visible { ${RING} }`, ['.a:focus-visible']],
    ['a selector list', `.a:focus, .a:focus-visible { ${RING} }`, ['.a:focus-visible']],
    [
      'a twin that draws less',
      `.a:focus { outline: 2px solid red; } .a:focus-visible { ${RING} }`,
      ['.a:focus-visible'],
    ],
    [
      'a twin in another context',
      `@media print { .a:focus { ${RING} } } .a:focus-visible { ${RING} }`,
      ['.a:focus-visible'],
    ],
    ['an underline, not a ring', `.a:hover, .a:focus-visible { text-decoration: underline; }`, []],
    ['a removed ring', `.a:focus:not(:focus-visible) { outline: none; }`, []],
    ['a :focus-within ring', `.a:focus-within { ${RING} }`, []],
  ])('%s', (_case, css, expected) => {
    expect(focusRingsWithoutTwin(css)).toEqual(expected);
  });
});

const library = dirname(fileURLToPath(import.meta.url));

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith('.component.scss') ? [path] : [];
  });
}

describe('the library’s focus rings', () => {
  const sheets = stylesheets(library);

  it('reads the component stylesheets', () => {
    expect(sheets.length).toBeGreaterThan(30);
  });

  it('draws every ring on a standalone :focus as well (IBM style_focus_visible)', () => {
    const missing = sheets.flatMap((path) =>
      focusRingsWithoutTwin(compile(path).css).map(
        (selector) => `${relative(library, path)}: ${selector}`,
      ),
    );
    expect(missing).toEqual([]);
    // Compiles every component stylesheet: allow for a loaded coverage run.
  }, 30_000);
});
