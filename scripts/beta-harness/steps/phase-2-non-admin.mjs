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

  // The groups come from the server, as this account, not from the client session. Any group that
  // grants administration access fails the check: `AuthService.hasAdministrationAccess` also counts
  // power users, so the membership is what decides, not a flag the client can hold.
  const me = await page.request.get(`${h.baseUrl}/nuxeo/api/v1/me`).then((r) => r.json());
  const groups = me?.properties?.groups ?? [];
  // Group membership is not the whole test: AuthService also accepts an isAdministrator flag, top-level or
  // nested, and the built-in Administrator username. Any of those makes this account an administrator.
  const flagged = me?.isAdministrator === true || me?.properties?.isAdministrator === true;
  const builtIn = me?.id === 'Administrator' || me?.properties?.username === 'Administrator';
  h.check(
    'the account is a member with no administration group, flag or built-in name',
    groups.includes('members') && !groups.includes('administrators') && !groups.includes('powerusers') && !flagged && !builtIn,
    `groups ${JSON.stringify(groups)}, isAdministrator ${JSON.stringify(me?.isAdministrator)}, id ${JSON.stringify(me?.id)}`,
  );

  await h.step('A user without administration access is not offered Administration');
  const nav = await readNav(page);
  const ids = nav.map(([id]) => id);
  h.check(
    'Administration is absent for a user without access',
    !ids.includes('app.navbar.administration'),
    `rendered: ${JSON.stringify(ids)}`,
  );
  // Exactly the packaged enabled entries, in order, minus Administration. Any entry that goes missing
  // for a member fails here, not only the four spot-checked above.
  const expected = [
    'app.navbar.dashboard', 'app.navbar.browse', 'app.navbar.recentlyViewed', 'app.navbar.search',
    'app.navbar.expiredQueue', 'app.navbar.assets', 'app.navbar.tasks', 'app.navbar.favorites',
    'app.navbar.collections', 'app.navbar.personalSpace', 'app.navbar.clipboard', 'app.navbar.trash',
  ];
  h.check(
    'nothing else is removed: the rest of the packaged navigation is exactly as expected',
    JSON.stringify(ids) === JSON.stringify(expected),
    `rendered: ${JSON.stringify(ids)}`,
  );
  await h.screenshot('non-admin-nav');

  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note('Client gate only. Server-side permissions are not tested here.');
}
