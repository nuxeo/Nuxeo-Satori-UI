/**
 * The inventory held against the catalogue: for each slot contribution, element and theme
 * property, what it becomes, or that the catalogue does not know it. Not knowing is never a pass:
 * it is a decision someone has to take, and it is listed as one.
 */
import {
  mapThemeProperty,
  type Catalogue,
  type ElementEntry,
  type SlotEntry,
  type TokenMapping,
} from './catalogue';
import type { Inventory, InventoryFile, SlotContribution } from './inventory';

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

export interface ThemeOutcome {
  readonly theme: string;
  readonly mappings: readonly TokenMapping[];
}

export interface Accounting {
  readonly slots: readonly SlotOutcome[];
  readonly elements: readonly ElementOutcome[];
  readonly themes: readonly ThemeOutcome[];
  readonly unrecognisedFiles: readonly InventoryFile[];
  /** Everything the catalogue cannot place, as decisions to take. */
  readonly decisions: readonly string[];
}

export function account(inventory: Inventory, catalogue: Catalogue): Accounting {
  const slots = inventory.slotContributions.map((contribution) => ({
    contribution,
    entry: catalogue.slots[contribution.slot] ?? null,
  }));
  const elements = [...inventory.elements].map(([element, count]) => ({
    element,
    count,
    entry: catalogue.elements[element] ?? null,
  }));
  const themes = inventory.themes.map((theme) => ({
    theme: theme.name,
    mappings: theme.properties.map((property) => mapThemeProperty(catalogue, property.name)),
  }));
  const unrecognisedFiles = inventory.files.filter((file) => file.kind === 'unrecognised');

  const decisions = [
    ...slots
      .filter((outcome) => outcome.entry === null)
      .map(
        ({ contribution }) =>
          `slot ${contribution.slot} (contribution "${contribution.name}") is not in the catalogue`,
      ),
    ...elements
      .filter((outcome) => outcome.entry === null)
      .map(
        (outcome) =>
          `element ${outcome.element} (used ${outcome.count} times) is not in the catalogue`,
      ),
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
        layout.fields.map((f) => f.binding),
      ),
    ),
  ];
  return { slots, elements, themes, unrecognisedFiles, decisions };
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
