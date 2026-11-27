/**
 * What changed between two versions of an app definition package, and whether its version moved as
 * far as those changes need (docs/business-apps/package-pipeline.md, section 8).
 *
 * A version says what someone relying on the package can still rely on, not how much changed:
 *
 * - **Breaking:** something another package, a link someone kept, a person or a server relies on
 *   is removed or renamed, or the app needs more of the server than before. A layout, a queue, a
 *   task form, a labels language or one of its keys, an action, a module's settings, the home, the
 *   menu or an image removed; the app's address changed; a group that had the app losing it; its
 *   platform range leaving out a version it admitted; a domain module it newly needs.
 * - **Addition:** something is added that nothing relied on before: any of those, or a group, or a
 *   platform version the range now admits too.
 * - **Change:** anything else in a file that stays: a card, a field, a column, a rule, a label's
 *   text, the branding. Nothing outside the package can name what is inside a file but the ids
 *   listed above.
 * - **To judge:** a change outside the app definition, such as the component that contributes it,
 *   a schema or `package.xml`'s dependencies. Nothing here can tell whether it breaks anything, so
 *   it needs what an addition needs, and is listed for a person to raise the major when it does.
 *
 * From 1.0.0 a breaking change raises the major, an addition or a change to judge the minor, and a
 * change the patch. Below 1.0.0, as npm's `^0.y.z` reads a version, everything moves down one: a
 * breaking change raises the minor, and anything else the patch. Raising more is always allowed.
 *
 * **What is compared is what the builder packages** (`build.mjs`, the generator's): a JSON file of
 * the bundle as it is zipped, parsed and written again without its `$schema`, so its spacing is not
 * content and the order of its keys is; the manifest with its lines unfolded. Which files the
 * builder packages, the bundle but its Markdown and `package.xml` and `install.xml`, is the
 * command line's to choose when it reads them.
 *
 * The version itself is not content: `app.json`'s `packageVersion` and `package.xml`'s version are
 * left out of the comparison, and so is the manifest's `Bundle-Version` while it is the package's
 * version. One that is not is compared, so a `Bundle-Version` moved alone is a change; one left
 * behind while the version moved is not a change of content, and the pipeline's step 3 refuses it.
 *
 * A prerelease is held to the release its core is: `1.0.1-rc.2` is on the way to a patch, so,
 * coming from `1.0.1-rc.1`, it may carry what a patch may carry and no more. A release or a
 * prerelease is best held to the last release below it, which is what CI compares a tag with.
 *
 * Pure: the files are given as text, keyed by their path in the package with `/`. Reading them is
 * the command line's (`cli.ts`, `changes`).
 */
import { parseRange, parseVersion, compareVersions, type Version } from './semver';

/** Where an app definition sits in a configuration package built as today. */
export const DEFINITION_ROOT = 'bundle/agentic-ui-config/';

export type ChangeLevel = 'breaking' | 'addition' | 'change' | 'judge';

export interface Change {
  readonly level: ChangeLevel;
  /** The file, as the package holds it, such as `bundle/agentic-ui-config/queues/x.json`. */
  readonly file: string;
  readonly what: string;
}

export type VersionPart = 'major' | 'minor' | 'patch';

export interface VersionJudgement {
  readonly previous: string;
  readonly version: string;
  readonly changes: readonly Change[];
  /** The least the version had to rise, or `null` when nothing changed. */
  readonly required: VersionPart | null;
  /** What it rose by: a part of its core, `prerelease` within one core, or `null` when it did not. */
  readonly raised: VersionPart | 'prerelease' | null;
  /** Why the version is refused, or `null`. */
  readonly refused: string | null;
  /** The changes, as Markdown, under no heading: the caller names the package. */
  readonly changelog: string;
}

/** A package's files: each path, with `/`, to its text. */
export type PackageFiles = ReadonlyMap<string, string>;

/**
 * Every change from `previous` to `current`, in the order of their files, with the outright
 * refusals: an app whose id changed is another app, not a new version of this one.
 */
