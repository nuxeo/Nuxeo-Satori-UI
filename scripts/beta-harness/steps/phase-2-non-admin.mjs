/**
 * Phase 2, non-administrator visibility — its own run.
 *
 * The claim: the Administration entry is not offered to a user without administration access, and
 * nothing else is removed along with it.
 *
 * It runs in its own file, not inside phase 2, because the identity guard judges every step
 * boundary against the configured user. A check that runs as another user cannot share a run with
 * the rest, so the switch is declared with `h.signedInAs`, which the guard records as a deliberate
 * change of browser identity.
 *
 * **What this proves and what it does not.** The session the app holds is replaced with a
 * non-administrator's, and `/me` is answered as an ordinary member. So this tests the client's
 * Layer 1 gate, which is what phase 2 changed. It is not a second Nuxeo account, and it says nothing
 * about server-side authorisation, which Nuxeo enforces regardless. The XHRs still carry the
 * configured user's credentials.
 *
 * Prerequisites:
 *   npm run beta:backend
 *   npx nx serve nuxeo-ui
 *
 * Run:
 *   npm run beta:evidence -- phase-2-non-admin
 */

const ENVIRONMENTAL_ERRORS = [
  /automation\/AI\./,
  '/nuxeo/logout',
  '/agentic-ui-config/bootstrap.json',
  '/agentic-ui-config/manifest.json',
];

/** The navigation as rendered: `[nav id, label]` for each entry. */
function readNav(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('a[sat-platform-nav-menu-item][data-nav-id]')].map((el) => [
      el.getAttribute('data-nav-id'),
      (el.textContent ?? '').trim(),
    ]),
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  await h.step('Baseline: the configured administrator is offered Administration');
  await h.login();
  await h.goTo('/#/browse');
  await page.waitForTimeout(1500);
  const asAdmin = await readNav(page);
  h.check(
    'Administration is present for the administrator',
    asAdmin.some(([id]) => id === 'app.navbar.administration'),
    `rendered: ${JSON.stringify(asAdmin.map(([id]) => id))}`,
  );
  await h.screenshot('admin-nav');

  await h.step('A user without administration access is not offered Administration');
  // Declared before the switch, so the identity guard knows this is a deliberate change.
  await h.signedInAs('jdoe', 'the non-administrator check runs as a member, not the configured user');

  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({
        'entity-type': 'user',
        id: 'jdoe',
        properties: { username: 'jdoe', groups: ['members'] },
        isAdministrator: false,
        extendedGroups: [{ name: 'members', label: 'Members' }],
      }),
    }),
  );
  await page.evaluate(() => {
    const key = 'agentic_ui_nuxeo_session';
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...JSON.parse(raw), username: 'jdoe', isAdministrator: false, groups: ['members'] }),
    );
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1500);

  const asMember = await readNav(page);
  h.check(
    'the application believes it is a non-administrator',
    await page.evaluate(() => {
      const session = JSON.parse(sessionStorage.getItem('agentic_ui_nuxeo_session') ?? '{}');
      return session.isAdministrator === false && session.username === 'jdoe';
    }),
    'the session was re-hydrated back to an administrator',
  );
  h.check(
    'Administration is absent for a user without access',
    !asMember.some(([id]) => id === 'app.navbar.administration'),
    `rendered: ${JSON.stringify(asMember.map(([id]) => id))}`,
  );
  h.check(
    'nothing else was removed with it',
    JSON.stringify(asMember) ===
      JSON.stringify(asAdmin.filter(([id]) => id !== 'app.navbar.administration')),
    `member rendered ${JSON.stringify(asMember.map(([id]) => id))}; admin minus Administration ` +
      `is ${JSON.stringify(asAdmin.filter(([id]) => id !== 'app.navbar.administration').map(([id]) => id))}`,
  );
  await h.screenshot('non-admin-nav');

  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    'Client gate only: the session is a member session on the client, and the XHRs still carry the ' +
      'configured user. Server-side authorisation is not tested here.',
  );
}
