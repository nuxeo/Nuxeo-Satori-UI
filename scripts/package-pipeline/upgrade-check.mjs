/**
 * The upgrade check (docs/business-apps/package-pipeline.md, section 10): moving a kit, or the
 * platform under it, from one version to the next must keep every customer configuration made on
 * the version before. It runs offline, with Node and no server, and compares the package as it was
 * with the package as it is, and the platform as it was with the platform as it is.
 *
 * One implementation, which two commands run: `scripts/app-upgrade-check.mjs`, this repository's,
 * whose usage is below, and `satori upgrade-check` (`tools/satori-cli`), which holds a package to
 * what it was, the kit's side, with the platform as it is read from the snapshot the tool carries
 * (`platformSnapshot`, written when the tool is built). Each gives `main` what it needs: the
 * repository whose platform is the one as it is, and the server half.
 *
 *   node scripts/app-upgrade-check.mjs [<package directory>...] --since <git ref>
 *     [--root <repository>] [--deployment <file>] [--json]
 *   node scripts/app-upgrade-check.mjs <package directory> --previous <package directory>
 *     [--previous-platform <repository>] [--root <repository>] [--deployment <file>] [--json]
 *   node scripts/app-upgrade-check.mjs --export <git ref> <directory> [--root <repository>]
 *   node scripts/app-upgrade-check.mjs --place-at <git ref> <package directory> [--root <repository>]
 *   node scripts/app-upgrade-check.mjs <package directory> --server <address>
 *     [--previous <package directory>] [--root <repository>] [--json]
 *
 * `--server` is the server half (`app-upgrade-server.mjs`): before the package is installed over
 * the version a running Nuxeo has, it reads that server, `GET` only and as `NUXEO_USER`, and adds
 * what only the server shows to this check's own findings, the upgrade from the version installed
 * held to the package given with `--previous`, or to the package itself when it is that version.
 *
 * `--since` compares each package, every one under `business-apps/packages/` when none is named,
 * and the platform, with what they were at a git ref: the working tree against the ref, a package
 * whose folder was renamed against the package of the same name, whose place `--place-at` prints
 * for the workflow. `--previous`
 * compares one package with an export of it, as the pipeline's step 3 does (`app-package.mjs`),
 * and the platform with `--previous-platform`'s, when it is given. `--export` writes what this check
 * reads of the platform at a ref into a directory, for `--previous-platform`: the workflow's step.
 * `--root` is the repository whose platform is the one as it is, this one by default; the controls
 * (`app-upgrade-check.selftest.mjs`) give it a scratch one.
 *
 * Refused, each with what a customer's configuration loses:
 *
 * - **A part of the kit a customer may override or name, removed or renamed with no migration
 *   note** in the kit's `upgrade-notes.json`: a layout, fragment or asset the component contributes;
 *   the app; a component, which a customer's `<require>`s; a schema, a property of one, a document
 *   type or a page provider; a queue, a task form, the home, the menu or one of its entries that
 *   open a queue or the home (which the `navbar` slot registers as `appMenu.<id>`); a labels
 *   language or one of its keys; an action; the app's address.
 * - **A configuration layer whose precedence changes with no note:** a component whose `<require>`s
 *   change; a contribution, a schema, a document type or a page provider that moves to another of
 *   the kit's components; a contribution newly disabled. Nuxeo registers a component's
 *   contributions after those of what it requires, and a later contribution on the same key wins
 *   (`ContributionRegistry` in nuxeo-agentic-core).
 * - **A label key, a property or a page provider that disappears while the kit still names it, or a
 *   document type while it contributes a layout for it.** No note mends it.
 * - **A version that does not rise as far as these need.** Each is breaking: a major, or a minor
 *   below 1.0.0, as the version rules read a version (package-pipeline.md, section 8), where those
 *   rules asked less, as they do for a menu entry, a property or a component.
 * - **On the platform's side,** an ID, a widget, a component, an extension point, an attribute of
 *   a descriptor, or the prefix of a menu entry's ID, which a kit names, as it was or as it is, and
 *   which the platform no longer has: refused outright when the kit as it is still names it, and
 *   otherwise unless `docs/business-apps/platform-upgrade-notes.json` has its note and
 *   `libs/platform/package.json`'s version rose by a major, a minor below 1.0.0, as
 *   `docs/extension-reference.md` promises for an ID.
 *
 * A note covers a finding when it names the same item and its version is one this upgrade crosses:
 * above the version held to, and up to the version as it is.
 *
 * **A deployment's own layer over the kit**, given with `--deployment`, the export an administrator
 * reads from a server, `GET /nuxeo/agentic-ui-apps/layer.json`: a layout or a queue an
 * administrator changed in the layout designer and published there overrides the kit's file at the
 * same path (docs/business-apps/app-definition-v2.md, section 10, "The deployment layer"). Each such
 * file the upgrade adds, changes or removes is a warning: the override keeps winning, so the kit's
 * change does not show on that server until someone takes it into the override or rolls the override
 * back. A warning refuses nothing and leaves the exit code alone.
 *
 * What the platform registers is read where it says so: the IDs `docs/extension-reference.md`
 * documents, as its drift gate reads them; the registries the validator holds a kit to, by importing
 * `registries.ts` as it was (it is plain data, and the repository's own code at that ref); the
 * components, extension points and descriptors of nuxeo-agentic-core; and `APP_MENU_ID_PREFIX`. The
 * XML is read by `verify-package-zip.mjs`'s helpers, as the pipeline reads it.
 *
 * Nothing is read through a symbolic link: a package that holds one, or a platform file reached
 * through one, stops the run. It runs unconditionally, as the pipeline's scripts do.
 *
 * Exit codes: 0, every configuration is kept; 1, one is not; 2, the command was wrong.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { judgeVersion } from '../../libs/shared/app-definition/src/lib/changes.ts';
import { compareVersions, parseVersion } from '../../libs/shared/app-definition/src/lib/semver.ts';
import {
  attribute,
  attributesOf,
  componentPathsOf,
  componentXmlOf,
  TAG,
  withoutCdata,
  withoutCommentsOrInstructions,
} from '../verify-package-zip.mjs';

const OUTPUT_LIMIT = 64 * 1024 * 1024;
const KITS = 'business-apps/packages';
const NOTES = 'upgrade-notes.json';
export const PLATFORM_NOTES = 'docs/business-apps/platform-upgrade-notes.json';
const CONFIGURATION = { target: 'org.nuxeo.agentic.ui.config', point: 'configuration' };
const TYPES = 'org.nuxeo.ecm.core.schema.TypeService';

/**
 * Where the platform says what it registers. A source the platform as it was has and the platform
 * as it is has not is refused, rather than read as everything it listed being removed: if it moved,
 * this list must follow it.
 */
const PLATFORM_SOURCES = {
  reference: 'docs/extension-reference.md',
  registries: 'libs/shared/app-definition/src/lib/registries.ts',
  components: 'nuxeo-agentic-core/src/main/resources/OSGI-INF',
  descriptors: 'nuxeo-agentic-core/src/main/java',
  menu: 'apps/nuxeo-ui/src/app/business-apps.menu.ts',
  version: 'libs/platform/package.json',
};
/**
 * What `--export` writes: every source, made from the list above so that the two cannot part, with
 * the whole library `registries.ts` sits in, which it may import from.
 */
const EXPORTED = Object.values(PLATFORM_SOURCES).map((path) =>
  path === PLATFORM_SOURCES.registries ? dirname(path) : path,
);
/** The platform's own texts, which a label key the package drops may still have. */
const CATALOGUE = 'apps/nuxeo-ui/public/i18n/en.json';

/** The items a note may name, and whether each has an id after its kind. */
const KIT_KINDS = new Map([
  ['layout', true],
  ['fragment', true],
  ['asset', true],
  ['app', true],
  ['component', true],
  ['schema', true],
  ['property', true],
  ['type', true],
  ['page-provider', true],
  ['queue', true],
  ['task-form', true],
  ['home', false],
  ['menu', false],
  ['menu-entry', true],
  ['labels', true],
  ['label', true],
  ['action', true],
  ['address', true],
  ['requires', true],
  ['contributor', true],
  ['disables', true],
]);
export const PLATFORM_KINDS = new Map([
  ['id', true],
  ['widget', true],
  ['component', true],
  ['extension-point', true],
  ['descriptor', true],
  ['menu-prefix', true],
]);

/**
 * The files a deployment layer holds (`LayerPaths` in nuxeo-agentic-core), and how a warning names
 * each: a record page, an edit or a create form, and a queue.
 */
const OVERRIDABLE = [
  [
    /^layouts\/([^/]+)\/(view|edit|create)\.layout\.json$/,
    (match) => `layout ${match[1]}/${match[2]}`,
  ],
  [/^queues\/([^/]+)\.json$/, (match) => `queue ${match[1]}`],
];

/** A run that cannot be made: the command, or an input it cannot read. Exit 2. */
export class Usage extends Error {}

