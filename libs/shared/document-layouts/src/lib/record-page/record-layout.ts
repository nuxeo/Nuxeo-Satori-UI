import {
  PACKAGED_REGISTRIES,
  loadable,
  validateLayoutV2,
  withRegistered,
  type Finding,
} from '@agentic-ui/shared/app-definition';

import type { Invalid } from '../layout-file';
import type { LayoutLabel } from '../layout.model';
import { fieldLabelKey, humanize } from '../resolve-layout';
import { notDrawnColumn } from './widget-support';

/**
 * Layout file version 2 in `view` mode, as the app loads it: the record page's main area
 * (docs/business-apps/layout-v2.md).
 *
 * Tolerant, as section 8 of that document asks. A structural error refuses the whole file, and
 * the record page is then today's document page. A card, tab or field that names something this
 * build does not have — a widget, a computation, a rule — or that gives a widget a parameter it
 * cannot take is left out, the console says why, and the rest of the file still shows. So a file
 * written for a later platform shows everything this one knows. So is one whose rule nests deeper
 * than the rule registry answers ({@link MAX_RULE_LEVELS}): it would pass, and show what it hides.
 */

/** A rule as a layout writes it: an ID, or `{ "type", "parameters" }`, evaluated by the rule registry. */
export type RecordRule =
  string | { readonly type: string; readonly parameters?: readonly unknown[] };

interface RecordFieldBase {
  /** Where the entry is in the file, as `cards[0].fields[2]`, for the console. */
  readonly place: string;
  readonly label: LayoutLabel;
  /** A registered widget, or `null` for the one the property's schema type picks, as in version 1. */
  readonly widget: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly visibleWhen: RecordRule | null;
}

/** A field showing one property of the record. */
export interface RecordPropertyField extends RecordFieldBase {
  readonly kind: 'property';
  /** `<prefix>:<name>`. */
  readonly xpath: string;
}

/** A field showing what a registered computation works out from the record. */
export interface RecordComputedField extends RecordFieldBase {
  readonly kind: 'computed';
  readonly id: string;
  /** `{ "type", "parameters" }`, as written: evaluated by the computation registry. */
  readonly computed: unknown;
}

export type RecordFieldEntry = RecordPropertyField | RecordComputedField;

export interface RecordCardEntry {
  readonly id: string;
  readonly place: string;
  /** Its heading; `fallback` is `null`, so a card with no label shows none. */
  readonly label: LayoutLabel;
  /** How many columns it takes, at least 1 and at most the file's `columns`. */
  readonly span: number;
  readonly visibleWhen: RecordRule | null;
  readonly fields: readonly RecordFieldEntry[];
}

export interface RecordTabEntry {
  readonly id: string;
  readonly place: string;
  readonly label: LayoutLabel;
  readonly visibleWhen: RecordRule | null;
  readonly cards: readonly RecordCardEntry[];
}

/** A `view` file that the app can show, with what it left out of it. */
export interface RecordLayoutFile {
  /** 1 to 3. */
  readonly columns: number;
  /** The tabs, or `null` when the file lists its cards directly. */
  readonly tabs: readonly RecordTabEntry[] | null;
  /** The cards of a file without tabs; empty when it has tabs. */
  readonly cards: readonly RecordCardEntry[];
  readonly problems: readonly string[];
}

/** The composites, whose parameters are rules. Every other rule's parameters are its own values. */
const COMPOSITE_RULES: ReadonlySet<string> = new Set(['core.every', 'core.some', 'core.not']);

/** `core.choose` takes a rule first; no other computation takes one. */
const RULE_TAKING_COMPUTATION = 'core.choose';

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/** A label as version 1 reads one: a literal first, then a translation key, then `fallback`. */
function labelOf(entry: Json, keys: readonly string[], fallback: string | null): LayoutLabel {
  const literal = text(entry['label']);
  const labelKey = text(entry['labelKey']);
  return {
    ...(literal ? { literal } : {}),
    keys: [...(labelKey ? [labelKey] : []), ...keys],
    fallback,
  };
}

/**
 * The entry a finding is about: the innermost tab, card or field its path passes through, as
 * `tabs[0].cards[1].fields[2]`. A widget's own lists — a table's `parameters.columns` — are not
 * fields of the file, so a finding inside one names the field whose widget it is. `null` for a
 * finding about the file as a whole.
 */
