import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsEmptyStateComponent,
  NxsErrorStateComponent,
  type NxsErrorStatus,
  type NxsHeadingLevel,
  NxsSpinnerComponent,
  nxsErrorStatus,
} from '@nuxeo/satori-platform/components';
import {
  type AuditEntry,
  type AuditLogList,
  DocumentDetailService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { lifecycleLabel } from '@nuxeo/satori-platform/ui';
import { Subject, catchError, map, merge, of, switchMap } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { humanize } from '../resolve-layout';
import { RECORD_PAGE_TIME_ZONE } from './record-clock';
import type { RecordTimelineEntry } from './record-layout';
import {
  LookupCollector,
  NO_LABELS,
  labelLookups,
  readLabels,
  sameLookups,
} from './record-lookups';

/** What one page of the timeline is asked with. Compared by value, so an equal one is not sent twice. */
interface TimelineQuery {
  readonly uid: string;
  /**
   * What changes on the record the page is given when it is edited, follows a transition, is
   * locked, checked in or out, or put in or out of the trash. The timeline is asked again then; the
   * document page hands over a reloaded record after an edit or a transition.
   */
  readonly revision: string;
  readonly events: readonly string[];
  readonly pageSize: number;
}

type TimelineState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: NxsErrorStatus }
  | {
      readonly status: 'loaded';
      /** Newest first, each once. */
      readonly entries: readonly AuditEntry[];
      /** The next page to ask for, or `null` when there is none. */
      readonly next: number | null;
      readonly loadingMore: boolean;
      /** The last "Show more" failed: the entries stay, and the button asks again. */
      readonly moreFailed: boolean;
    };

/** One entry as the timeline shows it. */
export interface RecordTimelineEntryShown {
  readonly id: number;
  readonly event: string;
  /** The kind of event, labelled. */
  readonly what: string;
  /** The user, by name once it is read. */
  readonly who: string;
  /** In the reader's own zone. */
  readonly when: string;
  /** The instant as the audit wrote it, for `<time datetime>`. */
  readonly datetime: string;
  /** For a lifecycle transition: the states it left and reached, labelled; `from` when known. */
  readonly transition: { readonly from: string | null; readonly to: string } | null;
  /** The audit's own comment, such as a check-in's. */
  readonly comment: string | null;
}

/** The audit's event for a lifecycle transition. Nuxeo records only the state it reached. */
const TRANSITION_EVENT = 'lifecycle_transition_event';

/** Nuxeo's own account, which no user lookup knows: shown by its name, not asked for. */
const SYSTEM_USER = 'system';

const sameQuery = (a: TimelineQuery, b: TimelineQuery): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * A record's history, newest first (layout-v2.md, section 7): the server's audit for the record,
 * filtered on the server by the kinds of event the file names, a page at a time behind "Show more".
 *
 * Each entry says who acted, by name; what they did, with the audit's comment; and when, in the
 * reader's own zone (AGENTS/08-bug-patterns.md, pattern 29). A lifecycle transition says the state
 * it reached and, where the entry before it is loaded, the state it left: Nuxeo audits a transition
 * with the state it reached only, and the entry before it was written in the state it left.
 *
 * The audit returns only what the user may read: nothing here is a security control.
 */
