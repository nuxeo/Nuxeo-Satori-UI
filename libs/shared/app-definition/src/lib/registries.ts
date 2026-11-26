/**
 * What the files of app definition version 2 may name: the widgets, computations, checks, rules,
 * row and bulk actions and domain modules the platform packages (docs/business-apps/layout-v2.md,
 * sections 3 to 7, and app-definition-v2.md). Everything a file refers to is one of these by ID,
 * as decision 4 settled; there is no expression language.
 *
 * The rules and actions exist today and are registered in code by `libs/shared/extensions`, which
 * needs Angular. They are listed again here so that this library stays plain TypeScript, usable by
 * a Node command line, and a test holds the lists to the ones `docs/extension-reference.md`
 * documents. A caller with more of them, a customer's own rule registered in Layer 2 code for one,
 * passes them in: see `withRegistered`.
 */

/** The property types a widget can show, as Nuxeo names them; `[]` marks a list. */
export type PropertyType =
  | 'string'
  | 'string[]'
  | 'long'
  | 'double'
  | 'boolean'
  | 'date'
  | 'blob'
  | 'blob[]'
  | 'complex'
  | 'complex[]';

/** Checks one widget parameter's value: `null` when it is fine, or what is wrong with it. */
export type ParameterCheck = (value: unknown) => string | null;

export interface WidgetDefinition {
  readonly accepts: readonly PropertyType[];
  readonly parameters: Readonly<Record<string, ParameterCheck>>;
  /** Parameters it cannot do without. */
  readonly required?: readonly string[];
}

/** What one parameter of a computation, check or rule must be. */
export type ParameterKind =
  /** A literal, a property (`{ "field" }`) or a computation (`{ "computed" }`). */
  | 'value'
  /** A literal or a property, never a computation: what a rule compares, which no rule computes. */
  | 'subject'
  /** A literal text. */
  | 'text'
  /** A literal text, number or boolean: a value a rule matches, as `fieldIn` compares one. */
  | 'literal'
  /** A literal text with `{<prefix>:<name>}` placeholders. */
  | 'template'
  /** `days`, `months` or `years`. */
  | 'unit'
  /**
   * A whole number of days, from 0 to 36500: how far ahead of today `dateWithin` looks, or how far
   * apart `dateAfter`'s dates may be without it passing.
   */
  | 'days'
  /**
   * What a date rule reads: a property, or a literal date, `2026-12-01` or an ISO 8601 date and
   * time with its zone. Never a computation, which the rules' library does not evaluate.
   */
  | 'date'
  /** What `app.rules.dateAfter` compares: a `date`, or `"today"`, the reader's own day. */
  | 'dateOrToday'
  /** A rule. */
  | 'rule';

export interface Signature {
  /** The parameters in order. */
  readonly parameters: readonly ParameterKind[];
  /** How many of them may be left off the end. */
  readonly optional?: number;
  /** A kind the rest of the list repeats, for rules that take a list. */
  readonly rest?: ParameterKind;
}

export interface Registries {
  readonly widgets: Readonly<Record<string, WidgetDefinition>>;
  readonly computations: Readonly<Record<string, Signature>>;
  readonly checks: Readonly<Record<string, Signature>>;
  /** Rules by ID. `null` for a rule whose parameters this library does not know, which accepts any. */
  readonly rules: Readonly<Record<string, Signature | null>>;
  readonly rowActions: ReadonlySet<string>;
  readonly bulkActions: ReadonlySet<string>;
  /**
   * The other actions registered in code, in any slot but rows and bulk: a toolbar's or a context
   * menu's. Nothing a file names is one of these; they are known so that a package's own action
   * cannot take one's id, which a manifest may not rebind. The platform's are `app.` IDs, refused
   * by their prefix, so this holds a customer's own, registered in Layer 2 code.
   */
  readonly actions: ReadonlySet<string>;
  /** The domain modules an app may turn on (architecture.md, section 6). */
  readonly modules: ReadonlySet<string>;
  /**
   * The pages a menu entry may open, by the ID of the platform's menu entry for each
   * (extension-reference.md, section 3), and a customer's own, registered in a manifest or in
   * Layer 2 code. `home`, the app's own home, is not one of them: every app has it.
   */
  readonly pages: ReadonlySet<string>;
  /**
   * The connectors to systems of record a server registers, by id, each with the fields its
   * allow-list returns (`nuxeo-agentic-connectors`), which an `external` card may name
   * (layout-v2.md, section 7). `null` where the caller does not know them, as the app does not and
   * as the pipeline does not unless `--registered` lists them: a connector is the server's to
   * define, as a page provider is, so a card is then held to the form of its names only.
   */
  readonly connectors: Readonly<Record<string, ReadonlySet<string>>> | null;
}

