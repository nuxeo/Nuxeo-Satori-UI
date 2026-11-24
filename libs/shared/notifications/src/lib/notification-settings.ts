import { InjectionToken } from '@angular/core';

/**
 * What the bell reads, how far back, and how often. The interval is the one Layer 0 setting,
 * `notifications.pollIntervalMs` in the bootstrap configuration; the rest are fixed in this
 * release and stated in the library's README.
 */

/** The bell's check interval when the configuration sets none. */
export const DEFAULT_NOTIFICATION_POLL_INTERVAL_MS = 60_000;

/** The shortest interval the bell uses, whatever the configuration says: a check reads 2+ requests. */
export const MIN_NOTIFICATION_POLL_INTERVAL_MS = 15_000;

/** The longest interval the bell uses. */
export const MAX_NOTIFICATION_POLL_INTERVAL_MS = 3_600_000;

/**
 * The longest the bell waits after failed checks. Each failure doubles the wait, from the interval
 * up to this, or up to the interval when that is longer.
 */
export const MAX_NOTIFICATION_RETRY_DELAY_MS = 15 * 60_000;

/** How far back the bell lists changes to followed records: seven days. */
export const NOTIFICATION_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** At most this many open tasks are listed, the newest. */
export const NOTIFICATION_TASK_LIMIT = 20;

/**
 * How many open tasks `TaskService.getUserTasks` is asked for. It returns the newest, newest first,
 * although Nuxeo orders its task list by due date and ignores `sortBy` (Nuxeo 2025.10): it reads
 * past the first page, up to 1000 more tasks, to find them.
 */
export const NOTIFICATION_TASK_READ_LIMIT = 100;

/**
 * Followed records per page, read most recently modified first within the window. A check reads
 * the first page, and the next one only while the whole page was modified after the newest
 * `dc:modified` the last check saw, so that a change to many records at once is not cut short, up
 * to {@link NOTIFICATION_FOLLOWED_PAGES} pages.
 */
export const NOTIFICATION_FOLLOWED_LIMIT = 20;

/**
 * At most this many pages of followed records are read in one check. More than
 * {@link NOTIFICATION_FOLLOWED_LIMIT} times this many records changing between two checks leaves
 * the rest unread.
 */
export const NOTIFICATION_FOLLOWED_PAGES = 5;

/** At most this many changes are listed, newest first. */
export const NOTIFICATION_CHANGE_LIMIT = 50;

/**
 * The audit events listed as changes. Each one moves the record's `dc:modified`, which is how the
 * bell finds the records that changed. Measured on Nuxeo 2025: an edit, a comment (which Nuxeo
 * audits as `documentModified` on its record) and a lifecycle transition move it; a lock, an
 * unlock, a check-in and a permission change do not. Moves and publishing were not measured, and
 * are not listed.
 */
export const NOTIFICATION_EVENTS = ['documentModified', 'lifecycle_transition_event'] as const;

/** One of {@link NOTIFICATION_EVENTS}. */
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Whether an audit event is one the bell lists. */
export function isNotificationEvent(event: string): event is NotificationEvent {
  return (NOTIFICATION_EVENTS as readonly string[]).includes(event);
}

/** The manifest feature toggle that turns the bell off: `featureToggles["notifications.bell"]`. */
export const NOTIFICATIONS_FEATURE_TOGGLE = 'notifications.bell';

/**
 * The interval the bell uses for a configured value: the default for `null`, absent or anything
 * that is not a positive number, otherwise the value held between the minimum and the maximum.
 */
export function notificationPollInterval(configured: number | null | undefined): number {
  if (typeof configured !== 'number' || !Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_NOTIFICATION_POLL_INTERVAL_MS;
  }
  return Math.min(
    MAX_NOTIFICATION_POLL_INTERVAL_MS,
    Math.max(MIN_NOTIFICATION_POLL_INTERVAL_MS, configured),
  );
}

/**
 * The wait before the next check after `failures` failed ones in a row: the interval doubled for
 * each, up to {@link MAX_NOTIFICATION_RETRY_DELAY_MS} or the interval, whichever is longer.
 */
export function notificationRetryDelay(interval: number, failures: number): number {
  const ceiling = Math.max(interval, MAX_NOTIFICATION_RETRY_DELAY_MS);
  if (failures <= 0) return interval;
  return Math.min(ceiling, interval * 2 ** Math.min(failures, 16));
}

/**
 * The zone an instant is shown in: `undefined`, the reader's own (AGENTS/08-bug-patterns.md,
 * pattern 29). A token so that a test chooses an offset from UTC, where an instant read in the
 * wrong zone would otherwise still look right.
 */
export const NOTIFICATION_TIME_ZONE = new InjectionToken<string | undefined>(
  'NOTIFICATION_TIME_ZONE',
  { providedIn: 'root', factory: () => undefined },
);

/** Now. A token so that a test chooses the time. */
export const NOTIFICATION_NOW = new InjectionToken<() => number>('NOTIFICATION_NOW', {
  providedIn: 'root',
  factory: () => () => Date.now(),
});
