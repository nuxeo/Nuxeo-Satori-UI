#!/usr/bin/env node
/**
 * Controls for the permissions-save verdict in `nxsat-308-parity.mjs` step 11.
 *
 * `CLAUDE.md`: *a gate is not evidence until you have seen it fail on purpose.* The check
 * "parity-user's AddChildren survives the save" was green on the nxs surface while nothing was
 * ever saved — the option filter `/^\s*Everything\s*$/` matched no option (our label is "Manage
 * everything"), so no change was staged, no Save appeared, and the entry survived because the ACL
 * was never touched. A check that passes hardest when its subject does not happen is not evidence.
 *
 * These controls run the real `aclSaveVerdict` in process against the observations each situation
 * produces, and assert the verdict against the predicate the step used to carry
 * (`afterAcl.includes('parity-user:AddChildren')` on its own), so the difference is shown rather
 * than described. Control 1 is the one that matters: it is the situation on disk today, and it
 * must go from green under the old predicate to red under the new one.
 *
 * Control 4 is the inversion a previous proposal would have introduced — counting the Save control
 * *after* clicking it. On the happy path the button is gone by then, so that count is zero and the
 * verdict would be red exactly when the save worked. It is kept here so the mistake cannot be made
 * again without a red.
 *
 * The second group checks the root cause itself, and it is on its second correction, because the
 * first one made exactly the mistake this repo keeps catching: it asserted the *model* rather than
 * the product. It compared the filter against bare labels — "Manage everything", "Everything" —
 * and went green, while `permissions-panel.component.html:385-405` appends the permission
 * identifier beside the label wherever the two differ, so the panel renders "Manage everything
 * Everything" and "Edit ReadWrite" and the corrected filter matched neither. The selftest passed
 * and the real page would still have staged nothing.
 *
 * So the group now runs `showsPermission` against the strings the component actually emits, and
 * prints beside each what matching the rendered *text* would have concluded — which is the red,
 * re-proved against the product. The handle is the permission identifier: `data-permission` on
 * every option and the `nxs-permissions-panel__id` span in the trigger. It is the permission's own
 * name, so no change to `permissions.right.*` can break it, which a text match cannot promise.
 * `PERMISSION_OPTION` survives only as the fallback for a surface that discloses no identifier —
 * upstream's, whose markup NXSAT-637 put out of reach.
 *
 * It still does not prove the option list *contains* Everything; only a real run against the panel
 * can. It proves that when it does, this is selected and the previous two rounds would not have
 * selected it.
 *
 * Usage:  node scripts/beta-harness/steps/nxsat-308-parity.selftest.mjs
 */

import { aclSaveVerdict, PERMISSION_OPTION, showsPermission } from './nxsat-308-parity.mjs';

/** The predicate step 11 carried before this change, for the comparison controls 1 and 2 make. */
const oldPredicate = ({ afterAcl }) => afterAcl.includes('parity-user:AddChildren');

const POST = [{ method: 'POST', url: '/nuxeo/api/v1/automation/Document.ReplacePermission' }];
/** A write in the same window that is not the save — an unrelated one must not stand in for it. */
const UNRELATED_POST = [
  { method: 'POST', url: '/nuxeo/api/v1/automation/Document.AddToFavorites' },
];
const SEEDED_ACL = ['parity-user:AddChildren', 'members:ReadWrite'];
const SAVED_ACL = ['parity-user:AddChildren', 'members:Everything'];

const CONTROLS = [
  {
    name: '1. nothing matched the option filter, so nothing was staged and nothing saved',
    why: 'the state on disk today: the old predicate passes here, which is the defect',
    observed: { everythingOffered: 0, saveOffered: 0, writes: [], afterAcl: SEEDED_ACL },
    attempted: false,
    survives: false,
    oldVerdict: true,
  },
  {
    name: '2. the option was chosen, the save landed, and AddChildren is still there',
    why: 'the happy path — the only situation in which the claim may be made',
    observed: {
      everythingOffered: 1,
      saveOffered: 1,
      writes: POST,
      afterAcl: SAVED_ACL,
    },
    attempted: true,
    survives: true,
    oldVerdict: true,
  },
  {
    name: '3. the save landed and dropped the AddChildren entry',
    why: 'the defect the check exists to catch; it must still be caught',
    observed: {
      everythingOffered: 1,
      saveOffered: 1,
      writes: POST,
      afterAcl: ['members:Everything'],
    },
    attempted: true,
    survives: false,
    oldVerdict: false,
  },
  {
    name: '4. a save that landed, counted after the click so the button had gone',
    why: 'the inversion a previous proposal would have introduced: red exactly when the save worked',
    observed: { everythingOffered: 1, saveOffered: 0, writes: POST, afterAcl: SAVED_ACL },
    attempted: false,
    survives: false,
    oldVerdict: true,
  },
  {
    name: '5. a change was staged but no request ever reached the server',
    why: 'a click that did not land must not be read as a save',
    observed: { everythingOffered: 1, saveOffered: 1, writes: [], afterAcl: SEEDED_ACL },
    attempted: false,
    survives: false,
    oldVerdict: true,
  },
  {
    name: '6. a change was staged and the only write in the window was an unrelated one',
    why: 'the request window opens before the control is touched; a stray write must not stand in for the save',
    observed: {
      everythingOffered: 1,
      saveOffered: 1,
      writes: UNRELATED_POST,
      afterAcl: SEEDED_ACL,
    },
    attempted: false,
    survives: false,
    oldVerdict: true,
  },
];

