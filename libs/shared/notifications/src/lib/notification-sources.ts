import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  type AuditEntry,
  type AuditLogList,
  DocumentDetailService,
  NuxeoApiBase,
  type NuxeoDocumentList,
  type NuxeoTask,
  TaskService,
  backgroundRequestContext,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  EMPTY,
  type Observable,
  catchError,
  expand,
  from,
  map,
  mergeMap,
  of,
  reduce,
  throwError,
} from 'rxjs';

import type { FollowedRecord, TaskNotification } from './notification.model';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_FOLLOWED_LIMIT,
  NOTIFICATION_TASK_LIMIT,
  NOTIFICATION_TASK_READ_LIMIT,
} from './notification-settings';

/** The audit entries read for some records, and which of those records were read. */
export interface ChangesRead {
  /**
   * Every entry read, of {@link NOTIFICATION_EVENTS}, by anyone: the reader's own are kept, as they
   * say whether the audit has caught up with a change the reader made.
   */
  readonly entries: readonly AuditEntry[];
  /** The records whose audit was read. A record whose read failed is not here. */
  readonly read: ReadonlySet<string>;
}

/** What the audit is asked for one record: its entries at or after `since`. */
export interface ChangesWanted {
  readonly uid: string;
  readonly since: Date;
}

/** One page of followed records, and whether the server has another after it. */
export interface FollowedPage {
  readonly records: readonly FollowedRecord[];
  readonly more: boolean;
}

/** How many `@audit` reads run at once, for a reader who cannot run the audit query. */
const AUDIT_READS_AT_ONCE = 4;

/** Entries per page of the audit, newest first. */
const AUDIT_PAGE_SIZE = 50;

/** At most this many pages of the audit are read, per query or per record. */
const AUDIT_PAGES = 4;

/**
 * An instant as an NXQL literal. `toISOString()` writes digits, `-`, `:`, `.`, `T` and `Z` only,
 * which is checked anyway: nothing else may reach the query's text.
 */
export function timestampLiteral(at: Date): string {
  const iso = at.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso)) {
    throw new Error(`Not an instant: ${iso}`);
  }
  return `TIMESTAMP '${iso}'`;
}

/**
 * Where the bell's items come from, on the server as it is: Nuxeo has no notification API
 * (`/api/v1/notification` and `/api/v1/me/notifications` answer 404 on Nuxeo 2025), so the bell
 * reads three things the platform has, and nothing writes. Every request carries
 * `backgroundRequestContext()`, so none of them counts as activity for the idle timer.
 *
 * - **Open tasks**: `TaskService.getUserTasks`, the read the tasks page and the drawer use.
 * - **Followed records**: the documents whose `notif:notifications` list the reader as
 *   `user:<id>`, the property `Document.Subscribe` writes. Read with `Repository.Query`, which
 *   asks the repository, because the search endpoint is served by the search index and lags a
 *   write (AGENTS/11-beta-program.md, section 3): a record followed a moment ago must be there.
 * - **Changes**: the audit. `Audit.QueryWithPageProvider` reads every record in one request, and
 *   Nuxeo binds it to administrators only (`bindings-contrib.xml` in
 *   `nuxeo-automation-features`), answering anyone else 404. So an administrator's changes are one
 *   request, and anyone else's are one `@audit` read per record that changed, which the adapter
 *   allows for a record the reader can see.
 *
 * Values go as query parameters, which Nuxeo quotes, never into a query's text; an instant goes as
 * a `TIMESTAMP` literal written by {@link timestampLiteral}.
 */
@Injectable({ providedIn: 'root' })
export class NotificationSources {
  private readonly api = inject(NuxeoApiBase);
  private readonly taskService = inject(TaskService);
  private readonly documents = inject(DocumentDetailService);

