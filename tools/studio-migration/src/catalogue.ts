/**
 * The catalogue: what each Web UI slot, element and theme property becomes in the new app, read
 * from `catalogue/*.json` and checked as it loads, so a mistaken edit fails at once instead of
 * quietly mapping something to nowhere.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type How = 'automatic' | 'agent-proposes' | 'reported';
export type ElementRole = 'field' | 'structure' | 'data' | 'action' | 'navigation' | 'theme';

export interface SlotEntry {
  readonly what: string;
  readonly how: How;
  /** The app slot a contribution goes to. */
  readonly slot?: string;
  /** Or the Layer 0 key, for what is configuration rather than a slot entry. */
  readonly layer0?: string;
  readonly note?: string;
}

export interface ElementEntry {
  readonly role: ElementRole;
  readonly how: How;
  readonly becomes: string;
  readonly note?: string;
}

export interface Catalogue {
  readonly appSlots: readonly string[];
  readonly reportedBecause: string;
  readonly slots: Readonly<Record<string, SlotEntry>>;
  readonly elements: Readonly<Record<string, ElementEntry>>;
  readonly tokens: Readonly<Record<string, string>>;
  /** Exact names, and families ending in `-` matched by prefix. */
  readonly reportedProperties: Readonly<Record<string, string>>;
}

export type TokenMapping =
  | { readonly property: string; readonly token: string }
  | { readonly property: string; readonly token: null; readonly reason: string };

export class CatalogueError extends Error {
  override readonly name = 'CatalogueError';
}

const HOW: readonly How[] = ['automatic', 'agent-proposes', 'reported'];
const ROLES: readonly ElementRole[] = [
  'field',
  'structure',
  'data',
  'action',
  'navigation',
  'theme',
];
const LAYER0_KEYS = ['themes'];

export const CATALOGUE_DIRECTORY = join(__dirname, '..', 'catalogue');

export function loadCatalogue(directory = CATALOGUE_DIRECTORY): Catalogue {
  const read = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(directory, name), 'utf8')) as Record<string, unknown>;
  const slots = read('slots.json');
  const elements = read('elements.json');
  const theme = read('theme-tokens.json');
  const catalogue: Catalogue = {
    appSlots: slots['appSlots'] as string[],
    reportedBecause: slots['reportedBecause'] as string,
    slots: slots['slots'] as Record<string, SlotEntry>,
    elements: elements['elements'] as Record<string, ElementEntry>,
    tokens: theme['tokens'] as Record<string, string>,
    reportedProperties: theme['reported'] as Record<string, string>,
  };
  const problems = validate(catalogue);
  if (problems.length > 0) {
    throw new CatalogueError(`the catalogue in ${directory} is wrong:\n- ${problems.join('\n- ')}`);
  }
  return catalogue;
}

/** Everything wrong with a catalogue; empty when it is sound. Exported for its own tests. */
export function validate(catalogue: Catalogue): string[] {
  const problems: string[] = [];
  if (!Array.isArray(catalogue.appSlots) || catalogue.appSlots.length === 0) {
    problems.push('slots.json: appSlots must list the app slots');
  }
  for (const [name, entry] of Object.entries(catalogue.slots ?? {})) {
    if (!/^[A-Z][A-Z_]*$/.test(name))
      problems.push(`slots.json: ${name} is not a Web UI slot name`);
    if (!HOW.includes(entry.how)) problems.push(`slots.json: ${name} has how "${entry.how}"`);
    if (!entry.what) problems.push(`slots.json: ${name} does not say what the slot is`);
    const targets = [entry.slot, entry.layer0].filter((target) => target !== undefined);
    if (entry.how === 'reported' && targets.length > 0) {
      problems.push(`slots.json: ${name} is reported, so it may not name a target`);
    }
    if (entry.how !== 'reported' && targets.length !== 1) {
      problems.push(`slots.json: ${name} must name exactly one target, a slot or a Layer 0 key`);
    }
    if (entry.slot !== undefined && !catalogue.appSlots.includes(entry.slot)) {
      problems.push(`slots.json: ${name} goes to "${entry.slot}", which is not an app slot`);
    }
    if (entry.layer0 !== undefined && !LAYER0_KEYS.includes(entry.layer0)) {
      problems.push(`slots.json: ${name} goes to Layer 0 key "${entry.layer0}", which is not one`);
    }
  }
  for (const [name, entry] of Object.entries(catalogue.elements ?? {})) {
    if (!name.includes('-')) problems.push(`elements.json: ${name} is not a custom element name`);
    if (!ROLES.includes(entry.role))
      problems.push(`elements.json: ${name} has role "${entry.role}"`);
    if (!HOW.includes(entry.how)) problems.push(`elements.json: ${name} has how "${entry.how}"`);
    if (!entry.becomes) problems.push(`elements.json: ${name} does not say what it becomes`);
  }
  for (const [property, token] of Object.entries(catalogue.tokens ?? {})) {
    if (!property.startsWith('--'))
      problems.push(`theme-tokens.json: ${property} is not a custom property`);
    if (!/^--mat-sys-[a-z-]+$/.test(token)) {
      problems.push(
        `theme-tokens.json: ${property} maps to "${token}", which is not a --mat-sys-* token`,
      );
    }
    if (property in (catalogue.reportedProperties ?? {})) {
      problems.push(`theme-tokens.json: ${property} is both mapped and reported`);
    }
  }
  for (const [key, reason] of Object.entries(catalogue.reportedProperties ?? {})) {
    if (!key.startsWith('--'))
      problems.push(`theme-tokens.json: reported "${key}" is not a custom property`);
    if (!reason) problems.push(`theme-tokens.json: reported "${key}" gives no reason`);
  }
  if (!('--' in (catalogue.reportedProperties ?? {}))) {
    problems.push(
      'theme-tokens.json: "reported" needs a "--" entry, so that every property gets a reason',
    );
  }
  return problems;
}

/** The token a theme property sets, or the reason it sets none. */
export function mapThemeProperty(catalogue: Catalogue, property: string): TokenMapping {
  const token = catalogue.tokens[property];
  if (token) return { property, token };
  const reported = catalogue.reportedProperties;
  if (property in reported) return { property, token: null, reason: reported[property] };
  const family = Object.keys(reported)
    .filter((key) => key.endsWith('-') && property.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return { property, token: null, reason: reported[family] };
}
