/**
 * What a release candidate holds its set of packages to (`scripts/release-candidate.mjs`,
 * docs/business-apps/package-pipeline.md, section 11): that each package's dependencies are in the
 * candidate at a version Nuxeo counts as meeting them, that no two packages conflict, that each
 * package's target platform lies within those of the packages it depends on, that no two kits
 * contribute the same thing a server or the app registry keeps one of, and that the package that
 * deploys the client carries the bundle that was built; and, given signatures, that each kit is
 * signed by a trusted signer over the bytes the candidate built (`kitSignature`).
 *
 * Functions over what was read from the built zips and folders, so that
 * `release-candidate.selftest.mjs` can break each rule in a fixture without building anything.
 * Node and `unzip` alone: no install.
 *
 * **One rule is this candidate's own.** Nuxeo holds each package's target platform to the platform
 * it is installed on, and to nothing else. That a package's range lie within its dependencies' is
 * what this adds: a package that claims a platform its dependency does not install on could not be
 * installed there, whatever it claims. The ranges themselves are read as Nuxeo reads them.
 *
 * **Nuxeo's rules, not semver's.** A package's dependency, `name:min` or `name:min:max`, is met as
 * Nuxeo Connect meets it, and the functions below are ported from nuxeo-connect-client 1.8.3's
 * `org.nuxeo.connect.update.Version`, `PackageVersionRange` and `PackageDependency`, and its
 * `org.nuxeo.connect.platform.PlatformVersion` and `PlatformVersionRange`, read from the bytecode
 * with `javap -c`. The cases in the selftest are what those classes answered when run, so a port
 * that drifts from them fails there. Three of them decide a release candidate's version:
 *
 * - `2026.0.2-SNAPSHOT` does not meet `nuxeo-agentic-ui:2026.0.2`: a snapshot is below its release;
 * - nor does `2026.0.2-rc.1`, nor any version whose classifier starts `rc`, `RC`, `alpha` or
 *   `beta`, or is a letter and eight digits: Nuxeo puts those below the release too;
 * - `2026.0.2-PR-12-BUILD-3` does, as any other classifier does: Nuxeo puts it above the release.
 *
 * What a package holds is read from its zip, with the system's `unzip`, as `verify-package-zip.mjs`
 * reads one: the set is judged on the bytes the candidate ships, not on the sources they came from.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { signatureFileFor, verifySignature } from './package-signature.mjs';
import {
  attributesOf,
  componentPathsOf,
  componentXmlOf,
  withoutCdata,
  withoutCommentsOrInstructions,
} from './verify-package-zip.mjs';

/** `Version.VERSION_PATTERN`, found anywhere in the text, as `Matcher.find` finds it. */
const VERSION_PATTERN = /([0-9]+)(\.[0-9]+)?(\.[0-9]+)?/;
/** `Version.SPECIAL_CLASSIFIER`: a classifier Nuxeo orders before the release it names. */
const SPECIAL_CLASSIFIER = /^(((RC|rc|alpha|ALPHA|beta|BETA)\d*)|([a-zA-Z][0-9]{8})).*$/s;

