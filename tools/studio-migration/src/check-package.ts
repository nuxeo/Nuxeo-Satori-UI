/**
 * Check 10, package (docs/business-apps/studio-migration.md, section 6): the migrated package is
 * valid, by the package pipeline's own checks.
 *
 * Every file under `app/` is placed and validated by `libs/shared/app-definition`, as step 2 of
 * `scripts/app-package.mjs` does: its schema, the IDs it names against the platform's registries,
 * the operations against the deployment's allow-list, and `app.json`'s platform range against the
 * platform's version. A file with no place in an app definition is refused, as inside a package.
 *
 * An action's operation is held to the deployment's allow-list when the harness is given one. When
 * it is not, the list the conversion recorded is used, and the check runs only in part: a
 * conversion's word for what was allowed is not the deployment's.
 *
 * Version 1 layout files are the one gap: app-definition leaves them to the version 1 reader of
 * `libs/shared/document-layouts`, which that Angular library does not export, so the pipeline
 * counts them and checks nothing. This check holds them to version 1's documented contract
 * (extension-reference.md, section 9b) instead, and more strictly than the reader, which skips an
 * entry it cannot read: a package that is built is refused for anything at all.
 */
import { isRecord, placeFile, validateFile } from '@agentic-ui/shared/app-definition';
import type { CheckOutcome, HarnessInput } from './harness';

/** Version 1's own files, which a package may hold beside version 2's. */
const VERSION_ONE_FILES = new Set(['bootstrap.json', 'manifest.json', 'layouts.json']);
const SECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const XPATH = /^[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*$/;
const FILE_KEYS = ['$schema', 'version', 'display', 'sections'];
const SECTION_KEYS = ['id', 'label', 'labelKey', 'fields'];
const FIELD_KEYS = ['field', 'label', 'labelKey', 'required'];

export function checkPackage({
  conversion,
  allowList,
  allowListFromReport,
  platformVersion,
}: HarnessInput): CheckOutcome {
  const findings: string[] = [];
  const app = conversion.app;
  if (!Object.hasOwn(app, 'app.json'))
    findings.push('app/app.json is missing: an app definition needs one');
  const context = {
    app: app['app.json'],
    actions: app['actions.json'],
    assets: new Set(Object.keys(conversion.appAssets).filter((path) => path.startsWith('assets/'))),
    // The queues the home and the menu may name: the package's own, by their files' names.
    queues: new Set(
      Object.keys(app)
        .map((path) => /^queues\/([^/]+)\.json$/.exec(path)?.[1])
        .filter((id): id is string => id !== undefined),
    ),
  };
  for (const path of Object.keys(conversion.appAssets))
    if (!path.startsWith('assets/'))
      findings.push(`app/${path}: a file that is not JSON belongs in assets/`);
  for (const [path, content] of Object.entries(app)) {
    if (VERSION_ONE_FILES.has(path)) continue;
    const placed = placeFile(path, (root) => root === '');
    if (placed === null || placed.root !== '') {
      findings.push(`app/${path}: it is out of place, so the package would be refused`);
      continue;
    }
    if (placed.file.kind === 'layout' && isRecord(content) && content['version'] === 1) {
      findings.push(...versionOne(content).map((message) => `app/${path}: ${message}`));
      continue;
    }
    for (const finding of validateFile(placed.file, content, context, {
      operations: allowList,
      platformVersion,
    }))
      findings.push(`app/${path}${finding.path ? ` ${finding.path}` : ''}: ${finding.message}`);
  }
  // The conversion's own record of what was allowed is not the deployment's word for it.
  const actions = app['actions.json'];
  const operations =
    isRecord(actions) && Array.isArray(actions['actions'])
      ? actions['actions'].some((action) => isRecord(action) && 'operation' in action)
      : false;
  return {
    findings,
    ...(allowListFromReport && operations
      ? {
          rest: "Its actions' operations were held to the allow-list the conversion recorded: the deployment's own, given with --allow-list, decides",
        }
      : {}),
  };
}

/** A version 1 layout file's findings against extension-reference.md, section 9b. */
export function versionOne(file: Record<string, unknown>): string[] {
  const findings: string[] = [];
  const unknown = (value: Record<string, unknown>, keys: readonly string[], at: string): void => {
    for (const key of Object.keys(value))
      if (!keys.includes(key))
        findings.push(`${at}${key} is not a key version 1 has, and the app ignores it`);
  };
  unknown(file, FILE_KEYS, '');
  const display = file['display'] ?? 'sections';
  if (display !== 'sections' && display !== 'tabs')
    findings.push('display is "sections" or "tabs"');
  const sections = file['sections'];
  if (!Array.isArray(sections)) return [...findings, 'sections must be a list'];
  const ids = new Set<string>();
  sections.forEach((section, index) => {
    const at = `sections.${index}`;
    if (!isRecord(section)) {
      findings.push(`${at} must be an object`);
      return;
    }
    unknown(section, SECTION_KEYS, `${at}.`);
    const id = section['id'];
    if (typeof id !== 'string' || !SECTION_ID.test(id))
      findings.push(
        `${at}.id is 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit`,
      );
    else if (ids.has(id)) findings.push(`${at}.id "${id}" is used twice`);
    else ids.add(id);
    for (const key of ['label', 'labelKey'])
      if (key in section && typeof section[key] !== 'string')
        findings.push(`${at}.${key} must be a text`);
    const fields = section['fields'];
    if (!Array.isArray(fields)) {
      findings.push(`${at}.fields must be a list`);
      return;
    }
    const seen = new Set<string>();
    fields.forEach((entry, position) => {
      const place = `${at}.fields.${position}`;
      const field =
        typeof entry === 'string' ? entry : isRecord(entry) ? entry['field'] : undefined;
      if (typeof field !== 'string' || !XPATH.test(field)) {
        findings.push(`${place} is not "<prefix>:<name>" or { "field": "<prefix>:<name>" }`);
        return;
      }
      if (seen.has(field)) findings.push(`${place} lists ${field} again in its section`);
      seen.add(field);
      if (isRecord(entry)) {
        unknown(entry, FIELD_KEYS, `${place}.`);
        if ('required' in entry && entry['required'] !== true)
          findings.push(`${place}.required is true, or left out`);
        for (const key of ['label', 'labelKey'])
          if (key in entry && typeof entry[key] !== 'string')
            findings.push(`${place}.${key} must be a text`);
      }
    });
  });
  return findings;
}