const failures = [];
console.log('aclSaveVerdict controls\n');
for (const control of CONTROLS) {
  const verdict = aclSaveVerdict(control.observed);
  const old = oldPredicate(control.observed);
  const ok =
    verdict.attempted === control.attempted &&
    verdict.survives === control.survives &&
    old === control.oldVerdict;
  const colour = (value) => (value ? 'GREEN' : 'RED');
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${control.name}`);
  console.log(`       ${control.why}`);
  console.log(
    `       "AddChildren survives the save": was ${colour(old)}, now ${colour(verdict.survives)}` +
      ` (a save was attempted: ${verdict.attempted})`,
  );
  if (!ok) {
    failures.push(
      `${control.name} — expected attempted=${control.attempted} survives=${control.survives}` +
        ` old=${control.oldVerdict}, got attempted=${verdict.attempted}` +
        ` survives=${verdict.survives} old=${old}`,
    );
  }
}

/**
 * What an access control on each surface actually renders, and the identifier handle beside it.
 *
 * The nxs strings are not fixtures invented here. `permissions-panel.component.html:385-405` emits
 * the translated label and then, in a `<span class="nxs-permissions-panel__id">`, the permission
 * identifier wherever the two differ. With `permissions.right.*` from
 * `apps/nuxeo-ui/public/i18n/en.json` — `Everything: "Manage everything"`, `ReadWrite: "Edit"`,
 * `Read: "Read"` — that is "Manage everything Everything", "Edit ReadWrite", and for `Read`, where
 * label and identifier are equal, the `@if` omits the span and the text is bare "Read".
 *
 * `textOnly` is the verdict matching the rendered *text* would reach — the test that was on disk
 * for both of this file's previous rounds. It is false on the first two nxs rows: that is the red
 * being re-proved, against what the component renders rather than against a bare label.
 *
 * `[what it renders, the identifier it discloses, showsPermission, what text alone would say]`
 */
const RENDERED = [
  {
    surface: 'nxs',
    permission: 'Everything',
    text: 'Manage everything Everything',
    identifier: 'Everything',
    expected: true,
    textOnly: false,
    why: 'the option step 11 must select; text alone rejects it, which staged nothing',
  },
  {
    surface: 'nxs',
    permission: 'ReadWrite',
    text: 'Edit ReadWrite',
    identifier: 'ReadWrite',
    expected: true,
    textOnly: false,
    why: "the local members row's trigger; text alone rejects it, failing the panel that is correct",
  },
  {
    surface: 'nxs',
    permission: 'Read',
    text: 'Read',
    identifier: '',
    expected: true,
    textOnly: true,
    why: 'label equals identifier, so no span is emitted and the text is all there is',
  },
  {
    surface: 'nxs',
    permission: 'Everything',
    text: 'Edit ReadWrite',
    identifier: 'ReadWrite',
    expected: false,
    textOnly: false,
    why: 'a control showing a different permission must be refused by the identifier',
  },
  {
    surface: 'nxs',
    permission: 'ReadWrite',
    text: 'Manage everything Everything',
    identifier: 'Everything',
    expected: false,
    textOnly: false,
    why: 'the converse: the identifier must not admit the other permission either',
  },
  {
    surface: 'adf-hx',
    permission: 'Everything',
    text: 'Everything',
    identifier: '',
    expected: true,
    textOnly: true,
    why: 'upstream discloses no identifier, so the label is the only handle — the fallback',
  },
  {
    surface: 'adf-hx',
    permission: 'ReadWrite',
    text: 'Read & Write',
    identifier: '',
    expected: true,
    textOnly: true,
    why: "upstream's ReadWrite label, which our own pattern must still admit",
  },
  {
    surface: 'adf-hx',
    permission: 'Everything',
    text: 'Manage everything else',
    identifier: '',
    expected: false,
    textOnly: false,
    why: 'the fallback stays anchored: a longer label containing one must not match',
  },
];

console.log('\nshowsPermission against the text each surface actually renders\n');
for (const r of RENDERED) {
  const got = showsPermission(r.permission, { identifier: r.identifier, text: r.text });
  const textOnly = PERMISSION_OPTION[r.permission].test(r.text);
  const ok = got === r.expected && textOnly === r.textOnly;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${r.surface} ${r.permission}: renders ${JSON.stringify(r.text)},` +
      ` discloses ${r.identifier ? JSON.stringify(r.identifier) : 'no identifier'}` +
      ` — showsPermission ${got ? 'GREEN' : 'RED'}, matching the text alone ${textOnly ? 'GREEN' : 'RED'}`,
  );
  console.log(`       ${r.why}`);
  if (!ok) {
    failures.push(
      `${r.surface} ${r.permission} on ${JSON.stringify(r.text)} — expected showsPermission=${r.expected}` +
        ` textOnly=${r.textOnly}, got showsPermission=${got} textOnly=${textOnly}`,
    );
  }
}

const flipped = CONTROLS.filter((c) => c.oldVerdict && !c.survives).length;
/** The rows where matching rendered text is wrong — the defect this round corrects. */
const textWouldBeWrong = RENDERED.filter((r) => r.expected && !r.textOnly);
console.log();
const total = CONTROLS.length + RENDERED.length;
if (failures.length === 0) {
  console.log(
    `nxsat-308-parity selftest: pass — ${CONTROLS.length} verdict control(s) and ${RENDERED.length}` +
      ` rendered-text control(s); ${flipped} verdict control(s) passed the old predicate while no` +
      ` save had happened, and matching rendered text is wrong on ${textWouldBeWrong.length} of the` +
      ` strings the nxs panel actually emits.`,
  );
  process.exit(0);
}
console.error(
  `nxsat-308-parity selftest: FAIL — ${failures.length} of ${total} control(s) did not behave as specified:`,
);
for (const f of failures) console.error(`  - ${f}`);
process.exit(1);
