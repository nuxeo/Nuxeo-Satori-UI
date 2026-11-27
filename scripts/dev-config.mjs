#!/usr/bin/env node
/**
 * Write the configuration `nx serve nuxeo-ui` answers at `/agentic-ui-config/`.
 *
 * On a server those URLs are the configuration servlet in `nuxeo-agentic-core`, which answers with
 * an envelope of ordered fragments, one per Marketplace package. The dev server has no servlet, so
 * this writes the same envelope into the gitignored `apps/nuxeo-ui/public/agentic-ui-config/`:
 * our defaults, then each fragment file given, in order — as if each were a package depending on
 * the one before.
 *
 *   npm run config:dev                                   # our defaults only
 *   npm run config:dev -- --bootstrap acme.json --manifest acme-manifest.json
 *   npm run config:dev -- --layout Claim/metadata=claim.layout.json
 *   npm run config:dev -- --home home.json
 *   npm run config:dev -- --labels en=labels/en.json --labels fr=labels/fr.json
 *   npm run config:dev -- --queue queues/unassigned-claims.json
 *   npm run config:dev -- --navigation navigation.json
 *   npm run config:dev -- --task claimDetermination.determine=determine.layout.json
 *
 * `--layout <Type>/<mode>=<file>` serves a per-type layout file as the servlet does: listed in
 * `layouts.json` and answered at `layouts/<Type>/<mode>.layout.json`. A later one for the same
 * type and mode replaces the earlier, as a later package's contribution does.
 *
 * `--home <file>` serves an app's `home.json` at `home.json`, as the package writes it, with no
 * envelope (docs/business-apps/app-definition-v2.md, section 10). The servlet does not answer
 * there: on a server the app registry, `/nuxeo/agentic-ui-apps/`, serves an app's files after
 * sign-in. The app reads this address first and the registry's only where this one is 404, so a
 * file written here wins, even over a registry on the server the development server proxies.
 * Without `--home`, any `home.json` written before is removed, so the app finds none here, and
 * reads the registry's, if the app open has one. A later `--home` replaces an earlier one.
 *
 * `--labels <lang>=<file>` serves a package's labels for one language at `labels/<lang>.json`, as
 * the package writes them (app-definition-v2.md, section 7). Like the home, the servlet does not
 * answer there, and the registry serves a server's. The app reads the file for the person's language, above the
 * platform's catalogue and below the manifest's `labels`. Without `--labels`, any written before
 * are removed. A later file for the same language replaces an earlier one.
 *
 * `--queue <file>` serves an app's queue at `queues/<id>.json`, the id being the file's name, as
 * the package writes it, with no envelope (app-definition-v2.md, section 4). The servlet does not
 * answer there either, and wins over the registry as the home does. Without `--queue`, no queue is
 * served here, and any written before are removed. A later `--queue` for the same id replaces an
 * earlier one.
 *
 * `--navigation <file>` serves an app's menu at `navigation.json`, as `--home` serves its home
 * (app-definition-v2.md, section 9). Without it, any `navigation.json` written before is removed, so
 * the app reads the registry's, if the app open has one, and else shows the platform's menu alone. A
 * later `--navigation` replaces an earlier one.
 *
 * `--task <workflow>.<step>=<file>` serves a workflow step's task form at
 * `tasks/<workflow>.<step>.layout.json`, as the package writes it, with no envelope
 * (app-definition-v2.md, section 6). The servlet does not answer there either: on a server, the
 * registry serves the task forms an app's package contributes. Every run writes the tasks it is
 * given and removes any written before; a later `--task` for the same step replaces an earlier one.
 *
 * Run this once before `nx serve`: a dev server started while `agentic-ui-config/` did not exist
 * serves nothing under it until it is restarted. Once the folder exists, a file written there, or
 * edited, is served after a moment, when the dev server's watcher sees it (measured on Angular 22's
 * dev server: under a second), so later runs need no restart; reload the page. A bare configuration
 * object is not accepted by the application, which is why copying a defaults file there no longer
 * works.
 *
 * These files draw what the server holds. A demo kit's types, page providers and records are on no
 * server until its package is installed and seeded, so for one they draw its shell alone.
 * `npm run kit:stand-in` answers the rest from the kit's own files, between the dev server and the
 * Nuxeo (`scripts/kit-stand-in.mjs`; docs/business-apps/package-pipeline.md, "A demo kit's pages in
 * dev mode").
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULTS = join(ROOT, 'nuxeo-agentic-core/src/main/resources/agentic-ui-config');
const TARGET = join(ROOT, 'apps/nuxeo-ui/public/agentic-ui-config');

const extra = {
  bootstrap: [],
  manifest: [],
  layout: [],
  home: [],
  labels: [],
  queue: [],
  navigation: [],
  task: [],
};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const layer = args[i]?.replace(/^--/, '');
  if (!Object.hasOwn(extra, layer ?? '') || !args[i + 1]) {
    console.error(
      'usage: dev-config.mjs [--bootstrap <fragment.json>]... [--manifest <fragment.json>]... ' +
        '[--layout <Type>/<mode>=<layout.json>]... [--home <home.json>] ' +
        '[--labels <lang>=<labels.json>]... [--queue <queues/<id>.json>]... ' +
        '[--navigation <navigation.json>] [--task <workflow>.<step>=<layout.json>]...',
    );
    process.exit(2);
  }
  extra[layer].push(
    layer === 'layout' || layer === 'labels' || layer === 'task'
      ? args[i + 1]
      : resolve(args[i + 1]),
  );
}

// The servlet leaves out a fragment over this size or with a repeated key (ConfigSnapshot.java), so
// one that only works here would vanish on a server.
const MAX_JSON_BYTES = 1024 * 1024;

/** The first key repeated within one object of already-valid JSON, or null. */
const duplicateKey = (text) => {
  const objects = [];
  const colon = /\s*:/y;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{') objects.push(new Set());
    else if (char === '[') objects.push(null);
    else if (char === '}' || char === ']') objects.pop();
    else if (char === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      const keys = objects.at(-1);
      colon.lastIndex = end + 1;
      if (keys && colon.test(text)) {
        const key = JSON.parse(text.slice(i, end + 1));
        if (keys.has(key)) return key;
        keys.add(key);
      }
      i = end;
    }
  }
  return null;
};

