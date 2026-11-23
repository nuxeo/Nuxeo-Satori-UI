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
import { compute } from '@agentic-ui/shared/computations';
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
  type RecordValueContext,
  type RecordValueView,
  type Tone,
  WIDGETS_SHOWN_AS_VERSION_1,
  computedDefinition,
  showValue,
  viewText,
} from './record-field-view';
import {
  type ResolvedRecordCard,
  type ResolvedRecordField,
  type ResolvedRecordLayout,
  widgetAccepts,
} from './resolve-record-layout';

/** Today, for computations and relative dates. A token, so that tests choose the day. */
export const RECORD_PAGE_TODAY = new InjectionToken<() => Date>('RECORD_PAGE_TODAY', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

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

function sameLookups(a: Lookups, b: Lookups): boolean {
  const key = (lookups: Lookups) =>
    JSON.stringify([
      lookups.vocabulary.map((value) => [value.directory, value.id]),
      lookups.principals.map((principal) => [principal.kind, principal.id]),
    ]);
  return key(a) === key(b);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The properties a computation reads: its `{ "field" }` parameters and its template's placeholders. */
function propertiesReadBy(computation: unknown, found: Set<string>): void {
  if (!isRecord(computation) || !Array.isArray(computation['parameters'])) return;
  for (const parameter of computation['parameters']) {
    if (typeof parameter === 'string' && computation['type'] === 'core.template') {
      for (const match of parameter.matchAll(/\{([A-Za-z_][\w-]*:[A-Za-z_][\w-]*)\}/g))
        found.add(match[1]);
    } else if (isRecord(parameter) && typeof parameter['field'] === 'string') {
      found.add(parameter['field']);
    } else if (isRecord(parameter) && 'computed' in parameter) {
      propertiesReadBy(parameter['computed'], found);
    }
  }
}

function sortedUnique<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()].sort((a, b) =>
    key(a).localeCompare(key(b)),
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

  /** What the console has been told, so that a page re-rendered for a label does not repeat it. */
  private readonly told = new Set<string>();

  /** The vocabulary entries and the users and groups the page's values name: only those are read. */
  private readonly lookups = computed<Lookups>(
    () => {
      const layout = this.layout();
      const properties = this.document().properties;
      const vocabulary: VocabularyValue[] = [];
      const principals: Principal[] = [];
      const read = new Set<string>();
      for (const field of this.fieldsOf(layout)) {
        if (field.kind === 'computed') {
          propertiesReadBy(field.computed, read);
          continue;
        }
        const value = properties[field.xpath];
        if (field.widget === 'user' || field.widget === 'group') {
          for (const id of Array.isArray(value) ? value : [value]) {
            if (typeof id === 'string' && id !== '') principals.push({ kind: field.widget, id });
          }
          continue;
        }
        const directory =
          field.widget === 'vocabulary' && typeof field.parameters['directory'] === 'string'
            ? field.parameters['directory']
            : field.definition.directory;
        vocabulary.push(
          ...vocabularyValues([
            {
              definition: directory ? { ...field.definition, directory } : field.definition,
              value,
            },
          ]),
        );
      }
      for (const xpath of read) {
        const definition = layout.properties.get(xpath);
        if (definition)
          vocabulary.push(...vocabularyValues([{ definition, value: properties[xpath] }]));
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
    const labels = this.labels();
    const ruleContext = { ...this.ruleContext.context(), document };
    const passes = (rule: unknown): boolean =>
      rule === null || this.rules.evaluate(rule as ExtensionRule, ruleContext);
    const context: RecordValueContext = {
      locale: this.locale,
      today: this.today(),
      vocabulary: (directory, id) => labels.get(`v\n${directory}\n${id}`) ?? id,
      principal: (kind, id) => labels.get(`${kind}\n${id}`) ?? id,
      property: (xpath) => document.properties[xpath],
      label: (label) => this.text(label),
      flagText: (flag) =>
        this.translate.instant(flag ? 'document-layouts.yes' : 'document-layouts.no'),
    };
    const cards = (list: readonly ResolvedRecordCard[]): RecordCardShown[] =>
      list
        .filter((card) => passes(card.visibleWhen))
        .map((card) => ({
          id: card.id,
          heading: this.text(card.label),
          span: Math.min(card.span, layout.columns),
          fields: card.fields
            .filter((field) => passes(field.visibleWhen))
            .flatMap((field) => this.showField(field, layout, document, context, passes)),
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

  private showField(
    field: ResolvedRecordField,
    layout: ResolvedRecordLayout,
    document: NuxeoDocument,
    context: RecordValueContext,
    passes: (rule: unknown) => boolean,
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
      return [this.withExtras({ key: field.xpath, label, value })];
    }
    const result = compute(field.computed, {
      value: (xpath) => document.properties[xpath],
      display: (xpath) => this.displayText(xpath, layout, document, context),
      rule: (rule) => passes(rule),
      today: context.today,
    });
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
    return [this.withExtras({ key: field.id, label, value })];
  }

  /** A property's display value, for a computation's placeholder: what its field would show. */
  private displayText(
    xpath: string,
    layout: ResolvedRecordLayout,
    document: NuxeoDocument,
    context: RecordValueContext,
  ): string {
    const definition = layout.properties.get(xpath) ?? { type: 'string' };
    const value = showValue(
      { key: xpath, label: xpath, value: document.properties[xpath], parameters: {}, definition },
      null,
      context,
    );
    return viewText(value, context.flagText);
  }

  private withExtras(field: RecordFieldShown): RecordFieldShown {
    const { value } = field;
    if (value.kind === 'badge')
      return { ...field, tag: { label: value.text, status: TAG_STATUS[value.tone] } };
    if (value.kind === 'html')
      return { ...field, html: renderTrustedHtml(this.sanitizer, value.html) };
    return field;
  }

  private fieldsOf(layout: ResolvedRecordLayout): ResolvedRecordField[] {
    const cards = layout.tabs ? layout.tabs.flatMap((tab) => tab.cards) : layout.cards;
    return cards.flatMap((card) => card.fields);
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
