/**
 * M2's tabs (docs/business-apps/studio-migration.md, section 3): a tab of Web UI's document page
 * becomes a tab of layout version 2 (layout-v2.md, section 2), in the view file of each type it
 * shows on.
 *
 * **What a Web UI tab is**, read from Web UI's own (`nuxeo-browser.js`, `nuxeo-page-item.js` and
 * `nuxeo-web-ui-bundle.html`): a `nuxeo-page-item` contributed to `DOCUMENT_VIEWS_ITEMS`, which
 * names it and gives its label as a translation key, and the page it opens, an element
 * contributed to `DOCUMENT_VIEWS_PAGES` with the same `name`. The document page shows the item
 * while its conditions pass, and the page while its own do. Web UI's own View tab is named `view`,
 * at order 10.
 *
 * **What it becomes.** A tab whose page is a layout block of the package becomes a tab of the
 * record page, holding one card of the block's fields, with the rule of the item's and the page's
 * conditions as its `visibleWhen`. A layout file is a type's own, so the tab goes into the view
 * file of each type its conditions name. The record page's own cards become its first tab, `view`,
 * on which it opens as Web UI's document page opens on View, and the tabs follow in Web UI's
 * order. The contributions are read as Web UI's slots register them (`nuxeo-slots.js`): a disabled
 * one shows nothing, and a later one of the same name replaces or changes an earlier one by its
 * priority. What cannot be worked out from the package is reported, never guessed: a tab with no
 * page, a page that is not a block, a condition that does not convert, a tab its conditions show
 * on every type, a tab on a type with no view file.
 *
 * Worked out from the inventory alone, so that the converter and harness checks 2, 5 and 6 read
 * the same answer.
 */
import { labelOf, placed, slug } from './app-files';
import { own } from './catalogue';
import type { ConvertContext, Decision } from './convert';
import { menuGuard, type Guard } from './guards';
import type { BlockUse, SlotContribution } from './inventory';
import { blockFieldId, blockOf, blockUseId } from './blocks';
import { slotRegistry } from './slot-registry';

/** A tab of the package that a type's view file holds. */
export interface TabPlan {
  readonly item: SlotContribution;
  /** The item's construct. */
  readonly itemId: string;
  readonly page: SlotContribution;
  readonly pageId: string;
  /** The name the item and the page share. */
  readonly name: string;
  /** Its id in a view file. */
  readonly id: string;
  /** Its label: Web UI translates the item's, so a key the package translates is a `labelKey`. */
  readonly label:
    { readonly label: string } | { readonly labelKey: string } | Record<string, never>;
  /** Its place among the tabs, as Web UI orders them: the item's `order`. */
  readonly order: number;
  /** The layout block its page is. */
  readonly use: BlockUse;
  /** The rule of the item's and the page's conditions, its `visibleWhen`. */
  readonly guard: Extract<Guard, { kind: 'rule' }>;
  /** The types it shows on: those every condition with a `type` test names. */
  readonly types: readonly string[];
}

/** The names of Web UI's own tabs, whose pages are Web UI's: `nuxeo-web-ui-bundle.html`. */
const WEB_UI_TABS = new Set(['view', 'permissions', 'history', 'publication', 'trash']);

const ITEMS = 'DOCUMENT_VIEWS_ITEMS';
const PAGES = 'DOCUMENT_VIEWS_PAGES';

/**
 * Every tab of the package that becomes one, and what each other contribution to Web UI's tabs,
 * an item or a page, and the block uses its page holds, are decided as.
 */