const read = (path) => {
  const bytes = readFileSync(path);
  if (bytes.length > MAX_JSON_BYTES) {
    throw new Error(
      `${path} is ${bytes.length} bytes; the server refuses more than ${MAX_JSON_BYTES}`,
    );
  }
  const text = bytes.toString('utf8');
  const content = JSON.parse(text);
  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    throw new Error(`${path} is not a JSON object, so it cannot be a fragment`);
  }
  const duplicate = duplicateKey(text);
  if (duplicate !== null) {
    throw new Error(
      `${path} repeats the key "${duplicate}" in one object, which the server refuses`,
    );
  }
  return content;
};

// ContributionRegistry.java: the type and mode names a layout contribution may use.
const LAYOUT_TYPE = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const LAYOUT_MODE = /^[a-z][a-z0-9-]{0,31}$/;

const layouts = new Map();
for (const spec of extra.layout) {
  const match = /^([^/=]+)\/([^/=]+)=(.+)$/.exec(spec);
  if (!match || !LAYOUT_TYPE.test(match[1]) || !LAYOUT_MODE.test(match[2])) {
    console.error(
      `--layout ${spec}: expected <Type>/<mode>=<file>, the type a document type name and the ` +
        'mode lower-case letters, digits or "-", as the server requires',
    );
    process.exit(2);
  }
  const [, type, mode, file] = match;
  const path = resolve(file);
  layouts.set(`${type}/${mode}`, {
    type,
    mode,
    component: 'local.dev',
    bundle: 'local.dev',
    source: path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path,
    content: read(path),
  });
}

// Each `--labels` names a language as the platform names its catalogues: `en`, or one with a
// region, such as `pt-BR`. Its file is read here, before anything is written, so that a mistyped
// language or file changes nothing.
const labels = new Map();
for (const entry of extra.labels) {
  const at = entry.indexOf('=');
  const lang = entry.slice(0, at);
  const file = entry.slice(at + 1);
  if (at <= 0 || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(lang) || file === '') {
    console.error(`--labels takes <lang>=<labels.json>, such as en=labels/en.json, not ${entry}`);
    process.exit(2);
  }
  const path = resolve(file);
  labels.set(lang, { path, content: read(path) });
}

