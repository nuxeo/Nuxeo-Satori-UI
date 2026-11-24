/**
 * Guards the time zone this suite runs in (NXSAT-727).
 *
 * `vite.config.mts` pins `process.env['TZ'] = 'Asia/Calcutta'` because several date assertions in
 * this project are only able to fail outside UTC: anchoring a calendar day locally and anchoring
 * it in UTC produce the same instant when local *is* UTC, and a CI runner is UTC. Without the pin
 * those cases still pass, which is how a picked date being stored at local midnight shipped past
 * this suite while the layout row showed the previous day for every user east of Greenwich.
 *
 * The pin is one line in a config file, far from the cases that depend on it, and deleting it
 * breaks nothing visibly — the suite simply goes quietly green and stops protecting anything. So
 * it is asserted here rather than left as a comment, which is the difference between a guarantee
 * and a note about one.
 *
 * Changing the pin is fine; change it here too, and re-read the cases that name a local day
 * (`properties-panel.component.spec.ts` asserts one deliberately).
 *
 * `SATORI_TEST_TZ` is honoured, because one spec needs a zone with a skipped calendar day
 * (`metadata-editor-skipped-day.spec.ts`). Asking for another zone through a named variable keeps
 * it deliberate: an inherited `TZ` cannot quietly move the suite.
 */
describe('the suite’s time zone', () => {
  /** What `vite.config.mts` resolves the pin to: its default, or an explicit `SATORI_TEST_TZ`. */
  const EXPECTED = process.env['SATORI_TEST_TZ'] ?? 'Asia/Calcutta';

  it('is the zone vite.config.mts pins, so date assertions can fail', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EXPECTED);
  });

  it('is offset from UTC, which is what gives those assertions their teeth', () => {
    // The property the pin exists for, stated independently of which zone was chosen: in UTC the
    // two anchorings are indistinguishable, so a zero offset would make them vacuous.
    expect(new Date('2024-03-06T00:00:00.000Z').getTimezoneOffset()).not.toBe(0);
  });
});
