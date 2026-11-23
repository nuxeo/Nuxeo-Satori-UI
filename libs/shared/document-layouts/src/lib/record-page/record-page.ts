import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  LOCALE_ID,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatTabsModule } from '@angular/material/tabs';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { compute, type ComputationContext } from '@agentic-ui/shared/computations';
import { NXS_PRIMITIVE_IDS, type NxsTagStatus } from '@nuxeo/satori-platform/components';
import {
  ExtensionOutletComponent,
  ExtensionRuleContextService,
  ExtensionRuleRegistry,
  type ExtensionRule,
} from '@nuxeo/satori-platform/extensions';
import { NuxeoDocument, renderTrustedHtml } from '@nuxeo/satori-platform/nuxeo-client';
import { forkJoin, map, merge, of, startWith, switchMap } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { type VocabularyValue, vocabularyValues } from '../document-layout/field-view';
import { layoutLabelText } from '../layout-label';
import type { LayoutFieldType, LayoutLabel } from '../layout.model';
import {
  RICH_TEXT_HTML,
  type RecordValueContext,
  type RecordValueView,
  type Tone,
  WIDGETS_SHOWN_AS_VERSION_1,
  columnWidget,
  computedDefinition,
  showValue,
  subfieldDefinition,
  viewText,
} from './record-field-view';
import { propertiesReadBy } from './record-layout';
import {
  type ResolvedPropertyField,
  type ResolvedRecordCard,
  type ResolvedRecordField,
  type ResolvedRecordLayout,
  widgetAccepts,
} from './resolve-record-layout';
import { tableColumns } from './widget-support';

/** Today, for computations and relative dates. A token, so that tests choose the day. */
export const RECORD_PAGE_TODAY = new InjectionToken<() => Date>('RECORD_PAGE_TODAY', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

/**
 * The zone an instant is shown in: `undefined`, the reader's own. A token, so that a test chooses
 * an offset such as `+0530`. In whatever zone the suite happens to run, UTC on CI, an instant read
 * in the wrong zone can still show the right day, and the test would prove nothing
 * (AGENTS/08-bug-patterns.md, pattern 29).
 */
export const RECORD_PAGE_TIME_ZONE = new InjectionToken<string | undefined>(
  'RECORD_PAGE_TIME_ZONE',
  { providedIn: 'root', factory: () => undefined },
);

/** The design system's status for each of version 2's tones. */
const TAG_STATUS: Readonly<Record<Tone, NxsTagStatus>> = {
  positive: 'success',
  warning: 'warning',
  negative: 'important',
  info: 'info',
  neutral: 'neutral',
};

interface Principal {
  readonly kind: 'user' | 'group';
  readonly id: string;
}

interface Lookups {
  readonly vocabulary: readonly VocabularyValue[];
  readonly principals: readonly Principal[];
}

/** One field as the page shows it. */
export interface RecordFieldShown {
  /**
   * Where the entry is in the file, as `cards[0].fields[2]`: unique on the page, so it is what the
   * page tracks a field by. A card may show one property twice, through two widgets.
   */
  readonly place: string;
  /** The property's `<prefix>:<name>`, or a computed field's ID: what `data-field` names. */
  readonly key: string;
  readonly label: string;
  readonly value: RecordValueView;
  /** For a `badge`: the inputs of the design system's status tag. */
  readonly tag?: { readonly label: string; readonly status: NxsTagStatus };
  /** For `html`: the value through the platform's sanitiser, never the raw text. */
  readonly html?: SafeHtml;
}

export interface RecordCardShown {
  readonly id: string;
  readonly heading: string | null;
  readonly span: number;
  readonly fields: readonly RecordFieldShown[];
}

export interface RecordPageShown {
  readonly type: string;
  readonly columns: number;
  /** The tabs, each with its cards, or `null` when the page lists cards directly. */
  readonly tabs:
    | readonly {
        readonly id: string;
        readonly label: string;
        readonly cards: readonly RecordCardShown[];
      }[]
    | null;
  readonly cards: readonly RecordCardShown[];
}

type Labels = ReadonlyMap<string, string>;
/** A label read for a lookup's key, or `null` where it could not be read. */
type LabelPair = [string, string | null];
const NO_LABELS: Labels = new Map();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function sameLookups(a: Lookups, b: Lookups): boolean {
  const key = (lookups: Lookups) =>
    JSON.stringify([
      lookups.vocabulary.map((value) => [value.directory, value.id]),
      lookups.principals.map((principal) => [principal.kind, principal.id]),
    ]);
  return key(a) === key(b);
}

function sortedUnique<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()].sort((a, b) =>
    key(a).localeCompare(key(b)),
  );
}