// Each queue is served as the package writes it, at its id, which is its file's name; the app
// checks it with the validator when it reads it, and the pipeline when the package is built.
// app-definition-v2.md, section 2: an id is 1 to 64 letters, digits, `.`, `_` or `-`. Read here,
// as the labels are, before anything is written, so that a mistyped name or file changes nothing.
const QUEUE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const QUEUES = join(TARGET, 'queues');
const queues = new Map();
for (const path of extra.queue) {
  const id = basename(path).replace(/\.json$/, '');
  if (!path.endsWith('.json') || !QUEUE_ID.test(id)) {
    console.error(
      `--queue ${path}: expected <id>.json, the id 1 to 64 letters, digits, ".", "_" or "-", ` +
        'starting with a letter or a digit, as a queue file is named in a package',
    );
    process.exit(2);
  }
  queues.set(id, { path, content: read(path) });
}

// The menu's file, read here too, before anything is written.
const navigation = extra.navigation.at(-1);
const navigationContent = navigation === undefined ? undefined : read(navigation);

// A task form is served as the package writes it, as the home is; the app reads it with the
// validator when the task opens. The parts are those `placeFile` in libs/shared/app-definition
// takes from a package's `tasks/` file name. Checked and read here, before anything is written, as
// the layouts are, so a mistake leaves the configuration served before it as it was.
const TASK_PART = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const tasks = new Map();
for (const spec of extra.task) {
  const match = /^([^.=/]+)\.([^.=/]+)=(.+)$/.exec(spec);
  if (!match || !TASK_PART.test(match[1]) || !TASK_PART.test(match[2])) {
    console.error(
      `--task ${spec}: expected <workflow>.<step>=<file>, the workflow model's name and the ` +
        "step's node id, each a letter then letters, digits, '_' or '-'",
    );
    process.exit(2);
  }
  const path = resolve(match[3]);
  tasks.set(`${match[1]}.${match[2]}`, { path, content: read(path) });
}

const envelopes = ['bootstrap', 'manifest'].map((layer) => {
  const defaults = join(DEFAULTS, `${layer}.defaults.json`);
  const fragments = [
    { name: 'defaults', component: 'org.nuxeo.agentic.ui.config.defaults', path: defaults },
    ...extra[layer].map((path) => ({
      name: basename(path, '.json'),
      component: 'local.dev',
      path,
    })),
  ].map(({ name, component, path }) => ({
    name,
    component,
    bundle: component,
    source: path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path,
    content: read(path),
  }));
  // On the server a fragment with a name already contributed replaces that one, so two files
  // with the same name would merge here and not there. Refuse rather than diverge.
  const names = fragments.map((f) => f.name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) {
    console.error(
      `two ${layer} fragments would be named "${duplicate}"; rename one of the files, since the ` +
        'server keeps only the later of two fragments with the same name',
    );
    process.exit(2);
  }
  return { layer, fragments };
});

mkdirSync(TARGET, { recursive: true });
for (const { layer, fragments } of envelopes) {
  const file = join(TARGET, `${layer}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ format: 'nuxeo-agentic-ui-config/1', layer, fragments, diagnostics: [] }, null, 2)}\n`,
  );
  console.log(`wrote ${file.slice(ROOT.length + 1)}: ${fragments.map((f) => f.name).join(' -> ')}`);
}

const LAYOUTS = join(TARGET, 'layouts');
rmSync(LAYOUTS, { recursive: true, force: true });
const index = [];
for (const { type, mode, content, ...provenance } of layouts.values()) {
  const url = `layouts/${type}/${mode}.layout.json`;
  mkdirSync(join(LAYOUTS, type), { recursive: true });
  writeFileSync(
    join(TARGET, url),
    `${JSON.stringify({ format: 'nuxeo-agentic-ui-config/1', layer: 'layout', type, mode, ...provenance, content }, null, 2)}\n`,
  );
  index.push({ type, mode, url, ...provenance });
}
writeFileSync(
  join(TARGET, 'layouts.json'),
  `${JSON.stringify({ format: 'nuxeo-agentic-ui-config/1', layer: 'layouts', layouts: index, labels: [...labels.keys()], diagnostics: [] }, null, 2)}\n`,
);
console.log(
  `wrote ${join(TARGET, 'layouts.json').slice(ROOT.length + 1)}: ${index.map((l) => `${l.type}/${l.mode}`).join(', ') || 'no layouts'}`,
);

