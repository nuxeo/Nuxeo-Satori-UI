import {
  compute,
  evaluateValue,
  runCheck,
  type ComputationContext,
} from '@agentic-ui/shared/computations';
import { isFieldReference } from '@agentic-ui/shared/app-definition';
import type {
  NxsEditorDisplay,
  NxsEditorField,
  NxsEditorSection,
} from '@nuxeo/satori-platform/components';

import type { LayoutFieldType, LayoutLabel } from '../layout.model';
import { humanize } from '../resolve-layout';
import { computedDefinition, type WidgetInput } from '../record-page/record-field-view';
import type { RecordRule } from '../record-page/record-layout';
import { widgetAccepts } from '../record-page/widget-support';
import type { FormCheck, FormComputedField } from './form-layout';
import type {
  ResolvedFormCard,
  ResolvedFormField,
  ResolvedFormLayout,
  ResolvedFormPropertyField,
} from './resolve-form-layout';

/**
 * A version 2 form as the metadata editor draws it, for the values being entered: which fields
 * show, which are required and which read-only, and which checks fail. Worked out again whenever
 * a value changes, since a rule sees the values being entered (layout-v2.md, section 5): a field
 * shown by another field's value appears as soon as that value is chosen.
 *
 * A function from the layout and what it reads to the editor's sections, so every rule and check
 * is tested without drawing a form.
 */

/** A task form's own variables, as a field writes them. */
const VARIABLE = 'var:';

/** What a form reads besides the layout. Every answer is at once, from what is loaded. */
export interface FormViewContext {
  /** A property's value now: what is being entered, else the document's. */
  readonly value: (xpath: string) => unknown;
  /** Whether a rule passes for the document as it is being entered, and the user. `null` passes. */
  readonly rule: (rule: RecordRule | null) => boolean;
  /** A label's text, translated. */
  readonly label: (label: LayoutLabel) => string | null;
  /** A value as one line of text, through `widget` as the record page shows it, or its schema type. */
  readonly valueText: (input: WidgetInput, widget: string | null) => string;
  /** A failed check's message in the form's own words, for a check the file gives no label. */
  readonly checkText: (type: string, label: string, bound: string) => string;
  readonly today: Date;
  /** Says something in the console, once. */
  readonly tell: (message: string) => void;
}

export interface FormView {
  readonly display: NxsEditorDisplay;
  readonly sections: readonly NxsEditorSection[];
  /** The message of each field's first failing check, by xpath. */
  readonly errors: Readonly<Record<string, string>>;
}

function fieldsOf(layout: ResolvedFormLayout): readonly ResolvedFormField[] {
  const cards = layout.tabs ? layout.tabs.flatMap((tab) => tab.cards) : layout.cards;
  return cards.flatMap((card) => card.fields);
}

/** The first field on the form editing `xpath`, whose widget shows it elsewhere: a placeholder, a bound. */
function fieldEditing(
  layout: ResolvedFormLayout,
  xpath: string,
): ResolvedFormPropertyField | undefined {
  return fieldsOf(layout).find(
    (field): field is ResolvedFormPropertyField =>
      field.kind === 'property' && field.xpath === xpath,
  );
}

/**
 * The widgets a form shows and never edits: a file is changed in Attachments. A `file-list` over a
 * `complex[]` property would otherwise be a list of entries anyone could add to or remove from.
 */
const SHOWN_ONLY: ReadonlySet<string> = new Set(['image', 'file', 'file-list']);

const isRule = (value: unknown): value is RecordRule =>
  typeof value === 'string' || (typeof value === 'object' && value !== null);

/** `currency`'s code, the literal or the one the property it names holds, to show beside its number. */
function currencyOf(field: ResolvedFormPropertyField, context: FormViewContext): string | null {
  if (field.widget !== 'currency') return null;
  const parameter = field.parameters['currency'];
  const code = isFieldReference(parameter) ? context.value(parameter.field) : parameter;
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : null;
}

