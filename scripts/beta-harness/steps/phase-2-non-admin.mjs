/**
 * Phase 2, non-administrator visibility — its own run. Not passing yet.
 *
 * The claim: the Administration entry is not offered to a user without administration access, and
 * nothing else is removed along with it.
 *
 * The assertions need a real non-administrator Nuxeo account and a sign-in as that account, neither
 * of which is set up here. A client-only member session was tried and rejected by the identity
 * guard: the stored credential stays the administrator's, so the requests would run as
 * Administrator while the page claimed to be a member.
 *
 * This file therefore never records a pass. Every run ends precondition-not-met, with the reason
 * below. It is not a check that passes when its inputs are missing.
 *
 * Creating a member account is a server change and needs approval.
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  await h.step('A real non-administrator account is available to run as');
  const configured = Boolean(process.env.NUXEO_MEMBER_USER && process.env.NUXEO_MEMBER_PASS);
  // Flip to true only when the sign-in-as-member assertions are written in this file.
  const ASSERTIONS_WRITTEN = false;
  h.note('the non-administrator assertions are not written yet, so no visibility claim is made here');
  h.requirePrecondition(
    'the non-administrator assertions exist and have a member account to run as',
    ASSERTIONS_WRITTEN && configured,
    configured
      ? 'member credentials are set, but the sign-in-as-member assertions are not written in this file yet'
      : 'no member account is configured (NUXEO_MEMBER_USER / NUXEO_MEMBER_PASS). This instance has only the ' +
          'Administrator account, and a client-only member session is refused by the identity guard.',
  );
}
