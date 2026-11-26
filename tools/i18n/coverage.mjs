#!/usr/bin/env node
/**
 * How much of each language this repository holds: the app's catalogue and every kit's labels,
 * against their English, with the keys each language is missing.
 *
 *   npm run i18n:coverage [-- --missing] [-- --json]
 *
 * A report, never a gate: it exits 0 whatever it finds, and 2 only for an argument it does not
 * know. It is also the "repository" half of the Crowdin Status report (`crowdin-status.mjs`), so
 * what Crowdin has approved and what has reached the repository are read side by side.
 *
 * ## What each column means
 *
 * - **keys**: the English keys the language gives a text, out of English's. A key it does not give
 *   falls back to English, key by key — in the app through ngx-translate's fallback language, and
 *   for a kit on the server too (`AppLabels` in nuxeo-agentic-core) — so a missing key is English
 *   on screen, never a raw key.
 * - **as English**: of those, the keys whose text is English's, letter for letter. Crowdin's
 *   approved-only export writes the English source for every string not yet approved, so a file
 *   can hold every key and still be English throughout; a word can also be the same in both
 *   languages. Read it as "probably not translated yet", not as a defect.
 * - **extra**: keys English does not have. A kit's file with one is refused by the pipeline.
 *
 * The languages reported are those the app registers Angular locale data for
 * (`register-locale-data.ts`, step 1 of adding a language), and any other that has a file. A
 * language with no file is reported as having none: that is the state of every language between
 * being requested from Crowdin and its first approved export.
 *
 * Only `node:` built-ins, so the Crowdin Status workflow, which runs without an install, can run it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_CATALOGUES = 'apps/nuxeo-ui/public/i18n';
export const KITS = 'business-apps/packages';
const KIT_LABELS = join('bundle', 'agentic-ui-config', 'labels');
const REGISTRATION = 'apps/nuxeo-ui/src/app/i18n/register-locale-data.ts';
/** A catalogue's or labels file's name: a language tag, as the validator and the loader read one. */
const LANGUAGE_FILE = /^([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.json$/;
/** Generated for audits only and never committed (`GENERATED_AUDIT_LOCALES`). */
const GENERATED = new Set(['zz']);
/** Missing keys listed per language unless `--missing` asks for all of them. */
const LISTED = 10;

/** The locales `register-locale-data.ts` registers, read as `checkLocaleDataRegistered` reads them. */
export function registeredLocales(root) {
  const path = join(root, REGISTRATION);
  if (!existsSync(path)) return [];
  return [
    ...readFileSync(path, 'utf8').matchAll(/\[\s*'([a-z]{2,3}(?:-[A-Za-z]{2,4})?)'\s*,\s*locale/g),
  ].map(([, locale]) => locale);
}

/** A catalogue's texts by dotted key, as `AppTranslateLoader` flattens it: string leaves only. */
export function flatten(source, prefix = '', into = new Map()) {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return into;
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') into.set(path, value);
    else flatten(value, path, into);
  }
  return into;
}

/** A kit's labels by key: the `labels` of a version 2 labels file, string texts only. */
function kitLabels(source) {
  const labels = source?.labels;
  const into = new Map();
  if (typeof labels !== 'object' || labels === null || Array.isArray(labels)) return into;
  for (const [key, value] of Object.entries(labels)) if (typeof value === 'string') into.set(key, value);
  return into;
}

/** How much of `english` one language gives, or `null` when it has no file. */
export function compare(english, language) {
  if (language === null) return null;
  const texts = new Map([...language].filter(([, text]) => text.trim() !== ''));
  const keys = [...english.keys()];
  const present = keys.filter((key) => texts.has(key));
  return {
    total: keys.length,
    present: present.length,
    asEnglish: present.filter((key) => texts.get(key) === english.get(key)).length,
    missing: keys.filter((key) => !texts.has(key)),
    extra: [...texts.keys()].filter((key) => !english.has(key)),
  };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
}

/** The languages a directory has a file for, besides English. */
function languagesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .map((name) => LANGUAGE_FILE.exec(name)?.[1])
    .filter((locale) => locale !== undefined && locale !== 'en' && !GENERATED.has(locale));
}

/** One set of files against its English: a language each, in order. */
function measure(directory, read, targets) {
  const english = read(readJson(join(directory, 'en.json')));
  const languages = [...new Set([...targets, ...languagesIn(directory)])].sort();
  return {
    english: english.size,
    languages: languages.map((locale) => {
      const path = join(directory, `${locale}.json`);
      const content = existsSync(path) ? readJson(path) : null;
      return {
        locale,
        unreadable: content === undefined,
        coverage: compare(english, content === null || content === undefined ? null : read(content)),
      };
    }),
  };
}

/**
 * The coverage of every language, for the app and each kit under `root`.
 *
 * @param {string} root the repository
 * @param {{ locales?: readonly string[] }} [options] the languages to report besides those with a
 *   file; by default, those the app registers locale data for
 */
export function measureCoverage(root, { locales } = {}) {
  const targets = (locales ?? registeredLocales(root)).filter((locale) => locale !== 'en');
  const app = { path: APP_CATALOGUES, ...measure(join(root, APP_CATALOGUES), flatten, targets) };
  const kitsRoot = join(root, KITS);
  const kits = existsSync(kitsRoot)
    ? readdirSync(kitsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => existsSync(join(kitsRoot, name, KIT_LABELS, 'en.json')))
        .sort()
        .map((name) => ({
          name,
          path: `${KITS}/${name}/bundle/agentic-ui-config/labels`,
          ...measure(join(kitsRoot, name, KIT_LABELS), kitLabels, targets),
        }))
    : [];
  return { targets, app, kits };
}

function percent(part, whole) {
  return whole === 0 ? '—' : `${((100 * part) / whole).toFixed(1)}%`;
}

function languageLines({ locale, unreadable, coverage }, { missing: all }) {
  if (unreadable) return [`    ${locale.padEnd(5)} the file is not JSON, so it is not read`];
  if (coverage === null) return [`    ${locale.padEnd(5)} no file: every key is English`];
  const { total, present, asEnglish, missing, extra } = coverage;
  const head =
    `    ${locale.padEnd(5)} ${String(present).padStart(5)}/${total} ${percent(present, total).padStart(6)}` +
    `   ${String(missing.length).padStart(5)} missing   ${String(asEnglish).padStart(5)} as English` +
    (extra.length ? `   ${extra.length} extra: ${extra.join(', ')}` : '');
  const listed = all ? missing : missing.slice(0, LISTED);
  const lines = [head, ...listed.map((key) => `            - ${key}`)];
  if (listed.length < missing.length)
    lines.push(`            … and ${missing.length - listed.length} more (--missing lists every one)`);
  return lines;
}

/** The report, as text. `missing: true` lists every missing key rather than the first ten. */
export function formatCoverage(result, { missing = false } = {}) {
  const lines = [
    'Translation coverage in this repository: keys with a text, against English.',
    'A missing key shows in English, key by key. "as English" counts texts equal to English,',
    "which is what Crowdin's approved-only export writes for a string not yet approved.",
    '',
    `The app — ${result.app.path} (en: ${result.app.english} keys)`,
    ...result.app.languages.flatMap((language) => languageLines(language, { missing })),
    '',
    `Kits — ${KITS}/<kit>/bundle/agentic-ui-config/labels`,
  ];
  if (result.kits.length === 0) lines.push('    no kit has a labels/en.json');
  for (const kit of result.kits) {
    lines.push(`  ${kit.name} (en: ${kit.english} keys)`);
    const withFile = kit.languages.filter(({ coverage, unreadable }) => coverage !== null || unreadable);
    const without = kit.languages.filter(({ coverage, unreadable }) => coverage === null && !unreadable);
    lines.push(...withFile.flatMap((language) => languageLines(language, { missing })));
    // One line for the languages a kit has no file in, rather than one line each: before Crowdin's
    // first export that is every language of every kit, and the useful rows would be buried.
    if (without.length)
      lines.push(`    no file in ${without.map(({ locale }) => locale).join(', ')}: every key is English`);
  }
  return lines.join('\n');
}

function main(argv) {
  const unknown = argv.filter((arg) => arg !== '--missing' && arg !== '--json');
  if (unknown.length) {
    console.error(`usage: node tools/i18n/coverage.mjs [--missing] [--json]\nunknown: ${unknown.join(' ')}`);
    return 2;
  }
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const result = measureCoverage(root);
  console.log(
    argv.includes('--json')
      ? JSON.stringify(result, null, 2)
      : formatCoverage(result, { missing: argv.includes('--missing') }),
  );
  return 0;
}

// Importable by `crowdin-status.mjs` and the controls without printing anything.
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
