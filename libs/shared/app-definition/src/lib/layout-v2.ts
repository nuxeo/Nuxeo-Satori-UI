/**
 * The validator of layout file version 2 (docs/business-apps/layout-v2.md).
 *
 * It returns every finding, each with where it is and what kind it is, and leaves the verdict to
 * the caller, because section 8 of the proposal wants two:
 *
 * - **strict when built:** the pipeline refuses a package with any finding at all;
 * - **tolerant when loaded:** the app refuses the file only for a `structure` finding, and leaves
 *   out the card or field an `unknown` or `parameter` finding is in, so that a file written for a
 *   later platform still shows what this one knows.
 *
 * It checks the file against itself and the registries. It does not check a property against the
 * content model, which only phase 1's model reader can do: a field naming a property the type
 * lacks passes here and is skipped when the record page renders.
 */
import {
  isFieldReference,
  isRecord,
  PACKAGED_REGISTRIES,
  XPATH,
  type ParameterKind,
  type Registries,
  type Signature,
} from './registries';

export type LayoutMode = 'view' | 'metadata' | 'edit' | 'create';
export const LAYOUT_MODES: readonly LayoutMode[] = ['view', 'metadata', 'edit', 'create'];

export interface Finding {
  /** Where, as `cards[1].fields[0].widget`. Empty for the file as a whole. */
  readonly path: string;
  /**
   * `structure`: the file is not version 2's shape, so the app refuses it whole.
   * `unknown`: it names a widget, computation, check, rule, row action or key nobody registered.
   * `parameter`: a registered ID with parameters it does not take.
   */
  readonly kind: 'structure' | 'unknown' | 'parameter';
  readonly message: string;
}

