import { Observable, Subject, of } from 'rxjs';

import { NotificationPoller } from './notification-poller';

/** A document whose visibility a test sets. */
class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  hide(): void {
    this.visibilityState = 'hidden';
    this.dispatchEvent(new Event('visibilitychange'));
  }

  show(): void {
    this.visibilityState = 'visible';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

describe('NotificationPoller', () => {
  const INTERVAL = 60_000;
  let document: FakeDocument;
  let outcomes: boolean[];
  let checks: number;
  let poller: NotificationPoller;

  /** Each check succeeds or fails as `outcomes` says, in order, succeeding once they run out. */
  function makePoller(check?: () => Observable<boolean>): NotificationPoller {
    return new NotificationPoller({
      check:
        check ??
        (() => {
          checks++;
          return of(outcomes.shift() ?? true);
        }),
      interval: () => INTERVAL,
      document,
      now: () => Date.now(),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T12:00:00.000Z'));
    document = new FakeDocument();
    outcomes = [];
    checks = 0;
    poller = makePoller();
  });

  afterEach(() => {
    poller.stop();
    vi.useRealTimers();
  });

  it('checks at once, then once per interval', () => {
    poller.start();
    expect(checks).toBe(1);

    vi.advanceTimersByTime(INTERVAL - 1);
    expect(checks).toBe(1);
    vi.advanceTimersByTime(1);
    expect(checks).toBe(2);
    vi.advanceTimersByTime(INTERVAL);
    expect(checks).toBe(3);
  });

  it('reads the interval before each wait, so a configuration loaded late is followed', () => {
    let interval = INTERVAL;
    poller = new NotificationPoller({
      check: () => {
        checks++;
        return of(true);
      },
      interval: () => interval,
      document,
      now: () => Date.now(),
    });
    poller.start();
    interval = 2 * INTERVAL;
    vi.advanceTimersByTime(INTERVAL);
    expect(checks).toBe(2);
    vi.advanceTimersByTime(INTERVAL);
    expect(checks).toBe(2);
    vi.advanceTimersByTime(INTERVAL);
    expect(checks).toBe(3);
  });

  it('starts no check while the tab is hidden, and runs the one that fell due on return', () => {
    poller.start();
    expect(checks).toBe(1);

    document.hide();
    vi.advanceTimersByTime(10 * INTERVAL);
    expect(checks).toBe(1);

    document.show();
    expect(checks).toBe(2);
    vi.advanceTimersByTime(INTERVAL);
    expect(checks).toBe(3);
  });

  it('waits out the rest of the interval when shown again before the check fell due', () => {
    poller.start();
    vi.advanceTimersByTime(20_000);
    document.hide();
    vi.advanceTimersByTime(10_000);
    document.show();
    expect(checks).toBe(1);
    vi.advanceTimersByTime(INTERVAL - 30_000 - 1);
    expect(checks).toBe(1);
    vi.advanceTimersByTime(1);
    expect(checks).toBe(2);
  });

  it('does not start at all while the tab is hidden', () => {
    document.visibilityState = 'hidden';
    poller.start();
    vi.advanceTimersByTime(5 * INTERVAL);
    expect(checks).toBe(0);
    document.show();
    expect(checks).toBe(1);
  });

  it('backs off after failures, doubling the wait, and returns to the interval after a success', () => {
    outcomes = [false, false, false, true];
    poller.start();
    expect(checks).toBe(1);
    expect(poller.failuresInARow).toBe(1);

    // After one failure: twice the interval.
    vi.advanceTimersByTime(2 * INTERVAL - 1);
    expect(checks).toBe(1);
    vi.advanceTimersByTime(1);
    expect(checks).toBe(2);

    // After two: four times.
    vi.advanceTimersByTime(4 * INTERVAL - 1);
    expect(checks).toBe(2);
    vi.advanceTimersByTime(1);
    expect(checks).toBe(3);

    // After three: eight times would be 8 minutes, under the 15-minute ceiling.
    vi.advanceTimersByTime(8 * INTERVAL);
    expect(checks).toBe(4);
    expect(poller.failuresInARow).toBe(0);

    // The fourth succeeded: back to the interval.
    vi.advanceTimersByTime(INTERVAL);
    expect(checks).toBe(5);
  });

  it('counts a check that errors as a failure', () => {
    poller = makePoller(() => {
      checks++;
      return new Observable<boolean>((subscriber) => subscriber.error(new Error('down')));
    });
    poller.start();
    expect(poller.failuresInARow).toBe(1);
    vi.advanceTimersByTime(INTERVAL);
    expect(checks).toBe(1);
    vi.advanceTimersByTime(INTERVAL);
    expect(checks).toBe(2);
  });

  it('counts a check that throws before it returns as a failure, and goes on', () => {
    poller = makePoller(() => {
      checks++;
      throw new Error('thrown before an observable');
    });
    poller.start();
    expect(poller.checking).toBe(false);
    expect(poller.failuresInARow).toBe(1);
    vi.advanceTimersByTime(2 * INTERVAL);
    expect(checks).toBe(2);
  });

  it('never runs two checks at once, and schedules the next from when the slow one ended', () => {
    const pending = new Subject<boolean>();
    poller = makePoller(() => {
      checks++;
      return pending;
    });
    poller.start();
    expect(poller.checking).toBe(true);
    vi.advanceTimersByTime(5 * INTERVAL);
    poller.checkSoon(0);
    expect(checks).toBe(1);

    pending.next(true);
    pending.complete();
    expect(poller.checking).toBe(false);
    vi.advanceTimersByTime(INTERVAL - 1);
    expect(checks).toBe(1);
  });

  it('checks soon when asked, unless one ended within the gap', () => {
    poller.start();
    vi.advanceTimersByTime(10_000);
    poller.checkSoon(15_000);
    expect(checks).toBe(1);

    vi.advanceTimersByTime(10_000);
    poller.checkSoon(15_000);
    expect(checks).toBe(2);
    // The interval starts again from that check.
    vi.advanceTimersByTime(INTERVAL - 1);
    expect(checks).toBe(2);
    vi.advanceTimersByTime(1);
    expect(checks).toBe(3);
  });

  it('stops: no more checks, a running one is dropped, and visibility no longer starts one', () => {
    const pending = new Subject<boolean>();
    let unsubscribed = false;
    poller = makePoller(() => {
      checks++;
      return new Observable<boolean>((subscriber) => {
        const inner = pending.subscribe(subscriber);
        return () => {
          unsubscribed = true;
          inner.unsubscribe();
        };
      });
    });
    poller.start();
    poller.stop();
    expect(unsubscribed).toBe(true);
    document.hide();
    document.show();
    vi.advanceTimersByTime(10 * INTERVAL);
    expect(checks).toBe(1);
  });
});
