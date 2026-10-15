/**
 * Template for a Beta phase steps file.
 *
 * Copy to `<phase-id>.mjs` and run:
 *   npm run beta:evidence -- <phase-id>
 *
 * Rules that make the output count as evidence:
 *
 * 1. Every `h.step()` must record at least one check. A screenshot with no
 *    assertion behind it proves only that a page rendered something.
 * 2. Assert the thing the phase claims to deliver, not that the page is alive.
 *    "nxs-document-list present" is weak; "column header shows Modified By and
 *    the first row is a folder" is the claim a reviewer cares about.
 * 3. Capture the failure states too. If a phase adds an error path, drive it and
 *    photograph it — reviewers ask about those first.
 * 4. Finish with `h.expectNoConsoleErrors()` so runtime breakage cannot hide
 *    behind a screenshot that looks correct.
 * 5. Never use `h.check(name, true)` to record a limitation — it cannot fail, so it
 *    certifies nothing while inflating the total. Use `h.note(text)`. And if the
 *    file only applies in a particular environment, open with
 *    `h.requirePrecondition(...)` so a mismatch aborts instead of producing a page
 *    of reds that look like defects.
 * 6. Name each screenshot for what it actually shows. The runner hashes them and
 *    reports how many distinct images the run produced; a shot called
 *    `manifest-relabels-nav` that is byte-identical to the default one claims an
 *    observation it cannot support. Change what is on screen, or rename the shot.
 *
 * Helper reference: see `scripts/beta-harness/helpers.mjs`.
 *   h.step(label)                        open a named step
 *   h.screenshot(name, locator?)         capture into the phase folder
 *   h.check(name, condition, detail?)    record an arbitrary assertion
 *   h.note(text)                         record what this run does NOT cover
 *   h.requirePrecondition(n, cond, d)    abort if the environment does not apply
 *   h.expectVisible(name, selector)      assert a selector becomes visible
 *   h.expectText(name, selector, text)   assert a selector contains text
 *   h.expectNoConsoleErrors(name?)       assert a clean browser console
 *   h.goTo(route) / h.goToDoc(uid)       navigate
 *   h.login()                            inject an authenticated session
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 * @param {string} outDir absolute path to this run's evidence folder
 */
// eslint-disable-next-line no-unused-vars
export default async function run(page, h, outDir) {
  h.step('Set up');
  await h.login();
  await h.expectVisible('app shell rendered', 'app-shell');

  h.step('Describe what this phase delivers');
  await h.goTo('/#/browse');
  // Replace with assertions specific to the phase.
  await h.expectVisible('browse page rendered', 'lib-browse');
  await h.screenshot('phase-outcome');

  h.step('Health');
  h.expectNoConsoleErrors();
}
