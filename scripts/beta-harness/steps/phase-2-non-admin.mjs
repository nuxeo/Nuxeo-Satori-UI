/**
 * Phase 2, non-administrator visibility — its own run. Not passing yet.
 *
 * The claim: the Administration entry is not offered to a user without administration access, and
 * nothing else is removed along with it.
 *
 * This run needs a real non-administrator Nuxeo account, passed in the environment. A client-only
 * member session was tried and rejected by the identity guard: the stored credential stays the
 * administrator's, so the requests would run as Administrator while the page claimed to be jdoe.
 * A result obtained that way is invalid, so the check is not attempted here.
 *
 * Until such an account exists, this run reports precondition-not-met. Creating one is a server
 * change and needs approval.
 *
 * Run (once the account exists):
 *   NUXEO_MEMBER_USER=<user> NUXEO_MEMBER_PASS=<password> npm run beta:evidence -- phase-2-non-admin
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  await h.step('A real non-administrator account is available to run as');
  h.requirePrecondition(
    'a non-administrator Nuxeo account is configured',
    Boolean(process.env.NUXEO_MEMBER_USER && process.env.NUXEO_MEMBER_PASS),
    'the environment has no NUXEO_MEMBER_USER / NUXEO_MEMBER_PASS, and this instance has only the ' +
      'Administrator account. A client-only member session is refused by the identity guard, so ' +
      'this check is not run as a substitute.',
  );
}
