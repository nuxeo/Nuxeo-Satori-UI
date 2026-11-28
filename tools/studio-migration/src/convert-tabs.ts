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
import { columnPlans, type ColumnPlan } from './convert-lists';
import { guardOfSet, menuGuard, type Guard } from './guards';
import { packageModel, schemasOfType, type PackageModel } from './model';
import type { BlockUse, Inventory, PageListing, ResultColumn, SlotContribution } from './inventory';
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
  /** The layout block its page is; `null` for a page that is a list. */
  readonly use: BlockUse | null;
  /** The list its page is, as a card of related records; `null` for a page that is a block. */
  readonly listing: ListingPlan | null;
  /** The rule of the item's and the page's conditions, its `visibleWhen`. */
  readonly guard: Extract<Guard, { kind: 'rule' }>;
  /** The types it shows on: those every condition with a `type` test names. */
  readonly types: readonly string[];
}

/**
 * A tab's page that is a list, as its tab's one card of related records (layout-v2.md, section 7):
 * over the same page provider, asked as Web UI's page asks it, the open record among its parameters
 * where the page passes it. Checks 2, 5, 6 and 7 hold the card to it.
 */
export interface ListingPlan {
  /** The card's id in the view file, after its tab's: `<tab>.records`. */
  readonly cardId: string;
  /** The card as written. */
  readonly card: Record<string, unknown>;
  readonly provider: string;
  /** Its parameters, in order: literals, or properties of the open record, `{ "field" }`. */
  readonly parameters: readonly unknown[];
  readonly sort: readonly { readonly field: string; readonly order: 'asc' | 'desc' }[];
  /** The page size Web UI asks for, when a list takes it; `null` for the list's own. */
  readonly pageSize: number | null;
  /** Web UI's columns, in its file, and how each is written. */
  readonly source: string;
  readonly columns: readonly ResultColumn[];
  readonly plans: readonly ColumnPlan[];
  /**
   * The rule of the conditions inside the page around its page provider and its table, beyond the
   * page's own: the card's `visibleWhen`. Absent for none.
   */
  readonly guard?: Extract<Guard, { kind: 'rule' }>;
  /**
   * What of Web UI's list the card does not show, each with why: its tab is then reported, or, when
   * each waits on a proposal, proposed with it.
   */
  readonly left: readonly { readonly text: string; readonly proposed: boolean }[];
}

/** The largest page a list of related records may ask for, and so the largest it keeps. */
const RELATED_PAGE_LIMIT = 100;

/**
 * What a list's `nuxeo-page-provider` may be given, as read: its id, which its table names; what
 * the card asks the same way, its provider, parameters, page size and sort; and what changes how
 * each record is read, not which records are listed, its schemas and enrichers. Anything else, a
 * query, quick filters, aggregations or headers, may list other records, and is refused.
 */
const PROVIDER_ATTRIBUTES: ReadonlySet<string> = new Set([
  'id',
  'provider',
  'params',
  'page-size',
  'sort',
  'schemas',
  'enrichers',
]);

/**
 * The open record's own fields a page binds a parameter to, `[[document.<name>]]`, as the property
 * a list of related records reads in their place (layout-v2.md, section 11): `ecm:uuid`,
 * `ecm:path`, `ecm:primaryType` and `ecm:currentLifeCycleState`.
 */
const RECORD_FIELDS: Readonly<Record<string, string>> = {
  uid: 'ecm:uuid',
  path: 'ecm:path',
  type: 'ecm:primaryType',
  state: 'ecm:currentLifeCycleState',
};

/**
 * A query parameter bound whole to the open record, `[[document.uid]]` or
 * `{{document.properties.cl:number}}`, with nothing around it: what it names, or `null`.
 */
const RECORD_BINDING =
  /^(?:\[\[|\{\{)\s*document\.(uid|path|type|state|properties\.([A-Za-z_][\w-]*:[A-Za-z_][\w-]*))\s*(?:\]\]|\}\})$/;