/** Java's `String.compareTo`, by UTF-16 code unit: only its sign is used. */
function javaCompare(a, b) {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const difference = a.charCodeAt(index) - b.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/**
 * A package version as `new Version(text)` reads it. The digits are found anywhere, and what follows
 * is cut at the found text's length from the start, as the constructor does, so `v1.2` reads oddly
 * there too. A text with no digit is 0.0.0, which is what a package whose version was never stamped,
 * `@VERSION@`, is to Nuxeo.
 */
export function nuxeoVersion(text) {
  const version = {
    major: 0,
    minor: 0,
    patch: 0,
    classifier: null,
    snapshot: false,
    special: false,
  };
  const found = VERSION_PATTERN.exec(text);
  if (found === null) return version;
  const numbers = found[0].match(/[0-9]+/g);
  [version.major = 0, version.minor = 0, version.patch = 0] = numbers.map((n) =>
    Number.parseInt(n, 10),
  );
  let rest = text.substring(found[0].length);
  if (rest.includes('-SNAPSHOT')) {
    version.snapshot = true;
    rest = rest.replace('-SNAPSHOT', '');
  }
  if (rest !== '') {
    version.classifier = rest.substring(1);
    version.special = SPECIAL_CLASSIFIER.test(version.classifier);
  }
  return version;
}

/** `Version.compareTo`: negative, zero or positive. */
export function compareNuxeoVersions(a, b) {
  for (const part of ['major', 'minor', 'patch']) {
    if (a[part] !== b[part]) return a[part] - b[part];
  }
  const left = a.classifier ?? '';
  const right = b.classifier ?? '';
  if (left === right) {
    if (a.snapshot === b.snapshot) return 0;
    return a.snapshot ? -1 : 1;
  }
  if (a.special === b.special) return javaCompare(left, right);
  return a.special ? -1 : 1;
}

/**
 * A dependency as `new PackageDependency(text)` reads it: the name before the first colon, and a
 * range of the rest, `min` or `min:max`. No colon is any version. Nothing is trimmed, as Nuxeo trims
 * nothing; the caller trims the element's text, as Nuxeo's XML reader does.
 */
export function parseDependency(text) {
  const colon = text.indexOf(':');
  if (colon === -1) return { name: text, min: null, max: null, text };
  const range = text.substring(colon + 1);
  if (range.length === 0) return { name: text.substring(0, colon), min: null, max: null, text };
  const second = range.indexOf(':');
  return second === -1
    ? { name: text.substring(0, colon), min: nuxeoVersion(range), max: null, text }
    : {
        name: text.substring(0, colon),
        min: nuxeoVersion(range.substring(0, second)),
        max: nuxeoVersion(range.substring(second + 1)),
        text,
      };
}

/** `PackageVersionRange.matchVersion`: at least `min`, and at most `max` when there is one. */
export function dependencyMatches(dependency, versionText) {
  const version = nuxeoVersion(versionText);
  if (dependency.min !== null && compareNuxeoVersions(version, dependency.min) < 0) return false;
  if (dependency.max !== null && compareNuxeoVersions(version, dependency.max) > 0) return false;
  return true;
}

/** Why `versionText` does not meet `dependency`, in a sentence, for a refusal. */
function whyUnmet(dependency, versionText) {
  const version = nuxeoVersion(versionText);
  const below = dependency.min !== null && compareNuxeoVersions(version, dependency.min) < 0;
  if (!below) return `which is above its most, ${dependency.text.split(':')[2]}`;
  const min = dependency.text.split(':')[1];
  const sameRelease =
    version.major === dependency.min.major &&
    version.minor === dependency.min.minor &&
    version.patch === dependency.min.patch;
  if (sameRelease && version.snapshot)
    return `which Nuxeo puts below ${min}: a snapshot is below its release`;
  if (sameRelease && version.special)
    return `which Nuxeo puts below ${min}: a classifier starting rc, alpha or beta is below its release`;
  return `which is below ${min}`;
}

/**
 * A platform version, `major.minor.build-qualifier`, as `PlatformVersion` orders it, or `null` for
 * one this port does not read, which the caller refuses rather than guesses at. The parse is
 * narrower than Nuxeo's: each part is one to four digits, as `formatOn4Digits` writes them.
 */
export function platformVersion(text) {
  const found = /^([0-9]{1,4})(?:\.([0-9]{1,4}))?(?:\.([0-9]{1,4}))?(?:-(.+))?$/.exec(text.trim());
  if (found === null) return null;
  const [major, minor = '0', build = '0'] = found.slice(1, 4);
  const pad = (n) => String(Number.parseInt(n, 10)).padStart(4, '0');
  // `PlatformVersion.computeComparable`: each part on four digits, then the qualifier in capitals.
  // `compareTo` orders two versions by it, as Java orders strings.
  const qualifier = found[4] ? `-${found[4].toUpperCase()}` : '';
  return { text: text.trim(), comparable: `${pad(major)}.${pad(minor)}.${pad(build)}${qualifier}` };
}

/**
 * A target platform's range as `PlatformVersionRange.fromRangeSpec` reads one: `[a,b)`, `(a,b]`,
 * a bound left out for none, or a bare version for that version alone. `null` when it cannot be read.
 */
export function platformRange(spec) {
  const text = spec.trim();
  const interval = /^([[(])\s*([^,]*?)\s*,\s*([^,]*?)\s*([\])])$/.exec(text);
  if (interval === null) {
    const only = platformVersion(text);
    return only === null
      ? null
      : { lower: only, lowerInclusive: true, upper: only, upperInclusive: true, text };
  }
  const lower = interval[2] === '' ? null : platformVersion(interval[2]);
  const upper = interval[3] === '' ? null : platformVersion(interval[3]);
  if ((interval[2] !== '' && lower === null) || (interval[3] !== '' && upper === null)) return null;
  return {
    lower,
    lowerInclusive: lower !== null && interval[1] === '[',
    upper,
    upperInclusive: upper !== null && interval[4] === ']',
    text,
  };
}

/** Whether every platform version `inner` admits, `outer` admits too. */
export function rangeWithin(inner, outer) {
  if (outer.lower !== null) {
    if (inner.lower === null) return false;
    const order = javaCompare(inner.lower.comparable, outer.lower.comparable);
    if (order < 0 || (order === 0 && inner.lowerInclusive && !outer.lowerInclusive)) return false;
  }
  if (outer.upper !== null) {
    if (inner.upper === null) return false;
    const order = javaCompare(inner.upper.comparable, outer.upper.comparable);
    if (order > 0 || (order === 0 && inner.upperInclusive && !outer.upperInclusive)) return false;
  }
  return true;
}

/**
 * The elements of some XML as a flat list, in document order, each with the names of the elements
 * it is inside. For markup `verify-package-zip.mjs`'s helpers have already taken the comments,
 * processing instructions and CDATA out of: what is left is tags and text. The builder refuses
 * markup that is not well formed before any zip this reads exists.
 */
export function elementsOf(xml) {
  const elements = [];
  const open = [];
  for (const [, closing, name, rest] of xml.matchAll(
    /<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
  )) {
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at !== -1) open.length = at;
      continue;
    }
    elements.push({ name, path: [...open], tag: rest });
    if (!rest.trimEnd().endsWith('/')) open.push(name);
  }
  return elements;
}

