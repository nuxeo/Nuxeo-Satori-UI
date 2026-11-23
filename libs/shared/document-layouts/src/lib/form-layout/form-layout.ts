import {
  PACKAGED_REGISTRIES,
  loadable,
  validateLayoutV2,
  validateTaskForm,
  withRegistered,
} from '@agentic-ui/shared/app-definition';

import type { Invalid } from '../layout-file';
import type { LayoutLabel } from '../layout.model';
import { fieldLabelKey, humanize } from '../resolve-layout';
import {
  describe,
  entryOf,
  labelOf,
  refusedRule,
  refusedRuleInComputation,
  type RecordRule,
} from '../record-page/record-layout';

/**
 * Layout file version 2 in the `edit` and `create` modes, and a task form, as the app loads them:
 * the cards of a form, each field with its widget as its input, required or read-only by rule,
 * and with its checks across fields (docs/business-apps/layout-v2.md, sections 2, 5 and 6, and
 * app-definition-v2.md, section 6).
 *
 * Tolerant, as the record page's reader is (section 8). A structural error refuses the whole file,
 * and the form is then the generated one. A tab, card or field that names something this build
 * does not have, a widget, a computation, a rule or a check, or that gives one parameters it
 * cannot take, is left out, the console says why, and the rest of the form still shows. So is one
 * whose rule this build cannot answer as written: a field required by a rule nobody registered
 * would otherwise be required, or not, by accident.
 *
 * Nothing in a form is a security control. A field the file hides or makes read-only is still
 * readable, and writable, through the API by anyone the server lets: its permissions decide.
 */

/** What a form is for: a document's edit or create form, or a workflow step's task form. */
export type FormLayoutKind = 'edit' | 'create' | 'task';

/** A check across fields, as written: evaluated by `runCheck` from `@agentic-ui/shared/computations`. */
export interface FormCheck {
  readonly place: string;
  readonly type: string;
  readonly parameters: readonly unknown[];
  /** What the form says when it fails; `fallback` is `null`, so the form says it in its own words. */
  readonly label: LayoutLabel;
}

interface FormFieldBase {
  /** Where the entry is in the file, as `cards[0].fields[2]`, for the console. */
  readonly place: string;
  readonly label: LayoutLabel;
  /** A registered widget, or `null` for the input the property's schema type picks. */
  readonly widget: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly visibleWhen: RecordRule | null;
}

/** A field that edits one property, or, in a task form, one of the step's variables. */
export interface FormPropertyField extends FormFieldBase {
  readonly kind: 'property';
  /** `<prefix>:<name>`, or `var:<name>` in a task form. */
  readonly xpath: string;
  /** `true`, `false`, or a rule that makes the field required while it passes. */
  readonly required: boolean | RecordRule;
  /** A rule that makes the field read-only while it passes. */
  readonly readOnlyWhen: RecordRule | null;
  readonly checks: readonly FormCheck[];
}

/** A field showing what a registered computation works out. Never editable. */
export interface FormComputedField extends FormFieldBase {
  readonly kind: 'computed';
  readonly id: string;
  /** `{ "type", "parameters" }`, as written. */
  readonly computed: unknown;
}

export type FormFieldEntry = FormPropertyField | FormComputedField;

export interface FormCardEntry {
  readonly id: string;
  readonly place: string;
  /** Its heading; `fallback` is `null`, so a card with no label shows none. */
  readonly label: LayoutLabel;
  readonly visibleWhen: RecordRule | null;
  readonly fields: readonly FormFieldEntry[];
}

export interface FormTabEntry {
  readonly id: string;
  readonly place: string;
  readonly label: LayoutLabel;
  readonly visibleWhen: RecordRule | null;
  readonly cards: readonly FormCardEntry[];
}