/** The command line, or `null` when it is not one. */
export function parse(argv) {
  const options = { packages: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    // An empty value is refused, not taken as no option, as app-package.mjs refuses one.
    const given = (text) => text !== undefined && text !== '' && !text.startsWith('-');
    if (arg === '--json') options.json = true;
    else if (arg === '--export' || arg === '--place-at') {
      const key = arg.slice(2);
      if (!given(value) || !given(argv[index + 2]) || options[key]) return null;
      options[key] = { ref: value, path: argv[index + 2] };
      index += 2;
    } else if (
      [
        '--since',
        '--previous',
        '--previous-platform',
        '--root',
        '--deployment',
        '--server',
      ].includes(arg)
    ) {
      const key = arg.slice(2);
      if (!given(value) || options[key] !== undefined) return null;
      options[key] = value;
      index++;
    } else if (arg.startsWith('-')) return null;
    else options.packages.push(arg);
  }
  // With --server, --previous is the package as installed, not a mode of its own; the server's own
  // deployment layer is read, so --deployment is not given, and the platform is the one installed.
  if (options.server !== undefined)
    return options.packages.length === 1 &&
      ['export', 'place-at', 'since', 'previous-platform', 'deployment'].every(
        (key) => options[key] === undefined,
      )
      ? options
      : null;
  const modes = ['export', 'place-at', 'since', 'previous'].filter(
    (mode) => options[mode] !== undefined,
  );
  if (modes.length !== 1) return null;
  if (options.previous !== undefined && options.packages.length !== 1) return null;
  if (options['previous-platform'] !== undefined && options.previous === undefined) return null;
  for (const mode of ['export', 'place-at'])
    if (
      options[mode] !== undefined &&
      (options.packages.length > 0 || options.json || options.deployment !== undefined)
    )
      return null;
  return options;
}

/**
 * The check `options` asks for, its exit code: 0, every configuration is kept; 1, one is not. A run
 * that cannot be made throws `Usage`. `host.root` is the repository whose platform is the one as it
 * is, unless `--root` names another; `host.serverHalf()` loads `app-upgrade-server.mjs`.
 */
