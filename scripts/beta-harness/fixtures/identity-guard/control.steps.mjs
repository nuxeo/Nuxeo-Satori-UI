/**
 * The steps the identity guard's live negative controls run (`identity-guard.controls.mjs`).
 *
 * Deliberately weak checks: an app shell and a browse page render for `Anonymous` exactly as they
 * do for the real user, which is the whole problem the guard exists for. So in every mode these
 * checks pass, and the only thing that can make a faulted run red is the guard. A control whose
 * own checks failed would prove nothing about it.
 *
 * `IDENTITY_GUARD_CONTROL` picks the fault, applied in step 2, after a correct sign-in:
 *
 * - `none` — no fault; the positive control. Must pass, or the guard rejects good runs.
 * - `drop-credentials` — the run stops sending credentials: the context's `httpCredentials` are
 *   removed and every browser request to `/nuxeo` has its `Authorization` header stripped.
 * - `adopt-anonymous-cookie` — the browser picks up a guest `JSESSIONID` and loses its session,
 *   as a new tab or a cleared `sessionStorage` would; on reload the app signs itself in as the
 *   guest. Nothing in the run asked for that, and nothing but the guard notices.
 */

const MODES = ['none', 'drop-credentials', 'adopt-anonymous-cookie'];

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  const mode = process.env['IDENTITY_GUARD_CONTROL'] ?? 'none';

  await h.step(`Sign in correctly (control: ${mode})`);
  h.requirePrecondition(
    'IDENTITY_GUARD_CONTROL names a known fault',
    MODES.includes(mode),
    `one of ${MODES.join(', ')}`,
  );
  await h.login();
  await h.expectVisible('app shell rendered', 'app-shell');
  await h.screenshot('signed-in');

  await h.step(`Apply the fault: ${mode}`);
  if (mode === 'drop-credentials') {
    await page.context().setHTTPCredentials(null);
    await page.route('**/nuxeo/**', (route) => {
      const headers = { ...route.request().headers() };
      delete headers['authorization'];
      return route.continue({ headers });
    });
  } else if (mode === 'adopt-anonymous-cookie') {
    // A guest session, obtained the way any credential-less visit obtains one: Nuxeo's entry
    // page hands it out on the redirect to its UI (the REST API alone does not).
    const res = await fetch(`${new URL(h.baseUrl).origin}/nuxeo/`, { redirect: 'manual' });
    const jsessionid = /JSESSIONID=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    h.requirePrecondition(
      'the server hands a guest a session cookie',
      Boolean(jsessionid),
      `an unauthenticated /nuxeo/ answered ${res.status} with no JSESSIONID; this control needs a guest-enabled Nuxeo`,
    );
    await page.evaluate(() => {
      sessionStorage.removeItem('agentic_ui_nuxeo_session');
      localStorage.removeItem('agentic_ui_nuxeo_session');
    });
    await page.context().clearCookies();
    await page
      .context()
      .addCookies([
        {
          name: 'JSESSIONID',
          value: /** @type {string} */ (jsessionid),
          url: `${new URL(h.baseUrl).origin}/nuxeo/`,
        },
      ]);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await h.expectVisible('app shell still rendered', 'app-shell');
  await h.screenshot(`after-${mode}`);

  await h.step('Browse renders');
  await h.goTo('/#/browse');
  await h.expectVisible('browse page rendered', 'lib-browse');
  await h.screenshot('browse');
}
