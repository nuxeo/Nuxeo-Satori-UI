import { DOCUMENT, NgTemplateOutlet, formatDate } from '@angular/common';
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
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { isLinkedReference, type LinkedReference } from '@agentic-ui/shared/app-definition';
import { compute, type ComputationContext } from '@agentic-ui/shared/computations';
import {
  NXS_PRIMITIVE_IDS,
  NxsBannerComponent,
  NxsButtonComponent,
  NxsCheckboxComponent,
  NxsCommentsComponent,
  NxsIconComponent,
  NxsSpinnerComponent,
  NxsToastService,
  provideNxsToast,
  type NxsBannerAction,
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
  DocumentDetailService,
  NuxeoDocument,
  PERMISSION_DENIED_KEY,
  canWriteDocument,
  docTypeLabel,
  isPermissionDeniedError,
  renderTrustedHtml,
} from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, filter, forkJoin, map, merge, of, switchMap } from 'rxjs';

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
  showLinkedProperty,
  showValue,
  subfieldDefinition,
  viewText,
} from './record-field-view';
import { isDocumentId, type LinkedProperty } from './linked-record';
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
  recordLookups,
  recordReadOf,
  type RecordRead,
  sameIds,
  sameLookups,
} from './record-lookups';
import { RecordCreateComponent } from './record-create';
import { RecordExternalComponent } from './record-external';
import { RecordHoldsComponent } from './record-holds';
import {
  type RecordBannerTone,
  type RecordCommentsEntry,
  type RecordCreateEntry,
  type RecordExternalEntry,
  type RecordHoldsEntry,
  type RecordListEntry,
  type RecordPropertyField,
  type RecordTimelineEntry,
  linkedTypesOf,
  propertiesReadBy,
  showKey,
  showOf,
  showWidgetOf,
} from './record-layout';
import { RecordListComponent } from './record-list';
import { RecordPictureReviewComponent } from './record-picture-review';
import { RecordPictureViewsComponent } from './record-picture-views';
import { RecordShareLinksComponent } from './record-share-links';
import { RECORD_VIDEO_ID, RecordVideoComponent } from './record-video';
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
  positive: 'success',
};

/** A banner as the page shows it: what `nxs.primitives.banner` is given. */
export interface RecordBannerShown {
  readonly id: string;
  readonly inputs: {
    readonly message: string;
    readonly tone: NxsBannerTone;
    readonly announce: 'none';
    /**
     * Its link, as the banner's one action: the linked record's title, which opens it. Disabled,
     * as "Unavailable", for a record the reader may not read or that no longer exists, and on a
     * page drawn read-only. Empty for a banner that links nowhere, whose property holds no id, or
     * whose record is still being read.
     */
    readonly actions: readonly NxsBannerAction[];
  };
}

/** The class a banner's link carries, for the page's styling and a test to find it by. */
export const BANNER_LINK_CLASS = 'record-page__banner-link';

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
  /**
   * For `records` shown through `status-badge` (layout-v2.md, section 12): each record's status
   * tag, by its place among them, drawn inside its link; `null` for one with no tone.
   */
  readonly tags?: readonly ({ readonly label: string; readonly status: NxsTagStatus } | null)[];
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
  /** Its New, with the button's words translated; `null` when the file offers none. */
  readonly create: { readonly entry: RecordCreateEntry; readonly label: string } | null;
}

