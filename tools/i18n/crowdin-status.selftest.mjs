/**
 * Controls for `crowdin-status.mjs`'s report body.
 *
 * Only `formatProgress` is covered, and that is the whole risk surface worth covering. The rest of
 * the script is `fetch` against a tenant, which cannot be asserted here and is already proved or
 * disproved by the job going green.
 *
 * What CAN go wrong without any request failing is a reader drawing the wrong conclusion from a
 * correct number — specifically taking a language at 100% translated as a language that will
 * appear in the application. It will not: `export_only_approved: 'true'` means an unapproved
 * translation is never exported. That single misreading is what these controls exist for.
 */
import { resolve } from 'node:path';

import { formatProgress, formatReport } from './crowdin-status.mjs';

const failures = [];
let passed = 0;

/** Asserts the report says something, by pattern, and says it for the stated reason. */
function says(label, rows, expected) {
  const actual = formatProgress(rows);
  if (expected.test(actual)) {
    passed += 1;
    return;
  }
  failures.push(`${label}\n      expected /${expected.source}/\n      got: ${actual}`);
}

/** Asserts the report does NOT say something — the near-miss half. */
function doesNotSay(label, rows, forbidden) {
  const actual = formatProgress(rows);
  if (!forbidden.test(actual)) {
    passed += 1;
    return;
  }
  failures.push(`${label}\n      must NOT match /${forbidden.source}/\n      got: ${actual}`);
}

const row = (languageId, approvalProgress, translationProgress = approvalProgress) => ({
  languageId,
  approvalProgress,
  translationProgress,
});

const NINE_AT_ZERO = ['de', 'es', 'fr', 'ja', 'nl', 'pl', 'pt', 'th', 'zh'].map((id) => row(id, 0));

says(
  'an empty target-language list is not reported as a healthy project',
  [],
  /No target languages\. Nothing can be translated\./,
);

says(
  'nine languages at zero say so explicitly, and say a pull would bring back nothing',
  NINE_AT_ZERO,
  /NONE of the 9 target languages has an approved translation.*bring back nothing/s,
);

doesNotSay(
  'a project at zero never reports anything as exportable',
  NINE_AT_ZERO,
  /have approved translations to export/,
);

// The trap this file exists for. 100% translated with 0% approved exports NOTHING, so a report
// that counted the translated column would promise a working locale and be wrong about every
// string in it.
says(
  'fully translated but unapproved is reported as having nothing to export',
  [row('fr', 0, 100), row('de', 0, 100)],
  /NONE of the 2 target languages has an approved translation/,
);

doesNotSay(
  'fully translated but unapproved is not counted as exportable',
  [row('fr', 0, 100), row('de', 0, 100)],
  /2 of 2 language\(s\) have approved/,
);

says(
  'approved work is named, and counted against the total rather than against itself',
  [row('fr', 64, 90), row('de', 12, 40), row('ja', 0, 0)],
  /2 of 3 language\(s\) have approved translations to export: fr, de\./,
);

says(
  'the most approved language is listed first, so the useful row is not buried',
  [row('ja', 0), row('fr', 64), row('de', 12)],
  /fr\s+approved\s+64%[\s\S]*de\s+approved\s+12%[\s\S]*ja\s+approved\s+0%/,
);

says(
  'both columns are shown, with approved before translated',
  [row('fr', 12, 90)],
  /fr\s+approved\s+12%\s+translated\s+90%/,
);

// The whole report carries the repository's coverage under Crowdin's progress, so that what is
// approved there and what has reached the repository are read together. Asserted on the real
// checkout, whose kits and languages `coverage.selftest.mjs` holds.
{
  const report = formatReport({
    projectId: '160',
    project: { name: 'Nuxeo Satori', sourceLanguageId: 'en' },
    rows: [row('es', 99), row('nb', 0)],
    sourceFiles: ['/apps/nuxeo-ui/public/i18n/en.json'],
    root: resolve(import.meta.dirname, '..', '..'),
  });
  const crowdinAt = report.search(/es\s+approved\s+99%/);
  const repositoryAt = report.indexOf('Translation coverage in this repository');
  if (crowdinAt !== -1 && repositoryAt > crowdinAt) passed += 1;
  else
    failures.push(
      `the report holds Crowdin's progress, then the repository's coverage\n      got: ${report}`,
    );
  if (/Kits — business-apps\/packages\/<kit>\/bundle\/agentic-ui-config\/labels/.test(report))
    passed += 1;
  else failures.push(`the report's repository half covers the kits\n      got: ${report}`);
}

console.log(`crowdin-status selftest: ${passed + failures.length} controls.`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
console.log('All controls behaved as required.');
