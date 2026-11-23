/**
 * The conversion of document layouts (docs/business-apps/studio-migration.md, section 3): each Web
 * UI layout becomes the layout file of its type and mode. M1 wrote their fields; M2 adds the
 * layout blocks they use, as cards, and the tabs of a type's page.
 *
 * - **`view`** is written in layout version 2, the record page's main area. When the package's
 *   tabs show on the type, its cards become the first tab, `view`, as Web UI's View tab is, and
 *   each tab follows in Web UI's order (`convert-tabs.ts`).
 * - **`metadata`, `edit` and `create`** are written in version 1. Version 1 cannot name a widget:
 *   the schema type picks it.
 * - **`import`** has no place: the app's import step reads no layout.
 *
 * **Layout blocks.** A block a layout uses shows its fields where it sits, so its fields become a
 * card of their own there, in version 1 a section, between the cards of the layout's own fields
 * before and after it. A field is written once in a card or a tab, with its label and, in a form,
 * its required flag, whether it is the layout's or a block's. What cannot be written as Web UI
 * shows it is reported, with why, and never copied as if it could.
 *
 * The same planning writes task forms (`convert-tasks.ts`) and the cards of tabs, and harness
 * checks 2 and 5 read it to know which card is which.
 */
import type { ConvertContext, Decision } from './convert';
import type { BlockUse, DocumentLayout, LayoutField } from './inventory';
import {
  blockFieldId,
  blockOf,
  blockUseId,
  layoutCards,
  type LayoutSource,
  type PlacedField,
  type PlannedCard,
} from './blocks';
export { blockFieldId, blockOf, blockUseId, layoutCards } from './blocks';
export type { LayoutSource, PlacedField, PlannedCard } from './blocks';
import { LAYOUT_VERSION, labelOf, layoutPath } from './app-files';
import { carry, guardOfSet, type Guard } from './guards';
import { ALWAYS, VERSION_ONE_WIDGETS, displaysOnly, fieldWidget } from './widgets';
import { tabDecisions, type TabPlan } from './convert-tabs';

/** The document types a layout path may name: as the configuration service accepts them. */
export const TYPE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

/**
 * The rows the Properties panel always shows above a metadata layout (extension-reference.md,
 * section 9b). A metadata file that listed them would show them twice.
 */
export const PANEL_ROWS: ReadonlySet<string> = new Set([
  'dc:title',
  'dc:description',
  'dc:nature',
  'dc:subjects',
  'dc:coverage',
]);

/** How one field of a layout is decided, before anything is written. */
export type FieldPlan =
  | {
      readonly kind: 'write';
      readonly entry: unknown;
      readonly binding: string;
      /** The widget the file names; `null` when the schema type picks it. */
      readonly widget: string | null;
      readonly required: boolean;
      /** Set when it is written but cannot show as Web UI does: it is then reported, with this. */
      readonly reported?: string;
      /** The conditions it is written under, whose rule is its `visibleWhen`. */
      readonly guard?: Guard;
    }
  | { readonly kind: 'panel'; readonly binding: string }
  | { readonly kind: 'preview' }
  | {
      readonly kind: 'skip';
      readonly outcome: 'reported' | 'pending' | 'proposed';
      readonly note: string;
    };

/** How a card that is a block use is decided: written, with the rule of its conditions, or not. */
export type CardPlan =
  | { readonly kind: 'write'; readonly guard?: Guard }
  | {
      readonly kind: 'skip';
      readonly outcome: 'reported' | 'pending' | 'proposed';
      readonly note: string;
    };

/** What a layout is planned for: the version it is written in, and whether it is a form. */
export interface PlanOptions {
  readonly mode: string;
  readonly version: 1 | 2;
  /** True for an edit, create or task form, which keeps required flags. */
  readonly form: boolean;
  /** True for a task layout: a field binds a variable of the task, and a block has no place. */
  readonly task?: boolean;
  /**
   * True for a tab's page: the conditions around its block are the tab's, carried as the tab's
   * `visibleWhen`, not again as its card's.
   */
  readonly inTab?: boolean;
}

