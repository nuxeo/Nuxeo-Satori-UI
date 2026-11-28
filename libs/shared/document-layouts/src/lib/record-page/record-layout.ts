import {
  BANNER_TONES,
  PACKAGED_REGISTRIES,
  linkedShowOf,
  loadable,
  validateLayoutV2,
  withRegistered,
  type Finding,
} from '@agentic-ui/shared/app-definition';

import type { Invalid } from '../layout-file';
import type { LayoutLabel } from '../layout.model';
import { fieldLabelKey, humanize } from '../resolve-layout';
import { notDrawnColumn } from './widget-support';

/**
 * Layout file version 2 in `view` mode, as the app loads it: the record page's main area
 * (docs/business-apps/layout-v2.md).
 *
 * Tolerant, as section 8 of that document asks. A structural error refuses the whole file, and
 * the record page is then today's document page. A banner, card, tab or field that names something
 * this build does not have — a widget, a computation, a rule — or that gives a widget a parameter
 * it cannot take is left out, the console says why, and the rest of the file still shows. So a file
 * written for a later platform shows everything this one knows. So is one whose rule nests deeper
 * than the rule registry answers ({@link MAX_RULE_LEVELS}): it would pass, and show what it hides.
 */

/** A rule as a layout writes it: an ID, or `{ "type", "parameters" }`, evaluated by the rule registry. */
export type RecordRule =
  string | { readonly type: string; readonly parameters?: readonly unknown[] };

interface RecordFieldBase {
  /** Where the entry is in the file, as `cards[0].fields[2]`, for the console. */
  readonly place: string;
  readonly label: LayoutLabel;
  /** A registered widget, or `null` for the one the property's schema type picks, as in version 1. */
  readonly widget: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly visibleWhen: RecordRule | null;
}

/** A field showing one property of the record. */
export interface RecordPropertyField extends RecordFieldBase {
  readonly kind: 'property';
  /** `<prefix>:<name>`. */
  readonly xpath: string;
}

/**
 * The property of the linked record a `document-link` field shows in place of its title, its
 * `show` (layout-v2.md, section 12), written alone or as `{ "field", "widget", "parameters" }`, or
 * `null` for one that shows the title, and for any other widget. The validator has refused a `show`
 * that is not `<prefix>:<name>`.
 */
export function showOf(field: Pick<RecordFieldBase, 'widget' | 'parameters'>): string | null {
  if (field.widget !== 'document-link') return null;
  return linkedShowOf(field.parameters['show'])?.field ?? null;
}

/**
 * The widget a `document-link`'s `show` shows the linked record's property through, with its
 * parameters (layout-v2.md, section 12): `null` for its schema type's, as a field with none. The
 * validator holds it to `SHOWN_WIDGETS` and to the parameters it takes.
 */
export function showWidgetOf(field: Pick<RecordFieldBase, 'widget' | 'parameters'>): {
  readonly widget: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
} {
  const shown = field.widget === 'document-link' ? linkedShowOf(field.parameters['show']) : null;
  return { widget: shown?.widget ?? null, parameters: shown?.parameters ?? {} };
}

/** The types a `document-link` field says it links to, its `types`, as texts. */
export function linkedTypesOf(field: Pick<RecordFieldBase, 'parameters'>): string[] {
  const types = field.parameters['types'];
  return Array.isArray(types)
    ? types.filter((type): type is string => typeof type === 'string')
    : [];
}

/**
 * What a `show` is read for: the field's place, its `show` and its types. A page drawn anew with
 * another file, as the designer's preview is on every edit, keeps the reads of the file before
 * until those of the new one arrive, and a key that names the whole entry never pairs one file's
 * `show` with what another's read.
 */
export function showKey(field: Pick<RecordFieldBase, 'place' | 'widget' | 'parameters'>): string {
  return JSON.stringify([field.place, showOf(field), linkedTypesOf(field)]);
}

/**
 * What a list keys a column by: its property, and for one with `show`, the shown property too, so
 * that a column showing a linked record's title and one showing its property stand side by side.
 */
export function columnKey(column: RecordPropertyField): string {
  const show = showOf(column);
  return show === null ? column.xpath : `${column.xpath}/${show}`;
}

/** A field showing what a registered computation works out from the record. */
export interface RecordComputedField extends RecordFieldBase {
  readonly kind: 'computed';
  readonly id: string;
  /** `{ "type", "parameters" }`, as written: evaluated by the computation registry. */
  readonly computed: unknown;
}

export type RecordFieldEntry = RecordPropertyField | RecordComputedField;

/** One key of a list's order, as a layout writes it. */
export interface RecordListSort {
  /** `<prefix>:<name>`. */
  readonly field: string;
  readonly order: 'asc' | 'desc';
}

/**
 * A list of records (layout-v2.md, section 7): a page provider's results, one row per record. A
 * related-records card has one, and so will a queue (app-definition-v2.md, section 4).
 */
