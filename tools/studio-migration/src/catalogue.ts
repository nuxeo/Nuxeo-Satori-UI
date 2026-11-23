/**
 * The catalogue: what each Web UI slot, element and theme property becomes in the new app, and
 * which scripts are the ones Studio generates. Read from `catalogue/*.json` and checked as it
 * loads, so a mistaken edit fails at once instead of quietly mapping something to nowhere.
 *
 * Every lookup is by own property only. The names come from a customer's package, and a slot
 * named `constructor` must not find an entry on `Object.prototype`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGED_WIDGETS } from '@agentic-ui/shared/app-definition';

export type How = 'automatic' | 'agent-proposes' | 'reported';
export type ElementRole =
  'field' | 'structure' | 'data' | 'action' | 'navigation' | 'theme' | 'condition';

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
  /**
   * For a field element: the layout version 2 widget it becomes, or `null` when the property's
   * schema type picks it, as for a plain text or number field.
   */
  readonly widget?: string | null;
  /** A widget parameter, to the element attribute that gives its value. */
  readonly parameters?: Readonly<Record<string, string>>;
}

/** A script Studio or Web UI generates, known by its shape (`script-shape.ts`). */
export interface ScriptEntry {
  readonly name: string;
  readonly sha256: string;
  /** Where the shape was read from. */
  readonly seen: string;
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
  readonly scripts: readonly ScriptEntry[];
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
  'condition',
];
const LAYER0_KEYS = ['themes'];

export const CATALOGUE_DIRECTORY = join(__dirname, '..', 'catalogue');

/** The record's own value for the key, never one inherited from `Object.prototype`. */
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function loadCatalogue(directory = CATALOGUE_DIRECTORY): Catalogue {
  const read = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(directory, name), 'utf8')) as Record<string, unknown>;
  const slots = read('slots.json');
  const elements = read('elements.json');
  const theme = read('theme-tokens.json');
  const scripts = read('scripts.json');
  const catalogue: Catalogue = {
    appSlots: slots['appSlots'] as string[],
    reportedBecause: slots['reportedBecause'] as string,
    slots: slots['slots'] as Record<string, SlotEntry>,
    elements: elements['elements'] as Record<string, ElementEntry>,
    tokens: theme['tokens'] as Record<string, string>,
    reportedProperties: theme['reported'] as Record<string, string>,
    scripts: scripts['scripts'] as ScriptEntry[],
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
    // Held to the registry the validator reads, so that a widget the platform lacks fails here
    // rather than in every package converted with it.
    if (entry.role === 'field' && !('widget' in entry))
      problems.push(`elements.json: ${name} is a field, so it must say its widget, or null`);
    if (entry.role !== 'field' && 'widget' in entry)
      problems.push(`elements.json: ${name} is not a field, so it has no widget`);
    if (typeof entry.widget === 'string' && !Object.hasOwn(PACKAGED_WIDGETS, entry.widget))
      problems.push(
        `elements.json: ${name} becomes the widget "${entry.widget}", which is not registered`,
      );
    for (const parameter of Object.keys(entry.parameters ?? {})) {
      const widget =
        typeof entry.widget === 'string' ? own(PACKAGED_WIDGETS, entry.widget) : undefined;
      if (!widget || !Object.hasOwn(widget.parameters, parameter))
        problems.push(
          `elements.json: ${name} gives the parameter "${parameter}", which its widget does not take`,
        );
    }
  }
  const targeted = new Map<string, string>();
  for (const [property, token] of Object.entries(catalogue.tokens ?? {})) {
    if (!property.startsWith('--'))
      problems.push(`theme-tokens.json: ${property} is not a custom property`);
    if (!/^--mat-sys-[a-z-]+$/.test(token)) {
      problems.push(
        `theme-tokens.json: ${property} maps to "${token}", which is not a --mat-sys-* token`,
      );
    }
    if (Object.hasOwn(catalogue.reportedProperties ?? {}, property)) {
      problems.push(`theme-tokens.json: ${property} is both mapped and reported`);
    }
    // Two properties setting one token would leave the converted theme to whichever came last.
    const other = targeted.get(token);
    if (other) problems.push(`theme-tokens.json: ${other} and ${property} both set ${token}`);
    targeted.set(token, property);
  }
  for (const [key, reason] of Object.entries(catalogue.reportedProperties ?? {})) {
    if (!key.startsWith('--'))
      problems.push(`theme-tokens.json: reported "${key}" is not a custom property`);
    if (!reason) problems.push(`theme-tokens.json: reported "${key}" gives no reason`);
  }
  if (!Object.hasOwn(catalogue.reportedProperties ?? {}, '--')) {
    problems.push(
      'theme-tokens.json: "reported" needs a "--" entry, so that every property gets a reason',
    );
  }
  const shapes = new Set<string>();
  for (const script of catalogue.scripts ?? []) {
    if (!script.name) problems.push('scripts.json: a script has no name');
    if (!/^[0-9a-f]{64}$/.test(script.sha256 ?? '')) {
      problems.push(`scripts.json: ${script.name} has no SHA-256 of its shape`);
    }
    if (shapes.has(script.sha256))
      problems.push(`scripts.json: the shape of ${script.name} is listed twice`);
    shapes.add(script.sha256);
    if (!script.seen) problems.push(`scripts.json: ${script.name} does not say where it was seen`);
  }
  return problems;
}

export function slotEntry(catalogue: Catalogue, slot: string): SlotEntry | null {
  return own(catalogue.slots, slot) ?? null;
}

export function elementEntry(catalogue: Catalogue, element: string): ElementEntry | null {
  return own(catalogue.elements, element) ?? null;
}

export function scriptEntry(catalogue: Catalogue, shape: string): ScriptEntry | null {
  return catalogue.scripts.find((script) => script.sha256 === shape) ?? null;
}

/** The token a theme property sets, or the reason it sets none. */
export function mapThemeProperty(catalogue: Catalogue, property: string): TokenMapping {
  const token = own(catalogue.tokens, property);
  if (token) return { property, token };
  const reported = catalogue.reportedProperties;
  const exact = own(reported, property);
  if (exact) return { property, token: null, reason: exact };
  // The nearest family, and the catch-all `--` for anything no family claims, so that every
  // property comes back with a reason, even a name that is not a custom property at all.
  const family =
    Object.keys(reported)
      .filter((key) => key.endsWith('-') && property.startsWith(key))
      .sort((a, b) => b.length - a.length)[0] ?? '--';
  return { property, token: null, reason: reported[family] };
}