/** The options a document layout of `mode` is planned with. */
export function layoutOptions(mode: string): PlanOptions {
  return {
    mode,
    version: LAYOUT_VERSION[mode],
    form: mode === 'edit' || mode === 'create',
  };
}

/**
 * What to do with each card and each field of a layout, in order. Shared with harness check 2,
 * which expects the fields planned for writing, and only those, in the converted file.
 */
export function planFields(
  context: Pick<ConvertContext, 'catalogue' | 'inventory'>,
  source: LayoutSource,
  options: PlanOptions,
): {
  readonly cards: PlannedCard[];
  readonly placed: PlacedField[];
  readonly cardPlans: CardPlan[];
  readonly plans: FieldPlan[];
} {
  const { inventory, catalogue } = context;
  const { cards, fields: placed } = layoutCards(inventory, source);
  const { mode, version } = options;
  const cardPlans = cards.map((card) => planCard(context, card, options));
  const cardConditional = (field: PlacedField): boolean =>
    (cards[field.card].use?.conditions.length ?? 0) > 0 && !options.inTab;
  const seen = new Set<string>();
  // The properties a field in no condition, of an element the catalogue knows, shows to everyone.
  const always = new Set(
    placed
      .filter(
        (field) =>
          field.field.conditions.length === 0 &&
          !cardConditional(field) &&
          cardPlans[field.card].kind === 'write' &&
          field.field.binding !== null &&
          fieldWidget(catalogue, field.field.element, field.field.attributes) !== null,
      )
      .map((field) => field.field.binding as string),
  );
  const plans = placed.map((placedField): FieldPlan => {
    const field = placedField.field;
    const card = cardPlans[placedField.card];
    if (card.kind === 'skip') {
      const use = cards[placedField.card].use;
      return {
        kind: 'skip',
        outcome: card.outcome,
        note: `Its layout block${use ? `, ${use.element},` : ''} is not written here: ${card.note}`,
      };
    }
    if (field.element === 'nuxeo-document-viewer') return { kind: 'preview' };
    const binding = field.binding;
    if (binding === null || !binding.includes(':'))
      return {
        kind: 'skip',
        outcome: 'reported',
        note: options.task
          ? 'It binds no variable of the task'
          : 'It binds no property of the document',
      };
    if (options.task && !binding.startsWith('var:'))
      return {
        kind: 'skip',
        outcome: 'reported',
        note: `It binds the document's ${binding}, and Web UI gives a task layout the task's first target by its id alone (nuxeo-document-task, targetDocumentIds[0]), so it shows nothing there; the app's task form would show the record's value: a person decides`,
      };
    // A property counts as shown once a field shows it, not when a field merely names it: a
    // field under a condition, or of an element the catalogue does not know, leaves the next
    // field binding the same property to show it.
    if (seen.has(binding))
      return {
        kind: 'skip',
        outcome: 'reported',
        note: `It binds ${binding} again, and is kept once`,
      };
    let guard: Guard | null = null;
    const conditional = field.condition !== null || cardConditional(placedField);
    if (conditional) {
      if (field.placesUnclear)
        return {
          kind: 'skip',
          outcome: 'reported',
          note:
            field.placesUnclear.reason === 'outside'
              ? `It names ${binding} inside condition ${field.placesUnclear.at + 1} of its file and outside it too, and whether the place outside shows it to everyone or only reads it is a person's call`
              : `It holds condition ${field.placesUnclear.at + 1} of its file, whose content may show ${binding} by other means than naming it, as a widget's xpath does, so whether everyone sees it is a person's call`,
        };
      // Web UI shows the property to everyone through another field: that one is kept.
      if (always.has(binding))
        return {
          kind: 'skip',
          outcome: 'reported',
          note: `It shows ${binding} only while a condition passes, and another field of the layout shows it to everyone: that one is kept`,
        };
      if (version === 1)
        return {
          kind: 'skip',
          outcome: 'pending',
          note:
            field.condition !== null
              ? `It shows only while condition ${field.condition + 1} of its file passes, and version 1 has no rules: it waits for the app to draw version 2 in ${mode} mode`
              : `Its layout block sits in a condition, and version 1 has no rules: it waits for the app to draw version 2 in ${mode} mode`,
        };
    }
    if (field.condition !== null) {
      // Every condition it sits in or holds: a wrapper's own, and any around its binding.
      guard = guardOfSet(inventory, placedField.conditionsIn, field.conditions);
      if (guard.kind !== 'rule') return { kind: 'skip', outcome: guard.kind, note: guard.note };
    }
    const choice = fieldWidget(catalogue, field.element, field.attributes);
    if (choice === null)
      return {
        kind: 'skip',
        outcome: 'reported',
        note: `${field.element} is not a field element the catalogue knows`,
      };
    seen.add(binding);
    if (mode === 'metadata' && PANEL_ROWS.has(binding)) return { kind: 'panel', binding };
    const required = options.form && field.required;
    const written =
      version === 2
        ? versionTwoField(field, choice, required, options.form && displaysOnly(field.element))
        : formField(field, required);
    const entry =
      guard?.kind === 'rule'
        ? {
            ...(typeof written === 'string' ? { field: written } : (written as object)),
            visibleWhen: guard.rule,
          }
        : written;
    // Written all the same, so that its value stays in the panel or the form, shown as its type
    // picks; reported, because that is not how Web UI shows it.
    const reported =
      version === 1 && choice.widget !== null && !VERSION_ONE_WIDGETS.has(choice.widget)
        ? `Written to show as its schema type picks: version 1 cannot name the ${choice.widget} widget, and the converter writes version 1 in ${mode} mode (layout-v2.md, section 10)`
        : undefined;
    return {
      kind: 'write',
      entry,
      binding,
      widget: version === 2 ? choice.widget : null,
      required,
      ...(reported ? { reported } : {}),
      ...(guard?.kind === 'rule' ? { guard } : {}),
    };
  });
  return { cards, placed, cardPlans, plans };
}