export interface RecordListEntry {
  /** A page provider defined on the server, which binds its own parameters. */
  readonly pageProvider: string;
  /**
   * Its parameters in order, as written: literals, or `{ "field" }` for a property of the open
   * record, read when the page is shown.
   */
  readonly parameters: readonly unknown[];
  /** Property columns only: a computed column is reported and left out. */
  readonly columns: readonly RecordPropertyField[];
  /** The order the list opens in; empty, the page provider's own. */
  readonly sort: readonly RecordListSort[];
  /** 1 to 100. */
  readonly pageSize: number;
  /** Row actions by ID, as the file lists them. */
  readonly rowActions: readonly string[];
}

/** What a list shows on a page when its file gives no `pageSize`. */
export const DEFAULT_LIST_PAGE_SIZE = 10;

/**
 * The kinds of event a timeline shows when its file names none: the record's own changes
 * (layout-v2.md, section 7). Not `download`, which Nuxeo audits for every thumbnail the app shows.
 */
export const DEFAULT_TIMELINE_EVENTS: readonly string[] = [
  'documentCreated',
  'documentModified',
  'documentCheckedIn',
  'lifecycle_transition_event',
  'documentLocked',
  'documentUnlocked',
  'documentMoved',
  'documentPublished',
  'documentSecurityUpdated',
  'documentRestored',
  'documentTrashed',
  'documentUntrashed',
];

/** A card's timeline (layout-v2.md, section 7): the record's history, newest first. */
export interface RecordTimelineEntry {
  /** The audit events it shows, by ID, each once: the file's, or {@link DEFAULT_TIMELINE_EVENTS}. */
  readonly events: readonly string[];
  /** Whether the reader is offered a filter by kind of event. */
  readonly filter: boolean;
  /** 1 to 100: how many entries show first, and how many more each "Show more" adds. */
  readonly pageSize: number;
}

/** A card's comments (layout-v2.md, section 7): the record's comment thread. */
export interface RecordCommentsEntry {
  /** 1 to 100: how many of the newest comments, and of each one's replies, show first. */
  readonly pageSize: number;
}

/** One field of a card from another system: a field of its connector's answer, by name. */
export interface RecordExternalField {
  /** Where the entry is in the file, as `cards[2].external.fields[1]`, for the console. */
  readonly place: string;
  /** The field's name, as the connector's allow-list names it. */
  readonly name: string;
  readonly label: LayoutLabel;
  /** One of the widgets that show one value as text, or `null` for the one its value picks. */
  readonly widget: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly visibleWhen: RecordRule | null;
}

/**
 * A card from another system (layout-v2.md, section 7): the server's connector it reads through,
 * and the fields of its answer it shows. Where that system is, and what the server may return, are
 * the connector's, on the server.
 */
export interface RecordExternalEntry {
  readonly connector: string;
  readonly fields: readonly RecordExternalField[];
}

/** One required item of a checklist, as the file lists it. */
export interface RecordChecklistItem {
  /** What the property's `item` subfield holds for it. */
  readonly id: string;
  /** Its words. A key with no text in the reader's language shows its id, made readable. */
  readonly label: LayoutLabel;
}

/**
 * A card's checklist (layout-v2.md, section 7): the items the file requires, in its order, and
 * the record's property that says how far each has got, a list of complex values whose subfields
 * are `CHECKLIST_SUBFIELDS`.
 */
export interface RecordChecklistEntry {
  /** `<prefix>:<name>`. */
  readonly field: string;
  readonly items: readonly RecordChecklistItem[];
  /**
   * The file's opt-in to a tick box on each item, `"tickable": true`, offered to someone the
   * record's permissions let change it. `false` when the file does not say so.
   */
  readonly tickable: boolean;
}

/**
 * A holds card (layout-v2.md, section 7): the record's retention and legal holds, which the
 * platform keeps, and the app's actions on a card that place and release a hold.
 */
export interface RecordHoldsEntry {
  /** The id of the action, `"on": ["card"]`, that places a hold; `null` when the card offers none. */
  readonly place: string | null;
  /** The id of the action that releases the hold; `null` when the card offers none. */
  readonly release: string | null;
  /** 1 to 100: how many of the newest holds placed and released show. */
  readonly pageSize: number;
}

/**
 * A related list's "New" (layout-v2.md, section 7): the create form of a type, with one of its
 * properties given the open record's id, read-only, filed where the file says.
 */
export interface RecordCreateEntry {
  /** The document type it creates. */
  readonly type: string;
  /** The new record's property, `<prefix>:<name>`, that takes the open record's id. */
  readonly field: string;
  /** The button's words: the file's, else "New" and the type's label. */
  readonly label: LayoutLabel;
  /**
   * The page provider whose first record is the folder the new record is filed in, or `null` for
   * the open record's own folder.
   */
  readonly folder: string | null;
}