@Component({
  selector: 'lib-record-timeline',
  standalone: true,
  imports: [
    MatButton,
    MatFormField,
    MatLabel,
    MatOption,
    MatSelect,
    NxsEmptyStateComponent,
    NxsErrorStateComponent,
    NxsSpinnerComponent,
    TranslatePipe,
  ],
  templateUrl: './record-timeline.html',
  styleUrl: './record-timeline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordTimelineComponent {
  readonly document = input.required<NuxeoDocument>();
  readonly timeline = input.required<RecordTimelineEntry>();
  /** The list's name for assistive technology: the card's heading. */
  readonly label = input.required<string>();
  /** The level of the heading of an empty or failed timeline: one below the card's. */
  readonly stateHeadingLevel = input<NxsHeadingLevel>(4);

  private readonly audit = inject(DocumentDetailService);
  private readonly layouts = inject(DocumentLayoutService);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly timeZone = inject(RECORD_PAGE_TIME_ZONE);

  /** The kind of event the reader chose, or `''` for every kind the card shows. */
  protected readonly kind = linkedSignal({
    source: () => this.timeline().events,
    computation: (): string => '',
  });

  /** The kinds the filter offers, labelled; empty when the card offers no filter. */
  protected readonly kinds = computed(() => {
    const { events, filter } = this.timeline();
    this.translations();
    return filter && events.length > 1
      ? events.map((id) => ({ id, label: this.eventLabel(id) }))
      : [];
  });

  private readonly query = computed<TimelineQuery>(
    () => {
      const document = this.document();
      const { events, pageSize } = this.timeline();
      const kind = this.kind();
      return {
        uid: document.uid,
        revision: JSON.stringify([
          document.lastModified,
          document.state ?? null,
          document.lockOwner ?? null,
          document.isCheckedOut ?? null,
          document.isTrashed ?? null,
        ]),
        events: kind ? [kind] : events,
        pageSize,
      };
    },
    { equal: sameQuery },
  );

  protected readonly state = signal<TimelineState>({ status: 'loading' });

  private readonly pages = new Subject<{ readonly query: TimelineQuery; readonly index: number }>();
  /** The query the shown entries answer, which "Show more" and Retry ask again with. */
  private asked: TimelineQuery | null = null;

  /** Bumped when the language or a catalogue changes, so labels resolved with `instant` follow. */
  private readonly translations = signal(0);

  /** The users the entries name, read once each; `system` is not a user anyone can look up. */
  private readonly lookups = computed(
    () => {
      const state = this.state();
      const collector = new LookupCollector();
      if (state.status === 'loaded') {
        for (const entry of state.entries) {
          if (entry.principalName !== SYSTEM_USER)
            collector.value('user', {}, { type: 'string' }, entry.principalName);
        }
      }
      return collector.lookups();
    },
    { equal: sameLookups },
  );

  private readonly labels = toSignal(
    toObservable(this.lookups).pipe(switchMap((lookups) => readLabels(this.layouts, lookups))),
    { initialValue: NO_LABELS },
  );

  protected readonly entries = computed<readonly RecordTimelineEntryShown[]>(() => {
    const state = this.state();
    if (state.status !== 'loaded') return [];
    this.translations();
    const { principal } = labelLookups(this.labels());
    return state.entries.map((entry, index) => {
      const older = state.entries[index + 1];
      const date = new Date(entry.eventDate);
      return {
        id: entry.id,
        event: entry.eventId,
        what: this.eventLabel(entry.eventId),
        who: principal('user', entry.principalName),
        when: Number.isNaN(date.getTime())
          ? entry.eventDate
          : formatDate(date, 'medium', this.locale, this.timeZone),
        datetime: entry.eventDate,
        transition:
          entry.eventId === TRANSITION_EVENT && entry.docLifeCycle
            ? {
                from: older?.docLifeCycle ? this.stateLabel(older.docLifeCycle) : null,
                to: this.stateLabel(entry.docLifeCycle),
              }
            : null,
        comment: typeof entry.comment === 'string' && entry.comment.trim() ? entry.comment : null,
      };
    });
  });

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));

    this.pages
      .pipe(
        // A new query, the record changed or the reader chose another kind, drops a page still
        // on its way for the old one.
        switchMap(({ query, index }) =>
          this.audit
            .getAuditLog(query.uid, query.pageSize, index, {
              eventIds: query.events,
              sortBy: 'eventDate',
              sortOrder: 'desc',
            })
            .pipe(
              map((page) => ({ index, page })),
              catchError((error: unknown) => of({ index, error: nxsErrorStatus(error) })),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.received(result));

    toObservable(this.query)
      .pipe(takeUntilDestroyed())
      .subscribe((query) => this.ask(query, 0));
  }

  protected showMore(): void {
    const state = this.state();
    if (state.status !== 'loaded' || state.next === null || state.loadingMore || !this.asked)
      return;
    this.state.set({ ...state, loadingMore: true, moreFailed: false });
    this.pages.next({ query: this.asked, index: state.next });
  }

  protected retry(): void {
    if (this.asked) this.ask(this.asked, 0);
  }

  private ask(query: TimelineQuery, index: number): void {
    this.asked = query;
    this.state.set({ status: 'loading' });
    this.pages.next({ query, index });
  }

  private received(
    result:
      | { readonly index: number; readonly page: AuditLogList }
      | { readonly index: number; readonly error: NxsErrorStatus },
  ): void {
    const state = this.state();
    const shown = result.index > 0 && state.status === 'loaded' ? state.entries : [];
    if ('error' in result) {
      this.state.set(
        result.index > 0 && state.status === 'loaded'
          ? { ...state, loadingMore: false, moreFailed: true }
          : { status: 'failed', error: result.error },
      );
      return;
    }
    const { page, index } = result;
    // A page asked for later may repeat an entry, when one was recorded in between.
    const seen = new Set(shown.map((entry) => entry.id));
    const entries = [...shown, ...(page.entries ?? []).filter((entry) => !seen.has(entry.id))];
    const total = page.resultsCount ?? page.totalSize;
    const more =
      page.isNextPageAvailable === true ||
      (page.isNextPageAvailable === undefined &&
        typeof total === 'number' &&
        entries.length < total);
    this.state.set({
      status: 'loaded',
      entries,
      next: more ? index + 1 : null,
      loadingMore: false,
      moreFailed: false,
    });
  }

  /** `document-layouts.timeline.event.<ID>`, or the ID written out: `documentModified` is "Document modified". */
  private eventLabel(id: string): string {
    const key = `document-layouts.timeline.event.${id}`;
    const text = this.translate.instant(key);
    return typeof text === 'string' && text !== '' && text !== key ? text : humanize(id);
  }

  private stateLabel(name: string): string {
    return lifecycleLabel('state', name, (key) => this.translate.instant(key));
  }
}
