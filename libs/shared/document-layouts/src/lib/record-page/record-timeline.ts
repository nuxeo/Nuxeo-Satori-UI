import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  LOCALE_ID,
  afterNextRender,
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
  DocumentChangesService,
  DocumentDetailService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { lifecycleLabel } from '@nuxeo/satori-platform/ui';
import {
  EMPTY,
  type Observable,
  Subject,
  catchError,
  concat,
  map,
  merge,
  of,
  scan,
  switchMap,
  timer,
} from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { humanize } from '../resolve-layout';
import { RECORD_PAGE_TIME_ZONE, RECORD_TIMELINE_AUDIT_DELAY } from './record-clock';
import type { RecordTimelineEntry } from './record-layout';
import {
  type Labels,
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
   * locked, checked in or out, or put in or out of the trash. The timeline is refreshed when it
   * changes; the document page hands over a reloaded record after an edit or a transition, and not
   * after a lock.
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

/** One page as the audit answered it, for the query and the page it was asked with. */
type PageResult =
  | { readonly query: TimelineQuery; readonly index: number; readonly page: AuditLogList }
  | { readonly query: TimelineQuery; readonly index: number; readonly error: NxsErrorStatus };

/** One entry as the timeline shows it. */
export interface RecordTimelineEntryShown {
  readonly id: number;
  readonly event: string;
  /**
   * What happened: the kind of event, labelled, or for a lifecycle transition one sentence with
   * its states, so that a translation orders it as its language does.
   */
  readonly what: string;
  /** The user, by name once it is read. */
  readonly who: string;
  /** In the reader's own zone. */
  readonly when: string;
  /** The instant as the audit wrote it, for `<time datetime>`. */
  readonly datetime: string;
  /** The audit's own comment, such as a check-in's. */
  readonly comment: string | null;
}

/** The audit's event for a lifecycle transition. Nuxeo records only the state it reached. */
const TRANSITION_EVENT = 'lifecycle_transition_event';

/** Nuxeo's own account, which no user lookup knows: shown by its name, not asked for. */
const SYSTEM_USER = 'system';

const sameQuery = (a: TimelineQuery, b: TimelineQuery): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Whether two queries ask for the same list, whatever the record's revision. */
const sameList = (a: TimelineQuery, b: TimelineQuery): boolean =>
  a.uid === b.uid &&
  a.pageSize === b.pageSize &&
  JSON.stringify(a.events) === JSON.stringify(b.events);

/**
 * A record's history, newest first (layout-v2.md, section 7): the server's audit for the record,
 * filtered on the server by the kinds of event the file names, a page at a time behind "Show more".
 *
 * Each entry says who acted, by name; what they did, with the audit's comment; and when, in the
 * reader's own zone (AGENTS/08-bug-patterns.md, pattern 29). A lifecycle transition says the state
 * it reached and, where the entry before it is shown, the state it left: Nuxeo audits a transition
 * with the state it reached only, and the entry before it was written in the state it left.
 *
 * When the record it is given changes, the timeline is refreshed in place: asked again at once,
 * and once more {@link RECORD_TIMELINE_AUDIT_DELAY} later, since Nuxeo writes its audit a moment
 * after the change. A timeline drawn anew, or given another record, is asked once more after that
 * delay too, as its host may have drawn it for a change; another kind chosen in the filter is not.
 * So is one shown when the page says documents changed (`DocumentChangesService`), as a row action
 * or an app's operation button does after it runs: what it did may be in the history alone.
 * What a refresh brings joins the entries shown, which stay, unless more was recorded than a page
 * holds: the timeline then starts again from that first page.
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
  private readonly auditDelay = inject(RECORD_TIMELINE_AUDIT_DELAY);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The kind of event the reader chose, or `''` for every kind the card shows. */
  protected readonly kind = linkedSignal({
    source: () => this.timeline().events,
    computation: (): string => '',
  });

  /**
   * The kinds the filter offers, labelled. Empty when the file asks for no filter, and when it
   * shows one kind only, where a filter would have nothing to choose.
   */
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

  /** The first page of a list, and each "Show more": a new list drops a page still on its way. */
  private readonly pages = new Subject<{ readonly query: TimelineQuery; readonly index: number }>();
  /**
   * The first page again: `now` for the same list after the record changed, and in any case once
   * more after the audit's delay. `null` stops the one on its way.
   */
  private readonly refreshes = new Subject<{
    readonly query: TimelineQuery;
    readonly now: boolean;
  } | null>();
  /** The latest query: what "Show more" and Retry ask with, and what a page must answer. */
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

  /**
   * The names read so far. Each new set of lookups starts with none, so the names already read are
   * kept, and a name shown never turns back into a username while another one is read.
   */
  private readonly labels = toSignal(
    toObservable(this.lookups).pipe(
      switchMap((lookups) => readLabels(this.layouts, lookups)),
      scan((read: Labels, labels: Labels): Labels => new Map([...read, ...labels]), NO_LABELS),
    ),
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
        what: this.whatHappened(entry, older),
        who: principal('user', entry.principalName),
        when: Number.isNaN(date.getTime())
          ? entry.eventDate
          : formatDate(date, 'medium', this.locale, this.timeZone),
        datetime: entry.eventDate,
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
        switchMap(({ query, index }) => this.page(query, index)),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.received(result));

    this.refreshes
      .pipe(
        switchMap((refresh) =>
          refresh
            ? concat(
                refresh.now ? this.page(refresh.query, 0) : EMPTY,
                this.auditDelay === null
                  ? EMPTY
                  : timer(this.auditDelay).pipe(switchMap(() => this.page(refresh.query, 0))),
              )
            : EMPTY,
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.refreshed(result));

    toObservable(this.query)
      .pipe(takeUntilDestroyed())
      .subscribe((query) => {
        const previous = this.asked;
        this.asked = query;
        // The same list for a changed record: refreshed in place. Any other list starts again.
        if (previous && sameList(previous, query) && this.state().status === 'loaded') {
          this.refreshes.next({ query, now: true });
          return;
        }
        this.ask(query);
        // A timeline drawn anew, or given another record, is asked once more after the audit's
        // delay, since its host may have drawn it for a change: the document page draws its record
        // page again after each reload of the record. Another kind chosen in the filter is not:
        // the record is the same.
        const anotherKind =
          previous !== null && previous.uid === query.uid && previous.revision === query.revision;
        this.refreshes.next(anotherKind ? null : { query, now: false });
      });

    // A change made on the page, by a list's row action or an app's operation button, may be in
    // the history alone: a chain that records a request changes nothing the revision reads. So the
    // timeline is refreshed in place, as after a change to the record.
    inject(DocumentChangesService)
      .changes.pipe(takeUntilDestroyed())
      .subscribe(() => {
        const query = this.asked;
        if (query && this.state().status === 'loaded') this.refreshes.next({ query, now: true });
      });
  }

  protected showMore(): void {
    const state = this.state();
    if (state.status !== 'loaded' || state.next === null || state.loadingMore || !this.asked)
      return;
    this.state.set({ ...state, loadingMore: true, moreFailed: false });
    this.pages.next({ query: this.asked, index: state.next });
  }

  protected retry(): void {
    if (this.asked) this.ask(this.asked);
  }

  private ask(query: TimelineQuery): void {
    this.state.set({ status: 'loading' });
    this.pages.next({ query, index: 0 });
  }

  private page(query: TimelineQuery, index: number): Observable<PageResult> {
    return this.audit
      .getAuditLog(query.uid, query.pageSize, index, {
        eventIds: query.events,
        sortBy: 'eventDate',
        sortOrder: 'desc',
      })
      .pipe(
        map((page): PageResult => ({ query, index, page })),
        catchError((error: unknown) =>
          of<PageResult>({ query, index, error: nxsErrorStatus(error) }),
        ),
      );
  }

  /** Whether a result answers the list shown now, rather than one the reader or the record left. */
  private current(result: PageResult): boolean {
    return this.asked !== null && sameList(result.query, this.asked);
  }

  private received(result: PageResult): void {
    if (!this.current(result)) return;
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
    const added = (page.entries ?? []).filter((entry) => !seen.has(entry.id));
    const total = page.resultsCount ?? page.totalSize;
    const entries = [...shown, ...added];
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
    // "Show more" was the focus, and may be gone: the reader goes on from the first entry it added.
    if (index > 0 && added.length > 0) this.focusEntry(added[0].id);
  }

  /**
   * A refresh's first page. Where it shares an entry with those shown, what it has that is not
   * shown joins them, newest first, as the audit orders them, and the pages shown stay: a later
   * page repeats the entries it was pushed by, and they are shown once. Where it shares none, more
   * was recorded than a page holds, or nothing was shown: it takes their place as the first page,
   * so that no entry between is skipped. One that fails leaves the timeline as it is, since what
   * it shows is still the record's history.
   */
  private refreshed(result: PageResult): void {
    const state = this.state();
    if (!this.current(result) || 'error' in result || state.status !== 'loaded') return;
    const fresh = result.page.entries ?? [];
    const seen = new Set(state.entries.map((entry) => entry.id));
    if (!fresh.some((entry) => seen.has(entry.id))) {
      if (fresh.length > 0) this.received({ ...result, index: 0 });
      return;
    }
    const added = fresh.filter((entry) => !seen.has(entry.id));
    if (added.length === 0) return;
    const time = (entry: AuditEntry): number => new Date(entry.eventDate).getTime() || 0;
    const entries = [...added, ...state.entries].sort((a, b) => time(b) - time(a) || b.id - a.id);
    this.state.set({ ...state, entries });
  }

  /**
   * Focuses an entry "Show more" added, while the reader is still where they pressed it: on the
   * button, or nowhere once it went with the last page. A reader who has moved on keeps their
   * focus.
   */
  private focusEntry(id: number): void {
    afterNextRender(
      () => {
        const host = this.host.nativeElement;
        const active = host.ownerDocument.activeElement;
        const stayed =
          active === null ||
          active === host.ownerDocument.body ||
          (host.contains(active) && active.classList.contains('record-timeline__more'));
        if (stayed) host.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)?.focus();
      },
      { injector: this.injector },
    );
  }

  /** The kind of event, or for a transition the sentence that names its states. */
  private whatHappened(entry: AuditEntry, older: AuditEntry | undefined): string {
    if (entry.eventId !== TRANSITION_EVENT || !entry.docLifeCycle)
      return this.eventLabel(entry.eventId);
    const to = this.stateLabel(entry.docLifeCycle);
    return older?.docLifeCycle
      ? this.translate.instant('document-layouts.timeline.transition', {
          from: this.stateLabel(older.docLifeCycle),
          to,
        })
      : this.translate.instant('document-layouts.timeline.reached', { to });
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