// The home is served as the package writes it; the app checks it with the validator when it reads
// it, and the pipeline when the package is built.
const HOME = join(TARGET, 'home.json');
const home = extra.home.at(-1);
if (home === undefined) {
  rmSync(HOME, { force: true });
  console.log(`no home: ${HOME.slice(ROOT.length + 1)} not served`);
} else {
  writeFileSync(HOME, `${JSON.stringify(read(home), null, 2)}\n`);
  console.log(
    `wrote ${HOME.slice(ROOT.length + 1)}: ${home.startsWith(ROOT) ? home.slice(ROOT.length + 1) : home}`,
  );
}

// A package's labels, one file per language, served as the package writes them; the app checks
// each with the validator when it reads it, and the pipeline when the package is built.
const LABELS = join(TARGET, 'labels');
rmSync(LABELS, { recursive: true, force: true });
if (labels.size === 0) {
  console.log(`no labels: ${LABELS.slice(ROOT.length + 1)} not served`);
} else {
  // The app asks for a language's labels in the languages it offers, which the bootstrap lists
  // (the last fragment that sets them wins, as the app merges them), and always in English, its
  // fallback language.
  const offered = [
    'en',
    ...(envelopes
      .find((envelope) => envelope.layer === 'bootstrap')
      ?.fragments.map((fragment) => fragment.content?.availableLanguages)
      .filter(Array.isArray)
      .at(-1) ?? []),
  ];
  mkdirSync(LABELS, { recursive: true });
  for (const [lang, { path, content }] of labels) {
    const out = join(LABELS, `${lang}.json`);
    writeFileSync(out, `${JSON.stringify(content, null, 2)}\n`);
    console.log(
      `wrote ${out.slice(ROOT.length + 1)}: ${path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path}`,
    );
    if (!offered.includes(lang)) {
      console.warn(
        `warning: the app asks for labels in ${[...new Set(offered)].join(', ')} only, so never for ${lang}'s`,
      );
    }
  }
}

// The queues, served at the end, as the package writes them.
rmSync(QUEUES, { recursive: true, force: true });
if (queues.size > 0) mkdirSync(QUEUES, { recursive: true });
for (const [id, { content }] of queues) {
  writeFileSync(join(QUEUES, `${id}.json`), `${JSON.stringify(content, null, 2)}\n`);
}
console.log(
  queues.size === 0
    ? `no queues: ${QUEUES.slice(ROOT.length + 1)} not served`
    : `wrote ${QUEUES.slice(ROOT.length + 1)}: ${[...queues.keys()].join(', ')}`,
);

// The menu is served as the package writes it, as the home is.
const NAVIGATION = join(TARGET, 'navigation.json');
if (navigation === undefined) {
  rmSync(NAVIGATION, { force: true });
  console.log(`no menu: ${NAVIGATION.slice(ROOT.length + 1)} not served`);
} else {
  writeFileSync(NAVIGATION, `${JSON.stringify(navigationContent, null, 2)}\n`);
  console.log(
    `wrote ${NAVIGATION.slice(ROOT.length + 1)}: ${navigation.startsWith(ROOT) ? navigation.slice(ROOT.length + 1) : navigation}`,
  );
}

const TASKS = join(TARGET, 'tasks');
rmSync(TASKS, { recursive: true, force: true });
for (const [name, { path, content }] of tasks) {
  mkdirSync(TASKS, { recursive: true });
  const file = join(TASKS, `${name}.layout.json`);
  writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  console.log(
    `wrote ${file.slice(ROOT.length + 1)}: ${path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path}`,
  );
}
if (tasks.size === 0) console.log(`no task forms: ${TASKS.slice(ROOT.length + 1)} not served`);