/** Whether a card is written: a run of the layout's own fields always is; a block, as it can be. */
function planCard(
  context: Pick<ConvertContext, 'inventory'>,
  card: PlannedCard,
  options: PlanOptions,
): CardPlan {
  const use = card.use;
  if (use === null) return { kind: 'write' };
  if (options.task)
    return {
      kind: 'skip',
      outcome: 'reported',
      note: "a block shows the document's properties, and Web UI gives a task layout the task's first target by its id alone (nuxeo-document-task, targetDocumentIds[0]), so its fields show nothing there: a person decides what the form shows",
    };
  if (!use.document)
    return {
      kind: 'skip',
      outcome: 'reported',
      note: 'it is not given the page\'s document, as document="[[document]]", so its fields show nothing in Web UI: a mistake to fix, not to copy',
    };
  if (use.conditions.length === 0 || options.inTab) return { kind: 'write' };
  if (options.version === 1)
    return {
      kind: 'skip',
      outcome: 'pending',
      note: `it shows only while condition ${use.conditions[0] + 1} of its file passes, and version 1 has no rules: it waits for the app to draw version 2 in ${options.mode} mode`,
    };
  const guard = guardOfSet(context.inventory, use.path, use.conditions);
  if (guard.kind !== 'rule') return { kind: 'skip', outcome: guard.kind, note: guard.note };
  return guard.rule === 'core.true' ? { kind: 'write' } : { kind: 'write', guard };
}

function versionTwoField(
  field: LayoutField,
  choice: ReturnType<typeof fieldWidget> & object,
  required: boolean,
  readOnly: boolean,
): unknown {
  const label = labelOf(field.label);
  if (choice.widget === null && Object.keys(label).length === 0 && !required && !readOnly)
    return field.binding;
  return {
    field: field.binding,
    ...label,
    ...(choice.widget !== null ? { widget: choice.widget } : {}),
    ...(choice.parameters ? { parameters: choice.parameters } : {}),
    ...(required ? { required: true } : {}),
    // Web UI's element only shows the value: the form shows it read-only, and sends none.
    ...(readOnly ? { readOnlyWhen: ALWAYS } : {}),
  };
}

