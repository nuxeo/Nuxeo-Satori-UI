/**
 * M2's task forms (docs/business-apps/studio-migration.md, section 3): a workflow task layout of
 * Web UI becomes the task form of its step, `tasks/<workflow>.<step>.layout.json`
 * (app-definition-v2.md, section 6), which the app draws in the task panel in place of its own form.
 *
 * - **Its name.** Web UI loads a step's layout from `ui/workflow/<workflow>/nuxeo-<step>-layout.html`,
 *   both names in lower case (`nuxeo-document-task.js`, `_updateTaskLayout`); the app reads the file
 *   named by the task's `workflowModelName` and `nodeName` as they are. Their case comes from the
 *   package: the variables schemas Nuxeo names after a workflow and a step, `var_<workflow>` and
 *   `var_<step>`, and the workflows it imports (`routeModelImporter`). A name the package does not
 *   give is reported, never guessed.
 * - **Its fields.** A field bound to `task.variables.<name>` becomes `var:<name>`, with its widget,
 *   label and required flag, as an edit form's field is. One bound to the document shows nothing in
 *   Web UI, which gives a task layout the task's first target by its id alone, so it is reported, and
 *   so is a layout block, which shows the document's properties.
 * - **Its buttons** are the step's own, from the workflow on the server: Web UI's task page and the
 *   app's task panel both draw `taskInfo.taskActions`, so a task form has none to write.
 */
import type { ConvertContext } from './convert';
import { layoutCards } from './blocks';
import { blockUseId, planFields, writeCards, type PlanOptions } from './convert-layouts';
import type { Inventory, TaskLayout } from './inventory';
import { packageModel } from './model';
import type { StudioPackage } from './studio-package';

/** A task form's name, `<workflow>.<step>`: each part as the validator takes it. */
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

export const TASK_OPTIONS: PlanOptions = { mode: 'task', version: 2, form: true, task: true };

/** Where a task layout's form goes, with the names it is for, or why that cannot be told. */
export type TaskFormPlace =
  | { readonly path: string; readonly workflow: string; readonly step: string }
  | { readonly problem: string };

/**
 * The file each task layout of the package becomes, by its names as the package gives their case.
 * The first layout to a file keeps it. Shared with the checks, which find each form by it.
 */
export function taskFormPlaces(
  pkg: StudioPackage,
  inventory: Inventory,
): Map<TaskLayout, TaskFormPlace> {
  const model = packageModel(pkg, inventory);
  const variables = [...model.schemas.values()]
    .map((schema) => schema.name)
    .filter((name) => name.startsWith('var_'))
    .map((name) => name.slice('var_'.length));
  const places = new Map<TaskLayout, TaskFormPlace>();
  const taken = new Set<string>();
  const named = (lower: string, candidates: readonly string[]): string | string[] | null => {
    const found = [...new Set(candidates.filter((name) => name.toLowerCase() === lower))];
    return found.length === 1 ? found[0] : found.length > 1 ? found : null;
  };
  for (const task of inventory.taskLayouts) {
    const workflow = named(task.workflow, [...variables, ...model.workflows]);
    const step = named(task.step, variables);
    const problem =
      workflow === null
        ? `the package names no workflow ${task.workflow}, by a variables schema var_<workflow> or a workflow it imports, whose name gives its case`
        : step === null
          ? `the package names no step ${task.step}, by its variables schema var_<step>, whose name gives its case`
          : Array.isArray(workflow)
            ? `the package names its workflow ${workflow.join(' and ')}, which differ in case only`
            : Array.isArray(step)
              ? `the package names its step ${step.join(' and ')}, which differ in case only`
              : !NAME.test(workflow) || !NAME.test(step)
                ? `${workflow}.${step} is not a task form's name: letters, digits, "_" and "-", from a letter`
                : null;
    if (problem !== null || typeof workflow !== 'string' || typeof step !== 'string') {
      places.set(task, {
        problem: `Web UI finds it by its workflow's and step's names in lower case, ${task.workflow} and ${task.step}, and the app by them as the server writes them; ${problem}: a person names its file`,
      });
      continue;
    }
    const path = `tasks/${workflow}.${step}.layout.json`;
    if (taken.has(path)) {
      places.set(task, { problem: `Another task layout of the package is already ${path}` });
      continue;
    }
    taken.add(path);
    places.set(task, { path, workflow, step });
  }
  return places;
}

/** A task layout as the planning reads it. */
export function taskSource(task: TaskLayout) {
  return { path: task.path, fields: task.fields, fieldKind: 'task-field' as const };
}

export function convertTasks(context: ConvertContext): void {
  const places = taskFormPlaces(context.pkg, context.inventory);
  for (const task of context.inventory.taskLayouts) {
    const id = `task-layout:${task.path}#layout`;
    const place = places.get(task);
    if (!place || 'problem' in place) {
      const note = place && 'problem' in place ? place.problem : 'The conversion did not reach it';
      context.decide(id, { outcome: 'reported', note });
      const { cards, fields } = layoutCards(context.inventory, taskSource(task));
      for (const field of fields)
        context.decide(field.id, { outcome: 'reported', note: 'Its task layout is reported' });
      for (const card of cards)
        if (card.use)
          context.decide(blockUseId(card.use), {
            outcome: 'reported',
            note: 'Its task layout is reported',
          });
      continue;
    }
    const { cards } = writeCards(
      context,
      place.path,
      'cards',
      planFields(context, taskSource(task), TASK_OPTIONS),
    );
    // Written even with no field: Web UI's layout then shows none, where with no file the app
    // would show its own form of the step's variables.
    context.files[place.path] = { version: 2, cards };
    context.decide(id, {
      outcome: 'converted',
      to: `${place.path}, with the step's own buttons, which the workflow on the server gives the task panel (app-definition-v2.md, section 6)`,
    });
  }
}
