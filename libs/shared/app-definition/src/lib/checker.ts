/**
 * What every file of app definition version 2 is checked with: ids, names, rules, values,
 * computations and field entries. Layout file version 2 defines them
 * (docs/business-apps/layout-v2.md), and the other files reuse them
 * (docs/business-apps/app-definition-v2.md, section 2).
 */
import {
  isFieldReference,
  isRecord,
  XPATH,
  type ParameterKind,
  type Registries,
  type Signature,
} from './registries';

export interface Finding {
  /** Where, as `cards[1].fields[0].widget`. Empty for the file as a whole. */
  readonly path: string;
  /**
   * `structure`: not version 2's shape.
   * `unknown`: it names a widget, computation, check, rule, action, module or key nobody
   * registered, or something the package does not have.
   * `parameter`: a registered ID with parameters it does not take.
   *
   * What the app does with each, file by file, is in app-definition-v2.md, section 10.
   */
  readonly kind: 'structure' | 'unknown' | 'parameter';
  readonly message: string;
}

export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A name the server defines: a page provider, an aggregate, an operation or a transition. */
export const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
/** A rule's ID, as the manifest writes one. */
export const RULE_ID = /^[A-Za-z][A-Za-z0-9_.-]*$/;
export const FORM_KEYS = ['required', 'readOnlyWhen', 'checks'];
export const FIELD_KEYS = [
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
export const CHECK_KEYS = ['type', 'parameters', 'label', 'labelKey'];
/** A task form's own variables, as a field writes them: `var:<name>`. */
const VARIABLE = 'var:';

export function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

export function isLiteral(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * The checks every file starts with: an object, in version 2. Returns the findings that stop the
 * file being read further, or `null` when it may be.
 */
export function unreadable(content: unknown, what: string): Finding[] | null {
  if (!isRecord(content))
    return [{ path: '', kind: 'structure', message: `${what} is a JSON object` }];
  if (content['version'] !== 2) {
    return [
      {
        path: 'version',
        kind: 'structure',
        message: `version must be 2, not ${JSON.stringify(content['version'] ?? null)}`,
      },
    ];
  }
  return null;
}

export interface CheckerOptions {
  /** A task form, whose `var:` fields are the step's variables and the only ones it edits. */
  readonly task?: boolean;
}

export type Checker = ReturnType<typeof createChecker>;

/** One file's findings, and the checks that add to them. */
export function createChecker(registries: Registries, options: CheckerOptions = {}) {
  const task = options.task === true;
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

  /** Something a person sees: it needs a `label`, a `labelKey`, or both. */
  const named = (value: Record<string, unknown>, path: string): void => {
    label(value, path);
    if (!('label' in value) && !('labelKey' in value))
      add(path, 'structure', 'needs a "label" or a "labelKey"');
  };

  /** `$schema`, which an editor reads to find a file's JSON Schema, as version 1's fragments write it. */
  const schemaKey = (file: Record<string, unknown>): void => {
    if ('$schema' in file && typeof file['$schema'] !== 'string')
      add('$schema', 'structure', '$schema is the address of a JSON Schema, for editors');
  };

  /** A property, once its form is right: `var:` names a task's variable, so only a task form has it. */
  const variable = (xpath: string, path: string): void => {
    if (!task && xpath.startsWith(VARIABLE))
      add(path, 'structure', '"var:" names a task variable, which only a task form has');
  };

  /** A rule, as the manifest writes it: an ID, or `{ "type", "parameters" }`. */
  const rule = (item: unknown, path: string): void => {
    const [type, parameters] =
      typeof item === 'string'
        ? [item, []]
        : isRecord(item)
          ? [item['type'], 'parameters' in item ? item['parameters'] : []]
          : [null, null];
    if (typeof type !== 'string' || !RULE_ID.test(type)) {
      add(path, 'structure', 'a rule is an ID, or { "type": <ID>, "parameters": [...] }');
      return;
    }
    if (isRecord(item)) unknownKeys(item, ['type', 'parameters'], path);
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
    if (isLiteral(item)) return;
    if (isFieldReference(item)) {
      variable(item.field, join(path, 'field'));
      return;
    }
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
          else variable(inner, path);
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
    const parameters = 'parameters' in item ? item['parameters'] : [];
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
    const parameters = 'parameters' in item ? item['parameters'] : [];
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
      else if (isFieldReference(setting))
        variable(setting.field, join(join(join(path, 'parameters'), name), 'field'));
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

  /**
   * A field entry: a property as `<prefix>:<name>`, or an object. `form` is a form's field, where
   * `inForm` says whether the form keys may be used: a table's columns in a form may not.
   */
  const field = (entry: unknown, path: string, form: boolean, inForm = form): void => {
    if (typeof entry === 'string') {
      if (!XPATH.test(entry))
        add(path, 'structure', `"${entry}" is not a property, <prefix>:<name>`);
      else variable(entry, path);
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
    if (hasField) {
      if (typeof entry['field'] !== 'string' || !XPATH.test(entry['field']))
        add(join(path, 'field'), 'structure', 'must be a property, <prefix>:<name>');
      else variable(entry['field'], join(path, 'field'));
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
      // A computation's result is always text, never HTML (layout-v2.md, section 4), and
      // `core.template` puts property values into it: shown through `rich-text`, a value anyone
      // may edit would become markup on the page.
      if (entry['widget'] === 'rich-text') {
        add(
          join(path, 'widget'),
          'parameter',
          'a computed field is text, never HTML, so it cannot use the widget "rich-text"',
        );
      }
    }
    if ('id' in entry) claim(entry['id'], join(path, 'id'));
    widget(entry, path, form);
    if ('visibleWhen' in entry) rule(entry['visibleWhen'], join(path, 'visibleWhen'));
    const editable =
      typeof entry['field'] === 'string' && (entry['field'] as string).startsWith(VARIABLE);
    for (const key of FORM_KEYS) {
      if (!(key in entry)) continue;
      if (!inForm)
        add(join(path, key), 'structure', `"${key}" belongs in the edit and create forms only`);
      else if (task && !editable)
        add(
          join(path, key),
          'structure',
          `"${key}" belongs on a var: field: a task form shows the record's own properties read-only`,
        );
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

  /** A list of identifiers, each one of `known`, as a queue's or a related list's actions are. */
  const actions = (
    item: unknown,
    path: string,
    known: ReadonlySet<string>,
    what: 'row action' | 'bulk action',
  ): void => {
    const key = path.split('.').pop();
    if (!Array.isArray(item)) {
      add(path, 'structure', `${key} must be a list`);
      return;
    }
    item.forEach((action, index) => {
      if (typeof action !== 'string' || !known.has(action)) {
        add(
          join(path, index),
          'unknown',
          `the ${what} ${JSON.stringify(action)} is not registered`,
        );
      }
    });
  };

  /**
   * The keys a list of records has, wherever it shows (layout-v2.md, section 7): its page provider
   * and parameters, columns, sort, page size and row actions. A related list may give a parameter
   * from the open record's fields; a queue has no open record.
   */
  const list = (
    item: Record<string, unknown>,
    path: string,
    options: { readonly openRecord: boolean },
  ): void => {
    if (typeof item['pageProvider'] !== 'string' || !NAME.test(item['pageProvider'])) {
      add(
        join(path, 'pageProvider'),
        'structure',
        'needs the name of a page provider defined on the server',
      );
    }
    const parameters = 'parameters' in item ? item['parameters'] : [];
    if (!Array.isArray(parameters))
      add(join(path, 'parameters'), 'structure', 'parameters must be a list');
    else {
      parameters.forEach((p, index) => {
        const at = join(join(path, 'parameters'), index);
        if (isLiteral(p)) return;
        if (!options.openRecord)
          add(
            at,
            'structure',
            'a queue has no open record, so a page provider parameter is a literal',
          );
        else if (isFieldReference(p)) variable(p.field, join(at, 'field'));
        else
          add(
            at,
            'structure',
            'a page provider parameter is a literal or { "field": "<prefix>:<name>" }',
          );
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
          if (isRecord(entry)) unknownKeys(entry, ['field', 'order'], at);
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
          } else variable(entry['field'], join(at, 'field'));
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
    if ('rowActions' in item)
      actions(item['rowActions'], join(path, 'rowActions'), registries.rowActions, 'row action');
  };

  return {
    registries,
    findings,
    add,
    claim,
    unknownKeys,
    label,
    named,
    schemaKey,
    rule,
    value,
    computation,
    field,
    actions,
    list,
  };
}
