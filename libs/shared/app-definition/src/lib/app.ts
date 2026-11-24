/**
 * The validator of `app.json` (docs/business-apps/app-definition-v2.md, section 3): what the app
 * is called, who it is for, what it runs on and which domain modules it turns on.
 *
 * Unlike the other files, any finding here refuses the app when it loads as well as when it is
 * built: the shell refuses an app it cannot run rather than draw half of it.
 */
import { createChecker, ID, join, unreadable, type Checker, type Finding } from './checker';
import { describeLogoSrcForm } from './image-source';
import { PLATFORM_ROUTES } from './platform-routes';
import { isRecord, PACKAGED_REGISTRIES, type Registries } from './registries';
import { parseRange, parseVersion, satisfies } from './semver';

/** An app's id and address, and a module's id: lower case, as a path segment is. */
export const APP_ID = /^[a-z][a-z0-9-]{0,62}$/;

const APP_KEYS = [
  '$schema',
  'version',
  'id',
  'label',
  'labelKey',
  'packageVersion',
  'platform',
  'address',
  'groups',
  'modules',
  'branding',
];
const BRANDING_KEYS = ['applicationTitle', 'documentTitle', 'theme', 'logo', 'favicon'];
const IMAGE_KEYS = ['src', 'alt'];

/** The keys each part of `app.json` may hold, which its JSON Schema must list too. */
export const APP_V2_KEYS = { app: APP_KEYS, branding: BRANDING_KEYS, image: IMAGE_KEYS } as const;

export interface AppOptions {
  readonly registries?: Registries;
  /**
   * The platform version the range must hold, when the caller knows it: the pipeline does. It must
   * be a semantic version: anything else is the caller's mistake, not the file's, and throws.
   */
  readonly platformVersion?: string;
}

export function validateApp(content: unknown, options: AppOptions = {}): Finding[] {
  const stop = unreadable(content, 'an app.json');
  if (stop) return stop;
  const app = content as Record<string, unknown>;
  const c = createChecker(options.registries ?? PACKAGED_REGISTRIES);
  c.unknownKeys(app, APP_KEYS, '');
  c.schemaKey(app);
  c.named(app, '');
  if (typeof app['id'] !== 'string' || !APP_ID.test(app['id']))
    c.add(
      'id',
      'structure',
      'needs an id: lower-case letters, digits and "-", starting with a letter',
    );
  if ('address' in app && (typeof app['address'] !== 'string' || !APP_ID.test(app['address'])))
    c.add(
      'address',
      'structure',
      'an address is lower-case letters, digits and "-", starting with a letter',
    );
  else address(c, app);
  if (typeof app['packageVersion'] !== 'string' || !parseVersion(app['packageVersion']))
    c.add('packageVersion', 'structure', `needs the package's semantic version, such as "1.4.0"`);
  platform(c, app['platform'], options.platformVersion);
  groups(c, app['groups']);
  if ('modules' in app) modules(c, app['modules']);
  if ('branding' in app) branding(c, app['branding']);
  return c.findings;
}

/**
 * A written address must not be a page the platform has already (`PLATFORM_ROUTES`): an app at
 * `/contracts` would take the platform's component showcase, and the shell, opening apps at their
 * address, could reach only one of them. An id that is one, with no address, is the same clash,
 * and is said rather than refused (`addressTakenById`): the contracts kit was built before this
 * rule, with the id `contracts` and no address, and still builds until it gives itself one.
 */
function address(c: Checker, app: Record<string, unknown>): void {
  const value = app['address'];
  if (typeof value !== 'string' || !PLATFORM_ROUTES.includes(value)) return;
  c.add(
    'address',
    'structure',
    `the address "${value}" is the platform's own page, /${value}: choose one no platform route has`,
  );
}

/**
 * What to say of an `app.json` that gives no address and whose id, its address therefore, is a
 * platform route, or `undefined`. Not a finding: refusing it would refuse a package built before
 * the rule. The command line says it, and the `app-package` generator writes every new app's
 * address, which `validateApp` then holds to the rule.
 */
export function addressTakenById(content: unknown): string | undefined {
  if (!isRecord(content) || 'address' in content) return undefined;
  const id = content['id'];
  if (typeof id !== 'string' || !PLATFORM_ROUTES.includes(id)) return undefined;
  return `with no "address", the app's address is its id, "${id}", which is the platform's own page, /${id}: give the app an "address" no platform route has`;
}