/** Every field of the page, in reading order: the tabs' cards, or the page's own. */
function fieldsOf(layout: ResolvedRecordLayout): ResolvedRecordField[] {
  const cards = layout.tabs ? layout.tabs.flatMap((tab) => tab.cards) : layout.cards;
  return cards.flatMap((card) => card.fields);
}

/** The first field on the page that shows the property, or `undefined` when none does. */
function fieldShowing(
  layout: ResolvedRecordLayout,
  xpath: string,
): ResolvedPropertyField | undefined {
  return fieldsOf(layout).find(
    (field): field is ResolvedPropertyField => field.kind === 'property' && field.xpath === xpath,
  );
}

/**
 * The record page: a document's main area drawn from its type's layout file, version 2, in
 * `view` mode (docs/business-apps/layout-v2.md). Cards fill one to three columns, or tabs hold
 * them; each field shows a property through a registered widget, or what a registered
 * computation works out from the record; a rule shows or hides a tab, a card or a field.
 *
 * Read-only. A hidden field is hidden from this page only: the REST API still returns it to
 * anyone the server lets read it, so nothing here is a security control.
 */
@Component({
  selector: 'lib-record-page',
  standalone: true,
  imports: [ExtensionOutletComponent, MatTabsModule, NgTemplateOutlet, TranslatePipe],
  templateUrl: './record-page.html',
  styleUrl: './record-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordPageComponent {
  readonly document = input.required<NuxeoDocument>();
  readonly layout = input.required<ResolvedRecordLayout>();

  protected readonly statusTagId = NXS_PRIMITIVE_IDS.statusTag;

  private readonly layouts = inject(DocumentLayoutService);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly rules = inject(ExtensionRuleRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly today = inject(RECORD_PAGE_TODAY);
  private readonly timeZone = inject(RECORD_PAGE_TIME_ZONE);

  /** What the console has been told, so that a page re-rendered for a label does not repeat it. */
  private readonly told = new Set<string>();

  /**
   * The vocabulary entries and the users and groups the page's values name: only those are read.
   * Each value is read through the widget that shows it: a field's, a table column's, or, for a
   * template's placeholder, that of the field showing the property.
   */
  private readonly lookups = computed<Lookups>(
    () => {
      const layout = this.layout();
      const document = this.document();
      const properties = document.properties;
      const vocabulary: VocabularyValue[] = [];
      const principals: Principal[] = [];
      /** What a value shown through `widget` names. */
      const named = (
        widget: string | null,
        parameters: Readonly<Record<string, unknown>>,
        definition: LayoutFieldType,
        value: unknown,
      ): void => {
        if (widget === 'user' || widget === 'group') {
          for (const id of Array.isArray(value) ? value : [value]) {
            if (typeof id === 'string' && id !== '') principals.push({ kind: widget, id });
          }
          return;
        }
        const directory =
          widget === 'vocabulary' && typeof parameters['directory'] === 'string'
            ? parameters['directory']
            : definition.directory;
        vocabulary.push(
          ...vocabularyValues([
            { definition: directory ? { ...definition, directory } : definition, value },
          ]),
        );
      };
      // A computation is worked out here with no labels, so the labels never wait on themselves.
      // An id it gives a `user`, `group` or `vocabulary` widget is a stored value or a literal it
      // chose, which no label changes. A template's text can change with its placeholders' labels;
      // it is a name already, not an id, and only its unlabelled text is asked for, to no effect.
      const unlabelled = this.valueContext(document, NO_LABELS);
      const read = new Set<string>();
      for (const field of fieldsOf(layout)) {
        if (field.kind === 'computed') {
          propertiesReadBy(field.computed, read);
          if (
            field.widget === 'user' ||
            field.widget === 'group' ||
            field.widget === 'vocabulary'
          ) {
            const result = compute(
              field.computed,
              this.computationContext(layout, document, unlabelled),
            );
            if (result.ok)
              named(field.widget, field.parameters, computedDefinition(result.value), result.value);
          }
          continue;
        }
        const value = properties[field.xpath];
        if (field.widget !== 'table') {
          named(field.widget, field.parameters, field.definition, value);
          continue;
        }
        // A table's cells, row by row, each through the widget its column shows it with.
        const rows = (Array.isArray(value) ? value : []).filter(isRecord);
        for (const column of tableColumns(field.parameters['columns'])) {
          const sub = subfieldDefinition(field.definition, column);
          const widget = columnWidget(column, sub);
          for (const row of rows) named(widget, column.parameters, sub, row[column.subfield]);
        }
      }
      // A placeholder whose property a field shows is read with that field, above.
      for (const xpath of read) {
        const definition = layout.properties.get(xpath);
        if (definition && !fieldShowing(layout, xpath))
          named(null, {}, definition, properties[xpath]);
      }
      return {
        vocabulary: sortedUnique(vocabulary, (value) => `${value.directory}\n${value.id}`),
        principals: sortedUnique(principals, (principal) => `${principal.kind}\n${principal.id}`),
      };
    },
    { equal: sameLookups },
  );

  /** Shown as the stored ids until the labels arrive, and as the id wherever one cannot be read. */
  private readonly labels = toSignal(
    toObservable(this.lookups).pipe(
      switchMap(({ vocabulary, principals }) =>
        vocabulary.length + principals.length === 0
          ? of(NO_LABELS)
          : forkJoin([
              ...vocabulary.map(({ directory, id }) =>
                this.layouts
                  .vocabularyLabel(directory, id)
                  .pipe(map((label): LabelPair => [`v\n${directory}\n${id}`, label])),
              ),
              ...principals.map(({ kind, id }) =>
                this.layouts
                  .principalLabel(kind, id)
                  .pipe(map((label): LabelPair => [`${kind}\n${id}`, label])),
              ),
            ]).pipe(
              map(
                (pairs): Labels =>
                  new Map(pairs.filter((pair): pair is [string, string] => pair[1] !== null)),
              ),
              startWith(NO_LABELS),
            ),
      ),
    ),
    { initialValue: NO_LABELS },
  );

  /** Bumped when the language or a catalogue changes, so labels resolved with `instant` follow. */
  private readonly translations = signal(0);

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));
  }

  readonly shown = computed<RecordPageShown>(() => {
    this.translations();
    const layout = this.layout();
    const document = this.document();
    const context = this.valueContext(document, this.labels());
    const passes = context.rule;
    const cards = (list: readonly ResolvedRecordCard[]): RecordCardShown[] =>
      list
        .filter((card) => passes(card.visibleWhen))
        .map((card) => ({
          id: card.id,
          heading: this.text(card.label),
          span: Math.min(card.span, layout.columns),
          fields: card.fields
            .filter((field) => passes(field.visibleWhen))
            .flatMap((field) => this.showField(field, layout, document, context)),
        }))
        .filter((card) => card.fields.length > 0);
    if (layout.tabs) {
      const tabs = layout.tabs
        .filter((tab) => passes(tab.visibleWhen))
        .map((tab) => ({
          id: tab.id,
          label: this.text(tab.label) ?? tab.id,
          cards: cards(tab.cards),
        }))
        .filter((tab) => tab.cards.length > 0);
      return { type: layout.type, columns: layout.columns, tabs, cards: [] };
    }
    return { type: layout.type, columns: layout.columns, tabs: null, cards: cards(layout.cards) };
  });

  /** What a widget reads besides its value, with the labels read so far. */
  private valueContext(document: NuxeoDocument, labels: Labels): RecordValueContext {
    const ruleContext = { ...this.ruleContext.context(), document };
    return {
      locale: this.locale,
      today: this.today(),
      timeZone: this.timeZone,
      vocabulary: (directory, id) => labels.get(`v\n${directory}\n${id}`) ?? id,
      principal: (kind, id) => labels.get(`${kind}\n${id}`) ?? id,
      property: (xpath) => document.properties[xpath],
      label: (label) => this.text(label),
      flagText: (flag) =>
        this.translate.instant(flag ? 'document-layouts.yes' : 'document-layouts.no'),
      rule: (rule) => rule === null || this.rules.evaluate(rule as ExtensionRule, ruleContext),
    };
  }

  /** What a computation reads of the record: its values, their display, its rules and today. */
  private computationContext(
    layout: ResolvedRecordLayout,
    document: NuxeoDocument,
    context: RecordValueContext,
  ): ComputationContext {
    return {
      value: (xpath) => document.properties[xpath],
      display: (xpath) => this.displayText(xpath, layout, document, context),
      rule: (rule) => context.rule(rule),
      today: context.today,
    };
  }

  private showField(
    field: ResolvedRecordField,
    layout: ResolvedRecordLayout,
    document: NuxeoDocument,
    context: RecordValueContext,
  ): RecordFieldShown[] {
    const label = this.text(field.label) ?? '';
    if (field.widget !== null && WIDGETS_SHOWN_AS_VERSION_1.has(field.widget)) {
      this.tell(
        `${layout.type}/view layout: ${field.place}: the widget "${field.widget}" shows as the property's own value in this build`,
      );
    }
    if (field.kind === 'property') {
      const value = showValue(
        {
          key: field.xpath,
          label,
          value: document.properties[field.xpath],
          parameters: field.parameters,
          definition: field.definition,
        },
        field.widget,
        context,
      );
      return [this.withExtras({ place: field.place, key: field.xpath, label, value })];
    }
    const result = compute(field.computed, this.computationContext(layout, document, context));
    if (!result.ok) {
      this.tell(`${layout.type}/view layout: ${field.place} left out: ${result.reason}`);
      return [];
    }
    const definition: LayoutFieldType = computedDefinition(result.value);
    if (
      field.widget !== null &&
      result.value !== null &&
      !widgetAccepts(field.widget, definition)
    ) {
      this.tell(
        `${layout.type}/view layout: ${field.place} left out: the widget "${field.widget}" does not show a ${definition.type} result`,
      );
      return [];
    }
    const value = showValue(
      { key: field.id, label, value: result.value, parameters: field.parameters, definition },
      field.widget,
      context,
    );
    return [this.withExtras({ place: field.place, key: field.id, label, value })];
  }

  /**
   * A property's display value, for a computation's placeholder: what its field shows. That is the
   * first field on the page showing the property, through its widget and parameters, whether its
   * rule passes or not; a property no field shows is shown by its schema type. So
   * `{member:caseManager}` is the name a `user` field shows, and a date is the day a field shows.
   */
  private displayText(
    xpath: string,
    layout: ResolvedRecordLayout,
    document: NuxeoDocument,
    context: RecordValueContext,
  ): string {
    const field = fieldShowing(layout, xpath);
    const definition = field?.definition ?? layout.properties.get(xpath) ?? { type: 'string' };
    const value = showValue(
      {
        key: xpath,
        label: xpath,
        value: document.properties[xpath],
        parameters: field?.parameters ?? {},
        definition,
      },
      field?.widget ?? null,
      context,
    );
    return viewText(value, context.flagText);
  }

  private withExtras(field: RecordFieldShown): RecordFieldShown {
    const { value } = field;
    if (value.kind === 'badge')
      return { ...field, tag: { label: value.text, status: TAG_STATUS[value.tone] } };
    if (value.kind === 'html') {
      return { ...field, html: renderTrustedHtml(this.sanitizer, value.html, RICH_TEXT_HTML) };
    }
    return field;
  }

  private text(label: LayoutLabel): string | null {
    return layoutLabelText(this.translate, label);
  }

  /** Once per page: the views are recomputed as labels arrive, and the console need not hear it twice. */
  private tell(message: string): void {
    if (this.told.has(message)) return;
    this.told.add(message);
    console.warn(`[agentic-ui-layouts] ${message}`);
  }
}
