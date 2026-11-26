#!/usr/bin/env node
/**
 * Controls for `coverage.mjs`, the repository half of the Crowdin Status report.
 *
 * A report cannot fail anyone, so what can go wrong is a reader believing a wrong number: a
 * language with no file read as covered, a file of English text read as translated, a blank text
 * counted as one, or the app's nested keys counted differently from how the app reads them. Each
 * is asserted on a small repository written for the purpose, and the real one is measured too, so
 * that the report covers the languages it must and cannot pass by measuring nothing.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { formatCoverage, measureCoverage, registeredLocales } from './coverage.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
let passed = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}

function says(label, text, expected) {
  if (expected.test(text)) passed += 1;
  else failures.push(`${label}\n    expected /${expected.source}/\n    in ${text}`);
}

const fixture = mkdtempSync(join(tmpdir(), 'i18n-coverage-'));
const write = (path, body) => {
  mkdirSync(dirname(join(fixture, path)), { recursive: true });
  writeFileSync(join(fixture, path), typeof body === 'string' ? body : JSON.stringify(body));
};
const labels = (texts) => ({ $schema: '../labels.schema.json', version: 2, labels: texts });

try {
  write(
    'apps/nuxeo-ui/src/app/i18n/register-locale-data.ts',
    "const LOCALE_DATA = [\n  ['es', localeEs],\n  ['fi', localeFi],\n  ['nb', localeNb],\n];\n",
  );
  // Nested, as the app's catalogue is: `a.b`, `a.c` and `d`.
  write('apps/nuxeo-ui/public/i18n/en.json', { a: { b: 'Bee', c: 'Sea' }, d: 'Dee' });
  write('apps/nuxeo-ui/public/i18n/en.context.json', { a: { b: 'context, not a language' } });
  // Spanish: one key translated, one written in English, one missing.
  write('apps/nuxeo-ui/public/i18n/es.json', { a: { b: 'Abeja' }, d: 'Dee' });
  // Norwegian: a blank text is not a text, and an unknown key is extra.
  write('apps/nuxeo-ui/public/i18n/nb.json', { a: { b: ' ', c: 'Sjø' }, z: 'Ekstra' });
  write('apps/nuxeo-ui/public/i18n/zz.json', { a: { b: '⟦Bee⟧' } });
  write('apps/nuxeo-ui/public/i18n/sv.json', '{ not json');
  // A kit with a language, a kit with none, and a folder that is no kit.
  const many = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`acme.k${i}`, `K${i}`]));
  write('business-apps/packages/acme-demo/bundle/agentic-ui-config/labels/en.json', labels(many));
  write(
    'business-apps/packages/acme-demo/bundle/agentic-ui-config/labels/fi.json',
    labels({ 'acme.k0': 'Avain', 'acme.extra': 'Ylimääräinen' }),
  );
  write(
    'business-apps/packages/plain-demo/bundle/agentic-ui-config/labels/en.json',
    labels({ 'plain.title': 'Plain' }),
  );
  write('business-apps/packages/not-a-kit/README.md', '# no labels');

  check('the languages are read from register-locale-data.ts', registeredLocales(fixture), [
    'es',
    'fi',
    'nb',
  ]);
  const result = measureCoverage(fixture);
  const app = Object.fromEntries(result.app.languages.map((l) => [l.locale, l]));
  check(
    'the app is reported in each registered language and each it has a file for, not zz',
    Object.keys(app),
    ['es', 'fi', 'nb', 'sv'],
  );
  check('English is counted as the app reads it, nested keys joined', result.app.english, 3);
  check('a key in English text counts as present, and as English', app.es.coverage, {
    total: 3,
    present: 2,
    asEnglish: 1,
    missing: ['a.c'],
    extra: [],
  });
  check('a blank text is missing, and a key English lacks is extra', app.nb.coverage, {
    total: 3,
    present: 1,
    asEnglish: 0,
    missing: ['a.b', 'd'],
    extra: ['z'],
  });
  check('a language with no file has no coverage, rather than none counted as some', app.fi.coverage, null);
  check('a file that is not JSON is said, not counted', app.sv.unreadable, true);

  check(
    'only folders with a labels/en.json are kits',
    result.kits.map((kit) => kit.name),
    ['acme-demo', 'plain-demo'],
  );
  const fi = result.kits[0].languages.find((l) => l.locale === 'fi');
  check('a kit language is held to its own English', [fi.coverage.present, fi.coverage.total], [1, 14]);
  check('and a key its English lacks is extra', fi.coverage.extra, ['acme.extra']);

  const text = formatCoverage(result);
  says('a percentage and the counts are printed', text, /es\s+2\/3\s+66\.7%\s+1 missing\s+1 as English/);
  says('the missing keys are named', text, /es[^\n]*\n\s+- a\.c/);
  says('a language with no file says so', text, /fi\s+no file: every key is English/);
  says('a file that is not JSON says so', text, /sv\s+the file is not JSON, so it is not read/);
  says('an extra key is named', text, /nb[^\n]*1 extra: z/);
  says('a kit with no file in a language says so, in one line', text, /plain-demo \(en: 1 keys\)\n\s+no file in es, fi, nb: every key is English/);
  says('ten missing keys are listed, then a count', text, /- acme\.k10\n\s+… and 3 more \(--missing lists every one\)/);
  says('every missing key is listed when asked', formatCoverage(result, { missing: true }), /- acme\.k13/);

  const bare = mkdtempSync(join(tmpdir(), 'i18n-coverage-bare-'));
  try {
    const empty = measureCoverage(bare, { locales: ['es'] });
    check('a repository with nothing in it reports no kit', empty.kits, []);
    says('and says so', formatCoverage(empty), /no kit has a labels\/en\.json/);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

// The real repository: the five languages of phase 7, in the app and in every kit.
const real = measureCoverage(ROOT);
const PHASE_7 = ['es', 'sv', 'da', 'nb', 'fi'];
check('the real app has English to measure against', real.app.english > 0, true);
check('the real repository has kits to measure', real.kits.length > 0, true);
check(
  'the app is reported in Spanish, Swedish, Danish, Norwegian Bokmål and Finnish',
  PHASE_7.filter((locale) => !real.app.languages.some((l) => l.locale === locale)),
  [],
);
check(
  'and so is every kit',
  real.kits.flatMap((kit) =>
    PHASE_7.filter((locale) => !kit.languages.some((l) => l.locale === locale)).map(
      (locale) => `${kit.name}:${locale}`,
    ),
  ),
  [],
);

// A report, not a gate: it exits 0 on the real repository whatever it finds, and 2 on a bad argument.
const run = (args) =>
  spawnSync(process.execPath, [join(ROOT, 'tools', 'i18n', 'coverage.mjs'), ...args], {
    encoding: 'utf8',
  }).status;
check('it exits 0, whatever the coverage', run([]), 0);
check('it exits 2 on an argument it does not know', run(['--strict']), 2);

console.log(`coverage selftest: ${passed + failures.length} controls.`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
console.log('All controls behaved as required.');
