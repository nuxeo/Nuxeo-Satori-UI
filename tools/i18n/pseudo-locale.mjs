#!/usr/bin/env node
/**
 * Generate the `zz` pseudo-locale from `en.json`.
 *
 * This is the only check that can find what the extraction MISSED. Every other check looks at
 * strings that were extracted and confirms they behave; none of them can see a hard-coded
 * string, because a hard-coded string is invisible to a catalogue. Under `zz` every translated
 * string renders accented and bracketed, so anything still reading as plain English on screen
 * is text no catalogue supplies — a residue, in the one place it matters, which is the rendered
 * page rather than a regex over source.
 *
 * The three transforms each answer a different failure:
 *
 * - **Accents** (`Ëðïţ` for `Edit`) mark the string as catalogue-sourced.
 * - **Brackets** (`⟦…⟧`) show where one string ends and the next begins, which is how a
 *   concatenation shows itself: `⟦Showing⟧ 12 ⟦results⟧` is three fragments a translator cannot
 *   reorder, and INFO-144 forbids it. A single `⟦Showing 12 results⟧` is correct.
 * - **Padding** to ~130% of the original length reproduces the expansion German and Finnish
 *   cause, so a layout that will clip in a real locale clips here instead of in front of a
 *   customer.
 *
 * `zz` is generated, never hand-edited, and never shipped: it is absent from
 * `availableLanguages`, so it is reachable only by a deliberate Layer 0 override.
 *
 * Interpolation placeholders (`{{ count }}`) and ICU braces pass through untouched — accenting
 * a placeholder name would break the substitution and report a fault that does not exist.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const I18N = join(dirname(fileURLToPath(import.meta.url)), '../../apps/nuxeo-ui/public/i18n');

const ACCENTS = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'ë',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'ï',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  q: ' q',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ü',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'Ë',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Ï',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ö',
  P: 'Þ',
  Q: 'Q',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ü',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/** Split on `{{ … }}` and `{ … }` so placeholders survive verbatim. */
const PLACEHOLDER = /(\{\{[^}]*\}\}|\{[^}]*\})/g;

function pseudo(text) {
  const accented = text
    .split(PLACEHOLDER)
    .map((part, index) => (index % 2 === 1 ? part : [...part].map((c) => ACCENTS[c] ?? c).join('')))
    .join('');
  const visible = text.replace(PLACEHOLDER, '').length;
  const padding = '·'.repeat(Math.max(0, Math.round(visible * 0.3)));
  return `⟦${accented}${padding}⟧`;
}

const walk = (node) =>
  Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      typeof value === 'string' ? pseudo(value) : walk(value),
    ]),
  );

const count = (node) =>
  Object.values(node).reduce((total, v) => total + (typeof v === 'string' ? 1 : count(v)), 0);

const en = JSON.parse(readFileSync(join(I18N, 'en.json'), 'utf8'));
writeFileSync(join(I18N, 'zz.json'), `${JSON.stringify(walk(en), null, 2)}\n`);
console.log(`apps/nuxeo-ui/public/i18n/zz.json — ${count(en)} keys`);

/**
 * The upstream catalogues get a `zz` too, written into `node_modules` where the build reads
 * assets from.
 *
 * Without this the audit reports every upstream string as a miss, because upstream ships only en,
 * fr and de and falls back to English for anything else. That was 22 of a 42-string report — more
 * than half of what was left, none of it ours and none of it actionable, which is how a number
 * stops being read. `node_modules` is disposable and this writes only the extra locale, so a
 * reinstall undoes it.
 */
const UPSTREAM = [
  'node_modules/@alfresco/adf-hx-content-services/ui/assets/adf-enterprise-adf-hx-content-services-ui/i18n',
  'node_modules/@alfresco/adf-hx-content-services/services/assets/adf-enterprise-adf-hx-content-services-services/i18n',
  'node_modules/@hylandsoftware/satori-ui/i18n',
];
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
for (const dir of UPSTREAM) {
  const source = join(REPO, dir, 'en.json');
  if (!existsSync(source)) {
    console.log(`  skipped (absent): ${dir}`);
    continue;
  }
  const catalogue = JSON.parse(readFileSync(source, 'utf8'));
  writeFileSync(join(REPO, dir, 'zz.json'), `${JSON.stringify(walk(catalogue), null, 2)}\n`);
  console.log(`  ${dir.split('/assets/')[1] ?? dir} — ${count(catalogue)} keys`);
}
