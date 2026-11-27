#!/usr/bin/env node
/**
 * Controls for `crowdin-sources.mjs`, against the real Crowdin configs and workflows.
 *
 * The claim is that Crowdin holds the sources this repository needs translated: the app's catalogue
 * in `crowdin-conf.yml` and every kit's `labels/en.json` in `crowdin-kits.yml`, each once, neither
 * config reaching the other's files, each language written back where the app reads it — Spanish,
 * Swedish, Danish, Finnish and Norwegian Bokmål among them, Norwegian as `nb` whichever of Crowdin's
 * two Norwegians the project targets — each source watched and uploaded by the push, and the kits
 * downloaded into a pull request of their own, so that a kit's file never holds the app's red.
 *
 * The real files must give no finding, and each input below, broken in one way, must give the
 * finding for that way: without the negative half a check that found nothing would pass the same.
 * No network, no credential, and nothing written.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  APP_CATALOGUE,
  crowdinSourceFindings,
  readCrowdinFiles,
  repositoryFiles,
  translationPath,
} from './crowdin-sources.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (...path) => readFileSync(join(ROOT, ...path), 'utf8');
const REAL = {
  appConfig: read('crowdin-conf.yml'),
  kitsConfig: read('crowdin-kits.yml'),
  pushWorkflow: read('.github', 'workflows', 'crowdin-push.yaml'),
  appPullWorkflow: read('.github', 'workflows', 'crowdin-pull.yaml'),
  kitsPullWorkflow: read('.github', 'workflows', 'crowdin-pull-kits.yaml'),
  files: repositoryFiles(ROOT),
  /** Crowdin language ids: the app's targets, and `no`, the Norwegian a project may target instead of `nb`. */
  languages: ['de', 'fr', 'ja', 'nl', 'es', 'sv', 'da', 'fi', 'nb', 'no'],
};
const KIT_SOURCE = "'/business-apps/packages/*/bundle/agentic-ui-config/labels/en.json'";
const PAYERS = 'business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/labels/en.json';

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}

const findings = (overrides = {}) => crowdinSourceFindings({ ...REAL, ...overrides });

/** Asserts a broken input is reported, by a finding matching `expected`. */
function reports(label, overrides, expected) {
  const found = findings(overrides);
  if (found.some((finding) => expected.test(finding))) passed += 1;
  else
    failures.push(
      `${label}\n    expected a finding /${expected.source}/\n    got ${JSON.stringify(found)}`,
    );
}

/** `text` with `from` replaced, failing loudly when the edit does not apply. */
function edited(text, from, to) {
  if (!text.includes(from)) throw new Error(`the control's edit does not apply: ${from}`);
  return text.replace(from, to);
}

// ── The real files: the positive half ──
const kits = REAL.files.filter((file) =>
  /^business-apps\/packages\/[^/]+\/bundle\/agentic-ui-config\/labels\/en\.json$/.test(file),
);
// Not vacuous: there are kits to hold, and the app's catalogue is among the files.
check('the repository has kits whose labels the config must hold', kits.length > 0, true);
check("the repository has the app's catalogue", REAL.files.includes(APP_CATALOGUE), true);
check('the real configs and workflows give no finding', findings(), []);

const kitEntry = readCrowdinFiles(REAL.kitsConfig).entries?.find(
  (entry) => entry.source === KIT_SOURCE.slice(1, -1),
);
check('the kits are the source of crowdin-kits.yml', kitEntry !== undefined, true);
if (kitEntry) {
  // Read the other way round too, so the assertion is not only "the function agrees with itself".
  check(
    'a kit in Spanish lands beside its English',
    translationPath(kitEntry, PAYERS, 'es'),
    'business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/labels/es.json',
  );
  check(
    "a kit in Crowdin's 'Norwegian' lands as nb.json",
    translationPath(kitEntry, PAYERS, 'no'),
    'business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/labels/nb.json',
  );
}
const appEntry = readCrowdinFiles(REAL.appConfig).entries?.find(
  (entry) => entry.source === '/apps/*/public/i18n/en.json',
);
check(
  "the app in Crowdin's 'Norwegian Bokmal' lands as nb.json",
  appEntry && translationPath(appEntry, APP_CATALOGUE, 'nb'),
  'apps/nuxeo-ui/public/i18n/nb.json',
);
check(
  'the app in Finnish lands as fi.json',
  appEntry && translationPath(appEntry, APP_CATALOGUE, 'fi'),
  'apps/nuxeo-ui/public/i18n/fi.json',
);

// ── The negative half: each input broken in one way ──
const KIT_ENTRY_IN_APP =
  `    {\n      'source': ${KIT_SOURCE},\n` +
  "      'translation': '/%original_path%/%two_letters_code%.%file_extension%',\n" +
  "      'export_only_approved': 'true',\n" +
  "      'languages_mapping': { 'two_letters_code': { 'no': 'nb' } },\n    },\n  ]";