export interface RecordCardEntry {
  readonly id: string;
  readonly place: string;
  /**
   * Its heading. A card that names one, by text or by key, falls back to its id made readable,
   * so a key with no text in the person's language still gives it a heading. A card that names
   * none has `fallback` `null`, and shows none.
   */
  readonly label: LayoutLabel;
  /** How many columns it takes, at least 1 and at most the file's `columns`. */
  readonly span: number;
  readonly visibleWhen: RecordRule | null;
  /**
   * Its fields; empty for a card of related records, a timeline, comments, another system's or a
   * checklist.
   */
  readonly fields: readonly RecordFieldEntry[];
  /** For a card of related records, the list it shows; `null` for any other card. */
  readonly related: RecordListEntry | null;
  /** For a timeline's card, what it shows; `null` for any other card. */
  readonly timeline: RecordTimelineEntry | null;
  /** For a card of comments, how it shows them; `null` for any other card. */
  readonly comments: RecordCommentsEntry | null;
  /** For a card from another system, its connector and fields; `null` for any other card. */
  readonly external: RecordExternalEntry | null;
  /** For a checklist's card, its property and items; `null` for any other card. */
  readonly checklist: RecordChecklistEntry | null;
  /** For a holds card, the actions it offers; `null` for any other card. */
  readonly holds: RecordHoldsEntry | null;
  /** For a card of related records that offers "New", what it creates; `null` otherwise. */
  readonly create: RecordCreateEntry | null;
}

export interface RecordTabEntry {
  readonly id: string;
  readonly place: string;
  readonly label: LayoutLabel;
  readonly visibleWhen: RecordRule | null;
  readonly cards: readonly RecordCardEntry[];
}

/** A banner's tone, in layout version 2's words: `info`, `warning` or `negative`. */
export type RecordBannerTone = (typeof BANNER_TONES)[number];

/** A message above the record page's cards, shown while its rule passes (layout-v2.md, section 2). */
export interface RecordBannerEntry {
  readonly id: string;
  readonly place: string;
  /** The message. A key with no text in the reader's language shows the banner's id, made readable. */
  readonly label: LayoutLabel;
  readonly tone: RecordBannerTone;
  readonly visibleWhen: RecordRule | null;
  /**
   * The property of the open record that names the record the banner links to, `<prefix>:<name>`,
   * or `null` for a banner that links nowhere. The page shows that record by its title, as a
   * `document-link` does, and opens it.
   */
  readonly link: string | null;
}

/**
 * Photos from a phone, filed on a record of the type (layout-v2.md, section 2, "Capture"): what the
 * capture page reads of a type's `view` file, and what the record page links to it by.
 */
export interface RecordCapture {
  /** The property each photo is added to, `<prefix>:<name>`: a list of files. */
  readonly property: string;
  /** The text properties a typed or scanned number is looked up in; empty for none. */
  readonly findBy: readonly string[];
  /** Whether the photos keep where they were taken. `false` unless the file says `true`. */
  readonly keepLocation: boolean;
}

/** A `view` file that the app can show, with what it left out of it. */
export interface RecordLayoutFile {
  /** 1 to 3. */
  readonly columns: number;
  /** The banners above the cards, in order; empty when the file has none. */
  readonly banners: readonly RecordBannerEntry[];
  /**
   * Whether the page shows its picture as a review, pins and rounds (layout-v2.md, section 2):
   * the file's `review`, unless a finding about it left it out. A record with no picture shows none.
   */
  readonly review: boolean;
  /**
   * Whether the page lists the picture's share links (layout-v2.md, section 2, "Share links"):
   * the file's `shareLinks`, unless a finding about it left them out. A record with no picture
   * shows none.
   */
  readonly shareLinks: boolean;
  /**
   * Photos from a phone, filed on the record: the file's `capture`, unless a finding about it left
   * it out; `null` when the file has none.
   */
  readonly capture: RecordCapture | null;
  /** The tabs, or `null` when the file lists its cards directly. */
  readonly tabs: readonly RecordTabEntry[] | null;
  /** The cards of a file without tabs; empty when it has tabs. */
  readonly cards: readonly RecordCardEntry[];
  readonly problems: readonly string[];
}

/** The composites, whose parameters are rules. Every other rule's parameters are its own values. */
const COMPOSITE_RULES: ReadonlySet<string> = new Set(['core.every', 'core.some', 'core.not']);

/** `core.choose` takes a rule first; no other computation takes one. */
const RULE_TAKING_COMPUTATION = 'core.choose';

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/** A label as version 1 reads one: a literal first, then a translation key, then `fallback`. */
export function labelOf(
  entry: Json,
  keys: readonly string[],
  fallback: string | null,
): LayoutLabel {
  const literal = text(entry['label']);
  const labelKey = text(entry['labelKey']);
  return {
    ...(literal ? { literal } : {}),
    keys: [...(labelKey ? [labelKey] : []), ...keys],
    fallback,
  };
}

/**
 * The entry a finding is about: the review, the share links, the capture, the banner, or the
 * innermost tab, card, field, list column, row action or field from another system its path passes
 * through, as `review`, `shareLinks`, `capture`, `banners[1]`, `tabs[0].cards[1].fields[2]`, `cards[3].related.columns[1]` or
 * `cards[4].external.fields[0]`, or a related list's New, `cards[3].related.create`. A widget's own lists — a table's `parameters.columns` — are not
 * fields of the file, so a finding inside one names the field whose widget it is. `null` for a
 * finding about the file as a whole.
 */
