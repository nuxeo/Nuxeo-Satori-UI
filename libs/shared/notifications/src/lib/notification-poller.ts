import { type Observable, type Subscription, throwError } from 'rxjs';

import { notificationRetryDelay } from './notification-settings';

/** The part of the document the poller reads: whether it is hidden, and when that changes. */
export interface NotificationPollerDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** What the poller needs from its host. */
export interface NotificationPollerOptions {
  /** One check: emits `true` when it succeeded, `false` when it failed, then completes. */
  readonly check: () => Observable<boolean>;
  /** The interval, read before each wait, so that a configuration loaded late is followed. */
  readonly interval: () => number;
  /** Whose `visibilityState` and `visibilitychange` pause the checks. */
  readonly document: NotificationPollerDocument;
  /** Now, in milliseconds. */
  readonly now: () => number;
}

/**
 * Runs a check at once, then again after each interval, for as long as it is started.
 *
 * - **Hidden tab:** while the document is hidden, no check starts. One that was due while it was
 *   hidden runs when it is shown again, and one that was not runs when it falls due.
 * - **Errors:** after a failed check the wait doubles, up to the ceiling
 *   {@link notificationRetryDelay} gives, and a successful check brings it back to the interval.
 * - **One at a time:** a check never starts while another is running; `checkSoon` asks for one
 *   without waiting out the interval, unless one ran within `minimumGap`.
 *
 * Plain timers and a listener, no zone or change detection of its own: the host decides what a
 * check changes on screen.
 */
export class NotificationPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Subscription | null = null;
  /** A check has started and not ended. */
  private busy = false;
  private started = false;
  private failures = 0;
  /** When the next check is due, in milliseconds. */
  private dueAt = 0;
  /** When the last check ended, or `null` before the first one. */
  private lastEnded: number | null = null;
  private readonly onVisibility = () => this.visibilityChanged();

  constructor(private readonly options: NotificationPollerOptions) {}

  /** Whether a check is running now. */
  get checking(): boolean {
    return this.busy;
  }

  /** Failed checks in a row. */
  get failuresInARow(): number {
    return this.failures;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.failures = 0;
    this.options.document.addEventListener('visibilitychange', this.onVisibility);
    this.dueAt = this.options.now();
    this.schedule();
  }

  stop(): void {
    this.started = false;
    this.options.document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearTimer();
    this.running?.unsubscribe();
    this.running = null;
    this.busy = false;
  }

  /**
   * A check now rather than at the end of the interval, as when the reader opens the panel,
   * unless one is running or one ended less than `minimumGap` milliseconds ago.
   */
  checkSoon(minimumGap: number): void {
    if (!this.started || this.busy) return;
    if (this.lastEnded !== null && this.options.now() - this.lastEnded < minimumGap) return;
    this.dueAt = this.options.now();
    this.schedule();
  }

  private hidden(): boolean {
    return this.options.document.visibilityState === 'hidden';
  }

  private visibilityChanged(): void {
    if (!this.started) return;
    if (this.hidden()) {
      // Nothing starts while hidden. The due time is kept, so the check runs on return.
      this.clearTimer();
      return;
    }
    if (!this.busy) this.schedule();
  }

  /** Waits until the due time, or runs now if it has passed; nothing while hidden. */
  private schedule(): void {
    this.clearTimer();
    if (!this.started || this.busy || this.hidden()) return;
    const wait = Math.max(0, this.dueAt - this.options.now());
    if (wait === 0) {
      this.run();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.schedule();
    }, wait);
  }

  private run(): void {
    let succeeded = false;
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      this.busy = false;
      this.running = null;
      this.lastEnded = this.options.now();
      this.failures = succeeded ? 0 : this.failures + 1;
      this.dueAt = this.lastEnded + notificationRetryDelay(this.options.interval(), this.failures);
      this.schedule();
    };
    // Busy before subscribing: a check that completes synchronously ends inside `subscribe`.
    this.busy = true;
    // A check that throws before it returns an observable is a failed check, not a stopped poller.
    let source: Observable<boolean>;
    try {
      source = this.options.check();
    } catch (error: unknown) {
      source = throwError(() => error);
    }
    const subscription = source.subscribe({
      next: (ok) => (succeeded = ok),
      error: () => {
        succeeded = false;
        finish();
      },
      complete: finish,
    });
    if (!ended) this.running = subscription;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
