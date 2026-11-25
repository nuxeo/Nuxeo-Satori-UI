/**
 * The validator of `actions.json` (docs/business-apps/app-definition-v2.md, section 5): lifecycle
 * buttons, and buttons that run an Automation operation with parameters, some of them entered in a
 * small form.
 *
 * An operation must be on the deployment's allow-list (plan decision 3, open, built on its
 * recommendation: a per-deployment allow-list), which the caller passes in. With none, every
 * operation is refused: a package cannot reach a server operation that nobody allowed. On a server
 * the allow-list is the deployment's contribution to `org.nuxeo.agentic.ui.operations`, and the
 * app registry serves only the actions it allows. Showing or hiding a button is never the control:
 * Nuxeo's permissions, the lifecycle and the server's allow-list still gate what runs.
 */
import {
  createChecker,
  ICON,
  isLiteral,
  shown,
  join,
  NAME,
  unreadable,
  type Checker,
  type Finding,
} from './checker';
import { validateTaskForm } from './layout-v2';
import { isFieldReference, isRecord, PACKAGED_REGISTRIES, type Registries } from './registries';

const FILE_KEYS = ['$schema', 'version', 'actions'];
const ACTION_KEYS = [
  'id',
  'label',
  'labelKey',
  'icon',
  'order',
  'on',
  'visibleWhen',
  'enabledWhen',
  'transition',
  'operation',
  'parameters',
  'form',
  'confirm',
  'success',
  'refresh',
];

/** A field of an action's form, as a parameter names it: `var:<name>`, what the person enters. */
const FORM_FIELD = /^var:([A-Za-z][A-Za-z0-9_]{0,63})$/;
const MESSAGE_KEYS = ['label', 'labelKey'];

/** The keys each part of `actions.json` may hold, which its JSON Schema must list too. */
export const ACTIONS_V2_KEYS = {
  file: FILE_KEYS,
  action: ACTION_KEYS,
  message: MESSAGE_KEYS,
} as const;

/** Where an action shows: the record page's toolbar, a queue's row menu, a queue's selection. */
export const PLACEMENTS = ['record', 'row', 'bulk'] as const;
export type Placement = (typeof PLACEMENTS)[number];

const PARAMETER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** IDs the platform registers in code, which a manifest cannot rebind (extension-reference.md). */
const PLATFORM_ID = /^(?:app|core)\./;

export interface ActionsOptions {
  readonly registries?: Registries;
  /** The deployment's allow-list of operations and chains. */
  readonly operations?: ReadonlySet<string>;
}

export function validateActions(content: unknown, options: ActionsOptions = {}): Finding[] {
  const stop = unreadable(content, 'an actions file');
  if (stop) return stop;
  const file = content as Record<string, unknown>;
  const c = createChecker(options.registries ?? PACKAGED_REGISTRIES);
  c.unknownKeys(file, FILE_KEYS, '');
  c.schemaKey(file);
  const actions = file['actions'];
  if (!Array.isArray(actions)) {
    c.add('actions', 'structure', 'actions must be a list');
    return c.findings;
  }
  const operations = options.operations ?? new Set<string>();
  actions.forEach((item, index) => action(c, item, join('actions', index), operations));
  return c.findings;
}

/** Where an action shows: `on`, or the record when it has none. */
export function placementsOf(action: Record<string, unknown>): readonly unknown[] {
  return Array.isArray(action['on']) ? action['on'] : ['record'];
}

function action(c: Checker, item: unknown, path: string, operations: ReadonlySet<string>): void {
  if (!isRecord(item)) {
    c.add(path, 'structure', 'an action is an object');
    return;
  }
  c.unknownKeys(item, ACTION_KEYS, path);
  c.claim(item['id'], join(path, 'id'));
  const id = item['id'];
  if (typeof id === 'string' && PLATFORM_ID.test(id))
    c.add(
      join(path, 'id'),
      'structure',
      `the id "${id}" belongs to the platform: actions.json adds actions of its own`,
    );
  // A customer's own, registered in Layer 2 code, is protected as the platform's are: by being
  // registered, not by the shape of its id (extension-reference.md, section 1).
  else if (
    typeof id === 'string' &&
    (c.registries.rowActions.has(id) ||
      c.registries.bulkActions.has(id) ||
      c.registries.actions.has(id))
  )
    c.add(
      join(path, 'id'),
      'structure',
      `the id "${id}" is registered in code, and a manifest cannot rebind it`,
    );
  c.named(item, path);
  if ('icon' in item && (typeof item['icon'] !== 'string' || !ICON.test(item['icon'])))
    c.add(
      join(path, 'icon'),
      'structure',
      'icon is the name of a Material Symbols icon, such as "check"',
    );
  if ('order' in item && !Number.isInteger(item['order']))
    c.add(join(path, 'order'), 'structure', 'order is a whole number');
  const on = placements(c, item, path);
  if ('visibleWhen' in item) c.rule(item['visibleWhen'], join(path, 'visibleWhen'));
  if ('enabledWhen' in item) c.rule(item['enabledWhen'], join(path, 'enabledWhen'));

  const hasTransition = 'transition' in item;
  const hasOperation = 'operation' in item;
  if (hasTransition === hasOperation)
    c.add(path, 'structure', 'an action has "transition" or "operation", one of the two');
  if (hasTransition && (typeof item['transition'] !== 'string' || !NAME.test(item['transition'])))
    c.add(
      join(path, 'transition'),
      'structure',
      'transition is the name of a lifecycle transition',
    );
  if (hasOperation) {
    const operation = item['operation'];
    if (typeof operation !== 'string' || !NAME.test(operation))
      c.add(
        join(path, 'operation'),
        'structure',
        'operation is the ID of an Automation operation or chain',
      );
    else if (!operations.has(operation))
      c.add(
        join(path, 'operation'),
        'unknown',
        `the operation "${operation}" is not on this deployment's allow-list`,
      );
  }
  const fields = 'form' in item ? form(c, item['form'], join(path, 'form'), hasOperation, on) : [];
  const sent = new Set<string>();
  if ('parameters' in item) {
    if (!hasOperation)
      c.add(join(path, 'parameters'), 'structure', 'parameters belong to an operation');
    else parameters(c, item['parameters'], join(path, 'parameters'), on, fields, sent);
  }
  // A field the form asks for and no parameter sends would be entered for nothing.
  fields.forEach((field, index) => {
    if (field !== null && !sent.has(field))
      c.add(
        join(join(join(path, 'form'), index), 'field'),
        'structure',
        `no parameter sends "${field}": give one { "field": "${field}" }`,
      );
  });
  for (const key of ['confirm', 'success']) {
    if (key in item) message(c, item[key], join(path, key));
  }
  if ('refresh' in item && typeof item['refresh'] !== 'boolean')
    c.add(join(path, 'refresh'), 'structure', 'refresh is true or false');
}