function formField(field: LayoutField, required: boolean): unknown {
  const label = labelOf(field.label);
  if (!required && Object.keys(label).length === 0) return field.binding;
  return { field: field.binding, ...label, ...(required ? { required: true } : {}) };
}

/** A planned layout, written: its cards, and what each of its constructs became. */
export interface WrittenCards {
  /** The cards with a field written, as the file lists them: cards, or version 1's sections. */
  readonly cards: Record<string, unknown>[];
  /** Each card written, by its planned card's place. */
  readonly written: ReadonlyMap<number, string>;
}

/**
 * Writes a planned layout's cards for the file at `path`, under `at` (`cards`, `sections` or
 * `tabs.<n>.cards`), and decides each of its fields and block uses.
 */
export function writeCards(
  context: ConvertContext,
  path: string,
  at: string,
  planned: ReturnType<typeof planFields>,
): WrittenCards {
  const { cards, placed, cardPlans, plans } = planned;
  const byCard = new Map<number, unknown[]>();
  plans.forEach((plan, index) => {
    const field = placed[index];
    const id = field.id;
    if (plan.kind === 'preview') {
      context.decide(id, {
        outcome: 'converted',
        to: "the app's own preview of the record's file: not a field (layout-v2.md, section 10)",
      });
    } else if (plan.kind === 'panel') {
      context.decide(id, {
        outcome: 'converted',
        to: `the Properties panel's own row for ${plan.binding}, which the panel always shows`,
      });
    } else if (plan.kind === 'write') {
      byCard.set(field.card, [...(byCard.get(field.card) ?? []), plan.entry]);
      if (plan.guard) carry(context.carried, plan.guard, `${path} ${plan.binding}`);
      decideAt(
        context,
        id,
        plan.reported
          ? { outcome: 'reported', to: path, note: plan.reported }
          : { outcome: 'converted', to: path },
      );
    } else {
      context.decide(id, { outcome: plan.outcome, note: plan.note });
    }
  });
  const written = new Map<number, string>();
  const list: Record<string, unknown>[] = [];
  cards.forEach((card, index) => {
    const fields = byCard.get(index) ?? [];
    const plan = cardPlans[index];
    if (fields.length > 0 && plan.kind === 'write') {
      list.push({
        id: card.id,
        ...(plan.guard?.kind === 'rule' && plan.guard.rule !== 'core.true'
          ? { visibleWhen: plan.guard.rule }
          : {}),
        fields,
      });
      written.set(index, card.id);
      if (plan.guard) carry(context.carried, plan.guard, `${path} ${at}.${card.id}`);
    }
    if (card.use === null) return;
    decideAt(
      context,
      blockUseId(card.use),
      useDecision(card, plan, written.has(index), path, at, plans, placed, index),
    );
  });
  return { cards: list, written };
}

/**
 * Decides a construct that may be written in more than one file, as a tab's block is in each type
 * it shows on: a place it is written in joins those it was already written in.
 */
function decideAt(context: ConvertContext, id: string, decision: Decision): void {
  const before = context.decision(id);
  if (before?.to && decision.to && before.outcome === decision.outcome) {
    const places = [...new Set([...before.to.split(', '), decision.to])];
    context.decide(id, { ...decision, to: places.join(', ') });
    return;
  }
  context.decide(id, decision);
}

