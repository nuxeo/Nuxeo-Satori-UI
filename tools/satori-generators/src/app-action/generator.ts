import { formatFiles, type Tree } from '@nx/devkit';

import {
  addLabels,
  appContributionSaid,
  contributeApp,
  humanize,
  ID,
  isRecord,
  listOption,
  parseJson,
  readAppPackage,
  schemaFor,
  writeJson,
} from '../app-package/package-files';

export interface AppActionSchema {
  package: string;
  id: string;
  label?: string;
  transition?: string;
  operation?: string;
  parameters?: string;
  on?: string | string[];
  type?: string;
  icon?: string;
  confirm?: string;
  success?: string;
  queue?: string;
  force?: boolean;
}

const PLACEMENTS = ['record', 'row', 'bulk'];
/** A lifecycle transition's name, or an Automation operation's or chain's id. */
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
/** A Material Symbols name, such as `check` or `outgoing_mail`. */
const ICON = /^[a-z0-9_]{1,64}$/;
const TYPE = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
/** An operation parameter's name, as `actions.json` writes one. */
const PARAMETER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * Add an action to the package's `actions.json` (docs/business-apps/app-definition-v2.md,
 * section 5): a lifecycle transition, or an Automation operation, shown on the record page, a
 * queue's rows or a queue's selection. Its text, and its question and message when given, are label
 * keys, with their English text added to `labels/en.json`.
 *
 * - **A transition** shows only when the record's lifecycle allows it. Read the lifecycle's
 *   transitions on the server first.
 * - **An operation** must be on the deployment's allow-list (decision 3): the pipeline refuses every
 *   operation unless it is given one with `--allow-list`. Read its parameters with the Builder MCP
 *   server's `describe_operation`.
 * - **`--queue`** adds it to a queue's `rowActions` when it shows on rows, and `bulkActions` when
 *   in bulk, so that the queue offers it.
 *
 * Hiding a button is not a security control: Nuxeo's permissions and the lifecycle still gate every
 * operation and transition.
 */
