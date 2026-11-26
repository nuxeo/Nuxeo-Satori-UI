/**
 * The validator of layout file version 2 (docs/business-apps/layout-v2.md), and of task forms,
 * which are layout files for one workflow step (app-definition-v2.md, section 6).
 *
 * It returns every finding, each with where it is and what kind it is, and leaves the verdict to
 * the caller, because section 8 of the proposal wants two:
 *
 * - **strict when built:** the pipeline refuses a package with any finding at all;
 * - **tolerant when loaded:** the app refuses the file only for a `structure` finding, and leaves
 *   out the card or field an `unknown` or `parameter` finding is in, so that a file written for a
 *   later platform still shows what this one knows.
 *
 * It checks the file against itself and the registries, and, given the content model and the
 * document type the file lays out, against the type's properties too (`layout-model.ts`). Without
 * a model, a field naming a property the type lacks passes here, and is left out when the record
 * page renders.
 */
import {
  CHECK_KEYS,
  createChecker,
  FIELD_KEYS,
  ID,
  join,
  MAX_NESTING,
  NAME,
  unreadable,
  type Checker,
  type Finding,
} from './checker';
import type { ContentModel } from './content-model';
import { againstModel } from './layout-model';
import {
  EXTERNAL_WIDGETS,
  isRecord,
  PACKAGED_REGISTRIES,
  XPATH,
  type Registries,
} from './registries';

export type { Finding } from './checker';

export type LayoutMode = 'view' | 'metadata' | 'edit' | 'create';
export const LAYOUT_MODES: readonly LayoutMode[] = ['view', 'metadata', 'edit', 'create'];

export interface ValidationOptions {
  readonly mode: LayoutMode;
  readonly registries?: Registries;
  /**
   * The server's content model, from `readContentModel`. Given one, each field is held to the
   * properties of `type` and its facets, and each widget to its property's type.
   */
  readonly model?: ContentModel;
  /** The document type the file lays out, as its path names it: `layouts/<Type>/<mode>.layout.json`. */
  readonly type?: string;
}

const FILE_KEYS = ['$schema', 'version', 'columns', 'banners', 'review', 'cards', 'tabs'];
const BANNER_KEYS = ['id', 'label', 'labelKey', 'tone', 'visibleWhen', 'link'];
/** A banner's link: the record one of the open record's properties names, as a `document-link`. */
const BANNER_LINK_KEYS = ['field'];
/** A banner's tones, in layout version 2's words for them: a status badge's, less two. */
export const BANNER_TONES = ['info', 'warning', 'negative'] as const;
const TAB_KEYS = ['id', 'label', 'labelKey', 'visibleWhen', 'cards'];
/** What a card shows: exactly one of these. Every one but `fields` is for `view` mode only. */
const CARD_CONTENTS = [
  'fields',
  'related',
  'timeline',
  'comments',
  'external',
  'checklist',
] as const;
const CARD_KEYS = ['id', 'label', 'labelKey', 'span', 'visibleWhen', ...CARD_CONTENTS];
const RELATED_KEYS = ['pageProvider', 'parameters', 'columns', 'sort', 'pageSize', 'rowActions'];
const TIMELINE_KEYS = ['events', 'filter', 'pageSize'];
const COMMENTS_KEYS = ['pageSize'];
/** A review takes no options yet: `"review": {}` turns it on (layout-v2.md, section 2). */
const REVIEW_KEYS: readonly string[] = [];
const EXTERNAL_KEYS = ['connector', 'fields'];
const EXTERNAL_FIELD_KEYS = ['name', 'label', 'labelKey', 'widget', 'parameters', 'visibleWhen'];
const CHECKLIST_KEYS = ['field', 'items'];
const CHECKLIST_ITEM_KEYS = ['id', 'label', 'labelKey'];

