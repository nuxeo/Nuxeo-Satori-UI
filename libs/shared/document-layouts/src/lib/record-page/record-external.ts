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
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NXS_PRIMITIVE_IDS,
  NxsEmptyStateComponent,
  NxsErrorStateComponent,
  type NxsErrorStatus,
  type NxsHeadingLevel,
  NxsSpinnerComponent,
  type NxsTagStatus,
  nxsErrorStatus,
} from '@nuxeo/satori-platform/components';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { catchError, combineLatest, concat, map, merge, of, switchMap } from 'rxjs';

import { layoutLabelText } from '../layout-label';
import { humanize } from '../resolve-layout';
import {
  type ConnectorAnswer,
  ConnectorRecordService,
  type ConnectorValue,
} from './connector-record.service';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from './record-clock';
import {
  type RecordValueContext,
  type RecordValueView,
  computedDefinition,
  relativeDateText,
  showValue,
} from './record-field-view';
import type { RecordExternalEntry, RecordExternalField } from './record-layout';
import { TAG_STATUS } from './record-tags';
import { widgetAccepts } from './widget-support';

/** What the card is asked with. Compared by value, so an equal one is not sent twice. */
interface ExternalQuery {
  readonly uid: string;
  /** The record's modification date: an edit may change the key, so the card is asked again. */
  readonly revision: string;
  readonly connector: string;
}

type ExternalState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: NxsErrorStatus }
  | { readonly status: 'loaded'; readonly answer: ConnectorAnswer };

/** One field as the card shows it. */
export interface RecordExternalFieldShown {
  /** Where the entry is in the file: unique on the page, so it is what the card tracks a field by. */
  readonly place: string;
  /** The field's name in the connector's answer: what `data-field` names. */
  readonly name: string;
  readonly label: string;
  /** `text`, `multiline`, `flag` or `badge`: what the widgets a card from another system takes give. */
  readonly value: RecordValueView;
  /** For a `badge`: the inputs of the design system's status tag. */
  readonly tag?: { readonly label: string; readonly status: NxsTagStatus };
}

/** The widget a value is shown through when its field names none: by what the value is. */
function widgetFor(value: ConnectorValue): string {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'text';
}

/**
 * A card of fields from another system (layout-v2.md, section 7): a record of a system of record,
 * read on the server through one of its connectors, `Connector.Read`, for the open record.
 *
 * It names the connector and the record, and nothing else; the server decides where that system
 * is, which key it sends and which fields come back, once it has checked the reader's permission
 * on the record. The card shows, in the file's order, each field the answer has a value for,
 * through its widget, as text: never as HTML or a link, since the value is another system's.
 *
 * Its states: loading; the fields; nothing found, when the system has no such record or none of the
 * fields has a value; nothing to look up, when the record holds no key; and an error, with Retry
 * for one that is not the reader's doing. It is asked again when it is given another record, the
 * same record modified, or another connector.
 *
 * Under the fields, or under nothing found, it says how old the other system's answer is, from the
 * answer's `age`: the server may have kept it for a while (nuxeo-agentic-connectors' cache). An
 * answer with no age, from a server older than the cache, says nothing of it. The file has nothing to
 * set for it.
 */