export function entryOf(path: string): string | null {
  let entry: string | null = null;
  for (const match of path.matchAll(/(?:^|\.)(tabs|cards|fields)\[(\d+)\]/g)) {
    const end = (match.index ?? 0) + match[0].length;
    // Only a chain of tabs, cards and fields from the start of the path: `cards[0].related.columns[1]`
    // stops at the card, and `cards[0].fields[1].parameters.columns[0]` at the field.
    const before = path.slice(0, match.index ?? 0);
    if (entry === null ? before !== '' : before !== entry) break;
    entry = path.slice(0, end);
  }
  return entry;
}

/**
 * How many levels a layout's rule may nest, the rule itself being the first: as many as the rule
 * registry answers. `ExtensionRuleRegistry` stops descending below that, and answers `true` for any
 * rule there that is not declared security-relevant, so `core.false` under 32 composites would show
 * the entry it is meant to hide. A deeper rule leaves its entry out, as an unregistered one does.
 * `record-layout.spec.ts` holds this to the registry both ways: a rule this deep is answered as
 * written, and one level more is not.
 */
export const MAX_RULE_LEVELS = 32;

/**
 * Why the page could not answer `rule` as written, as the console says it, or `null` when it can:
 * it names a rule this build does not register, or it nests deeper than {@link MAX_RULE_LEVELS}.
 * The walk stops at that depth, so it never recurses further than the registry would.
 */
export function refusedRule(
  rule: unknown,
  isRuleKnown: (id: string) => boolean,
  level = 1,
): string | null {
  const id = typeof rule === 'string' ? rule : isRecord(rule) ? rule['type'] : undefined;
  if (typeof id !== 'string') return null;
  if (!isRuleKnown(id)) return `names the rule "${id}", which this build does not register`;
  if (level > MAX_RULE_LEVELS) {
    return `nests its rule more than ${MAX_RULE_LEVELS} levels deep, deeper than this build answers`;
  }
  if (!COMPOSITE_RULES.has(id) || !isRecord(rule) || !Array.isArray(rule['parameters']))
    return null;
  for (const nested of rule['parameters']) {
    const refused = refusedRule(nested, isRuleKnown, level + 1);
    if (refused) return refused;
  }
  return null;
}

/** Why the page could not answer the rule a computation's `core.choose`, at any depth, takes. */
function refusedRuleInComputation(
  computation: unknown,
  isRuleKnown: (id: string) => boolean,
): string | null {
  if (!isRecord(computation) || !Array.isArray(computation['parameters'])) return null;
  const parameters: readonly unknown[] = computation['parameters'];
  // `compute` hands the rule to the registry as written, which counts its levels from the first.
  if (computation['type'] === RULE_TAKING_COMPUTATION) {
    const refused = refusedRule(parameters[0], isRuleKnown);
    if (refused) return refused;
  }
  for (const parameter of parameters) {
    if (isRecord(parameter) && 'computed' in parameter) {
      const refused = refusedRuleInComputation(parameter['computed'], isRuleKnown);
      if (refused) return refused;
    }
  }
  return null;
}

/** A table widget's columns, as written in its `columns` parameter; empty for any other field. */
function tableColumnEntries(entry: Json): readonly unknown[] {
  const parameters = entry['parameters'];
  return entry['widget'] === 'table' && isRecord(parameters) && Array.isArray(parameters['columns'])
    ? parameters['columns']
    : [];
}

/**
 * The properties a computation reads, added to `found`: its `{ "field" }` parameters, at any depth,
 * and its template's `{<prefix>:<name>}` placeholders.
 */
export function propertiesReadBy(computation: unknown, found: Set<string>): void {
  if (!isRecord(computation) || !Array.isArray(computation['parameters'])) return;
  for (const parameter of computation['parameters']) {
    if (typeof parameter === 'string' && computation['type'] === 'core.template') {
      for (const match of parameter.matchAll(/\{([A-Za-z_][\w-]*:[A-Za-z_][\w-]*)\}/g)) {
        found.add(match[1]);
      }
    } else if (isRecord(parameter) && typeof parameter['field'] === 'string') {
      found.add(parameter['field']);
    } else if (isRecord(parameter) && 'computed' in parameter) {
      propertiesReadBy(parameter['computed'], found);
    }
  }
}

function describe(finding: Finding): string {
  return finding.path ? `${finding.path}: ${finding.message}` : finding.message;
}

/**
 * Read a version 2 `view` file. `registeredRules` are the rules this build registers, the rule
 * registry's IDs, and they decide which rules the file may name:
 *
 * - a customer's own rule, registered in Layer 2 code, is known here though the validator's
 *   packaged list lacks it, as the pipeline's `--registered` makes it known there;
 * - a rule the validator knows and this build does not register, such as version 2's three
 *   proposed ones, is not: evaluated, it would pass, and show a field its author meant to hide.
 */
