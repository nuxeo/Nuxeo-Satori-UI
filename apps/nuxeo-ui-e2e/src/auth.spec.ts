import { expect, test } from '@playwright/test';

/**
 * The route guards, tested **without** the `signedIn` fixture.
 *
 * Every other spec injects a session, which is the right trade — driving the form in each
 * one would make sign-in the slowest and most repeated assertion in the suite. But that
 * leaves the guards themselves untested, and an unguarded app is a security defect rather
 * than a cosmetic one. So they are covered here, once, on purpose. `test` comes from
 * Playwright directly because the fixture's whole job is to defeat what this file asserts.
 *
 * ## Why "an unauthenticated visitor is redirected" is NOT asserted here
 *
 * It was, in the first version, and it failed — for a reason worth recording rather than
 * patching around.
 *
 * The local Nuxeo has **anonymous authentication enabled**: `GET /nuxeo/api/v1/me` with no
 * credentials at all returns HTTP 200 and `{ id: 'Anonymous' }`, both through the dev proxy
 * and directly on :8080. With no stored session, `AuthService.runHydration()` falls through
 * to `tryEstablishCookieSessionOnly()`, which probes `/me` — the intentional SSO-detection
 * path, because an SSO cookie is how a real deployment signs a user in without a form. The
 * server says "you are Anonymous", the app believes it, and `isAuthenticated()` is true.
 *
 * So the app behaved correctly and `authGuard` is sound; the *environment* makes an
 * unauthenticated visitor unobservable. Removing `httpCredentials` did not help, because the
 * credentials were never what made `/me` succeed. Asserting a redirect that this server can
 * never produce would be a permanently red test, and skipping it would be coverage that is
 * not there.
 *
 * What is asserted instead are the two guard behaviours that *are* observable, and both are
 * real:
 *
 *   1. an explicitly signed-out visitor IS redirected — `runHydration()` short-circuits on
 *      the sign-out flag and clears state, so this exercises the guard's redirect for real;
 *   2. Anonymous is NOT granted administration access — the privilege boundary, which
 *      matters more here precisely because anonymous access is enabled.
 */
const SIGNED_OUT_KEY = 'agentic_ui_signed_out';

// Declared before the describe block: `test.use` applies to the file, and Playwright warns
// if it appears after the tests it is meant to configure.
test.use({ httpCredentials: undefined });

