/**
 * Guards the time zone this suite runs in. `vite.config.mts` pins it because the date assertions
 * here can only fail outside UTC: a record's date is read in UTC and `today` in the reader's zone,
 * and in UTC the two readings are the same (`AGENTS/08-bug-patterns.md`, pattern 29). Deleting the
 * pin would break nothing visibly, so it is asserted here rather than left as a comment.
 */
describe('the suite’s time zone', () => {
  /** What `vite.config.mts` resolves the pin to: its default, or an explicit `SATORI_TEST_TZ`. */
  const EXPECTED = process.env['SATORI_TEST_TZ'] ?? 'Asia/Calcutta';

  it('is the zone vite.config.mts pins, so date assertions can fail', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EXPECTED);
  });

  it('is offset from UTC, which is what gives those assertions their teeth', () => {
    expect(new Date('2027-12-31T00:00:00.000Z').getTimezoneOffset()).not.toBe(0);
  });
});
