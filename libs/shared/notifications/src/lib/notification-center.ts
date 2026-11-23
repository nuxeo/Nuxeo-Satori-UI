import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  ADMIN_ACCESS_CHECKS,
  type AuditEntry,
  CURRENT_USERNAME,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  EMPTY,
  type Observable,
  catchError,
  defer,
  expand,
  forkJoin,
  map,
  of,
  reduce,
  switchMap,
} from 'rxjs';

import type {
  ChangeNotification,
  FollowedRecord,
  NotificationItem,
  TaskNotification,
} from './notification.model';
import { NotificationPoller } from './notification-poller';
import { NotificationReadState } from './notification-read-state';
import {
  MIN_NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_CHANGE_LIMIT,
  NOTIFICATION_FOLLOWED_PAGES,
  NOTIFICATION_NOW,
  NOTIFICATION_WINDOW_MS,
  type NotificationEvent,
  isNotificationEvent,
  notificationPollInterval,
} from './notification-settings';
import {
  type ChangesRead,
  type ChangesWanted,
  NotificationSources,
  instant,
} from './notification-sources';

/** What the bell knows of a followed record's audit. */
interface RecordRead {
  /** The `dc:modified` it was read at. */
  readonly modified: string;
  /** The lower bound it was read from, in milliseconds. */
  readonly since: number;
  /** Whether the audit had an entry at or after `modified`: whether it had caught up. */
  readonly caughtUp: boolean;
  /** Reads at this `modified`. */
  readonly attempts: number;
}

/**
 * A record whose audit has not caught up is read once more at the next check, then left: Nuxeo
 * writes its audit a second or so after the change (measured 0.8 to 1.4 seconds on Nuxeo 2025), so
 * a check that lands in between sees the new `dc:modified` and no entry for it yet. A change that
 * writes no event the bell lists also moves `dc:modified`, and must not be read at every check.
 */
const READS_PER_CHANGE = 2;

/**
 * The bell's state and its checks, for the signed-in user: their open tasks, and the changes other
 * people made to the records they follow, over the last seven days; and which of those they have
 * not seen yet.
 *
 * Provided by the bell, so it lives as long as the bell does: the shell's header, which is drawn
 * only for a signed-in user. Signing out removes the shell, which stops the checks and drops the
 * items, and the next user starts from what they have seen in this browser.
 *
 * Every read is a background request: the idle timer does not count it, so the bell never keeps a
 * session open (`NUXEO_BACKGROUND_REQUEST`).
 */
@Injectable()
export class NotificationCenter {
  private readonly sources = inject(NotificationSources);
  private readonly readState = inject(NotificationReadState);
  private readonly appConfig = inject(AppConfigService);
  private readonly currentUser = inject(CURRENT_USERNAME);
  private readonly adminAccess = inject(ADMIN_ACCESS_CHECKS);
  private readonly now = inject(NOTIFICATION_NOW);
  /**
   * The checks run outside Angular's zone. A timer pending in the zone keeps the application
   * unstable for as long as it waits, and this one always waits: `whenStable` and anything built on
   * it would never return. What a check changes is in signals, which schedule change detection
   * wherever they are written.
   */
  private readonly zone = inject(NgZone);
  private readonly window = inject(DOCUMENT).defaultView;

  private user: string | null = null;
  private records = new Map<string, RecordRead>();
  /**
   * The newest `dc:modified` the last good check saw, in milliseconds, or `null` before the first:
   * a record modified since that check has a later one. A server time, compared only with others.
   */
  private newestSeen: number | null = null;
  /** Set once the audit query answered 404 or 403: the records are read one by one after that. */
  private auditRefused = false;

  private readonly taskItems = signal<readonly TaskNotification[]>([]);
  private readonly changeItems = signal<readonly ChangeNotification[]>([]);

  /** The open tasks, newest first. */
  readonly tasks = this.taskItems.asReadonly();
  /** The changes, newest first. */
  readonly changes = this.changeItems.asReadonly();
  /** Whether a check has succeeded since the bell started. */
  readonly loaded = signal(false);
  /** Whether the latest check failed. The items of an earlier one stay. */
  readonly failed = signal(false);
  /**
   * The items the user has seen, by key: those the panel showed while it was open, in this
   * browser. `null` when they have never opened it here.
   */
  readonly seen = signal<ReadonlySet<string> | null>(null);
  /**
   * What the open panel marks items as new against: what had been seen before it was opened, kept
   * while it stays open so that what was new stays marked.
   */
  readonly seenBefore = signal<ReadonlySet<string> | null>(null);

  /** Items the panel has not shown the user yet: what the bell counts. */
  readonly unread = computed(() => {
    const seen = this.seen();
    return [...this.taskItems(), ...this.changeItems()].filter(
      (item) => seen === null || !seen.has(item.key),
    ).length;
  });

