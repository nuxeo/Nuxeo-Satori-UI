/**
 * Surface browser-side warnings and errors on the CLI.
 *
 * `deck.html` warns when a slide uses a block type the renderer has no function for — the
 * slide then renders its heading and footnote around an empty body. That warning went to the
 * **page** console, which no tool here was listening to, so `export-pptx.mjs` photographed
 * nine empty slides of `04-walkthrough` and reported success. A warning nobody receives is
 * the same as no warning, and it was introduced in the same change that first made that deck
 * exportable.
 *
 * Attach this immediately after `newPage()` and before any `goto()`: Playwright only
 * delivers events emitted after the listener exists, and `deck.html` renders on load.
 *
 * Reporting, not failing. A deck that is merely missing a block body should still produce its
 * file — the renderer keeps its fallback for the same reason — so this returns a counter the
 * caller can use to say something at the end rather than throwing mid-capture.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {{ readonly warnings: number, readonly errors: number }} live counts
 */
export function forwardPageConsole(page) {
  const seen = { warnings: 0, errors: 0 };

  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'warning' && type !== 'error') return;
    if (type === 'warning') seen.warnings += 1;
    else seen.errors += 1;
    console.warn(`    [page ${type}] ${message.text()}`);
  });

  // An uncaught exception in the page never reaches `console`, and it is the failure most
  // likely to leave a blank slide behind.
  page.on('pageerror', (error) => {
    seen.errors += 1;
    console.warn(`    [page error] ${error.message}`);
  });

  return seen;
}