function placements(c: Checker, item: Record<string, unknown>, path: string): Placement[] {
  if (!('on' in item)) return ['record'];
  const on = item['on'];
  if (!Array.isArray(on) || on.length === 0) {
    c.add(join(path, 'on'), 'structure', 'on lists where it shows: "record", "row" or "bulk"');
    return [];
  }
  const seen: Placement[] = [];
  on.forEach((place, index) => {
    const at = join(join(path, 'on'), index);
    if (!PLACEMENTS.includes(place as Placement))
      c.add(at, 'structure', `${shown(place)} is not "record", "row" or "bulk"`);
    else if (seen.includes(place as Placement))
      c.add(at, 'structure', `"${place as string}" is listed twice`);
    else seen.push(place as Placement);
  });
  return seen;
}

/**
 * An operation's parameters, name to value: a literal, a field of the record, or a field of the
 * action's form, `{ "field": "var:<name>" }`, which the person enters. One record's fields cannot
 * feed a bulk action. A computation is refused: it is worked out in the browser, and the server,
 * which builds the parameters itself, does not run it.
 *
 * @param fields the form's fields, `var:<name>`, by place; `null` for one that is not one
 * @param sent filled with each form field a parameter sends
 */
function parameters(
  c: Checker,
  value: unknown,
  path: string,
  on: readonly Placement[],
  fields: readonly (string | null)[],
  sent: Set<string>,
): void {
  if (!isRecord(value)) {
    c.add(path, 'structure', 'parameters must be an object');
    return;
  }
  for (const [name, item] of Object.entries(value)) {
    const at = join(path, name);
    if (!PARAMETER.test(name)) c.add(at, 'structure', `"${name}" is not a parameter name`);
    else if (on.includes('bulk') && !isLiteral(item))
      c.add(
        at,
        'structure',
        'a bulk action runs on many records at once, so its parameters are literals',
      );
    else if (isFieldReference(item) && item.field.startsWith('var:')) {
      if (!fields.includes(item.field))
        c.add(
          join(at, 'field'),
          'structure',
          `"${item.field}" is a field of the action's form, and its form has no such field`,
        );
      else sent.add(item.field);
    } else if (isRecord(item) && 'computed' in item)
      c.add(
        at,
        'structure',
        'a computation is worked out in the browser, which the server does not trust: a parameter is a literal, a field of the record or a field of the form',
      );
    else c.value(item, at);
  }
}

/**
 * The action's form: the fields the person fills in before it runs, each `var:<name>`, drawn by
 * the version 2 form engine as a task form's are, with its widgets, rules and checks. An action on
 * one record only: a bulk action's parameters are literals. Its findings are a task form's, at
 * their place in the action. Answers each field's `var:<name>`, or `null` where it has none.
 */
function form(
  c: Checker,
  value: unknown,
  path: string,
  hasOperation: boolean,
  on: readonly Placement[],
): (string | null)[] {
  if (!Array.isArray(value) || value.length === 0) {
    c.add(path, 'structure', 'a form is a list of the fields it asks for');
    return [];
  }
  if (!hasOperation) c.add(path, 'structure', 'a form gives values to an operation');
  if (on.includes('bulk'))
    c.add(path, 'structure', 'a bulk action runs on many records at once, so it has no form');
  const card = 'cards[0].fields';
  for (const finding of validateTaskForm(
    { version: 2, cards: [{ id: 'form', fields: value }] },
    { registries: c.registries },
  ))
    c.add(
      finding.path.startsWith(card) ? `${path}${finding.path.slice(card.length)}` : path,
      finding.kind,
      finding.message,
    );
  return value.map((entry, index) => {
    const field = isRecord(entry) ? entry['field'] : entry;
    const named = typeof field === 'string' ? FORM_FIELD.exec(field) : null;
    if (!named) {
      c.add(
        isRecord(entry) ? join(join(path, index), 'field') : join(path, index),
        'structure',
        `an action's form asks for values: each field is "var:<name>", a letter then letters, digits or "_"`,
      );
      return null;
    }
    return field as string;
  });
}

/** A confirmation or a success message: a text, or a key to look it up by. */
function message(c: Checker, value: unknown, path: string): void {
  if (!isRecord(value)) {
    c.add(path, 'structure', 'a message is { "label" } or { "labelKey" }');
    return;
  }
  c.unknownKeys(value, MESSAGE_KEYS, path);
  c.named(value, path);
}
