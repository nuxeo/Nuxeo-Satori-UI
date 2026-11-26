import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { formatFiles, generateFiles, type Tree } from '@nx/devkit';

import appLayoutGenerator from '../app-layout/generator';
import { isWindowsDeviceName, SATORI_NAMES, titleCase } from '../config-package/generator';
import {
  APP_ID,
  CONFIG_ROOT,
  contributeApp,
  listOption,
  parseJson,
  platformRoutes,
  PLATFORM_ROUTES_FILE,
  readAppPackage,
  schemaFor,
  writeJson,
} from './package-files';
import { generatorFilesDir } from '../util/generator-files-dir';

export interface AppPackageSchema {
  name: string;
  owner: string;
  appId?: string;
  address?: string;
  title?: string;
  vendor?: string;
  version?: string;
  platform?: string;
  groups?: string | string[];
  directory?: string;
  /** The first record page's document type, written as `app-layout` writes it. */
  type?: string;
  model?: string;
  modelServer?: string;
  schemas?: string | string[];
}

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/;
const SEGMENT = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
/** A group name as `app.json` writes it: up to 128 characters, no control character, not padded. */
function isGroupName(group: string): boolean {
  return (
    group.length > 0 &&
    group.length <= 128 &&
    group === group.trim() &&
    [...group].every((c) => c.charCodeAt(0) > 0x1f && c.charCodeAt(0) !== 0x7f)
  );
}

/** A semantic version, as the validator's `semver.ts` reads one. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

type Triple = readonly [number, number, number];

/** A version's major, minor and patch, and whether it has a prerelease; `null` for no version. */
function versionOf(text: string): { triple: Triple; prerelease: boolean } | null {
  const match = SEMVER.exec(text);
  if (!match) return null;
  const triple = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  // As the validator's `parseVersion`: past 2^53 a number no longer says which version it is.
  if (!triple.every(Number.isSafeInteger)) return null;
  return { triple, prerelease: match[4] !== undefined };
}

/**
 * What is wrong with `range` as `app.json`'s `platform` (app-definition-v2.md, section 3), or
 * `null`. Read as the validator's `parseRange` reads it: comparators separated by spaces, each
 * `>=`, `<=`, `>`, `<`, `=`, `^` or `~` and a version, `^` and `~` stopping short of the next
 * version's prereleases. When `version`, this platform's, is a release, the range must hold it,
 * as the pipeline checks; a release comes after every prerelease of its own version, as in
 * `compareVersions`. A prerelease platform is left to the pipeline, whose rules for it this does
 * not repeat.
 */
export function platformProblem(range: string, version: string | null): string | null {
  const bounds: { operator: string; triple: Triple; prerelease: boolean }[] = [];
  for (const part of range.trim().split(/\s+/)) {
    const match = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(part);
    const at = match ? versionOf(match[2]) : null;
    if (!match || !at) {
      return `"${range}" is not a range of platform versions, such as ">=0.2.0 <1.0.0", "^1.2.0" or "~1.2.0"`;
    }
    const operator = match[1] ?? '=';
    if (operator === '^' || operator === '~') {
      const [major, minor, patch] = at.triple;
      const upper: Triple =
        operator === '~' || (major === 0 && minor > 0)
          ? [major, minor + 1, 0]
          : major > 0
            ? [major + 1, 0, 0]
            : [0, 0, patch + 1];
      bounds.push({ operator: '>=', ...at }, { operator: '<', triple: upper, prerelease: true });
    } else bounds.push({ operator, ...at });
  }
  const own = version === null ? null : versionOf(version);
  if (!own || own.prerelease) return null;
  const holds = bounds.every(({ operator, triple, prerelease }) => {
    const order = compare(own.triple, triple) || (prerelease ? 1 : 0);
    return operator === '>='
      ? order >= 0
      : operator === '<='
        ? order <= 0
        : operator === '>'
          ? order > 0
          : operator === '<'
            ? order < 0
            : order === 0;
  });
  return holds
    ? null
    : `"${range}" leaves out this platform, ${version}, which the pipeline checks it against`;
}