// The defect this split exists for: the kits in the app's config ride in the app's one pull request.
reports(
  "the kits' labels in the app's config too",
  { appConfig: edited(REAL.appConfig, '    },\n  ]', `    },\n${KIT_ENTRY_IN_APP}`) },
  /payers-claims-demo\/bundle\/agentic-ui-config\/labels\/en\.json is matched by a source in crowdin-conf\.yml, so the app's pull request would carry it/,
);
reports(
  "the kits' source narrowed to one kit, leaving the others out",
  {
    kitsConfig: edited(
      REAL.kitsConfig,
      KIT_SOURCE,
      "'/business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/labels/en.json'",
    ),
  },
  /moves-demo\/bundle\/agentic-ui-config\/labels\/en\.json is matched by no source in crowdin-kits\.yml/,
);
reports(
  'the kits matched twice, by a second pattern',
  {
    kitsConfig: edited(
      REAL.kitsConfig,
      "'files': [",
      "'files': [\n    { 'source': '/business-apps/**/labels/en.json', 'translation': '/%original_path%/%two_letters_code%.%file_extension%', 'export_only_approved': 'true' },",
    ),
  },
  /is matched by 2 sources in crowdin-kits\.yml, so it is uploaded twice/,
);
// The Norwegian trap: without the mapping, a project targeting "Norwegian" downloads `no.json`.
const MAPPING = "      'languages_mapping': { 'two_letters_code': { 'no': 'nb' } },\n";
reports(
  "the kits' Norwegian mapping removed",
  { kitsConfig: edited(REAL.kitsConfig, MAPPING, '') },
  /labels\/en\.json in no to business-apps\/packages\/[^/]+\/bundle\/agentic-ui-config\/labels\/no\.json, and the app reads it at .*labels\/nb\.json/,
);
reports(
  "the app's Norwegian mapping removed",
  { appConfig: edited(REAL.appConfig, MAPPING, '') },
  /apps\/nuxeo-ui\/public\/i18n\/en\.json in no to apps\/nuxeo-ui\/public\/i18n\/no\.json/,
);
const TRANSLATION = "'translation': '/%original_path%/%two_letters_code%.%file_extension%'";
reports(
  "the kits' translations written by locale, which the app never asks for",
  {
    kitsConfig: edited(
      REAL.kitsConfig,
      TRANSLATION,
      "'translation': '/%original_path%/%locale%.%file_extension%'",
    ),
  },
  /labels\/en\.json in es to a path this cannot render/,
);
reports(
  "the kits' translations written into a folder per language",
  {
    kitsConfig: edited(
      REAL.kitsConfig,
      TRANSLATION,
      "'translation': '/%original_path%/%two_letters_code%/en.json'",
    ),
  },
  /labels\/en\.json in sv to .*labels\/sv\/en\.json, and the app reads it at .*labels\/sv\.json/,
);
reports(
  "the kits' source exporting unapproved work",
  {
    kitsConfig: edited(
      REAL.kitsConfig,
      "'export_only_approved': 'true'",
      "'export_only_approved': 'false'",
    ),
  },
  /The source \/business-apps\/packages\/\*\/bundle\/agentic-ui-config\/labels\/en\.json does not export approved translations only/,
);
reports(
  'the push workflow not watching the kits',
  {
    pushWorkflow: edited(
      REAL.pushWorkflow,
      "      - 'business-apps/packages/*/bundle/agentic-ui-config/labels/en.json'\n",
      '',
    ),
  },
  /crowdin-push\.yaml watches no path matching business-apps\/packages\/payers-claims-demo/,
);
reports(
  "the push workflow not uploading the kits' config",
  {
    pushWorkflow: edited(REAL.pushWorkflow, 'config: crowdin-kits.yml', 'config: crowdin-conf.yml'),
  },
  /crowdin-push\.yaml uploads no source from crowdin-kits\.yml/,
);
reports(
  "the kits' pull reading the app's config",
  {
    kitsPullWorkflow: edited(
      REAL.kitsPullWorkflow,
      'config: crowdin-kits.yml',
      'config: crowdin-conf.yml',
    ),
  },
  /crowdin-pull-kits\.yaml downloads no translation from crowdin-kits\.yml/,
);
reports(
  "the kits' pull writing the app's branch, and so its pull request",
  {
    kitsPullWorkflow: edited(
      REAL.kitsPullWorkflow,
      'localization_branch_name: crowdin-kit-labels-update',
      'localization_branch_name: crowdin-translations-update',
    ),
  },
  /The two pulls write one branch, crowdin-translations-update/,
);
reports(
  "the kits' pull without its own switch",
  {
    kitsPullWorkflow: edited(
      REAL.kitsPullWorkflow,
      " && vars.CROWDIN_KIT_LABELS_ENABLED == 'true'",
      '',
    ),
  },
  /crowdin-pull-kits\.yaml runs without `vars\.CROWDIN_KIT_LABELS_ENABLED == 'true'`/,
);
reports(
  'a config in a shape this does not read',
  { kitsConfig: "'files':\n  - 'source': '/business-apps/packages/*/labels/en.json'\n" },
  /crowdin-kits\.yml cannot be read: it has no `files: \[ … \]` flow sequence/,
);
// A kit added to the repository is held too, with nothing to change here.
reports(
  'a kit outside the pattern, under another folder name',
  {
    files: [
      ...REAL.files,
      'business-apps/packages/new-demo/bundle/agentic-ui-config/labels/en.json',
    ],
    kitsConfig: edited(
      REAL.kitsConfig,
      KIT_SOURCE,
      "'/business-apps/packages/*-claims-demo/bundle/agentic-ui-config/labels/en.json'",
    ),
  },
  /new-demo\/bundle\/agentic-ui-config\/labels\/en\.json is matched by no source in crowdin-kits\.yml/,
);

console.log(`crowdin-sources selftest: ${passed + failures.length} controls.`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
console.log('All controls behaved as required.');
