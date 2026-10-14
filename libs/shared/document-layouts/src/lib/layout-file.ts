import { APP_CONFIG_FORMAT } from '@nuxeo-satori/platform/app-config';

import { LayoutDisplay } from './layout.model';

/** The same patterns the configuration service validates contributions with (`ContributionRegistry`). */
export const LAYOUT_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
export const LAYOUT_MODE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

const SECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const XPATH = /^[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*$/;

export interface LayoutIndexEntry {
  readonly type: string;
  readonly mode: string;
  /** The package component that contributed the layout in force. */
  readonly component: string;
}

/** A contribution the server rejected, replaced or removed, as `layouts.json` reports it. */
export interface LayoutServerDiagnostic {
  readonly level: string;
  readonly code: string;
  readonly message: string;
}

export interface LayoutIndex {
  readonly entries: readonly LayoutIndexEntry[];
  readonly diagnostics: readonly LayoutServerDiagnostic[];
}

export interface LayoutFileField {
  readonly field: string;
  readonly label?: string;
  readonly labelKey?: string;
  /** In the edit and create forms, the field must have a value. Only `true` counts. */
  readonly required?: boolean;
}

export interface LayoutFileSection {
  readonly id: string;
  readonly label?: string;
  readonly labelKey?: string;
  readonly fields: readonly LayoutFileField[];
}

/** A layout file that passed validation, and the entries in it that were skipped. */
export interface LayoutFile {
  readonly display: LayoutDisplay;
  readonly sections: readonly LayoutFileSection[];
  readonly problems: readonly string[];
}

export type Invalid = { readonly invalid: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** `layouts.json`: which types and modes have a contributed layout in force. */
export function readLayoutIndex(raw: unknown): LayoutIndex | Invalid {
  if (!isRecord(raw) || raw['format'] !== APP_CONFIG_FORMAT) {
    return { invalid: `not a ${APP_CONFIG_FORMAT} response` };
  }
  if (raw['layer'] !== 'layouts') {
    return { invalid: `expected layer "layouts", got "${String(raw['layer'])}"` };
  }
  const layouts = raw['layouts'];
  if (!Array.isArray(layouts)) return { invalid: 'layouts must be a list' };
  const diagnostics = Array.isArray(raw['diagnostics']) ? raw['diagnostics'] : [];
  return {
    entries: layouts.filter(isRecord).flatMap((entry) => {
      const type = entry['type'];
      const mode = entry['mode'];
      if (typeof type !== 'string' || !LAYOUT_TYPE_PATTERN.test(type)) return [];
      if (typeof mode !== 'string' || !LAYOUT_MODE_PATTERN.test(mode)) return [];
      return [{ type, mode, component: optionalText(entry['component']) ?? '' }];
    }),
    diagnostics: diagnostics.filter(isRecord).map((entry) => ({
      level: optionalText(entry['level']) ?? 'info',
      code: optionalText(entry['code']) ?? '',
      message: optionalText(entry['message']) ?? '',
    })),
  };
}

/** `layouts/<type>/<mode>.layout.json`: the envelope around one layout file. */
export function readLayoutEnvelope(
  raw: unknown,
  type: string,
  mode: string,
): { readonly content: Record<string, unknown> } | Invalid {
  if (!isRecord(raw) || raw['format'] !== APP_CONFIG_FORMAT) {
    return { invalid: `not a ${APP_CONFIG_FORMAT} response` };
  }
  if (raw['layer'] !== 'layout' || raw['type'] !== type || raw['mode'] !== mode) {
    return { invalid: `expected the ${type}/${mode} layout` };
  }
  const content = raw['content'];
  return isRecord(content) ? { content } : { invalid: 'content must be a JSON object' };
}

/**
 * Validate a layout file, version 1.
 *
 * A structural error refuses the whole file, because a half-read layout would show a different
 * set of fields from the one its author wrote. A field entry that is not an xpath is skipped and
 * reported; whether a field exists on the type is decided later, against its schemas.
 */
export function readLayoutFile(content: Record<string, unknown>): LayoutFile | Invalid {
  if (content['version'] !== 1) {
    return { invalid: `version must be 1, got ${JSON.stringify(content['version'] ?? null)}` };
  }
  const display = content['display'] ?? 'sections';
  if (display !== 'sections' && display !== 'tabs') {
    return { invalid: `display must be "sections" or "tabs", got ${JSON.stringify(display)}` };
  }
  const sections = content['sections'];
  if (!Array.isArray(sections)) return { invalid: 'sections must be a list' };

  const problems: string[] = [];
  const seen = new Set<string>();
  const read: LayoutFileSection[] = [];
  for (const [index, section] of sections.entries()) {
    if (!isRecord(section)) return { invalid: `sections[${index}] must be an object` };
    const id = section['id'];
    if (typeof id !== 'string' || !SECTION_ID.test(id)) {
      return {
        invalid: `sections[${index}].id must be 1 to 64 letters, digits, '.', '_' or '-', starting with a letter or digit`,
      };
    }
    if (seen.has(id)) return { invalid: `section id "${id}" is used twice` };
    seen.add(id);
    const fields = section['fields'];
    if (!Array.isArray(fields)) return { invalid: `section "${id}" needs a fields list` };
    read.push({
      id,
      label: optionalText(section['label']),
      labelKey: optionalText(section['labelKey']),
      fields: readFields(id, fields, problems),
    });
  }
  return { display, sections: read, problems };
}

/** A section's fields, skipping and reporting any that is not an xpath or is listed twice. */
function readFields(section: string, entries: unknown[], problems: string[]): LayoutFileField[] {
  const seen = new Set<string>();
  return entries.flatMap((entry, position) => {
    const field = readField(entry);
    if (!field) {
      problems.push(`section "${section}" field ${position + 1} is not "<prefix>:<name>"`);
      return [];
    }
    if (seen.has(field.field)) {
      problems.push(`section "${section}" lists ${field.field} twice`);
      return [];
    }
    seen.add(field.field);
    return [field];
  });
}

function readField(entry: unknown): LayoutFileField | null {
  if (typeof entry === 'string') return XPATH.test(entry) ? { field: entry } : null;
  if (!isRecord(entry)) return null;
  const field = entry['field'];
  if (typeof field !== 'string' || !XPATH.test(field)) return null;
  return {
    field,
    label: optionalText(entry['label']),
    labelKey: optionalText(entry['labelKey']),
    ...(entry['required'] === true ? { required: true } : {}),
  };
}
