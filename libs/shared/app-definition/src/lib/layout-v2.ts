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
  join,
  NAME,
  unreadable,
  type Checker,
  type Finding,
} from './checker';
import type { ContentModel } from './content-model';
import { againstModel } from './layout-model';
import { isRecord, PACKAGED_REGISTRIES, type Registries } from './registries';

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

const FILE_KEYS = ['$schema', 'version', 'columns', 'banners', 'cards', 'tabs'];
const BANNER_KEYS = ['id', 'label', 'labelKey', 'tone', 'visibleWhen'];
/** A banner's tones, in layout version 2's words for them: a status badge's, less two. */
export const BANNER_TONES = ['info', 'warning', 'negative'] as const;
const TAB_KEYS = ['id', 'label', 'labelKey', 'visibleWhen', 'cards'];
/** What a card shows: exactly one of these. Every one but `fields` is for `view` mode only. */
const CARD_CONTENTS = ['fields', 'related', 'timeline', 'comments'] as const;
const CARD_KEYS = ['id', 'label', 'labelKey', 'span', 'visibleWhen', ...CARD_CONTENTS];
const RELATED_KEYS = ['pageProvider', 'parameters', 'columns', 'sort', 'pageSize', 'rowActions'];
const TIMELINE_KEYS = ['events', 'filter', 'pageSize'];
const COMMENTS_KEYS = ['pageSize'];

/** The keys each part of a file may hold, which the JSON Schema must list too (its own test checks). */
export const LAYOUT_V2_KEYS = {
  file: FILE_KEYS,
  banner: BANNER_KEYS,
  tab: TAB_KEYS,
  card: CARD_KEYS,
  field: FIELD_KEYS,
  related: RELATED_KEYS,
  timeline: TIMELINE_KEYS,
  comments: COMMENTS_KEYS,
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
      c.add(path, 'structure', 'a card has one of "fields", "related", "timeline" or "comments"');
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
 * passes (layout-v2.md, section 2). A banner says something about the record; it holds no field,
 * so the content model has nothing to check in it.
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
  });
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