export function changesBetween(
  previous: PackageFiles,
  current: PackageFiles,
): { readonly changes: readonly Change[]; readonly refusals: readonly string[] } {
  const changes: Change[] = [];
  const refusals: string[] = [];
  const paths = [...new Set([...previous.keys(), ...current.keys()])].sort();
  const [was, is] = [versionIn(previous), versionIn(current)];
  for (const file of paths) {
    const before = previous.get(file);
    const after = current.get(file);
    // A file whose packaged text did not move is no change, whatever the versions did: a
    // Bundle-Version left behind is step 3's to refuse, not a change of content.
    if (
      before !== undefined &&
      after !== undefined &&
      (packagedText(file, before) === packagedText(file, after) ||
        withoutVersion(file, packagedText(file, before), was) ===
          withoutVersion(file, packagedText(file, after), is))
    )
      continue;
    if (!file.startsWith(DEFINITION_ROOT)) {
      changes.push({
        level: 'judge',
        file,
        what:
          before === undefined
            ? `${file} is added.`
            : after === undefined
              ? `${file} is removed.`
              : `${file} changed.`,
      });
      continue;
    }
    changes.push(...definitionChanges(file, file.slice(DEFINITION_ROOT.length), before, after));
    if (file === `${DEFINITION_ROOT}app.json` && before !== undefined && after !== undefined) {
      const [was, is] = [objectOf(before)?.['id'], objectOf(after)?.['id']];
      if (typeof was === 'string' && typeof is === 'string' && was !== is)
        refusals.push(
          `app.json's id is ${is}, and was ${was}. An app keeps its id from one version to the` +
            ' next (app-definition-v2.md, section 3): a new id is a new package, with a name of' +
            ' its own.',
        );
    }
  }
  return { changes, refusals };
}

/**
 * Whether `version` moved from `previous` as far as `changes` need, with the changelog. `refusals`
 * are refused whatever the versions say.
 */
export function judgeVersion(
  previous: string,
  version: string,
  changes: readonly Change[],
  refusals: readonly string[] = [],
): VersionJudgement {
  const [was, is] = [parseVersion(previous), parseVersion(version)];
  const required = was ? requiredPart(changes, was) : null;
  const raised = was && is ? raisedPart(was, is) : null;
  const judged = (refused: string | null): VersionJudgement => ({
    previous,
    version,
    changes,
    required,
    raised,
    refused,
    changelog: changelogOf(previous, version, changes, required, raised),
  });
  if (refusals.length > 0) return judged(refusals.join(' '));
  if (!was) return judged(`the previous version, ${previous}, is not a semantic version.`);
  if (!is) return judged(`${version} is not a semantic version.`);
  const order = compareVersions(is, was);
  if (order < 0)
    return judged(
      `${version} is lower than the previous version, ${previous}. A version only rises.`,
    );
  if (required === null) return judged(null);
  if (order === 0)
    return judged(
      `the content changed since ${previous} (${count(changes)}), and the version is still` +
        ` ${version}. Raise it to ${suggested(was, required)} at least, a ${required} version, in` +
        " package.xml and app.json's packageVersion together.",
    );
  // A later prerelease of the same core, or its release: still on the way to that core's release,
  // so it carries no more than that release may. `1.0.1-rc.2` is a patch's prerelease.
  if (raised === 'prerelease') {
    const core = { ...is, prerelease: [] };
    const implied = partOf(core);
    if (rank(implied) >= rank(required)) return judged(null);
    const why = changes.find((change) => levelNeeds(change.level, was) === required);
    const coreText = `${core.major}.${core.minor}.${core.patch}`;
    const said =
      is.prerelease.length > 0
        ? `${version} is a prerelease of ${coreText}, which raises the ${implied}`
        : `${version}, the release ${previous} was a prerelease of, raises the ${implied}`;
    return judged(
      `the changes since ${previous} need a ${required} version, and ${said}.` +
        ` ${why ? `For one: ${why.what} ` : ''}Make it ${suggested(core, required)} or a prerelease` +
        ' of it, at least.',
    );
  }
  if (rank(raised) < rank(required)) {
    const why = changes.find((change) => levelNeeds(change.level, was) === required);
    return judged(
      `the changes since ${previous} need a ${required} version${was.major === 0 ? ' (below 1.0.0, a breaking change raises the minor, and anything else the patch)' : ''},` +
        ` and ${version} raises the ${raised}. ${why ? `For one: ${why.what} ` : ''}Raise it to` +
        ` ${suggested(was, required)} at least.`,
    );
  }
  return judged(null);
}

