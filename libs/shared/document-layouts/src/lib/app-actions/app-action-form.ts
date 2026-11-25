/**
 * An action's form, as the version 2 form engine draws it: the action's `form` read as a task form
 * of one card, whose `var:` fields are what the person enters (docs/business-apps/app-definition-v2.md,
 * section 5). `lib-document-layout-form` draws it in its `task` mode, given it as a preview, so its
 * widgets, rules and checks are a task form's, and `taskVariables()` gives what was entered.
 *
 * A task's variables have a type from their step's schema; an action's fields have none, so each
 * takes the one its widget shows, below. A widget with no such type, such as an address or a table,
 * cannot ask for one value, and the form is refused rather than drawn without it: a form missing a
 * field would run the operation without its value. The server holds every value to the type its
 * allow-list gives the parameter anyway.
 */
import type { LayoutFieldType } from '../layout.model';
import { readFormLayout, type FormLayoutFile } from '../form-layout/form-layout';
import { resolveFormLayout, type ResolvedFormLayout } from '../form-layout/resolve-form-layout';

/** The type of value each widget an action's form may use asks for. */
const WIDGET_TYPES: Readonly<Record<string, string>> = {
  text: 'string',
  'long-text': 'string',
  phone: 'string',
  email: 'string',
  vocabulary: 'string',
  user: 'string',
  group: 'string',
  'document-link': 'string',
  number: 'long',
  currency: 'double',
  percent: 'double',
  date: 'date',
  boolean: 'boolean',
};

export type AppActionForm =
  | { readonly form: ResolvedFormLayout; readonly problems: readonly string[] }
  | { readonly refused: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A field's value type, from its widget and, for a number with decimals, its parameters. */
function variableType(entry: unknown): LayoutFieldType | string {
  const field = isRecord(entry) ? entry : { field: entry };
  const widget = typeof field['widget'] === 'string' ? field['widget'] : 'text';
  const parameters = isRecord(field['parameters']) ? field['parameters'] : {};
  const type = WIDGET_TYPES[widget];
  if (!type)
    return `the widget "${widget}" asks for more than one value, which an action's form cannot send`;
  if (
    widget === 'number' &&
    typeof parameters['decimals'] === 'number' &&
    parameters['decimals'] > 0
  )
    return { type: 'double' };
  if (widget === 'vocabulary' && typeof parameters['directory'] === 'string')
    return { type, directory: parameters['directory'] };
  return { type };
}

/**
 * The form `fields` draws for a record of `type`, or why it cannot be drawn. `rules` are those this
 * build registers, as for any form.
 */
export function appActionForm(
  fields: readonly unknown[],
  type: string,
  rules: readonly string[],
): AppActionForm {
  const read = readFormLayout({ version: 2, cards: [{ id: 'form', fields }] }, 'task', { rules });
  if ('invalid' in read) return { refused: read.invalid };
  const variables = new Map<string, LayoutFieldType>();
  for (const entry of fields) {
    const name = isRecord(entry) ? entry['field'] : entry;
    if (typeof name !== 'string') continue;
    const typed = variableType(entry);
    if (typeof typed === 'string') return { refused: `${name}: ${typed}` };
    variables.set(name, typed);
  }
  const file: FormLayoutFile = read;
  const { layout, skipped } = resolveFormLayout({ name: type, schemas: [] }, file, [], variables);
  // Every field drawn, or none: one the reader or the resolver left out would let the operation run
  // without its value.
  const drawn = layout.cards.reduce((count, card) => count + card.fields.length, 0);
  if (drawn !== fields.length) {
    const why = [...read.problems, ...skipped.map((field) => `${field.xpath}: ${field.reason}`)];
    return {
      refused: `${fields.length - drawn} of its ${fields.length} fields cannot be drawn, and the operation would run without them${why.length > 0 ? `: ${why.join('; ')}` : ''}`,
    };
  }
  return { form: layout, problems: read.problems };
}