/** A connector's id, as `nuxeo-agentic-connectors` registers one: a name, never an address. */
export const CONNECTOR_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
/** A field of a connector's answer, as its allow-list names it: never a property's `<prefix>:<name>`. */
export const CONNECTOR_FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/**
 * What an address looks like in a text: `//` or `\\` anywhere; a scheme at its start, a word and a
 * colon with no space after it, as `https:` or `ldap:`; or a host with a port, as
 * `core.internal:8443`. "Status: paid" is not one. Only the connector's id leaves the browser, and
 * both ends hold it to a name, so this keeps layouts honest rather than guarding the server.
 */
const ADDRESS =
  /\/\/|\\\\|^\s*[A-Za-z][A-Za-z0-9+.-]*:(?!\s|$)|(?:^|[\s(])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+:\d{1,5}(?:[/\s)]|$)/;

/** The keys each part of a file may hold, which the JSON Schema must list too (its own test checks). */
export const LAYOUT_V2_KEYS = {
  file: FILE_KEYS,
  banner: BANNER_KEYS,
  bannerLink: BANNER_LINK_KEYS,
  review: REVIEW_KEYS,
  tab: TAB_KEYS,
  card: CARD_KEYS,
  field: FIELD_KEYS,
  related: RELATED_KEYS,
  timeline: TIMELINE_KEYS,
  comments: COMMENTS_KEYS,
  external: EXTERNAL_KEYS,
  externalField: EXTERNAL_FIELD_KEYS,
  checklist: CHECKLIST_KEYS,
  checklistItem: CHECKLIST_ITEM_KEYS,
  check: CHECK_KEYS,
} as const;

export function validateLayoutV2(content: unknown, options: ValidationOptions): Finding[] {
  const registries = options.registries ?? PACKAGED_REGISTRIES;
  const model = options.model ? { model: options.model, type: options.type } : null;
  return layout(content, options.mode, registries, false, model);
}

/**
 * A task form: an edit-mode layout file whose `var:` fields are the step's variables, the only
 * fields it edits. The record's own properties show read-only.
 */
export function validateTaskForm(
  content: unknown,
  options: { readonly registries?: Registries } = {},
): Finding[] {
  return layout(content, 'edit', options.registries ?? PACKAGED_REGISTRIES, true, null);
}

