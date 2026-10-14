/**
 * Which modules a stylesheet loads — `@use`, `@forward` and `@import` targets, parsed with comments
 * and string contents masked, never pattern-matched over raw text.
 *
 * Shared by the `supply-chain` gate (through `module-references.mjs`), which asks whether a
 * production dependency is referenced, and the `dependency-tree` gate, which asks whether a
 * forbidden one is. One scanner, because two gates reading the same stylesheet differently would
 * each be green on a file the other flags. Its controls are `selfCheck()`: `supply-chain.mjs` runs
 * them before trusting its scan, and `dependency-tree.selftest.mjs` alongside the gate's own.
 */

/**
 * `text` with comments blanked to spaces and string contents to `_`, quotes and newlines kept, so
 * every offset still maps to `text`.
 *
 * A scanner rather than a regex, because neither construct can be found without knowing whether
 * you are inside the other: the `//` in `$marker: "//"` is not a comment, and the `;` and
 * `@import` in `content: "; @import 'x'"` are not a statement. An unquoted `url(...)` is masked
 * like a string up to its `)`, so neither the `//` in `url(//cdn/x)` nor the `;` in
 * `url(data:text/css;base64,…)` is read as syntax.
 * @param {string} text
 * @returns {string}
 */
export function maskStylesheet(text) {
  let out = '';
  let quote = null;
  let inUrl = false;
  // Just past `url(` and any whitespace, where an unquoted argument would start. A flag rather than
  // testing `out` for a trailing `url(`: that test rescans the output once per character.
  let urlOpen = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && i + 1 < text.length) {
        out += text[i + 1] === '\n' ? '_\n' : '__';
        i += 1;
      } else if (c === quote || c === '\n') {
        quote = null;
        out += c;
      } else {
        out += '_';
      }
      continue;
    }
    if (urlOpen && !/\s/.test(c)) {
      urlOpen = false;
      if (c !== '"' && c !== "'") inUrl = true;
    }
    if (inUrl) {
      if (c === ')') inUrl = false;
      out += c === ')' || c === '\n' ? c : '_';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    const block = c === '/' && text[i + 1] === '*';
    const line = c === '/' && text[i + 1] === '/';
    if (block || line) {
      const end = block ? text.indexOf('*/', i + 2) : text.indexOf('\n', i);
      const stop = end === -1 ? text.length : block ? end + 2 : end;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    out += c;
    if (c === '(' && /url$/i.test(out.slice(-4, -1))) urlOpen = true;
  }
  return out;
}

/**
 * `@use`, `@forward` and `@import` targets in a stylesheet — only at a statement start, never in a
 * comment, and never inside a string. The directives and their targets are found in the mask and
 * read back from `text` at the same offsets.
 *
 * Every target of an `@import`, not the first: Sass takes `@import 'a', 'b';` and CSS takes an
 * unquoted `url(...)`. Only the first of a `@use` or `@forward`, whose later strings are
 * configuration: `@use 'theme' with ($label: 'x')`. A statement runs to `;`, `{` or `}`, which may
 * be lines away; the indented `.sass` syntax has none, so there it runs to the end of the line.
 * @param {string} text
 * @param {string} [file]  the stylesheet's path, read only for a `.sass` extension
 * @returns {string[]}
 */