export async function main(options, host) {
  const root = resolve(options.root ?? host.root);
  if (!isDirectory(root)) throw new Usage(`--root ${root} is not a folder.`);
  if (options.export !== undefined) {
    const commit = commitOf(root, options.export.ref);
    const into = resolve(options.export.path);
    mkdirSync(into, { recursive: true });
    const written = extract(root, commit, EXPORTED, into);
    console.log(
      `The platform at ${options.export.ref} (${commit.slice(0, 12)}) is in ${into}: ${written.join(', ') || 'nothing this check reads'}.`,
    );
    return 0;
  }
  if (options['place-at'] !== undefined) {
    // The workflow's question: where the package was at the ref, under the same name if it moved.
    const commit = commitOf(root, options['place-at'].ref);
    const place = placeAt(
      root,
      commit,
      readKit(directoryOf(options['place-at'].path, 'the package')),
    );
    if (place !== null) console.log(place);
    return 0;
  }
  const current = await readPlatform(root);
  const notes = readNotes(root, PLATFORM_NOTES, PLATFORM_KINDS, PLATFORM_NOTES);
  if (options.server !== undefined) {
    // The server half: what the server installed has, read only, with this check's own findings
    // for the upgrade from the version installed, held to the package as installed.
    const { serverCheck } = await host.serverHalf();
    const kit = readKit(directoryOf(options.packages[0], 'the package'));
    const given =
      options.previous === undefined ? null : readKit(directoryOf(options.previous, '--previous'));
    return serverCheck({
      server: options.server,
      kit,
      given,
      asJson: options.json === true,
      offline: (before) => check(before, kit, { previous: null, current, notes }),
    });
  }
  const deployment = options.deployment === undefined ? null : readDeployment(options.deployment);
  if (options.previous !== undefined) {
    const previous =
      options['previous-platform'] === undefined
        ? null
        : await readPlatform(directoryOf(options['previous-platform'], '--previous-platform'));
    const kit = readKit(directoryOf(options.packages[0], 'the package'));
    const before = readKit(directoryOf(options.previous, '--previous'));
    return report([check(before, kit, { previous, current, notes }, deployment)], options.json);
  }

  const commit = commitOf(root, options.since);
  const named =
    options.packages.length > 0
      ? options.packages.map((directory) => directoryOf(directory, 'the package'))
      : kitsUnder(root);
  const scratch = mkdtempSync(join(tmpdir(), 'app-upgrade-check-'));
  try {
    const at = (path) => join(scratch, ...path.split('/'));
    extract(root, commit, EXPORTED, scratch);
    const previous = await readPlatform(scratch);
    const results = [];
    const held = new Set();
    for (const directory of named) {
      const kit = readKit(directory);
      const place = placeAt(root, commit, kit);
      if (place !== null) held.add(place);
      const before =
        place === null ? null : (extract(root, commit, [place], scratch), readKit(at(place)));
      results.push(check(before, kit, { previous, current, notes }, deployment));
    }
    // A kit the ref had and the tree has not, under any folder, is gone, not upgraded: said.
    const gone =
      options.packages.length === 0
        ? kitPlacesAt(root, commit)
            .filter((place) => !held.has(place))
            .map(
              (place) =>
                `${place}: at ${options.since}, and gone now; a package that is gone is not upgraded.`,
            )
        : [];
    return report(results, options.json, gone);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// --- One kit, as it was and as it is ------------------------------------------------------------

/**
 * The findings for one package: its own, as it was against as it is, and the platform's, for what
 * it names. `before` is `null` for a package the earlier version did not have, which is held to
 * nothing of its own, and `platform.previous` `null` when no earlier platform was given.
 * `deployment` is a server's deployment layer, `--deployment`, or `null`: each file of the kit's
 * app it overrides that the upgrade changes is a warning, which refuses nothing.
 */
export function check(before, kit, platform, deployment = null) {
  const findings = [];
  const covered = [];
  const said = [];
  const warnings = overrideWarnings(before, kit, deployment, said);
  if (before !== null && before.name !== kit.name)
    findings.push({
      side: 'kit',
      item: `package ${before.name}`,
      kind: 'package',
      what:
        `The package as it was is ${before.name}, and as it is ${kit.name}: a package keeps its name ` +
        'from one version to the next, and a new name is a new package, compared with nothing.',
    });
  else if (before !== null) {
    const notes = readNotes(kit.directory, NOTES, KIT_KINDS, `${kit.shown}/${NOTES}`);
    const ofKit = kitFindings(before, kit, platform.current);
    settle(ofKit, notes, before.version, kit.version, surfaceOf(kit), {
      side: 'kit',
      file: `${kit.shown}/${NOTES}`,
      findings,
      covered,
      said,
    });
    // Each finding is breaking, whatever the version rules made of the file it is in.
    const breaking = ofKit.filter((finding) => finding.kind !== 'dangling');
    if (breaking.length > 0) {
      const judged = judgeVersion(
        before.version,
        kit.version,
        breaking.map((finding) => ({ level: 'breaking', file: finding.item, what: finding.what })),
      );
      if (judged.refused !== null)
        findings.push({
          side: 'kit',
          item: `version ${kit.version}`,
          kind: 'version',
          what: `The upgrade needs more of the version than it was given: ${judged.refused}`,
        });
    }
  }
  if (platform.previous !== null) {
    const ofPlatform = platformFindings(before, kit, platform.previous, platform.current);
    settle(
      ofPlatform,
      platform.notes,
      platform.previous.version,
      platform.current.version,
      platform.current.surface,
      { side: 'platform', file: PLATFORM_NOTES, findings, covered, said },
    );
    const breaking = ofPlatform.filter((finding) => finding.kind === 'removed');
    const [was, is] = [platform.previous.version, platform.current.version];
    if (breaking.length > 0 && (was === null || is === null))
      findings.push({
        side: 'platform',
        item: `version ${is ?? 'unknown'}`,
        kind: 'version',
        what:
          `The platform takes away what ${kit.name} named, and its version as it ${was === null ? 'was' : 'is'} ` +
          'cannot be read from libs/platform/package.json, so the version that needs cannot be held to.',
      });
    if (breaking.length > 0 && was !== null && is !== null) {
      const judged = judgeVersion(
        was,
        is,
        breaking.map((finding) => ({ level: 'breaking', file: finding.item, what: finding.what })),
      );
      if (judged.refused !== null)
        findings.push({
          side: 'platform',
          item: `version ${is}`,
          kind: 'version',
          what:
            `The platform takes away what ${kit.name} named, which needs a ${judged.required} version of ` +
            `it (extension-reference.md, section 1: renaming or removing an ID is a breaking change), and ` +
            `libs/platform/package.json's version is ${is}, from ${was}${judged.raised ? `, which raises the ${judged.raised}` : ''}.`,
        });
    }
    for (const missing of platform.previous.missing)
      said.push(`the platform as it was has no ${missing}, so what it lists is not compared.`);
  } else said.push('no platform as it was was given, so the platform is not compared.');
  return {
    package: kit.name,
    directory: kit.shown,
    version: kit.version,
    previous: before?.version ?? null,
    platform:
      platform.previous === null
        ? null
        : { version: platform.current.version, previous: platform.previous.version },
    findings,
    covered,
    said,
    warnings,
  };
}

// --- A deployment's own layer over the kit ---------------------------------------------------------

/**
 * A server's deployment layer, as `GET /nuxeo/agentic-ui-apps/layer.json` answers it to an
 * administrator (`LayerService.export` in nuxeo-agentic-core): each app's files whose override is in
 * force, by path, with the version in force. A file that is not one is a command that cannot be run.
 */
export function readDeployment(path) {
  const shown = shownPath(resolve(path));
  if (!isFile(resolve(path))) throw new Usage(`--deployment ${shown} is not a file.`);
  const content = json(readFileSync(resolve(path), 'utf8'));
  const wrong = (what) =>
    new Usage(
      `--deployment ${shown}: ${what}. It is the deployment layer's export, as GET /nuxeo/agentic-ui-apps/layer.json answers it: ` +
        '{ "format": "nuxeo-agentic-ui-layer/1", "apps": [{ "id", "files": [{ "path", "version" }] }] }.',
    );
  if (
    !isRecord(content) ||
    content.format !== 'nuxeo-agentic-ui-layer/1' ||
    !Array.isArray(content.apps)
  )
    throw wrong('it is not the export');
  const apps = new Map();
  for (const app of content.apps) {
    if (!isRecord(app) || typeof app.id !== 'string' || !Array.isArray(app.files))
      throw wrong('an app is { "id", "files" }');
    const files = new Map();
    for (const file of app.files) {
      if (
        !isRecord(file) ||
        typeof file.path !== 'string' ||
        !OVERRIDABLE.some(([pattern]) => pattern.test(file.path)) ||
        !Number.isInteger(file.version) ||
        file.version < 1
      )
        throw wrong(`a file of ${app.id} is { "path", "version" }, its path a layout or a queue`);
      files.set(file.path, file.version);
    }
    apps.set(app.id, files);
  }
  return { shown, apps };
}

/**
 * Each file of the kit's app that the deployment overrides and the upgrade adds, changes or
 * removes. The override keeps winning over the kit's file after the upgrade, as it did before it,
 * so the customer sees none of the kit's change until an administrator takes it into the override
 * or rolls the override back: worth saying, never a refusal, since nothing the customer configured
 * is lost. A file the upgrade leaves as it was says nothing.
 */
function overrideWarnings(before, kit, deployment, said) {
  if (deployment === null) return [];
  const app = text(kit.files.get('app.json')?.id);
  const overridden = app === undefined ? undefined : deployment.apps.get(app);
  if (overridden === undefined) {
    said.push(
      `${deployment.shown} overrides none of ${app === undefined ? 'this package' : `the app ${app}`}'s files.`,
    );
    return [];
  }
  const warnings = [];
  for (const [path, version] of overridden) {
    let item = path;
    for (const [pattern, name] of OVERRIDABLE) {
      const match = pattern.exec(path);
      if (match) {
        item = name(match);
        break;
      }
    }
    const was = before?.files.get(path);
    const is = kit.files.get(path);
    if (JSON.stringify(was) === JSON.stringify(is)) continue;
    const change = was === undefined ? 'adds' : is === undefined ? 'removes' : 'changes';
    warnings.push({
      item,
      path,
      version,
      what:
        `${kit.name} ${kit.version} ${change} ${path}, which this deployment overrides at version ${version} of its ` +
        `deployment layer (${deployment.shown}). The override still wins, so ${app}'s people see none of the kit's ` +
        (change === 'removes'
          ? 'removal: the override is then the only version of the file. '
          : 'change until an administrator opens the file in the layout designer, takes the change into a new draft and has it approved. ') +
        "Rolling the override back to the package's version shows the kit's instead.",
    });
  }
  return warnings;
}

/**
 * Each finding against the notes: one that needs a note and has one in range is covered, and one
 * that has none is refused, saying where its note goes. A note in range that covers nothing is
 * said, not refused: an item removed and then put back between the two versions leaves one.
 */
function settle(found, reading, from, to, surface, { side, file, findings, covered, said }) {
  for (const problem of reading.problems)
    findings.push({ side, item: `notes ${file}`, kind: 'note', what: problem });
  const inRange = reading.notes.filter((note) => crosses(note.version, from, to));
  const used = new Set();
  for (const finding of found) {
    if (finding.kind === 'dangling') {
      findings.push({ side, ...finding });
      continue;
    }
    const note = inRange.find((each) => each.items.includes(finding.item));
    if (!note) {
      findings.push({
        side,
        ...finding,
        what:
          `${finding.what} Its migration note goes in ${file}: { "version": "${to === null || to === from ? '<the version that ships it>' : to}", ` +
          `"item": "${finding.item}", "note": "<what a customer does>" }, with "renamedTo" for a rename.`,
      });
      continue;
    }
    used.add(note);
    if (note.renamedTo !== undefined && !surface.has(note.renamedTo))
      findings.push({
        side,
        item: finding.item,
        kind: 'note',
        what: `The note for ${finding.item} says it is renamed to ${note.renamedTo}, which the ${side === 'kit' ? 'package' : 'platform'} as it is does not have.`,
      });
    else covered.push({ side, item: finding.item, what: finding.what, note });
  }
  for (const note of inRange)
    if (!used.has(note))
      said.push(
        `the note for ${list(note.items)}, at ${note.version}, covers nothing this upgrade removes or changes.`,
      );
}

/** Whether a note's version is one the upgrade from `from` to `to` crosses: (from, to]. */
function crosses(version, from, to) {
  const [note, low, high] = [
    parseVersion(version),
    from && parseVersion(from),
    to && parseVersion(to),
  ];
  if (!note || !high) return false;
  return compareVersions(note, high) <= 0 && (!low || compareVersions(note, low) > 0);
}

/**
 * The kit's own findings, as it was against as it is: removals, layers, dangling names. `platform`
 * is the platform as it is, whose menu prefix and catalogue they are said with.
 */
function kitFindings(before, kit, platform) {
  const found = [];
  const [was, is] = [surfaceOf(before), surfaceOf(kit)];
  const menuPrefix =
    [...platform.surface]
      .find((item) => item.startsWith('menu-prefix '))
      ?.slice('menu-prefix '.length) ?? 'appMenu.';
  const dangling = new Set();

  // What the package as it is still names, and has lost.
  const labelsNow = labelsByLanguage(kit);
  const labelsThen = labelsByLanguage(before);
  const catalogue = platform.catalogue;
  for (const [key, files] of labelReferences(kit)) {
    const hadIt = [...labelsThen.values()].some((labels) => labels.has(key));
    const hasIt = [...labelsNow.values()].some((labels) => labels.has(key));
    if (!hadIt || hasIt || catalogue.has(key)) continue;
    dangling.add(key);
    found.push({
      item: `label-key ${key}`,
      kind: 'dangling',
      what:
        `The label key ${key} is gone from every labels file of the package, and ${list(files)} ` +
        'still names it, so the page shows the key. Put the key back, or stop naming it: a note does not mend it.',
    });
  }
  const propertiesNow = propertiesOf(kit);
  for (const [property, files] of propertyReferences(kit, before)) {
    if (
      !was.has(`property ${property}`) ||
      is.has(`property ${property}`) ||
      propertiesNow.has(property)
    )
      continue;
    dangling.add(property);
    found.push({
      item: `property ${property}`,
      kind: 'dangling',
      what:
        `The property ${property} is gone from the package's schema, and ${list(files)} still names ` +
        'it, so what names it shows nothing, sorts on nothing or never passes. Put the property back, ' +
        'or stop naming it: a note does not mend it.',
    });
  }

  // A page provider the kit's queues and home read, and a document type its layouts are for.
  for (const [item, files] of namedByTheKit(kit)) {
    if (!was.has(item) || is.has(item)) continue;
    dangling.add(item);
    const [kind, id] = split(item);
    found.push({
      item,
      kind: 'dangling',
      what:
        (kind === 'type'
          ? `The document type ${id} is gone from the package, and ${list(files)} still contributes a layout for it.`
          : `The page provider ${id} is gone from the package, and ${list(files)} still names it, so it shows no records.`) +
        ' Put it back, or stop naming it: a note does not mend it.',
    });
  }

  // Removed or renamed: what the package had that a customer may override or name.
  const added = [...is.keys()].filter((item) => !was.has(item));
  for (const [item, { under }] of was) {
    if (is.has(item) || (under !== undefined && !is.has(under))) continue;
    const [kind, id] = split(item);
    if (kind === 'property' && dangling.has(id)) continue;
    if (dangling.has(item)) continue;
    if (kind === 'label' && dangling.has(id.slice(id.indexOf(' ') + 1))) continue;
    const alike = added.filter((other) => split(other)[0] === kind);
    found.push({
      item,
      kind: 'removed',
      what:
        removal(kind, id, { before, kit, menuPrefix }) +
        (alike.length > 0
          ? ` If it was renamed, it may be ${list(alike.slice(0, 3), 'nothing', 'or')}${alike.length > 3 ? ', or another the package now has' : ''}.`
          : ''),
    });
  }

  // Layers: the components' order, and which component contributes what.
  const componentsThen = new Map(before.components.map((component) => [component.name, component]));
  const componentsNow = new Map(kit.components.map((component) => [component.name, component]));
  for (const [name, then] of componentsThen) {
    const now = componentsNow.get(name);
    if (!now || same(then.requires, now.requires)) continue;
    found.push({
      item: `requires ${name}`,
      kind: 'precedence',
      what:
        `The component ${name} required ${list(then.requires, 'nothing')} and now requires ` +
        `${list(now.requires, 'nothing')}: Nuxeo registers its contributions at another place in the ` +
        "order, so which of them and a customer's wins over the other can change.",
    });
  }
  const contributorsThen = contributors(before);
  const contributorsNow = contributors(kit);
  for (const [key, from] of contributorsThen) {
    const to = contributorsNow.get(key);
    // A component that is gone is its own finding, which says the same of everything it contributed.
    if (to === undefined || to === from || !componentsNow.has(from)) continue;
    found.push({
      item: `contributor ${key}`,
      kind: 'precedence',
      what:
        `${describeKey(key)} was contributed by ${from} and is now by ${to}: a customer component ` +
        `that requires ${from}, so as to come after it, may now come before ${to}, and its ` +
        "replacement lose to the package's.",
    });
  }
  const disabledThen = disabledKeys(before);
  for (const key of disabledKeys(kit))
    if (!disabledThen.has(key))
      found.push({
        item: `disables ${key}`,
        kind: 'precedence',
        what:
          `The package now disables ${lowerFirst(describeKey(key))}, contributed before it, with enabled="false": ` +
          'a customer configuration that relied on it loses it.',
      });
  return found;
}

/** What a removed item takes from a customer's configuration. */
function removal(kind, id, { kit, menuPrefix }) {
  const [first, second] = id.split('/');
  switch (kind) {
    case 'layout':
      return (
        `The ${second} layout of ${first} records is removed. A customer package that replaces it ` +
        'or disables it now acts on a layout this package no longer ships, and with none, the ' +
        `platform generates the ${second} layout of ${first} records again.`
      );
    case 'fragment':
      return (
        `The ${first} fragment ${second} is removed: a customer package that replaces it by the same ` +
        'name and layer now adds a fragment of its own, and one that disables it removes nothing.'
      );
    case 'asset':
      return (
        `The asset ${id} is removed: a customer's bootstrap or manifest that names ` +
        `/nuxeo/agentic-ui-config/assets/${id} shows nothing.`
      );
    case 'app':
      return (
        `The package no longer contributes the app ${id}: the app registry stops serving it, so ` +
        '"Switch app" no longer lists it and a link a customer kept to it finds nothing.'
      );
    case 'component':
      return (
        `The component ${id} is gone. Nuxeo leaves a component whose <require> names a missing ` +
        `component unstarted, so a customer component that requires ${id}, to layer its ` +
        "configuration after this package's, contributes nothing."
      );
    case 'schema':
      return (
        `The schema ${id} is gone: a customer's layout, queue or rule that names one of its ` +
        'properties shows nothing, sorts on nothing or never passes.'
      );
    case 'property':
      return (
        `The property ${id} is removed from the package's schema: a customer's layout, queue, rule ` +
        'or computation that names it shows nothing, sorts on nothing or never passes.'
      );
    case 'type':
      return (
        `The document type ${id} is gone: a customer's layout for it or rule naming it stops ` +
        'working, and a record of it cannot be read.'
      );
    case 'page-provider':
      return `The page provider ${id} is gone: a customer's queue or home card that names it shows no records and no figure.`;
    case 'queue':
      return (
        `The queue ${id} is removed: a link a customer kept to /queues/${id}, or a menu entry or ` +
        'home card of their own naming it, stops working.'
      );
    case 'task-form':
      return `The task form of ${id} is removed: the step's tasks fall back to the form generated from its variables.`;
    case 'home':
      return "The app's home is removed: /home says that none is configured.";
    case 'menu':
      return (
        "The app's menu is removed: its entries leave the navbar, and a customer manifest that " +
        'overrides one of them by its ID overrides nothing.'
      );
    case 'menu-entry':
      return (
        `The menu entry ${id} is removed: a customer manifest that overrides ${menuPrefix}${id}, to ` +
        'hide, move or relabel it, overrides nothing.'
      );
    case 'labels':
      return (
        `The labels for ${id} are removed: people reading ${id} lose the package's texts, and see ` +
        "another language's, or the key."
      );
    case 'label': {
      const at = id.indexOf(' ');
      const [language, key] = [id.slice(0, at), id.slice(at + 1)];
      return (
        `The label ${key}, in ${language}, is removed: a customer manifest's labels that give it ` +
        "another text give it to nothing, and a customer's file that names it shows another " +
        "language's text, or the key."
      );
    }
    case 'action':
      return (
        `The action ${id} is removed: a customer's queue or record page that names it, or a ` +
        'manifest that overrides it, loses the button.'
      );
    case 'address': {
      const app = kit.files.get('app.json');
      const now = isRecord(app) ? (text(app['address']) ?? text(app['id'])) : undefined;
      return `The app's address is ${now ?? 'gone'}, and was ${id}: a link a customer kept to the old one stops working.`;
    }
    default:
      return `${kind} ${id} is removed.`;
  }
}

// --- The platform, as it was and as it is ----------------------------------------------------------

/**
 * What the platform no longer has, of what the package names as it was or as it is. Named as it
 * is, it is dangling, and no note mends it; named only as it was, it is a configuration made on the
 * earlier version that breaks.
 */
function platformFindings(before, kit, previous, current) {
  const found = [];
  for (const missing of current.missing) {
    const key = Object.entries(PLATFORM_SOURCES).find(([, path]) => path === missing)?.[0];
    if (key === undefined || previous.missing.includes(missing)) continue;
    found.push({
      item: `source ${missing}`,
      kind: 'dangling',
      what:
        `The platform as it is has no ${missing}, where this check reads what it registers, and the ` +
        'platform as it was had one. If it moved, the check must read it where it is now ' +
        '(PLATFORM_SOURCES in scripts/app-upgrade-check.mjs).',
    });
  }
  const sourceGone = (item) =>
    [...(previous.sources.get(item) ?? [])].every((source) =>
      current.missing.includes(PLATFORM_SOURCES[source]),
    );
  // The menu's prefix is the platform's to apply, not the kit's to name: a new one is never the
  // kit's to mend, and breaks only overrides made of the menu as it was.
  const now = platformUses(kit, previous, false);
  const then = before === null ? new Map() : platformUses(before, previous, true);
  for (const [item, files] of new Map([...then, ...now])) {
    if (!previous.surface.has(item) || current.surface.has(item) || sourceGone(item)) continue;
    const [kind, id] = split(item);
    if (now.has(item))
      found.push({
        item,
        kind: 'dangling',
        what:
          `The platform no longer has ${platformText(kind, id)}, and ${kit.name} ${kit.version} still ` +
          `names it, in ${list([...now.get(item)])}. Mend the kit: a note does not.`,
      });
    else
      found.push({
        item,
        kind: 'removed',
        what: `The platform no longer has ${platformText(kind, id)}, which ${before.name} ${before.version} named, in ${list([...files])}: ${platformLoss(kind, id)}`,
      });
  }
  return found;
}

function platformText(kind, id) {
  switch (kind) {
    case 'id':
      return `the ID ${id}`;
    case 'widget':
      return `the widget ${id}`;
    case 'component':
      return `the component ${id}`;
    case 'extension-point':
      return `the extension point ${id}`;
    case 'descriptor':
      return `the descriptor ${id}`;
    case 'menu-prefix':
      return `${id}<entry> as the ID of an app's menu entry`;
    default:
      return `${kind} ${id}`;
  }
}

function platformLoss(kind, id) {
  switch (kind) {
    case 'id':
    case 'widget':
      return (
        'a configuration made on that version that names it is refused when its package is built, ' +
        'and, loaded, loses the card, field, column or entry that names it.'
      );
    case 'component':
      return 'Nuxeo leaves a component that requires it unstarted, so such a package contributes nothing.';
    case 'extension-point':
      return 'what such a package contributes there is registered by nothing.';
    case 'descriptor':
      return 'Nuxeo ignores what such a package writes there.';
    case 'menu-prefix':
      return `a customer manifest that overrides ${id}<entry>, to hide, move or relabel an app's menu entry, overrides nothing.`;
    default:
      return 'a configuration that names it breaks.';
  }
}

/**
 * Every item of the platform the package names, with the files that name it; with `withPrefix`,
 * also the prefix the platform as it was gave the package's menu entries in the navbar slot.
 */
function platformUses(kit, previous, withPrefix) {
  const uses = new Map();
  const add = (item, file) => {
    if (!uses.has(item)) uses.set(item, new Set());
    uses.get(item).add(file);
  };
  for (const [place, content] of kit.files) {
    if (/^labels\//.test(place)) continue;
    const file = `bundle/agentic-ui-config/${place}`;
    walk(content, undefined, (value, key) => {
      if (typeof value !== 'string' || key === 'label' || key === 'labelKey' || key === '$schema')
        return;
      if (key === 'widget') add(`widget ${value}`, file);
      else if (/^(?:app|core|nxs)\.[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/.test(value))
        add(`id ${value}`, file);
    });
    // The app's menu entries are registered in the navbar slot under the platform's prefix.
    if (withPrefix && place === 'navigation.json' && registeredEntryIds(content).length > 0)
      for (const item of previous.surface) if (item.startsWith('menu-prefix ')) add(item, file);
  }
  for (const component of kit.components) {
    const file = `bundle/${component.path}`;
    for (const name of component.requires) add(`component ${name}`, file);
    for (const { target, point } of component.extensions) {
      if (target === undefined) continue;
      add(`component ${target}`, file);
      add(`extension-point ${target}/${point}`, file);
    }
    for (const contribution of component.contributions) {
      add(`descriptor ${contribution.element}`, file);
      for (const name of contribution.attributes)
        add(`descriptor ${contribution.element}@${name}`, file);
      for (const child of contribution.children)
        if (child.attributes.length === 0)
          add(`descriptor ${contribution.element}/${child.child}`, file);
        else
          for (const name of child.attributes)
            add(`descriptor ${contribution.element}/${child.child}@${name}`, file);
    }
  }
  return uses;
}

/**
 * What the platform at `root` registers, as items, each with the sources that list it; its version;
 * and the sources it does not have.
 */
export async function readPlatform(root) {
  const surface = new Set();
  const sources = new Map();
  const missing = [];
  const add = (item, source) => {
    surface.add(item);
    if (!sources.has(item)) sources.set(item, new Set());
    sources.get(item).add(source);
  };

  const reference = textAt(root, PLATFORM_SOURCES.reference);
  if (reference === null) missing.push(PLATFORM_SOURCES.reference);
  else for (const id of documentedIds(reference)) add(`id ${id}`, 'reference');

  const registries = await registriesAt(root);
  if (registries === null) missing.push(PLATFORM_SOURCES.registries);
  else {
    for (const group of ['rules', 'computations', 'checks'])
      for (const id of Object.keys(registries[group] ?? {})) add(`id ${id}`, 'registries');
    for (const group of ['rowActions', 'bulkActions', 'pages'])
      for (const id of registries[group] ?? []) add(`id ${id}`, 'registries');
    for (const name of Object.keys(registries.widgets ?? {})) add(`widget ${name}`, 'registries');
  }

  const components = filesAt(root, PLATFORM_SOURCES.components, '.xml');
  const descriptors = filesAt(root, PLATFORM_SOURCES.descriptors, '.java');
  if (components === null) missing.push(PLATFORM_SOURCES.components);
  if (descriptors === null) missing.push(PLATFORM_SOURCES.descriptors);
  const byClass = new Map();
  for (const [, java] of descriptors ?? []) {
    const code = java.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const element = /@XObject\(\s*(?:value\s*=\s*)?"([^"]+)"/.exec(code)?.[1];
    const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(code)?.[1];
    const type = /\bclass\s+([A-Za-z_]\w*)/.exec(code)?.[1];
    if (!element || !type) continue;
    const paths = [...code.matchAll(/@XNode(?:List|Map)?\(\s*(?:value\s*=\s*)?"([^"]*)"/g)].map(
      ([, path]) => path,
    );
    byClass.set(pkg ? `${pkg}.${type}` : type, { element, paths });
  }
  for (const [, source] of components ?? []) {
    const xml = componentXmlOf(source);
    const name = attribute(xml, 'component', 'name');
    if (!name) continue;
    add(`component ${name}`, 'components');
    for (const point of xml.matchAll(
      new RegExp(`<extension-point${TAG}([\\s\\S]*?)</extension-point[ \\t\\r\\n]*>`, 'g'),
    )) {
      const pointName = attributesOf(point[1]).name;
      if (!pointName) continue;
      add(`extension-point ${name}/${pointName}`, 'components');
      for (const object of point[2].matchAll(new RegExp(`<object${TAG}`, 'g'))) {
        const descriptor = byClass.get(attributesOf(object[1]).class ?? '');
        if (!descriptor) continue;
        add(`descriptor ${descriptor.element}`, 'descriptors');
        for (const path of descriptor.paths)
          add(
            `descriptor ${descriptor.element}${path.startsWith('@') ? '' : '/'}${path}`,
            'descriptors',
          );
      }
    }
  }

  const menu = textAt(root, PLATFORM_SOURCES.menu);
  if (menu === null) missing.push(PLATFORM_SOURCES.menu);
  else {
    const prefix = /APP_MENU_ID_PREFIX\s*=\s*(['"`])([^'"`]*)\1/.exec(menu)?.[2];
    if (prefix !== undefined) add(`menu-prefix ${prefix}`, 'menu');
  }

  let version = null;
  const manifest = textAt(root, PLATFORM_SOURCES.version);
  if (manifest === null) missing.push(PLATFORM_SOURCES.version);
  else {
    try {
      const parsed = JSON.parse(manifest);
      version = typeof parsed.version === 'string' ? parsed.version : null;
    } catch {
      throw new Usage(`${PLATFORM_SOURCES.version} under ${root} is not JSON.`);
    }
  }
  return { root, version, surface, sources, missing, catalogue: catalogueKeys(root) };
}

/**
 * The registries the validator holds a kit to, as `registries.ts` at `root` exports them, or
 * `null` when it has none. It is imported, with the library it sits in checked for links first: it
 * is plain data, and the repository's own reviewed code at the ref it comes from.
 */
async function registriesAt(root) {
  const file = join(root, ...PLATFORM_SOURCES.registries.split('/'));
  if (textAt(root, PLATFORM_SOURCES.registries) === null) return null;
  const library = dirname(file);
  const link = firstLink(library);
  if (link !== null)
    throw new Usage(`${relative(root, link)} is a symbolic link, which is not followed.`);
  let module;
  try {
    module = await import(pathToFileURL(file).href);
  } catch (error) {
    throw new Usage(
      `${PLATFORM_SOURCES.registries} under ${root} cannot be loaded, so what it registers cannot be read: ${error.message}`,
    );
  }
  if (!isRecord(module.PACKAGED_REGISTRIES))
    throw new Usage(
      `${PLATFORM_SOURCES.registries} under ${root} exports no PACKAGED_REGISTRIES, so what it registers cannot be read.`,
    );
  return module.PACKAGED_REGISTRIES;
}

/**
 * The IDs `docs/extension-reference.md` documents as real, read as its drift gate reads them
 * (`scripts/beta-harness/extension-reference-drift.mjs`, `documentedIds`): backticked `app.` and
 * `nxs.` IDs of three parts, outside fenced code, that are not file names.
 */
function documentedIds(reference) {
  const ids = new Set();
  for (const match of reference
    .replace(/```[\s\S]*?```/g, '')
    .matchAll(/`((?:app|nxs)\.[a-zA-Z0-9.]+)`/g)) {
    if (/\.(ts|mjs|json|html|scss|md)$/.test(match[1])) continue;
    if (match[1].split('.').length !== 3) continue;
    ids.add(match[1]);
  }
  return ids;
}

/** The keys of the platform's English catalogue, which a label key the package drops may still have. */
function catalogueKeys(root) {
  const text = textAt(root, CATALOGUE);
  if (text === null) return new Set();
  const keys = new Set();
  const visit = (value, prefix) => {
    if (isRecord(value))
      for (const [key, inner] of Object.entries(value)) visit(inner, `${prefix}${key}.`);
    else keys.add(prefix.slice(0, -1));
  };
  try {
    visit(JSON.parse(text), '');
  } catch {
    return new Set();
  }
  return keys;
}

// --- Reading a package ----------------------------------------------------------------------------

/**
 * A configuration package as this check reads it: its name and version, the JSON files of its app
 * definition by their place, and its components. A link anywhere in it stops the run.
 */
export function readKit(directory) {
  const shown = shownPath(directory);
  const link = firstLink(directory);
  if (link !== null)
    throw new Usage(
      `${shown}: ${relative(directory, link).split(sep).join('/')} is a symbolic link, which is not followed.`,
    );
  const descriptorFile = join(directory, 'package', 'package.xml');
  if (!isFile(descriptorFile)) throw new Usage(`${shown} has no package/package.xml.`);
  const descriptor = withoutCdata(
    withoutCommentsOrInstructions(readFileSync(descriptorFile, 'utf8')),
  );
  const name = attribute(descriptor, 'package', 'name');
  const version = attribute(descriptor, 'package', 'version');
  if (!name || !version || !parseVersion(version))
    throw new Usage(
      `${shown}: package/package.xml has no <package name="..." version="..."> with a semantic version.`,
    );
  const root = join(directory, 'bundle', 'agentic-ui-config');
  const files = new Map();
  if (isDirectory(root))
    for (const place of filesUnder(root).sort()) {
      if (!place.endsWith('.json') || /^(?:demo|assets)\//.test(place)) continue;
      files.set(place, json(readFileSync(join(root, place), 'utf8')));
    }
  return { directory, shown, name, version, files, components: readComponents(directory) };
}

/** The components the manifest names, as the pipeline finds them: inside `bundle/`, files. */
function readComponents(directory) {
  const bundle = resolve(directory, 'bundle');
  const manifest = join(bundle, 'META-INF', 'MANIFEST.MF');
  if (!isFile(manifest)) return [];
  const components = [];
  for (const path of componentPathsOf(readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''))) {
    const file = resolve(bundle, path);
    // One outside the bundle, or missing, is the pipeline's to refuse, at steps 2 and 4.
    if (isAbsolute(path) || !file.startsWith(bundle + sep) || !isFile(file)) continue;
    components.push(componentOf(path, componentXmlOf(readFileSync(file, 'utf8')), bundle));
  }
  return components;
}

function componentOf(path, xml, bundle) {
  const name = attribute(xml, 'component', 'name') ?? path;
  const requires = [...xml.matchAll(/<require[ \t\r\n]*>([\s\S]*?)<\/require[ \t\r\n]*>/g)]
    .map(([, required]) => required.trim())
    .filter(Boolean);
  const extensions = [];
  const contributions = [];
  const schemas = [];
  const doctypes = [];
  for (const extension of xml.matchAll(
    new RegExp(`<extension${TAG}([\\s\\S]*?)</extension[ \\t\\r\\n]*>`, 'g'),
  )) {
    const { target, point } = attributesOf(extension[1]);
    const body = extension[2];
    extensions.push({ target, point });
    if (target === CONFIGURATION.target && point === CONFIGURATION.point)
      contributions.push(...contributionsIn(body));
    if (target === TYPES && point === 'schema')
      for (const [, tag] of body.matchAll(new RegExp(`<schema${TAG}`, 'g'))) {
        const { name: schema, prefix, src } = attributesOf(tag);
        if (schema && prefix && src)
          schemas.push({ name: schema, prefix, properties: topLevelElements(bundle, src) });
      }
    if (target === TYPES && point === 'doctype')
      for (const [, tag] of body.matchAll(new RegExp(`<doctype${TAG}`, 'g'))) {
        const { name: type } = attributesOf(tag);
        if (type) doctypes.push(type);
      }
  }
  const pageProviders = [
    ...xml.matchAll(new RegExp(`<(?:coreQueryPageProvider|genericPageProvider)${TAG}`, 'g')),
  ]
    .map(([, tag]) => attributesOf(tag).name)
    .filter(Boolean);
  return { path, name, requires, extensions, contributions, schemas, doctypes, pageProviders };
}

/** The layouts, fragments, assets and apps of one configuration extension, with what they write. */
function contributionsIn(body) {
  const found = [];
  for (const match of body.matchAll(new RegExp(`<(layout|fragment|asset|app)${TAG}`, 'g'))) {
    const [whole, element, tag] = match;
    const attributes = attributesOf(tag);
    const enabled = attributes.enabled === undefined || attributes.enabled.toLowerCase() === 'true';
    const key =
      element === 'layout'
        ? `layout ${attributes.type}/${attributes.mode}`
        : element === 'fragment'
          ? `fragment ${attributes.layer}/${attributes.name}`
          : element === 'asset'
            ? `asset ${attributes.name}`
            : `app ${attributes.id}`;
    const start = match.index + whole.length;
    const end = tag.trimEnd().endsWith('/') ? start : body.indexOf(`</${element}`, start);
    const children = [
      ...body
        .slice(start, end === -1 ? body.length : end)
        .matchAll(/<([A-Za-z][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g),
    ].map(([, child, rest]) => ({ child, attributes: Object.keys(attributesOf(rest)) }));
    found.push({ element, key, enabled, attributes: Object.keys(attributes), children });
  }
  return found;
}

/**
 * The names of a schema's properties: the elements directly under `<xs:schema>`. `null` when the
 * file is not there, which leaves its properties out rather than reading them all as removed.
 */
function topLevelElements(bundle, src) {
  const file = resolve(bundle, src);
  if (isAbsolute(src) || !file.startsWith(bundle + sep) || !isFile(file)) return null;
  const xml = withoutCdata(withoutCommentsOrInstructions(readFileSync(file, 'utf8')));
  const open = [];
  const names = [];
  for (const [, close, tag, rest] of xml.matchAll(
    /<(\/)?([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
  )) {
    const local = tag.slice(tag.lastIndexOf(':') + 1);
    if (close) {
      open.pop();
      continue;
    }
    if (local === 'element' && open.length === 1 && open[0] === 'schema') {
      const { name } = attributesOf(rest);
      if (name) names.push(name);
    }
    if (!rest.trimEnd().endsWith('/')) open.push(local);
  }
  return names;
}

/**
 * What a customer may override or name, by item, each with the file it is in and, for one that
 * goes with another, that other: a removed menu takes its entries with it, a removed labels file its
 * keys, a removed schema its properties, and each is said once.
 */
function surfaceOf(kit) {
  const items = new Map();
  const add = (item, file, under) => {
    if (!items.has(item)) items.set(item, { file, under });
  };
  for (const component of kit.components) {
    const file = `bundle/${component.path}`;
    add(`component ${component.name}`, file);
    for (const contribution of component.contributions)
      if (contribution.enabled) add(contribution.key, file);
    for (const schema of component.schemas) {
      add(`schema ${schema.name}`, file);
      for (const property of schema.properties ?? [])
        add(`property ${schema.prefix}:${property}`, file, `schema ${schema.name}`);
    }
    for (const type of component.doctypes) add(`type ${type}`, file);
    for (const provider of component.pageProviders) add(`page-provider ${provider}`, file);
  }
  for (const [place, content] of kit.files) {
    const file = `bundle/agentic-ui-config/${place}`;
    let match;
    if ((match = /^queues\/([^/]+)\.json$/.exec(place))) add(`queue ${match[1]}`, file);
    else if ((match = /^tasks\/([^/]+)\.layout\.json$/.exec(place)))
      add(`task-form ${match[1]}`, file);
    else if (place === 'home.json') add('home', file);
    else if (place === 'navigation.json') {
      add('menu', file);
      for (const id of registeredEntryIds(content)) add(`menu-entry ${id}`, file, 'menu');
    } else if ((match = /^labels\/([^/]+)\.json$/.exec(place))) {
      add(`labels ${match[1]}`, file);
      for (const key of Object.keys(labelsIn(content)))
        add(`label ${match[1]} ${key}`, file, `labels ${match[1]}`);
    } else if (place === 'actions.json') {
      const actions =
        isRecord(content) && Array.isArray(content['actions']) ? content['actions'] : [];
      for (const action of actions)
        if (isRecord(action) && typeof action['id'] === 'string')
          add(`action ${action['id']}`, file);
    } else if (place === 'app.json' && isRecord(content)) {
      const address = text(content['address']) ?? text(content['id']);
      if (address !== undefined) add(`address ${address}`, file);
    }
  }
  return items;
}

/**
 * The ids of the menu's entries that the `navbar` slot registers, as `appMenu.<id>`: those that
 * open a queue or the home. One that opens a platform page is not added, since the platform's own
 * entry is in the menu already (`appMenuItems` in apps/nuxeo-ui), so no manifest can override it.
 */
function registeredEntryIds(content) {
  const entries = isRecord(content) && Array.isArray(content['entries']) ? content['entries'] : [];
  return entries.flatMap((entry) =>
    isRecord(entry) &&
    typeof entry['id'] === 'string' &&
    (typeof entry['queue'] === 'string' || entry['page'] === 'home')
      ? [entry['id']]
      : [],
  );
}

function labelsIn(content) {
  const labels = isRecord(content) ? content['labels'] : undefined;
  return isRecord(labels) ? labels : {};
}

function labelsByLanguage(kit) {
  const byLanguage = new Map();
  for (const [place, content] of kit.files) {
    const match = /^labels\/([^/]+)\.json$/.exec(place);
    if (match) byLanguage.set(match[1], new Set(Object.keys(labelsIn(content))));
  }
  return byLanguage;
}

/** Each label key the package's files name, with the files that name it. */
function labelReferences(kit) {
  const found = new Map();
  for (const [place, content] of kit.files) {
    if (/^labels\//.test(place)) continue;
    walk(content, undefined, (value, key) => {
      if (key !== 'labelKey' || typeof value !== 'string') return;
      if (!found.has(value)) found.set(value, new Set());
      found.get(value).add(`bundle/agentic-ui-config/${place}`);
    });
  }
  return found;
}

/** The properties of the package's own schemas, `<prefix>:<name>`. */
function propertiesOf(kit) {
  return new Set(
    kit.components.flatMap((component) =>
      component.schemas.flatMap((schema) =>
        (schema.properties ?? []).map((property) => `${schema.prefix}:${property}`),
      ),
    ),
  );
}

/**
 * Each property of the package's own schemas, as it was or as it is, that its files name as it is:
 * a field, a column or a sort, a rule's or a computation's `{ "field" }`, and a template's
 * `{<prefix>:<name>}`. A property of a schema that is not the package's, such as `dc:title`, is
 * the platform's, and is not weighed here.
 */
function propertyReferences(kit, before) {
  const prefixes = new Set(
    [...kit.components, ...before.components].flatMap((component) =>
      component.schemas.map((schema) => schema.prefix),
    ),
  );
  const found = new Map();
  const note = (property, file) => {
    if (!prefixes.has(property.slice(0, property.indexOf(':')))) return;
    if (!found.has(property)) found.set(property, new Set());
    found.get(property).add(file);
  };
  const XPATH = /^[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*$/;
  for (const [place, content] of kit.files) {
    if (/^labels\//.test(place)) continue;
    const file = `bundle/agentic-ui-config/${place}`;
    walk(content, undefined, (value, key) => {
      if (
        typeof value === 'string' &&
        ['field', 'fields', 'columns'].includes(key) &&
        XPATH.test(value)
      )
        note(value, file);
      if (
        isRecord(value) &&
        value['type'] === 'core.template' &&
        Array.isArray(value['parameters'])
      )
        for (const parameter of value['parameters'])
          if (typeof parameter === 'string')
            for (const [, property] of parameter.matchAll(/\{([A-Za-z_][\w-]*:[A-Za-z_][\w-]*)\}/g))
              note(property, file);
    });
  }
  return found;
}

/** Each contribution's key, with the component that contributes it. */
function contributors(kit) {
  const by = new Map();
  const add = (key, component) => {
    if (!by.has(key)) by.set(key, component.name);
  };
  for (const component of kit.components) {
    for (const contribution of component.contributions)
      if (contribution.enabled) add(contribution.key, component);
    // What the model contributes is layered the same way: a later schema, type or page provider of
    // the same name wins, so one that moves can come before a customer's override of it.
    for (const schema of component.schemas) add(`schema ${schema.name}`, component);
    for (const type of component.doctypes) add(`type ${type}`, component);
    for (const provider of component.pageProviders) add(`page-provider ${provider}`, component);
  }
  return by;
}

/**
 * What the package as it is names of its own model, which must still be there: each page provider
 * a queue or a home's figure reads, and the document type of each layout it contributes. Each with
 * the files that name it.
 */
function namedByTheKit(kit) {
  const named = new Map();
  const add = (item, file) => {
    if (!named.has(item)) named.set(item, new Set());
    named.get(item).add(file);
  };
  for (const [place, content] of kit.files)
    walk(content, undefined, (value, key) => {
      if (key === 'pageProvider' && typeof value === 'string')
        add(`page-provider ${value}`, `bundle/agentic-ui-config/${place}`);
    });
  for (const component of kit.components)
    for (const contribution of component.contributions)
      if (contribution.enabled && contribution.element === 'layout')
        add(
          `type ${contribution.key.slice('layout '.length).split('/')[0]}`,
          `bundle/${component.path}`,
        );
  return named;
}

function disabledKeys(kit) {
  return new Set(
    kit.components.flatMap((component) =>
      component.contributions.filter((each) => !each.enabled).map((each) => each.key),
    ),
  );
}

function describeKey(key) {
  const [kind, id] = split(key);
  if (kind === 'schema') return `The schema ${id}`;
  if (kind === 'type') return `The document type ${id}`;
  if (kind === 'page-provider') return `The page provider ${id}`;
  if (kind === 'layout') {
    const [type, mode] = id.split('/');
    return `The ${mode} layout of ${type} records`;
  }
  if (kind === 'fragment') return `The ${id.replace('/', ' fragment ')}`;
  if (kind === 'asset') return `The asset ${id}`;
  return `The app ${id}`;
}

// --- Notes ------------------------------------------------------------------------------------------

/**
 * A notes file: `{ "version": 1, "notes": [...] }`. A note is `{ "version", "item", "renamedTo"?,
 * "note" }`, or `{ "version", "items", "note" }` for one change that takes several items, such as
 * an action and its labels; every item one of `kinds`. Absent, the file has no note. What cannot be
 * read is a problem, and refused: a file read in part could cover what it does not say.
 */
export function readNotes(root, rel, kinds, shown) {
  const entry = entryAt(root, rel);
  if (entry === null) return { notes: [], problems: [] };
  if (!entry.isFile()) return { notes: [], problems: [`${shown} is not a file.`] };
  const content = json(readFileSync(join(root, ...rel.split('/')), 'utf8'));
  const problems = [];
  const refuse = (where, problem) => problems.push(`${shown}${where}: ${problem}`);
  if (!isRecord(content)) {
    refuse('', 'is not a JSON object.');
    return { notes: [], problems };
  }
  for (const key of Object.keys(content))
    if (!['$schema', 'version', 'notes'].includes(key))
      refuse('', `has the key "${key}", which a notes file does not have.`);
  if (content['version'] !== 1) refuse('', 'says no "version": 1.');
  if (!Array.isArray(content['notes'])) {
    refuse('', 'has no "notes" list.');
    return { notes: [], problems };
  }
  const notes = [];
  const seen = new Set();
  const itemProblem = (item) => {
    if (typeof item !== 'string') return 'is not a text';
    const [kind, id] = split(item);
    if (!kinds.has(kind))
      return `names the kind "${kind}", which is not one of ${[...kinds.keys()].join(', ')}`;
    if (kinds.get(kind) === (id === ''))
      return kinds.get(kind) ? `names no ${kind} after its kind` : `is "${kind}" alone`;
    return null;
  };
  for (const [index, note] of content['notes'].entries()) {
    const where = ` notes[${index}]`;
    if (!isRecord(note)) {
      refuse(where, 'is not an object.');
      continue;
    }
    const before = problems.length;
    for (const key of Object.keys(note))
      if (!['version', 'item', 'items', 'renamedTo', 'note'].includes(key))
        refuse(where, `has the key "${key}", which a note does not have.`);
    if (typeof note['version'] !== 'string' || !parseVersion(note['version']))
      refuse(
        where,
        `has the version ${JSON.stringify(note['version'])}, which is not a semantic version.`,
      );
    const one = note['item'] !== undefined;
    const several = note['items'] !== undefined;
    let items = [];
    if (one === several) refuse(where, 'names its items with one of "item" and "items".');
    else if (one) items = [note['item']];
    else if (!Array.isArray(note['items']) || note['items'].length === 0)
      refuse(`${where}.items`, 'is not a list of one item or more.');
    else items = note['items'];
    for (const [at, item] of items.entries()) {
      const problem = itemProblem(item);
      if (problem) refuse(`${where}.${one ? 'item' : `items[${at}]`}`, `${problem}.`);
    }
    if (note['renamedTo'] !== undefined) {
      const renamed = itemProblem(note['renamedTo']);
      if (!one) refuse(`${where}.renamedTo`, 'goes with one "item": a rename is of one thing.');
      else if (renamed) refuse(`${where}.renamedTo`, `${renamed}.`);
      else if (
        typeof note['item'] === 'string' &&
        split(note['renamedTo'])[0] !== split(note['item'])[0]
      )
        refuse(
          `${where}.renamedTo`,
          `is a ${split(note['renamedTo'])[0]}, and the item a ${split(note['item'])[0]}.`,
        );
    }
    if (typeof note['note'] !== 'string' || note['note'].trim() === '')
      refuse(where, 'has no "note": the text that tells a customer what to do.');
    if (problems.length > before) continue;
    const twice = items.find((item) => seen.has(`${item} ${note['version']}`));
    if (twice !== undefined) {
      refuse(where, `is a second note for ${twice} at ${note['version']}.`);
      continue;
    }
    for (const item of items) seen.add(`${item} ${note['version']}`);
    notes.push({
      version: note['version'],
      items,
      ...(note['renamedTo'] === undefined ? {} : { renamedTo: note['renamedTo'] }),
      note: note['note'].trim(),
    });
  }
  return { notes, problems };
}

// --- Output -----------------------------------------------------------------------------------------

export function report(results, asJson, gone = []) {
  const refused = results.some((result) => result.findings.length > 0);
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ kept: !refused, packages: results, gone }, null, 2)}\n`,
    );
    return refused ? 1 : 0;
  }
  for (const line of gone) console.log(line);
  for (const result of results) {
    const held =
      result.previous === null ? 'new, held to nothing of its own' : `held to ${result.previous}`;
    const platform =
      result.platform === null
        ? ''
        : `, on the platform ${result.platform.version ?? '(no version)'} held to ${result.platform.previous ?? '(no version)'}`;
    const verdict =
      result.findings.length === 0
        ? `every configuration is kept${result.covered.length > 0 ? `, ${result.covered.length} item(s) by their migration notes` : ''}.`
        : `refused, ${result.findings.length} finding(s):`;
    const out = result.findings.length === 0 ? console.log : console.error;
    out(`${result.directory}: ${result.package} ${result.version}, ${held}${platform}: ${verdict}`);
    for (const finding of result.findings)
      out(`  - ${finding.side}, ${finding.item}: ${finding.what}`);
    for (const [note, items] of byNote(result.covered))
      console.log(`  kept by the note for ${list(items)}, at ${note.version}: ${note.note}`);
    for (const warning of result.warnings)
      console.log(`  warning: ${warning.item}: ${warning.what}`);
    for (const line of result.said) console.log(`  note: ${line}`);
  }
  if (results.length === 0) console.log('No package to check.');
  return refused ? 1 : 0;
}

/** The covered items grouped by the note that covers them, so that each note is said once. */
function byNote(covered) {
  const notes = new Map();
  for (const each of covered) {
    if (!notes.has(each.note)) notes.set(each.note, []);
    notes.get(each.note).push(each.side === 'kit' ? each.item : `the platform's ${each.item}`);
  }
  return notes;
}

// --- Files and git ----------------------------------------------------------------------------------

function directoryOf(path, what) {
  const directory = resolve(path);
  if (!isDirectory(directory)) throw new Usage(`${what}, ${path}, is not a folder.`);
  return directory;
}

/** The packages under `business-apps/packages/` of `root`, each a folder with a package.xml. */
function kitsUnder(root) {
  const kits = join(root, ...KITS.split('/'));
  if (!isDirectory(kits)) return [];
  return readdirSync(kits)
    .sort()
    .map((name) => join(kits, name))
    .filter((directory) => isFile(join(directory, 'package', 'package.xml')));
}

/**
 * Where `kit` was at a commit: the place of the package of the same name, its own place first, so
 * that a kit whose folder was renamed is still held to what it was, and a kit moved into a folder
 * another package left is not held to that one. With none of its name, its own place when the
 * commit has a package there, which the name check then refuses, as the pipeline refuses a package
 * renamed; `null` for a package the commit did not have.
 */
function placeAt(root, commit, kit) {
  const place = relative(root, kit.directory).split(sep).join('/');
  if (place === '' || place.startsWith('..') || isAbsolute(place))
    throw new Usage(`${kit.directory} is not inside ${root}, so it has no place at a commit.`);
  const nameAt = (where) => {
    const shown = git(root, ['show', `${commit}:${where}/package/package.xml`]);
    if (shown.status !== 0) return null;
    return attribute(withoutCdata(withoutCommentsOrInstructions(shown.stdout)), 'package', 'name');
  };
  const own = existsAt(root, commit, `${place}/package/package.xml`);
  if (own && nameAt(place) === kit.name) return place;
  for (const other of kitPlacesAt(root, commit))
    if (other !== place && nameAt(other) === kit.name) return other;
  return own ? place : null;
}

/** The places of the packages under `business-apps/packages/` at a commit. */
function kitPlacesAt(root, commit) {
  const listed = git(root, ['ls-tree', '--name-only', `${commit}:${KITS}`]);
  if (listed.status !== 0) return [];
  return listed.stdout
    .split('\n')
    .filter(Boolean)
    .map((name) => `${KITS}/${name}`)
    .filter((place) => existsAt(root, commit, `${place}/package/package.xml`));
}

function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: OUTPUT_LIMIT });
}

function commitOf(root, ref) {
  const resolved = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (resolved.status !== 0) throw new Usage(`${ref} names no commit in ${root}.`);
  return resolved.stdout.trim();
}

function existsAt(root, commit, path) {
  return git(root, ['cat-file', '-e', `${commit}:${path}`]).status === 0;
}

/** Writes the `paths` the commit has into `into`, as they are there; returns those it had. */
function extract(root, commit, paths, into) {
  const present = paths.filter((path) => existsAt(root, commit, path));
  if (present.length === 0) return present;
  const scratch = mkdtempSync(join(tmpdir(), 'app-upgrade-archive-'));
  try {
    const tar = join(scratch, 'export.tar');
    const archived = git(root, [
      'archive',
      '--format=tar',
      `--output=${tar}`,
      commit,
      '--',
      ...present,
    ]);
    if (archived.status !== 0)
      throw new Usage(`git archive of ${commit.slice(0, 12)} failed: ${archived.stderr.trim()}`);
    const untarred = spawnSync('tar', ['-xf', tar, '-C', into], { encoding: 'utf8' });
    if (untarred.status !== 0)
      throw new Usage(`tar could not unpack the export: ${untarred.stderr.trim()}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return present;
}

/**
 * What is at `rel` under `root`, `null` when nothing is; reached through a link, at any part of the
 * path, it stops the run.
 */
function entryAt(root, rel) {
  let path = root;
  let entry = null;
  for (const part of rel.split('/')) {
    path = join(path, part);
    entry = lstatSync(path, { throwIfNoEntry: false });
    if (!entry) return null;
    if (entry.isSymbolicLink())
      throw new Usage(
        `${rel} under ${root} is reached through a symbolic link, which is not followed.`,
      );
  }
  return entry;
}

/** A file's text at `rel` under `root`, `null` when there is none (`entryAt`). */
function textAt(root, rel) {
  return entryAt(root, rel)?.isFile() ? readFileSync(join(root, ...rel.split('/')), 'utf8') : null;
}

/** Every file with `extension` under the folder `rel`, by path, with its text; `null` with no folder. */
function filesAt(root, rel, extension) {
  const directory = join(root, ...rel.split('/'));
  if (textAt(root, rel) !== null || !isDirectory(directory)) return null;
  const link = firstLink(directory);
  if (link !== null)
    throw new Usage(`${relative(root, link)} is a symbolic link, which is not followed.`);
  return filesUnder(directory)
    .filter((path) => path.endsWith(extension))
    .sort()
    .map((path) => [path, readFileSync(join(directory, path), 'utf8')]);
}

/** The first symbolic link at `path` or under it, or `null`. */
function firstLink(path) {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry) return null;
  if (entry.isSymbolicLink()) return path;
  if (!entry.isDirectory()) return null;
  for (const name of readdirSync(path).sort()) {
    const found = firstLink(join(path, name));
    if (found !== null) return found;
  }
  return null;
}

function filesUnder(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

function isFile(path) {
  return lstatSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

function isDirectory(path) {
  return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function shownPath(directory) {
  const near = relative(process.cwd(), directory);
  return near === ''
    ? '.'
    : near.startsWith('..') || isAbsolute(near)
      ? directory
      : near.split(sep).join('/');
}

// --- Small things -----------------------------------------------------------------------------------

/** Visits every value under `value`, with the key it is under: an array's items take the array's. */
function walk(value, key, visit) {
  visit(value, key);
  if (Array.isArray(value)) for (const item of value) walk(item, key, visit);
  else if (isRecord(value))
    for (const [inner, item] of Object.entries(value)) walk(item, inner, visit);
}

function json(text) {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value : undefined;
}

/** An item's kind, and the rest. */
function split(item) {
  const at = item.indexOf(' ');
  return at === -1 ? [item, ''] : [item.slice(0, at), item.slice(at + 1)];
}

function same(a, b) {
  const [x, y] = [[...a].sort(), [...b].sort()];
  return x.length === y.length && x.every((each, index) => each === y[index]);
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function list(items, none = 'nothing', and = 'and') {
  const all = [...items];
  if (all.length === 0) return none;
  if (all.length === 1) return all[0];
  return `${all.slice(0, -1).join(', ')} ${and} ${all[all.length - 1]}`;
}

// --- The platform the tool carries ----------------------------------------------------------------

/**
 * What `readPlatform` read of a platform, as JSON: what the tool carries of the platform it was
 * built from, so that outside this repository the platform as it is is the one the tool's validator
 * holds a package to. The same fields, with each set and map as a sorted list.
 */
export function platformSnapshot(platform) {
  return {
    version: platform.version,
    surface: [...platform.surface].sort(),
    sources: Object.fromEntries(
      [...platform.sources]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([item, from]) => [item, [...from].sort()]),
    ),
    missing: [...platform.missing].sort(),
    catalogue: [...platform.catalogue].sort(),
  };
}

/**
 * The platform `platformSnapshot` wrote, read back as `readPlatform` reads one, with `root` naming
 * where it was read from. A snapshot that is not one throws `Usage`.
 */
export function platformFromSnapshot(snapshot, root) {
  const lists = ['surface', 'missing', 'catalogue'];
  if (
    !isRecord(snapshot) ||
    lists.some((key) => !Array.isArray(snapshot[key])) ||
    !isRecord(snapshot.sources) ||
    !(snapshot.version === null || typeof snapshot.version === 'string')
  )
    throw new Usage(`${root} is not a platform this check can read.`);
  return {
    root,
    version: snapshot.version,
    surface: new Set(snapshot.surface),
    sources: new Map(Object.entries(snapshot.sources).map(([item, from]) => [item, new Set(from)])),
    missing: [...snapshot.missing],
    catalogue: new Set(snapshot.catalogue),
  };
}