  /**
   * Another tab of this browser opened the panel, and what it saw is seen here too; or it cleared
   * the storage (`key` is `null`), and nothing is.
   */
  private readonly onStorage = (event: StorageEvent) => {
    if (this.user && (event.key === null || event.key === this.readState.key(this.user))) {
      this.seen.set(this.readState.seen(this.user));
    }
  };

  /** Whether the latest check's failure has been reported in the console. */
  private failureReported = false;

  private readonly poller = new NotificationPoller({
    check: () => this.check(),
    interval: () =>
      notificationPollInterval(this.appConfig.bootstrap().notifications?.pollIntervalMs),
    document: inject(DOCUMENT),
    now: () => this.now(),
  });

  constructor() {
    this.window?.addEventListener('storage', this.onStorage);
    inject(DestroyRef).onDestroy(() => {
      this.poller.stop();
      this.window?.removeEventListener('storage', this.onStorage);
    });
  }

  /**
   * Follows the signed-in user: starts checking for them, starts again from nothing for another
   * user, and stops, dropping every item, while no one is signed in. Called again with the same
   * user, it does nothing.
   */
  start(): void {
    const user = this.currentUser() || null;
    if (user === this.user) return;
    this.poller.stop();
    this.user = user;
    this.records = new Map();
    this.newestSeen = null;
    this.auditRefused = false;
    this.taskItems.set([]);
    this.changeItems.set([]);
    this.loaded.set(false);
    this.failed.set(false);
    this.failureReported = false;
    const seen = user ? this.readState.seen(user) : null;
    this.seen.set(seen);
    this.seenBefore.set(seen);
    if (user) this.zone.runOutsideAngular(() => this.poller.start());
  }

  /** Whether an item is marked new in the open panel: it had not been shown before. */
  isNew(item: NotificationItem): boolean {
    const before = this.seenBefore();
    return before === null || !before.has(item.key);
  }

  /**
   * The panel was opened: what it shows is seen, so the count clears, and what was new stays
   * marked while it is open. Asks for a check, unless one ran a moment ago.
   */
  opened(): void {
    this.seenBefore.set(this.seen());
    this.markSeen();
    this.zone.runOutsideAngular(() => this.poller.checkSoon(MIN_NOTIFICATION_POLL_INTERVAL_MS));
  }

  /**
   * The panel was closed: what it showed is seen, including what a check brought while it was
   * open. The "New" tags were for the panel just closed.
   */
  closed(): void {
    this.markSeen();
    this.seenBefore.set(this.seen());
  }

  /** Marks everything shown as read, including what arrived while the panel was open. */
  markAllRead(): void {
    this.markSeen();
    this.seenBefore.set(this.seen());
  }

  /**
   * What the panel shows becomes seen, the items, not a time: an item the bell reads later counts
   * however it is dated, which a time would get wrong for a change made just before the panel
   * opened and read after. What was seen before stays seen, the items shown now last, as the most
   * recent.
   */
  private markSeen(): void {
    const user = this.user;
    if (!user) return;
    const shown = [...this.taskItems(), ...this.changeItems()].map((item) => item.key);
    const now = new Set(shown);
    const seen = new Set([...(this.seen() ?? [])].filter((key) => !now.has(key)));
    for (const key of shown) seen.add(key);
    this.seen.set(seen);
    this.readState.setSeen(user, seen);
  }

  /** One check: tasks and followed records together, then the audit of those that changed. */
  private check(): Observable<boolean> {
    const user = this.user;
    if (!user) return of(false);
    const windowStart = this.now() - NOTIFICATION_WINDOW_MS;
    // Deferred, so that a read that throws before it returns is a failed check, reported below.
    return defer(() =>
      forkJoin({
        tasks: this.sources.tasks(user),
        followed: this.followed(user, new Date(windowStart)),
      }),
    ).pipe(
      switchMap(({ tasks, followed }) => {
        const wanted = followed.flatMap((record): ChangesWanted[] => {
          const since = this.dueSince(record, windowStart);
          return since === null ? [] : [{ uid: record.uid, since: new Date(since) }];
        });
        const audit = this.adminAccess.isAdministrator() && !this.auditRefused;
        return this.sources
          .changes(wanted, audit)
          .pipe(map((read) => ({ tasks, followed, wanted, read })));
      }),
      map(({ tasks, followed, wanted, read }) => {
        // A check for a user who has since been replaced changes nothing.
        if (this.user !== user) return false;
        if (read.refused) this.auditRefused = true;
        this.taskItems.set(tasks);
        this.apply(user, followed, wanted, read, windowStart);
        // With nothing modified in the window, the window's start: whatever the next check finds
        // was modified since, so a page of it pages on.
        this.newestSeen = Math.max(
          this.newestSeen ?? windowStart,
          ...followed.map((record) => instant(record.modified)),
        );
        this.loaded.set(true);
        this.failed.set(false);
        this.failureReported = false;
        return true;
      }),
      catchError((error: unknown) => {
        if (this.user !== user) return of(false);
        this.failed.set(true);
        // Once for each run of failures: the bell keeps trying, and says so in its panel.
        if (!this.failureReported) {
          this.failureReported = true;
          console.warn('[notifications] the check for new items failed; trying again later', error);
        }
        return of(false);
      }),
    );
  }

