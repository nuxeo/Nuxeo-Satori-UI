#!/usr/bin/env node
/**
 * Controls for `crowdin-sources.mjs`, against the real `crowdin-conf.yml` and push workflow.
 *
 * The claim is that the config holds the sources this repository needs translated: the app's
 * catalogue and every kit's `labels/en.json`, each once, each language written back where the app
 * reads it — Spanish, Swedish, Danish, Finnish and Norwegian Bokmål among them, Norwegian as `nb`
 * whichever of Crowdin's two Norwegians the project targets — and each source watched by the push.
 *
 * The real files must give no finding, and each config below, broken in one way, must give the
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
const CONFIG = readFileSync(join(ROOT, 'crowdin-conf.yml'), 'utf8');
const PUSH = readFileSync(join(ROOT, '.github', 'workflows', 'crowdin-push.yaml'), 'utf8');
const FILES = repositoryFiles(ROOT);
/** Crowdin language ids: the app's targets, and `no`, the Norwegian a project may target instead of `nb`. */
const LANGUAGES = ['de', 'fr', 'ja', 'nl', 'es', 'sv', 'da', 'fi', 'nb', 'no'];
const KIT_SOURCE = "'/business-apps/packages/*/bundle/agentic-ui-config/labels/en.json'";

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}

const findings = (overrides = {}) =>
  crowdinSourceFindings({ config: CONFIG, pushWorkflow: PUSH, files: FILES, languages: LANGUAGES, ...overrides });

/** Asserts a broken input is reported, by a finding matching `expected`. */
function reports(label, overrides, expected) {
  const found = findings(overrides);
  if (found.some((finding) => expected.test(finding))) passed += 1;
  else failures.push(`${label}\n    expected a finding /${expected.source}/\n    got ${JSON.stringify(found)}`);
}

/** The config with `from` replaced, failing loudly when the edit does not apply. */
function configWith(from, to) {
  if (!CONFIG.includes(from)) throw new Error(`the control's edit does not apply: ${from}`);
  return CONFIG.replace(from, to);
}

// ── The real files: the positive half ──
const kits = FILES.filter((file) =>
  /^business-apps\/packages\/[^/]+\/bundle\/agentic-ui-config\/labels\/en\.json$/.test(file),
);
// Not vacuous: there are kits to hold, and the app's catalogue is among the files.
check('the repository has kits whose labels the config must hold', kits.length > 0, true);
check("the repository has the app's catalogue", FILES.includes(APP_CATALOGUE), true);
check('the real config and push workflow give no finding', findings(), []);

const read = readCrowdinFiles(CONFIG);
check('the real config reads as entries', 'entries' in read, true);
const kitEntry = read.entries?.find((entry) => entry.source === KIT_SOURCE.slice(1, -1));
check('the kits are a source of their own', kitEntry !== undefined, true);
if (kitEntry) {
  const payers = 'business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/labels/en.json';
  // Read the other way round too, so the assertion is not only "the function agrees with itself".
  check(
    'a kit in Spanish lands beside its English',
    translationPath(kitEntry, payers, 'es'),
    'business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/labels/es.json',
  );
  check(
    "a kit in Crowdin's 'Norwegian' lands as nb.json",
    translationPath(kitEntry, payers, 'no'),
    'business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/labels/nb.json',
  );
}
const appEntry = read.entries?.find((entry) => entry.source === '/apps/*/public/i18n/en.json');
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

