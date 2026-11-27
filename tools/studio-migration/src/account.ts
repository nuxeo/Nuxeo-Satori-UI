/**
 * The inventory held against the catalogue: for each slot contribution, element, script and theme
 * property, what it becomes, or that the catalogue does not know it.
 *
 * `decisions` lists everything a person has to settle before a migration is ready
 * (docs/business-apps/studio-migration.md, section 6): what the catalogue does not know, what it
 * reports or leaves for an agent to propose, customer code, and the mistakes real projects carry.
 * Not knowing is never a pass.
 */
import {
  elementEntry,
  mapThemeProperty,
  scriptEntry,
  slotEntry,
  type Catalogue,
  type ElementEntry,
  type ScriptEntry,
  type SlotEntry,
  type TokenMapping,
} from './catalogue';
import { pluginLibraryOf } from './convert-elements';
import type { Inventory, InventoryFile, ScriptUse, SlotContribution } from './inventory';

export interface SlotOutcome {
  readonly contribution: SlotContribution;
  /** `null` when the catalogue does not know the slot. */
  readonly entry: SlotEntry | null;
}

export interface ElementOutcome {
  readonly element: string;
  readonly count: number;
  /** `null` when the catalogue does not know the element. */
  readonly entry: ElementEntry | null;
}

export interface ScriptOutcome {
  readonly script: ScriptUse;
  /** `null` for a script Studio does not generate: customer code. */
  readonly entry: ScriptEntry | null;
}

export interface ThemeOutcome {
  readonly theme: string;
  readonly mappings: readonly TokenMapping[];
}

export interface Accounting {
  readonly slots: readonly SlotOutcome[];
  readonly elements: readonly ElementOutcome[];
  readonly scripts: readonly ScriptOutcome[];
  readonly themes: readonly ThemeOutcome[];
  readonly unrecognisedFiles: readonly InventoryFile[];
  /** Everything a person has to settle, one line each. */
  readonly decisions: readonly string[];
}

export function account(inventory: Inventory, catalogue: Catalogue): Accounting {
  const slots = inventory.slotContributions.map((contribution) => ({
    contribution,
    entry: slotEntry(catalogue, contribution.slot),
  }));
  const elements = [...inventory.elements].map(([element, count]) => ({
    element,
    count,
    entry: elementEntry(catalogue, element),
  }));
  const scripts = inventory.scripts.map((script) => ({
    script,
    entry: scriptEntry(catalogue, script.shape),
  }));
  const themes = inventory.themes.map((theme) => ({
    theme: theme.name,
    mappings: theme.properties.map((property) => mapThemeProperty(catalogue, property.name)),
  }));
  const unrecognisedFiles = inventory.files.filter((file) => file.kind === 'unrecognised');

  const decisions = [
    ...slots.flatMap(({ contribution, entry }) => {
      const subject = `slot ${contribution.slot} (contribution "${contribution.name}")`;
      if (!entry) return [`${subject} is not in the catalogue`];
      if (entry.how === 'automatic') return [];
      return [`${subject} is ${describe(entry.how)}: ${entry.note ?? catalogue.reportedBecause}`];
    }),
    ...elements.flatMap(({ element, count, entry }) => {
      const subject = `element ${element} (used ${count === 1 ? 'once' : `${count} times`})`;
      // The package's own element, which the code track turns into a plugin, listed below.
      if (!entry && inventory.customElements.some((custom) => custom.name === element)) return [];
      if (!entry) return [`${subject} is not in the catalogue`];
      if (entry.how === 'automatic') return [];
      return [`${subject} is ${describe(entry.how)}: ${entry.note ?? entry.becomes}`];
    }),
    ...scripts
      .filter(({ entry }) => entry === null)
      .map(
        ({ script }) =>
          `script ${script.index + 1} in ${script.path} is not one Studio generates: review it as customer code`,
      ),
    ...inventory.customElements.map(
      (element) =>
        `custom element ${element.name} in ${element.path} is for an agent to write as a Layer 2 plugin, ${pluginLibraryOf(element)}, with the plugin command, and a person to accept`,
    ),
    ...inventory.customCode
      .filter((custom) => custom.hasOtherCode)
      .map(
        (custom) =>
          `${custom.path} holds customer code outside its custom elements, which is reported: a person rewrites it as a plugin, or leaves it behind`,
      ),
    ...themes.flatMap(({ theme, mappings }) => {
      const reported = mappings.filter((mapping) => mapping.token === null).length;
      return reported === 0
        ? []
        : [
            `theme ${theme}: ${reported} of its ${mappings.length} properties set no token and are reported`,
          ];
    }),
    ...unrecognisedFiles.map((file) => `file ${file.path} is of no known kind`),
    ...inventory.problems.map(
      (problem) => `file ${problem.path} could not be read: ${problem.message}`,
    ),
    // The mistakes real projects carry, which a migration reports rather than copies
    // (docs/business-apps/studio-migration.md, section 2).
    ...inventory.slotContributions.flatMap((contribution) =>
      contribution.operations
        .filter((operation) => operation === null)
        .map(
          () =>
            `slot ${contribution.slot} (contribution "${contribution.name}") has a nuxeo-operation-button that runs no operation`,
        ),
    ),
    ...(inventory.dashboard?.cards ?? []).flatMap((card, index) =>
      card.repeatOf === null
        ? []
        : [
            `dashboard card ${index + 1}${card.heading ? ` (${card.heading})` : ''} repeats card ${card.repeatOf + 1}, and is kept once`,
          ],
    ),
    ...inventory.layouts.flatMap((layout) =>
      repeatedBindings(
        layout.element,
        layout.fields.map((field) => field.binding),
      ),
    ),
  ];
  return { slots, elements, scripts, themes, unrecognisedFiles, decisions };
}

function describe(how: 'agent-proposes' | 'reported'): string {
  return how === 'reported' ? 'reported' : 'for an agent to propose';
}

function repeatedBindings(layout: string, bindings: readonly (string | null)[]): string[] {
  const counts = new Map<string, number>();
  for (const binding of bindings) if (binding) counts.set(binding, (counts.get(binding) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(
      ([binding, count]) => `layout ${layout} binds ${binding} ${count} times, and keeps it once`,
    );
}