  /**
   * The followed records modified in the window, a page at a time, most recently modified first:
   * the next page only while the whole of the last one was modified after the newest `dc:modified`
   * the last good check saw, which is a change to many records at once, up to
   * {@link NOTIFICATION_FOLLOWED_PAGES} pages. A page holding an older record holds every record
   * modified since, as the rest are older still. The first check reads one page.
   */
  private followed(user: string, since: Date): Observable<FollowedRecord[]> {
    const newest = this.newestSeen;
    const burst = (records: readonly FollowedRecord[]) =>
      newest !== null &&
      records.length > 0 &&
      records.every((record) => instant(record.modified) > newest);
    return this.sources.followed(user, since, 0).pipe(
      map((page) => ({ page, index: 0 })),
      expand(({ page, index }) =>
        page.more && burst(page.records) && index + 1 < NOTIFICATION_FOLLOWED_PAGES
          ? this.sources
              .followed(user, since, index + 1)
              .pipe(map((next) => ({ page: next, index: index + 1 })))
          : EMPTY,
      ),
      // A record modified between two page reads moves up, and can come twice: kept once.
      reduce((all: FollowedRecord[], { page }) => {
        const have = new Set(all.map((record) => record.uid));
        return [...all, ...page.records.filter((record) => !have.has(record.uid))];
      }, []),
    );
  }

  /** The lower bound to read a record's audit from, or `null` when it need not be read. */
  private dueSince(record: FollowedRecord, windowStart: number): number | null {
    const known = this.records.get(record.uid);
    if (!known) return windowStart;
    if (known.modified !== record.modified) {
      // From the change it was last read at, included, so that nothing between is skipped; or,
      // when that read had not caught up, from where it was read then.
      return Math.max(windowStart, known.caughtUp ? instant(known.modified) : known.since);
    }
    return !known.caughtUp && known.attempts < READS_PER_CHANGE
      ? Math.max(windowStart, known.since)
      : null;
  }

  private apply(
    user: string,
    followed: readonly FollowedRecord[],
    wanted: readonly ChangesWanted[],
    read: ChangesRead,
    windowStart: number,
  ): void {
    const byUid = new Map(followed.map((record) => [record.uid, record]));
    const next = new Map<string, RecordRead>();
    for (const record of followed) {
      const known = this.records.get(record.uid);
      if (known) next.set(record.uid, known);
    }
    for (const { uid, since } of wanted) {
      const record = byUid.get(uid);
      if (!record || !read.read.has(uid)) continue;
      const known = this.records.get(uid);
      const modified = instant(record.modified);
      next.set(uid, {
        modified: record.modified,
        since: since.getTime(),
        caughtUp: read.entries.some(
          (entry) => entry.docUUID === uid && instant(entry.eventDate) >= modified,
        ),
        attempts: (known?.modified === record.modified ? known.attempts : 0) + 1,
      });
    }
    this.records = next;

    const fresh = read.entries.flatMap((entry): ChangeNotification[] =>
      entry.principalName !== user && isNotificationEvent(entry.eventId)
        ? [toChange(entry, entry.eventId, byUid.get(entry.docUUID))]
        : [],
    );
    const kept = new Map<string, ChangeNotification>();
    for (const change of [...this.changeItems(), ...fresh]) {
      if (instant(change.at) >= windowStart) kept.set(change.key, change);
    }
    this.changeItems.set(
      [...kept.values()]
        .sort((a, b) => instant(b.at) - instant(a.at) || b.auditId - a.auditId)
        .slice(0, NOTIFICATION_CHANGE_LIMIT),
    );
  }
}

function toChange(
  entry: AuditEntry,
  event: NotificationEvent,
  record: FollowedRecord | undefined,
): ChangeNotification {
  return {
    kind: 'change',
    key: `change:${entry.id}`,
    auditId: entry.id,
    at: entry.eventDate,
    who: entry.principalName,
    event,
    state: event === 'lifecycle_transition_event' ? entry.docLifeCycle || null : null,
    uid: entry.docUUID,
    title: record?.title || lastSegment(entry.docPath) || entry.docUUID,
  };
}

function lastSegment(path: string | null | undefined): string {
  return path?.split('/').filter(Boolean).pop() ?? '';
}