/** A version 2 form file that the app can show, with what it left out of it. */
export interface FormLayoutFile {
  readonly version: 2;
  readonly kind: FormLayoutKind;
  /** The tabs, or `null` when the file lists its cards directly. */
  readonly tabs: readonly FormTabEntry[] | null;
  /** The cards of a file without tabs; empty when it has tabs. */
  readonly cards: readonly FormCardEntry[];
  readonly problems: readonly string[];
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const rules = (value: unknown): RecordRule | null =>
  value === undefined ? null : (value as RecordRule);

/** The values a check's parameters are: a `{ "computed" }` among them may take a rule. */
function checksOf(entry: Json): readonly Json[] {
  return Array.isArray(entry['checks']) ? entry['checks'].filter(isRecord) : [];
}

/**
 * Read a version 2 form file: an `edit` or `create` layout, or a task form. `registered` are the
 * rules this build registers, which decide the rules the file may name, as for the record page
 * (`readRecordLayout`).
 */
export function readFormLayout(
  content: Json,
  kind: FormLayoutKind,
  registered: { readonly rules: readonly string[] },
): FormLayoutFile | Invalid {
  const known = new Set(registered.rules);
  const isRuleKnown = (id: string): boolean => known.has(id);
  const registries = withRegistered(PACKAGED_REGISTRIES, { rules: registered.rules });
  const findings =
    kind === 'task'
      ? validateTaskForm(content, { registries })
      : validateLayoutV2(content, { mode: kind, registries });
  if (!loadable(findings)) {
    const structural = findings.filter((finding) => finding.kind === 'structure');
    const more = structural.length > 1 ? ` (and ${structural.length - 1} more)` : '';
    return { invalid: `${describe(structural[0])}${more}` };
  }

  const problems: string[] = [];
  const leftOut = new Set<string>();
  for (const finding of findings) {
    const entry = entryOf(finding.path);
    if (entry) leftOut.add(entry);
    problems.push(`${describe(finding)}; ${entry ? `${entry} left out` : 'ignored'}`);
  }

  /**
   * Whether the entry at `place` shows: neither a finding nor a rule the form could not answer
   * leaves it out. A field's rules are its `visibleWhen`, its `required` and `readOnlyWhen` when
   * they are rules, and those its computation or a check's computed parameter take.
   */
  const kept = (place: string, entry: Json): boolean => {
    if (leftOut.has(place)) return false;
    const required = entry['required'];
    const refused =
      refusedRule(entry['visibleWhen'], isRuleKnown) ??
      (typeof required === 'boolean' ? null : refusedRule(required, isRuleKnown)) ??
      refusedRule(entry['readOnlyWhen'], isRuleKnown) ??
      refusedRuleInComputation(entry['computed'], isRuleKnown) ??
      checksOf(entry)
        .flatMap((check) => (Array.isArray(check['parameters']) ? check['parameters'] : []))
        .map((parameter: unknown) =>
          isRecord(parameter) && 'computed' in parameter
            ? refusedRuleInComputation(parameter['computed'], isRuleKnown)
            : null,
        )
        .find((reason) => reason !== null) ??
      null;
    if (refused) {
      problems.push(`${place} ${refused}; left out`);
      return false;
    }
    return true;
  };

  const field = (entry: unknown, place: string): FormFieldEntry[] => {
    if (!kept(place, isRecord(entry) ? entry : {})) return [];
    if (typeof entry === 'string') {
      const name = entry.slice(entry.indexOf(':') + 1);
      return [
        {
          kind: 'property',
          place,
          xpath: entry,
          label: { keys: [fieldLabelKey(entry)], fallback: humanize(name) },
          widget: null,
          parameters: {},
          visibleWhen: null,
          required: false,
          readOnlyWhen: null,
          checks: [],
        },
      ];
    }
    if (!isRecord(entry)) return [];
    const common = {
      place,
      widget: text(entry['widget']) ?? null,
      parameters: isRecord(entry['parameters']) ? entry['parameters'] : {},
      visibleWhen: rules(entry['visibleWhen']),
    };
    if (typeof entry['field'] === 'string') {
      const xpath = entry['field'];
      const name = xpath.slice(xpath.indexOf(':') + 1);
      const required = entry['required'];
      return [
        {
          kind: 'property',
          xpath,
          label: labelOf(entry, [fieldLabelKey(xpath)], humanize(name)),
          ...common,
          required: typeof required === 'boolean' ? required : (rules(required) ?? false),
          readOnlyWhen: rules(entry['readOnlyWhen']),
          checks: checksOf(entry).map((check, index) => ({
            place: `${place}.checks[${index}]`,
            type: String(check['type']),
            parameters: Array.isArray(check['parameters']) ? check['parameters'] : [],
            label: labelOf(check, [], null),
          })),
        },
      ];
    }
    const id = String(entry['id']);
    return [
      {
        kind: 'computed',
        id,
        computed: entry['computed'],
        label: labelOf(entry, [], humanize(id)),
        ...common,
      },
    ];
  };

  const cards = (list: unknown, prefix: string): FormCardEntry[] =>
    (Array.isArray(list) ? list : []).flatMap((card: unknown, index): FormCardEntry[] => {
      const place = `${prefix}cards[${index}]`;
      if (!isRecord(card) || !kept(place, card)) return [];
      const fields = (Array.isArray(card['fields']) ? card['fields'] : []).flatMap(
        (entry: unknown, position) => field(entry, `${place}.fields[${position}]`),
      );
      // A heading with nothing under it is not a section, as version 1 leaves out an empty one.
      if (fields.length === 0) return [];
      return [
        {
          id: String(card['id']),
          place,
          label: labelOf(card, [], null),
          visibleWhen: rules(card['visibleWhen']),
          fields,
        },
      ];
    });

  if (!Array.isArray(content['tabs'])) {
    return { version: 2, kind, tabs: null, cards: cards(content['cards'], ''), problems };
  }
  const tabs = content['tabs'].flatMap((tab: unknown, index): FormTabEntry[] => {
    const place = `tabs[${index}]`;
    if (!isRecord(tab) || !kept(place, tab)) return [];
    const inside = cards(tab['cards'], `${place}.`);
    if (inside.length === 0) return [];
    return [
      {
        id: String(tab['id']),
        place,
        label: labelOf(tab, [], humanize(String(tab['id']))),
        visibleWhen: rules(tab['visibleWhen']),
        cards: inside,
      },
    ];
  });
  return { version: 2, kind, tabs, cards: [], problems };
}