/** The form for the values being entered. */
export function formView(layout: ResolvedFormLayout, context: FormViewContext): FormView {
  const source = `${layout.type}/${layout.kind} layout`;
  const errors: Record<string, string> = {};

  const display = (xpath: string): string => {
    const field = fieldEditing(layout, xpath);
    const definition = field?.definition ?? layout.properties.get(xpath) ?? { type: 'string' };
    return context.valueText(
      {
        key: xpath,
        label: xpath,
        value: context.value(xpath),
        parameters: field?.parameters ?? {},
        definition,
      },
      field?.widget ?? null,
    );
  };
  const computation: ComputationContext = {
    value: context.value,
    display,
    rule: (rule) => context.rule(rule as RecordRule),
    today: context.today,
  };

  /**
   * What a failed check says: its own label, else the form's words naming the field and its
   * bound. A bound that is another field is named by that field's label; a literal or a
   * computation's result is written as the field's own widget shows a value.
   */
  const message = (check: FormCheck, field: ResolvedFormPropertyField, label: string): string => {
    const own = context.label(check.label);
    if (own) return own;
    const [parameter] = check.parameters;
    if (isFieldReference(parameter)) {
      const other = fieldEditing(layout, parameter.field);
      const name = parameter.field.slice(parameter.field.indexOf(':') + 1);
      return context.checkText(
        check.type,
        label,
        (other && context.label(other.label)) ?? humanize(name),
      );
    }
    const result = evaluateValue(parameter, computation);
    const bound = result.ok
      ? context.valueText(
          {
            key: field.xpath,
            label,
            value: result.value,
            parameters: field.parameters,
            definition: field.definition,
          },
          field.widget,
        )
      : '';
    return context.checkText(check.type, label, bound);
  };

  const property = (field: ResolvedFormPropertyField): NxsEditorField => {
    const label = context.label(field.label) ?? field.xpath;
    // A task form edits only its step's variables: the record's own properties show read-only.
    const readOnly =
      (layout.kind === 'task' && !field.xpath.startsWith(VARIABLE)) ||
      (field.widget !== null && SHOWN_ONLY.has(field.widget)) ||
      (field.readOnlyWhen !== null && context.rule(field.readOnlyWhen));
    const required =
      !readOnly &&
      (field.definition.required === true ||
        field.required === true ||
        (isRule(field.required) && context.rule(field.required)));
    const directory =
      field.widget === 'vocabulary' && typeof field.parameters['directory'] === 'string'
        ? field.parameters['directory']
        : undefined;
    // Required by the schema, by the file, or by a rule that passes now; never while read-only.
    const definition: LayoutFieldType = {
      ...field.definition,
      ...(directory ? { directory } : {}),
      required: required || undefined,
    };
    const currency = currencyOf(field, context);
    const multiline = field.widget === 'long-text' || field.widget === 'rich-text';
    const rows = field.parameters['rows'];
    if (!readOnly) {
      for (const check of field.checks) {
        const result = runCheck(check, field.xpath, computation);
        if (!result.ok) {
          context.tell(`${source}: ${check.place} not checked: ${result.reason}`);
          continue;
        }
        if (result.value === false) errors[field.xpath] ??= message(check, field, label);
      }
    }
    return {
      xpath: field.xpath,
      label: currency ? `${label} (${currency})` : label,
      definition,
      ...(multiline ? { multiline: true } : {}),
      ...(multiline && typeof rows === 'number' ? { rows } : {}),
      ...(readOnly
        ? {
            readOnly: true,
            readOnlyText: context.valueText(
              {
                key: field.xpath,
                label,
                value: context.value(field.xpath),
                parameters: field.parameters,
                definition: field.definition,
              },
              field.widget,
            ),
          }
        : {}),
    };
  };

  /** A computed field shows its result read-only, or is left out when there is none to show. */
  const computed = (field: FormComputedField): NxsEditorField[] => {
    const label = context.label(field.label) ?? field.id;
    const result = compute(field.computed, computation);
    if (!result.ok) {
      context.tell(`${source}: ${field.place} left out: ${result.reason}`);
      return [];
    }
    const definition = computedDefinition(result.value, field.widget);
    if (
      field.widget !== null &&
      result.value !== null &&
      !widgetAccepts(field.widget, definition)
    ) {
      context.tell(
        `${source}: ${field.place} left out: the widget "${field.widget}" does not show a ${definition.type} result`,
      );
      return [];
    }
    return [
      {
        // An id has no colon, so it never names a property: nothing is read or sent under it.
        xpath: field.id,
        label,
        definition,
        readOnly: true,
        readOnlyText: context.valueText(
          { key: field.id, label, value: result.value, parameters: field.parameters, definition },
          field.widget,
        ),
      },
    ];
  };

  const fields = (card: ResolvedFormCard): NxsEditorField[] =>
    card.fields
      .filter((field) => context.rule(field.visibleWhen))
      .flatMap((field) => (field.kind === 'property' ? [property(field)] : computed(field)));

  if (layout.tabs) {
    // The editor draws one level of headings: in tabs, a tab is that level, and its cards' fields
    // follow one another in it.
    const sections = layout.tabs
      .filter((tab) => context.rule(tab.visibleWhen))
      .map((tab) => ({
        id: tab.id,
        heading: context.label(tab.label) ?? humanize(tab.id),
        fields: tab.cards.filter((card) => context.rule(card.visibleWhen)).flatMap(fields),
      }))
      .filter((section) => section.fields.length > 0);
    return { display: 'tabs', sections, errors };
  }
  const sections = layout.cards
    .filter((card) => context.rule(card.visibleWhen))
    .map((card) => ({ id: card.id, heading: context.label(card.label), fields: fields(card) }))
    .filter((section) => section.fields.length > 0);
  return { display: 'sections', sections, errors };
}