function layout(
  content: unknown,
  mode: LayoutMode,
  registries: Registries,
  task: boolean,
  model: { readonly model: ContentModel; readonly type: string | undefined } | null,
): Finding[] {
  const stop = unreadable(content, task ? 'a task form' : 'a layout file');
  if (stop) return stop;
  const file = content as Record<string, unknown>;
  if (!LAYOUT_MODES.includes(mode)) {
    return [
      {
        path: '',
        kind: 'structure',
        message: `"${mode}" is not a mode: ${LAYOUT_MODES.join(', ')}`,
      },
    ];
  }
  const c = createChecker(registries, { task });
  const view = mode === 'view';
  const form = mode === 'edit' || mode === 'create';

  const card = (item: unknown, path: string, columns: number): void => {
    if (!isRecord(item)) {
      c.add(path, 'structure', 'a card is an object');
      return;
    }
    c.unknownKeys(item, CARD_KEYS, path);
    c.claim(item['id'], join(path, 'id'));
    c.label(item, path);
    if ('span' in item) {
      if (!view) c.add(join(path, 'span'), 'structure', 'span belongs in view mode only');
      else if (!(
        Number.isInteger(item['span']) &&
        (item['span'] as number) >= 1 &&
        (item['span'] as number) <= columns
      )) {
        c.add(
          join(path, 'span'),
          'structure',
          `span is a whole number from 1 to the file's ${columns} columns`,
        );
      }
    }
    if ('visibleWhen' in item) c.rule(item['visibleWhen'], join(path, 'visibleWhen'));
    if (CARD_CONTENTS.filter((key) => key in item).length !== 1)
      c.add(
        path,
        'structure',
        'a card has one of "fields", "related", "timeline", "comments", "external" or "checklist"',
      );
    if ('fields' in item) {
      const fields = item['fields'];
      if (!Array.isArray(fields)) c.add(join(path, 'fields'), 'structure', 'fields must be a list');
      else
        fields.forEach((entry, index) => c.field(entry, join(join(path, 'fields'), index), form));
    }
    if ('related' in item) {
      if (!view)
        c.add(join(path, 'related'), 'structure', 'related records belong in view mode only');
      else related(c, item['related'], join(path, 'related'));
    }
    if ('timeline' in item) {
      if (!view) c.add(join(path, 'timeline'), 'structure', 'a timeline belongs in view mode only');
      else timeline(c, item['timeline'], join(path, 'timeline'));
    }
    if ('comments' in item) {
      if (!view) c.add(join(path, 'comments'), 'structure', 'comments belong in view mode only');
      else comments(c, item['comments'], join(path, 'comments'));
    }
    if ('external' in item) {
      if (!view)
        c.add(
          join(path, 'external'),
          'structure',
          'a card from another system belongs in view mode only',
        );
      else external(c, item['external'], join(path, 'external'));
    }
    if ('checklist' in item) {
      if (!view)
        c.add(join(path, 'checklist'), 'structure', 'a checklist belongs in view mode only');
      else checklist(c, item['checklist'], join(path, 'checklist'));
    }
  };

  const cards = (list: unknown, path: string, columns: number): void => {
    if (!Array.isArray(list)) {
      c.add(path, 'structure', 'cards must be a list');
      return;
    }
    list.forEach((item, index) => card(item, join(path, index), columns));
  };

  c.unknownKeys(file, FILE_KEYS, '');
  c.schemaKey(file);
  let columns = 1;
  if ('columns' in file) {
    if (!view) c.add('columns', 'structure', 'columns belongs in view mode only');
    else if (!(
      Number.isInteger(file['columns']) &&
      (file['columns'] as number) >= 1 &&
      (file['columns'] as number) <= 3
    )) {
      c.add('columns', 'structure', 'columns is 1, 2 or 3');
    } else columns = file['columns'] as number;
  }
  if ('banners' in file) {
    if (!view) c.add('banners', 'structure', 'banners belong in view mode only');
    else banners(c, file['banners']);
  }
  if ('review' in file) {
    if (!view) c.add('review', 'structure', 'a review belongs in view mode only');
    else review(c, file['review']);
  }
  const hasCards = 'cards' in file;
  const hasTabs = 'tabs' in file;
  if (hasCards === hasTabs) c.add('', 'structure', 'a file has "cards" or "tabs", one of the two');
  if (hasCards) cards(file['cards'], 'cards', columns);
  if (hasTabs) {
    const tabs = file['tabs'];
    if (!Array.isArray(tabs)) c.add('tabs', 'structure', 'tabs must be a list');
    else
      tabs.forEach((tab, index) => {
        const path = join('tabs', index);
        if (!isRecord(tab)) {
          c.add(path, 'structure', 'a tab is an object');
          return;
        }
        c.unknownKeys(tab, TAB_KEYS, path);
        c.claim(tab['id'], join(path, 'id'));
        c.label(tab, path);
        if ('visibleWhen' in tab) c.rule(tab['visibleWhen'], join(path, 'visibleWhen'));
        cards(tab['cards'], join(path, 'cards'), columns);
      });
  }
  if (model) c.findings.push(...againstModel(file, model.type, model.model, registries));
  return c.findings;
}

/**
 * The record page's banners, above its cards: each a message in a tone, shown while its rule
 * passes (layout-v2.md, section 2). A banner says something about the record; it holds no field.
 * It may link to one record, the one a property of the open record names, as a `document-link`
 * shows it: given the content model, the property is held to the type, and to one text
 * (`layout-model.ts`).
 */