const text: ParameterCheck = (value) =>
  typeof value === 'string' && value.trim() !== '' ? null : 'must be a text';

const integer =
  (min: number, max: number): ParameterCheck =>
  (value) =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max
      ? null
      : `must be a whole number from ${min} to ${max}`;

const oneOf =
  (...allowed: readonly (string | number)[]): ParameterCheck =>
  (value) =>
    allowed.includes(value as string | number)
      ? null
      : `must be one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`;

const textList: ParameterCheck = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === 'string' && item !== '')
    ? null
    : 'must be a list of texts';

/** `USD`, or the property that holds a currency code. */
const currency: ParameterCheck = (value) =>
  (typeof value === 'string' && /^[A-Z]{3}$/.test(value)) || isFieldReference(value)
    ? null
    : 'must be an ISO 4217 code such as "USD", or { "field": "<prefix>:<name>" }';

const ADDRESS_PARTS = ['street', 'city', 'postcode', 'country'];
const parts: ParameterCheck = (value) => {
  if (!isRecord(value)) return `must map ${ADDRESS_PARTS.join(', ')} to subfield names`;
  const unknown = Object.keys(value).filter((key) => !ADDRESS_PARTS.includes(key));
  if (unknown.length > 0) return `has parts it does not know: ${unknown.join(', ')}`;
  return Object.values(value).every((subfield) => typeof subfield === 'string' && subfield !== '')
    ? null
    : 'must give each part a subfield name';
};

export const TONES = ['positive', 'warning', 'negative', 'info', 'neutral'];
const tones: ParameterCheck = (value) => {
  if (!isRecord(value) || Object.keys(value).length === 0) return 'must map each value to a tone';
  const wrong = Object.entries(value).filter(([, tone]) => !TONES.includes(tone as string));
  return wrong.length === 0
    ? null
    : `gives ${wrong.map(([key]) => key).join(', ')} a tone that is not one of ${TONES.join(', ')}`;
};

/**
 * What a `document-link` shows of the record it names in place of its title, `show`
 * (layout-v2.md, section 12): one of that record's own properties, as a layout names one, and
 * never the server's `ecm:` or a task's `var:`.
 */
const linkedProperty: ParameterCheck = (value) =>
  typeof value === 'string' &&
  XPATH.test(value) &&
  !value.startsWith('ecm:') &&
  !value.startsWith('var:')
    ? null
    : 'must be a property of the linked record, <prefix>:<name>, neither ecm: nor var:';

/** A table's columns are field entries, checked with the rest of the layout. */
const columns: ParameterCheck = (value) =>
  Array.isArray(value) && value.length > 0 ? null : 'must be a list of field entries';

export const PACKAGED_WIDGETS: Readonly<Record<string, WidgetDefinition>> = {
  text: { accepts: ['string'], parameters: {} },
  'long-text': { accepts: ['string'], parameters: { rows: integer(2, 20) } },
  'rich-text': { accepts: ['string'], parameters: {} },
  number: { accepts: ['long', 'double'], parameters: { decimals: integer(0, 10) } },
  currency: { accepts: ['long', 'double'], parameters: { currency }, required: ['currency'] },
  percent: { accepts: ['long', 'double'], parameters: { scale: oneOf(1, 100) } },
  date: { accepts: ['date'], parameters: { format: oneOf('short', 'long') } },
  'relative-date': { accepts: ['date'], parameters: {} },
  boolean: { accepts: ['boolean'], parameters: {} },
  phone: { accepts: ['string'], parameters: {} },
  email: { accepts: ['string'], parameters: {} },
  address: { accepts: ['complex'], parameters: { parts }, required: ['parts'] },
  user: { accepts: ['string', 'string[]'], parameters: {} },
  group: { accepts: ['string', 'string[]'], parameters: {} },
  vocabulary: {
    accepts: ['string', 'string[]'],
    parameters: { directory: text },
    required: ['directory'],
  },
  'document-link': {
    accepts: ['string', 'string[]'],
    parameters: { types: textList, show: linkedProperty },
  },
  chips: { accepts: ['string[]'], parameters: {} },
  'status-badge': { accepts: ['string'], parameters: { tones }, required: ['tones'] },
  table: { accepts: ['complex[]'], parameters: { columns }, required: ['columns'] },
  image: { accepts: ['blob'], parameters: {} },
  'file-list': { accepts: ['blob[]', 'complex[]'], parameters: {} },
};

