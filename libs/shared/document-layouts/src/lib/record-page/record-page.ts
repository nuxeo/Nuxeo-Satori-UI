import { NgTemplateOutlet, formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
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
  NxsCheckboxComponent,
  NxsCommentsComponent,
  NxsIconComponent,
  NxsSpinnerComponent,
  NxsToastService,
  provideNxsToast,
  type NxsBannerTone,
  type NxsTagStatus,
} from '@nuxeo/satori-platform/components';
import {
  ExtensionOutletComponent,
  ExtensionRuleContextService,
  ExtensionRuleRegistry,
  type ExtensionRule,
} from '@nuxeo/satori-platform/extensions';
import {
  BrowseService,
  CURRENT_USERNAME,
  DocumentChangesService,
  NuxeoDocument,
  canWriteDocument,
  renderTrustedHtml,
} from '@nuxeo/satori-platform/nuxeo-client';
import { merge, switchMap } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { layoutLabelText } from '../layout-label';
import type { LayoutFieldType, LayoutLabel } from '../layout.model';
import { humanize } from '../resolve-layout';
import { readValidationFailure } from '../validation-failure';
import {
  RICH_TEXT_HTML,
  type RecordValueContext,
  type RecordValueView,
  WIDGETS_SHOWN_AS_VERSION_1,
  columnWidget,
  computedDefinition,
  showValue,
  subfieldDefinition,
  viewText,
} from './record-field-view';
import { listParameters } from './list-parameters';
import {
  type RecordChecklistItemShown,
  type RecordChecklistShown,
  checklistUsers,
  showChecklist,
  tickedChecklist,
} from './record-checklist';
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
import { RecordExternalComponent } from './record-external';
import {
  type RecordBannerTone,
  type RecordCommentsEntry,
  type RecordExternalEntry,
  type RecordListEntry,
  type RecordTimelineEntry,
  propertiesReadBy,
} from './record-layout';
import { RecordListComponent } from './record-list';
import { RecordPictureReviewComponent } from './record-picture-review';
import { RecordPictureViewsComponent } from './record-picture-views';
import { TAG_STATUS } from './record-tags';
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

/** A card from another system, as the page hands it to `lib-record-external`. */
export interface RecordExternalShown {
  /** Its fields are those whose rules pass. */
  readonly external: RecordExternalEntry;
  /** Where it is written, for the console. */
  readonly source: string;
}

/** A checklist's card, as the page draws it: its items, read from the open record. */
export interface RecordChecklistCardShown extends RecordChecklistShown {
  /** The list's name for assistive technology: the card's heading, or its id. */
  readonly label: string;
  /**
   * Whether each item has a tick box: the file opts in (`"tickable": true`), the page is not
   * read-only, and the record's permissions let the signed-in user change it ({@link canTick}).
   */
  readonly tickable: boolean;
  /** The item a tick on this card is writing, and the state it asks for, while it is; `null` otherwise. */
  readonly ticking: { readonly item: string; readonly done: boolean } | null;
  /** Whether a tick is being written anywhere on the page, which every tick box waits for. */
  readonly busy: boolean;
}

/**
 * Whether what a tick wrote, `written`, is to be shown rather than the record the page is given,
 * `document`: the same record, and newer by the server's modification stamps, as when the page is
 * given the record read before a second tick's answer; or, with no stamp to tell them apart, until
 * the page is given the record again.
 */
function showsWritten(
  written: { readonly base: NuxeoDocument; readonly document: NuxeoDocument },
  document: NuxeoDocument,
): boolean {
  if (written.document.uid !== document.uid) return false;
  const wrote = Date.parse(written.document.lastModified ?? '');
  const given = Date.parse(document.lastModified ?? '');
  if (!Number.isNaN(wrote) && !Number.isNaN(given) && wrote !== given) return wrote > given;
  return written.base === document;
}

/** The id of a checklist item's state, who and when, which its tick box is described by. */
export function checklistDetailId(card: string, item: string): string {
  // A colon is in no card's or item's id, so no two pairs give the same id.
  return `record-checklist:${card}:${item}`;
}

/**
 * Whether the signed-in user may tick a checklist's items on `document`, as the app knows it for
 * its other editable surfaces: the record's `permissions` enricher grants `Write` or
 * `WriteProperties` (`canWriteDocument`, which the Edit button and the note editor read), and the
 * record is neither a version nor in the trash, as the review's pins are not offered on either. A
 * record that came without its permissions offers no tick. Not a security control: the server's
 * permissions decide whether the write is accepted.
 */