/**
 * What a component registers that a server keeps one of under each name, by extension point: a
 * second contribution of the same one replaces the first, or is refused. `under` is where the
 * element sits inside the `<extension>`, and `key` its name. Two kits that both contribute one are
 * two kits that cannot both be installed as they are.
 */
const REGISTRATIONS = [
  ['org.nuxeo.ecm.core.schema.TypeService', 'doctype', [], 'doctype', 'name', 'document type'],
  ['org.nuxeo.ecm.core.schema.TypeService', 'doctype', [], 'facet', 'name', 'facet'],
  ['org.nuxeo.ecm.core.schema.TypeService', 'schema', [], 'schema', 'name', 'schema'],
  [
    'org.nuxeo.ecm.core.lifecycle.LifeCycleService',
    'lifecycle',
    [],
    'lifecycle',
    'name',
    'lifecycle',
  ],
  [
    'org.nuxeo.ecm.core.lifecycle.LifeCycleService',
    'types',
    ['types'],
    'type',
    'name',
    "document type's lifecycle",
  ],
  [
    'org.nuxeo.ecm.platform.query.api.PageProviderService',
    'providers',
    [],
    'coreQueryPageProvider',
    'name',
    'page provider',
  ],
  [
    'org.nuxeo.ecm.platform.query.api.PageProviderService',
    'providers',
    [],
    'genericPageProvider',
    'name',
    'page provider',
  ],
  [
    'org.nuxeo.ecm.core.operation.OperationServiceComponent',
    'chains',
    [],
    'chain',
    'id',
    'automation chain',
  ],
  [
    'org.nuxeo.automation.scripting.internals.AutomationScriptingComponent',
    'operation',
    [],
    'scriptedOperation',
    'id',
    'automation operation',
  ],
  ['org.nuxeo.ecm.directory.GenericDirectory', 'directories', [], 'directory', 'name', 'directory'],
  ['org.nuxeo.ecm.platform.actions.ActionService', 'filters', [], 'filter', 'id', 'action filter'],
  ['org.nuxeo.ecm.platform.actions.ActionService', 'actions', [], 'action', 'id', 'action'],
  [
    'org.nuxeo.ecm.platform.routing.service',
    'routeModelImporter',
    [],
    'template-resource',
    'id',
    'workflow',
  ],
  [
    'org.nuxeo.ecm.core.event.EventServiceComponent',
    'listener',
    [],
    'listener',
    'name',
    'event listener',
  ],
  // nuxeo-agentic-assets: one policy per document type, and a later one replaces it whole.
  ['org.nuxeo.agentic.assets.rights', 'policies', [], 'policy', 'type', 'rights policy'],
];