/** Decision 4's starting set (layout-v2.md, section 4). */
export const PACKAGED_COMPUTATIONS: Readonly<Record<string, Signature>> = {
  'core.age': { parameters: ['value'] },
  'core.template': { parameters: ['template'] },
  'core.sum': { parameters: ['value', 'text'], optional: 1 },
  'core.count': { parameters: ['value'] },
  'core.dateDiff': { parameters: ['value', 'value', 'unit'] },
  'core.choose': { parameters: ['rule', 'value', 'value'] },
};

/** Checks across fields in a form (layout-v2.md, section 6). */
export const PACKAGED_CHECKS: Readonly<Record<string, Signature>> = {
  'core.notBefore': { parameters: ['value'] },
  'core.atMost': { parameters: ['value'] },
};

/** The combinators every rule list has (extension-reference.md, section 4). */
export const CORE_RULES: Readonly<Record<string, Signature>> = {
  'core.every': { parameters: [], rest: 'rule' },
  'core.some': { parameters: [], rest: 'rule' },
  'core.not': { parameters: ['rule'] },
  'core.true': { parameters: [] },
  'core.false': { parameters: [] },
};

/**
 * The parameters of the rules in `APP_RULES` that take any: the types, facets or MIME types to
 * match; the operations `isNotBusy` waits for, none of which it also accepts; layout version 2's
 * three (layout-v2.md, section 5), a property or a literal then the values, the lifecycle states,
 * or the groups; and its three date rules, a date, then for `dateWithin` how many days ahead it
 * looks, and for `dateAfter` two dates, either of them `"today"`, and how many days apart they are
 * at most without passing. `fieldIn`'s values are texts, numbers or booleans, as its evaluator in
 * `libs/shared/extensions` compares them; the rest are names, so texts. Every other rule takes
 * none.
 */
const APP_RULE_SIGNATURES: Readonly<Record<string, Signature>> = {
  'app.rules.isType': { parameters: ['text'], rest: 'text' },
  'app.rules.hasFacet': { parameters: ['text'], rest: 'text' },
  'app.rules.hasMimeType': { parameters: ['text'], rest: 'text' },
  'app.rules.isNotBusy': { parameters: [], rest: 'text' },
  'app.rules.fieldIn': { parameters: ['subject', 'literal'], rest: 'literal' },
  'app.rules.inState': { parameters: ['text'], rest: 'text' },
  'app.rules.inGroup': { parameters: ['text'], rest: 'text' },
  'app.rules.datePassed': { parameters: ['date'] },
  'app.rules.dateWithin': { parameters: ['date', 'days'] },
  'app.rules.dateAfter': { parameters: ['dateOrToday', 'dateOrToday', 'days'] },
};

/** The rules the platform registers, as `docs/extension-reference.md`, section 4, documents them. */
export const APP_RULES: Readonly<Record<string, Signature>> = Object.fromEntries(
  [
    'app.rules.canWrite',
    'app.rules.canRemove',
    'app.rules.canAddChildren',
    'app.rules.canManagePermissions',
    'app.rules.canPublish',
    'app.rules.canFollowTransition',
    'app.rules.hasDocument',
    'app.rules.isType',
    'app.rules.hasFacet',
    'app.rules.hasMimeType',
    'app.rules.hasFile',
    'app.rules.isTrashed',
    'app.rules.isNotTrashed',
    'app.rules.hasSelection',
    'app.rules.hasSingleSelection',
    'app.rules.hasMultipleSelection',
    'app.rules.canWriteSelection',
    'app.rules.canRemoveSelection',
    'app.rules.isAdministrator',
    'app.rules.isPowerUser',
    'app.rules.hasAdministrationAccess',
    'app.rules.isExternalUser',
    'app.rules.isFavorite',
    'app.rules.isLocked',
    'app.rules.isSubscribed',
    'app.rules.isInClipboard',
    'app.rules.hasVersion',
    'app.rules.isAiEnabled',
    'app.rules.isNote',
    'app.rules.isNotBusy',
    'app.rules.fieldIn',
    'app.rules.inState',
    'app.rules.inGroup',
    'app.rules.datePassed',
    'app.rules.dateWithin',
    'app.rules.dateAfter',
  ].map((id): [string, Signature] => [id, APP_RULE_SIGNATURES[id] ?? { parameters: [] }]),
);

/** The row actions a related-records list may offer (extension-reference.md, section 10a). */
export const PACKAGED_ROW_ACTIONS: ReadonlySet<string> = new Set([
  'app.rowActions.download',
  'app.rowActions.rename',
  'app.rowActions.copyTo',
  'app.rowActions.moveTo',
  'app.rowActions.delete',
]);