const PART_RANK: Record<VersionPart, number> = { patch: 1, minor: 2, major: 3 };
const rank = (part: VersionPart | 'prerelease' | null): number =>
  part === null || part === 'prerelease' ? 0 : PART_RANK[part];

/** What one change needs of a version that was `was`. */
function levelNeeds(level: ChangeLevel, was: Version): VersionPart {
  const from1: Record<ChangeLevel, VersionPart> = {
    breaking: 'major',
    addition: 'minor',
    judge: 'minor',
    change: 'patch',
  };
  const part = from1[level];
  if (was.major > 0) return part;
  return part === 'major' ? 'minor' : 'patch';
}

function requiredPart(changes: readonly Change[], was: Version): VersionPart | null {
  let required: VersionPart | null = null;
  for (const change of changes) {
    const part = levelNeeds(change.level, was);
    if (rank(part) > rank(required)) required = part;
  }
  return required;
}

/** The highest part of the core that rose, `prerelease` when the core is the same, or `null`. */
function raisedPart(was: Version, is: Version): VersionPart | 'prerelease' | null {
  if (compareVersions(is, was) <= 0) return null;
  if (is.major !== was.major) return 'major';
  if (is.minor !== was.minor) return 'minor';
  if (is.patch !== was.patch) return 'patch';
  return 'prerelease';
}

/** The part a release raises by its own form: `1.0.1` a patch, `1.1.0` a minor, `2.0.0` a major. */
function partOf(core: Version): VersionPart {
  if (core.patch > 0) return 'patch';
  if (core.minor > 0) return 'minor';
  return 'major';
}

/** The least version that raises `part` from `was`. */
function suggested(was: Version, part: VersionPart): string {
  if (part === 'major') return `${was.major + 1}.0.0`;
  if (part === 'minor') return `${was.major}.${was.minor + 1}.0`;
  // A prerelease's own release is already the next patch's equal: 1.0.1-rc.1 to 1.0.1.
  return was.prerelease.length > 0
    ? `${was.major}.${was.minor}.${was.patch}`
    : `${was.major}.${was.minor}.${was.patch + 1}`;
}

function count(changes: readonly Change[]): string {
  return changes.length === 1 ? '1 change' : `${changes.length} changes`;
}

const HEADINGS: readonly [ChangeLevel, string][] = [
  ['breaking', 'Breaking'],
  ['addition', 'Added'],
  ['change', 'Changed'],
  ['judge', 'To judge'],
];

function changelogOf(
  previous: string,
  version: string,
  changes: readonly Change[],
  required: VersionPart | null,
  raised: VersionPart | 'prerelease' | null,
): string {
  if (changes.length === 0)
    return `No change since ${previous}${version === previous ? '' : `; the version moved to ${version} all the same`}.\n`;
  const lines = [
    `Since ${previous}: ${count(changes)}, which ${changes.length === 1 ? 'needs' : 'need'} a ${required} version.` +
      (raised === null
        ? ''
        : raised === 'prerelease'
          ? /-/.test(version.split('+')[0] ?? version)
            ? ` ${version} is a later prerelease of the same version.`
            : ` ${version} is the release ${previous} was a prerelease of.`
          : ` ${version} raises the ${raised}.`),
  ];
  for (const [level, heading] of HEADINGS) {
    const listed = changes.filter((change) => change.level === level);
    if (listed.length === 0) continue;
    lines.push('', `## ${heading}`, '');
    for (const change of listed) lines.push(`- ${change.what}`);
    if (level === 'judge')
      lines.push(
        '',
        'The pipeline cannot tell whether these break anything. If one does, the version needs a' +
          " breaking change's raise, which a person decides.",
      );
  }
  return `${lines.join('\n')}\n`;
}

/** The package's version, as its `app.json` names it, or `null`. */
function versionIn(files: PackageFiles): string | null {
  const text = files.get(`${DEFINITION_ROOT}app.json`);
  const version = text === undefined ? undefined : objectOf(text)?.['packageVersion'];
  return typeof version === 'string' ? version : null;
}