export function entryOf(path: string): string | null {
  if (path === 'review' || path.startsWith('review.')) return 'review';
  if (path === 'shareLinks' || path.startsWith('shareLinks.')) return 'shareLinks';
  if (path === 'capture' || path.startsWith('capture.')) return 'capture';
  let entry: string | null = null;
  for (const match of path.matchAll(
    /(?:^|\.)(banners|tabs|cards|fields|related\.columns|related\.rowActions|external\.fields)\[(\d+)\]/g,
  )) {
    const end = (match.index ?? 0) + match[0].length;
    // Only a chain from the start of the path: `cards[0].fields[1].parameters.columns[0]` stops
    // at the field, and `cards[0].related.sort[0]` at the card.
    const before = path.slice(0, match.index ?? 0);
    if (entry === null ? before !== '' : before !== entry) break;
    entry = path.slice(0, end);
  }
  // A related list's New is an entry of its own: what is wrong with it leaves out the button, and
  // the list stays.
  const create = entry === null ? null : `${entry}.related.create`;
  if (create !== null && (path === create || path.startsWith(`${create}.`))) return create;
  return entry;
}

/**
 * How many levels a layout's rule may nest, the rule itself being the first: as many as the rule
 * registry answers. `ExtensionRuleRegistry` stops descending below that, and answers `true` for any
 * rule there that is not declared security-relevant, so `core.false` under 32 composites would show
 * the entry it is meant to hide. A deeper rule leaves its entry out, as an unregistered one does.
 * `record-layout.spec.ts` holds this to the registry both ways: a rule this deep is answered as
 * written, and one level more is not.
 */
export const MAX_RULE_LEVELS = 32;

/**
 * Why the page could not answer `rule` as written, as the console says it, or `null` when it can:
 * it names a rule this build does not register, or it nests deeper than {@link MAX_RULE_LEVELS}.
 * The walk stops at that depth, so it never recurses further than the registry would.
 */
export function refusedRule(
  rule: unknown,
  isRuleKnown: (id: string) => boolean,
  level = 1,
): string | null {
  return ruleRefusal(
    rule,
    (id) => (isRuleKnown(id) ? null : `names the rule "${id}", which this build does not register`),
    level,
  );
}

/**
 * The first reason `refuse` gives for a rule `rule` names, itself or nested in a composite, as the
 * console says it, or that it nests deeper than {@link MAX_RULE_LEVELS}; `null` when neither. The
 * walk stops at that depth, so it never recurses further than the registry would.
 */
export function ruleRefusal(
  rule: unknown,
  refuse: (id: string) => string | null,
  level = 1,
): string | null {
  const id = typeof rule === 'string' ? rule : isRecord(rule) ? rule['type'] : undefined;
  if (typeof id !== 'string') return null;
  const refused = refuse(id);
  if (refused) return refused;
  if (level > MAX_RULE_LEVELS) {
    return `nests its rule more than ${MAX_RULE_LEVELS} levels deep, deeper than this build answers`;
  }
  if (!COMPOSITE_RULES.has(id) || !isRecord(rule) || !Array.isArray(rule['parameters']))
    return null;
  for (const nested of rule['parameters']) {
    const inner = ruleRefusal(nested, refuse, level + 1);
    if (inner) return inner;
  }
  return null;
}

/**
 * Whether `path` is `place` or inside it. A place ends in `]`, so `columns[1]` begins
 * `columns[1].visibleWhen` and never `columns[10]`.
 */
function within(path: string, place: string): boolean {
  return path.startsWith(place);
}

/**
 * Where each column this build does not draw ({@link notDrawnColumn}) is in the file, as
 * `cards[0].fields[1].parameters.columns[2]`: the places the validator's findings name.
 */
function undrawnColumnPlaces(content: Json): string[] {
  const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
  const cards = (value: unknown, prefix: string): [unknown, string][] =>
    list(value).map((card, index) => [card, `${prefix}cards[${index}]`]);
  const all: [unknown, string][] = [
    ...cards(content['cards'], ''),
    ...list(content['tabs']).flatMap((tab, index) =>
      isRecord(tab) ? cards(tab['cards'], `tabs[${index}].`) : [],
    ),
  ];
  return all.flatMap(([card, place]) =>
    isRecord(card)
      ? list(card['fields']).flatMap((field, position) =>
          isRecord(field)
            ? tableColumnEntries(field).flatMap((column, index) =>
                notDrawnColumn(column)
                  ? [`${place}.fields[${position}].parameters.columns[${index}]`]
                  : [],
              )
            : [],
        )
      : [],
  );
}

