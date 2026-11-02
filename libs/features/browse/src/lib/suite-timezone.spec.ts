/**
 * Guards the time zone this suite runs in (NXSAT-727).
 *
 * `vite.config.mts` pins `process.env['TZ'] = 'Asia/Calcutta'` because the date assertions in
 * `edit-metadata-dialog.spec.ts` are only able to fail outside UTC: anchoring a calendar day locally and anchoring
 * it in UTC produce the same instant when local *is* UTC, and a CI runner is UTC.
 *
 * The pin is one line in a config file, far from the cases that depend on it, and deleting it
 * breaks nothing visibly — the suite simply goes quietly green and stops protecting anything. So
 * it is asserted here rather than left as a comment. `satori-components` carries the same guard.
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
