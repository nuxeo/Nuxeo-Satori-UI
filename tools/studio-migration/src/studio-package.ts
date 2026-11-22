/**
 * A Studio Designer package as a customer hands it over: a Nuxeo package (`package.xml`,
 * `install.xml`, `studio-registries.json`) holding the project's bundle, a JAR whose files are the
 * Web UI customisations, the model contributions, the translations and Studio's own records.
 *
 * Section 2 of docs/business-apps/studio-migration.md describes what each part holds.
 */
import { parseXml } from './markup';
import { DEFAULT_ZIP_LIMITS, readZip, ZipError, type ZipLimits } from './zip';

export interface StudioPackageDescriptor {
  readonly type: string;
  readonly name: string;
  readonly version: string;
  /** The platform range, such as `[2025.0,2026)`, or `null` if the package names none. */
  readonly targetPlatform: string | null;
  /** The platform's name, such as `lts`. */
  readonly targetPlatformName: string | null;
  /** The packages it depends on, such as `nuxeo-web-ui`. */
  readonly dependencies: readonly string[];
}

export interface StudioPackage {
  readonly descriptor: StudioPackageDescriptor;
  /** The files of the Nuxeo package itself, the bundle among them. */
  readonly packageFiles: ReadonlyMap<string, Buffer>;
  /** The bundle's name in the package. */
  readonly bundlePath: string;
  /** The files inside the bundle. */
  readonly bundleFiles: ReadonlyMap<string, Buffer>;
}

export class StudioPackageError extends Error {
  override readonly name = 'StudioPackageError';
}

export function readStudioPackage(
  archive: Buffer,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): StudioPackage {
  const packageFiles = readZip(archive, limits);
  const descriptorFile = packageFiles.get('package.xml');
  if (!descriptorFile) {
    throw new StudioPackageError('not a Nuxeo package: there is no package.xml at its root');
  }
  const descriptor = readDescriptor(descriptorFile.toString('utf8'));
  if (descriptor.type !== 'studio') {
    throw new StudioPackageError(
      `package.xml declares a "${descriptor.type}" package, not a Studio package`,
    );
  }
  const bundlePath = findBundle(packageFiles);
  // findBundle returns only a name the package holds.
  const bundle = packageFiles.get(bundlePath) ?? Buffer.alloc(0);
  let bundleFiles: ReadonlyMap<string, Buffer>;
  try {
    bundleFiles = readZip(bundle, limits);
  } catch (error) {
    if (error instanceof ZipError) throw new ZipError(`${bundlePath}: ${error.message}`);
    throw error;
  }
  return { descriptor, packageFiles, bundlePath, bundleFiles };
}

function readDescriptor(xml: string): StudioPackageDescriptor {
  let root: Element;
  try {
    root = parseXml(xml).documentElement;
  } catch (error) {
    throw new StudioPackageError(`package.xml is not well-formed XML: ${(error as Error).message}`);
  }
  if (root.localName !== 'package') {
    throw new StudioPackageError(`package.xml's root is <${root.localName}>, not <package>`);
  }
  const required = (attribute: string): string => {
    const value = root.getAttribute(attribute);
    if (!value) throw new StudioPackageError(`package.xml's <package> has no ${attribute}`);
    return value;
  };
  const platform = child(root, 'target-platform');
  return {
    type: required('type'),
    name: required('name'),
    version: required('version'),
    targetPlatform: text(platform && child(platform, 'version')),
    targetPlatformName: text(platform && child(platform, 'name')),
    dependencies: children(child(root, 'dependencies'), 'package')
      .map((element) => text(element))
      .filter((name): name is string => !!name),
  };
}

/**
 * The bundle `install.xml` installs, or the package's only JAR when `install.xml` names none.
 * Two JARs and no `install.xml` to choose between them is refused rather than guessed.
 */
function findBundle(files: ReadonlyMap<string, Buffer>): string {
  const install = files.get('install.xml');
  if (install) {
    let root: Element;
    try {
      root = parseXml(install.toString('utf8')).documentElement;
    } catch (error) {
      throw new StudioPackageError(
        `install.xml is not well-formed XML: ${(error as Error).message}`,
      );
    }
    const named = children(root, 'update')
      .map((update) => update.getAttribute('file') ?? '')
      .map((file) => file.replace(/^\$\{package\.root\}\//, ''))
      .filter((file) => file.endsWith('.jar'));
    if (named.length > 1) {
      throw new StudioPackageError(
        `install.xml installs ${named.length} bundles; a Studio package has one`,
      );
    }
    if (named.length === 1) {
      if (!files.has(named[0])) {
        throw new StudioPackageError(
          `install.xml installs ${named[0]}, which the package does not hold`,
        );
      }
      return named[0];
    }
  }
  const jars = [...files.keys()].filter((name) => !name.includes('/') && name.endsWith('.jar'));
  if (jars.length !== 1) {
    throw new StudioPackageError(
      jars.length === 0
        ? 'the package holds no bundle: no .jar at its root'
        : `the package holds ${jars.length} JARs at its root and install.xml does not say which is the bundle`,
    );
  }
  return jars[0];
}

function child(parent: Element | null, name: string): Element | null {
  return parent ? (children(parent, name)[0] ?? null) : null;
}

function children(parent: Element | null, name: string): Element[] {
  return parent ? Array.from(parent.children).filter((element) => element.localName === name) : [];
}

function text(element: Element | null): string | null {
  const value = element?.textContent?.trim();
  return value ? value : null;
}
