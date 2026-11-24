import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatTabsModule } from '@angular/material/tabs';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { compute, type ComputationContext } from '@agentic-ui/shared/computations';
import {
  NXS_PRIMITIVE_IDS,
  NxsBannerComponent,
  NxsCommentsComponent,
  type NxsBannerTone,
  type NxsTagStatus,
} from '@nuxeo/satori-platform/components';
import {
  ExtensionOutletComponent,
  ExtensionRuleContextService,
  ExtensionRuleRegistry,
  type ExtensionRule,
} from '@nuxeo/satori-platform/extensions';
import { NuxeoDocument, renderTrustedHtml } from '@nuxeo/satori-platform/nuxeo-client';
import { merge, switchMap } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { layoutLabelText } from '../layout-label';
import type { LayoutFieldType, LayoutLabel } from '../layout.model';
import { humanize } from '../resolve-layout';
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
import { listParameters } from './list-parameters';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from './record-clock';
import {
  type Labels,
  type LinkedRecords,
  LinkedRecordLookup,
  LookupCollector,
  type Lookups,
  NO_LABELS,
  NO_RECORDS,
  labelLookups,
  namesOf,
  readLabels,
  recordIdsOf,
  recordLookups,
  sameLookups,
} from './record-lookups';
import {
  type RecordBannerTone,
  type RecordCommentsEntry,
  type RecordListEntry,
  type RecordTimelineEntry,
  propertiesReadBy,
} from './record-layout';
import { RecordListComponent } from './record-list';
import { RecordPictureViewsComponent } from './record-picture-views';
import { RecordTimelineComponent } from './record-timeline';
import {
  type ResolvedPropertyField,
  type ResolvedRecordCard,
  type ResolvedRecordField,
  type ResolvedRecordLayout,
  widgetAccepts,
} from './resolve-record-layout';
import { own, tableColumns } from './widget-support';

export { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from './record-clock';

/** The design system's status for each of version 2's tones. */
const TAG_STATUS: Readonly<Record<Tone, NxsTagStatus>> = {
  positive: 'success',
  warning: 'warning',
  negative: 'important',
  info: 'info',
  neutral: 'neutral',
};

/** The design system's banner tone for each of a banner's, in layout version 2's words. */
const BANNER_TONE: Readonly<Record<RecordBannerTone, NxsBannerTone>> = {
  info: 'info',
  warning: 'warning',
  negative: 'error',
};

/** A banner as the page shows it: what `nxs.primitives.banner` is given. */
export interface RecordBannerShown {
  readonly id: string;
  readonly inputs: {
    readonly message: string;
    readonly tone: NxsBannerTone;
    readonly announce: 'none';
  };
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

/** A card's list of related records, as the page hands it to the list. */
export interface RecordRelatedShown {
  /** The columns are those whose rules pass. */
  readonly list: RecordListEntry;
  /** Read from the open record; `null` when one has no value, and the list is not asked for. */
  readonly parameters: readonly string[] | null;
  /** The list's name for assistive technology: the card's heading, or its id. */
  readonly label: string;
  /** Where it is written, for the console. */
  readonly source: string;
}

/** A timeline's card, as the page hands it to the timeline. */
export interface RecordTimelineShown {
  readonly timeline: RecordTimelineEntry;
  /** The timeline's name for assistive technology: the card's heading, or its id. */
  readonly label: string;
}

export interface RecordCardShown {
  readonly id: string;
  readonly heading: string | null;
  readonly span: number;
  readonly fields: readonly RecordFieldShown[];
  /** For a card of related records; `null` for any other card. */
  readonly related: RecordRelatedShown | null;
  /** For a timeline's card; `null` for any other card. */
  readonly timeline: RecordTimelineShown | null;
  /** For a card of comments, the record's thread; `null` for any other card. */
  readonly comments: RecordCommentsEntry | null;
}

export interface RecordPageShown {
  readonly type: string;
  readonly columns: number;
  /** The banners whose rules pass, in the file's order, above everything else. */
  readonly banners: readonly RecordBannerShown[];
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
 * computation works out from the record; a rule shows or hides a banner, a tab, a card or a field.
 * A card may list related records instead, or show the record's timeline or its comments. Banners
 * come first, then, for a Picture, its views (`lib-record-picture-views`), then the cards.
 *
 * Its fields are read-only; the comments card is where a user writes, and the server decides what
 * it accepts. A hidden field is hidden from this page only: the REST API still returns it to
 * anyone the server lets read it, so nothing here is a security control.
 */
@Component({
  selector: 'lib-record-page',
  standalone: true,
  imports: [
    ExtensionOutletComponent,
    MatTabsModule,
    NgTemplateOutlet,
    NxsBannerComponent,
    NxsCommentsComponent,
    RecordListComponent,
    RecordPictureViewsComponent,
    RecordTimelineComponent,
    RouterLink,
    TranslatePipe,
  ],
  // The records the page's `document-link` fields and its lists' cells name, read for the page's
  // life: its lists share it.
  providers: [LinkedRecordLookup],
  templateUrl: './record-page.html',
  styleUrl: './record-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordPageComponent {
  readonly document = input.required<NuxeoDocument>();
  readonly layout = input.required<ResolvedRecordLayout>();

  protected readonly statusTagId = NXS_PRIMITIVE_IDS.statusTag;
  protected readonly bannerId = NXS_PRIMITIVE_IDS.banner;

  private readonly layouts = inject(DocumentLayoutService);
  private readonly linkedRecords = inject(LinkedRecordLookup);
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
   * The vocabulary entries, the users and groups, and the linked records the page's values name:
   * only those are read. Each value is read through the widget that shows it: a field's, a table
   * column's, or, for a template's placeholder, that of the field showing the property.
   */
  private readonly lookups = computed<Lookups>(
    () => {
      const layout = this.layout();
      const document = this.document();
      const properties = document.properties;
      const collector = new LookupCollector();
      /** What a value shown through `widget` names. */
      const named = collector.value.bind(collector);
      // A computation is worked out here with no labels, so the labels never wait on themselves.
      // An id it gives a `user`, `group`, `vocabulary` or `document-link` widget is a stored value
      // or a literal it chose, which no label changes. A template's text can change with its
      // placeholders' labels; it is a name already, not an id, and only its unlabelled text is
      // asked for, to no effect.
      const unlabelled = this.valueContext(document, NO_LABELS, NO_RECORDS);
      const read = new Set<string>();
      for (const field of fieldsOf(layout)) {
        if (field.kind === 'computed') {
          propertiesReadBy(field.computed, read);
          if (
            field.widget === 'user' ||
            field.widget === 'group' ||
            field.widget === 'vocabulary' ||
            field.widget === 'document-link'
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
          for (const row of rows) named(widget, column.parameters, sub, own(row, column.subfield));
        }
      }
      // A placeholder whose property a field shows is read with that field, above.
      for (const xpath of read) {
        const definition = layout.properties.get(xpath);
        if (definition && !fieldShowing(layout, xpath))
          named(null, {}, definition, properties[xpath]);
      }
      return collector.lookups();
    },
    { equal: sameLookups },
  );

  /** Shown as the stored ids until the labels arrive, and as the id wherever one cannot be read. */
  private readonly labels = toSignal(
    toObservable(namesOf(this.lookups)).pipe(
      switchMap((lookups) => readLabels(this.layouts, lookups)),
    ),
    { initialValue: NO_LABELS },
  );

  /**
   * The linked records, read once per page in one request for the ids each new set adds. Those
   * read stay shown while another set is read; one not read yet shows nothing, never its id.
   */
  private readonly records = toSignal(
    toObservable(recordIdsOf(this.lookups)).pipe(
      switchMap((ids) => this.linkedRecords.records(ids)),
    ),
    { initialValue: NO_RECORDS },
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
    const context = this.valueContext(document, this.labels(), this.records());
    const passes = context.rule;
    // A banner is met in place, as the page draws, so it is not announced: `announce` is `none`.
    const banners = layout.banners
      .filter((banner) => passes(banner.visibleWhen))
      .map((banner): RecordBannerShown => ({
        id: banner.id,
        inputs: {
          message: this.text(banner.label) ?? humanize(banner.id),
          tone: BANNER_TONE[banner.tone],
          announce: 'none',
        },
      }));
    const cards = (list: readonly ResolvedRecordCard[]): RecordCardShown[] =>
      list
        .filter((card) => passes(card.visibleWhen))
        .map((card) => {
          const heading = this.text(card.label);
          return {
            id: card.id,
            heading,
            span: Math.min(card.span, layout.columns),
            fields: card.fields
              .filter((field) => passes(field.visibleWhen))
              .flatMap((field) => this.showField(field, layout, document, context)),
            related: card.related
              ? this.showRelated(card, card.related, heading, layout, document, passes)
              : null,
            timeline: card.timeline
              ? { timeline: card.timeline, label: heading ?? humanize(card.id) }
              : null,
            comments: card.comments,
          };
        })
        .filter(
          (card) =>
            card.fields.length > 0 ||
            (card.related?.list.columns.length ?? 0) > 0 ||
            card.timeline !== null ||
            card.comments !== null,
        );
    if (layout.tabs) {
      const tabs = layout.tabs
        .filter((tab) => passes(tab.visibleWhen))
        .map((tab) => ({
          id: tab.id,
          label: this.text(tab.label) ?? tab.id,
          cards: cards(tab.cards),
        }))
        .filter((tab) => tab.cards.length > 0);
      return { type: layout.type, columns: layout.columns, banners, tabs, cards: [] };
    }
    return {
      type: layout.type,
      columns: layout.columns,
      banners,
      tabs: null,
      cards: cards(layout.cards),
    };
  });

  /**
   * A card's related records: the columns whose rules pass for the open record and the user, as
   * a field's do, and the page provider's parameters read from the record. The columns go to the
   * list with their rules answered, and the list draws no column whose rule is still to answer.
   */
  private showRelated(
    card: ResolvedRecordCard,
    list: RecordListEntry,
    heading: string | null,
    layout: ResolvedRecordLayout,
    document: NuxeoDocument,
    passes: (rule: unknown) => boolean,
  ): RecordRelatedShown {
    const source = `${layout.type}/view layout: ${card.place}`;
    const read = listParameters(list.parameters, document);
    if ('missing' in read) this.tell(`${source}: not listed: ${read.missing}`);
    return {
      list: {
        ...list,
        columns: list.columns
          .filter((column) => passes(column.visibleWhen))
          .map((column) => ({ ...column, visibleWhen: null })),
      },
      parameters: 'values' in read ? read.values : null,
      label: heading ?? humanize(card.id),
      source,
    };
  }

  /**
   * What a widget reads besides its value, with the labels and the linked records read so far.
   * Its rules read the page's clock, today and the zone, as its dates and computations do, so a
   * banner on a date agrees with the date field beside it, and a test or a demo that pins the
   * page's day pins the banners too.
   */
  private valueContext(
    document: NuxeoDocument,
    labels: Labels,
    records: LinkedRecords,
  ): RecordValueContext {
    const today = this.today();
    const ruleContext = {
      ...this.ruleContext.context(),
      document,
      today,
      timeZone: this.timeZone,
    };
    return {
      locale: this.locale,
      today,
      timeZone: this.timeZone,
      ...labelLookups(labels),
      ...recordLookups(records, this.translate.instant('document-layouts.record.unavailable')),
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
    const definition: LayoutFieldType = computedDefinition(result.value, field.widget);
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
