/**
 * M1's conversion of document layouts: each Web UI layout becomes the layout file of its type and
 * mode (docs/business-apps/studio-migration.md, section 3).
 *
 * - **`view`** is written in layout version 2, the record page's main area.
 * - **`metadata`, `edit` and `create`** are written in version 1: the app still refuses version 2
 *   in those modes and shows the generated layout instead (layout-v2.md, section 11), so a version
 *   2 file there would lose every field. Version 1 cannot name a widget: the schema type picks it.
 * - **`import`** has no place: the app's import step reads no layout.
 *
 * A field is written once, with its label and, in a form, its required flag. What cannot be
 * written as Web UI shows it is reported, with why, and never copied as if it could.
 */
import type { ConvertContext } from './convert';
import type { DocumentLayout, LayoutField } from './inventory';
import { LAYOUT_VERSION, labelOf, layoutPath } from './app-files';
import { VERSION_ONE_WIDGETS, fieldWidget } from './widgets';

/** The document types a layout path may name: as the configuration service accepts them. */
const TYPE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

/**
 * The rows the Properties panel always shows above a metadata layout (extension-reference.md,
 * section 9b). A metadata file that listed them would show them twice.
 */
export const PANEL_ROWS: ReadonlySet<string> = new Set([
  'dc:title',
  'dc:description',
  'dc:nature',
  'dc:subjects',
  'dc:coverage',
]);

/** How one field of a layout is decided, before anything is written. */
export type FieldPlan =
  | {
      readonly kind: 'write';
      readonly entry: unknown;
      readonly binding: string;
      /** The widget the file names; `null` when the schema type picks it. */
      readonly widget: string | null;
      readonly required: boolean;
      /** Set when it is written but cannot show as Web UI does: it is then reported, with this. */
      readonly reported?: string;
    }
  | { readonly kind: 'panel'; readonly binding: string }
  | { readonly kind: 'preview' }
  | { readonly kind: 'skip'; readonly outcome: 'reported' | 'pending'; readonly note: string };

/**
 * What to do with each field of a layout, in order. Shared with harness check 2, which expects
 * the fields planned for writing, and only those, in the converted file.
 */
export function planFields(
  context: Pick<ConvertContext, 'catalogue'>,
  layout: DocumentLayout,
): FieldPlan[] {
  const mode = layout.mode;
  const version = LAYOUT_VERSION[mode];
  const seen = new Set<string>();
  return layout.fields.map((field): FieldPlan => {
    if (field.element === 'nuxeo-document-viewer') return { kind: 'preview' };
    const binding = field.binding;
    if (binding === null || !binding.includes(':'))
      return { kind: 'skip', outcome: 'reported', note: 'It binds no property of the document' };
    if (seen.has(binding))
      return {
        kind: 'skip',
        outcome: 'reported',
        note: `It binds ${binding} again, and is kept once`,
      };
    seen.add(binding);
    if (field.condition !== null)
      return {
        kind: 'skip',
        outcome: 'pending',
        note: `It shows only while condition ${field.condition + 1} of its file passes. M2 converts the condition, with truth tables, so it is not shown to everyone meanwhile`,
      };
    const choice = fieldWidget(context.catalogue, field.element, field.attributes);
    if (choice === null)
      return {
        kind: 'skip',
        outcome: 'reported',
        note: `${field.element} is not a field element the catalogue knows`,
      };
    if (mode === 'metadata' && PANEL_ROWS.has(binding)) return { kind: 'panel', binding };
    const required = (mode === 'edit' || mode === 'create') && field.required;
    const entry = version === 2 ? viewField(field, choice) : formField(field, required);
    // Written all the same, so that its value stays in the panel or the form, shown as its type
    // picks; reported, because that is not how Web UI shows it.
    const reported =
      version === 1 && choice.widget !== null && !VERSION_ONE_WIDGETS.has(choice.widget)
        ? `Written to show as its schema type picks: version 1 cannot name the ${choice.widget} widget, and the app does not draw version 2 in ${mode} mode yet (layout-v2.md, section 11)`
        : undefined;
    return {
      kind: 'write',
      entry,
      binding,
      widget: version === 2 ? choice.widget : null,
      required,
      ...(reported ? { reported } : {}),
    };
  });
}

