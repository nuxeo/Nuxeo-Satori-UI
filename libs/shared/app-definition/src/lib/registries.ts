/**
 * What a layout file version 2 may name: the widgets, computations, checks, rules and row actions
 * the platform packages (docs/business-apps/layout-v2.md, sections 3 to 7). Everything a file
 * refers to is one of these by ID, as decision 4 settled; there is no expression language.
 *
 * The rules and row actions exist today and are registered in code by `libs/shared/extensions`,
 * which needs Angular. They are listed again here so that this library stays plain TypeScript,
 * usable by a Node command line, and a test holds the two lists to the ones
 * `docs/extension-reference.md` documents. A caller with more of them, a customer's own rule
 * registered in Layer 2 code for one, passes them in: see `withRegistered`.
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
  /** A literal text. */
  | 'text'
  /** A literal text with `{<prefix>:<name>}` placeholders. */
  | 'template'
  /** `days`, `months` or `years`. */
  | 'unit'
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
  'document-link': { accepts: ['string', 'string[]'], parameters: { types: textList } },
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
 * The rules the platform registers today, as `docs/extension-reference.md`, section 4, documents
 * them. Three take a list of texts: the types, facets or MIME types to match.
 */
export const APP_RULES: Readonly<Record<string, Signature>> = Object.fromEntries(
  [
    'app.rules.canWrite',
    'app.rules.canRemove',
    'app.rules.canAddChildren',
    'app.rules.canManagePermissions',
    'app.rules.canPublish',
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
  ].map((id): [string, Signature] => [
    id,
    ['app.rules.isType', 'app.rules.hasFacet', 'app.rules.hasMimeType'].includes(id)
      ? { parameters: ['text'], rest: 'text' }
      : { parameters: [] },
  ]),
);

/**
 * The three rules layout version 2 adds (layout-v2.md, section 5). Proposed, not implemented:
 * phase 1 registers them in `libs/shared/extensions` and documents them, and the test that holds
 * `APP_RULES` to the reference then has them move there.
 */
export const PROPOSED_RULES: Readonly<Record<string, Signature>> = {
  'app.rules.fieldIn': { parameters: ['value', 'text'], rest: 'text' },
  'app.rules.inState': { parameters: ['text'], rest: 'text' },
  'app.rules.inGroup': { parameters: ['text'], rest: 'text' },
};

/** The row actions a related-records list may offer (extension-reference.md, section 10a). */
export const PACKAGED_ROW_ACTIONS: ReadonlySet<string> = new Set([
  'app.rowActions.download',
  'app.rowActions.rename',
  'app.rowActions.copyTo',
  'app.rowActions.moveTo',
  'app.rowActions.delete',
]);

export const PACKAGED_REGISTRIES: Registries = {
  widgets: PACKAGED_WIDGETS,
  computations: PACKAGED_COMPUTATIONS,
  checks: PACKAGED_CHECKS,
  rules: { ...CORE_RULES, ...APP_RULES, ...PROPOSED_RULES },
  rowActions: PACKAGED_ROW_ACTIONS,
};

/**
 * The packaged registries with more IDs added: the rules and row actions a customer registered in
 * Layer 2 code, whose parameters this library cannot know, so it accepts any.
 */
export function withRegistered(
  base: Registries,
  extra: { readonly rules?: readonly string[]; readonly rowActions?: readonly string[] },
): Registries {
  return {
    ...base,
    rules: { ...base.rules, ...Object.fromEntries((extra.rules ?? []).map((id) => [id, null])) },
    rowActions: new Set([...base.rowActions, ...(extra.rowActions ?? [])]),
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
