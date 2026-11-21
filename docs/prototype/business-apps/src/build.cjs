// Builds ../index.html from head.html, the scripts listed in SCRIPTS and tail.html, inlining the
// compiled Satori theme CSS and only the Satori icons the prototype uses. From the repo root:
//   node docs/prototype/business-apps/src/build.cjs
// Needs node_modules with sass, @hylandsoftware/satori-ui and @hylandsoftware/satori-icons. Point
// NODE_MODULES_ROOT at a checkout that has them if this one does not.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const here = __dirname;
const root = process.env.NODE_MODULES_ROOT || path.resolve(here, '../../../..');
const nm = path.join(root, 'node_modules');
const SCRIPTS = [
  'data.js',
  'data-dam.js',
  'core.js',
  'pages-work.js',
  'pages-records.js',
  'pages-more.js',
  'pages-dam.js',
  'pages-build.js',
  'pages-build2.js',
  'pages-start.js',
  'events.js',
];

const css = execFileSync(
  process.execPath,
  [path.join(nm, 'sass/sass.js'), '--load-path=' + nm, '--quiet', '--no-source-map', path.join(here, 'theme.scss')],
  { encoding: 'utf8' },
  // The theme's @font-face rules point at woff2/ files relative to the page, which a single-file
  // prototype does not have. head.html loads the same two families from Google Fonts instead.
).replace(/@font-face\s*\{[^}]*url\("woff2\/[^}]*\}\s*/g, '');
const icons = fs.readFileSync(path.join(nm, '@hylandsoftware/satori-icons/index.mjs'), 'utf8');
const script = SCRIPTS.map((f) => `// ---- ${f}\n` + fs.readFileSync(path.join(here, f), 'utf8')).join('\n');
const head = fs.readFileSync(path.join(here, 'head.html'), 'utf8');

const ids = new Set([...icons.matchAll(/<svg id="([a-z0-9_]+)"/g)].map((m) => m[1]));
// Icon names reach ic() through literals, data fields and arrays, so every quoted token that names a
// Satori icon is included, plus #i- references in the markup. Names in the places that can only be
// icons (ic('x') and icon: 'x') must exist, so a misspelling fails the build instead of drawing nothing.
const explicit = [
  ...[...script.matchAll(/\bic\('([a-z0-9_]+)'/g)].map((m) => m[1]),
  ...[...script.matchAll(/\bicon:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]),
  ...[...head.matchAll(/#i-([a-z0-9_]+)/g)].map((m) => m[1]),
];
const quoted = [...script.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).filter((n) => ids.has(n));
const used = [...new Set([...explicit.filter((n) => ids.has(n)), ...quoted])];
const missing = [...new Set(explicit.filter((n) => !ids.has(n)))];
if (missing.length) {
  console.error('Missing Satori icons:', missing.join(', '));
  process.exit(1);
}
let syms = '';
for (const n of used) {
  const m = icons.match(new RegExp('<svg id="' + n + '"([^>]*)>([\\s\\S]*?)</svg>'));
  const vb = (m[1].match(/viewBox="([^"]+)"/) || [])[1] || '0 0 24 24';
  syms += `<symbol id="i-${n}" viewBox="${vb}">${m[2]}</symbol>`;
}
const out =
  head
    .replace('/*THEME_CSS*/', () => css)
    .replace('<!--ICONS-->', () => `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${syms}</svg>`) +
  '<script>\n' +
  script +
  '</script>' +
  fs.readFileSync(path.join(here, 'tail.html'), 'utf8');
fs.writeFileSync(path.join(here, '../index.html'), out);
console.log('wrote index.html,', used.length, 'icons,', out.length, 'bytes');