export function readRecordLayout(
  content: Json,
  registeredRules: readonly string[],
): RecordLayoutFile | Invalid {
  const registered = new Set(registeredRules);
  const isRuleKnown = (id: string): boolean => registered.has(id);
  const findings = validateLayoutV2(content, {
    mode: 'view',
    registries: withRegistered(PACKAGED_REGISTRIES, { rules: registeredRules }),
  });
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
   * Whether the entry at `place` shows: neither a finding nor a rule the page could not answer
   * leaves it out.
   */
  const kept = (place: string, entry: Json): boolean => {
    if (leftOut.has(place)) return false;
    const refused =
      refusedRule(entry['visibleWhen'], isRuleKnown) ??
      refusedRuleInComputation(entry['computed'], isRuleKnown);
    if (refused) {
      problems.push(`${place} ${refused}; left out`);
      return false;
    }
    // A table's columns may each have a rule too, and one the page cannot answer would show its
    // column to everyone: the whole table is left out rather than drawn without it. The columns
    // of a table inside a column are not checked: that column is never drawn (`notDrawnColumn`),
    // so no rule in it is ever evaluated.
    for (const [index, column] of tableColumnEntries(entry).entries()) {
      const inColumn = isRecord(column) ? refusedRule(column['visibleWhen'], isRuleKnown) : null;
      if (inColumn) {
        problems.push(`${place}.parameters.columns[${index}] ${inColumn}; ${place} left out`);
        return false;
      }
    }
    return true;
  };

  const field = (entry: unknown, place: string): RecordFieldEntry[] => {
    // One check for both shapes: a bare `<prefix>:<name>` has no rule, and only a finding can
    // leave it out.
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
        },
      ];
    }
    if (!isRecord(entry)) return [];
    for (const [index, column] of tableColumnEntries(entry).entries()) {
      const notDrawn = notDrawnColumn(column);
      if (notDrawn) {
        problems.push(
          `${place}.parameters.columns[${index}] is ${notDrawn}, which this build does not draw yet; that column left out`,
        );
      }
    }
    const common = {
      place,
      widget: text(entry['widget']) ?? null,
      parameters: isRecord(entry['parameters']) ? entry['parameters'] : {},
      visibleWhen: (entry['visibleWhen'] as RecordRule | undefined) ?? null,
    };
    if (typeof entry['field'] === 'string') {
      const xpath = entry['field'];
      const name = xpath.slice(xpath.indexOf(':') + 1);
      return [
        {
          kind: 'property',
          xpath,
          label: labelOf(entry, [fieldLabelKey(xpath)], humanize(name)),
          ...common,
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

  const cards = (list: unknown, prefix: string): RecordCardEntry[] =>
    (Array.isArray(list) ? list : []).flatMap((card: unknown, index) => {
      const place = `${prefix}cards[${index}]`;
      if (!isRecord(card) || !kept(place, card)) return [];
      if ('related' in card) {
        problems.push(
          `${place} lists related records, which this build does not draw yet; left out`,
        );
        return [];
      }
      const fields = (Array.isArray(card['fields']) ? card['fields'] : []).flatMap(
        (entry: unknown, position) => field(entry, `${place}.fields[${position}]`),
      );
      // A heading with nothing under it is not a card, as version 1 leaves out an empty section.
      if (fields.length === 0) return [];
      return [
        {
          id: String(card['id']),
          place,
          label: labelOf(card, [], null),
          span: typeof card['span'] === 'number' ? card['span'] : 1,
          visibleWhen: (card['visibleWhen'] as RecordRule | undefined) ?? null,
          fields,
        },
      ];
    });

  const columns = typeof content['columns'] === 'number' ? content['columns'] : 1;
  if (!Array.isArray(content['tabs'])) {
    return { columns, tabs: null, cards: cards(content['cards'], ''), problems };
  }
  const tabs = content['tabs'].flatMap((tab: unknown, index): RecordTabEntry[] => {
    const place = `tabs[${index}]`;
    if (!isRecord(tab) || !kept(place, tab)) return [];
    const inside = cards(tab['cards'], `${place}.`);
    if (inside.length === 0) return [];
    return [
      {
        id: String(tab['id']),
        place,
        label: labelOf(tab, [], humanize(String(tab['id']))),
        visibleWhen: (tab['visibleWhen'] as RecordRule | undefined) ?? null,
        cards: inside,
      },
    ];
  });
  return { columns, tabs, cards: [], problems };
}