@Component({
  selector: 'lib-record-external',
  standalone: true,
  imports: [
    ExtensionOutletComponent,
    NxsEmptyStateComponent,
    NxsErrorStateComponent,
    NxsSpinnerComponent,
    TranslatePipe,
  ],
  templateUrl: './record-external.html',
  styleUrl: './record-external.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordExternalComponent {
  readonly document = input.required<NuxeoDocument>();
  readonly external = input.required<RecordExternalEntry>();
  /** Where the card is written, for the console. */
  readonly source = input.required<string>();
  readonly stateHeadingLevel = input<NxsHeadingLevel>(4);

  protected readonly statusTagId = NXS_PRIMITIVE_IDS.statusTag;

  private readonly connectors = inject(ConnectorRecordService);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly today = inject(RECORD_PAGE_TODAY);
  private readonly timeZone = inject(RECORD_PAGE_TIME_ZONE);

  /** What the console has been told, so that a card drawn again for a label does not repeat it. */
  private readonly told = new Set<string>();

  /** Bumped when the language or a catalogue changes, so labels resolved with `instant` follow. */
  private readonly translations = signal(0);

  /** Bumped by Retry, so the same query is sent again. */
  private readonly attempt = signal(0);

  private readonly query = computed<ExternalQuery>(
    () => ({
      uid: this.document().uid,
      revision: this.document().lastModified,
      connector: this.external().connector,
    }),
    {
      equal: (a, b) => a.uid === b.uid && a.revision === b.revision && a.connector === b.connector,
    },
  );

  protected readonly state = toSignal(
    combineLatest([toObservable(this.query), toObservable(this.attempt)]).pipe(
      switchMap(([query]) =>
        concat(
          of<ExternalState>({ status: 'loading' }),
          this.connectors.read(query.connector, query.uid).pipe(
            map((answer): ExternalState => ({ status: 'loaded', answer })),
            catchError((error: unknown) =>
              of<ExternalState>({ status: 'failed', error: nxsErrorStatus(error) }),
            ),
          ),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as ExternalState },
  );

  /** The fields the answer gives a value, in the file's order, through their widgets. */
  protected readonly fields = computed<readonly RecordExternalFieldShown[]>(() => {
    this.translations();
    const state = this.state();
    if (state.status !== 'loaded' || state.answer.status !== 'found') return [];
    const values = state.answer.fields;
    const context = this.valueContext(this.document());
    return this.external().fields.flatMap((field) =>
      Object.hasOwn(values, field.name) ? this.show(field, values[field.name], context) : [],
    );
  });

  /** Which empty state a loaded answer with no field to show gets: none, or the key's absence. */
  protected readonly emptyHeading = computed(() => {
    const state = this.state();
    return state.status === 'loaded' && state.answer.status === 'no-key'
      ? 'document-layouts.external.no-key'
      : 'document-layouts.external.empty';
  });

  /**
   * How old the answer is, as the card says it: "just now" under a minute, else the largest whole
   * unit, as a `relative-date` says it; `null` for an answer with no age.
   */
  protected readonly ageText = computed<string | null>(() => {
    this.translations();
    const state = this.state();
    if (state.status !== 'loaded' || state.answer.age === undefined) return null;
    const { age } = state.answer;
    if (age < 60) return this.translate.instant('document-layouts.external.age-now');
    const today = this.today();
    const when = relativeDateText(new Date(today.getTime() - age * 1000), today, this.locale);
    return this.translate.instant('document-layouts.external.age', { when });
  });

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  private show(
    field: RecordExternalField,
    value: ConnectorValue,
    context: RecordValueContext,
  ): RecordExternalFieldShown[] {
    const widget = field.widget ?? widgetFor(value);
    const definition = computedDefinition(value, widget);
    if (!widgetAccepts(widget, definition)) {
      this.tell(
        `${this.source()}: ${field.place} left out: the widget "${widget}" does not show the ${definition.type} the connector gave`,
      );
      return [];
    }
    const label = layoutLabelText(this.translate, field.label) ?? humanize(field.name);
    const view = showValue(
      { key: field.name, label, value, parameters: field.parameters, definition },
      widget,
      context,
    );
    if (view.kind === 'empty') return [];
    const shown = { place: field.place, name: field.name, label, value: view };
    return view.kind === 'badge'
      ? [{ ...shown, tag: { label: view.text, status: TAG_STATUS[view.tone] } }]
      : [shown];
  }

  /**
   * What a widget reads besides its value. A card from another system takes no widget that looks a
   * value up or links it, so the lookups answer with the value as it is; a `currency` parameter
   * that names a property reads it from the open record.
   */
  private valueContext(document: NuxeoDocument): RecordValueContext {
    return {
      locale: this.locale,
      today: this.today(),
      timeZone: this.timeZone,
      vocabulary: (_directory, id) => id,
      principal: (_kind, id) => id,
      record: () => null,
      property: (xpath) => document.properties[xpath],
      label: (label) => layoutLabelText(this.translate, label),
      flagText: (flag) =>
        this.translate.instant(flag ? 'document-layouts.yes' : 'document-layouts.no'),
      rule: () => true,
    };
  }

  private tell(message: string): void {
    if (this.told.has(message)) return;
    this.told.add(message);
    console.warn(`[agentic-ui-layouts] ${message}`);
  }
}