/** Why the page could not answer the rule a computation's `core.choose`, at any depth, takes. */
export function refusedRuleInComputation(
  computation: unknown,
  isRuleKnown: (id: string) => boolean,
): string | null {
  if (!isRecord(computation) || !Array.isArray(computation['parameters'])) return null;
  const parameters: readonly unknown[] = computation['parameters'];
  // `compute` hands the rule to the registry as written, which counts its levels from the first.
  if (computation['type'] === RULE_TAKING_COMPUTATION) {
    const refused = refusedRule(parameters[0], isRuleKnown);
    if (refused) return refused;
  }
  for (const parameter of parameters) {
    if (isRecord(parameter) && 'computed' in parameter) {
      const refused = refusedRuleInComputation(parameter['computed'], isRuleKnown);
      if (refused) return refused;
    }
  }
  return null;
}

/** A table widget's columns, as written in its `columns` parameter; empty for any other field. */
function tableColumnEntries(entry: Json): readonly unknown[] {
  const parameters = entry['parameters'];
  return entry['widget'] === 'table' && isRecord(parameters) && Array.isArray(parameters['columns'])
    ? parameters['columns']
    : [];
}

/**
 * The properties a computation reads, added to `found`: its `{ "field" }` parameters, at any depth,
 * and its template's `{<prefix>:<name>}` placeholders.
 */
export function propertiesReadBy(computation: unknown, found: Set<string>): void {
  if (!isRecord(computation) || !Array.isArray(computation['parameters'])) return;
  for (const parameter of computation['parameters']) {
    if (typeof parameter === 'string' && computation['type'] === 'core.template') {
      for (const match of parameter.matchAll(/\{([A-Za-z_][\w-]*:[A-Za-z_][\w-]*)\}/g)) {
        found.add(match[1]);
      }
    } else if (isRecord(parameter) && typeof parameter['field'] === 'string') {
      found.add(parameter['field']);
    } else if (isRecord(parameter) && 'computed' in parameter) {
      propertiesReadBy(parameter['computed'], found);
    }
  }
}

/**
 * What reading entries needs from the file around them: what its findings leave out, the rules
 * this build answers, and where to write what is left out, and why, for the console.
 */
export interface EntryReading {
  /** The places a finding leaves out, as `cards[0].fields[2]`, or `columns[1]` in a queue. */
  readonly leftOut: ReadonlySet<string>;
  /** Whether this build registers the rule. */
  readonly isRuleKnown: (id: string) => boolean;
  readonly problems: string[];
}

/** `key` inside `place`, or `key` alone where the list is the file's own, as a queue's is. */
const inside = (place: string, key: string): string => (place ? `${place}.${key}` : key);

/**
 * Whether the entry at `place` shows: neither a finding nor a rule the page could not answer
 * leaves it out.
 */
function keptEntry(reading: EntryReading, place: string, entry: Json): boolean {
  const { isRuleKnown, problems } = reading;
  if (reading.leftOut.has(place)) return false;
  const refused =
    refusedRule(entry['visibleWhen'], isRuleKnown) ??
    refusedRuleInComputation(entry['computed'], isRuleKnown);
  if (refused) {
    problems.push(`${place} ${refused}; left out`);
    return false;
  }
  // A table's columns may each have a rule too, and one the page cannot answer would show its
  // column to everyone: the whole table is left out rather than drawn without it. A column this
  // build does not draw (`notDrawnColumn`) is not checked, nor anything inside it: no rule of
  // its is ever evaluated, and leaving the table out for it would lose the columns that show.
  for (const [index, column] of tableColumnEntries(entry).entries()) {
    if (notDrawnColumn(column)) continue;
    const inColumn = isRecord(column) ? refusedRule(column['visibleWhen'], isRuleKnown) : null;
    if (inColumn) {
      problems.push(`${place}.parameters.columns[${index}] ${inColumn}; ${place} left out`);
      return false;
    }
  }
  return true;
}

/** The field at `place`, or none when it is left out. */
function readField(reading: EntryReading, entry: unknown, place: string): RecordFieldEntry[] {
  // One check for both shapes: a bare `<prefix>:<name>` has no rule, and only a finding can
  // leave it out.
  if (!keptEntry(reading, place, isRecord(entry) ? entry : {})) return [];
  if (typeof entry === 'string') {
    const name = entry.slice(entry.indexOf(':') + 1);
    return [
      {
        kind: 'property',
        place,
        xpath: entry,
        label: { keys: [fieldLabelKey(entry)], fallback: humanize(name) },
        widget: null,
        parameters: {},
        visibleWhen: null,
      },
    ];
  }
  if (!isRecord(entry)) return [];
  for (const [index, column] of tableColumnEntries(entry).entries()) {
    const notDrawn = notDrawnColumn(column);
    if (notDrawn) {
      reading.problems.push(
        `${place}.parameters.columns[${index}] is ${notDrawn}, which this build does not draw yet; that column left out`,
      );
    }
  }
  const common = {
    place,
    widget: text(entry['widget']) ?? null,
    parameters: isRecord(entry['parameters']) ? entry['parameters'] : {},
    visibleWhen: (entry['visibleWhen'] as RecordRule | undefined) ?? null,
  };
  if (typeof entry['field'] === 'string') {
    const xpath = entry['field'];
    // A linked record's property is labelled as that property, not as the reference holding it.
    const labelled = showOf(common) ?? xpath;
    const name = labelled.slice(labelled.indexOf(':') + 1);
    return [
      {
        kind: 'property',
        xpath,
        label: labelOf(entry, [fieldLabelKey(labelled)], humanize(name)),
        ...common,
      },
    ];
  }
  const id = String(entry['id']);
  return [
    {
      kind: 'computed',
      id,
      computed: entry['computed'],
      label: labelOf(entry, [], humanize(id)),
      ...common,
    },
  ];
}