function banners(c: Checker, list: unknown): void {
  if (!Array.isArray(list)) {
    c.add('banners', 'structure', 'banners must be a list');
    return;
  }
  list.forEach((item, index) => {
    const path = join('banners', index);
    if (!isRecord(item)) {
      c.add(path, 'structure', 'a banner is an object');
      return;
    }
    c.unknownKeys(item, BANNER_KEYS, path);
    c.claim(item['id'], join(path, 'id'));
    c.named(item, path);
    if ('tone' in item && !(BANNER_TONES as readonly unknown[]).includes(item['tone']))
      c.add(join(path, 'tone'), 'structure', `tone is one of ${BANNER_TONES.join(', ')}`);
    if ('visibleWhen' in item) c.rule(item['visibleWhen'], join(path, 'visibleWhen'));
    if ('link' in item) bannerLink(c, item['link'], join(path, 'link'));
  });
}

/**
 * A banner's link: `{ "field": "<prefix>:<name>" }`, a property of the open record that holds a
 * record's id, never an `ecm:` or `var:` name. The page shows that record by its title, as a
 * `document-link` does, and opens it.
 */
function bannerLink(c: Checker, item: unknown, path: string): void {
  if (!isRecord(item)) {
    c.add(path, 'structure', 'a link is { "field": "<prefix>:<name>" }');
    return;
  }
  c.unknownKeys(item, BANNER_LINK_KEYS, path);
  const field = item['field'];
  if (
    typeof field !== 'string' ||
    !XPATH.test(field) ||
    field.startsWith('ecm:') ||
    field.startsWith('var:')
  ) {
    c.add(
      join(path, 'field'),
      'structure',
      "needs the record's property that holds the linked record's id, <prefix>:<name>, never an ecm: or var: name",
    );
  }
}

/**
 * The record page's review: pins on the picture, in rounds (layout-v2.md, section 2). It names no
 * property, so the file alone cannot say whether the type has a picture: the content model can
 * (`layout-model.ts`), and the record page, which leaves the review out of a record with none.
 */
function review(c: Checker, item: unknown): void {
  if (!isRecord(item)) {
    c.add('review', 'structure', 'review is an object: {} turns it on');
    return;
  }
  c.unknownKeys(item, REVIEW_KEYS, 'review');
}

/** A card's related records: a list of records from a page provider (layout-v2.md, section 7). */
function related(c: Checker, item: unknown, path: string): void {
  if (!isRecord(item)) {
    c.add(path, 'structure', 'related is an object');
    return;
  }
  c.unknownKeys(item, RELATED_KEYS, path);
  c.list(item, path, { openRecord: true });
}

/**
 * A card's timeline: the record's history from the server's audit, newest first (layout-v2.md,
 * section 7). An event is the server's to define, as a page provider is, so it is held to the form
 * of a name and to no list: one the server never writes shows nothing.
 */
function timeline(c: Checker, item: unknown, path: string): void {
  if (!isRecord(item)) {
    c.add(path, 'structure', 'timeline is an object');
    return;
  }
  c.unknownKeys(item, TIMELINE_KEYS, path);
  if ('events' in item) {
    const events = item['events'];
    if (!Array.isArray(events) || events.length === 0)
      c.add(join(path, 'events'), 'structure', 'events is a list of at least one event');
    else
      events.forEach((event, index) => {
        if (typeof event !== 'string' || !NAME.test(event))
          c.add(
            join(join(path, 'events'), index),
            'structure',
            'an event is named by its ID, as the audit writes it: "documentModified"',
          );
      });
  }
  if ('filter' in item && typeof item['filter'] !== 'boolean')
    c.add(join(path, 'filter'), 'structure', 'filter is true or false');
  pageSize(c, item, path);
}

/** A card's comments: the record's comment thread (layout-v2.md, section 7). */
function comments(c: Checker, item: unknown, path: string): void {
  if (!isRecord(item)) {
    c.add(path, 'structure', 'comments is an object');
    return;
  }
  c.unknownKeys(item, COMMENTS_KEYS, path);
  pageSize(c, item, path);
}

