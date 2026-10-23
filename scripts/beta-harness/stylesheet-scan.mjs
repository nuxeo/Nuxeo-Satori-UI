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
        if (text[i + 1] === '\n') {
          out += '_\n';
          i += 1;
        } else if (text[i + 1] === '\r' && i + 2 < text.length && text[i + 2] === '\n') {
          out += '_\r\n';
          i += 2;
        } else {
          out += '__';
          i += 1;
        }
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
 * @param {{ stripWebpackPrefix?: boolean }} [opts]
 * @returns {string[]}
 */
export function styleSpecifiers(text, file = '', { stripWebpackPrefix = true } = {}) {
  const mask = maskStylesheet(text);
  const statement = file.endsWith('.sass')
    ? /(?:^|\n)[ \t]*@(use|forward|import)\b([^\n]*)/dg
    : /(?:^|[;{}])\s*@(use|forward|import)\b([^;{}]*)/dg;
  // Quoted targets may continue across `\` + newline inside the string (Sass line continuation).
  const target = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)|(['"])([\s\S]*?)\3/dg;
  const found = [];
  for (const s of mask.matchAll(statement)) {
    const [from, to] = s.indices[2];
    for (const t of mask.slice(from, to).matchAll(target)) {
      const span = t.indices[2] ?? t.indices[4];
      let value = text.slice(from + span[0], from + span[1]);
      if (t[3]) {
        value = value.replace(/\\(?:\r\n|\r|\n)[ \t]*/g, '');
      }
      if (stripWebpackPrefix) {
        value = value.replace(/^~/, '');
      }
      // Trim trailing whitespace from unquoted url() targets (group 2, when group 1 is empty)
      if (t[1] === '') {
        value = value.trimEnd();
      }
      found.push(value);
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
  [
    'quoted URL with backslash-newline continuation',
    `@use '${PKG}/\\\n  theme';\n`,
    'a.scss',
    [`${PKG}/theme`],
  ],
  [
    'backslash-CRLF continuation keeps following @use',
    `@use 'local/\\\r\ntheme';\r\n@use '${PKG}/theme';\r\n`,
    'a.scss',
    ['local/theme', `${PKG}/theme`],
  ],
];

/**
 * `[name, text, opts, targets]` — `sassLoadedUrls` contract for dependency closure.
 * @type {[string, string, { indented?: boolean }, string[]][]}
 */
const SASS_LOADED_URL_CONTROLS = [
  ['webpack ~ prefix preserved', `@use '~theme';\n`, {}, ['~theme']],
  ['commented load-css ignored', `// load-css('${PKG}');\n`, {}, []],
  [
    'load-css collected when live',
    `@include meta.load-css('${PKG}/theme');\n`,
    {},
    [`${PKG}/theme`],
  ],
  ['unquoted indented import list', `@import foo, bar\n`, { indented: true }, ['foo', 'bar']],
  [
    'sassLoadedUrls: backslash-newline in quoted @use',
    `@use '${PKG}/\\\n  theme';\n`,
    {},
    [`${PKG}/theme`],
  ],
];

/**
 * Every URL a stylesheet loads: `@use` and `@forward` (one URL each — a later string is
 * configuration), every entry of an `@import` list, quoted or as `url(…)`, and `meta.load-css()`.
 *
 * Indented Sass (`indented`) ends a rule at the end of its line rather than at `;`, and may write
 * an `@import` list unquoted.
 */
export function sassLoadedUrls(body, { indented = false } = {}) {
  // Preserve webpack's `~` prefix — dependency closure uses it to skip package URLs.
  const urls = styleSpecifiers(body, indented ? 'dummy.sass' : 'dummy.scss', {
    stripWebpackPrefix: false,
  });

  // For indented Sass, add fallback for unquoted @import lists that styleSpecifiers doesn't catch
  if (indented) {
    const mask = maskStylesheet(body);
    for (const match of mask.matchAll(/(?:^|\n)[ \t]*@import\b([^\n]*)/dg)) {
      const [from, to] = match.indices[1];
      const maskedContent = mask.slice(from, to).trim();
      const importList = body.slice(from, to).trim();
      // Only process if the masked version has non-space chars (not all masked/commented)
      // and doesn't start with a quote or url() (those are handled by styleSpecifiers)
      if (maskedContent && !/^['"]|url\(/.test(maskedContent) && !/^['"]|url\(/.test(importList)) {
        // This is an unquoted import list; split and add each item
        for (const item of importList.split(',')) {
          const trimmed = item.trim();
          if (trimmed && !urls.includes(trimmed)) {
            urls.push(trimmed);
          }
        }
      }
    }
  }

  // Also collect load-css() directives (with masking to ignore commented ones)
  const mask = maskStylesheet(body);
  for (const call of mask.matchAll(/load-css\(\s*(['"])([^'"]*)\1/dg)) {
    const [from, to] = call.indices[2];
    urls.push(body.slice(from, to));
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
  for (const [name, text, opts, expected] of SASS_LOADED_URL_CONTROLS) {
    const got = sassLoadedUrls(text, opts);
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(
        `sassLoadedUrls, ${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`,
      );
    }
  }
  return failures;
}

export const CONTROL_COUNT = {
  mask: MASK_CONTROLS.length,
  negative: SPECIFIER_CONTROLS.filter((c) => c[3].length === 0).length,
  positive: SPECIFIER_CONTROLS.filter((c) => c[3].length > 0).length,
  sassLoadedUrls: SASS_LOADED_URL_CONTROLS.length,
};