  /**
   * The reader's open tasks, the newest {@link NOTIFICATION_TASK_LIMIT}. Nuxeo orders its task list
   * by due date and ignores `sortBy` (Nuxeo 2025.10); `TaskService.getUserTasks` reads past its
   * first page to return the newest {@link NOTIFICATION_TASK_READ_LIMIT}, newest first, and the
   * sort here keeps the bell's order its own.
   */
  tasks(user: string): Observable<TaskNotification[]> {
    return this.taskService
      .getUserTasks(user, NOTIFICATION_TASK_READ_LIMIT, backgroundRequestContext())
      .pipe(
        map((tasks) =>
          tasks
            .map(toTaskNotification)
            .sort((a, b) => instant(b.at) - instant(a.at) || compare(a.key, b.key))
            .slice(0, NOTIFICATION_TASK_LIMIT),
        ),
      );
  }

  /**
   * One page of the records the reader follows that were modified after `since`, most recently
   * modified first, {@link NOTIFICATION_FOLLOWED_LIMIT} to a page. Not in the trash, not a version
   * or a proxy.
   */
  followed(user: string, since: Date, page = 0): Observable<FollowedPage> {
    const query =
      'SELECT * FROM Document WHERE notif:notifications/*/subscribers/* = ? ' +
      'AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0 ' +
      `AND dc:modified > ${timestampLiteral(since)}`;
    return this.api
      .post<NuxeoDocumentList>(
        '/nuxeo/api/v1/automation/Repository.Query',
        {
          params: {
            query,
            queryParams: [`user:${user}`],
            pageSize: NOTIFICATION_FOLLOWED_LIMIT,
            currentPageIndex: page,
            sortBy: 'dc:modified',
            sortOrder: 'DESC',
          },
          context: {},
        },
        { properties: 'dublincore' },
        backgroundRequestContext(),
      )
      .pipe(
        map((list) => ({
          records: (list.entries ?? []).flatMap((doc): FollowedRecord[] => {
            const modified = doc.properties?.['dc:modified'] ?? doc.lastModified;
            return doc.uid && typeof modified === 'string'
              ? [{ uid: doc.uid, title: doc.title || doc.uid, modified }]
              : [];
          }),
          more: list.isNextPageAvailable === true,
        })),
      );
  }

  /**
   * The audit entries of {@link NOTIFICATION_EVENTS} for each record, at or after its `since`, a
   * page at a time while the server has more, up to {@link AUDIT_PAGES} pages, so that the reader's
   * own entries, which are read too, cannot crowd other people's out of a single page.
   *
   * @param audit `true` to ask `Audit.QueryWithPageProvider`, one request for every record. When it
   *   answers 404 or 403 the records are read one by one instead, and `refused` says so, so that the
   *   caller stops asking it.
   */
  changes(
    wanted: readonly ChangesWanted[],
    audit: boolean,
  ): Observable<ChangesRead & { readonly refused: boolean }> {
    if (wanted.length === 0) return of({ entries: [], read: new Set<string>(), refused: false });
    if (!audit) return this.perRecord(wanted).pipe(map((read) => ({ ...read, refused: false })));
    return this.auditQuery(wanted).pipe(
      map((read) => ({ ...read, refused: false })),
      catchError((error: unknown) =>
        error instanceof HttpErrorResponse && (error.status === 404 || error.status === 403)
          ? this.perRecord(wanted).pipe(map((read) => ({ ...read, refused: true })))
          : throwError(() => error),
      ),
    );
  }