/**
 * What a list's `params` asks its page provider for, as a list of related records' parameters, or
 * why it cannot. Web UI writes `{"queryParams": "…"}`, or a list for several, as a dashboard card
 * does (`cardParameters`); a value is a literal, or the open record, bound whole: its id, path,
 * type or state, or one of its properties. Anything else bound to the page, a named parameter, or
 * a value that is not text could ask for other records than Web UI's page does, and is refused.
 */
export function listingParameters(
  params: string | null,
): { readonly parameters: unknown[] } | { readonly problem: string } {
  if (params === null || params.trim() === '') return { parameters: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(params);
  } catch {
    return { problem: `its page provider's params, ${params}, are not JSON` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return { problem: `its page provider's params, ${params}, are not an object` };
  const named = Object.keys(parsed).filter((key) => key !== 'queryParams');
  if (named.length > 0)
    return {
      problem: `its page provider takes named parameters (${named.join(', ')}), and a list of related records gives only positional ones`,
    };
  const query = (parsed as Record<string, unknown>)['queryParams'];
  const list = query === undefined ? [] : Array.isArray(query) ? query : [query];
  const parameters: unknown[] = [];
  for (const value of list) {
    if (typeof value !== 'string')
      return { problem: `its query parameter ${JSON.stringify(value)} is not text` };
    const bound = RECORD_BINDING.exec(value);
    // Polymer reads a binding in the attribute as written: one that only JSON's escapes make is
    // no binding, and Web UI sends its text.
    if (bound && !params.includes(value))
      return {
        problem: `its query parameter ${value} reads as a binding only once its JSON escapes are read, so Polymer binds nothing there, and Web UI sends the text`,
      };
    if (bound) {
      parameters.push({ field: bound[2] ?? RECORD_FIELDS[bound[1]] });
      continue;
    }
    if (/\[\[|\{\{/.test(value))
      return {
        problem: `its query parameter ${value} is bound to the page in a way a list of related records cannot send: only a literal, or the open record's id, path, type, state or one of its properties, bound whole`,
      };
    parameters.push(value);
  }
  return { parameters };
}

/** The order a list's `sort` opens it in, `{"dc:modified": "desc"}`, or why it cannot be read. */
export function listingSort(
  sort: string | null,
):
  | { readonly sort: { readonly field: string; readonly order: 'asc' | 'desc' }[] }
  | { readonly problem: string } {
  if (sort === null || sort.trim() === '') return { sort: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(sort);
  } catch {
    return {
      problem: `its page provider's sort, ${sort}, is not JSON, so its order cannot be read`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return { problem: `its page provider's sort, ${sort}, is not an object` };
  const entries: { field: string; order: 'asc' | 'desc' }[] = [];
  for (const [field, order] of Object.entries(parsed)) {
    const direction = typeof order === 'string' ? order.trim().toLowerCase() : '';
    if (
      !/^[A-Za-z_][\w-]*:[A-Za-z_][\w-]*$/.test(field) ||
      (direction !== 'asc' && direction !== 'desc')
    )
      return {
        problem: `its page provider's sort, ${sort}, is not properties each "asc" or "desc"`,
      };
    entries.push({ field, order: direction });
  }
  return { sort: entries };
}

/**
 * The card of related records a tab's page that is a list becomes, or why it becomes none. What
 * the card cannot show as Web UI's page does, a grid view, a column, a page size, is in `left`.
 */
export function listingPlan(
  inventory: Inventory,
  page: SlotContribution,
  listing: PageListing,
  tabId: string,
):
  | { readonly plan: ListingPlan }
  | { readonly outcome: 'reported' | 'proposed'; readonly problem: string } {
  const problem = (text: string) => ({ outcome: 'reported' as const, problem: text });
  if (listing.opaque)
    return problem(
      `Its page is ${listing.element}, an element of its own whose content the package does not show, holding a list: a person maps the page`,
    );
  if (listing.others.length > 0)
    return problem(
      `Its page holds ${listing.others.join(', ')} besides its list, which a card of related records has no place for: a person maps the page`,
    );
  if (listing.providers.length !== 1)
    return problem(
      listing.providers.length === 0
        ? 'Its page holds a table and no page provider, so what it lists cannot be read from the package'
        : `Its page holds ${listing.providers.length} page providers, and which one its table lists is a person's call`,
    );
  if (listing.tables.length !== 1)
    return problem(
      listing.tables.length === 0
        ? `Its list is shown as ${listing.views.join(' and ')}, and a card of related records is a table (layout-v2.md, section 7)`
        : `Its page holds ${listing.tables.length} tables of one page provider, and a card of related records is one`,
    );
  const [provider] = listing.providers;
  if (provider.provider === null) return problem('Its nuxeo-page-provider names no provider');
  // The table lists its page provider's records only when it names that provider, by its id.
  const [table] = listing.tables;
  const source = /^(?:(?:\[\[|\{\{)\s*\$\.\s*([\w-]+)\s*(?:\]\]|\}\})|([\w-]+))$/.exec(
    table.provider?.trim() ?? '',
  );
  if (table.items || provider.id === null || (source?.[1] ?? source?.[2]) !== provider.id)
    return problem(
      `Its table does not name its page provider${provider.id ? `, ${provider.id},` : ''} as the one it lists, by nx-provider${table.items ? ', and is given items of its own' : ''}: what it lists cannot be told from the package`,
    );
  // What else the page provider is given may change which records it lists.
  const asks = provider.attributes.filter((name) => !PROVIDER_ATTRIBUTES.has(name));
  if (asks.length > 0)
    return problem(
      `Its page provider is given ${asks.join(', ')}, which a card of related records does not send, so it could list other records than Web UI's page: a person checks it`,
    );
  const parameters = listingParameters(provider.params);
  if ('problem' in parameters)
    return problem(`Its list cannot be a card of related records: ${parameters.problem}`);
  const sorted = listingSort(provider.sort);
  if ('problem' in sorted)
    return problem(`Its list cannot be a card of related records: ${sorted.problem}`);
  const left: { text: string; proposed: boolean }[] = listing.views
    .filter((view) => view !== 'nuxeo-data-table')
    .map((view) => ({
      text: `its ${view} view: a card of related records is a table`,
      proposed: false,
    }));
  const size = provider.pageSize?.trim() ?? null;
  const pageSize =
    size !== null && /^\d+$/.test(size) && Number(size) >= 1 && Number(size) <= RELATED_PAGE_LIMIT
      ? Number(size)
      : null;
  if (size !== null && pageSize === null)
    left.push({
      text: `its page size, ${size}, is not one a list of related records takes (1 to ${RELATED_PAGE_LIMIT}), so the card asks for its own`,
      proposed: false,
    });
  const plans = columnPlans(inventory, page.path, listing.columns, true);
  plans.forEach((plan, index) => {
    if (plan.kind === 'skip')
      left.push({
        text: `its column ${index + 1}${listing.columns[index].field ? `, ${listing.columns[index].field},` : ''} is left out: ${plan.note}`,
        proposed: plan.outcome === 'proposed',
      });
  });
  const columns = plans.flatMap((plan) => (plan.kind === 'write' ? [plan.entry] : []));
  if (columns.length === 0)
    return {
      outcome: plans.some((plan) => plan.kind === 'skip' && plan.outcome === 'proposed')
        ? 'proposed'
        : 'reported',
      problem: `None of its list's columns can be written, and a card of related records needs one: ${left.map((item) => item.text).join('; ')}`,
    };
  // Conditions inside the page around its list, beyond the page's own, are the card's.
  const own = new Set(page.conditions);
  const inner =
    listing.conditions.length > 0 && listing.conditions.some((index) => !own.has(index))
      ? guardOfSet(inventory, page.path, listing.conditions)
      : null;
  if (inner && inner.kind !== 'rule') return { outcome: inner.kind, problem: inner.note };
  const guard = inner?.kind === 'rule' && inner.rule !== 'core.true' ? inner : undefined;
  const cardId = `${tabId}.records`;
  return {
    plan: {
      cardId,
      card: {
        id: cardId,
        ...(guard ? { visibleWhen: guard.rule } : {}),
        related: {
          pageProvider: provider.provider,
          ...(parameters.parameters.length > 0 ? { parameters: parameters.parameters } : {}),
          columns,
          ...(sorted.sort.length > 0 ? { sort: sorted.sort } : {}),
          ...(pageSize !== null ? { pageSize } : {}),
        },
      },
      provider: provider.provider,
      parameters: parameters.parameters,
      sort: sorted.sort,
      pageSize,
      source: page.path,
      columns: listing.columns,
      plans,
      ...(guard ? { guard } : {}),
      left,
    },
  };
}

/** The names of Web UI's own tabs, whose pages are Web UI's: `nuxeo-web-ui-bundle.html`. */
const WEB_UI_TABS = new Set(['view', 'permissions', 'history', 'publication', 'trash']);

const ITEMS = 'DOCUMENT_VIEWS_ITEMS';
const PAGES = 'DOCUMENT_VIEWS_PAGES';

/**
 * Every tab of the package that becomes one, and what each other contribution to Web UI's tabs,
 * an item or a page, and the block uses its page holds, are decided as.
 */
export function tabDecisions(context: Pick<ConvertContext, 'inventory' | 'pkg'>): {
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
    const use =
      page.uses
        .map((index) =>
          inventory.blockUses.find(
            (candidate) => candidate.path === page.path && candidate.index === index,
          ),
        )
        .find((candidate) => candidate && own(candidate.attributes, 'name')?.trim() === name) ??
      null;
    // A page that is a list, a page provider and its table, is a card of related records.
    let listing: ListingPlan | null = null;
    if (!use && page.listing) {
      const planned = listingPlan(inventory, page, page.listing, slug(name));
      if ('problem' in planned) {
        both(item, page, { outcome: planned.outcome, note: planned.problem });
        continue;
      }
      listing = planned.plan;
    }
    if (!use && !listing) {
      const element = page.parts.find((part) => own(part.attributes, 'name')?.trim() === name);
      both(item, page, {
        outcome: 'reported',
        note: `Its page, ${element?.element ?? 'the element named so'}, is no layout block of the package, nor a list of a page provider, so no card holds what it shows: a custom element of the package's own custom bundle has its plugin proposed with the element, for a person to place in a tab, and Web UI's own or another file's a person maps`,
      });
      continue;
    }
    if (use && !use.document) {
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
    // A list that sends a property of the open record lists nothing of a type that has none.
    const lacking = listing
      ? typesLacking(packageModel(context.pkg, inventory), types, listing)
      : [];
    if (lacking.length > 0) {
      both(item, page, {
        outcome: 'reported',
        note: `Its list sends the open record's ${lacking.map(([type, field]) => `${field}, which ${type} has not`).join('; ')}, by the package's own model: which records it lists there is a person's call`,
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
      listing,
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
export function tabPlans(context: Pick<ConvertContext, 'inventory' | 'pkg'>): TabPlan[] {
  return tabDecisions(context).tabs;
}

/**
 * The types a listing shows on that lack a property of the open record it sends, each with the
 * property, as the package's own model says: a property of a schema the package defines, on a type
 * the package defines without it. One the package does not define rests on the platform's model,
 * which check 3 lists.
 */
function typesLacking(
  model: PackageModel,
  types: readonly string[],
  listing: ListingPlan,
): [string, string][] {
  const fields = listing.parameters.flatMap((parameter) => {
    const field =
      typeof parameter === 'object' && parameter !== null
        ? (parameter as { field?: unknown }).field
        : undefined;
    return typeof field === 'string' && !field.startsWith('ecm:') ? [field] : [];
  });
  return types.flatMap((type) => {
    const schemas = schemasOfType(model, type);
    return fields.flatMap((field): [string, string][] => {
      const schema = model.schemas.get(field.slice(0, field.indexOf(':')));
      return schemas !== null && schema !== undefined && !schemas.has(schema.name)
        ? [[type, field]]
        : [];
    });
  });
}

/**
 * The name of the page a `DOCUMENT_VIEWS_PAGES` contribution holds: that of the one element its
 * template stamps with a name, as Web UI's document page selects it (`SlotContribution.pageNames`),
 * not of an element inside it, such as a column of its list.
 */
function pageNameOf(page: SlotContribution): string | null {
  return page.pageNames.length === 1 ? page.pageNames[0] : null;
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