/**
 * Points whose contributions have no name a second one could take: an event handler is added
 * beside the others. Known, so they are not listed as points this check does not compare.
 */
const KEYLESS = new Set(['org.nuxeo.ecm.core.operation.OperationServiceComponent#event-handlers']);

/**
 * What one component registers, `[{ kind, key }]`, and the points it contributes to that this
 * check does not know, `[ 'target#point' ]`, which the candidate lists as not compared rather than
 * passes in silence. A disabled contribution registers nothing and is skipped, as the builder and
 * the server skip it. The layouts and the app the component gives the configuration point are
 * keyed too: a layout by its type and mode, which a second kit's would replace.
 */
export function registrationsOf(componentXml) {
  const registrations = [];
  const unknown = new Set();
  let extension = null;
  for (const element of elementsOf(componentXml)) {
    const attributes = attributesOf(element.tag);
    if (element.name === 'component' && element.path.length === 0 && attributes.name)
      registrations.push({ kind: 'component', key: attributes.name });
    if (element.name === 'extension' && element.path.length === 1) {
      extension = { target: attributes.target ?? '', point: attributes.point ?? '', depth: 2 };
      const known =
        KEYLESS.has(`${extension.target}#${extension.point}`) ||
        (extension.target === 'org.nuxeo.agentic.ui.config' &&
          extension.point === 'configuration') ||
        REGISTRATIONS.some(
          ([target, point]) => target === extension.target && point === extension.point,
        );
      if (!known) unknown.add(`${extension.target}#${extension.point}`);
      continue;
    }
    if (extension === null || element.path.length < 2 || element.path[1] !== 'extension') continue;
    if (attributes.enabled !== undefined && attributes.enabled.toLowerCase() !== 'true') continue;
    const under = element.path.slice(2);
    if (extension.target === 'org.nuxeo.agentic.ui.config' && extension.point === 'configuration') {
      if (under.length === 0 && element.name === 'layout' && attributes.type && attributes.mode)
        registrations.push({ kind: 'layout', key: `${attributes.type}/${attributes.mode}` });
      continue;
    }
    for (const [target, point, path, name, key, kind] of REGISTRATIONS) {
      if (
        target === extension.target &&
        point === extension.point &&
        name === element.name &&
        path.length === under.length &&
        path.every((part, index) => part === under[index]) &&
        attributes[key]
      )
        registrations.push({ kind, key: attributes[key] });
    }
  }
  return { registrations, unknown: [...unknown].sort() };
}

/**
 * What a package's `package.xml` says the set needs: its name and version, the packages it depends
 * on and conflicts with, and its target platform. Read from markup with its comments, processing
 * instructions and CDATA already taken out, as `verify-package-zip.mjs` reads it. An element's text
 * is trimmed, as Nuxeo's XML reader trims it.
 */