  /** One query for every record, values as query parameters, a page at a time. */
  private auditQuery(wanted: readonly ChangesWanted[]): Observable<ChangesRead> {
    const uids = wanted.map((w) => w.uid);
    const since = new Date(Math.min(...wanted.map((w) => w.since.getTime())));
    const marks = (count: number) => Array.from({ length: count }, () => '?').join(', ');
    const query =
      `SELECT * FROM LogEntry WHERE docUUID IN (${marks(uids.length)}) ` +
      `AND eventId IN (${marks(NOTIFICATION_EVENTS.length)}) ` +
      `AND eventDate >= ${timestampLiteral(since)}`;
    const page = (index: number) =>
      this.api.post<AuditLogList>(
        '/nuxeo/api/v1/automation/Audit.QueryWithPageProvider',
        {
          params: {
            query,
            queryParams: [...uids, ...NOTIFICATION_EVENTS],
            pageSize: AUDIT_PAGE_SIZE,
            currentPageIndex: index,
            sortBy: 'eventDate',
            sortOrder: 'DESC',
          },
          context: {},
        },
        undefined,
        backgroundRequestContext(),
      );
    return pages(page).pipe(
      map((all) => {
        const sinceOf = new Map(wanted.map((w) => [w.uid, w.since.getTime()]));
        // One query, one lower bound: the earliest. A record asked from later drops what it
        // already had, so that each is held to the bound it was asked with.
        const entries = all.filter(
          (entry) => instant(entry.eventDate) >= (sinceOf.get(entry.docUUID) ?? Infinity),
        );
        return { entries, read: new Set(uids) };
      }),
    );
  }

  /**
   * One `@audit` read per record, a few at a time, each a page at a time. A read that fails leaves
   * its record out of `read`, to be asked again; only when every read fails does the whole read
   * fail.
   */
  private perRecord(wanted: readonly ChangesWanted[]): Observable<ChangesRead> {
    type One =
      | { readonly uid: string; readonly entries: readonly AuditEntry[] }
      | { readonly failed: unknown };
    return from(wanted).pipe(
      mergeMap(
        ({ uid, since }) =>
          pages((index) =>
            this.documents.getAuditLog(
              uid,
              AUDIT_PAGE_SIZE,
              index,
              {
                eventIds: NOTIFICATION_EVENTS,
                startDate: since,
                sortBy: 'eventDate',
                sortOrder: 'desc',
              },
              backgroundRequestContext(),
            ),
          ).pipe(
            map((entries): One => ({ uid, entries })),
            catchError((failed: unknown) => of<One>({ failed })),
          ),
        AUDIT_READS_AT_ONCE,
      ),
      reduce(
        (acc, one) =>
          'failed' in one
            ? { ...acc, failure: acc.failure ?? one.failed }
            : {
                ...acc,
                entries: [...acc.entries, ...one.entries],
                read: new Set([...acc.read, one.uid]),
              },
        { entries: [] as AuditEntry[], read: new Set<string>(), failure: undefined as unknown },
      ),
      mergeMap(({ entries, read, failure }) =>
        read.size === 0 && failure !== undefined
          ? throwError(() => failure)
          : of<ChangesRead>({ entries, read }),
      ),
    );
  }
}

/** Every entry of up to {@link AUDIT_PAGES} pages, following `isNextPageAvailable`. */
function pages(page: (index: number) => Observable<AuditLogList>): Observable<AuditEntry[]> {
  return page(0).pipe(
    map((list) => ({ list, index: 0 })),
    expand(({ list, index }) =>
      list.isNextPageAvailable === true && index + 1 < AUDIT_PAGES
        ? page(index + 1).pipe(map((next) => ({ list: next, index: index + 1 })))
        : EMPTY,
    ),
    reduce((all: AuditEntry[], { list }) => [...all, ...(list.entries ?? [])], []),
  );
}

function toTaskNotification(task: NuxeoTask): TaskNotification {
  return {
    kind: 'task',
    key: `task:${task.id}`,
    taskId: task.id,
    at: task.created,
    title: writtenOut(task.directive || task.name || task.id),
    record: task.targetDocTitle ?? task.targetDocumentIds?.[0]?.title ?? null,
  };
}

/**
 * A workflow key written out: `wf.serialDocumentReview.DocumentValidation` is "Document
 * Validation". The same reading as the task detail's title, which the bell's item opens.
 */
function writtenOut(raw: string): string {
  return raw
    .replace(/^wf\.\w+\./, '')
    .replace(/\.(title|directive)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\./g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** An instant as milliseconds, or 0 for one that does not parse, which sorts it last. */
export function instant(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
