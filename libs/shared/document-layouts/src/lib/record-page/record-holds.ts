import { formatDate } from '@angular/common';
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
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsButtonComponent,
  NxsErrorStateComponent,
  type NxsErrorStatus,
  type NxsHeadingLevel,
  NxsIconComponent,
  NxsSpinnerComponent,
  nxsErrorStatus,
} from '@nuxeo/satori-platform/components';
import { ExtensionRuleContextService } from '@nuxeo/satori-platform/extensions';
import {
  type AuditEntry,
  DocumentChangesService,
  DocumentDetailService,
  type NuxeoDocument,
  hasDocumentPermission,
} from '@nuxeo/satori-platform/nuxeo-client';
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

import { AppActionsService, type AppCardAction } from '../app-actions/app-actions.service';
import { DocumentLayoutService } from '../document-layout.service';
import { RECORD_PAGE_TIME_ZONE, RECORD_TIMELINE_AUDIT_DELAY } from './record-clock';
import type { RecordHoldsEntry } from './record-layout';
import {
  type Labels,
  LinkedRecordLookup,
  LookupCollector,
  NO_LABELS,
  NO_RECORDS,
  labelLookups,
  readLabels,
  sameLookups,
} from './record-lookups';

/** The audit's events for a legal hold placed and released, which the platform writes. */
export const HOLD_EVENTS: readonly string[] = ['afterSetLegalHold', 'afterRemoveLegalHold'];

/** The platform's permission to place and release a legal hold, which it checks itself. */
export const MANAGE_LEGAL_HOLD = 'ManageLegalHold';

/** The retention module's property listing a record's rules, by id. */
export const RULE_IDS = 'record:ruleIds';

/**
 * The year from which a retention's end is the platform's "until an event": a rule on an event
 * retains its records indeterminately until the event happens, as the platform writes it.
 */
const INDETERMINATE_YEAR = 9999;

/** Nuxeo's own account, which no user lookup knows: shown by its name, not asked for. */
const SYSTEM_USER = 'system';

/**
 * What the platform says of a record's retention and hold, at the document's top level (Nuxeo's
 * document JSON, beside `isVersion`): read only, and never written by the page.
 */
export interface RecordRetention {
  /** A record of the platform's: what a retention or a hold is set on. */
  readonly record: boolean;
  /** When its retention ends, as the platform holds it; `null` when it is under none. */
  readonly until: Date | null;
  /** The retention ends with an event, not on a day. */
  readonly indeterminate: boolean;
  /** The day the retention module saved when one ended, `record:retainUntil`; `null` for none. */
  readonly ended: string | null;
  readonly held: boolean;
  /** The first of its rules, by id, the retention module's; `null` for none. */
  readonly rule: string | null;
}

/** The record's retention and hold, as the platform answers them in its document JSON. */
export function retentionOf(document: NuxeoDocument): RecordRetention {
  const raw = document as unknown as Readonly<Record<string, unknown>>;
  const until = typeof raw['retainUntil'] === 'string' ? new Date(raw['retainUntil']) : null;
  const valid = until !== null && !Number.isNaN(until.getTime()) ? until : null;
  const rules = document.properties?.[RULE_IDS];
  const rule = Array.isArray(rules) && typeof rules[0] === 'string' ? rules[0] : null;
  const ended = document.properties?.['record:retainUntil'];
  return {
    record: raw['isRecord'] === true,
    until: valid,
    indeterminate: valid !== null && valid.getUTCFullYear() >= INDETERMINATE_YEAR,
    ended: typeof ended === 'string' && ended !== '' ? ended : null,
    held: raw['hasLegalHold'] === true,
    rule,
  };
}

/** One hold placed or released, as the card shows it. */
export interface RecordHoldShown {
  readonly id: number;
  readonly placed: boolean;
  /** The person, by name once it is read. */
  readonly who: string;
  /** In the reader's own zone. */
  readonly when: string;
  /** The instant as the audit wrote it, for `<time datetime>`. */
  readonly datetime: string;
  /** The reason given, the audit's comment; `null` when none was. */
  readonly reason: string | null;
}

interface HistoryQuery {
  readonly uid: string;
  /** What changes on the record when a hold is placed or released, or its retention changes. */
  readonly revision: string;
  readonly pageSize: number;
}

type HistoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: NxsErrorStatus }
  | { readonly status: 'loaded'; readonly entries: readonly AuditEntry[] };

type HistoryResult =
  | { readonly query: HistoryQuery; readonly entries: readonly AuditEntry[] }
  | { readonly query: HistoryQuery; readonly error: NxsErrorStatus };

