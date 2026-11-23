/**
 * Guards the time zone this suite runs in (AGENTS/08-bug-patterns.md, pattern 29).
 *
 * `vite.config.mts` pins `process.env['TZ'] = 'Asia/Calcutta'` because the bell's time assertions
 * are only able to fail outside UTC: an instant formatted in UTC and one formatted in the reader's
 * zone are the same text when the reader's zone is UTC, and a CI runner is UTC.
 *
 * The pin is one line in a config file, and deleting it breaks nothing visibly: the suite goes
 * quietly green and stops protecting anything. So it is asserted here.
 */
describe('the suite’s time zone', () => {
  /** What `vite.config.mts` resolves the pin to: its default, or an explicit `SATORI_TEST_TZ`. */
  const EXPECTED = process.env['SATORI_TEST_TZ'] ?? 'Asia/Calcutta';

  it('is the zone vite.config.mts pins, so time assertions can fail', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EXPECTED);
  });

  it('is offset from UTC, which is what gives those assertions their teeth', () => {
    expect(new Date('2027-12-31T00:00:00.000Z').getTimezoneOffset()).not.toBe(0);
  });
});
