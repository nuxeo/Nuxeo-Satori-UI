/**
 * The validator of `actions.json` (docs/business-apps/app-definition-v2.md, section 5): lifecycle
 * buttons, and buttons that run an Automation operation with parameters.
 *
 * An operation must be on the deployment's allow-list (plan decision 3, still open), which the
 * caller passes in. With none, every operation is refused: a package cannot reach a server
 * operation that nobody allowed. Showing or hiding a button is never the control: Nuxeo's
 * permissions and the lifecycle still gate what runs.
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
import { isRecord, PACKAGED_REGISTRIES, type Registries } from './registries';

const FILE_KEYS = ['$schema', 'version', 'actions'];
const ACTION_KEYS = [
  'id',
  'label',
  'labelKey',
  'icon',
  'order',
  'on',
  'visibleWhen',
  'transition',
  'operation',
  'parameters',
  'confirm',
  'success',
  'refresh',
];
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
  if ('parameters' in item) {
    if (!hasOperation)
      c.add(join(path, 'parameters'), 'structure', 'parameters belong to an operation');
    else parameters(c, item['parameters'], join(path, 'parameters'), on);
  }
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

/** An operation's parameters, name to value. One record's fields cannot feed a bulk action. */
function parameters(c: Checker, value: unknown, path: string, on: readonly Placement[]): void {
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
    else c.value(item, at);
  }
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