/**
 * A file's text as the builder packages it: a JSON file of the bundle parsed and written again
 * without its `$schema`, the manifest with its lines unfolded and its line ends made one. Anything
 * else, and JSON that cannot be read, which the builder would refuse, as it is.
 *
 * A fragment's or a layout's body that a `src` names is packaged as JSON whatever the file is
 * called, `fragments/acme.manifest` as well as `manifest.json`, so a file of the bundle that is not
 * `.json` and reads as a JSON object is compared as JSON too. Otherwise a package compared with the
 * zip it was built into, whose bodies are compact, would differ from itself.
 */
export function packagedText(file: string, text: string): string {
  if (file.startsWith('bundle/') && file !== 'bundle/META-INF/MANIFEST.MF') {
    const content = objectOf(text);
    if (content === null) return text;
    delete content['$schema'];
    return JSON.stringify(content);
  }
  if (file === 'bundle/META-INF/MANIFEST.MF')
    return text
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n /g, '')
      .replace(/\n+$/, '');
  return text;
}

/**
 * The file's text with the package's version blanked where it is written: `app.json`'s
 * `packageVersion`, the version of `package.xml`'s `<package>` element, and the manifest's
 * `Bundle-Version` when it is `version`. A comment cannot hide a `<package>` element: comments are
 * blanked first.
 */