/**
 * A list of records, as a related-records card (layout-v2.md, section 7) and a queue
 * (app-definition-v2.md, section 4) write one, with what this build cannot show of it left out: a
 * column or a row action a finding names, a column whose rule the page cannot answer, a computed
 * column, a table, and a column that repeats a property.
 *
 * `place` is where the list's keys are: `cards[3].related`, or `''` for a queue, whose keys are the
 * file's own. `owner` is what the list is, for the console. `null`, and the owner left out, when
 * no column is left. The parameters are as written: a queue's reader holds them to literals.
 */
export function readRecordList(
  raw: Json,
  place: string,
  owner: string,
  reading: EntryReading,
): RecordListEntry | null {
  const { problems } = reading;
  const shown = new Set<string>();
  const columns = (Array.isArray(raw['columns']) ? raw['columns'] : []).flatMap(
    (entry: unknown, index): RecordPropertyField[] => {
      const at = inside(place, `columns[${index}]`);
      return readField(reading, entry, at).flatMap((column) => {
        // A cell is one line of text, so a table is not drawn in one, and no rule of its own
        // columns is ever evaluated there.
        if (column.kind !== 'property' || column.widget === 'table') {
          const what =
            column.kind === 'property' ? "a table in a list's cell" : 'a computed column';
          problems.push(
            `${at} is ${what}, which this build does not draw yet; that column left out`,
          );
          return [];
        }
        // A column is its property's, for sorting as for drawing: a second one would be the same.
        // One showing a linked record's property is that property's too (`columnKey`).
        const key = columnKey(column);
        if (shown.has(key)) {
          const what =
            showOf(column) === null ? column.xpath : `${showOf(column)} of ${column.xpath}`;
          problems.push(`${at} shows ${what} again; that column left out`);
          return [];
        }
        shown.add(key);
        return [column];
      });
    },
  );
  if (columns.length === 0) {
    problems.push(`${owner} has no column this build can show; left out`);
    return null;
  }
  // A reference a column shows through `show` would order the records by the linked record's
  // stored id: the validator refuses such a key, and one that reaches here is left out of the order.
  const linked = new Set(
    columns.filter((column) => showOf(column) !== null).map((column) => column.xpath),
  );
  const sort = (Array.isArray(raw['sort']) ? raw['sort'] : [])
    .filter(isRecord)
    .map((key): RecordListSort => ({
      field: String(key['field']),
      order: key['order'] === 'desc' ? 'desc' : 'asc',
    }))
    .filter((key, index) => {
      if (!linked.has(key.field)) return true;
      problems.push(
        `${inside(place, `sort[${index}]`)} orders by ${key.field}, which a column shows through "show"; that key left out of the order`,
      );
      return false;
    });
  const rowActions = (Array.isArray(raw['rowActions']) ? raw['rowActions'] : []).filter(
    (id: unknown, index): id is string =>
      typeof id === 'string' && !reading.leftOut.has(inside(place, `rowActions[${index}]`)),
  );
  return {
    pageProvider: String(raw['pageProvider']),
    parameters: Array.isArray(raw['parameters']) ? raw['parameters'] : [],
    columns,
    sort,
    pageSize: typeof raw['pageSize'] === 'number' ? raw['pageSize'] : DEFAULT_LIST_PAGE_SIZE,
    rowActions,
  };
}

/**
 * A card from another system, with what this build cannot show of it left out: a field a finding
 * names, one whose rule the page cannot answer, and one that names a field shown already. `null`,
 * and the card left out, when no field is left. Findings about the card's own keys left the card
 * out before this is reached.
 */
function readExternal(
  raw: Json,
  place: string,
  owner: string,
  reading: EntryReading,
): RecordExternalEntry | null {
  const shown = new Set<string>();
  const fields = (Array.isArray(raw['fields']) ? raw['fields'] : []).flatMap(
    (entry: unknown, index): RecordExternalField[] => {
      const at = `${place}.fields[${index}]`;
      const written = isRecord(entry) ? entry : {};
      if (!keptEntry(reading, at, written)) return [];
      const name = typeof entry === 'string' ? entry : String(written['name']);
      if (shown.has(name)) {
        reading.problems.push(`${at} shows ${name} again; that field left out`);
        return [];
      }
      shown.add(name);
      return [
        {
          place: at,
          name,
          label: labelOf(written, [], humanize(name)),
          widget: text(written['widget']) ?? null,
          parameters: isRecord(written['parameters']) ? written['parameters'] : {},
          visibleWhen: (written['visibleWhen'] as RecordRule | undefined) ?? null,
        },
      ];
    },
  );
  if (fields.length === 0) {
    reading.problems.push(`${owner} has no field this build can show; left out`);
    return null;
  }
  return { connector: String(raw['connector']), fields };
}

