#!/usr/bin/env node
/**
 * Negative controls for `app-upgrade-check.mjs`, the upgrade check
 * (docs/business-apps/package-pipeline.md, section 10).
 *
 * In CI the check compares packages with the commit before them, which nearly always keeps every
 * configuration, so every run of it is green, and a check only ever seen green is an assertion.
 * Each control here is the demo package, or the platform under it, changed in one way between the
 * version before and the version after, and each must be refused for its own reason, exit 1; the
 * sound ones must be kept, exit 0. They run the check as CI does, as a command.
 *
 * The platform controls give it copies of this repository's platform files, as it was and as it
 * is, through `--previous-platform` and `--root`. The git controls give it a scratch repository,
 * so that `--since` and `--export` are seen reading a commit.
 *
 * Usage: node scripts/app-upgrade-check.selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attribute, withoutCommentsOrInstructions } from './verify-package-zip.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'scripts', 'app-upgrade-check.mjs');
const KIT = 'business-apps/packages/payers-claims-demo';
const DEMO = join(REPO, ...KIT.split('/'));
// The demo's version, read rather than written down, as app-package.selftest.mjs reads it.
const VERSION = attribute(
  withoutCommentsOrInstructions(readFileSync(join(DEMO, 'package', 'package.xml'), 'utf8')),
  'package',
  'version',
);
if (!VERSION) throw new Error("the demo's package.xml names no version");
const PATCH = VERSION.replace(
  /^(\d+\.\d+\.)(\d+).*$/,
  (_, head, patch) => `${head}${Number(patch) + 1}`,
);
const MINOR = VERSION.replace(
  /^(\d+)\.(\d+)\.\d+.*$/,
  (_, major, minor) => `${major}.${Number(minor) + 1}.0`,
);
const PLATFORM_VERSION = JSON.parse(
  readFileSync(join(REPO, 'libs/platform/package.json'), 'utf8'),
).version;
const PLATFORM_MINOR = PLATFORM_VERSION.replace(
  /^(\d+)\.(\d+)\.\d+.*$/,
  (_, major, minor) => `${major}.${Number(minor) + 1}.0`,
);

const ROOT = 'bundle/agentic-ui-config';
const APP = `${ROOT}/app.json`;
const LABELS = `${ROOT}/labels/en.json`;
const ACTIONS = `${ROOT}/actions.json`;
const HOME = `${ROOT}/home.json`;
const NAVIGATION = `${ROOT}/navigation.json`;
const CONFIG = 'bundle/OSGI-INF/payers-claims-demo-config.xml';
const MODEL = 'bundle/OSGI-INF/payers-claims-demo-model.xml';
const CLAIM_SCHEMA = 'bundle/schemas/claim.xsd';
const NOTES = 'upgrade-notes.json';

/** What the check reads of the platform, and what it reads as it is beside that. */
const PLATFORM = [
  'docs/extension-reference.md',
  'libs/shared/app-definition/src/lib',
  'nuxeo-agentic-core/src/main/resources/OSGI-INF',
  'nuxeo-agentic-core/src/main/java',
  'apps/nuxeo-ui/src/app/business-apps.menu.ts',
  'libs/platform/package.json',
  'apps/nuxeo-ui/public/i18n/en.json',
  'docs/business-apps/platform-upgrade-notes.json',
];
const REGISTRIES = 'libs/shared/app-definition/src/lib/registries.ts';
const MENU = 'apps/nuxeo-ui/src/app/business-apps.menu.ts';
const LAYOUT_DESCRIPTOR =
  'nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/LayoutDescriptor.java';
const DEFAULTS =
  'nuxeo-agentic-core/src/main/resources/OSGI-INF/agentic-ui-config-defaults-contrib.xml';
const PLATFORM_NOTES = 'docs/business-apps/platform-upgrade-notes.json';

const failures = [];
let negative = 0;
let positive = 0;
const nothing = () => undefined;

/** A file of `directory`, its text changed from `from` to `to`; a change that does not apply throws. */
function edit(directory, file, from, to) {
  const path = join(directory, ...file.split('/'));
  const text = readFileSync(path, 'utf8');
  if (!text.includes(from))
    throw new Error(`the control's edit does not apply to ${file}: ${from}`);
  writeFileSync(path, text.replace(from, to));
}

