/**
 * The validators of the two files that have no IDs to name: a labels file, `labels/<locale>.json`,
 * and a module's settings, `modules/<module>.json` (docs/business-apps/app-definition-v2.md,
 * sections 7 and 8).
 */
import { createChecker, unreadable, type Finding } from './checker';
import { isRecord, PACKAGED_REGISTRIES, type Registries } from './registries';

/** A key as the platform's catalogues write theirs, `layout.field.claim:memberId` among them. */
export const LABEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

const LABELS_KEYS = ['version', 'labels'];
const MODULE_KEYS = ['version', 'settings'];

/** The keys of a labels file and of a module's settings, which their JSON Schemas must list too. */
export const LABELS_V2_KEYS = { labels: LABELS_KEYS, module: MODULE_KEYS } as const;

export function validateLabels(content: unknown): Finding[] {
  const stop = unreadable(content, 'a labels file');
  if (stop) return stop;
  const file = content as Record<string, unknown>;
  const c = createChecker(PACKAGED_REGISTRIES);
  c.unknownKeys(file, LABELS_KEYS, '');
  const labels = file['labels'];
  if (!isRecord(labels)) {
    c.add('labels', 'structure', 'labels maps each key to its text');
    return c.findings;
  }
  for (const [key, text] of Object.entries(labels)) {
    // A key holds dots, so the place is written with brackets: labels["payers.app.claims"].
    const at = `labels[${JSON.stringify(key)}]`;
    if (!LABEL_KEY.test(key))
      c.add(
        at,
        'structure',
        'a label key is letters, digits, ".", "_", ":" and "-", starting with a letter or digit',
      );
    else if (typeof text !== 'string' || text.trim() === '')
      c.add(at, 'structure', 'must be a text');
  }
  return c.findings;
}

/**
 * A module's settings. Each module brings the schema of its own settings when it is built; until
 * one does, this checks that the module is registered and that its settings are an object.
 */
export function validateModuleSettings(
  content: unknown,
  options: { readonly module: string; readonly registries?: Registries },
): Finding[] {
  const stop = unreadable(content, 'a module settings file');
  if (stop) return stop;
  const file = content as Record<string, unknown>;
  const c = createChecker(options.registries ?? PACKAGED_REGISTRIES);
  c.unknownKeys(file, MODULE_KEYS, '');
  if (!c.registries.modules.has(options.module))
    c.add('', 'unknown', `the module "${options.module}" is not registered`);
  if (!isRecord(file['settings'])) c.add('settings', 'structure', 'settings must be an object');
  return c.findings;
}