/** What a block use became: its card, or why it has none. */
function useDecision(
  card: PlannedCard,
  plan: CardPlan,
  written: boolean,
  path: string,
  at: string,
  plans: readonly FieldPlan[],
  placed: readonly PlacedField[],
  index: number,
): Decision {
  if (written) return { outcome: 'converted', to: `${path} ${at}.${card.id}` };
  if (plan.kind === 'skip') return { outcome: plan.outcome, note: plan.note };
  const outcomes = plans
    .filter((_, position) => placed[position].card === index)
    .map((fieldPlan) => (fieldPlan.kind === 'skip' ? fieldPlan.outcome : 'reported'));
  const outcome = outcomes.includes('pending')
    ? 'pending'
    : outcomes.includes('proposed')
      ? 'proposed'
      : 'reported';
  return {
    outcome,
    note:
      outcomes.length === 0
        ? 'The block holds no field, so its card would be empty'
        : 'None of its fields is written here, and each says why',
  };
}

/**
 * The first layout of each type and mode, which is the one written: a later one is reported.
 * Shared with the checks, which hold only that one to the file.
 */
export function writtenLayouts(
  inventory: ConvertContext['inventory'],
): Map<string, DocumentLayout> {
  const first = new Map<string, DocumentLayout>();
  for (const layout of inventory.layouts) {
    const type = layout.docType;
    if (type === null || !TYPE_NAME.test(type) || !Object.hasOwn(LAYOUT_VERSION, layout.mode))
      continue;
    const path = layoutPath(type, layout.mode);
    if (!first.has(path)) first.set(path, layout);
  }
  return first;
}

export function convertLayouts(context: ConvertContext): void {
  const written = writtenLayouts(context.inventory);
  const { tabs, skipped } = tabDecisions(context);
  for (const [id, decision] of skipped) context.decide(id, decision);
  const tabsDone = new Set<TabPlan>();
  for (const layout of context.inventory.layouts) {
    const layoutId = `layout:${layout.path}#layout`;
    const uses = context.inventory.blockUses.filter((use) => use.path === layout.path);
    const reportAll = (note: string, fieldNote: string): void => {
      context.decide(layoutId, { outcome: 'reported', note });
      const { fields } = layoutCards(context.inventory, layoutSource(layout));
      for (const field of fields)
        context.decide(field.id, { outcome: 'reported', note: fieldNote });
      for (const use of uses)
        context.decide(blockUseId(use), { outcome: 'reported', note: fieldNote });
    };
    const type = layout.docType;
    if (type === null || !TYPE_NAME.test(type)) {
      reportAll(
        'It names no document type, through a @doctype annotation, that a layout file can be named after',
        'Its layout names no document type',
      );
      continue;
    }
    if (!Object.hasOwn(LAYOUT_VERSION, layout.mode)) {
      reportAll(
        layout.mode === 'import'
          ? 'The app has no import form: its import step reads no layout (extension-reference.md, section 9b).'
          : `The app has no ${layout.mode || 'unnamed'} mode`,
        `Its layout, in ${layout.mode || 'no'} mode, is reported`,
      );
      continue;
    }
    const path = layoutPath(type, layout.mode);
    if (written.get(path) !== layout) {
      reportAll(
        `Another layout of ${type} in ${layout.mode} mode comes first`,
        'Its layout is reported',
      );
      continue;
    }

    const options = layoutOptions(layout.mode);
    const typeTabs = layout.mode === 'view' ? tabs.filter((tab) => tab.types.includes(type)) : [];
    const at =
      options.version === 1 ? 'sections' : typeTabs.length > 0 ? 'tabs.view.cards' : 'cards';
    const { cards } = writeCards(
      context,
      path,
      at,
      planFields(context, layoutSource(layout), options),
    );

    if (options.version === 2) {
      if (cards.length === 0) {
        // A record page with nothing on it would show less than the document page does.
        context.decide(layoutId, {
          outcome: 'converted',
          to: "no file: the app's document page, which shows the record's preview, as this layout does",
        });
        continue;
      }
      if (typeTabs.length === 0) {
        context.files[path] = { version: 2, cards };
      } else {
        // Web UI's own View tab comes at order 10, and a tab of the same order after it.
        const ordered = [
          { order: WEB_UI_VIEW_ORDER, tab: { id: 'view', cards } as Record<string, unknown> },
          ...typeTabs.map((tab) => {
            tabsDone.add(tab);
            return { order: tab.order, tab: writeTab(context, path, tab) };
          }),
        ].sort((a, b) => a.order - b.order);
        context.files[path] = { version: 2, tabs: ordered.map((entry) => entry.tab) };
      }
    } else {
      // An empty list of sections shows nothing beyond what the panel or form always shows, as a
      // Web UI layout that lists only those does. No file would show every schema of the type.
      context.files[path] = { version: 1, sections: cards };
    }
    context.decide(layoutId, { outcome: 'converted', to: path });
  }
  decideTabs(context, tabs, tabsDone);
}