/** The actions over a queue's selection (extension-reference.md, section 5). */
export const PACKAGED_BULK_ACTIONS: ReadonlySet<string> = new Set([
  'app.bulkActions.downloadZip',
  'app.bulkActions.addToCollection',
  'app.bulkActions.compare',
  'app.bulkActions.addToClipboard',
  'app.bulkActions.publish',
  'app.bulkActions.delete',
]);

/**
 * The platform's pages, by the ID of its menu entry for each (extension-reference.md, section 3).
 * `app.navbar.settings` opens a drawer, not a page, so it is not one.
 */
export const PACKAGED_PAGES: ReadonlySet<string> = new Set([
  'app.navbar.knowledgeDiscovery',
  'app.navbar.dashboard',
  'app.navbar.browse',
  'app.navbar.recentlyViewed',
  'app.navbar.search',
  'app.navbar.expiredQueue',
  'app.navbar.assets',
  'app.navbar.tasks',
  'app.navbar.favorites',
  'app.navbar.collections',
  'app.navbar.personalSpace',
  'app.navbar.clipboard',
  'app.navbar.trash',
  'app.navbar.administration',
]);

/**
 * The domain modules the platform has. None yet: each joins when it is built, with the schema of
 * its settings, so until then an app that turns one on is refused.
 */
export const PACKAGED_MODULES: ReadonlySet<string> = new Set();

/**
 * The widgets an `external` card's field may use: those that show one text, number, date or
 * boolean as text. Not `rich-text`, whose HTML would come from another system; not the links,
 * `phone`, `email` and `document-link`, nor the lookups, `user`, `group` and `vocabulary`, whose ids
 * are Nuxeo's and not that system's; nor those that show a complex value or a list.
 */
export const EXTERNAL_WIDGETS: ReadonlySet<string> = new Set([
  'text',
  'long-text',
  'number',
  'currency',
  'percent',
  'date',
  'relative-date',
  'boolean',
  'status-badge',
]);

export const PACKAGED_REGISTRIES: Registries = {
  widgets: PACKAGED_WIDGETS,
  computations: PACKAGED_COMPUTATIONS,
  checks: PACKAGED_CHECKS,
  rules: { ...CORE_RULES, ...APP_RULES },
  rowActions: PACKAGED_ROW_ACTIONS,
  bulkActions: PACKAGED_BULK_ACTIONS,
  actions: new Set(),
  modules: PACKAGED_MODULES,
  pages: PACKAGED_PAGES,
  connectors: null,
};

/**
 * The packaged registries with more IDs added: the rules and actions a customer registered in
 * Layer 2 code, whose parameters this library cannot know, so it accepts any; a package's own
 * actions, from its `actions.json`; modules; pages a menu may open; and the connectors a server
 * registers, with their fields, which replace a connector of the same id. A rule the platform already
 * registers keeps its own signature, so that adding it again cannot loosen the checks of its
 * parameters.
 */
export function withRegistered(
  base: Registries,
  extra: {
    readonly rules?: readonly string[];
    readonly rowActions?: readonly string[];
    readonly bulkActions?: readonly string[];
    readonly actions?: readonly string[];
    readonly modules?: readonly string[];
    readonly pages?: readonly string[];
    /** Connectors by id, each with the fields its allow-list returns. */
    readonly connectors?: Readonly<Record<string, readonly string[]>>;
  },
): Registries {
  const connectors = extra.connectors
    ? {
        ...(base.connectors ?? {}),
        ...Object.fromEntries(
          Object.entries(extra.connectors).map(([id, fields]) => [id, new Set(fields)]),
        ),
      }
    : base.connectors;
  return {
    ...base,
    rules: { ...Object.fromEntries((extra.rules ?? []).map((id) => [id, null])), ...base.rules },
    rowActions: new Set([...base.rowActions, ...(extra.rowActions ?? [])]),
    bulkActions: new Set([...base.bulkActions, ...(extra.bulkActions ?? [])]),
    actions: new Set([...base.actions, ...(extra.actions ?? [])]),
    modules: new Set([...base.modules, ...(extra.modules ?? [])]),
    pages: new Set([...base.pages, ...(extra.pages ?? [])]),
    connectors,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `{ "field": "<prefix>:<name>" }`, and nothing else in it. */
export function isFieldReference(value: unknown): value is { field: string } {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value['field'] === 'string' &&
    XPATH.test(value['field'])
  );
}

/** A property, as version 1 writes it: `<prefix>:<name>`. */
export const XPATH = /^[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*$/;