export function readDescriptor(xml) {
  const descriptor = {
    name: null,
    version: null,
    dependencies: [],
    conflicts: [],
    targetPlatform: null,
  };
  const root = /<package(?=[ \t\r\n/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(xml);
  if (root !== null) {
    const attributes = attributesOf(root[1]);
    descriptor.name = attributes.name ?? null;
    descriptor.version = attributes.version ?? null;
  }
  const texts = (list) =>
    [
      ...(
        new RegExp(`<${list}(?=[ \\t\\r\\n>])[^>]*>([\\s\\S]*?)</${list}[ \\t\\r\\n]*>`).exec(
          xml,
        )?.[1] ?? ''
      ).matchAll(/<package(?=[ \t\r\n>])[^>]*>([\s\S]*?)<\/package[ \t\r\n]*>/g),
    ].map(([, text]) => text.trim());
  descriptor.dependencies = texts('dependencies');
  descriptor.conflicts = texts('conflicts');
  const target = /<target-platform(?=[ \t\r\n>])[^>]*>([\s\S]*?)<\/target-platform[ \t\r\n]*>/.exec(
    xml,
  );
  if (target !== null) {
    const name = /<name(?=[ \t\r\n>])[^>]*>([\s\S]*?)<\/name[ \t\r\n]*>/
      .exec(target[1])?.[1]
      ?.trim();
    const version = /<version(?=[ \t\r\n>])[^>]*>([\s\S]*?)<\/version[ \t\r\n]*>/
      .exec(target[1])?.[1]
      ?.trim();
    descriptor.targetPlatform = { name: name ?? null, version: version ?? null };
  }
  return descriptor;
}

/**
 * Nuxeo's own Marketplace packages that a package of the candidate may depend on, by name, with the
 * packages of the candidate that may: `nuxeo-agentic-records` reviews the retention module's
 * records for disposition. The server installs them from Nuxeo's Marketplace, as `nuxeoctl
 * mp-install` resolves a dependency, never from this repository, so no version of them is the
 * candidate's to show met, and such a dependency is not a problem of the set. Any other dependency
 * outside the candidate still is, and so is one of these from any other package.
 */
export const PLATFORM_PACKAGES = new Map([['nuxeo-retention', new Set(['nuxeo-agentic-records'])]]);

/**
 * Every way the candidate's packages fail one another: a package named twice, a dependency the
 * candidate does not hold, but one of {@link PLATFORM_PACKAGES}, or holds at a version Nuxeo does not
 * count as meeting it, two packages one of which conflicts with the other, and a target platform
 * outside a dependency's. Each problem is a sentence naming the packages. `packages` is `[{ name,
 * version, dependencies, conflicts, targetPlatform, artifact }]`, as `readDescriptor` reads them,
 * with the file each came from.
 */
export function setProblems(packages) {
  const problems = [];
  const byName = new Map();
  for (const each of packages) {
    if (!byName.has(each.name)) byName.set(each.name, []);
    byName.get(each.name).push(each);
  }
  for (const [name, same] of byName) {
    if (same.length > 1)
      problems.push(
        `${same.map((each) => each.artifact).join(' and ')} are both the package ${name}: installing one replaces the other.`,
      );
  }
  for (const each of packages) {
    const who = `${each.name} ${each.version}`;
    if (each.version === null || !/[0-9]/.test(each.version))
      problems.push(
        `${who} (${each.artifact}) has no version Nuxeo can read, so it is 0.0.0 to Nuxeo and meets no dependency: its package.xml was not stamped.`,
      );
    for (const text of each.dependencies) {
      const dependency = parseDependency(text);
      const held = byName.get(dependency.name);
      if (!held && PLATFORM_PACKAGES.get(dependency.name)?.has(each.name)) continue;
      if (!held) {
        problems.push(
          `${who} depends on ${text}, and the candidate has no package ${dependency.name}. A dependency outside the candidate is not one this run can show met.`,
        );
        continue;
      }
      for (const provider of held) {
        if (!dependencyMatches(dependency, provider.version ?? ''))
          problems.push(
            `${who} depends on ${text}, and the candidate's ${dependency.name} is ${provider.version}, ${whyUnmet(dependency, provider.version ?? '')}.`,
          );
        const problem = platformProblem(each, provider);
        if (problem) problems.push(problem);
      }
    }
    for (const text of each.conflicts) {
      const conflict = parseDependency(text);
      for (const other of byName.get(conflict.name) ?? []) {
        if (other !== each && dependencyMatches(conflict, other.version ?? ''))
          problems.push(
            `${who} conflicts with ${text}, and the candidate holds ${other.name} ${other.version}: the two cannot be installed together.`,
          );
      }
    }
  }
  return problems;
}

/**
 * Why `dependent`'s target platform is not one `provider` installs on, or `null`. A package that
 * names no target platform admits every one; a range this port cannot read is refused, not guessed.
 */
export function platformProblem(dependent, provider) {
  const outer = provider.targetPlatform;
  if (outer === null || outer.version === null) return null;
  const inner = dependent.targetPlatform;
  const who = `${dependent.name} ${dependent.version}`;
  const of = `${provider.name} ${provider.version}`;
  if (inner === null || inner.version === null)
    return `${who} names no target platform, so it claims every one, and ${of}, which it depends on, installs only on ${outer.name} ${outer.version}.`;
  if (inner.name !== outer.name)
    return `${who} targets the platform ${inner.name}, and ${of}, which it depends on, targets ${outer.name}.`;
  const innerRange = platformRange(inner.version);
  const outerRange = platformRange(outer.version);
  if (innerRange === null || outerRange === null)
    return `${who}'s target platform ${inner.version} or ${of}'s ${outer.version} is not a range this run reads, so whether one is within the other was not decided.`;
  if (!rangeWithin(innerRange, outerRange))
    return `${who} targets ${inner.name} ${inner.version}, and ${of}, which it depends on, installs only on ${outer.version}: it claims platforms its dependency does not install on.`;
  return null;
}

/**
 * Everything two kits both contribute, `[{ kind, key, kits }]`, sorted. `kits` is
 * `[{ name, contributes: [{ kind, key }] }]`: the package name, the app id, the app's address (its
 * id where it names none), each queue, each action in `actions.json`, and what its components
 * register. Within one kit a repeat is not a conflict this check looks for: the pipeline and the
 * server judge a kit alone.
 */
export function duplicatesAcross(kits) {
  const owners = new Map();
  for (const kit of kits) {
    for (const { kind, key } of kit.contributes) {
      const id = `${kind}\u0000${key}`;
      if (!owners.has(id)) owners.set(id, { kind, key, kits: [] });
      const entry = owners.get(id);
      if (!entry.kits.includes(kit.name)) entry.kits.push(kit.name);
    }
  }
  return [...owners.values()]
    .filter((entry) => entry.kits.length > 1)
    .sort((a, b) => javaCompare(`${a.kind} ${a.key}`, `${b.kind} ${b.key}`));
}

/**
 * Every path `git status --porcelain=v1 -z` names, each a plain path: `XY path`, and for a rename
 * or a copy a second field, the path it came from, which is a path of its own, not one to cut
 * three characters from. A rename is listed by both its names.
 */
export function uncommittedPaths(status) {
  const fields = status.split('\0');
  const paths = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (field.length < 4) continue;
    paths.push(field.slice(3));
    if (/[RC]/.test(field.slice(0, 2)) && index + 1 < fields.length) paths.push(fields[++index]);
  }
  return paths;
}

/** Every file under `directory`, as paths relative to it with `/` between their parts, sorted. */
export function filesUnder(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(join(directory, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    )
    .sort();
}

/**
 * How the bundle a package deploys, the folder `deployed`, differs from the one that was built,
 * `built`, whose files are `files`: a phrase naming the files missing, the files there besides and
 * the files with other bytes, or `null` when the two are the same file for file and byte for byte.
 * A folder that is not there deploys no file.
 */
export function bundleDifferences(deployed, built, files) {
  const shipped = new Set(existsSync(deployed) ? filesUnder(deployed) : []);
  const wanted = new Set(files);
  const missing = files.filter((file) => !shipped.has(file));
  const extra = [...shipped].filter((file) => !wanted.has(file));
  const at = (root, file) => join(root, ...file.split('/'));
  const differing = files.filter(
    (file) =>
      shipped.has(file) && !readFileSync(at(deployed, file)).equals(readFileSync(at(built, file))),
  );
  const some = (list) => `${list.slice(0, 3).join(', ')}${list.length > 3 ? ', and more' : ''}`;
  const said = [
    missing.length > 0 ? `${missing.length} file(s) missing (${some(missing)})` : null,
    extra.length > 0 ? `${extra.length} file(s) it was not built with (${some(extra)})` : null,
    differing.length > 0
      ? `${differing.length} file(s) with other bytes (${some(differing)})`
      : null,
  ].filter(Boolean);
  return said.length === 0 ? null : said.join('; ');
}

/** `spawnSync` truncates a child's output in silence past its limit, 1 MiB by default. */
const OUTPUT_LIMIT = 64 * 1024 * 1024;

/** An archive unpacked into `into` with the system's `unzip`; an archive it refuses throws. */
export function unpack(archive, into) {
  mkdirSync(into, { recursive: true });
  const result = spawnSync('unzip', ['-q', '-o', archive, '-d', into], {
    encoding: 'utf8',
    maxBuffer: OUTPUT_LIMIT,
  });
  if (result.error) throw new Error(`unzip could not be run: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`${archive} could not be unpacked: ${(result.stderr || result.stdout).trim()}`);
  return into;
}

/** A `package.xml`'s text, as `readDescriptor` reads it once its comments and CDATA are out. */
export function descriptorOf(text) {
  return readDescriptor(withoutCdata(withoutCommentsOrInstructions(text.replace(/^\uFEFF/, ''))));
}

/** A JSON file of a bundle, or `null` when it is not there. */
function jsonIn(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) : null;
}

/** Where a kit names the allow-list of the deployment it is built for, beside its bundle. */
export const BUILD_ALLOW_LIST = ['deployment', 'build-allow-list.json'];

/**
 * The pipeline's arguments for the deployment's allow-list a kit is built against, as
 * app-packages.yml passes them: `--allow-list` its `deployment/build-allow-list.json`, a file
 * beside the bundle and never in it, or none, and then every operation its buttons run is refused
 * (package-pipeline.md, section 7). A link there is not taken for the file.
 */
export function allowListArguments(kitDirectory) {
  const file = join(kitDirectory, ...BUILD_ALLOW_LIST);
  return lstatSync(file, { throwIfNoEntry: false })?.isFile() ? ['--allow-list', file] : [];
}

/**
 * A kit's zip, unpacked under `scratch`: its descriptor, its app, and everything it contributes
 * that a second kit could contribute too (`duplicatesAcross`), with the extension points its
 * components contribute to that this check does not compare. Read from the bundle the zip carries,
 * as the server would read it: the manifest's components, and the app definition beside them.
 */
export function readKit(zip, scratch) {
  const root = unpack(zip, join(scratch, 'zip'));
  const descriptor = descriptorOf(readFileSync(join(root, 'package.xml'), 'utf8'));
  const bundles = join(root, 'install', 'bundles');
  const jars = existsSync(bundles)
    ? readdirSync(bundles).filter((name) => name.endsWith('.jar'))
    : [];
  if (jars.length !== 1)
    throw new Error(`${zip} carries ${jars.length} bundles in install/bundles/, and a kit is one.`);
  const bundle = unpack(join(bundles, jars[0]), join(scratch, 'bundle'));
  const contributes = [{ kind: 'package', key: descriptor.name }];
  const unknown = [];
  const manifest = readFileSync(join(bundle, 'META-INF', 'MANIFEST.MF'), 'utf8').replace(
    /^\uFEFF/,
    '',
  );
  for (const component of componentPathsOf(manifest)) {
    const read = registrationsOf(componentXmlOf(readFileSync(join(bundle, component), 'utf8')));
    contributes.push(...read.registrations);
    for (const point of read.unknown) unknown.push(`${point} (${component})`);
  }
  const config = join(bundle, 'agentic-ui-config');
  const app = jsonIn(join(config, 'app.json'));
  if (app === null) throw new Error(`${zip} carries no agentic-ui-config/app.json.`);
  contributes.push({ kind: 'app id', key: app.id });
  // With no address of its own, an app's id is its address (app-definition-v2.md, section 1).
  contributes.push({ kind: 'address', key: app.address ?? app.id });
  const queues = join(config, 'queues');
  if (existsSync(queues))
    for (const file of readdirSync(queues).sort())
      if (file.endsWith('.json'))
        contributes.push({ kind: 'queue', key: file.slice(0, -'.json'.length) });
  for (const action of jsonIn(join(config, 'actions.json'))?.actions ?? [])
    if (typeof action?.id === 'string') contributes.push({ kind: 'action', key: action.id });
  return {
    descriptor,
    app: { id: app.id, address: app.address ?? null, platform: app.platform ?? null },
    contributes,
    unknown,
  };
}

/**
 * A kit's zip held to its signature, given `--signatures`: the file `<zip name>.sig.json` in
 * `signatures`, checked against `trusted` as `app-package-signature.mjs verify` checks one, for the
 * kit's own name and version (`verifySignature`). Returns `{ ok, record }` or `{ ok, problems }`, with
 * the signature's path. So the candidate is refused for a kit that is unsigned, signed by no trusted
 * signer, or signed over other bytes or for another version, and a kit it takes is the one signed:
 * the candidate's build is reproducible, so a kit unchanged since it was signed has the same digest.
 *
 * `inHistory` answers whether a commit is in the candidate's history. A signature made from a
 * commit that is not is refused too: a tag pushed on a commit that was never merged runs the
 * workflow as that commit has it, and the trusted workflow's identity says nothing about review.
 */
export function kitSignature({
  zip,
  name,
  version,
  signatures,
  trusted,
  trustedRoot,
  env,
  inHistory,
}) {
  const signature = join(signatures, signatureFileFor(basename(zip)));
  const verified = verifySignature({ zip, signature, trusted, name, version, trustedRoot, env });
  if (verified.ok && !inHistory(verified.record.commit))
    return {
      signature,
      ok: false,
      problems: [
        `${basename(zip)} was signed from ${verified.record.commit}, which is not in this candidate's history: a tag on a commit that was never merged.`,
      ],
    };
  return { signature, ...verified };
}