export function canTick(document: NuxeoDocument): boolean {
  return document.isVersion !== true && document.isTrashed !== true && canWriteDocument(document);
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
  /** For a card from another system; `null` for any other card. */
  readonly external: RecordExternalShown | null;
  /** For a checklist's card; `null` for any other card. */
  readonly checklist: RecordChecklistCardShown | null;
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

/** Every card of the page, in reading order: the tabs' cards, or the page's own. */
function cardsOf(layout: ResolvedRecordLayout): readonly ResolvedRecordCard[] {
  return layout.tabs ? layout.tabs.flatMap((tab) => tab.cards) : layout.cards;
}

/** Every field of the page, in reading order. */
function fieldsOf(layout: ResolvedRecordLayout): ResolvedRecordField[] {
  return cardsOf(layout).flatMap((card) => card.fields);
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
 * A card may list related records instead, or show the record's timeline or its comments, or fields
 * of a record in another system, read on the server through a connector (`lib-record-external`), or
 * a checklist: the items the file requires, each done or not by the record's own property, with who
 * and when (`record-checklist.ts`). Banners come first, then, for a Picture, its views
 * (`lib-record-picture-views`), or, when the file has a `review`, the views with their pins and
 * rounds (`lib-record-picture-review`), then the cards.
 *
 * Its fields are read-only, and so are its checklists unless the file opts one in to ticking
 * (`"tickable": true`), for someone the record's permissions let change it; the comments card, the
 * review and a tickable checklist are where a user writes, and the server decides what it accepts. A hidden field is hidden from this page only: the REST API still returns it to
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
    NxsCheckboxComponent,
    NxsCommentsComponent,
    NxsIconComponent,
    NxsSpinnerComponent,
    RecordExternalComponent,
    RecordListComponent,
    RecordPictureReviewComponent,
    RecordPictureViewsComponent,
    RecordTimelineComponent,
    RouterLink,
    TranslatePipe,
  ],
  // The records the page's `document-link` fields and its lists' cells name, read for the page's
  // life: its lists share it.
  providers: [LinkedRecordLookup, provideNxsToast()],
  templateUrl: './record-page.html',
  styleUrl: './record-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordPageComponent {
  readonly document = input.required<NuxeoDocument>();
  readonly layout = input.required<ResolvedRecordLayout>();
  /**
   * The page without the ways it offers to change a record: a comments card shows its thread
   * without the comment box, Reply, Edit or Delete, a review its pins without Add a pin or Close
   * round, a related list offers no row action, and a checklist no tick box. What
   * the layout designer previews with, so that drawing the page it is editing writes nothing. A
   * convenience, not a control: the server's permissions decide what anyone may change.
   */
  readonly readOnly = input(false);

  protected readonly statusTagId = NXS_PRIMITIVE_IDS.statusTag;
  protected readonly bannerId = NXS_PRIMITIVE_IDS.banner;
  protected readonly detailId = checklistDetailId;

  private readonly layouts = inject(DocumentLayoutService);
  private readonly linkedRecords = inject(LinkedRecordLookup);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly rules = inject(ExtensionRuleRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly today = inject(RECORD_PAGE_TODAY);
  private readonly timeZone = inject(RECORD_PAGE_TIME_ZONE);
  private readonly username = inject(CURRENT_USERNAME);
  private readonly changes = inject(DocumentChangesService);
  private readonly toast = inject(NxsToastService);
  /** `BrowseService` is asked for at the first tick: a page that ticks nothing reads it never. */
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * What a tick wrote, as the server answered it, over the record the page was given when it
   * answered (`base`): the page shows it while it is newer than the record it is given
   * ({@link showsWritten}), which the page asks for again once the write succeeds. So a second tick
   * before then starts from the first's, not from the record as it was loaded, a record read before
   * the second answer does not hide it, and a page given another record forgets it.
   */
  private readonly written = signal<{
    readonly base: NuxeoDocument;
    readonly document: NuxeoDocument;
  } | null>(null);

  /** The tick being written, on which card and item, and the state it asks for; one at a time. */
  private readonly ticking = signal<{
    readonly card: string;
    readonly item: string;
    readonly done: boolean;
  } | null>(null);

  /** The record as the page shows it: as given, or as the last tick on it wrote it since. */
  private readonly current = computed<NuxeoDocument>(() => {
    const written = this.written();
    const document = this.document();
    return written !== null && showsWritten(written, document) ? written.document : document;
  });

  /**
   * Whether a checklist that opts in offers its tick boxes here: not on a read-only page, such as
   * the designer's preview, not without a signed-in user to say who ticked, and only where the
   * record's permissions let them change it.
   */
  private readonly mayTick = computed(
    () => !this.readOnly() && this.username() !== null && canTick(this.current()),
  );

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
      const document = this.current();
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
      // Who did each item a checklist shows done, named as a `user` field names them.
      for (const card of cardsOf(layout)) {
        if (!card.checklist) continue;
        for (const user of checklistUsers(card.checklist, properties[card.checklist.field]))
          named('user', {}, { type: 'string' }, user);
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
    const document = this.current();
    const context = this.valueContext(document, this.labels(), this.records());
    const tickable = this.mayTick();
    const ticking = this.ticking();
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
            external: card.external
              ? {
                  external: {
                    ...card.external,
                    fields: card.external.fields.filter((field) => passes(field.visibleWhen)),
                  },
                  source: `${layout.type}/view layout: ${card.place}`,
                }
              : null,
            checklist: card.checklist
              ? {
                  ...showChecklist(
                    card.checklist,
                    document.properties[card.checklist.field],
                    (label) => this.text(label) ?? '',
                    context,
                  ),
                  label: heading ?? humanize(card.id),
                  tickable: tickable && card.checklist.tickable,
                  ticking:
                    ticking !== null && ticking.card === card.id
                      ? { item: ticking.item, done: ticking.done }
                      : null,
                  busy: ticking !== null,
                }
              : null,
          };
        })
        .filter(
          (card) =>
            card.fields.length > 0 ||
            (card.related?.list.columns.length ?? 0) > 0 ||
            card.timeline !== null ||
            card.comments !== null ||
            (card.external?.external.fields.length ?? 0) > 0 ||
            card.checklist !== null,
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
   * A tick on a checklist's item, `done` the state the person asks for (layout-v2.md, section 7):
   * the record's checklist property written whole, with the item's entry ticked by the signed-in
   * user today, or unticked, through the document-update path the Edit form uses
   * (`BrowseService.updateDocument`). One at a time: while it is written, its box shows it, and
   * every tick box on the page asks for nothing.
   *
   * - **On success** the page shows what the server answered, and asks for the record again
   *   (`DocumentChangesService`), as an app action does, so its timeline and the rest follow.
   * - **On failure** the card is as it was, and the person is told why, as the Edit form tells
   *   them: the server's own words for a value it refused, that they may not change the record, or
   *   that it could not be saved.
   *
   * Who and when are written by this client, from `CURRENT_USERNAME` and the page's clock: `doneOn`
   * is a calendar day, as the schema's `date` holds one, the ticker's day where the page shows its
   * days (`RECORD_PAGE_TIME_ZONE`), written at its UTC midnight as the platform's other day writers
   * write one (AGENTS/08-bug-patterns.md, pattern 29). The server's audit log and the record's
   * timeline say who changed the property, and exactly when.
   *
   * The list is written whole from the page's copy, as the Edit form writes it, with no change
   * token: a tick written by someone else since the page read the record is replaced. Not a
   * security control: the server's permissions decide whether the write is accepted.
   */
  protected tick(card: RecordCardShown, item: RecordChecklistItemShown, done: boolean): void {
    const checklist = this.cardChecklist(card.id);
    const username = this.username();
    if (
      this.ticking() !== null ||
      checklist === null ||
      !checklist.tickable ||
      !this.mayTick() ||
      username === null ||
      done === item.done
    )
      return;
    const record = this.current();
    const day = formatDate(this.today(), 'yyyy-MM-dd', 'en-US', this.timeZone);
    const value = tickedChecklist(
      record.properties[checklist.field],
      item.id,
      done,
      username,
      `${day}T00:00:00.000Z`,
    );
    this.ticking.set({ card: card.id, item: item.id, done });
    this.injector
      .get(BrowseService)
      .updateDocument(record.uid, { [checklist.field]: value })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.ticking.set(null);
          // Over the record as the page has it now, which a reload may have replaced since the
          // tick began: its enrichers stay, and the property and the stamp are the answer's.
          const given = this.document();
          if (given.uid === record.uid) {
            const answered = updated?.properties?.[checklist.field];
            this.written.set({
              base: given,
              document: {
                ...given,
                lastModified: updated?.lastModified ?? given.lastModified,
                properties: {
                  ...given.properties,
                  [checklist.field]: answered === undefined ? value : answered,
                },
              },
            });
          }
          this.changes.notify();
        },
        error: (failure: unknown) => {
          this.ticking.set(null);
          this.toast.error(this.tickFailure(failure));
        },
      });
  }

  /** The checklist of the card `id`, as the file has it, or `null` for a card with none. */
  private cardChecklist(id: string): ResolvedRecordCard['checklist'] {
    return cardsOf(this.layout()).find((card) => card.id === id)?.checklist ?? null;
  }

  /** Why a tick was not written, as the Edit form says why a save was not. */
  private tickFailure(failure: unknown): string {
    const refused = readValidationFailure(
      failure,
      this.translate.instant('document-layouts.checklist.tick-not-accepted'),
    );
    if (refused) {
      const said = [...new Set(Object.values(refused))];
      if (said.length > 0) return said.join(' ');
    }
    const forbidden = failure instanceof HttpErrorResponse && failure.status === 403;
    return this.translate.instant(
      forbidden
        ? 'document-layouts.checklist.tick-forbidden'
        : 'document-layouts.checklist.tick-failed',
    );
  }

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
        rowActions: this.readOnly() ? [] : list.rowActions,
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
