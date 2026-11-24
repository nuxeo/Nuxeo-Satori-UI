import { APP_ID, validateApp } from '@agentic-ui/shared/app-definition';

/**
 * The app registry's listing, `apps.json`, as `nuxeo-agentic-core` serves it after sign-in
 * (`AppRegistryEndpoint`): the envelope of the configuration's own responses, layer `apps`.
 */
export const APP_REGISTRY_FORMAT = 'nuxeo-agentic-ui-config/1';

/** One app the person signed in may see, as the registry lists it. */
export interface RegistryApp {
  /** Its id, `app.json`'s. */
  readonly id: string;
  /** Its name, as "Switch app" lists it: `app.json`'s `label`, or `null`. */
  readonly label: string | null;
  /** Its name's key in the labels, or `null`. */
  readonly labelKey: string | null;
  /** Where its files are, relative to the registry's address: `apps/<id>/`. */
  readonly url: string;
  /** Every file the registry serves for it, by its path below the app's root, `app.json` first. */
  readonly files: readonly string[];
  /** Its `app.json`, as the package wrote it. */
  readonly content: Readonly<Record<string, unknown>>;
}

/** Something the registry says about the configuration in force, as the envelope says it. */
export interface RegistryDiagnostic {
  readonly level: string;
  readonly code: string;
  readonly message: string;
  /** The app it is about, or `null` when it is about none: an administrator's to read. */
  readonly app: string | null;
  readonly source: string;
}

/** The listing read: the apps the shell may run, and what was refused, each with its reason. */
export interface AppRegistryListing {
  readonly apps: readonly RegistryApp[];
  readonly diagnostics: readonly RegistryDiagnostic[];
  /** The apps the registry listed and this build refuses, with why: "Switch app" does not list them. */
  readonly refused: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

function readDiagnostic(raw: unknown): RegistryDiagnostic | null {
  if (!isRecord(raw) || typeof raw['message'] !== 'string') return null;
  return {
    level: typeof raw['level'] === 'string' ? raw['level'] : 'info',
    code: typeof raw['code'] === 'string' ? raw['code'] : '',
    message: raw['message'],
    app: text(raw['app']),
    source: typeof raw['source'] === 'string' ? raw['source'] : '',
  };
}

/**
 * The listing the registry answered, read tolerantly as a configuration response is, and strictly
 * where the shell would run what it reads: `{ invalid }` for a body that is not the registry's
 * envelope, which is a registry that does not answer.
 *
 * Each app's `app.json` is held to the validator, as app-definition-v2.md section 12 asks of the
 * shell: any finding refuses the app, an unknown key included, and "Switch app" does not list it.
 * An app the shell cannot read whole would run half configured. So is an entry whose files or
 * address are not the registry's: the shell would ask for files that are not there.
 *
 * @param platformVersion the platform's version, which an app's range must hold; `undefined`, as
 *   in this build, leaves the range unchecked here (the pipeline checks it against the server's)
 */
export function readAppRegistry(
  raw: unknown,
  platformVersion?: string,
): AppRegistryListing | { readonly invalid: string } {
  if (!isRecord(raw) || raw['format'] !== APP_REGISTRY_FORMAT || raw['layer'] !== 'apps') {
    return { invalid: `it is not the app registry's ${APP_REGISTRY_FORMAT} listing` };
  }
  if (!Array.isArray(raw['apps'])) return { invalid: 'it lists no apps' };
  const apps: RegistryApp[] = [];
  const refused: string[] = [];
  const seen = new Set<string>();
  raw['apps'].forEach((entry, index) => {
    const id = isRecord(entry) ? entry['id'] : undefined;
    const name = typeof id === 'string' ? `the app "${id}"` : `apps[${index}]`;
    if (!isRecord(entry) || typeof id !== 'string' || !APP_ID.test(id)) {
      refused.push(`${name}: it has no id`);
      return;
    }
    if (seen.has(id)) {
      refused.push(`${name}: it is listed twice`);
      return;
    }
    const files = entry['files'];
    if (
      entry['url'] !== `apps/${id}/` ||
      !Array.isArray(files) ||
      !files.every((file) => typeof file === 'string') ||
      !isRecord(entry['content'])
    ) {
      refused.push(`${name}: it is not listed as the registry lists an app`);
      return;
    }
    const content = entry['content'];
    if (content['id'] !== id) {
      refused.push(`${name}: its app.json is another app's`);
      return;
    }
    const findings = validateApp(content, { platformVersion });
    if (findings.length > 0) {
      refused.push(
        `${name}: ${findings.map((finding) => `${finding.path || 'app.json'}: ${finding.message}`).join('; ')}`,
      );
      return;
    }
    seen.add(id);
    apps.push({
      id,
      label: text(content['label']),
      labelKey: text(content['labelKey']),
      url: `apps/${id}/`,
      files: files as string[],
      content,
    });
  });
  const diagnostics = Array.isArray(raw['diagnostics'])
    ? raw['diagnostics'].flatMap((entry) => {
        const diagnostic = readDiagnostic(entry);
        return diagnostic ? [diagnostic] : [];
      })
    : [];
  return { apps, diagnostics, refused };
}

/** The languages an app has labels in, from the files the registry serves for it. */
export function labelLanguagesOf(app: RegistryApp | null): readonly string[] {
  if (!app) return [];
  return app.files.flatMap((file) => {
    const match = /^labels\/([^/]+)\.json$/.exec(file);
    return match?.[1] ? [match[1]] : [];
  });
}
