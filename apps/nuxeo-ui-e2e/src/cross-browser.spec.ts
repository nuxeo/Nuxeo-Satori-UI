import { aRootChild, expect, expectRowWithData, newNuxeoApiContext, test } from './fixtures';
import { type APIRequestContext } from '@playwright/test';

/**
 * Cross-engine behaviour — Phase 6 step 5, "Chrome and Safari verified".
 *
 * ## Why this file exists separately from the other twelve specs
 *
 * Registering the `webkit` project made all twelve existing specs pass on the first attempt.
 * That is a weak result presented as a strong one: those specs assert that surfaces render and
 * that repository data arrives, and **nothing about them is engine-sensitive**. A suite that
 * passes identically on two engines has not compared them — it has run the same
 * engine-independent assertions twice.
 *
 * Engines actually diverge in a small number of places, and this file targets the ones this
 * application depends on. Each test below is here because a *specific* known difference could
 * break it, and that reason is stated on the test. They run under both projects, so a
 * divergence shows up as one engine red and the other green rather than as a vague failure.
 *
 * ## The claim this file supports, and the one it does not
 *
 * It supports: "the Beta surfaces behave the same on Blink and WebKit for date rendering, blob
 * decoding, session persistence across reload, and keyboard reachability".
 *
 * It does **not** support "verified on Safari". WebKit-via-Playwright shares Safari's engine but
 * not its UI, its extension surface, or iOS's stricter storage partitioning and autoplay rules.
 * Nothing here runs on a real Safari or on iOS. That gap is recorded rather than blurred,
 * because "Chrome and Safari verified" is a checklist line a customer may read literally.
 */

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await newNuxeoApiContext();
});

test.afterAll(async () => {
  await api?.dispose();
});