/** A holds card, as the page hands it to `lib-record-holds`. */
export interface RecordHoldsShown {
  readonly holds: RecordHoldsEntry;
  /** The list of holds' name for assistive technology: the card's heading, or its id. */
  readonly label: string;
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
  /** For a holds card; `null` for any other card. */
  readonly holds: RecordHoldsShown | null;
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

/**
 * The first field on the page that shows the property, or `undefined` when none does. A field
 * showing a linked record's property through `show` shows another record's, not this one.
 */
function fieldShowing(
  layout: ResolvedRecordLayout,
  xpath: string,
): ResolvedPropertyField | undefined {
  return fieldsOf(layout).find(
    (field): field is ResolvedPropertyField =>
      field.kind === 'property' && field.xpath === xpath && showOf(field) === null,
  );
}

/**
 * Every `document-link` with a `show` on the page (layout-v2.md, section 12): its fields', and its
 * related lists' columns', whose records the page's lookup reads too, so that it reads them once.
 */
function showEntries(layout: ResolvedRecordLayout): RecordPropertyField[] {
  return cardsOf(layout).flatMap((card) => [
    ...card.fields.filter(
      (field): field is ResolvedPropertyField =>
        field.kind === 'property' && showOf(field) !== null,
    ),
    ...(card.related?.columns ?? []).filter((column) => showOf(column) !== null),
  ]);
}

/**
 * Every rule of the page, as written: the banners', the tabs', the cards' and their fields', a
 * computation's (whose `core.choose` takes one), a table's columns', a related list's columns' and
 * the fields' of a card from another system. Each is evaluated for the open record.
 */
function rulesOf(layout: ResolvedRecordLayout): unknown[] {
  const rules: unknown[] = [];
  for (const banner of layout.banners) rules.push(banner.visibleWhen);
  for (const tab of layout.tabs ?? []) rules.push(tab.visibleWhen);
  for (const card of cardsOf(layout)) {
    rules.push(card.visibleWhen);
    for (const field of card.fields) {
      rules.push(field.visibleWhen);
      if (field.kind === 'computed') rules.push(field.computed);
      for (const column of tableColumns(field.parameters['columns']))
        rules.push(column.visibleWhen);
    }
    for (const column of card.related?.columns ?? []) rules.push(column.visibleWhen);
    for (const field of card.external?.fields ?? []) rules.push(field.visibleWhen);
  }
  return rules;
}

/**
 * How deep the walk for a rule's linked records goes: the validator reads no deeper, and the rule
 * registry answers fewer levels still, so nothing it evaluates lies below.
 */
const MAX_RULE_WALK = 256;

/**
 * The linked records' properties `rules` read (layout-v2.md, section 5), each once, in the order
 * met: every `{ "field", "types", "show" }` among their parameters. Walked with a stack, not by
 * recursion, and no deeper than {@link MAX_RULE_WALK}.
 */
function linkedReadsIn(rules: readonly unknown[]): LinkedReference[] {
  const found = new Map<string, LinkedReference>();
  const stack: [unknown, number][] = rules.map((rule) => [rule, 0]);
  while (stack.length > 0) {
    const [value, depth] = stack.pop() as [unknown, number];
    if (isLinkedReference(value)) {
      found.set(ruleReadKey(value), value);
      continue;
    }
    if (depth >= MAX_RULE_WALK) continue;
    if (Array.isArray(value)) for (const item of value) stack.push([item, depth + 1]);
    else if (isRecord(value))
      for (const item of Object.values(value)) stack.push([item, depth + 1]);
  }
  return [...found.values()];
}

/** What a rule's linked property is read for: the types and the property, as a `show` is. */
function ruleReadKey(reference: LinkedReference): string {
  return JSON.stringify(['rule', reference.field, reference.show, reference.types]);
}

/** The linked properties a rule reads, itself or nested, by {@link ruleReadKey}. */
function ruleReadKeys(rule: unknown): string[] {
  return linkedReadsIn([rule]).map(ruleReadKey);
}

/**
 * What each `show` on the page reads, by its entry (`showKey`), and each linked property its rules
 * read, by {@link ruleReadKey}: `null` where none of its types has it. An entry not in it is still
 * being read.
 */
type Shows = ReadonlyMap<string, LinkedProperty | null>;

/**
 * Whether a `show` can be drawn: one of its types has the property, and it is not a reference
 * itself, which would show another record's stored id. One that cannot is left out.
 */
function usableShow(linked: LinkedProperty | null | undefined): linked is LinkedProperty {
  return !!linked && linked.definition.documentReference !== true;
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
 * rounds (`lib-record-picture-review`), and, when the file has `shareLinks`, the picture's share
 * links (`lib-record-share-links`), drawn only for a user the server lets manage them; or, for a
 * video, its player, its facts and its storyboard (`lib-record-video`, through
 * `nxs.components.recordVideo`); then the cards.
 *
 * Its fields are read-only, and so are its checklists unless the file opts one in to ticking
 * (`"tickable": true`), for someone the record's permissions let change it; the comments card, the
 * review, the share links and a tickable checklist are where a user writes, and the server decides
 * what it accepts. A hidden field is hidden from this page only: the REST API still returns it to
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
    NxsButtonComponent,
    NxsCheckboxComponent,
    NxsCommentsComponent,
    NxsIconComponent,
    NxsSpinnerComponent,
    RecordCreateComponent,
    RecordExternalComponent,
    RecordHoldsComponent,
    RecordListComponent,
    RecordPictureReviewComponent,
    RecordPictureViewsComponent,
    RecordShareLinksComponent,
    RecordTimelineComponent,
    RecordVideoComponent,
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
   * round, share links their list without Create or Revoke, a related list offers no row action,
   * and a checklist no tick box. What
   * the layout designer previews with, so that drawing the page it is editing writes nothing. A
   * convenience, not a control: the server's permissions decide what anyone may change.
   */
  readonly readOnly = input(false);

  /**
   * The capture page's address for this record, when its file has a `capture` and the reader may
   * write the record, as the Attachments panel asks (layout-v2.md, section 2, "Capture"): `null`
   * on a page drawn read-only, and on a version. Not a control: the server decides who may add a
   * file to the record.
   */
  protected readonly captureLink = computed((): { readonly record: string } | null => {
    const document = this.document();
    if (this.readOnly() || !this.layout().capture || document.isVersion) return null;
    return canWriteDocument(document) ? { record: document.uid } : null;
  });

  protected readonly statusTagId = NXS_PRIMITIVE_IDS.statusTag;
  protected readonly bannerId = NXS_PRIMITIVE_IDS.banner;
  protected readonly detailId = checklistDetailId;
  protected readonly videoId = RECORD_VIDEO_ID;
  /** What a video's player is given, through `nxs.components.recordVideo`. */
  protected readonly videoInputs = computed(() => ({
    document: this.document(),
    stateHeadingLevel: 3,
  }));

  private readonly layouts = inject(DocumentLayoutService);
  private readonly linkedRecords = inject(LinkedRecordLookup);
  private readonly router = inject(Router);
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
      // Every schema a `show` on the page reads, its lists' included: the page reads each linked
      // record once, with all of them, and a list naming one it read asks for nothing again.
      for (const linked of this.shows()?.values() ?? [])
        if (usableShow(linked)) collector.schema(linked.schema);
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
        // A `show` none of its types has is left out: the records it names are not read for it.
        if (showOf(field) !== null && !usableShow(this.shows()?.get(showKey(field)))) continue;
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
      // The record each linked property a rule reads is on, named as a `document-link` field
      // names it, whatever the rule's outcome: read once for the page, with the schemas above.
      for (const reference of linkedReadsIn(rulesOf(layout))) {
        if (usableShow(this.shows()?.get(ruleReadKey(reference))))
          named('document-link', {}, { type: 'string' }, properties[reference.field]);
      }
      // The record each banner links to, named as a `document-link` field names it, whether or
      // not the banner's rule passes yet: as a field's, it is read once for the page.
      for (const banner of layout.banners) {
        if (banner.link !== null)
          named('document-link', {}, { type: 'string' }, properties[banner.link]);
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
   * What each `document-link` with a `show` reads of the records it links to, by its place, from
   * its types' definitions (layout-v2.md, section 12): `null` until they are read, which a page
   * with none has at once.
   */
  private readonly shows = toSignal(
    toObservable(this.layout).pipe(
      switchMap((layout): Observable<Shows> => {
        // The fields' and lists' `show`s, and the linked properties the page's rules read.
        const entries = [
          ...showEntries(layout).map((entry) => ({
            key: showKey(entry),
            types: linkedTypesOf(entry),
            show: showOf(entry) as string,
          })),
          ...linkedReadsIn(rulesOf(layout)).map((reference) => ({
            key: ruleReadKey(reference),
            types: [...reference.types],
            show: reference.show,
          })),
        ];
        if (entries.length === 0) return of(new Map());
        return forkJoin(
          entries.map((entry) => this.layouts.linkedProperty(entry.types, entry.show)),
        ).pipe(map((read) => new Map(entries.map((entry, index) => [entry.key, read[index]]))));
      }),
    ),
    { initialValue: null },
  );

  /**
   * The linked records, read once per page in one request for the ids each new set adds, with the
   * schemas every `show` on the page reads, once those are known: so a record is not read once
   * without them and again with them. Those read stay shown while another set is read; one not read
   * yet shows nothing, never its id.
   */
  private readonly recordRead = recordReadOf(this.lookups);

  /**
   * Whether every `show` the page has now is known: its types read for this file, not only for the
   * one drawn before it, as the designer's preview is drawn anew on every edit.
   */
  private readonly showsKnown = computed(() => {
    const shows = this.shows();
    const layout = this.layout();
    return (
      shows !== null &&
      showEntries(layout).every((entry) => shows.has(showKey(entry))) &&
      linkedReadsIn(rulesOf(layout)).every((reference) => shows.has(ruleReadKey(reference)))
    );
  });

  private readonly records = toSignal(
    toObservable(
      computed(() => (this.showsKnown() ? this.recordRead() : null), {
        equal: (a, b) =>
          a === b ||
          (a !== null && b !== null && sameIds(a.ids, b.ids) && sameIds(a.schemas, b.schemas)),
      }),
    ).pipe(
      // Until they are, the records read so far stay shown, and nothing is asked for.
      filter((read): read is RecordRead => read !== null),
      switchMap((read) => this.linkedRecords.records(read.ids, read.schemas)),
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
          actions: this.bannerLink(banner.link, document, context),
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
            holds: card.holds ? { holds: card.holds, label: heading ?? humanize(card.id) } : null,
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
            card.checklist !== null ||
            card.holds !== null,
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
      this.shownItems(checklist.field),
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

  /**
   * The items the page shows now over the checklist property `field`, on every card it draws, in
   * the page's order: those a tick writes an entry for where the record has none (layout-v2.md,
   * section 7). A card its rule hides, or a tab's, is not drawn, so its items are not written: a
   * cash deal is not given the finance documents' entries.
   */
  private shownItems(field: string): string[] {
    const page = this.shown();
    const cards = page.tabs ? page.tabs.flatMap((tab) => tab.cards) : page.cards;
    return cards.flatMap((card) =>
      card.checklist !== null && this.cardChecklist(card.id)?.field === field
        ? card.checklist.items.map((shown) => shown.id)
        : [],
    );
  }

  /** The file being downloaded, by its field's place, while it is: its button waits meanwhile. */
  protected readonly downloading = signal<string | null>(null);

  /**
   * A `file` field's download (layout-v2.md, section 3): the property's blob, fetched through the
   * blob service as the reader, `clientReason` `download` as the row action's is, saved under its
   * name through a blob URL revoked at once. The server decides whether the reader may read it; a
   * refusal, or any failure, is said in a toast, and the page stays as it was. One at a time per
   * field. A read, so offered on a read-only page too.
   */
  protected download(field: RecordFieldShown): void {
    const value = field.value;
    if (value.kind !== 'file' || this.downloading() === field.place) return;
    const uid = this.current().uid;
    this.downloading.set(field.place);
    this.injector
      .get(DocumentDetailService)
      .fetchBlobByXpath(uid, value.xpath, { clientReason: 'download' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.downloading.set(null);
          const url = URL.createObjectURL(blob);
          const link = this.injector.get(DOCUMENT).createElement('a');
          link.href = url;
          link.download = value.name;
          link.click();
          URL.revokeObjectURL(url);
        },
        error: (failure: unknown) => {
          this.downloading.set(null);
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(failure)
                ? PERMISSION_DENIED_KEY
                : 'document-layouts.file.download-failed',
            ),
          );
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
   * A banner's link, as its one action: the record the property names, by its title, as a
   * `document-link` shows it, opened through the router as a row of a list opens its record. A
   * value that is not a document's id is never asked for, and shows as unavailable; one still
   * being read shows nothing yet.
   */
  private bannerLink(
    xpath: string | null,
    document: NuxeoDocument,
    context: RecordValueContext,
  ): readonly NxsBannerAction[] {
    if (xpath === null) return [];
    const value = document.properties[xpath];
    if (typeof value !== 'string' || value.trim() === '') return [];
    const record = context.record(value);
    if (record === null) return [];
    const url = record.url;
    return [
      {
        label: record.text,
        icon: 'arrow_forward',
        emphasis: 'outlined',
        cssClass: BANNER_LINK_CLASS,
        disabled: url === null || this.readOnly(),
        press: () => {
          if (url !== null && !this.readOnly()) void this.router.navigateByUrl(url);
        },
      },
    ];
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
      create: card.create
        ? {
            entry: card.create,
            label:
              this.text(card.create.label) ??
              this.translate.instant('document-layouts.create.new', {
                type: docTypeLabel(card.create.type, (key) => this.translate.instant(key)),
              }),
          }
        : null,
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
    const lookups = recordLookups(
      records,
      this.translate.instant('document-layouts.record.unavailable'),
      (title, label) => this.translate.instant('document-layouts.record.version', { title, label }),
    );
    const ruleContext = {
      ...this.ruleContext.context(),
      document,
      today,
      timeZone: this.timeZone,
      // A linked record's property, for a rule that reads one (layout-v2.md, section 5): only what
      // the page's search returned to the reader for that record, as a `show` shows it.
      linked: lookups.linkedValue,
    };
    return {
      locale: this.locale,
      today,
      timeZone: this.timeZone,
      ...labelLookups(labels),
      ...lookups,
      property: (xpath) => document.properties[xpath],
      label: (label) => this.text(label),
      flagText: (flag) =>
        this.translate.instant(flag ? 'document-layouts.yes' : 'document-layouts.no'),
      rule: (rule) =>
        rule === null ||
        (this.linkedDecided(rule, document, records) &&
          this.rules.evaluate(rule as ExtensionRule, ruleContext)),
    };
  }

  /**
   * Whether a rule that reads a linked record's property can be decided yet (layout-v2.md, section
   * 5): its linked types are read, one of them has the property, which is no reference, and the
   * record the open record names is read, or known to be unreadable, or the value is no id. Until
   * then it does not pass, so what it shows waits rather than showing for a moment; and one whose
   * property none of its types has does not pass at all, and the console says why, as a `show` is
   * left out. A rule with no linked property is decided at once.
   */
  private linkedDecided(rule: unknown, document: NuxeoDocument, records: LinkedRecords): boolean {
    const keys = ruleReadKeys(rule);
    if (keys.length === 0) return true;
    const shows = this.shows();
    for (const reference of linkedReadsIn([rule])) {
      const linked = shows?.get(ruleReadKey(reference));
      if (linked === undefined) return false;
      if (!usableShow(linked)) {
        this.tell(
          `a rule reading ${reference.show} of the record ${reference.field} names does not pass: none of the types it links to, ${reference.types.join(', ')}, has it, it is a reference, or their schemas could not be read`,
        );
        return false;
      }
      const id = document.properties[reference.field];
      if (isDocumentId(id) && !records.has(id)) return false;
    }
    return true;
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
    if (field.kind === 'property' && showOf(field) !== null) {
      return this.showLinked(field, layout, document, context, label);
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
   * A `document-link` with `show` (layout-v2.md, section 12): the linked records' property, by its
   * schema type, each a link to its record. Nothing while the linked types are read; left out, and
   * the console told, where none of the types has the property, or it is itself a reference, which
   * would show another record's stored id.
   */
  private showLinked(
    field: ResolvedPropertyField,
    layout: ResolvedRecordLayout,
    document: NuxeoDocument,
    context: RecordValueContext,
    label: string,
  ): RecordFieldShown[] {
    const show = showOf(field) as string;
    const key = `${field.xpath}/${show}`;
    // While its types are read, it shows nothing, never the stored id.
    const linked = this.shows()?.get(showKey(field));
    if (linked === undefined) {
      return [{ place: field.place, key, label, value: { kind: 'records', records: [] } }];
    }
    if (linked === null) {
      this.tell(
        `${layout.type}/view layout: ${field.place} left out: none of the types it links to, ${linkedTypesOf(field).join(', ')}, has ${show}, or their schemas could not be read`,
      );
      return [];
    }
    if (linked.definition.documentReference) {
      this.tell(
        `${layout.type}/view layout: ${field.place} left out: ${show} is itself a reference, and would show another record's stored id`,
      );
      return [];
    }
    const { widget, parameters } = showWidgetOf(field);
    if (widget !== null && !widgetAccepts(widget, linked.definition)) {
      this.tell(
        `${layout.type}/view layout: ${field.place} left out: the widget "${widget}" does not show ${show}, a ${linked.definition.type} property`,
      );
      return [];
    }
    const value = showLinkedProperty(
      document.properties[field.xpath],
      { xpath: show, definition: linked.definition, widget, parameters },
      context,
    );
    return [this.withExtras({ place: field.place, key, label, value })];
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
    // A linked record's value through `status-badge`: each a badge, drawn inside its link.
    if (value.kind === 'records' && value.records.some((record) => record.tone !== undefined))
      return {
        ...field,
        tags: value.records.map((record) =>
          record.tone === undefined
            ? null
            : { label: record.text, status: TAG_STATUS[record.tone] },
        ),
      };
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