export function styleSpecifiers(text, file = '') {
  const mask = maskStylesheet(text);
  const statement = file.endsWith('.sass')
    ? /(?:^|\n)[ \t]*@(use|forward|import)\b([^\n]*)/dg
    : /(?:^|[;{}])\s*@(use|forward|import)\b([^;{}]*)/dg;
  const target = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)|(['"])([^'"\n]*)\3/dg;
  const found = [];
  for (const s of mask.matchAll(statement)) {
    const [from, to] = s.indices[2];
    for (const t of mask.slice(from, to).matchAll(target)) {
      const span = t.indices[2] ?? t.indices[4];
      found.push(text.slice(from + span[0], from + span[1]).replace(/^~/, ''));
      if (s[1] !== 'import') break;
    }
  }
  return found;
}

const PKG = 'fixture-pkg';

/**
 * `[name, text, mask]` — the mask character for character, so a scanner that masks too little and
 * one that masks too much both fail.
 * @type {[string, string, string][]}
 */
const MASK_CONTROLS = [
  ['line comment', `// x\n.a{}`, `    \n.a{}`],
  ['block comment across lines', `/* a\nb */c`, `    \n    c`],
  ['unterminated block comment', `a/* open`, `a       `],
  ['"//" inside a string', `$m: "//";`, `$m: "__";`],
  ['";" inside a string', `a: 'x;y';`, `a: '___';`],
  ['escaped quote inside a string', `a: "x\\"y";`, `a: "____";`],
  ['a newline ends an unterminated string', `a: "x\ny`, `a: "_\ny`],
  ['unquoted url() with "//"', `url(http://h/x)`, `url(__________)`],
  ['unquoted url() with ";"', `url(data:a;b)`, `url(________)`],
  ['URL( in capitals, padded', `URL( x )`, `URL( __)`],
  ['quoted url() is a string', `url("a;b")`, `url("___")`],
  ['url( argument on the next line', `url(\n  x)`, `url(\n  _)`],
];

/**
 * `[name, text, file, targets]` — exactly these targets, in order. The empty rows must find
 * nothing: a comment, a string or a `url()` payload that looks like a statement. The others keep
 * the scanner from passing those by finding nothing at all, and pin the rules that only show up
 * in the order or count of what it returns: every `@import` target, one `@use` target, `~` dropped.
 * Each row's mask is also checked to keep `text`'s length, because the targets are read back from
 * `text` at the mask's offsets.
 * @type {[string, string, string, string[]][]}
 */
const SPECIFIER_CONTROLS = [
  ['line comment', `// @use '${PKG}';\n.a { color: red; }\n`, 'a.scss', []],
  ['block comment', `/* @import '${PKG}/x'; */\n`, 'a.scss', []],
  ['directive inside a string', `.a { content: "@import '${PKG}'"; }\n`, 'a.scss', []],
  ['statement start inside a string', `.a { content: "; @import '${PKG}/x';"; }\n`, 'a.scss', []],
  ['statement start inside a url()', `.a { b: url(data:x;@import '${PKG}'); }\n`, 'a.css', []],
  ['directive mid-declaration', `.a { b: c @import '${PKG}'; }\n`, 'a.scss', []],
  ['@use subpath', `@use '${PKG}/theme' as t;\n`, 'a.scss', [`${PKG}/theme`]],
  ['@import with ~', `.a {}\n@import '~${PKG}/x';\n`, 'a.scss', [`${PKG}/x`]],
  ['@use after "//" in a string', `$m: "//"; @use '${PKG}/t';\n`, 'a.scss', [`${PKG}/t`]],
  ['@use configuration', `@use 'theme' with ($label: '${PKG}');\n`, 'a.scss', ['theme']],
  ['@forward configuration', `@forward 't' with ($s: '${PKG}' !default);\n`, 'a.scss', ['t']],
  ['commented-out @import target', `@import 'a', /* '${PKG}' */ 'b';\n`, 'a.scss', ['a', 'b']],
  ['multi-line @import list', `@import 'a',\n  '${PKG}/t';\n`, 'a.scss', ['a', `${PKG}/t`]],
  [
    'target after url(//…)',
    `@import url(//cdn.example/x.css), '${PKG}/y';\n`,
    'a.scss',
    ['//cdn.example/x.css', `${PKG}/y`],
  ],
  [
    'target after url(http://…)',
    `@import url(http://cdn.example/x.css), '${PKG}/y';\n`,
    'a.scss',
    ['http://cdn.example/x.css', `${PKG}/y`],
  ],
  [
    'target after a data: url()',
    `@import url(data:text/css;base64,abc), '${PKG}/y';\n`,
    'a.scss',
    ['data:text/css;base64,abc', `${PKG}/y`],
  ],
  ['unquoted url() target', `@import url(${PKG}/a.css);\n`, 'a.css', [`${PKG}/a.css`]],
  ['indented .sass: one statement per line', `@use 'a'\n@use '${PKG}'\n`, 'a.sass', ['a', PKG]],
  ['braced syntax: a statement runs to ";"', `@use 'a'\n@use '${PKG}'\n`, 'a.scss', ['a']],
];

/**
 * Every URL a stylesheet loads: `@use` and `@forward` (one URL each — a later string is
 * configuration), every entry of an `@import` list, quoted or as `url(…)`, and `meta.load-css()`.
 *
 * Indented Sass (`indented`) ends a rule at the end of its line rather than at `;`, and may write
 * an `@import` list unquoted. Uses proper masking to ignore commented directives and strings.
 */
export function sassLoadedUrls(body, { indented = false } = {}) {
  const mask = maskStylesheet(body);
  const statement = indented
    ? /(?:^|\n)[ \t]*@(use|forward|import)\b([^\n]*)/dg
    : /(?:^|[;{}])\s*@(use|forward|import)\b([^;{}]*)/dg;
  const target = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)|(['"])([^'"\n]*)\3/dg;
  const urls = [];
  for (const s of mask.matchAll(statement)) {
    const [from, to] = s.indices[2];
    for (const t of mask.slice(from, to).matchAll(target)) {
      const span = t.indices[2] ?? t.indices[4];
      const url = body.slice(from + span[0], from + span[1]).replace(/^~/, '');
      urls.push(url);
      if (s[1] !== 'import') break;
    }
  }
  for (const call of mask.matchAll(/load-css\(\s*(['"]?)([^'")\s]+)\1\s*\)/dg)) {
    if (call.indices[2]) {
      const [start, end] = call.indices[2];
      urls.push(body.slice(start, end));
    }
  }
  return urls;
}

/**
 * Run the controls and return a description of each one that did not behave as specified.
 * @returns {string[]}
 */
export function selfCheck() {
  const failures = [];
  for (const [name, text, expected] of MASK_CONTROLS) {
    const got = maskStylesheet(text);
    if (got !== expected) {
      failures.push(
        `mask, ${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`,
      );
    }
  }
  for (const [name, text, file, expected] of SPECIFIER_CONTROLS) {
    const length = maskStylesheet(text).length;
    if (length !== text.length) {
      failures.push(`mask, ${name}: ${length} characters for a ${text.length}-character input`);
    }
    const got = styleSpecifiers(text, file);
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(
        `targets, ${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`,
      );
    }
  }
  return failures;
}

export const CONTROL_COUNT = {
  mask: MASK_CONTROLS.length,
  negative: SPECIFIER_CONTROLS.filter((c) => c[3].length === 0).length,
  positive: SPECIFIER_CONTROLS.filter((c) => c[3].length > 0).length,
};
