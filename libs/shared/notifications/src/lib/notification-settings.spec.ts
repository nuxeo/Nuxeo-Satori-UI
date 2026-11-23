import {
  DEFAULT_NOTIFICATION_POLL_INTERVAL_MS,
  MAX_NOTIFICATION_POLL_INTERVAL_MS,
  MAX_NOTIFICATION_RETRY_DELAY_MS,
  MIN_NOTIFICATION_POLL_INTERVAL_MS,
  isNotificationEvent,
  notificationPollInterval,
  notificationRetryDelay,
} from './notification-settings';

describe('notificationPollInterval', () => {
  it('is the default when nothing usable is configured', () => {
    for (const value of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(notificationPollInterval(value), String(value)).toBe(
        DEFAULT_NOTIFICATION_POLL_INTERVAL_MS,
      );
    }
    expect(DEFAULT_NOTIFICATION_POLL_INTERVAL_MS).toBe(60_000);
  });

  it('is the configured value inside the range', () => {
    expect(notificationPollInterval(120_000)).toBe(120_000);
  });

  it('is held to the range: a typo cannot make every tab ask the server every second', () => {
    expect(notificationPollInterval(1_000)).toBe(MIN_NOTIFICATION_POLL_INTERVAL_MS);
    expect(MIN_NOTIFICATION_POLL_INTERVAL_MS).toBe(15_000);
    expect(notificationPollInterval(86_400_000)).toBe(MAX_NOTIFICATION_POLL_INTERVAL_MS);
  });
});

describe('notificationRetryDelay', () => {
  it('doubles from the interval with each failure, up to the ceiling', () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => notificationRetryDelay(60_000, n))).toEqual([
      60_000, 120_000, 240_000, 480_000, 900_000, 900_000,
    ]);
    expect(MAX_NOTIFICATION_RETRY_DELAY_MS).toBe(900_000);
  });

  it('never waits less than the interval: a long interval is its own ceiling', () => {
    expect(notificationRetryDelay(3_600_000, 3)).toBe(3_600_000);
  });

  it('does not overflow after many failures', () => {
    expect(notificationRetryDelay(60_000, 10_000)).toBe(MAX_NOTIFICATION_RETRY_DELAY_MS);
  });
});

describe('isNotificationEvent', () => {
  it('lists the two events that move dc:modified, and no other', () => {
    expect(isNotificationEvent('documentModified')).toBe(true);
    expect(isNotificationEvent('lifecycle_transition_event')).toBe(true);
    for (const other of ['download', 'documentLocked', 'documentCheckedIn', 'documentCreated']) {
      expect(isNotificationEvent(other), other).toBe(false);
    }
  });
});
