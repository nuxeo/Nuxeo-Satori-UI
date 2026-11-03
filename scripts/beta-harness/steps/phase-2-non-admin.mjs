/**
 * Phase 2, non-administrator visibility.
 *
 * The claim: a signed-in user without administration access is not offered the Administration entry,
 * and nothing else is removed along with it.
 *
 * This run is signed in as a real non-administrator Nuxeo account (members group, not an
 * administrator). The run's own user is that account, so the identity guard sees no change of
 * identity. Set both variables to the member account and run it on its own:
 *
 *   NUXEO_USER=<member> NUXEO_PASS=<password> npm run beta:evidence -- phase-2-non-admin
 *
 * It says nothing about server-side authorisation. The client's Layer 1 gate is what is under test;
 * Nuxeo enforces its own permissions regardless.
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
  await h.step('Signed in as a non-administrator');
  await h.login();
  await h.goTo('/#/browse');
  await page.waitForTimeout(1500);
  const me = await page.evaluate(() => JSON.parse(sessionStorage.getItem('agentic_ui_nuxeo_session') ?? '{}'));
  h.check(
    'the application holds a non-administrator session',
    me.isAdministrator !== true && me.username !== 'Administrator',
    `session: ${JSON.stringify({ username: me.username, isAdministrator: me.isAdministrator })}`,
  );

  await h.step('A user without administration access is not offered Administration');
  const nav = await readNav(page);
  const ids = nav.map(([id]) => id);
  h.check(
    'Administration is absent for a user without access',
    !ids.includes('app.navbar.administration'),
    `rendered: ${JSON.stringify(ids)}`,
  );
  h.check(
    'the rest of the navigation is still there',
    ['app.navbar.dashboard', 'app.navbar.browse', 'app.navbar.search'].every((id) => ids.includes(id)),
    `rendered: ${JSON.stringify(ids)}`,
  );
  await h.screenshot('non-admin-nav');

  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note('Client gate only. Server-side permissions are not tested here.');
}