// ── The negative half: each config broken in one way ──
const kitEntryText = /\n\s*\{\s*\n\s*'source': '\/business-apps[\s\S]*?\n\s*\},/.exec(
  CONFIG.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n'),
)?.[0];
if (!kitEntryText) throw new Error("the control cannot find the kits' entry to remove");
reports(
  "the kits' source removed",
  {
    config: CONFIG.split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n')
      .replace(kitEntryText, ''),
  },
  /payers-claims-demo\/bundle\/agentic-ui-config\/labels\/en\.json is matched by no source/,
);
reports(
  "the kits' source narrowed to one kit, leaving the others out",
  { config: configWith(KIT_SOURCE, "'/business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/labels/en.json'") },
  /moves-demo\/bundle\/agentic-ui-config\/labels\/en\.json is matched by no source/,
);
reports(
  'the kits matched twice, by a second pattern',
  {
    config: configWith(
      "'files': [",
      "'files': [\n    { 'source': '/business-apps/**/labels/en.json', 'translation': '/%original_path%/%two_letters_code%.%file_extension%', 'export_only_approved': 'true' },",
    ),
  },
  /is matched by 2 sources in crowdin-conf\.yml, so it is uploaded twice/,
);
// The Norwegian trap: without the mapping, a project targeting "Norwegian" downloads `no.json`.
const KIT_MAPPING = `      'languages_mapping': { 'two_letters_code': { 'no': 'nb' } },\n    },\n  ]`;
reports(
  "the kits' Norwegian mapping removed",
  { config: configWith(KIT_MAPPING, '    },\n  ]') },
  /labels\/en\.json in no to business-apps\/packages\/[^/]+\/bundle\/agentic-ui-config\/labels\/no\.json, and the app reads it at .*labels\/nb\.json/,
);
reports(
  "the app's Norwegian mapping removed",
  {
    config: configWith(
      `      'languages_mapping': { 'two_letters_code': { 'no': 'nb' } },\n    },\n    #`,
      '    },\n    #',
    ),
  },
  /apps\/nuxeo-ui\/public\/i18n\/en\.json in no to apps\/nuxeo-ui\/public\/i18n\/no\.json/,
);
reports(
  "the kits' translations written by locale, which the app never asks for",
  {
    config: configWith(
      `${KIT_SOURCE},\n      'translation': '/%original_path%/%two_letters_code%.%file_extension%'`,
      `${KIT_SOURCE},\n      'translation': '/%original_path%/%locale%.%file_extension%'`,
    ),
  },
  /labels\/en\.json in es to a path this cannot render/,
);
reports(
  "the kits' translations written into a folder per language",
  {
    config: configWith(
      `${KIT_SOURCE},\n      'translation': '/%original_path%/%two_letters_code%.%file_extension%'`,
      `${KIT_SOURCE},\n      'translation': '/%original_path%/%two_letters_code%/en.json'`,
    ),
  },
  /labels\/en\.json in sv to .*labels\/sv\/en\.json, and the app reads it at .*labels\/sv\.json/,
);
reports(
  "the kits' source exporting unapproved work",
  {
    config: configWith(
      `${KIT_SOURCE},\n      'translation': '/%original_path%/%two_letters_code%.%file_extension%',\n      'export_only_approved': 'true'`,
      `${KIT_SOURCE},\n      'translation': '/%original_path%/%two_letters_code%.%file_extension%',\n      'export_only_approved': 'false'`,
    ),
  },
  /The source \/business-apps\/packages\/\*\/bundle\/agentic-ui-config\/labels\/en\.json does not export approved translations only/,
);
reports(
  'the push workflow not watching the kits',
  {
    pushWorkflow: PUSH.replace(
      "      - 'business-apps/packages/*/bundle/agentic-ui-config/labels/en.json'\n",
      '',
    ),
  },
  /crowdin-push\.yaml watches no path matching business-apps\/packages\/payers-claims-demo/,
);
reports(
  'a config in a shape this does not read',
  { config: "'files':\n  - 'source': '/apps/*/public/i18n/en.json'\n" },
  /crowdin-conf\.yml cannot be read: it has no `files: \[ … \]` flow sequence/,
);
// A kit added to the repository is held too, with nothing to change here.
reports(
  'a kit outside the pattern, under another folder name',
  {
    files: [...FILES, 'business-apps/packages/new-demo/bundle/agentic-ui-config/labels/en.json'],
    config: configWith(KIT_SOURCE, "'/business-apps/packages/*-claims-demo/bundle/agentic-ui-config/labels/en.json'"),
  },
  /new-demo\/bundle\/agentic-ui-config\/labels\/en\.json is matched by no source/,
);

console.log(`crowdin-sources selftest: ${passed + failures.length} controls.`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
console.log('All controls behaved as required.');