const pageSizeOf = (raw: Json): number =>
  typeof raw['pageSize'] === 'number' ? raw['pageSize'] : DEFAULT_LIST_PAGE_SIZE;

/** A checklist as the file writes it: the validator has refused one of any other shape. */
function checklistOf(raw: Json): RecordChecklistEntry {
  const items = (Array.isArray(raw['items']) ? raw['items'] : [])
    .filter(isRecord)
    .map((item): RecordChecklistItem => {
      const id = String(item['id']);
      return { id, label: labelOf(item, [], humanize(id)) };
    });
  return { field: String(raw['field']), items, tickable: raw['tickable'] === true };
}

/** A timeline as the file writes it, its defaults filled in and its events each named once. */
function timelineOf(raw: Json): RecordTimelineEntry {
  const events = Array.isArray(raw['events'])
    ? raw['events'].filter((event): event is string => typeof event === 'string')
    : DEFAULT_TIMELINE_EVENTS;
  return {
    events: [...new Set(events)],
    filter: raw['filter'] === true,
    pageSize: pageSizeOf(raw),
  };
}

/** A holds card as the file writes it: the validator has refused one of any other shape. */
function holdsOf(raw: Json): RecordHoldsEntry {
  return {
    place: text(raw['place']) ?? null,
    release: text(raw['release']) ?? null,
    pageSize: pageSizeOf(raw),
  };
}

/** A related list's New as the file writes it, once the validator has passed it. */
function createOf(raw: Json): RecordCreateEntry {
  const type = String(raw['type']);
  return {
    type,
    field: String(raw['field']),
    label: labelOf(raw, [], null),
    folder:
      isRecord(raw['in']) && typeof raw['in']['pageProvider'] === 'string'
        ? raw['in']['pageProvider']
        : null,
  };
}

export function describe(finding: Finding): string {
  return finding.path ? `${finding.path}: ${finding.message}` : finding.message;
}

/** What this build registers, by ID, that a file may name. */
export interface RecordLayoutRegistered {
  /** The rule registry's rules. */
  readonly rules: readonly string[];
  /**
   * The row actions slot's actions. A customer's own, registered in Layer 2 code, is known here
   * as the platform's are; whether a row offers one is decided when the row is drawn.
   */
  readonly rowActions?: readonly string[];
}

/**
 * Read a version 2 `view` file. `registered.rules` are the rules this build registers, the rule
 * registry's IDs, and they decide which rules the file may name:
 *
 * - a customer's own rule, registered in Layer 2 code, is known here though the validator's
 *   packaged list lacks it, as the pipeline's `--registered` makes it known there;
 * - a rule the validator knows and this build does not register, a platform rule a build was
 *   made without, is not: evaluated, it would pass, and show a field its author meant to hide.
 */