function viewField(field: LayoutField, choice: ReturnType<typeof fieldWidget> & object): unknown {
  const label = labelOf(field.label);
  if (choice.widget === null && Object.keys(label).length === 0) return field.binding;
  return {
    field: field.binding,
    ...label,
    ...(choice.widget !== null ? { widget: choice.widget } : {}),
    ...(choice.parameters ? { parameters: choice.parameters } : {}),
  };
}

function formField(field: LayoutField, required: boolean): unknown {
  const label = labelOf(field.label);
  if (!required && Object.keys(label).length === 0) return field.binding;
  return { field: field.binding, ...label, ...(required ? { required: true } : {}) };
}

export function convertLayouts(context: ConvertContext): void {
  const written = new Set<string>();
  for (const layout of context.inventory.layouts) {
    const layoutId = `layout:${layout.path}#layout`;
    const fieldId = (index: number): string => `layout-field:${layout.path}#${index + 1}`;
    const reportAll = (note: string, fieldNote: string): void => {
      context.decide(layoutId, { outcome: 'reported', note });
      layout.fields.forEach((_, index) =>
        context.decide(fieldId(index), { outcome: 'reported', note: fieldNote }),
      );
    };
    const type = layout.docType;
    if (type === null || !TYPE_NAME.test(type)) {
      reportAll(
        'It names no document type, through a @doctype annotation, that a layout file can be named after',
        'Its layout names no document type',
      );
      continue;
    }
    if (!Object.hasOwn(LAYOUT_VERSION, layout.mode)) {
      reportAll(
        layout.mode === 'import'
          ? 'The app has no import form: its import step reads no layout (extension-reference.md, section 9b).'
          : `The app has no ${layout.mode || 'unnamed'} mode`,
        `Its layout, in ${layout.mode || 'no'} mode, is reported`,
      );
      continue;
    }
    const path = layoutPath(type, layout.mode);
    if (written.has(path)) {
      reportAll(
        `Another layout of ${type} in ${layout.mode} mode comes first`,
        'Its layout is reported',
      );
      continue;
    }
    written.add(path);

    const plans = planFields(context, layout);
    const fields: unknown[] = [];
    plans.forEach((plan, index) => {
      const id = fieldId(index);
      if (plan.kind === 'preview') {
        context.decide(id, {
          outcome: 'converted',
          to: "the app's own preview of the record's file: not a field (layout-v2.md, section 10)",
        });
      } else if (plan.kind === 'panel') {
        context.decide(id, {
          outcome: 'converted',
          to: `the Properties panel's own row for ${plan.binding}, which the panel always shows`,
        });
      } else if (plan.kind === 'write') {
        fields.push(plan.entry);
        context.decide(
          id,
          plan.reported
            ? { outcome: 'reported', to: path, note: plan.reported }
            : { outcome: 'converted', to: path },
        );
      } else {
        context.decide(id, { outcome: plan.outcome, note: plan.note });
      }
    });

    const version = LAYOUT_VERSION[layout.mode];
    if (version === 2) {
      if (fields.length === 0) {
        // A record page with nothing on it would show less than the document page does.
        context.decide(layoutId, {
          outcome: 'converted',
          to: "no file: the app's document page, which shows the record's preview, as this layout does",
        });
        continue;
      }
      context.files[path] = { version: 2, cards: [{ id: 'fields', fields }] };
    } else {
      // An empty list of sections shows nothing beyond what the panel or form always shows, as a
      // Web UI layout that lists only those does. No file would show every schema of the type.
      context.files[path] = {
        version: 1,
        sections: fields.length === 0 ? [] : [{ id: 'fields', fields }],
      };
    }
    context.decide(layoutId, { outcome: 'converted', to: path });
  }
}