export default async function appActionGenerator(tree: Tree, options: AppActionSchema) {
  const pkg = readAppPackage(tree, options.package);
  const id = options.id ?? '';
  if (!ID.test(id)) {
    throw new Error(`--id "${id}" must be 1 to 64 letters, digits, ".", "_" or "-".`);
  }
  if (/^(app|core)\./.test(id)) {
    throw new Error(
      `--id "${id}" starts with "${id.split('.')[0]}.", which is the platform's: a package cannot rebind an action registered in code. Begin it with the app's id, such as ${pkg.appId}.approve.`,
    );
  }
  if ((options.transition === undefined) === (options.operation === undefined)) {
    throw new Error('An action is one of --transition <name> and --operation <id>.');
  }
  const runs = (options.transition ?? options.operation) as string;
  if (!NAME.test(runs)) throw new Error(`"${runs}" is not a transition's or an operation's name.`);
  let parameters: Record<string, unknown> | undefined;
  if (options.parameters !== undefined) {
    if (options.transition !== undefined) {
      throw new Error('--parameters belong to an operation; a transition takes none.');
    }
    const parsed = parseJson(options.parameters, '--parameters');
    if (!isRecord(parsed)) {
      throw new Error("--parameters is a JSON object, each parameter's name to its value.");
    }
    const badName = Object.keys(parsed).find((name) => !PARAMETER.test(name));
    if (badName !== undefined) {
      throw new Error(
        `--parameters: "${badName}" is not a parameter name: a letter, then letters, digits or "_".`,
      );
    }
    parameters = parsed;
  }
  const file = `${pkg.config}/actions.json`;
  const text = tree.read(file, 'utf-8');
  const current =
    text === null
      ? { $schema: schemaFor(file, 'actions.schema.json'), version: 2, actions: [] }
      : parseJson(text, file);
  if (!isRecord(current) || !Array.isArray(current['actions'])) {
    throw new Error(`${file} has no "actions" list to add to.`);
  }
  const actions = current['actions'] as unknown[];
  const at = actions.findIndex((action) => isRecord(action) && action['id'] === id);
  if (at >= 0 && !options.force) {
    throw new Error(`${file} already has the action ${id}. Pass --force to write it again.`);
  }

  // Written again, the action keeps what this generator does not write, as a queue does: its
  // order, refresh, label, rule and icon, and where it shows unless --on says again.
  const previous: Record<string, unknown> =
    at >= 0 && isRecord(actions[at]) ? (actions[at] as Record<string, unknown>) : {};

  const on = listOption(options.on);
  const badPlacement = on.find((placement) => !PLACEMENTS.includes(placement));
  if (badPlacement !== undefined) {
    throw new Error(`--on "${badPlacement}" is not one of ${PLACEMENTS.join(', ')}.`);
  }
  const placements =
    on.length > 0
      ? [...new Set(on)]
      : Array.isArray(previous['on'])
        ? (previous['on'] as unknown[]).filter((item): item is string => typeof item === 'string')
        : ['record'];
  // The parameters it will have: those given, else an operation's own, kept.
  const effective =
    parameters ??
    (options.operation !== undefined && isRecord(previous['parameters'])
      ? previous['parameters']
      : undefined);
  // A bulk action runs on many records at once, so no one record's field can give it a value: each
  // parameter is a text, a number or a boolean, as the validator's `isLiteral` says.
  const notLiteral = Object.entries(effective ?? {}).find(
    ([, value]) => !['string', 'number', 'boolean'].includes(typeof value),
  );
  if (placements.includes('bulk') && notLiteral !== undefined) {
    throw new Error(
      `--parameters: "${notLiteral[0]}" is not a literal, and a bulk action runs on many records at once, so its parameters are literals: texts, numbers or booleans.`,
    );
  }
  if (options.type !== undefined) {
    if (!TYPE.test(options.type))
      throw new Error(`--type "${options.type}" is not a document type's name.`);
    // `app.rules.isType` reads the one record a button is for, and a selection has none, so in
    // bulk the rule would hide it (app-definition-v2.md, section 13, "Rules where there is no one
    // record").
    if (placements.includes('bulk')) {
      throw new Error(
        '--type gates the action with app.rules.isType, which reads one record; a bulk action has none, so the rule would hide it there. Leave --type out, or "bulk" out of --on.',
      );
    }
  }
  if (options.icon !== undefined && !ICON.test(options.icon)) {
    throw new Error(`--icon "${options.icon}" is not a Material Symbols name, such as check.`);
  }

  let queueFile: string | undefined;
  let queue: Record<string, unknown> | undefined;
  if (options.queue !== undefined) {
    if (!placements.includes('row') && !placements.includes('bulk')) {
      throw new Error(
        '--queue offers the action on a queue, so --on must include "row" or "bulk".',
      );
    }
    queueFile = `${pkg.config}/queues/${options.queue}.json`;
    const queueText = ID.test(options.queue) ? tree.read(queueFile, 'utf-8') : null;
    if (queueText === null) {
      throw new Error(`The package has no queue "${options.queue}": ${queueFile} does not exist.`);
    }
    const parsed = parseJson(queueText, queueFile);
    if (!isRecord(parsed)) throw new Error(`${queueFile} is not a queue.`);
    queue = parsed;
  }

  const name = id.startsWith(`${pkg.appId}.`) ? id.slice(pkg.appId.length + 1) : id;
  const labelKey = `${pkg.appId}.action.${name}`;
  const labels: Record<string, string> = {
    [labelKey]: options.label?.trim() || humanize(name.split('.').pop() as string),
  };
  if (options.confirm?.trim()) labels[`${labelKey}.confirm`] = options.confirm.trim();
  if (options.success?.trim()) labels[`${labelKey}.done`] = options.success.trim();
  // No key of this action may be another's: `approve` and `<app>.approve` would share one, and so
  // would `approve.confirm` and the question of `approve`. A button would show the other's text.
  const keysOf = (action: Record<string, unknown>): string[] =>
    [
      action['labelKey'],
      ...['confirm', 'success'].map((key) => {
        const message = action[key];
        return isRecord(message) ? message['labelKey'] : undefined;
      }),
    ].filter((key): key is string => typeof key === 'string');
  const mine = Object.keys(labels);
  for (const other of actions) {
    if (!isRecord(other) || other['id'] === id) continue;
    const shared = keysOf(other).find((key) => mine.includes(key));
    if (shared !== undefined) {
      throw new Error(
        `The action ${String(other['id'])} has the label key ${shared} already, which ${id} would share. Give ${id} another id.`,
      );
    }
  }

  const base: Record<string, unknown> = { ...previous };
  delete base['transition'];
  delete base['operation'];
  if (options.transition !== undefined) delete base['parameters'];
  const action = {
    ...base,
    id,
    labelKey,
    ...(options.icon ? { icon: options.icon } : {}),
    ...(on.length > 0 ? { on: placements } : {}),
    ...(options.type
      ? { visibleWhen: { type: 'app.rules.isType', parameters: [options.type] } }
      : {}),
    ...(options.transition !== undefined
      ? { transition: options.transition }
      : { operation: options.operation }),
    ...(parameters ? { parameters } : {}),
    ...(labels[`${labelKey}.confirm`] ? { confirm: { labelKey: `${labelKey}.confirm` } } : {}),
    ...(labels[`${labelKey}.done`] ? { success: { labelKey: `${labelKey}.done` } } : {}),
  };
  if (at >= 0) actions[at] = action;
  else actions.push(action);
  writeJson(tree, file, current);

  const lists = [
    ['row', 'rowActions'],
    ['bulk', 'bulkActions'],
  ] as const;
  if (queue && queueFile) {
    for (const [placement, key] of lists) {
      if (!placements.includes(placement)) continue;
      const list = Array.isArray(queue[key]) ? (queue[key] as unknown[]) : [];
      if (!list.includes(id)) list.push(id);
      queue[key] = list;
    }
    writeJson(tree, queueFile, queue);
  }
  // Written again with fewer places, the action leaves the queues that offered it there: a queue
  // naming a row action that no longer shows on rows is refused by the pipeline.
  const pruned: string[] = [];
  if (at >= 0) {
    for (const entry of tree.children(`${pkg.config}/queues`).filter((f) => f.endsWith('.json'))) {
      const path = `${pkg.config}/queues/${entry}`;
      const other = parseJson(tree.read(path, 'utf-8') ?? '', path);
      if (!isRecord(other)) continue;
      let changed = false;
      for (const [placement, key] of lists) {
        if (placements.includes(placement) || !Array.isArray(other[key])) continue;
        const kept = (other[key] as unknown[]).filter((item) => item !== id);
        if (kept.length === (other[key] as unknown[]).length) continue;
        changed = true;
        if (kept.length > 0) other[key] = kept;
        else delete other[key];
      }
      if (changed) {
        writeJson(tree, path, other);
        pruned.push(path);
      }
    }
  }
  const kept = addLabels(tree, pkg, labels);
  // actions.json is a file the app registry serves: named, when the component contributes the app.
  const app = contributeApp(tree, pkg, { create: false });

  await formatFiles(tree);

  return () => {
    console.log(`
Added ${id} to ${file}

  ${options.transition !== undefined ? `Transition: ${options.transition}` : `Operation:  ${options.operation}`}
  Shows on:   ${placements.join(', ')}${queueFile ? `, offered by ${queueFile}` : ''}
${pruned.length > 0 ? `  No longer offered by ${pruned.join(', ')}\n` : ''}${kept.length > 0 ? `  Kept the text labels/en.json already had for ${kept.join(', ')}\n` : ''}${appContributionSaid(pkg, app)}${
      options.operation !== undefined
        ? `
${options.operation} must be on the deployment's allow-list: the pipeline refuses every operation
it is not given one for. Check it with:

  npm run app-package -- ${pkg.root} --platform <platform version> --allow-list <allow-list.json>
`
        : `
Check it with:

  npm run app-package -- ${pkg.root} --platform <platform version>
`
    }`);
  };
}