export function readRecordLayout(
  content: Json,
  registered: RecordLayoutRegistered,
): RecordLayoutFile | Invalid {
  const rules = new Set(registered.rules);
  const isRuleKnown = (id: string): boolean => rules.has(id);
  const findings = validateLayoutV2(content, {
    mode: 'view',
    registries: withRegistered(PACKAGED_REGISTRIES, {
      rules: registered.rules,
      rowActions: registered.rowActions ?? [],
    }),
  });
  if (!loadable(findings)) {
    const structural = findings.filter((finding) => finding.kind === 'structure');
    const more = structural.length > 1 ? ` (and ${structural.length - 1} more)` : '';
    return { invalid: `${describe(structural[0])}${more}` };
  }

  const problems: string[] = [];
  const leftOut = new Set<string>();
  const undrawn = undrawnColumnPlaces(content);
  for (const finding of findings) {
    // A finding inside a column this build does not draw is about that column only, which is
    // left out anyway: the table it is in stays. Structural findings never get here, since any
    // one of them refuses the file above, inside such a column or not.
    const column = undrawn.find((place) => within(finding.path, place));
    if (column) {
      problems.push(`${describe(finding)}; ${column} left out`);
      continue;
    }
    const entry = entryOf(finding.path);
    if (entry) leftOut.add(entry);
    problems.push(`${describe(finding)}; ${entry ? `${entry} left out` : 'ignored'}`);
  }

  const reading: EntryReading = { leftOut, isRuleKnown, problems };
  const kept = (place: string, entry: Json): boolean => keptEntry(reading, place, entry);
  const field = (entry: unknown, place: string): RecordFieldEntry[] =>
    readField(reading, entry, place);

  const cards = (list: unknown, prefix: string): RecordCardEntry[] =>
    (Array.isArray(list) ? list : []).flatMap((card: unknown, index): RecordCardEntry[] => {
      const place = `${prefix}cards[${index}]`;
      if (!isRecord(card) || !kept(place, card)) return [];
      const common = {
        id: String(card['id']),
        place,
        label: labelOf(
          card,
          [],
          'label' in card || 'labelKey' in card ? humanize(String(card['id'])) : null,
        ),
        span: typeof card['span'] === 'number' ? card['span'] : 1,
        visibleWhen: (card['visibleWhen'] as RecordRule | undefined) ?? null,
      };
      const none = {
        fields: [],
        related: null,
        timeline: null,
        comments: null,
        external: null,
        checklist: null,
        holds: null,
        create: null,
      };
      if (isRecord(card['related'])) {
        const related = readRecordList(card['related'], `${place}.related`, place, reading);
        // A finding about its New leaves out the button alone, and the list stays.
        const create =
          isRecord(card['related']['create']) && !leftOut.has(`${place}.related.create`)
            ? createOf(card['related']['create'])
            : null;
        return related ? [{ ...common, ...none, related, create }] : [];
      }
      if (isRecord(card['external'])) {
        const external = readExternal(card['external'], `${place}.external`, place, reading);
        return external ? [{ ...common, ...none, external }] : [];
      }
      // Any finding inside a timeline, comments or a checklist left their card out above, so what
      // is here is sound.
      if (isRecord(card['checklist'])) {
        return [{ ...common, ...none, checklist: checklistOf(card['checklist']) }];
      }
      if (isRecord(card['timeline'])) {
        return [{ ...common, ...none, timeline: timelineOf(card['timeline']) }];
      }
      if (isRecord(card['comments'])) {
        return [{ ...common, ...none, comments: { pageSize: pageSizeOf(card['comments']) } }];
      }
      if (isRecord(card['holds'])) {
        return [{ ...common, ...none, holds: holdsOf(card['holds']) }];
      }
      const fields = (Array.isArray(card['fields']) ? card['fields'] : []).flatMap(
        (entry: unknown, position) => field(entry, `${place}.fields[${position}]`),
      );
      // A heading with nothing under it is not a card, as version 1 leaves out an empty section.
      if (fields.length === 0) return [];
      return [{ ...common, ...none, fields }];
    });

  // A banner a finding is about, such as one naming a rule this build does not register, is left
  // out alone; the validator has already refused a file whose banners are not a list of objects.
  const banners = (Array.isArray(content['banners']) ? content['banners'] : []).flatMap(
    (banner: unknown, index): RecordBannerEntry[] => {
      const place = `banners[${index}]`;
      if (!isRecord(banner) || !kept(place, banner)) return [];
      const tone = BANNER_TONES.find((each) => each === banner['tone']) ?? 'info';
      return [
        {
          id: String(banner['id']),
          place,
          label: labelOf(banner, [], humanize(String(banner['id']))),
          tone,
          visibleWhen: (banner['visibleWhen'] as RecordRule | undefined) ?? null,
          // A link whose field is not a property refused the whole file, as structural, and one
          // with a key this build lacks left the banner out above, so a link here names one.
          link:
            isRecord(banner['link']) && typeof banner['link']['field'] === 'string'
              ? banner['link']['field']
              : null,
        },
      ];
    },
  );

  // A finding about the review, such as an option this build does not have, leaves it out alone.
  const review = isRecord(content['review']) && !leftOut.has('review');
  // The same for the share links: a finding about them leaves them out, and nothing else.
  const shareLinks = isRecord(content['shareLinks']) && !leftOut.has('shareLinks');
  // And for the capture: a finding about it, such as an option this build lacks, leaves it out.
  const capture = captureOf(content['capture'], leftOut.has('capture'));

  const columns = typeof content['columns'] === 'number' ? content['columns'] : 1;
  if (!Array.isArray(content['tabs'])) {
    return {
      columns,
      banners,
      review,
      shareLinks,
      capture,
      tabs: null,
      cards: cards(content['cards'], ''),
      problems,
    };
  }
  const tabs = content['tabs'].flatMap((tab: unknown, index): RecordTabEntry[] => {
    const place = `tabs[${index}]`;
    if (!isRecord(tab) || !kept(place, tab)) return [];
    const inside = cards(tab['cards'], `${place}.`);
    if (inside.length === 0) return [];
    return [
      {
        id: String(tab['id']),
        place,
        label: labelOf(tab, [], humanize(String(tab['id']))),
        visibleWhen: (tab['visibleWhen'] as RecordRule | undefined) ?? null,
        cards: inside,
      },
    ];
  });
  return { columns, banners, review, shareLinks, capture, tabs, cards: [], problems };
}

/**
 * A file's `capture` as the app uses it, once the validator has passed it: a structural finding
 * about it refused the whole file, so what is read here has a property. `null` when the file has
 * none, or when a finding left it out.
 */
function captureOf(value: unknown, leftOut: boolean): RecordCapture | null {
  if (!isRecord(value) || leftOut || typeof value['property'] !== 'string') return null;
  const findBy = Array.isArray(value['findBy'])
    ? value['findBy'].filter((name): name is string => typeof name === 'string')
    : [];
  return { property: value['property'], findBy, keepLocation: value['keepLocation'] === true };
}
