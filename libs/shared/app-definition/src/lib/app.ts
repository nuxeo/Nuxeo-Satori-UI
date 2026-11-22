/**
 * The validator of `app.json` (docs/business-apps/app-definition-v2.md, section 3): what the app
 * is called, who it is for, what it runs on and which domain modules it turns on.
 *
 * Unlike the other files, any finding here refuses the app when it loads as well as when it is
 * built: the shell refuses an app it cannot run rather than draw half of it.
 */
import { createChecker, ID, join, unreadable, type Checker, type Finding } from './checker';
import { isRecord, PACKAGED_REGISTRIES, type Registries } from './registries';
import { parseRange, parseVersion, satisfies } from './semver';

/** An app's id and address, and a module's id: lower case, as a path segment is. */
export const APP_ID = /^[a-z][a-z0-9-]{0,62}$/;

const APP_KEYS = [
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
  /** The platform version the range must hold, when the caller knows it: the pipeline does. */
  readonly platformVersion?: string;
}

export function validateApp(content: unknown, options: AppOptions = {}): Finding[] {
  const stop = unreadable(content, 'an app.json');
  if (stop) return stop;
  const app = content as Record<string, unknown>;
  const c = createChecker(options.registries ?? PACKAGED_REGISTRIES);
  c.unknownKeys(app, APP_KEYS, '');
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
  if (typeof app['packageVersion'] !== 'string' || !parseVersion(app['packageVersion']))
    c.add('packageVersion', 'structure', `needs the package's semantic version, such as "1.4.0"`);
  platform(c, app['platform'], options.platformVersion);
  groups(c, app['groups']);
  if ('modules' in app) modules(c, app['modules']);
  if ('branding' in app) branding(c, app['branding']);
  return c.findings;
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

/** An image as version 1's bootstrap writes it; `null` keeps the platform's own. */
function image(c: Checker, value: unknown, path: string): void {
  if (value === null) return;
  if (!isRecord(value)) {
    c.add(path, 'structure', 'an image is { "src": <source>, "alt": <text> }, or null');
    return;
  }
  c.unknownKeys(value, IMAGE_KEYS, path);
  const src = value['src'];
  if (
    typeof src !== 'string' ||
    !(isAssetPath(src) || src.startsWith('https://') || src.startsWith('data:image/'))
  ) {
    c.add(
      join(path, 'src'),
      'structure',
      'src is assets/<file> in the package, an https: address or a data:image/ address',
    );
  }
  if ('alt' in value && typeof value['alt'] !== 'string')
    c.add(join(path, 'alt'), 'structure', 'must be a text');
}

/** `assets/<file>`, inside the package's `assets/`: no `..`, no backslash. */
export function isAssetPath(src: string): boolean {
  return (
    src.startsWith('assets/') &&
    src.length > 'assets/'.length &&
    !src.includes('\\') &&
    !src.split('/').some((segment) => segment === '..' || segment === '')
  );
}