test.describe('cross-engine behaviour', () => {
  /**
   * The classic Safari divergence: `new Date('2026-08-24 10:00:00')` — a space instead of `T` —
   * is `Invalid Date` on WebKit and parses fine on Blink. Nuxeo returns ISO-8601 with `Z`
   * (`dc:modified` was verified as `"2026-06-03T04:25:33.196Z"` on the local instance), so this
   * should hold; the point is that nothing was asserting it, and a future field fed from a
   * differently-formatted source would break on Safari only.
   *
   * Asserted as the *absence* of the failure strings, because that is what a user sees. A date
   * that fails to parse renders `Invalid Date` or `NaN`, never an exception.
   */
  test('dates render on every listing surface, with no Invalid Date or NaN', async ({
    signedIn: page,
  }) => {
    for (const route of ['/#/browse', '/#/search']) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      const body = await page.locator('body').innerText();

      // Presence FIRST. The original version asserted only the absence of `Invalid Date` and
      // `NaN`, and the bogus-credentials sensitivity run caught it passing on both engines: with
      // no data there are no dates, so "no invalid date" held vacuously. An absence assertion
      // over an empty page is not an assertion. 24 of 34 specs failed under bogus credentials
      // and this was one of the two that did not, for exactly that reason.
      // Both formats, because the two surfaces disagree: browse renders `Jun 3, 2026` via
      // `toLocaleDateString()` and search renders `2026-08-24`. That inconsistency is real and
      // out of scope here — noted rather than silently accommodated — but a pattern matching only
      // one of them would make this spec vacuous on the other surface, which is the defect it was
      // just fixed for.
      const dates =
        body.match(
          /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/g,
        ) ?? [];
      expect(
        dates.length,
        `${route} rendered no date at all, so there is nothing to check for parse failures`,
      ).toBeGreaterThan(0);

      expect(body, `${route} shows a date that failed to parse`).not.toMatch(/Invalid Date/);
      expect(body, `${route} shows NaN where a number or date belongs`).not.toMatch(/\bNaN\b/);
    }
  });

  /**
   * Browse renders thumbnails from **blob URLs**, never from a Nuxeo URL directly — a repository
   * rule (`checkNoNuxeoUrlInImgSrc`) because a direct URL bypasses the HTTP interceptor and
   * carries no credentials.
   *
   * That makes blob decoding load-bearing, and blob URLs are a real engine difference: WebKit
   * has historically been stricter about their lifetime and about revoking one while an `<img>`
   * still references it. `naturalWidth > 0` is the assertion that matters — a broken blob still
   * produces an `<img>` element that is "visible", so presence proves nothing.
   *
   * It skips only when the root has no thumbnailable content at all — but not before asserting
   * the repository rule itself, so "blob rendering is broken" cannot hide inside that skip.
   */
  test('blob-URL images actually decode', async ({ signedIn: page }) => {
    await page.goto('/#/browse', { waitUntil: 'networkidle' });

    const rootChild = await aRootChild(api);
    await expectRowWithData(page, 'lib-browse', rootChild.title);
    await page.waitForTimeout(2000);

    // Two assertions, because "no blob images" has two very different causes: an instance with
    // nothing thumbnailable, and blob rendering being broken. Asserting the repository rule
    // first — no `<img>` may point at Nuxeo directly — means the second cause cannot hide in a
    // skip. `checkNoNuxeoUrlInImgSrc` enforces this statically; this is the runtime half.
    const nuxeoSourced = await page
      .locator('lib-browse img[src]')
      .evaluateAll((imgs) =>
        imgs
          .map((i) => (i as HTMLImageElement).getAttribute('src') ?? '')
          .filter((src) => /\/nuxeo\//.test(src)),
      );
    expect(
      nuxeoSourced,
      'an <img> is sourced from Nuxeo directly, bypassing the HTTP interceptor',
    ).toEqual([]);

    const blobImages = page.locator('img[src^="blob:"]');
    const count = await blobImages.count();
    test.skip(count === 0, 'no blob-backed thumbnails at the repository root on this instance');

    const decoded = await blobImages.evaluateAll((imgs) =>
      imgs.map((i) => ({
        complete: (i as HTMLImageElement).complete,
        width: (i as HTMLImageElement).naturalWidth,
      })),
    );
    for (const [i, img] of decoded.entries()) {
      expect(img.complete, `blob image ${i} did not finish loading`).toBe(true);
      expect(img.width, `blob image ${i} decoded to zero width`).toBeGreaterThan(0);
    }
  });

  /**
   * The app keeps its session in `sessionStorage`, which is why the fixture uses
   * `addInitScript` rather than `storageState`. WebKit applies stricter storage partitioning
   * than Blink, and a same-document hash navigation is not the same as a reload — so this
   * performs a **real** `page.reload()`, which re-runs `APP_INITIALIZER`.
   *
   * That distinction is recorded in CLAUDE.md for the evidence harness, where `withHashLocation()`
   * made `goto('/#/x')` same-document and an initializer assertion never re-ran.
   */
  test('the session survives a real reload, not just a hash navigation', async ({
    signedIn: page,
  }) => {
    await page.goto('/#/browse', { waitUntil: 'networkidle' });

    const rootChild = await aRootChild(api);
    await expectRowWithData(page, 'lib-browse', rootChild.title);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Still authenticated: the guard did not bounce us, and a repository row arrived again.
    // Asserted as a row rather than as surface text, or an empty listing whose copy happens
    // to name the expected title would satisfy it (NXSAT-708).
    expect(page.url(), 'a reload should not redirect to sign-in').not.toMatch(/sign-?in|login/i);
    await expectRowWithData(page, 'lib-browse', rootChild.title);
  });

  /**
   * Phase 6 step 3 gave the dashboard's scrollable `.widget-body` `tabindex="0"`, because
   * `overflow-y: auto` without keyboard access is WCAG 2.1.1 — axe reports it as
   * `scrollable-region-focusable`.
   *
   * Focusability is exactly the sort of thing that differs between engines: WebKit's rules for
   * what `.focus()` will accept, and for which elements enter the sequential focus order, have
   * historically been narrower than Blink's. An accessibility fix that works on one engine and
   * not the other is a fix for some users only.
   */
  test('the scrollable widget region is focusable on this engine', async ({ signedIn: page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Selected WITHOUT the `[tabindex="0"]` predicate, and that is the whole point. The first
    // version of this spec selected `.widget-body[tabindex="0"]` and skipped when it found
    // nothing — so removing the fix made the spec SKIP, reporting green, instead of failing.
    // The negative control caught it. Locate the region by what it *is*, then assert the
    // property under test.
    const region = page.locator('.widget-body').first();
    test.skip((await region.count()) === 0, 'no widget-body rendered on the landing surface');

    await expect(
      region,
      'the scrollable region lost tabindex="0" — WCAG 2.1.1, axe scrollable-region-focusable',
    ).toHaveAttribute('tabindex', '0');

    await region.focus();
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return { cls: el?.className ?? '', tabindex: el?.getAttribute('tabindex') ?? null };
    });
    expect(focused.cls, 'focus did not land on the scrollable region').toContain('widget-body');
    expect(focused.tabindex, 'the focused region should be the one made focusable').toBe('0');
  });

  /**
   * A quoted search term already has a spec, and it is here in a different form on purpose: the
   * existing one asserts the query does not error, this one asserts the **term survives into the
   * input** after a round trip.
   *
   * Quote and apostrophe handling crosses three layers that differ by engine — the input's
   * value, our NXQL escaping, and Angular's sanitiser — and the a11y work in this phase changed
   * one of those escapers (`esc()` gained `"` and `'`) in a different file. A round-trip
   * assertion is the cheapest way to notice if an engine normalises the value differently.
   */
  test('a search term containing a quote and an apostrophe round-trips', async ({
    signedIn: page,
  }) => {
    await page.goto('/#/search', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    // Asserted, not skipped: search with no text input is a broken search surface, and a spec
    // that skips on it would report green for exactly the failure it exists to notice.
    const input = page.locator('input[type="text"], input[type="search"]').first();
    await expect(input, 'the search surface has no text input').toBeVisible();

    const term = `it's a "quoted" term`;
    await input.fill(term);
    await expect(input, 'the engine altered the value on the way in').toHaveValue(term);

    await input.press('Enter');
    await page.waitForTimeout(2500);

    // The app must still be functional: no unhandled error surface, and the term is intact.
    await expect(input, 'the term did not survive the query round trip').toHaveValue(term);
    const body = await page.locator('body').innerText();
    expect(body, 'a quote in the term produced an error surface').not.toMatch(
      /Unexpected token|SyntaxError|500 Internal/i,
    );
  });
});