export interface ValidationOptions {
  readonly mode: LayoutMode;
  readonly registries?: Registries;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PAGE_PROVIDER = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const FORM_KEYS = ['required', 'readOnlyWhen', 'checks'];
const FILE_KEYS = ['version', 'columns', 'cards', 'tabs'];
const TAB_KEYS = ['id', 'label', 'labelKey', 'visibleWhen', 'cards'];
const CARD_KEYS = ['id', 'label', 'labelKey', 'span', 'visibleWhen', 'fields', 'related'];
const FIELD_KEYS = [
  'field',
  'computed',
  'id',
  'label',
  'labelKey',
  'widget',
  'parameters',
  'visibleWhen',
  ...FORM_KEYS,
];
const RELATED_KEYS = ['pageProvider', 'parameters', 'columns', 'sort', 'pageSize', 'rowActions'];
const CHECK_KEYS = ['type', 'parameters', 'label', 'labelKey'];

/** The keys each part of a file may hold, which the JSON Schema must list too (its own test checks). */
export const LAYOUT_V2_KEYS = {
  file: FILE_KEYS,
  tab: TAB_KEYS,
  card: CARD_KEYS,
  field: FIELD_KEYS,
  related: RELATED_KEYS,
  check: CHECK_KEYS,
} as const;

export function validateLayoutV2(content: unknown, options: ValidationOptions): Finding[] {
  const registries = options.registries ?? PACKAGED_REGISTRIES;
  const findings: Finding[] = [];
  const add = (path: string, kind: Finding['kind'], message: string): void => {
    findings.push({ path, kind, message });
  };
  const ids = new Map<string, string>();
  const claim = (id: unknown, path: string): void => {
    if (typeof id !== 'string' || !ID.test(id)) {
      add(
        path,
        'structure',
        'an id is 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit',
      );
      return;
    }
    const earlier = ids.get(id);
    if (earlier !== undefined)
      add(path, 'structure', `the id "${id}" is already used at ${earlier}`);
    else ids.set(id, path);
  };
  const unknownKeys = (
    value: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
  ): void => {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key))
        add(join(path, key), 'unknown', `"${key}" is not a key version 2 has`);
    }
  };
  const label = (value: Record<string, unknown>, path: string): void => {
    for (const key of ['label', 'labelKey']) {
      if (key in value && typeof value[key] !== 'string')
        add(join(path, key), 'structure', 'must be a text');
    }
  };

  /** A rule, as the manifest writes it: an ID, or `{ "type", "parameters" }`. */
  const rule = (value: unknown, path: string): void => {
    const [type, parameters] =
      typeof value === 'string'
        ? [value, []]
        : isRecord(value)
          ? [value['type'], value['parameters'] ?? []]
          : [null, null];
    if (typeof type !== 'string') {
      add(path, 'structure', 'a rule is an ID, or { "type": <ID>, "parameters": [...] }');
      return;
    }
    if (isRecord(value)) unknownKeys(value, ['type', 'parameters'], path);
    if (!Object.hasOwn(registries.rules, type)) {
      add(path, 'unknown', `the rule "${type}" is not registered`);
      return;
    }
    if (!Array.isArray(parameters)) {
      add(join(path, 'parameters'), 'structure', 'parameters must be a list');
      return;
    }
    const signature = registries.rules[type];
    if (signature) signed(signature, parameters, join(path, 'parameters'), `the rule "${type}"`);
  };

  /** A literal, a property, or a computation. */
  const value = (item: unknown, path: string): void => {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return;
    if (isFieldReference(item)) return;
    if (isRecord(item) && Object.keys(item).length === 1 && 'computed' in item) {
      computation(item['computed'], join(path, 'computed'));
      return;
    }
    add(
      path,
      'structure',
      'a value is a text, a number, a boolean, { "field": "<prefix>:<name>" } or { "computed": {...} }',
    );
  };

  const parameter = (kind: ParameterKind, item: unknown, path: string, owner: string): void => {
    switch (kind) {
      case 'value':
        value(item, path);
        return;
      case 'rule':
        rule(item, path);
        return;
      case 'text':
        if (typeof item !== 'string' || item === '')
          add(path, 'parameter', `${owner} takes a text here`);
        return;
      case 'unit':
        if (!['days', 'months', 'years'].includes(item as string)) {
          add(path, 'parameter', `${owner} takes "days", "months" or "years" here`);
        }
        return;
      case 'template': {
        if (typeof item !== 'string') {
          add(path, 'parameter', `${owner} takes a text with {<prefix>:<name>} placeholders`);
          return;
        }
        for (const [, inner] of item.matchAll(/\{([^}]*)\}/g)) {
          if (!XPATH.test(inner))
            add(path, 'parameter', `the placeholder {${inner}} is not a property, <prefix>:<name>`);
        }
      }
    }
  };

  /** Parameters held to a signature: their number, then each one's kind. */
  const signed = (
    signature: Signature,
    parameters: unknown[],
    path: string,
    owner: string,
  ): void => {
    const least = signature.parameters.length - (signature.optional ?? 0);
    const most = signature.rest ? Infinity : signature.parameters.length;
    if (parameters.length < least || parameters.length > most) {
      const expected = signature.rest
        ? `at least ${least}`
        : least === most
          ? `${most}`
          : `${least} to ${most}`;
      const noun = expected === '1' || expected === 'at least 1' ? 'parameter' : 'parameters';
      add(path, 'parameter', `${owner} takes ${expected} ${noun}, not ${parameters.length}`);
      return;
    }
    parameters.forEach((item, index) => {
      const kind = signature.parameters[index] ?? signature.rest;
      if (kind) parameter(kind, item, join(path, index), owner);
    });
  };

  const computation = (item: unknown, path: string): void => {
    if (!isRecord(item) || typeof item['type'] !== 'string') {
      add(path, 'structure', 'a computation is { "type": <ID>, "parameters": [...] }');
      return;
    }
    unknownKeys(item, ['type', 'parameters'], path);
    const type = item['type'];
    if (!Object.hasOwn(registries.computations, type)) {
      add(join(path, 'type'), 'unknown', `the computation "${type}" is not registered`);
      return;
    }
    const parameters = item['parameters'] ?? [];
    if (!Array.isArray(parameters))
      add(join(path, 'parameters'), 'structure', 'parameters must be a list');
    else
      signed(
        registries.computations[type],
        parameters,
        join(path, 'parameters'),
        `the computation "${type}"`,
      );
  };

  const check = (item: unknown, path: string): void => {
    if (!isRecord(item) || typeof item['type'] !== 'string') {
      add(
        path,
        'structure',
        'a check is { "type": <ID>, "parameters": [...], "label" or "labelKey" }',
      );
      return;
    }
    unknownKeys(item, CHECK_KEYS, path);
    label(item, path);
    const type = item['type'];
    if (!Object.hasOwn(registries.checks, type)) {
      add(join(path, 'type'), 'unknown', `the check "${type}" is not registered`);
      return;
    }
    const parameters = item['parameters'] ?? [];
    if (!Array.isArray(parameters))
      add(join(path, 'parameters'), 'structure', 'parameters must be a list');
    else
      signed(registries.checks[type], parameters, join(path, 'parameters'), `the check "${type}"`);
  };

  const widget = (entry: Record<string, unknown>, path: string, form: boolean): void => {
    const id = entry['widget'];
    const parameters = entry['parameters'];
    if (parameters !== undefined && !isRecord(parameters)) {
      add(join(path, 'parameters'), 'structure', 'parameters must be an object');
      return;
    }
    if (id === undefined) {
      if (parameters !== undefined)
        add(join(path, 'parameters'), 'parameter', 'parameters need a widget to belong to');
      return;
    }
    if (typeof id !== 'string') {
      add(join(path, 'widget'), 'structure', 'a widget is named by its ID');
      return;
    }
    if (!Object.hasOwn(registries.widgets, id)) {
      add(join(path, 'widget'), 'unknown', `the widget "${id}" is not registered`);
      return;
    }
    const definition = registries.widgets[id];
    const given = parameters ?? {};
    for (const [name, setting] of Object.entries(given)) {
      if (!Object.hasOwn(definition.parameters, name)) {
        add(
          join(join(path, 'parameters'), name),
          'parameter',
          `the widget "${id}" has no parameter "${name}"`,
        );
        continue;
      }
      const problem = definition.parameters[name](setting);
      if (problem) add(join(join(path, 'parameters'), name), 'parameter', `${name} ${problem}`);
    }
    for (const name of definition.required ?? []) {
      if (!Object.hasOwn(given, name))
        add(join(path, 'parameters'), 'parameter', `the widget "${id}" needs "${name}"`);
    }
    // A table's columns are field entries, held to the same rules as a card's.
    if (id === 'table' && Array.isArray(given['columns'])) {
      given['columns'].forEach((column, index) =>
        field(column, join(join(join(path, 'parameters'), 'columns'), index), form, false),
      );
    }
  };

  const field = (entry: unknown, path: string, form: boolean, inForm = form): void => {
    if (typeof entry === 'string') {
      if (!XPATH.test(entry))
        add(path, 'structure', `"${entry}" is not a property, <prefix>:<name>`);
      return;
    }
    if (!isRecord(entry)) {
      add(path, 'structure', 'a field is "<prefix>:<name>" or an object');
      return;
    }
    unknownKeys(entry, FIELD_KEYS, path);
    label(entry, path);
    const hasField = 'field' in entry;
    const hasComputed = 'computed' in entry;
    if (hasField === hasComputed)
      add(path, 'structure', 'a field has "field" or "computed", one of the two');
    if (hasField && (typeof entry['field'] !== 'string' || !XPATH.test(entry['field']))) {
      add(join(path, 'field'), 'structure', 'must be a property, <prefix>:<name>');
    }
    if (hasComputed) {
      if (!('id' in entry)) add(path, 'structure', 'a computed field needs an id');
      computation(entry['computed'], join(path, 'computed'));
      if ('required' in entry || 'readOnlyWhen' in entry) {
        add(
          path,
          'structure',
          'a computed field is never editable, so it is never required or read-only',
        );
      }
    }
    if ('id' in entry) claim(entry['id'], join(path, 'id'));
    widget(entry, path, form);
    if ('visibleWhen' in entry) rule(entry['visibleWhen'], join(path, 'visibleWhen'));
    for (const key of FORM_KEYS) {
      if (key in entry && !inForm)
        add(join(path, key), 'structure', `"${key}" belongs in the edit and create forms only`);
    }
    if (!inForm) return;
    const required = entry['required'];
    if (required !== undefined && typeof required !== 'boolean')
      rule(required, join(path, 'required'));
    if ('readOnlyWhen' in entry) rule(entry['readOnlyWhen'], join(path, 'readOnlyWhen'));
    if ('checks' in entry) {
      const checks = entry['checks'];
      if (!Array.isArray(checks)) add(join(path, 'checks'), 'structure', 'checks must be a list');
      else checks.forEach((item, index) => check(item, join(join(path, 'checks'), index)));
    }
  };

  const related = (item: unknown, path: string): void => {
    if (!isRecord(item)) {
      add(path, 'structure', 'related is an object');
      return;
    }
    unknownKeys(item, RELATED_KEYS, path);
    if (typeof item['pageProvider'] !== 'string' || !PAGE_PROVIDER.test(item['pageProvider'])) {
      add(
        join(path, 'pageProvider'),
        'structure',
        'needs the name of a page provider defined on the server',
      );
    }
    const parameters = item['parameters'] ?? [];
    if (!Array.isArray(parameters))
      add(join(path, 'parameters'), 'structure', 'parameters must be a list');
    else {
      parameters.forEach((p, index) => {
        if (!(
          typeof p === 'string' ||
          typeof p === 'number' ||
          typeof p === 'boolean' ||
          isFieldReference(p)
        )) {
          add(
            join(join(path, 'parameters'), index),
            'structure',
            'a page provider parameter is a literal or { "field": "<prefix>:<name>" }',
          );
        }
      });
    }
    const columns = item['columns'];
    if (!Array.isArray(columns) || columns.length === 0)
      add(join(path, 'columns'), 'structure', 'needs a list of columns');
    else
      columns.forEach((column, index) => field(column, join(join(path, 'columns'), index), false));
    if ('sort' in item) {
      const sort = item['sort'];
      if (!Array.isArray(sort)) add(join(path, 'sort'), 'structure', 'sort must be a list');
      else
        sort.forEach((entry, index) => {
          const at = join(join(path, 'sort'), index);
          if (
            !isRecord(entry) ||
            typeof entry['field'] !== 'string' ||
            !XPATH.test(entry['field'])
          ) {
            add(
              at,
              'structure',
              'a sort is { "field": "<prefix>:<name>", "order": "asc" or "desc" }',
            );
          } else if ('order' in entry && entry['order'] !== 'asc' && entry['order'] !== 'desc') {
            add(join(at, 'order'), 'structure', 'order is "asc" or "desc"');
          }
        });
    }
    if (
      'pageSize' in item &&
      !(
        Number.isInteger(item['pageSize']) &&
        (item['pageSize'] as number) >= 1 &&
        (item['pageSize'] as number) <= 100
      )
    ) {
      add(join(path, 'pageSize'), 'structure', 'pageSize is a whole number from 1 to 100');
    }
    if ('rowActions' in item) {
      const actions = item['rowActions'];
      if (!Array.isArray(actions))
        add(join(path, 'rowActions'), 'structure', 'rowActions must be a list');
      else
        actions.forEach((action, index) => {
          if (typeof action !== 'string' || !registries.rowActions.has(action)) {
            add(
              join(join(path, 'rowActions'), index),
              'unknown',
              `the row action ${JSON.stringify(action)} is not registered`,
            );
          }
        });
    }
  };

  const card = (item: unknown, path: string, columns: number): void => {
    if (!isRecord(item)) {
      add(path, 'structure', 'a card is an object');
      return;
    }
    unknownKeys(item, CARD_KEYS, path);
    claim(item['id'], join(path, 'id'));
    label(item, path);
    const view = options.mode === 'view';
    if ('span' in item) {
      if (!view) add(join(path, 'span'), 'structure', 'span belongs in view mode only');
      else if (!(
        Number.isInteger(item['span']) &&
        (item['span'] as number) >= 1 &&
        (item['span'] as number) <= columns
      )) {
        add(
          join(path, 'span'),
          'structure',
          `span is a whole number from 1 to the file's ${columns} columns`,
        );
      }
    }
    if ('visibleWhen' in item) rule(item['visibleWhen'], join(path, 'visibleWhen'));
    const hasFields = 'fields' in item;
    const hasRelated = 'related' in item;
    if (hasFields === hasRelated)
      add(path, 'structure', 'a card has "fields" or "related", one of the two');
    if (hasFields) {
      const fields = item['fields'];
      if (!Array.isArray(fields)) add(join(path, 'fields'), 'structure', 'fields must be a list');
      else {
        const form = options.mode === 'edit' || options.mode === 'create';
        fields.forEach((entry, index) => field(entry, join(join(path, 'fields'), index), form));
      }
    }
    if (hasRelated) {
      if (!view)
        add(join(path, 'related'), 'structure', 'related records belong in view mode only');
      else related(item['related'], join(path, 'related'));
    }
  };

  const cards = (list: unknown, path: string, columns: number): void => {
    if (!Array.isArray(list)) {
      add(path, 'structure', 'cards must be a list');
      return;
    }
    list.forEach((item, index) => card(item, join(path, index), columns));
  };

  if (!isRecord(content))
    return [{ path: '', kind: 'structure', message: 'a layout file is a JSON object' }];
  if (content['version'] !== 2) {
    return [
      {
        path: 'version',
        kind: 'structure',
        message: `version must be 2, not ${JSON.stringify(content['version'] ?? null)}`,
      },
    ];
  }
  if (!LAYOUT_MODES.includes(options.mode)) {
    return [
      {
        path: '',
        kind: 'structure',
        message: `"${options.mode}" is not a mode: ${LAYOUT_MODES.join(', ')}`,
      },
    ];
  }
  unknownKeys(content, FILE_KEYS, '');
  let columns = 1;
  if ('columns' in content) {
    if (options.mode !== 'view') add('columns', 'structure', 'columns belongs in view mode only');
    else if (!(
      Number.isInteger(content['columns']) &&
      (content['columns'] as number) >= 1 &&
      (content['columns'] as number) <= 3
    )) {
      add('columns', 'structure', 'columns is 1, 2 or 3');
    } else columns = content['columns'] as number;
  }
  const hasCards = 'cards' in content;
  const hasTabs = 'tabs' in content;
  if (hasCards === hasTabs) add('', 'structure', 'a file has "cards" or "tabs", one of the two');
  if (hasCards) cards(content['cards'], 'cards', columns);
  if (hasTabs) {
    const tabs = content['tabs'];
    if (!Array.isArray(tabs)) add('tabs', 'structure', 'tabs must be a list');
    else
      tabs.forEach((tab, index) => {
        const path = join('tabs', index);
        if (!isRecord(tab)) {
          add(path, 'structure', 'a tab is an object');
          return;
        }
        unknownKeys(tab, TAB_KEYS, path);
        claim(tab['id'], join(path, 'id'));
        label(tab, path);
        if ('visibleWhen' in tab) rule(tab['visibleWhen'], join(path, 'visibleWhen'));
        cards(tab['cards'], join(path, 'cards'), columns);
      });
  }
  return findings;
}

/** True when the pipeline may publish the file: no finding at all. */
export function publishable(findings: readonly Finding[]): boolean {
  return findings.length === 0;
}

/** True when the app may load the file, leaving out what an `unknown` or `parameter` finding names. */
export function loadable(findings: readonly Finding[]): boolean {
  return findings.every((finding) => finding.kind !== 'structure');
}

function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}