export function tabDecisions(context: Pick<ConvertContext, 'inventory'>): {
  readonly tabs: TabPlan[];
  readonly skipped: Map<string, Decision>;
} {
  const { inventory } = context;
  const tabs: TabPlan[] = [];
  const skipped = new Map<string, Decision>();
  const all = placed(inventory.slotContributions);
  const idOf = (contribution: SlotContribution): string => {
    const found = all.find((candidate) => candidate.contribution === contribution);
    return `slot-contribution:${contribution.path}#${found?.index ?? 0}`;
  };
  const registry = slotRegistry(inventory);
  // A contribution to several slots takes part in each one's registration, but is itself a slot
  // the catalogue does not know, reported as such: only one to the tab's own slot becomes a tab.
  const inOwnSlot = (slot: string) => {
    const { kept, dropped } = registry.inSlot(slot);
    return {
      kept: kept.filter((entry) => entry.contribution.slot === slot),
      dropped: dropped.filter(([contribution]) => contribution.slot === slot),
    };
  };
  const items = inOwnSlot(ITEMS);
  const pagesKept = inOwnSlot(PAGES);
  const pages = pagesKept.kept.map((entry) => entry.contribution);
  const paired = new Set<SlotContribution>();
  const translated = new Set(inventory.translations.flatMap((t) => t.keys));
  const skip = (contribution: SlotContribution, decision: Decision): void => {
    skipped.set(idOf(contribution), decision);
    // What its page holds goes nowhere either.
    for (const index of contribution.uses) {
      const use = inventory.blockUses.find(
        (candidate) => candidate.path === contribution.path && candidate.index === index,
      );
      if (!use) continue;
      const note = `Its tab is not converted: ${decision.note ?? ''}`;
      const outcome = decision.outcome === 'converted' ? 'reported' : decision.outcome;
      skipped.set(blockUseId(use), { outcome, note });
      blockOf(inventory, use)?.fields.forEach((_, field) =>
        skipped.set(blockFieldId(use, field), { outcome, note }),
      );
    }
  };
  const both = (item: SlotContribution, page: SlotContribution | undefined, decision: Decision) => {
    skip(item, decision);
    if (page) skip(page, decision);
  };

  // What Web UI's slots do not show, or show through another contribution, is no tab of its own.
  for (const [contribution, decision] of [...items.dropped, ...pagesKept.dropped])
    skip(contribution, decision);
  // In Web UI's order: an order left out is 0, and equals keep their places.
  for (const { contribution: item, order } of items.kept) {
    const pageItem = item.parts.find((part) => part.element === 'nuxeo-page-item');
    if (!pageItem) {
      skip(item, {
        outcome: 'reported',
        note: 'It holds no nuxeo-page-item, so it adds no tab: a person maps what it shows',
      });
      continue;
    }
    const name = own(pageItem.attributes, 'name')?.trim() ?? '';
    if (name === '') {
      skip(item, {
        outcome: 'reported',
        note: 'Its nuxeo-page-item has no name, so it opens no page',
      });
      continue;
    }
    const matching = pages.filter((page) => pageNameOf(page) === name);
    if (WEB_UI_TABS.has(name)) {
      const decision: Decision = {
        outcome: 'reported',
        note: `It is named ${name}, as Web UI's own ${name} tab is, whose page is Web UI's: the record page has its own`,
      };
      skip(item, decision);
      for (const page of matching) {
        paired.add(page);
        skip(page, decision);
      }
      continue;
    }
    if (matching.length === 0) {
      const hidden = pagesKept.dropped.find(([page]) => pageNameOf(page) === name);
      skip(item, {
        outcome: 'reported',
        note: hidden
          ? `Its page, named ${name}, is not shown in Web UI: ${hidden[1].note ?? ''}`
          : `No page the package contributes to ${PAGES} is named ${name}, so the tab opens nothing of the package's`,
      });
      continue;
    }
    for (const page of matching) paired.add(page);
    if (matching.length > 1) {
      const decision: Decision = {
        outcome: 'reported',
        note: `${matching.length} pages of the package are named ${name}, and which one shows on which document is a person's call`,
      };
      skip(item, decision);
      for (const page of matching) skip(page, decision);
      continue;
    }
    const [page] = matching;
    // Its conditions and its page's travel with it as its rule: the tab shows its page only while
    // both pass.
    const guard = menuGuard(inventory, item, page);
    if (guard.kind !== 'rule') {
      both(item, page, { outcome: guard.kind, note: guard.note });
      continue;
    }
    const use = page.uses
      .map((index) =>
        inventory.blockUses.find(
          (candidate) => candidate.path === page.path && candidate.index === index,
        ),
      )
      .find((candidate) => candidate && own(candidate.attributes, 'name')?.trim() === name);
    if (!use) {
      const element = page.parts.find((part) => own(part.attributes, 'name')?.trim() === name);
      both(item, page, {
        outcome: 'reported',
        note: `Its page, ${element?.element ?? 'the element named so'}, is no layout block of the package, so no card holds what it shows: a custom element of the package's own custom bundle has its plugin proposed with the element, for a person to place in a tab, and Web UI's own or another file's a person maps`,
      });
      continue;
    }
    if (!use.document) {
      both(item, page, {
        outcome: 'reported',
        note: `Its page, the layout block ${use.element}, is not given the page's document, as document="[[document]]", so it shows no field in Web UI: a mistake to fix, not to copy`,
      });
      continue;
    }
    const types = typesOf(guard);
    if (types === null) {
      both(item, page, {
        outcome: 'reported',
        note: "Its conditions test no type, so it shows on every type of document, and a tab of layout version 2 is a type's own: a person names the types it is for",
      });
      continue;
    }
    if (types.length === 0) {
      both(item, page, {
        outcome: 'reported',
        note: 'Its conditions name no type in common, so it shows on no document: a mistake to fix, not to copy',
      });
      continue;
    }
    const id = slug(name);
    const taken = tabs.find(
      (other) => other.id === id && other.types.some((type) => types.includes(type)),
    );
    if (taken) {
      both(item, page, {
        outcome: 'reported',
        note: `Another tab of the package, ${taken.name}, is already the tab ${id} of ${taken.types.join(', ')}`,
      });
      continue;
    }
    const label = own(pageItem.attributes, 'label');
    tabs.push({
      item,
      itemId: idOf(item),
      page,
      pageId: idOf(page),
      name,
      id,
      label:
        label !== undefined && translated.has(label.trim())
          ? { labelKey: label.trim() }
          : labelOf(label ?? null),
      order,
      use,
      guard,
      types,
    });
  }
  for (const page of pages) {
    if (paired.has(page)) continue;
    const name = pageNameOf(page);
    skip(page, {
      outcome: 'reported',
      note:
        name === 'view'
          ? "It is the page of Web UI's own View tab, for the documents its conditions pass, and the app draws the record page there: a person decides what it becomes"
          : `No tab of the package opens it${name ? `, by its name ${name}` : ': it names no page'}`,
    });
  }
  return { tabs, skipped };
}

/** The tabs of the package that become tabs of a type's view file. */
export function tabPlans(context: Pick<ConvertContext, 'inventory'>): TabPlan[] {
  return tabDecisions(context).tabs;
}

/** The name of the page a `DOCUMENT_VIEWS_PAGES` contribution holds: its named element's. */
function pageNameOf(page: SlotContribution): string | null {
  const named = page.parts
    .map((part) => own(part.attributes, 'name')?.trim())
    .filter((name): name is string => Boolean(name));
  return named.length === 1 ? named[0] : null;
}

/**
 * The types a tab shows on: those every `type` test among its conditions names; `null` when none
 * tests a type. A test of another kind leaves it to the tab's rule.
 */
function typesOf(guard: Extract<Guard, { kind: 'rule' }>): string[] | null {
  let types: string[] | null = null;
  for (const condition of guard.conditions) {
    if (condition.element !== 'nuxeo-filter') continue;
    const value = own(condition.attributes, 'type');
    if (value === undefined || value.trim() === '') continue;
    const named = value
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean);
    types = types === null ? named : types.filter((type) => named.includes(type));
  }
  return types;
}