export function withoutVersion(file: string, text: string, version: string | null = null): string {
  if (file === `${DEFINITION_ROOT}app.json`)
    return text.replace(/("packageVersion"\s*:\s*)"(?:[^"\\]|\\.)*"/, '$1""');
  if (file === 'package/package.xml')
    return text
      .replace(/<!--[^]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
      .replace(/(<package\b[^>]*?\bversion\s*=\s*)("[^"]*"|'[^']*')/, '$1""');
  if (file === 'bundle/META-INF/MANIFEST.MF' && version !== null)
    return text.replace(
      /^(Bundle-Version:)[ \t]*([^\r\n]*)/im,
      (line, header: string, value: string) => (value.trim() === version ? header : line),
    );
  return text;
}

/** The changes one file of the app definition makes, at its place under the root. */
function definitionChanges(
  file: string,
  place: string,
  before: string | undefined,
  after: string | undefined,
): Change[] {
  const added = before === undefined;
  const removed = after === undefined;
  const whole = (name: string, removal: string): Change[] =>
    added
      ? [{ level: 'addition', file, what: `${name} is added.` }]
      : removed
        ? [{ level: 'breaking', file, what: `${name} is removed: ${removal}.` }]
        : [{ level: 'change', file, what: `${name} changed.` }];
  let match: RegExpExecArray | null;
  if ((match = /^layouts\/([^/]+)\/([^/]+)\.layout\.json$/.exec(place)))
    return whole(
      `The ${match[2]} layout of ${match[1]} records`,
      'a server stops serving it, and a package that leant on it loses it',
    );
  if ((match = /^queues\/([^/]+)\.json$/.exec(place)))
    return whole(
      `The queue ${match[1]}`,
      'a link to it, a menu entry or a home card naming it stops working',
    );
  if ((match = /^tasks\/([^/]+)\.layout\.json$/.exec(place)))
    return whole(
      `The task form of ${match[1]}`,
      "the step's tasks fall back to the form generated from its variables",
    );
  if ((match = /^modules\/([^/]+)\.json$/.exec(place)))
    return whole(`The settings of the module ${match[1]}`, 'the module loses them');
  if ((match = /^assets\/(.+)$/.exec(place)))
    return whole(`The image assets/${match[1]}`, 'a file that names it shows nothing');
  if (place === 'home.json') return whole("The app's home", 'its address shows nothing');
  if (place === 'navigation.json') return whole("The app's menu", 'its entries are gone');
  if ((match = /^labels\/([^/]+)\.json$/.exec(place)))
    return keyed(
      file,
      before,
      after,
      `The labels file for ${match[1]}`,
      labelsOf,
      (key) => `The label ${key}, in ${match?.[1]},`,
      'a file that names one of its keys shows the key instead',
    );
  if (place === 'actions.json')
    return keyed(
      file,
      before,
      after,
      'actions.json',
      actionsOf,
      (id) => `The action ${id}`,
      'a queue or a record page that names one of its actions loses the button',
    );
  if (place === 'app.json') return appChanges(file, before, after);
  if ((match = /^demo\//.exec(place)))
    return [
      {
        level: 'change',
        file,
        what: `${place}, a kit's demo data, ${added ? 'is added' : removed ? 'is removed' : 'changed'}.`,
      },
    ];
  return [
    {
      level: 'judge',
      file,
      what: `${place}, which is not a file of an app definition, ${added ? 'is added' : removed ? 'is removed' : 'changed'}.`,
    },
  ];
}

/**
 * The changes to a file of named entries, labels or actions: one removed is breaking, one added an
 * addition, one whose content changed a change. A file that cannot be read as its kind is taken
 * whole, as a change, an addition or a removal.
 */
function keyed(
  file: string,
  before: string | undefined,
  after: string | undefined,
  name: string,
  entries: (text: string) => ReadonlyMap<string, string> | null,
  entry: (key: string) => string,
  removal: string,
): Change[] {
  if (before === undefined) return [{ level: 'addition', file, what: `${name} is added.` }];
  if (after === undefined)
    return [{ level: 'breaking', file, what: `${name} is removed: ${removal}.` }];
  const [was, is] = [entries(before), entries(after)];
  if (was === null || is === null) return [{ level: 'change', file, what: `${name} changed.` }];
  const changes: Change[] = [];
  for (const [key, value] of was) {
    if (!is.has(key))
      changes.push({ level: 'breaking', file, what: `${entry(key)} is removed: ${removal}.` });
    else if (is.get(key) !== value)
      changes.push({ level: 'change', file, what: `${entry(key)} changed.` });
  }
  for (const key of is.keys())
    if (!was.has(key)) changes.push({ level: 'addition', file, what: `${entry(key)} is added.` });
  // The same entries, written another way: the file still changed.
  if (changes.length === 0) changes.push({ level: 'change', file, what: `${name} changed.` });
  return changes;
}

function objectOf(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function labelsOf(text: string): ReadonlyMap<string, string> | null {
  const labels = objectOf(text)?.['labels'];
  if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) return null;
  return new Map(
    Object.entries(labels as Record<string, unknown>).map(([key, value]) => [
      key,
      JSON.stringify(value),
    ]),
  );
}

function actionsOf(text: string): ReadonlyMap<string, string> | null {
  const actions = objectOf(text)?.['actions'];
  if (!Array.isArray(actions)) return null;
  const byId = new Map<string, string>();
  for (const action of actions) {
    const id =
      action !== null && typeof action === 'object'
        ? (action as Record<string, unknown>)['id']
        : undefined;
    if (typeof id !== 'string') return null;
    byId.set(id, JSON.stringify(action));
  }
  return byId;
}

/** `app.json`: its address, groups, modules and platform range each say something of their own. */
function appChanges(file: string, before: string | undefined, after: string | undefined): Change[] {
  if (before === undefined) return [{ level: 'addition', file, what: 'app.json is added.' }];
  if (after === undefined)
    return [{ level: 'breaking', file, what: 'app.json is removed: the package is no app.' }];
  const [was, is] = [objectOf(before), objectOf(after)];
  if (was === null || is === null) return [{ level: 'change', file, what: 'app.json changed.' }];
  const changes: Change[] = [];
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined;
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

  const address = (app: Record<string, unknown>) => text(app['address']) ?? text(app['id']);
  if (address(was) !== address(is))
    changes.push({
      level: 'breaking',
      file,
      what: `The app's address is ${address(is)}, and was ${address(was)}: a link to the old one stops working.`,
    });
  for (const group of list(was['groups']))
    if (!list(is['groups']).includes(group))
      changes.push({ level: 'breaking', file, what: `The group ${group} no longer has the app.` });
  for (const group of list(is['groups']))
    if (!list(was['groups']).includes(group))
      changes.push({ level: 'addition', file, what: `The group ${group} has the app.` });
  for (const module of list(is['modules']))
    if (!list(was['modules']).includes(module))
      changes.push({
        level: 'breaking',
        file,
        what: `The app needs the module ${module}, which a server that ran it may not have.`,
      });
  for (const module of list(was['modules']))
    if (!list(is['modules']).includes(module))
      changes.push({
        level: 'change',
        file,
        what: `The app no longer turns the module ${module} on.`,
      });
  const [from, to] = [text(was['platform']), text(is['platform'])];
  if (from !== to) changes.push(platformChange(file, from, to));

  // Anything else, the branding and the name among them, or the same said another way.
  const rest = (app: Record<string, unknown>) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(app).filter(
          ([key]) =>
            !['packageVersion', 'address', 'id', 'groups', 'modules', 'platform'].includes(key),
        ),
      ),
    );
  if (rest(was) !== rest(is))
    changes.push({
      level: 'change',
      file,
      what: "app.json's name, branding or other settings changed.",
    });
  else if (changes.length === 0)
    changes.push({
      level: 'change',
      file,
      what: 'app.json is written another way, saying the same.',
    });
  return changes;
}

/**
 * A platform range against the one before: breaking when it leaves out a release the old one
 * admitted, an addition when it only admits more. Each range is read as the interval of releases
 * its comparators bound; which prereleases it admits is not weighed.
 */
function platformChange(file: string, from: string | undefined, to: string | undefined): Change {
  const [was, is] = [
    from === undefined ? null : interval(from),
    to === undefined ? null : interval(to),
  ];
  const said = `The platform range is ${to ?? 'gone'}, and was ${from ?? 'none'}`;
  // app.json requires a range, so a side without one, or with one that cannot be read, was not a
  // valid app: what it admitted cannot be weighed, and the change is taken as the larger one.
  if (was === null || is === null)
    return {
      level: 'breaking',
      file,
      what: `${said}: what one of them admits cannot be read, so it is taken to leave some out.`,
    };
  if (startsEarlier(was.low, is.low) || endsEarlier(is.high, was.high))
    return {
      level: 'breaking',
      file,
      what: `${said}: a server on a version the old range admitted cannot run this one.`,
    };
  if (startsEarlier(is.low, was.low) || endsEarlier(was.high, is.high))
    return { level: 'addition', file, what: `${said}: it admits more platform versions.` };
  return { level: 'change', file, what: `${said}, admitting the same versions.` };
}

interface Bound {
  readonly version: Version;
  readonly inclusive: boolean;
}

/** The releases a range admits, from `low` to `high`; `null` is no bound on that side. */
interface Interval {
  readonly low: Bound | null;
  readonly high: Bound | null;
}

function interval(range: string): Interval | null {
  const comparators = parseRange(range);
  if (!comparators) return null;
  let low: Bound | null = null;
  let high: Bound | null = null;
  for (const { operator, version } of comparators) {
    // Releases only: a bound on a prerelease of X admits, among releases, what X admits from that
    // side: X and above from below, below X from above. `^1.2.0`'s `<2.0.0-0` is `<2.0.0`.
    const pre = version.prerelease.length > 0;
    const core = { ...version, prerelease: [] };
    if (operator === '>=' || operator === '>' || operator === '=') {
      const bound = { version: core, inclusive: pre || operator !== '>' };
      if (low === null || startsEarlier(low, bound)) low = bound;
    }
    if (operator === '<=' || operator === '<' || operator === '=') {
      const bound = { version: core, inclusive: !pre && operator !== '<' };
      if (high === null || endsEarlier(bound, high)) high = bound;
    }
  }
  return { low, high };
}

/** Whether lower bound `a` admits a release that lower bound `b` leaves out. */
function startsEarlier(a: Bound | null, b: Bound | null): boolean {
  if (b === null) return false;
  if (a === null) return true;
  const order = compareVersions(a.version, b.version);
  return order < 0 || (order === 0 && a.inclusive && !b.inclusive);
}

/** Whether upper bound `a` leaves out a release that upper bound `b` admits. */
function endsEarlier(a: Bound | null, b: Bound | null): boolean {
  if (a === null) return false;
  if (b === null) return true;
  const order = compareVersions(a.version, b.version);
  return order < 0 || (order === 0 && !a.inclusive && b.inclusive);
}