function platform(c: Checker, range: unknown, version: string | undefined): void {
  const comparators = typeof range === 'string' ? parseRange(range) : null;
  if (!comparators) {
    c.add(
      'platform',
      'structure',
      'needs the range of platform versions it runs on, such as ">=1.0.0 <2.0.0", "^1.2.0" or "~1.2.0"',
    );
    return;
  }
  if (version === undefined) return;
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`The platform version "${version}" is not a semantic version.`);
  if (!satisfies(parsed, comparators))
    c.add('platform', 'unknown', `this platform is ${version}, outside "${range as string}"`);
}

function groups(c: Checker, value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    c.add('groups', 'structure', 'needs the groups the app is for: "members" is everyone');
    return;
  }
  const seen = new Set<string>();
  value.forEach((group, index) => {
    const at = join('groups', index);
    if (typeof group !== 'string' || group.trim() === '' || group !== group.trim())
      c.add(at, 'structure', 'a group is the name of a Nuxeo group');
    else if (seen.has(group)) c.add(at, 'structure', `the group "${group}" is listed twice`);
    else seen.add(group);
  });
}

function modules(c: Checker, value: unknown): void {
  if (!Array.isArray(value)) {
    c.add('modules', 'structure', 'modules must be a list');
    return;
  }
  const seen = new Set<string>();
  value.forEach((module, index) => {
    const at = join('modules', index);
    if (typeof module !== 'string' || !APP_ID.test(module))
      c.add(at, 'structure', 'a module is named by its id');
    else if (seen.has(module)) c.add(at, 'structure', `the module "${module}" is listed twice`);
    else {
      seen.add(module);
      if (!c.registries.modules.has(module))
        c.add(at, 'unknown', `the module "${module}" is not registered`);
    }
  });
}

function branding(c: Checker, value: unknown): void {
  if (!isRecord(value)) {
    c.add('branding', 'structure', 'branding is an object');
    return;
  }
  c.unknownKeys(value, BRANDING_KEYS, 'branding');
  for (const key of ['applicationTitle', 'documentTitle']) {
    if (key in value && (typeof value[key] !== 'string' || value[key].trim() === ''))
      c.add(join('branding', key), 'structure', 'must be a text');
  }
  if ('theme' in value && (typeof value['theme'] !== 'string' || !ID.test(value['theme'])))
    c.add('branding.theme', 'structure', `theme is the id of one of the server's themes`);
  for (const key of ['logo', 'favicon']) {
    if (key in value) image(c, value[key], join('branding', key));
  }
}

/**
 * An image as version 1's bootstrap writes it, held to version 1's own rules for its source; `null`
 * keeps the platform's own. A relative source must also be in the package's `assets/`, so that the
 * package can be checked for the file.
 */
function image(c: Checker, value: unknown, path: string): void {
  if (value === null) return;
  if (!isRecord(value)) {
    c.add(path, 'structure', 'an image is { "src": <source>, "alt": <text> }, or null');
    return;
  }
  c.unknownKeys(value, IMAGE_KEYS, path);
  const src = value['src'];
  const problem =
    typeof src !== 'string'
      ? 'it is not a text'
      : (describeLogoSrcForm(src) ??
        (isRelative(src) && !src.startsWith('assets/')
          ? 'it is a relative path outside assets/, where a package keeps its images'
          : null));
  if (problem) c.add(join(path, 'src'), 'structure', `the source is refused: ${problem}`);
  if ('alt' in value && typeof value['alt'] !== 'string')
    c.add(join(path, 'alt'), 'structure', 'must be a text');
}

/** A source with no scheme: a path, which version 1 resolves against the configuration directory. */
function isRelative(src: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(src);
}

/**
 * The file in the package an accepted source names, as `assets/<path>`, or `null` for an address
 * elsewhere. Resolved as a browser resolves it, so `assets/./logo.svg` is `assets/logo.svg`: dot
 * segments removed, the query and fragment left out, then decoded.
 */
export function assetFile(src: string): string | null {
  if (!isRelative(src) || !src.startsWith('assets/')) return null;
  let path: string;
  try {
    path = new URL(src, 'https://package.invalid/').pathname.slice(1);
  } catch {
    return null;
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // Left encoded: a lone `%` is not an escape the browser would decode either.
  }
  return path.startsWith('assets/') ? path : null;
}