/**
 * A card of fields from another system, a system of record, read through one of the server's
 * connectors (layout-v2.md, section 7). The file names the connector and the fields, and nothing
 * else: the address, the record's key and the credential are the server's configuration, so a text
 * anywhere in the card that looks like an address refuses the file. Given the connectors a server
 * registers, each field is held to its connector's allow-list; without them, a connector is the
 * server's to define, as a page provider is, and its names are held to their form only.
 */
function external(c: Checker, item: unknown, path: string): void {
  if (!isRecord(item)) {
    c.add(path, 'structure', 'external is an object');
    return;
  }
  addresses(c, item, path);
  c.unknownKeys(item, EXTERNAL_KEYS, path);
  const id = item['connector'];
  const known = c.registries.connectors;
  let allowed: ReadonlySet<string> | null = null;
  if (typeof id !== 'string' || !CONNECTOR_ID.test(id)) {
    c.add(
      join(path, 'connector'),
      'structure',
      'needs the id of a connector the server registers: 1 to 64 letters, digits, ".", "_" or "-", starting with a letter',
    );
  } else if (known !== null) {
    if (Object.hasOwn(known, id)) allowed = known[id];
    else c.add(join(path, 'connector'), 'unknown', `the connector "${id}" is not registered`);
  }
  const fields = item['fields'];
  if (!Array.isArray(fields) || fields.length === 0) {
    c.add(
      join(path, 'fields'),
      'structure',
      "needs a list of at least one of the connector's fields",
    );
    return;
  }
  fields.forEach((entry: unknown, index) => {
    const at = join(join(path, 'fields'), index);
    if (typeof entry !== 'string' && !isRecord(entry)) {
      c.add(at, 'structure', 'a field of another system is its name, or { "name", ... }');
      return;
    }
    const name = typeof entry === 'string' ? entry : entry['name'];
    const nameAt = typeof entry === 'string' ? at : join(at, 'name');
    if (typeof name !== 'string' || !CONNECTOR_FIELD.test(name)) {
      c.add(
        nameAt,
        'structure',
        'a field of another system is named as its connector names it: 1 to 64 letters, digits or "_", starting with a letter',
      );
    } else if (allowed !== null && !allowed.has(name)) {
      c.add(nameAt, 'unknown', `the connector "${String(id)}" does not return the field "${name}"`);
    }
    if (typeof entry === 'string') return;
    c.unknownKeys(entry, EXTERNAL_FIELD_KEYS, at);
    c.label(entry, at);
    const widget = entry['widget'];
    if (
      typeof widget === 'string' &&
      Object.hasOwn(c.registries.widgets, widget) &&
      !EXTERNAL_WIDGETS.has(widget)
    ) {
      c.add(
        join(at, 'widget'),
        'parameter',
        `the widget "${widget}" does not show a value from another system: one of ${[...EXTERNAL_WIDGETS].join(', ')} does`,
      );
    } else c.widget(entry, at, false);
    if ('visibleWhen' in entry) c.rule(entry['visibleWhen'], join(at, 'visibleWhen'));
  });
}

/**
 * Every text in an `external` card, and every key, that looks like an address: a `structure`
 * finding each, so that the file is refused rather than read. A card from another system never
 * says where that system is. The walk is breadth first, and stops {@link MAX_NESTING} levels down.
 */