function compare(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** `libs/platform`'s version, or `null` when the workspace has none. */
function platformVersion(tree: Tree): string | null {
  const text = tree.read('libs/platform/package.json', 'utf-8');
  if (text === null) return null;
  const version = (parseJson(text, 'libs/platform/package.json') as { version?: unknown }).version;
  return typeof version === 'string' ? version : null;
}

/**
 * The platform range a new app runs on: from this platform's version, up to its next major, as the
 * Payers kit writes `>=0.2.0 <1.0.0`. `null` when the workspace has no `libs/platform`.
 */
function defaultPlatform(tree: Tree): string | null {
  const version = platformVersion(tree);
  const match = version === null ? null : /^(\d+)\.(\d+)\.\d+/.exec(version);
  if (!match) return null;
  return `>=${match[1]}.${match[2]}.0 <${Number(match[1]) + 1}.0.0`;
}

/**
 * Scaffold an app definition package: a business app, as the package pipeline checks and builds
 * it (docs/business-apps/package-pipeline.md), laid out as the Payers kit is.
 *
 * ## What it writes
 *
 * - `bundle/agentic-ui-config/app.json`: version 2, with the app's id, name, package version,
 *   platform range and groups (app-definition-v2.md, section 3), and `labels/en.json` with its
 *   name.
 * - `bundle/OSGI-INF/<name>-config.xml`: the component, required after Satori's defaults, that
 *   `app-layout` and `app-form` add each layout to. It contributes the app to the app registry
 *   (app-definition-v2.md, section 10), as `app-registry` writes the `<app>` element, naming the
 *   files the registry serves; the other generators keep it in step. No bootstrap fragment: on a
 *   server shared by several apps it would rebrand them all (package-pipeline.md, section 1).
 * - `package/`, `bundle/META-INF/MANIFEST.MF` and `build.mjs`: version 1's configuration package.
 *   `build.mjs` is the `config-package` generator's, byte for byte, which the pipeline's step 1
 *   requires.
 * - `README.md`, whose table lists the files written here and nothing else, and `package.xml`,
 *   whose description names no part the package may never have: no queue or action is described
 *   for a package that has none.
 *
 * - **The first record page, given `--type`** and the content model (`--model` or
 *   `--modelServer`): written by `app-layout`, as that generator writes one. A package that
 *   contributes nothing is refused by the pipeline's step 5, so without a type the package passes
 *   only once `app-layout` has added a layout.
 *
 * Forms, queues and actions are `app-form`'s, `app-queue`'s and `app-action`'s; a stand-in model,
 * for a demo whose types no server has yet, is `app-model`'s.
 *
 * - **The app's address**, where the shell is to open it, is written in `app.json`: `--address`, or
 *   the id. One that is a platform route, such as `contracts` (`PLATFORM_ROUTES` in
 *   `libs/shared/app-definition`), is refused here, as the validator refuses it once written: an
 *   id that is one needs an `--address`. Left out, as a package written by hand may, the validator
 *   only says so.
 *
 * ## Internal
 *
 * Not shipped in `@nuxeo/satori-platform`: the packages it writes name this repository's JSON
 * Schemas, and are checked by this repository's pipeline (`scripts/app-package.mjs`). Where kits
 * live is open (package-pipeline.md, section 7).
 */
export default async function appPackageGenerator(tree: Tree, options: AppPackageSchema) {
  const parent = options.directory ?? 'business-apps/packages';
  const segments = parent.split('/');
  if (!segments.every((segment) => SEGMENT.test(segment) && !/^\.\.?$/.test(segment))) {
    throw new Error(
      `--directory "${parent}" must be a relative path of letters, digits, ".", "_" and "-" separated by "/", no part starting with "-".`,
    );
  }
  const reserved = segments.find(isWindowsDeviceName);
  if (reserved !== undefined) {
    throw new Error(
      `--directory "${parent}" has the segment "${reserved}", a device name Windows reserves.`,
    );
  }
  if (!KEBAB.test(options.name) || options.name.length > 128) {
    throw new Error(
      `"${options.name}" must be kebab-case, at most 128 characters, e.g. acme-contracts.`,
    );
  }
  const clash = SATORI_NAMES.get(options.name);
  if (clash !== undefined) {
    throw new Error(`"${options.name}" is a name Satori itself uses: ${clash}. Choose another.`);
  }
  if (isWindowsDeviceName(options.name)) {
    throw new Error(`"${options.name}" is a device name Windows reserves. Choose another.`);
  }
  if (!/^[a-z][a-z0-9]*$/.test(options.owner ?? '')) {
    throw new Error(`--owner "${options.owner}" must be lower-case letters and digits.`);
  }
  const appId = options.appId ?? options.name;
  if (!APP_ID.test(appId)) {
    throw new Error(
      `--appId "${appId}" must be lower-case letters, digits and "-", starting with a letter, at most 63 characters: it is the app's id in the registry.`,
    );
  }
  if (options.address !== undefined && !APP_ID.test(options.address)) {
    throw new Error(
      `--address "${options.address}" must be lower-case letters, digits and "-", starting with a letter, at most 63 characters: it is where the shell opens the app.`,
    );
  }
  // Refused here rather than at the pipeline's step 2, where the validator would refuse it.
  const address = options.address ?? appId;
  if (platformRoutes().includes(address)) {
    throw new Error(
      `The app's address would be "${address}"${options.address === undefined ? ', its id' : ''}, which is the platform's own page, /${address} (${PLATFORM_ROUTES_FILE}). Give --address another, such as --address=${address}-app.`,
    );
  }
  const version = options.version ?? '0.1.0';
  if (!VERSION.test(version)) {
    throw new Error(`--version "${version}" must be like 1.0.0 or 1.0.0-rc.1.`);
  }
  const platform = options.platform?.trim() || defaultPlatform(tree);
  if (!platform) {
    throw new Error(
      'This workspace has no libs/platform/package.json to take the platform range from: pass --platform, such as ">=0.2.0 <1.0.0".',
    );
  }
  const wrongRange = platformProblem(platform, platformVersion(tree));
  if (wrongRange !== null) throw new Error(`--platform: ${wrongRange}.`);
  // Once each: the validator refuses a group listed twice.
  const groups = [...new Set(listOption(options.groups))];
  if (groups.length === 0) groups.push('members');
  const badGroup = groups.find((group) => !isGroupName(group));
  if (badGroup !== undefined) throw new Error(`--groups: "${badGroup}" is not a group name.`);

  if (
    options.type === undefined &&
    (options.model ?? options.modelServer ?? options.schemas) !== undefined
  ) {
    throw new Error(
      '--model, --modelServer and --schemas lay out the first record page: give its --type too.',
    );
  }

  const projectRoot = `${parent}/${options.name}`;
  // No --force: written again, the component and the labels would lose what app-layout,
  // app-queue and app-action added to them.
  if (tree.exists(projectRoot)) {
    throw new Error(`${projectRoot} already exists. Choose another name.`);
  }

  const title = options.title?.trim() || titleCase(options.name);
  const component = `${options.owner}.config.${options.name}`;
  const config = `${projectRoot}/${CONFIG_ROOT}`;
  const appLabel = `${appId}.app`;

  generateFiles(tree, generatorFilesDir('app-package'), projectRoot, {
    name: options.name,
    appId,
    component,
    title,
    vendor: options.vendor?.trim() || title,
    version,
    projectRoot,
    docs: posix.relative(projectRoot, 'docs/business-apps'),
    // The README names the record page only when one is written: it lists what is there.
    type: options.type ?? '',
    tmpl: '',
  });

  const appFile = `${config}/app.json`;
  writeJson(tree, appFile, {
    $schema: schemaFor(appFile, 'app.schema.json'),
    version: 2,
    id: appId,
    label: title,
    labelKey: appLabel,
    packageVersion: version,
    platform,
    // Written, so that the validator holds it to the platform's routes: one left out is said, not
    // refused, for the packages built before the rule.
    address,
    groups,
    branding: { applicationTitle: title },
  });
  const labelsFile = `${config}/labels/en.json`;
  writeJson(tree, labelsFile, {
    $schema: schemaFor(labelsFile, 'labels.schema.json'),
    version: 2,
    labels: { [appLabel]: title },
  });
  // The app, for the app registry: without it "Switch app" cannot list the app on a server.
  contributeApp(tree, readAppPackage(tree, projectRoot), { create: true });

  const layout =
    options.type === undefined
      ? undefined
      : await appLayoutGenerator(tree, {
          package: projectRoot,
          type: options.type,
          model: options.model,
          modelServer: options.modelServer,
          schemas: options.schemas,
        });

  await formatFiles(tree);

  // After formatting, which would otherwise be free to reflow it: step 1 of the pipeline compares
  // it with the template byte for byte.
  tree.write(
    `${projectRoot}/build.mjs`,
    readFileSync(join(generatorFilesDir('config-package'), 'build.mjs__tmpl__')),
  );

  return () => {
    layout?.();
    console.log(`
Generated ${projectRoot}

  App:                  ${appId} (${title}), for ${groups.join(', ')}, contributed to the app registry
  Marketplace package:  ${options.name} ${version}
  Nuxeo component:      ${component}
  Platform:             ${platform}

${
  layout
    ? ''
    : `The pipeline refuses a package that contributes nothing (step 5): add a record page first.
`
}Add a record page, a form, a queue and an action:

  npx nx g ./tools/satori-generators:app-layout --package=${projectRoot} --type=<Type> --model=<content-model.json>
  npx nx g ./tools/satori-generators:app-form --package=${projectRoot} --type=<Type> --mode=edit --model=<content-model.json>
  npx nx g ./tools/satori-generators:app-queue --package=${projectRoot} --id=<queue> --pageProvider=<page provider>
  npx nx g ./tools/satori-generators:app-action --package=${projectRoot} --id=${appId}.<name> --transition=<transition>

For a demo whose types are on no server yet, a stand-in model first:

  npx nx g ./tools/satori-generators:app-model --package=${projectRoot} --type=<Type> --properties=<name>[:<type>],...

Then check and build it:

  npm run app-package -- ${projectRoot} --platform <platform version>
`);
  };
}