/** The order of Web UI's own View tab, `documentViewItem` in `nuxeo-web-ui-bundle.html`. */
export const WEB_UI_VIEW_ORDER = 10;

/** A document layout as the planning reads it. */
export function layoutSource(layout: DocumentLayout): LayoutSource {
  return { path: layout.path, fields: layout.fields, fieldKind: 'layout-field' };
}

/** The planning of a tab's page: the one block its page is, with no field of its own. */
export function tabSource(tab: TabPlan): LayoutSource | null {
  return tab.use
    ? {
        path: tab.use.path,
        fields: [],
        fieldKind: 'layout-field',
        uses: [tab.use],
        cardPrefix: `${tab.id}.`,
      }
    : null;
}

export const TAB_OPTIONS: PlanOptions = { mode: 'view', version: 2, form: false, inTab: true };

/** Writes one tab into the view file at `path`: its card is its page's block. */
function writeTab(context: ConvertContext, path: string, tab: TabPlan): Record<string, unknown> {
  const source = tabSource(tab) as LayoutSource;
  const { cards } = writeCards(
    context,
    path,
    `tabs.${tab.id}.cards`,
    planFields(context, source, TAB_OPTIONS),
  );
  if (tab.guard.kind === 'rule') carry(context.carried, tab.guard, `${path} tabs.${tab.id}`);
  return {
    id: tab.id,
    ...tab.label,
    ...(tab.guard.kind === 'rule' && tab.guard.rule !== 'core.true'
      ? { visibleWhen: tab.guard.rule }
      : {}),
    cards,
  };
}

/** What each tab's two contributions became: the tab, in the view files it went to, or why not. */
function decideTabs(
  context: ConvertContext,
  tabs: readonly TabPlan[],
  done: ReadonlySet<TabPlan>,
): void {
  for (const tab of tabs) {
    const files = done.has(tab)
      ? tab.types
          .map((type) => layoutPath(type, 'view'))
          .filter((path) => Object.hasOwn(context.files, path))
      : [];
    const missing = tab.types.filter(
      (type) => !Object.hasOwn(context.files, layoutPath(type, 'view')),
    );
    const decision: Decision =
      files.length > 0
        ? {
            outcome: 'converted',
            to: files.map((path) => `${path} tabs.${tab.id}`).join(', '),
            ...(missing.length > 0
              ? {
                  note: `Not on ${missing.join(', ')}: the package writes no view layout of ${missing.length === 1 ? 'that type' : 'those types'}, whose record page would hold it`,
                }
              : {}),
          }
        : {
            outcome: 'reported',
            note: `It shows on ${tab.types.join(', ')}, and the package writes no view layout of ${tab.types.length === 1 ? 'that type' : 'those types'}: the record page that would hold the tab is not drawn, and Web UI's document page is the app's own`,
          };
    context.decide(tab.itemId, decision);
    if (tab.pageId) context.decide(tab.pageId, decision);
    if (files.length === 0 && tab.use) {
      // Its page's block, and the block's fields, go nowhere either.
      context.decide(blockUseId(tab.use), { outcome: 'reported', note: decision.note ?? '' });
      blockOf(context.inventory, tab.use)?.fields.forEach((_, index) =>
        context.decide(blockFieldId(tab.use as BlockUse, index), {
          outcome: 'reported',
          note: 'Its tab is reported',
        }),
      );
    }
  }
}