test.describe('authentication and authorisation', () => {
  test('an explicitly signed-out visitor is redirected to sign-in', async ({ page }) => {
    // The flag `AuthService.markSignedOut()` writes. `runHydration()` checks it before
    // anything else, sets state to null and clears storage — so the guard must redirect.
    await page.addInitScript((key) => sessionStorage.setItem(key, '1'), SIGNED_OUT_KEY);

    await page.goto('/#/browse', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    expect(page.url(), 'a signed-out visitor should be sent to /login').toMatch(/#\/login/);
    await expect(page.locator('lib-browse')).toHaveCount(0);
  });

  test('the sign-in surface renders', async ({ page }) => {
    await page.addInitScript((key) => sessionStorage.setItem(key, '1'), SIGNED_OUT_KEY);
    await page.goto('/#/login', { waitUntil: 'networkidle' });

    // A form that cannot be submitted is not a sign-in page, so assert the control exists
    // rather than only that some text appeared.
    await expect(page.locator('button, input[type="submit"]').first()).toBeVisible();
  });

  test('skip link is first in tab order and focuses the first sign-in control (NXENG-745)', async ({
    page,
  }) => {
    await page.addInitScript((key) => sessionStorage.setItem(key, '1'), SIGNED_OUT_KEY);
    await page.goto('/#/login', { waitUntil: 'networkidle' });

    const skip = page.locator('a.login-skip-link');
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();

    await page.keyboard.press('Enter');
    const username = page.locator('input[formcontrolname="username"]');
    await expect(username).toBeFocused();
    // Bypass must land past the Hyland logo inside main#login-main, not on the brand link.
    await expect(page.locator('a.login-brand')).not.toBeFocused();
    expect(page.url()).toMatch(/#\/login$/);
  });

  test('password field stays visible when focused via keyboard (NXENG-749)', async ({ page }) => {
    await page.addInitScript((key) => sessionStorage.setItem(key, '1'), SIGNED_OUT_KEY);
    await page.goto('/#/login', { waitUntil: 'networkidle' });

    const username = page.locator('input[formcontrolname="username"]');
    const password = page.locator('input[formcontrolname="password"]');
    const passwordLabel = page.locator('mat-form-field.login-field-password mat-label');

    await username.focus();
    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await expect(passwordLabel).toBeVisible();

    const labelBox = await passwordLabel.boundingBox();
    const pwdBox = await password.boundingBox();
    expect(labelBox, 'password label should have layout box').not.toBeNull();
    expect(pwdBox, 'password input should have layout box').not.toBeNull();
    expect(labelBox!.y).toBeLessThan(pwdBox!.y);

    const usernameField = page.locator('mat-form-field').filter({ has: username });
    const passwordField = page.locator('mat-form-field.login-field-password');
    const usernameZ = await usernameField.evaluate((el) => getComputedStyle(el).zIndex);
    const passwordZ = await passwordField.evaluate((el) => getComputedStyle(el).zIndex);
    expect(Number(passwordZ)).toBeGreaterThan(Number(usernameZ) || 0);
  });

  test('password field stays unobscured when Tab-focused on a short viewport (NXENG-749)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 320 });
    await page.addInitScript((key) => sessionStorage.setItem(key, '1'), SIGNED_OUT_KEY);
    await page.goto('/#/login', { waitUntil: 'networkidle' });

    const username = page.locator('input[formcontrolname="username"]');
    const password = page.locator('input[formcontrolname="password"]');
    const passwordLabel = page.locator('mat-form-field.login-field-password mat-label');

    await username.focus();
    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    const assertInViewport = async (locator: ReturnType<typeof page.locator>, name: string) => {
      const box = await locator.boundingBox();
      expect(box, `${name} should have layout box`).not.toBeNull();
      expect(box!.y, `${name} should not be clipped above viewport`).toBeGreaterThanOrEqual(0);
      expect(
        box!.y + box!.height,
        `${name} should not be clipped below viewport`,
      ).toBeLessThanOrEqual(viewport!.height);
    };

    await assertInViewport(passwordLabel, 'password label');
    await assertInViewport(password, 'password input');
  });

  test('login form stays usable in forced-colors (Windows high contrast) (NXENG-751)', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.addInitScript((key) => sessionStorage.setItem(key, '1'), SIGNED_OUT_KEY);
    await page.goto('/#/login', { waitUntil: 'networkidle' });

    const username = page.getByLabel('Username (required)', { exact: true });
    const password = page.getByLabel('Password (required)', { exact: true });
    const submit = page.locator('button.login-submit');

    await expect(username).toBeVisible();
    await expect(password).toBeVisible();
    await expect(submit).toBeVisible();

    const heroImg = page.locator('img.login-hero-image');
    await expect(heroImg).toHaveAttribute('alt', '');
    const heroOpacity = await heroImg.evaluate((el) => getComputedStyle(el).opacity);
    expect(heroOpacity, 'forced-colors hides decorative hero art').toBe('0');

    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(submit).toBeFocused();

    const focusRing = await submit.evaluate((el) => {
      const style = getComputedStyle(el);
      const outlineWidthPx = Number.parseFloat(style.outlineWidth) || 0;
      return { outlineWidthPx, outlineStyle: style.outlineStyle };
    });
    expect(focusRing.outlineStyle).not.toBe('none');
    expect(focusRing.outlineWidthPx).toBeGreaterThanOrEqual(2);
  });

  test('Log in shows a visible focus indicator when reached via Tab (NXENG-750)', async ({
    page,
  }) => {
    await page.addInitScript((key) => sessionStorage.setItem(key, '1'), SIGNED_OUT_KEY);
    await page.goto('/#/login', { waitUntil: 'networkidle' });

    const submit = page.locator('button.login-submit');
    await expect(submit).toBeVisible();

    // Skip link → brand link → username → password → submit (empty credentials, disabledInteractive).
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(submit).toBeFocused();

    const focusRing = await submit.evaluate((el) => {
      const style = getComputedStyle(el);
      const outlineWidthPx = Number.parseFloat(style.outlineWidth) || 0;
      const shadow = style.boxShadow;
      const hasVisibleShadow =
        shadow !== 'none' &&
        shadow.split(',').some((layer) => !/^0px\s+0px\s+0px\s+0px/.test(layer.trim()));
      return {
        outlineWidthPx,
        outlineStyle: style.outlineStyle,
        hasVisibleShadow,
      };
    });
    expect(focusRing.outlineStyle).not.toBe('none');
    expect(
      focusRing.outlineWidthPx >= 2 || focusRing.hasVisibleShadow,
      'focus-visible should render a 2px+ outline or non-zero focus shadow',
    ).toBe(true);
  });

  test.describe('without the suite-wide credentials', () => {
    /**
     * This test needs a context with **no** `httpCredentials`, which cannot be expressed as
     * `test.use({ httpCredentials: undefined })` — Playwright treats the undefined as "not
     * overridden" and the config's value survives. Measured: still red that way. So the
     * context is built explicitly, which is the only form that actually drops them.
     *
     * `baseURL` and `viewport` are restated because `browser.newContext()` starts from the
     * browser, not from this project's `use` block, so a relative `goto` would otherwise
     * have no origin to resolve against.
     */
    test('an anonymous visitor is not granted administration access', async ({ browser }) => {
      /**
       * The privilege boundary. `adminGuard` admits only `hasAdministrationAccess()` and sends
       * everyone else to `/dashboard`. With anonymous auth enabled server-side, an unauthenticated
       * visitor reaches the app as `Anonymous` — so this is the assertion that keeps that from
       * meaning "reaches administration".
       *
       * The config sends Basic auth to the app origin on **every** request (`send: 'always'`,
       * NXSAT-643) because a guest-enabled Nuxeo never issues a 401 challenge. Correct for the
       * rest of the suite, and fatal here: it authenticates this "anonymous visitor" as the
       * administrator and grants exactly the access this test exists to deny. The test then
       * failed reporting that `Anonymous` reached administration, when what reached it was a
       * fully privileged session. The paragraph above this one predicted that in prose —
       * "`httpCredentials` off … would grant exactly the access this test exists to deny" —
       * while nothing enforced it. Now the context does.
       */
      const context = await browser.newContext({
        httpCredentials: undefined,
        baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4200',
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      try {
        await page.goto('/#/administration', { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);

        expect(page.url(), 'Anonymous should be redirected off /administration').not.toMatch(
          /#\/administration/,
        );
      } finally {
        await context.close();
      }
    });
  });
});
