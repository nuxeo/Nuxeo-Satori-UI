import { formatFiles, type Tree } from '@nx/devkit';

import { markupOnly, readAppPackage } from '../app-package/package-files';

export interface AppDependencySchema {
  package: string;
  name: string;
  version?: string;
  remove?: boolean;
}

/** A Marketplace package's name, as `package.xml` writes one. */
const NAME = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
/** A version Nuxeo reads, or a range of two: `0.1.0`, `2026.0.2`, `1.0.0:2.0.0`. */
const VERSION =
  /^[0-9]+(?:\.[0-9]+){0,2}(?:-[A-Za-z0-9.-]+)?(?::[0-9]+(?:\.[0-9]+){0,2}(?:-[A-Za-z0-9.-]+)?)?$/;
/** The platform's own package, which every kit depends on and none may drop. */
const PLATFORM = 'nuxeo-agentic-ui';

/**
 * Have the package depend on another Marketplace package, in `package/package.xml`'s
 * `<dependencies>`: an add-on whose facet, schema or operation the kit names, such as
 * `nuxeo-agentic-signature:0.1.0` for its `Signable` facet. Nuxeo installs the kit only where that
 * package is, at that version or above (`name:min`), or within a range (`name:min:max`).
 *
 * - **Written again,** a dependency the package has already is given the new version, in its place.
 * - **`--remove`** takes it out. The platform's own, `nuxeo-agentic-ui`, is never taken out: every
 *   kit's app runs on it.
 *
 * The release candidate holds each kit's dependencies to the packages it carries
 * (package-pipeline.md, section 11). Nothing here installs anything.
 */
export default async function appDependencyGenerator(tree: Tree, options: AppDependencySchema) {
  const pkg = readAppPackage(tree, options.package);
  const name = options.name ?? '';
  if (!NAME.test(name))
    throw new Error(
      `--name "${options.name}" is not a Marketplace package's name, such as nuxeo-agentic-signature.`,
    );
  if (name === pkg.root.slice(pkg.root.lastIndexOf('/') + 1))
    throw new Error(
      `--name ${name} is this package's own name: a package does not depend on itself.`,
    );
  if (options.remove && options.version !== undefined)
    throw new Error('--remove takes the dependency out: give it without --version.');
  if (!options.remove && (options.version === undefined || !VERSION.test(options.version)))
    throw new Error(
      `--version "${options.version ?? ''}" must be the version it needs at least, such as 0.1.0, or a range, 0.1.0:1.0.0.`,
    );
  if (options.remove && name === PLATFORM)
    throw new Error(
      `${PLATFORM} is the platform's own package, which every kit's app runs on: it stays.`,
    );
  const file = `${pkg.root}/package/package.xml`;
  const xml = tree.read(file, 'utf-8');
  if (xml === null) throw new Error(`${pkg.root} has no ${file}.`);
  const markup = markupOnly(xml);
  const entries = [...markup.matchAll(/<package>([^<]*)<\/package>/g)];
  const found = entries.find(([, text]) => text.trim().split(':')[0] === name);
  const entry = `<package>${name}:${options.version}</package>`;
  let written = xml;
  let said: string;
  if (options.remove) {
    if (!found) throw new Error(`${file} has no dependency on ${name} to take out.`);
    const at = found.index ?? 0;
    const lineStart = markup.lastIndexOf('\n', at - 1) + 1;
    const next = markup.indexOf('\n', at + found[0].length);
    const end = next < 0 ? markup.length : next + 1;
    const alone =
      markup.slice(lineStart, at).trim() === '' &&
      markup.slice(at + found[0].length, end).trim() === '';
    written = alone
      ? `${xml.slice(0, lineStart)}${xml.slice(end)}`
      : `${xml.slice(0, at)}${xml.slice(at + found[0].length)}`;
    said = `No longer depends on ${found[1].trim()}.`;
  } else if (found) {
    const at = found.index ?? 0;
    written = `${xml.slice(0, at)}${entry}${xml.slice(at + found[0].length)}`;
    said =
      found[1].trim() === `${name}:${options.version}`
        ? `Depends on ${name}:${options.version} already.`
        : `Depends on ${name}:${options.version}, not ${found[1].trim()}.`;
  } else {
    const close = markup.indexOf('</dependencies>');
    if (close < 0) {
      const end = markup.lastIndexOf('</package>');
      if (end < 0) throw new Error(`${file} has no </package>.`);
      const lineStart = markup.lastIndexOf('\n', end - 1) + 1;
      written = `${xml.slice(0, lineStart)}  <dependencies>\n    ${entry}\n  </dependencies>\n${xml.slice(lineStart)}`;
    } else {
      const lineStart = markup.lastIndexOf('\n', close - 1) + 1;
      const indent = markup.slice(lineStart, close);
      const inner = /^[ \t]*$/.test(indent) ? `${indent}  ` : '    ';
      written =
        markup.slice(lineStart, close).trim() === ''
          ? `${xml.slice(0, lineStart)}${inner}${entry}\n${xml.slice(lineStart)}`
          : `${xml.slice(0, close)}\n${inner}${entry}\n${xml.slice(close)}`;
    }
    said = `Depends on ${name}:${options.version}.`;
  }
  if (written !== xml) tree.write(file, written);
  await formatFiles(tree);
  return () => {
    console.log(`
${file}: ${said}

Nuxeo installs the package only where what it depends on is installed. Raising the package's own
version, in package.xml, app.json and the manifest together, is a person's step.
`);
  };
}