function write(directory, file, text) {
  const path = join(directory, ...file.split('/'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof text === 'string' ? text : `${JSON.stringify(text, null, 2)}\n`);
}

/** A JSON file of `directory`, changed by `change` and written back. */
function jsonEdit(directory, file, change) {
  const path = join(directory, ...file.split('/'));
  const content = JSON.parse(readFileSync(path, 'utf8'));
  change(content);
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
}

/** `directory`'s package at `version`, in the three places that carry it. */
function setVersion(directory, version) {
  edit(directory, APP, `"packageVersion": "${VERSION}"`, `"packageVersion": "${version}"`);
  edit(directory, 'package/package.xml', `version="${VERSION}">`, `version="${version}">`);
  edit(
    directory,
    'bundle/META-INF/MANIFEST.MF',
    `Bundle-Version: ${VERSION}`,
    `Bundle-Version: ${version}`,
  );
}

function notes(directory, list) {
  write(directory, NOTES, { version: 1, notes: list });
}

/** The demo's queue `id` removed, with what names it in the home and the menu. */
function removeQueue(directory, id) {
  rmSync(join(directory, ...`${ROOT}/queues/${id}.json`.split('/')));
  edit(directory, CONFIG, `<file path="queues/${id}.json" />`, '');
  jsonEdit(
    directory,
    HOME,
    (home) => (home.cards = home.cards.filter((card) => card.queue !== id)),
  );
  jsonEdit(
    directory,
    NAVIGATION,
    (menu) => (menu.entries = menu.entries.filter((entry) => entry.queue !== id)),
  );
}

/** The demo's queue `from` renamed `to`, with what names it. */
function renameQueue(directory, from, to) {
  renameSync(
    join(directory, ...`${ROOT}/queues/${from}.json`.split('/')),
    join(directory, ...`${ROOT}/queues/${to}.json`.split('/')),
  );
  edit(
    directory,
    CONFIG,
    `<file path="queues/${from}.json" />`,
    `<file path="queues/${to}.json" />`,
  );
  for (const [file, list] of [
    [HOME, 'cards'],
    [NAVIGATION, 'entries'],
  ])
    jsonEdit(directory, file, (content) => {
      for (const item of content[list]) if (item.queue === from) item.queue = to;
    });
}

/** A copy of this repository's platform files, changed by `change`. */
function platformWith(scratch, name, change = nothing) {
  const root = join(scratch, name);
  for (const path of PLATFORM)
    cpSync(join(REPO, ...path.split('/')), join(root, ...path.split('/')), { recursive: true });
  change(root);
  return root;
}

/** The previous platform's registries with one more rule, `app.rules.isUrgent`. */
const registersUrgent = (root) =>
  edit(
    root,
    REGISTRIES,
    "    'app.rules.dateWithin',\n  ].map(",
    "    'app.rules.dateWithin',\n    'app.rules.isUrgent',\n  ].map(",
  );
/** A home card shown by `app.rules.isUrgent`. */
const namesUrgent = (directory) =>
  jsonEdit(directory, HOME, (home) =>
    home.cards.push({
      id: 'urgent',
      queue: 'unassigned-claims',
      visibleWhen: 'app.rules.isUrgent',
    }),
  );

function run(args, cwd = REPO) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

/**
 * The package as it was at `from`, changed by `before`, and as it is at `to`, changed by `after`,
 * checked with `--previous`; with `platform`, also with a platform as it was and one as it is,
 * each a copy of this repository's changed by its function. `expected.refused` is a list of what
 * the output must say, with exit 1; `expected.kept`, with exit 0.
 */
function expectUpgrade(
  what,
  { from = VERSION, to = VERSION, before = nothing, after = nothing, platform },
  expected,
) {
  if (expected.refused) negative++;
  else positive++;
  const scratch = mkdtempSync(join(tmpdir(), 'app-upgrade-check-'));
  try {
    const previous = join(scratch, 'previous', 'payers-claims-demo');
    const directory = join(scratch, 'current', 'payers-claims-demo');
    for (const [copy, version, change] of [
      [previous, from, before],
      [directory, to, after],
    ]) {
      cpSync(DEMO, copy, { recursive: true, filter: (path) => basename(path) !== 'dist' });
      if (version !== VERSION) setVersion(copy, version);
      change(copy);
    }
    const args = [directory, '--previous', previous];
    if (platform)
      args.push(
        '--previous-platform',
        platformWith(scratch, 'platform-before', platform.before),
        '--root',
        platformWith(scratch, 'platform-now', platform.after),
      );
    const { status, output } = run(args);
    const problems = [];
    const wanted = expected.refused ? 1 : 0;
    if (status !== wanted) problems.push(`exit ${status}, not ${wanted}`);
    for (const line of expected.refused ?? expected.kept)
      if (!output.includes(line)) problems.push(`no "${line}"`);
    for (const line of expected.never ?? [])
      if (output.includes(line)) problems.push(`"${line}" is in the output`);
    if (problems.length > 0)
      failures.push(`${what}: ${problems.join('; ')}\n${output.trim().replace(/^/gm, '    ')}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// --- The kit: what a customer may override or name, removed with no note ---------------------------

expectUpgrade(
  'a queue removed, at a minor version, with no note',
  { to: MINOR, after: (directory) => removeQueue(directory, 'pending-determination') },
  {
    refused: [
      'kit, queue pending-determination: The queue pending-determination is removed',
      'kit, menu-entry pending: The menu entry pending is removed',
      'overrides appMenu.pending',
      `payers-claims-demo/${NOTES}: { "version": "${MINOR}", "item": "queue pending-determination"`,
    ],
  },
);
expectUpgrade(
  'a menu entry removed at a patch version, which the version rules pass',
  {
    to: PATCH,
    after: (directory) =>
      jsonEdit(
        directory,
        NAVIGATION,
        (menu) => (menu.entries = menu.entries.filter((entry) => entry.id !== 'search')),
      ),
  },
  {
    refused: [
      'kit, menu-entry search:',
      `kit, version ${PATCH}: The upgrade needs more of the version than it was given`,
      `and ${PATCH} raises the patch`,
    ],
  },
);
expectUpgrade(
  'a label key removed, at a minor version',
  {
    to: MINOR,
    before: (directory) =>
      jsonEdit(directory, LABELS, (labels) => (labels.labels['payers.only.before'] = 'Gone')),
  },
  {
    refused: ['kit, label en payers.only.before: The label payers.only.before, in en, is removed'],
  },
);
expectUpgrade(
  'a labels language removed, said once and not key by key',
  {
    to: MINOR,
    before: (directory) =>
      write(directory, `${ROOT}/labels/fr.json`, {
        version: 2,
        labels: { 'payers.app.claims': 'Sinistres' },
      }),
  },
  {
    refused: ['kit, labels fr: The labels for fr are removed'],
    never: ['label fr payers.app.claims'],
  },
);
expectUpgrade(
  'a layout removed, at a minor version',
  {
    to: MINOR,
    before: (directory) =>
      edit(
        directory,
        CONFIG,
        '<layout type="Provider" mode="view"',
        '<layout type="Claim" mode="edit" src="agentic-ui-config/layouts/Claim/edit.layout.json" />\n    <layout type="Provider" mode="view"',
      ),
  },
  { refused: ['kit, layout Claim/edit: The edit layout of Claim records is removed'] },
);
expectUpgrade(
  'a task form removed',
  {
    to: MINOR,
    before: (directory) =>
      write(directory, `${ROOT}/tasks/PayersClaimReview.extra.layout.json`, {
        version: 2,
        cards: [],
      }),
  },
  {
    refused: [
      'kit, task-form PayersClaimReview.extra: The task form of PayersClaimReview.extra is removed',
    ],
  },
);
expectUpgrade(
  'an action removed',
  {
    to: MINOR,
    before: (directory) =>
      jsonEdit(directory, ACTIONS, (file) =>
        file.actions.push({ ...file.actions[0], id: 'payers.claim.reopen' }),
      ),
  },
  { refused: ['kit, action payers.claim.reopen: The action payers.claim.reopen is removed'] },
);
expectUpgrade(
  "the app's address changed",
  {
    to: MINOR,
    after: (directory) => jsonEdit(directory, APP, (app) => (app.address = 'claims-desk')),
  },
  {
    refused: [
      "kit, address payers-claims: The app's address is claims-desk, and was payers-claims",
    ],
  },
);
expectUpgrade(
  'the configuration component renamed, which a customer requires',
  {
    to: MINOR,
    after: (directory) =>
      edit(
        directory,
        CONFIG,
        '<component name="nuxeo.config.payers-claims-demo"',
        '<component name="nuxeo.config.payers-claims-demo.ui"',
      ),
  },
  {
    refused: [
      'kit, component nuxeo.config.payers-claims-demo: The component nuxeo.config.payers-claims-demo is gone',
    ],
    // Everything it contributed moves with it: said once, by the component's own finding.
    never: ['kit, contributor '],
  },
);
expectUpgrade(
  'a page provider renamed',
  {
    to: MINOR,
    after: (directory) => edit(directory, MODEL, 'name="member_claims"', 'name="member_claims_v2"'),
  },
  {
    refused: [
      'kit, page-provider member_claims: The page provider member_claims is gone',
      'If it was renamed, it may be page-provider member_claims_v2.',
    ],
  },
);
expectUpgrade(
  'a document type renamed',
  {
    to: MINOR,
    after: (directory) =>
      edit(directory, MODEL, '<doctype name="Provider"', '<doctype name="HealthProvider"'),
  },
  { refused: ['kit, type Provider: The document type Provider is gone'] },
);
expectUpgrade(
  'a property removed from the schema, which nothing names any more',
  {
    to: MINOR,
    before: (directory) =>
      edit(
        directory,
        CLAIM_SCHEMA,
        '<xs:element name="received"',
        '<xs:element name="legacyCode" type="xs:string" />\n  <xs:element name="received"',
      ),
  },
  { refused: ['kit, property claim:legacyCode: The property claim:legacyCode is removed'] },
);
expectUpgrade(
  'a schema removed, said once and not property by property',
  {
    to: MINOR,
    before: (directory) => {
      edit(
        directory,
        MODEL,
        '<schema name="claim" prefix="claim" src="schemas/claim.xsd" />',
        '<schema name="claim" prefix="claim" src="schemas/claim.xsd" />\n    <schema name="legacy" prefix="legacy" src="schemas/legacy.xsd" />',
      );
      write(
        directory,
        'bundle/schemas/legacy.xsd',
        '<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  <xs:element name="code" type="xs:string" />\n</xs:schema>\n',
      );
    },
  },
  { refused: ['kit, schema legacy: The schema legacy is gone'], never: ['property legacy:code'] },
);

// --- The kit: layers whose precedence changes ----------------------------------------------------------

expectUpgrade(
  "the configuration component's requirements changed",
  {
    to: MINOR,
    after: (directory) =>
      edit(
        directory,
        CONFIG,
        '<require>org.nuxeo.agentic.ui.config.defaults</require>',
        '<require>org.nuxeo.agentic.ui.config.defaults</require>\n  <require>nuxeo.config.payers-claims-demo.model</require>',
      ),
  },
  {
    refused: [
      'kit, requires nuxeo.config.payers-claims-demo: The component nuxeo.config.payers-claims-demo required org.nuxeo.agentic.ui.config.defaults and now requires',
    ],
  },
);
expectUpgrade(
  'a layout moved to another component',
  {
    to: MINOR,
    after: (directory) => {
      edit(
        directory,
        CONFIG,
        '<layout type="Provider" mode="view" src="agentic-ui-config/layouts/Provider/view.layout.json" />',
        '',
      );
      edit(
        directory,
        MODEL,
        '</component>',
        '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n    <layout type="Provider" mode="view" src="agentic-ui-config/layouts/Provider/view.layout.json" />\n  </extension>\n</component>',
      );
    },
  },
  {
    refused: [
      'kit, contributor layout Provider/view: The view layout of Provider records was contributed by nuxeo.config.payers-claims-demo and is now by nuxeo.config.payers-claims-demo.model',
    ],
  },
);
expectUpgrade(
  'a contribution newly disabled',
  {
    to: MINOR,
    after: (directory) =>
      edit(
        directory,
        CONFIG,
        '<layout type="Provider" mode="view"',
        '<layout type="Note" mode="view" enabled="false" />\n    <layout type="Provider" mode="view"',
      ),
  },
  {
    refused: [
      'kit, disables layout Note/view: The package now disables the view layout of Note records',
    ],
  },
);

// --- The kit: what disappears while it is still named ------------------------------------------------

expectUpgrade(
  'a label key gone while a layout still names it, which a note does not mend',
  {
    to: MINOR,
    before: (directory) =>
      jsonEdit(directory, LABELS, (labels) => (labels.labels['payers.only.before'] = 'Gone')),
    after: (directory) => {
      jsonEdit(
        directory,
        `${ROOT}/layouts/Provider/view.layout.json`,
        (layout) => (layout.cards[0].labelKey = 'payers.only.before'),
      );
      notes(directory, [{ version: MINOR, item: 'label en payers.only.before', note: 'Gone.' }]);
    },
  },
  {
    refused: [
      'kit, label-key payers.only.before: The label key payers.only.before is gone from every labels file of the package',
      'a note does not mend it',
    ],
  },
);
expectUpgrade(
  'a property gone while a queue still names it',
  {
    to: MINOR,
    after: (directory) =>
      edit(directory, CLAIM_SCHEMA, '<xs:element name="received" type="xs:date" />', ''),
  },
  {
    refused: [
      "kit, property claim:received: The property claim:received is gone from the package's schema",
      `${ROOT}/queues/pending-determination.json`,
    ],
  },
);

// --- The kit: notes that do not do what they say -----------------------------------------------------

expectUpgrade(
  'a note for a version the upgrade does not cross',
  {
    to: MINOR,
    after: (directory) => {
      removeQueue(directory, 'pending-determination');
      notes(directory, [
        {
          version: '9.0.0',
          items: ['queue pending-determination', 'menu-entry pending'],
          note: 'Too late.',
        },
      ]);
    },
  },
  { refused: ['kit, queue pending-determination:', 'Its migration note goes in'] },
);
expectUpgrade(
  'a note that says it is renamed to what the package does not have',
  {
    to: MINOR,
    after: (directory) => {
      removeQueue(directory, 'pending-determination');
      notes(directory, [
        {
          version: MINOR,
          item: 'queue pending-determination',
          renamedTo: 'queue pending',
          note: 'Renamed.',
        },
        { version: MINOR, item: 'menu-entry pending', note: 'Gone.' },
      ]);
    },
  },
  {
    refused: [
      'The note for queue pending-determination says it is renamed to queue pending, which the package as it is does not have',
    ],
  },
);
expectUpgrade(
  'a notes file that cannot be read whole',
  {
    to: MINOR,
    after: (directory) =>
      write(directory, NOTES, {
        version: 1,
        notes: [
          { version: 'next', item: 'queue x', note: 'Bad version.' },
          { version: MINOR, item: 'widget text', note: 'A platform kind.' },
          { version: MINOR, item: 'queue y', note: '', extra: true },
          { version: MINOR, item: 'home', items: ['menu'], note: 'Both.' },
        ],
      }),
  },
  {
    refused: [
      'notes[0]: has the version "next", which is not a semantic version.',
      'notes[1].item: names the kind "widget"',
      'notes[2]: has the key "extra"',
      'notes[2]: has no "note"',
      'notes[3]: names its items with one of "item" and "items".',
    ],
  },
);
expectUpgrade(
  'a note in range, at a version that does not rise as far as the removal needs',
  {
    to: PATCH,
    after: (directory) => {
      removeQueue(directory, 'pending-determination');
      notes(directory, [
        {
          version: PATCH,
          items: ['queue pending-determination', 'menu-entry pending'],
          note: 'Gone.',
        },
      ]);
    },
  },
  { refused: [`kit, version ${PATCH}: The upgrade needs more of the version than it was given`] },
);
expectUpgrade(
  "another package's previous version",
  {
    before: (directory) =>
      edit(
        directory,
        'package/package.xml',
        'name="payers-claims-demo"',
        'name="payers-claims-old"',
      ),
  },
  { refused: ['The package as it was is payers-claims-old, and as it is payers-claims-demo'] },
);

// --- The kit: kept -----------------------------------------------------------------------------------

expectUpgrade('unchanged', {}, { kept: ['every configuration is kept.'] });
expectUpgrade(
  'a queue removed, at a minor version, with its note',
  {
    to: MINOR,
    after: (directory) => {
      removeQueue(directory, 'pending-determination');
      notes(directory, [
        {
          version: MINOR,
          items: ['queue pending-determination', 'menu-entry pending'],
          note: 'Pending determination is gone: open the claims queue and filter on its status.',
        },
      ]);
    },
  },
  {
    kept: [
      'every configuration is kept, 2 item(s) by their migration notes.',
      'kept by the note for menu-entry pending and queue pending-determination',
      'filter on its status',
    ],
  },
);
expectUpgrade(
  'a queue renamed, with its note',
  {
    to: MINOR,
    after: (directory) => {
      renameQueue(directory, 'pending-determination', 'pending-review');
      notes(directory, [
        {
          version: MINOR,
          item: 'queue pending-determination',
          renamedTo: 'queue pending-review',
          note: 'Name pending-review where you named pending-determination.',
        },
      ]);
    },
  },
  { kept: ['kept by the note for queue pending-determination'] },
);
expectUpgrade(
  'a note in range that covers nothing, said and kept',
  {
    to: PATCH,
    after: (directory) =>
      notes(directory, [{ version: PATCH, item: 'queue nothing', note: 'Nothing.' }]),
  },
  { kept: ['the note for queue nothing, at', 'covers nothing this upgrade removes or changes.'] },
);

// --- The platform: what a kit names, gone ------------------------------------------------------------

expectUpgrade(
  'a rule the kit named as it was, gone from the platform, with no note and the same version',
  { before: namesUrgent, platform: { before: registersUrgent } },
  {
    refused: [
      `platform, id app.rules.isUrgent: The platform no longer has the ID app.rules.isUrgent, which payers-claims-demo ${VERSION} named`,
      `Its migration note goes in ${PLATFORM_NOTES}`,
      `platform, version ${PLATFORM_VERSION}:`,
      "libs/platform/package.json's version",
    ],
  },
);
expectUpgrade(
  'a rule gone from the platform that the kit as it is still names, which a note does not mend',
  { before: namesUrgent, after: namesUrgent, platform: { before: registersUrgent } },
  {
    refused: [
      'platform, id app.rules.isUrgent: The platform no longer has the ID app.rules.isUrgent, and payers-claims-demo',
      'Mend the kit: a note does not.',
    ],
  },
);
expectUpgrade(
  "the prefix of an app's menu entries changed",
  {
    platform: {
      after: (root) =>
        edit(root, MENU, "APP_MENU_ID_PREFIX = 'appMenu.'", "APP_MENU_ID_PREFIX = 'app.menu.'"),
    },
  },
  {
    refused: [
      "platform, menu-prefix appMenu.: The platform no longer has appMenu.<entry> as the ID of an app's menu entry",
    ],
  },
);
expectUpgrade(
  "an attribute a layout's contribution writes, gone from its descriptor",
  {
    platform: {
      after: (root) => edit(root, LAYOUT_DESCRIPTOR, '@XNode("@src")', '@XNode("@source")'),
    },
  },
  {
    refused: [
      'platform, descriptor layout@src: The platform no longer has the descriptor layout@src, and payers-claims-demo',
    ],
  },
);
expectUpgrade(
  'the defaults component, which the kit requires, renamed',
  {
    platform: {
      after: (root) =>
        edit(
          root,
          DEFAULTS,
          '<component name="org.nuxeo.agentic.ui.config.defaults"',
          '<component name="org.nuxeo.agentic.ui.config.packaged"',
        ),
    },
  },
  {
    refused: [
      'platform, component org.nuxeo.agentic.ui.config.defaults: The platform no longer has the component org.nuxeo.agentic.ui.config.defaults',
    ],
  },
);
expectUpgrade(
  'a source of what the platform registers, gone',
  { platform: { after: (root) => rmSync(join(root, 'docs', 'extension-reference.md')) } },
  {
    refused: [
      'platform, source docs/extension-reference.md: The platform as it is has no docs/extension-reference.md',
    ],
    // Not one finding per ID it documented.
    never: ['platform, id app.'],
  },
);
expectUpgrade(
  'a rule gone with its note, and the platform version not raised',
  {
    before: namesUrgent,
    platform: {
      before: registersUrgent,
      after: (root) =>
        write(root, PLATFORM_NOTES, {
          version: 1,
          notes: [
            {
              version: PLATFORM_MINOR,
              item: 'id app.rules.isUrgent',
              note: 'Use app.rules.fieldIn.',
            },
          ],
        }),
    },
  },
  { refused: [`platform, version ${PLATFORM_VERSION}:`, 'platform, id app.rules.isUrgent:'] },
);
expectUpgrade(
  'a rule gone with its note, and the platform version raised as far as it needs',
  {
    before: namesUrgent,
    platform: {
      before: registersUrgent,
      after: (root) => {
        write(root, PLATFORM_NOTES, {
          version: 1,
          notes: [
            {
              version: PLATFORM_MINOR,
              item: 'id app.rules.isUrgent',
              note: 'Use app.rules.fieldIn.',
            },
          ],
        });
        jsonEdit(
          root,
          'libs/platform/package.json',
          (manifest) => (manifest.version = PLATFORM_MINOR),
        );
      },
    },
  },
  { kept: ["kept by the note for the platform's id app.rules.isUrgent", 'Use app.rules.fieldIn.'] },
);
expectUpgrade(
  'the same platform as it was and as it is',
  { platform: {} },
  { kept: ['every configuration is kept.'] },
);

// --- The command ----------------------------------------------------------------------------------------

{
  // A symbolic link in the package is not followed: the run stops, exit 2.
  negative++;
  const scratch = mkdtempSync(join(tmpdir(), 'app-upgrade-check-'));
  try {
    const directory = join(scratch, 'payers-claims-demo');
    cpSync(DEMO, directory, { recursive: true, filter: (path) => basename(path) !== 'dist' });
    symlinkSync(join(REPO, 'package.json'), join(directory, 'bundle', 'linked.json'));
    const { status, output } = run([directory, '--previous', DEMO]);
    if (status !== 2 || !output.includes('is a symbolic link, which is not followed'))
      failures.push(`a link in the package exits ${status}, not 2\n${output}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
for (const [args, why] of [
  [[], 'no mode'],
  [[DEMO, DEMO, '--previous', DEMO], 'two packages with --previous'],
  [[DEMO, '--previous-platform', REPO], '--previous-platform with no --previous'],
  [[DEMO, '--since', ''], 'an empty --since'],
  [[DEMO, '--previous', DEMO, '--since', 'HEAD'], 'two modes'],
  [['--export', 'HEAD'], '--export with no directory'],
  [[DEMO, '--previous', join(REPO, 'not-there')], 'a --previous that is not there'],
]) {
  negative++;
  const { status } = run(args);
  if (status !== 2) failures.push(`${why}: exit ${status}, not 2`);
}

// --- A git ref: --since and --export on a scratch repository -------------------------------------------

{
  const scratch = mkdtempSync(join(tmpdir(), 'app-upgrade-check-git-'));
  try {
    const repository = join(scratch, 'repository');
    for (const path of PLATFORM)
      cpSync(join(REPO, ...path.split('/')), join(repository, ...path.split('/')), {
        recursive: true,
      });
    cpSync(DEMO, join(repository, ...KIT.split('/')), {
      recursive: true,
      filter: (path) => basename(path) !== 'dist',
    });
    const git = (...args) => {
      const result = spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
      return result.stdout;
    };
    git('init', '--quiet');
    git('add', '--all');
    git(
      '-c',
      'user.name=selftest',
      '-c',
      'user.email=selftest@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'the kit as it was',
    );

    positive++;
    const clean = run(['--since', 'HEAD', '--root', repository], repository);
    if (
      clean.status !== 0 ||
      !clean.output.includes('payers-claims-demo 0.') ||
      !clean.output.includes('every configuration is kept')
    )
      failures.push(`--since HEAD on a clean tree: exit ${clean.status}, not 0\n${clean.output}`);

    negative++;
    removeQueue(join(repository, ...KIT.split('/')), 'pending-determination');
    const changed = run(['--since', 'HEAD', '--root', repository], repository);
    if (
      changed.status !== 1 ||
      !changed.output.includes(
        'kit, queue pending-determination: The queue pending-determination is removed',
      )
    )
      failures.push(
        `--since HEAD with a queue removed in the tree: exit ${changed.status}, not 1\n${changed.output}`,
      );

    positive++;
    const into = join(scratch, 'export');
    const exported = run(['--export', 'HEAD', into, '--root', repository], repository);
    for (const path of [
      'docs/extension-reference.md',
      'libs/shared/app-definition/src/lib/registries.ts',
      'libs/platform/package.json',
    ])
      if (exported.status !== 0 || !existsSync(join(into, ...path.split('/'))))
        failures.push(
          `--export HEAD did not write ${path}: exit ${exported.status}\n${exported.output}`,
        );

    negative++;
    const unknown = run(['--since', 'no-such-ref', '--root', repository], repository);
    if (unknown.status !== 2 || !unknown.output.includes('names no commit'))
      failures.push(
        `--since a ref that is not there: exit ${unknown.status}, not 2\n${unknown.output}`,
      );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(`app-upgrade-check selftest: ${failures.length} control(s) did not hold:\n`);
  for (const failure of failures) console.error(`- ${failure}\n`);
  process.exit(1);
}
console.log(
  `app-upgrade-check selftest: ${negative} negative control(s) refused for their own reason, ` +
    `${positive} sound one(s) kept.`,
);