function addresses(c: Checker, item: Record<string, unknown>, path: string): void {
  const found = (at: string): void =>
    c.add(
      at,
      'structure',
      "an address is never written in a layout: a connector's address is the server's configuration",
    );
  const queue: [unknown, string, number][] = [[item, path, 0]];
  for (let next = 0; next < queue.length; next++) {
    const [value, at, depth] = queue[next];
    if (typeof value === 'string') {
      // A property, `claim:currency`, is a name, not an address.
      if (ADDRESS.test(value) && !XPATH.test(value)) found(at);
      continue;
    }
    if (depth >= MAX_NESTING) continue;
    if (Array.isArray(value))
      value.forEach((inner, index) => queue.push([inner, join(at, index), depth + 1]));
    else if (isRecord(value))
      for (const [key, inner] of Object.entries(value)) {
        if (ADDRESS.test(key)) found(join(at, key));
        queue.push([inner, join(at, key), depth + 1]);
      }
  }
}

/**
 * A card's checklist (layout-v2.md, section 7): the items a record must have done, which the file
 * lists, each read as done or not, with who and when, from one property of the record. The file
 * says what is required, and the record only how far it has got. An item's id is what the
 * property's `item` subfield holds for it: a value on the record, not an entry of the file, so it
 * is unique in its checklist rather than among the file's ids. The property's own shape is the
 * content model's to check (`layout-model.ts`).
 */
function checklist(c: Checker, item: unknown, path: string): void {
  if (!isRecord(item)) {
    c.add(path, 'structure', 'checklist is an object');
    return;
  }
  c.unknownKeys(item, CHECKLIST_KEYS, path);
  const field = item['field'];
  if (
    typeof field !== 'string' ||
    !XPATH.test(field) ||
    field.startsWith('ecm:') ||
    field.startsWith('var:')
  ) {
    c.add(
      join(path, 'field'),
      'structure',
      "needs the record's property that holds its items, <prefix>:<name>, never an ecm: or var: name",
    );
  }
  const items = item['items'];
  if (!Array.isArray(items) || items.length === 0) {
    c.add(join(path, 'items'), 'structure', 'needs a list of at least one item');
    return;
  }
  const listed = new Map<string, string>();
  items.forEach((entry: unknown, index) => {
    const at = join(join(path, 'items'), index);
    if (!isRecord(entry)) {
      c.add(at, 'structure', 'an item is { "id", "label" or "labelKey" }');
      return;
    }
    c.unknownKeys(entry, CHECKLIST_ITEM_KEYS, at);
    const id = entry['id'];
    if (typeof id !== 'string' || !ID.test(id)) {
      c.add(
        join(at, 'id'),
        'structure',
        'an item\'s id is what the property\'s item holds for it: 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit',
      );
    } else if (listed.has(id)) {
      c.add(join(at, 'id'), 'structure', `the item "${id}" is already listed at ${listed.get(id)}`);
    } else listed.set(id, at);
    c.named(entry, at);
  });
}

/** `pageSize`, where a card may give one: 1 to 100, as a list's is. */
function pageSize(c: Checker, item: Record<string, unknown>, path: string): void {
  const size = item['pageSize'];
  if (
    'pageSize' in item &&
    !(Number.isInteger(size) && (size as number) >= 1 && (size as number) <= 100)
  )
    c.add(join(path, 'pageSize'), 'structure', 'pageSize is a whole number from 1 to 100');
}

/**
 * Whether `validateLayoutV2`, given a model, holds this file to it: a file of version 2, in a mode,
 * for a named type. Any other stops before the model's checks, and is not one a caller may count
 * as checked against the model. A type the model lacks is held to it, and refused.
 */
export function heldToModel(
  content: unknown,
  options: { readonly mode: LayoutMode; readonly type?: string },
): boolean {
  return (
    unreadable(content, 'a layout file') === null &&
    LAYOUT_MODES.includes(options.mode) &&
    typeof options.type === 'string' &&
    options.type !== ''
  );
}

/** True when the pipeline may publish the file: no finding at all. */
export function publishable(findings: readonly Finding[]): boolean {
  return findings.length === 0;
}

/** True when the app may load the file, leaving out what an `unknown` or `parameter` finding names. */
export function loadable(findings: readonly Finding[]): boolean {
  return findings.every((finding) => finding.kind !== 'structure');
}