const sameQuery = (a: HistoryQuery, b: HistoryQuery): boolean =>
  a.uid === b.uid && a.revision === b.revision && a.pageSize === b.pageSize;

/**
 * A holds card (layout-v2.md, section 7): a record's retention, its rule and when it ends, and its
 * legal hold, with the holds placed and released, newest first, each with who, when and the
 * reason. All of it is the platform's: the retention and the hold from the document as the server
 * answers it, the rule's title from the rule itself, and the holds from the record's audit, the
 * events `afterSetLegalHold` and `afterRemoveLegalHold`, whose comment is the reason given.
 *
 * It offers the actions the file names, `place` while the record has no hold and `release` while
 * it has one, each an action of the app's `actions.json` shown on a card, which the app registry
 * served only if the server's allow-list lets it run (decision 3): to someone the record's
 * permissions say holds `ManageLegalHold`, the platform's own permission for holds, on a record
 * that is neither a version nor in the trash, on a page that is not read-only. Each runs through
 * `AgenticUi.RunAction`, with its dialog and its reason, as a toolbar's button does.
 *
 * None of it is a security control. The server checks the allow-list and the person's permission,
 * and refuses, on the server, a deletion or a change the hold forbids.
 */
@Component({
  selector: 'lib-record-holds',
  standalone: true,
  imports: [
    NxsButtonComponent,
    NxsErrorStateComponent,
    NxsIconComponent,
    NxsSpinnerComponent,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './record-holds.html',
  styleUrl: './record-holds.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordHoldsComponent {
  readonly document = input.required<NuxeoDocument>();
  readonly holds = input.required<RecordHoldsEntry>();
  /** The card's name, its heading or id, which the list of holds is named after. */
  readonly label = input.required<string>();
  /** The card's id, unique on the page, which the ids of the card's own elements start from. */
  readonly cardId = input('holds');
  /** A page that changes nothing, as the layout designer's preview: no action is offered. */
  readonly readOnly = input(false);
  /** The level of the heading over the holds placed and released: one below the card's. */
  readonly headingLevel = input<NxsHeadingLevel>(4);

  private readonly audit = inject(DocumentDetailService);
  private readonly layouts = inject(DocumentLayoutService);
  private readonly linkedRecords = inject(LinkedRecordLookup);
  private readonly actions = inject(AppActionsService);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly timeZone = inject(RECORD_PAGE_TIME_ZONE);
  private readonly auditDelay = inject(RECORD_TIMELINE_AUDIT_DELAY);

  /** Bumped when the language or a catalogue changes, so texts resolved with `instant` follow. */
  private readonly translations = signal(0);

  protected readonly retention = computed(() => retentionOf(this.document()));

  /** The heading of the holds placed and released: one level below the card's, which names it. */
  protected readonly stateHeadingLevel = computed(
    () => Math.min(this.headingLevel() + 1, 6) as NxsHeadingLevel,
  );

  /** What the card says of the retention, in one sentence. */
  protected readonly retentionText = computed(() => {
    this.translations();
    const retention = this.retention();
    if (retention.until !== null) {
      return retention.indeterminate
        ? this.translate.instant('document-layouts.holds.retention-event')
        : this.translate.instant('document-layouts.holds.retention-until', {
            date: formatDate(retention.until, 'longDate', this.locale, this.timeZone),
          });
    }
    if (retention.ended !== null) {
      const day = new Date(`${retention.ended.slice(0, 10)}T00:00:00Z`);
      return this.translate.instant('document-layouts.holds.retention-ended', {
        date: Number.isNaN(day.getTime())
          ? retention.ended
          : formatDate(day, 'longDate', this.locale, 'UTC'),
      });
    }
    return this.translate.instant(
      retention.record
        ? 'document-layouts.holds.retention-none-set'
        : 'document-layouts.holds.retention-none',
    );
  });

  /** The record's rule, read by id as a `document-link` reads one, for its title and its page. */
  private readonly rules = toSignal(
    toObservable(computed(() => this.retention().rule)).pipe(
      switchMap((rule) => (rule === null ? of(NO_RECORDS) : this.linkedRecords.records([rule]))),
    ),
    { initialValue: NO_RECORDS },
  );

  protected readonly rule = computed(() => {
    const id = this.retention().rule;
    if (id === null) return null;
    this.translations();
    const record = this.rules().get(id) ?? null;
    return record
      ? { text: record.title, url: record.url }
      : { text: this.translate.instant('document-layouts.record.unavailable'), url: null };
  });

  /**
   * The action the card offers now: placing a hold while the record has none, releasing it while
   * it has one. `null` when the file names none for that, the app registry served none, its rule
   * does not pass, or the person or the record cannot take one.
   */
  protected readonly action = computed<AppCardAction | null>(() => {
    const document = this.document();
    const { place, release } = this.holds();
    const id = this.retention().held ? release : place;
    if (
      id === null ||
      this.readOnly() ||
      document.isVersion === true ||
      document.isProxy === true ||
      document.isTrashed === true ||
      !hasDocumentPermission(document, MANAGE_LEGAL_HOLD)
    )
      return null;
    this.translations();
    return this.actions.cardAction(id, { ...this.ruleContext.context(), document });
  });

  private readonly query = computed<HistoryQuery>(
    () => {
      const document = this.document();
      const raw = document as unknown as Readonly<Record<string, unknown>>;
      return {
        uid: document.uid,
        revision: JSON.stringify([
          raw['hasLegalHold'] ?? null,
          raw['retainUntil'] ?? null,
          document.lastModified,
        ]),
        pageSize: this.holds().pageSize,
      };
    },
    { equal: sameQuery },
  );

  protected readonly history = signal<HistoryState>({ status: 'loading' });

  private readonly asks = new Subject<HistoryQuery>();
  private asked: HistoryQuery | null = null;

  /** The people the holds name, read once each. */
  private readonly lookups = computed(
    () => {
      const state = this.history();
      const collector = new LookupCollector();
      if (state.status === 'loaded')
        for (const entry of state.entries)
          if (entry.principalName !== SYSTEM_USER)
            collector.value('user', {}, { type: 'string' }, entry.principalName);
      return collector.lookups();
    },
    { equal: sameLookups },
  );

  private readonly labels = toSignal(
    toObservable(this.lookups).pipe(
      switchMap((lookups) => readLabels(this.layouts, lookups)),
      scan((read: Labels, labels: Labels): Labels => new Map([...read, ...labels]), NO_LABELS),
    ),
    { initialValue: NO_LABELS },
  );

  protected readonly entries = computed<readonly RecordHoldShown[]>(() => {
    const state = this.history();
    if (state.status !== 'loaded') return [];
    this.translations();
    const { principal } = labelLookups(this.labels());
    return state.entries.map((entry) => {
      const date = new Date(entry.eventDate);
      return {
        id: entry.id,
        placed: entry.eventId === 'afterSetLegalHold',
        who: principal('user', entry.principalName),
        when: Number.isNaN(date.getTime())
          ? entry.eventDate
          : formatDate(date, 'medium', this.locale, this.timeZone),
        datetime: entry.eventDate,
        reason: typeof entry.comment === 'string' && entry.comment.trim() ? entry.comment : null,
      };
    });
  });

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));

    // The first read shows a spinner; a read for the same record changed keeps what is shown until
    // it answers. The audit is written a moment after the change, so each is asked again after the
    // audit's delay.
    this.asks
      .pipe(
        switchMap((query) =>
          concat(
            this.read(query),
            this.auditDelay === null
              ? EMPTY
              : timer(this.auditDelay).pipe(switchMap(() => this.read(query))),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.received(result));

    toObservable(this.query)
      .pipe(takeUntilDestroyed())
      .subscribe((query) => {
        const fresh = this.asked === null || this.asked.uid !== query.uid;
        this.asked = query;
        if (fresh) this.history.set({ status: 'loading' });
        this.asks.next(query);
      });

    // An action that ran, a hold placed say, may show in the history before the record is read again.
    inject(DocumentChangesService)
      .changes.pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.asked) this.asks.next(this.asked);
      });
  }

  protected run(action: AppCardAction): void {
    if (!action.enabled) return;
    const document = this.document();
    this.actions.runOnCard(action.id, { ...this.ruleContext.context(), document });
  }

  protected retry(): void {
    if (!this.asked) return;
    this.history.set({ status: 'loading' });
    this.asks.next(this.asked);
  }

  private read(query: HistoryQuery): Observable<HistoryResult> {
    return this.audit
      .getAuditLog(query.uid, query.pageSize, 0, {
        eventIds: HOLD_EVENTS,
        sortBy: 'eventDate',
        sortOrder: 'desc',
      })
      .pipe(
        map((page): HistoryResult => ({ query, entries: page.entries ?? [] })),
        catchError((error: unknown) => of<HistoryResult>({ query, error: nxsErrorStatus(error) })),
      );
  }

  private received(result: HistoryResult): void {
    if (this.asked === null || result.query.uid !== this.asked.uid) return;
    if ('error' in result) {
      // A later read that fails leaves the holds shown: they are still the record's.
      if (this.history().status !== 'loaded')
        this.history.set({ status: 'failed', error: result.error });
      return;
    }
    this.history.set({ status: 'loaded', entries: result.entries });
  }
}
